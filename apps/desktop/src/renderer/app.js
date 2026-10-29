/**
 * Del Desktop — renderer logic (vanilla JS, RTL) — گام ۲: پیام‌رسانی بلادرنگ
 */
const $ = (id) => document.getElementById(id);

const store = {
  get apiBase() { return localStorage.getItem('del.apiBase') || 'http://localhost:3000'; },
  set apiBase(v) { localStorage.setItem('del.apiBase', v.replace(/\/+$/, '')); },
  get: (k) => localStorage.getItem(`del.${k}`),
  set: (k, v) => localStorage.setItem(`del.${k}`, v),
  del: (k) => localStorage.removeItem(`del.${k}`),
};

const faDigits = (s) =>
  String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);
const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

// ————— API —————
async function apiCall(path, { method = 'GET', body, token } = {}) {
  let res;
  try {
    res = await fetch(`${store.apiBase}/api/v1${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw { status: 0, code: 'NETWORK', message: 'سرور در دسترس نیست — آدرس سرور را بررسی کنید' };
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw {
      status: res.status,
      code: data?.error?.code ?? 'UNKNOWN',
      message: data?.error?.message ?? 'خطای ناشناخته',
    };
  }
  return data;
}

const faError = (e) => {
  switch (e.code) {
    case 'PHONE_INVALID': return 'شماره موبایل معتبر نیست';
    case 'TOO_MANY_REQUESTS': return 'تعداد درخواست‌ها زیاد است؛ کمی بعد تلاش کنید';
    case 'OTP_INVALID': return 'کد وارد شده اشتباه است';
    case 'OTP_EXPIRED': case 'OTP_NOT_FOUND': return 'کد منقضی یا ناموجود است؛ کد جدید بگیرید';
    case 'OTP_LOCKED': return 'تلاش‌های ناموفق زیاد بود؛ کد جدید بگیرید';
    case 'USER_NOT_FOUND': return 'کاربری با این شماره در دل نیست';
    case 'NETWORK': return e.message;
    default: return 'خطا در ارتباط با سرور';
  }
};

const show = (name) => {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
};

// ————— وضعیت —————
let session = null; // { accessToken, refreshToken, user }
let socket = null;
let currentConv = null;
let localMessages = []; // MessageDto[]

// ————— گام ۳: حضور / تایپینگ / رسید خواندن —————
let currentPeerId = null;
let typingHideTimer = null;
let lastTypingSent = 0;
let peerLastPresence = null; // PresenceDto
let heartbeatTimer = null;

// ————— گام ۴: گروه‌ها —————
let isGroupChat = false;
let groupMembers = []; // ParticipantDto[]
let myGroupRole = null; // 'admin' | 'member'
let maxOtherLastRead = 0; // بیشترین lastReadSeq سایر اعضا (تیک خوانده‌شد)
let typingUserName = null;

// ————— گام ۶: تماس —————
let call = null; // { phase, callId, conversationId, kind, peerName, url?, token?, accepting? }
let lkRoom = null; // LiveKit Room
let lkAudioEls = []; // المان‌های صوتی attach‌شده

function faRelative(iso) {
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  const fa = (n) => faDigits(n);
  if (min < 1) return 'همین حالا';
  if (min < 60) return `${fa(min)} دقیقه پیش`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${fa(h)} ساعت پیش`;
  return `${fa(Math.floor(h / 24))} روز پیش`;
}

function renderChatStatus() {
  const el = $('chatStatus');
  if (!el || !currentConv) return;
  if (typingUserName !== null) {
    el.textContent = isGroupChat ? `${typingUserName} در حال نوشتن…` : 'در حال نوشتن…';
    el.className = 'chat-status typing';
    return;
  }
  if (isGroupChat) {
    el.textContent = `${faDigits(groupMembers.length)} عضو${myGroupRole === 'admin' ? ' · شما ادمین هستید' : ''}`;
    el.className = 'chat-status';
    return;
  }
  if (peerLastPresence?.online) {
    el.textContent = 'آنلاین';
    el.className = 'chat-status online';
  } else if (peerLastPresence?.lastSeen) {
    el.textContent = `آخرین بازدید ${faRelative(peerLastPresence.lastSeen)}`;
    el.className = 'chat-status';
  } else {
    el.innerHTML = '&nbsp;';
    el.className = 'chat-status';
  }
}

/** جزئیات کامل گروه (اعضا + نقش‌ها) */
async function refreshGroupDetail() {
  if (!isGroupChat || !currentConv || !session) return;
  try {
    const detail = await apiCall(`/conversations/${currentConv.id}`, { token: session.accessToken });
    groupMembers = detail.participants ?? [];
    myGroupRole = detail.myRole ?? null;
    const otherMax = groupMembers
      .filter((p) => p.userId !== session.user.id)
      .reduce((mx, p) => Math.max(mx, p.lastReadSeq ?? 0), 0);
    maxOtherLastRead = Math.max(maxOtherLastRead, otherMax);
    renderChatStatus();
  } catch {
    /* بی‌اهمیت */
  }
}

function memberName(userId) {
  const p = groupMembers.find((m) => m.userId === userId);
  return p?.displayName ?? p?.phone ?? 'عضو';
}

async function refreshPeerPresence() {
  if (!currentPeerId || !session) return;
  try {
    peerLastPresence = await apiCall(`/users/${currentPeerId}/presence`, { token: session.accessToken });
    renderChatStatus();
  } catch {
    /* بی‌اهمیت */
  }
}

// ————— صحنه ۱: شماره —————
$('apiBase').value = store.apiBase;
$('sendOtp').onclick = async () => {
  $('phoneError').textContent = '';
  store.apiBase = $('apiBase').value.trim() || 'http://localhost:3000';
  const btn = $('sendOtp');
  btn.disabled = true; btn.textContent = 'در حال ارسال…';
  try {
    await apiCall('/auth/otp/request', { method: 'POST', body: { phone: $('phone').value.trim() } });
    $('otpHint').textContent = `کد ۶ رقمی برای ${$('phone').value.trim()} ارسال شد`;
    show('otp');
    $('code').focus();
  } catch (e) {
    $('phoneError').textContent = faError(e);
  } finally {
    btn.disabled = false; btn.textContent = 'دریافت کد ورود';
  }
};
$('phone').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') $('sendOtp').click(); });

// ————— صحنه ۲: OTP —————
$('verify').onclick = async () => {
  $('otpError').textContent = '';
  const btn = $('verify');
  btn.disabled = true; btn.textContent = 'در حال بررسی…';
  try {
    session = await apiCall('/auth/otp/verify', {
      method: 'POST',
      body: {
        phone: $('phone').value.trim(),
        code: $('code').value.trim(),
        platform: 'windows',
        deviceName: 'Del Desktop',
      },
    });
    store.set('refreshToken', session.refreshToken);
    connectWs(session.accessToken);
    enterChats();
  } catch (e) {
    $('otpError').textContent = faError(e);
  } finally {
    btn.disabled = false; btn.textContent = 'ورود به دل';
  }
};
$('backToPhone').onclick = () => show('phone');
$('code').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') $('verify').click(); });

// ————— WebSocket —————
function connectWs(token) {
  socket?.disconnect();
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  socket = io(store.apiBase, { auth: { token }, transports: ['websocket'] });
  socket.on('connect', () => {
    $('wsDot').className = 'dot ok';
    $('wsText').textContent = 'اتصال بلادرنگ فعال';
    // heartbeat حضور هر ۲۵ ثانیه
    heartbeatTimer = setInterval(() => {
      if (socket?.connected) socket.emit('presence.heartbeat');
    }, 25000);
    // بعد از اتصال مجدد: عضویت مجدد + همگام‌سازی آفلاین
    if (currentConv) {
      socket.emit('conversation.join', { conversationId: currentConv.id });
      const realSeqs = localMessages.map((m) => m.serverSeq).filter((s) => s < Number.MAX_SAFE_INTEGER);
      const maxSeq = realSeqs.length ? Math.max(...realSeqs) : 0;
      if (maxSeq > 0) {
        void apiCall(`/conversations/${currentConv.id}/messages?since=${maxSeq}`, { token: session.accessToken })
          .then((page) => {
            (page.messages ?? []).forEach(upsertMessage);
          })
          .catch(() => {});
      }
      void refreshPeerPresence();
    }
  });
  socket.on('disconnect', () => {
    $('wsDot').className = 'dot down';
    $('wsText').textContent = 'اتصال بلادرنگ قطع شد — در حال تلاش مجدد…';
  });
  socket.on('message.new', ({ conversationId, message }) => {
    if (currentConv && conversationId === currentConv.id) {
      upsertMessage(message);
      void apiCall(`/conversations/${conversationId}/read`, {
        method: 'POST', token: session.accessToken, body: { lastReadSeq: message.serverSeq },
      }).catch(() => {});
    }
    // پیش‌نمایش/شمارنده لیست هم به‌روز شود
    void renderChatList();
  });
  // گفتگوی تازه‌ساخته‌شده توسط کاربر دیگر → رفرش لیست (گام ۴: handler کامل در پایین)
  socket.on('conversation.new', () => {});
  // ————— گام ۳ —————
  socket.on('presence.update', (p) => {
    if (p.userId === currentPeerId) {
      peerLastPresence = p;
      renderChatStatus();
    }
  });
  socket.on('typing', ({ conversationId, userId }) => {
    if (!currentConv || conversationId !== currentConv.id || userId === session.user.id) return;
    if (!isGroupChat && userId !== currentPeerId) return;
    typingUserName = isGroupChat ? memberName(userId) : '';
    renderChatStatus();
    if (typingHideTimer) clearTimeout(typingHideTimer);
    typingHideTimer = setTimeout(() => {
      typingUserName = null;
      renderChatStatus();
    }, 4000);
  });
  socket.on('message.read', ({ conversationId, userId, lastReadSeq }) => {
    if (!currentConv || conversationId !== currentConv.id || userId === session.user.id) return;
    maxOtherLastRead = Math.max(maxOtherLastRead, lastReadSeq);
    renderMessages();
  });
  // ————— گام ۴: گروه‌ها —————
  socket.on('member.added', ({ conversationId, userId }) => {
    if (!currentConv || conversationId !== currentConv.id) return;
    void refreshGroupDetail();
  });
  socket.on('member.removed', ({ conversationId, userId, left }) => {
    void renderChatList();
    if (!currentConv || conversationId !== currentConv.id) return;
    if (userId === session.user.id) {
      alert(left ? 'شما از گروه خارج شدید' : 'شما از گروه حذف شدید');
      currentConv = null;
      void enterChats();
      return;
    }
    void refreshGroupDetail();
  });
  // ————— گام ۶: رویدادهای تماس —————
  socket.on('call.incoming', (p) => {
    if (call) return; // مشغول — سرور هم جلوی تماس دوم را می‌گیرد
    call = {
      phase: 'incoming',
      callId: p.call.id,
      conversationId: p.call.conversationId,
      kind: p.call.kind,
      peerName: p.caller.displayName ?? p.caller.phone ?? 'ناشناس',
    };
    renderCall();
  });
  socket.on('call.accepted', (p) => {
    if (!call || call.callId !== p.call.id) return;
    if (call.phase === 'outgoing') {
      call.phase = 'active';
      call.url = p.url;
      call.token = p.token;
      renderCall();
      void connectLK();
    } else if (call.phase === 'incoming' && !call.accepting) {
      endCallLocal('تماس در دستگاه/پنجره دیگری پاسخ داده شد');
    }
  });
  socket.on('call.ended', (p) => {
    if (!call || call.callId !== p.callId) return;
    let msg = 'تماس پایان یافت';
    if (p.reason === 'timeout') msg = 'پاسخی داده نشد';
    else if (p.reason === 'reject') msg = call.phase === 'outgoing' ? 'تماس رد شد' : 'تماس را رد کردید';
    else if (p.reason === 'cancel') msg = 'تماس لغو شد';
    else if (p.reason === 'hangup' && p.durationS != null) msg = `پایان تماس · ${faDigits(p.durationS)} ثانیه`;
    endCallLocal(msg);
  });
}

// ————— گفتگوها —————
async function enterChats() {
  show('chats');
  await renderChatList();
}

async function renderChatList() {
  const listEl = $('chatList');
  listEl.innerHTML = '<p class="sub">در حال بارگذاری…</p>';
  try {
    const convs = await apiCall('/conversations', { token: session.accessToken });
    listEl.innerHTML = '';
    if (!convs.length) {
      listEl.innerHTML = '<p class="sub">هنوز گفتگویی ندارید — با «+ جدید» شروع کنید</p>';
      return;
    }
    for (const c of convs) {
      const row = document.createElement('div');
      row.className = 'chat-row';
      const isGroup = c.type === 'group';
      const name = isGroup
        ? c.title ?? 'گروه'
        : c.peer?.displayName ?? c.peer?.phone ?? 'ناشناس';
      row.innerHTML = `
        <div class="avatar ${isGroup ? 'group' : ''}">${(name || '؟').trim().charAt(0)}</div>
        <div class="chat-meta">
          <div class="chat-name"></div>
          <div class="chat-preview"></div>
        </div>
        ${c.unreadCount > 0 ? `<div class="badge">${faDigits(c.unreadCount)}</div>` : ''}`;
      row.querySelector('.chat-name').textContent = name;
      row.querySelector('.chat-preview').textContent = isGroup
        ? `${faDigits(c.memberCount ?? 0)} عضو${c.lastMessage ? ` · ${c.lastMessage.body}` : ''}`
        : c.lastMessage?.body ?? 'بدون پیام';
      row.onclick = () => openChat(c);
      listEl.appendChild(row);
    }
  } catch (e) {
    listEl.innerHTML = `<p class="error">${faError(e)}</p>`;
  }
}

$('newChat').onclick = () => {
  $('newChatError').textContent = '';
  $('newChatPhone').value = '';
  $('newChatModal').classList.remove('hidden');
  $('newChatPhone').focus();
};
$('newChatCancel').onclick = () => $('newChatModal').classList.add('hidden');
$('newChatStart').onclick = async () => {
  $('newChatError').textContent = '';
  try {
    const user = await apiCall(`/users/by-phone/${encodeURIComponent($('newChatPhone').value.trim())}`, {
      token: session.accessToken,
    });
    const conv = await apiCall('/conversations', {
      method: 'POST', token: session.accessToken, body: { userId: user.id },
    });
    $('newChatModal').classList.add('hidden');
    openChat(conv);
  } catch (e) {
    $('newChatError').textContent = faError(e);
  }
};
$('newChatPhone').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') $('newChatStart').click(); });

// ————— گروه جدید (گام ۴) —————
$('newGroup').onclick = () => {
  $('newGroupError').textContent = '';
  $('newGroupTitle').value = '';
  $('newGroupPhones').value = '';
  $('newGroupModal').classList.remove('hidden');
  $('newGroupTitle').focus();
};
$('newGroupCancel').onclick = () => $('newGroupModal').classList.add('hidden');
$('newGroupCreate').onclick = async () => {
  $('newGroupError').textContent = '';
  const title = $('newGroupTitle').value.trim();
  const phones = $('newGroupPhones').value
    .split(/[,،\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!title || !phones.length) {
    $('newGroupError').textContent = 'عنوان گروه و حداقل یک شماره لازم است';
    return;
  }
  try {
    const users = await Promise.all(
      phones.map((p) => apiCall(`/users/by-phone/${encodeURIComponent(p)}`, { token: session.accessToken })),
    );
    const conv = await apiCall('/conversations/group', {
      method: 'POST',
      token: session.accessToken,
      body: { title, memberUserIds: users.map((u) => u.id) },
    });
    $('newGroupModal').classList.add('hidden');
    openChat(conv);
  } catch (e) {
    $('newGroupError').textContent = e.code === 'USER_NOT_FOUND' ? 'یکی از شماره‌ها در دل نیست' : faError(e);
  }
};

// ————— چت —————
async function openChat(conv) {
  currentConv = conv;
  localMessages = [];
  isGroupChat = conv.type === 'group';
  groupMembers = [];
  myGroupRole = null;
  maxOtherLastRead = 0;
  typingUserName = null;
  currentPeerId = conv.peer?.userId ?? null;
  peerLastPresence = null;
  $('chatTitle').textContent = isGroupChat
    ? conv.title ?? 'گروه'
    : conv.peer?.displayName ?? conv.peer?.phone ?? 'گفتگو';
  $('chatStatus').innerHTML = '&nbsp;';
  $('msgList').innerHTML = '';
  $('msgInput').value = '';
  show('chat');
  $('msgInput').focus();
  // گام ۶: دکمه‌های تماس فقط در گفتگوهای ۱:۱
  const direct = conv.type !== 'group';
  $('callAudio').classList.toggle('hidden', !direct);
  $('callVideo').classList.toggle('hidden', !direct);
  if (isGroupChat) void refreshGroupDetail();
  await loadHistory();
  // عضویت در اتاق — برای مکالمه‌های ساخته‌شده پس از اتصال socket
  socket?.emit('conversation.join', { conversationId: conv.id });
  void refreshPeerPresence();
}

async function loadHistory(before) {
  try {
    const page = await apiCall(
      `/conversations/${currentConv.id}/messages${before ? `?before=${before}` : ''}`,
      { token: session.accessToken },
    );
    localMessages = before ? [...page.messages, ...localMessages] : page.messages;
    $('loadOlder').classList.toggle('hidden', !page.hasMore);
    renderMessages();
    const latest = page.messages[page.messages.length - 1];
    if (latest && !before) {
      void apiCall(`/conversations/${currentConv.id}/read`, {
        method: 'POST', token: session.accessToken, body: { lastReadSeq: latest.serverSeq },
      }).catch(() => {});
    }
  } catch (e) {
    $('msgList').innerHTML = `<p class="error">${faError(e)}</p>`;
  }
}
$('loadOlder').onclick = () => {
  const first = localMessages[0];
  if (first) void loadHistory(first.serverSeq);
};
$('chatBack').onclick = () => { currentConv = null; void enterChats(); };

function upsertMessage(m) {
  const i = localMessages.findIndex((x) => x.clientMsgId === m.clientMsgId);
  if (i === -1) localMessages.push(m);
  else localMessages[i] = m;
  renderMessages();
}

function renderMessages() {
  localMessages.sort((a, b) => a.serverSeq - b.serverSeq);
  const list = $('msgList');
  list.innerHTML = '';
  for (const m of localMessages) {
    const mine = m.senderId === session.user.id;
    const div = document.createElement('div');
    div.className = `msg ${mine ? 'mine' : 'peer'}`;
    if (!mine && isGroupChat) {
      const sender = document.createElement('span');
      sender.className = 'msg-sender';
      sender.textContent = memberName(m.senderId);
      div.appendChild(sender);
    }
    if (m.media) div.appendChild(buildMediaNode(m.media));
    if (m.body) {
      const body = document.createElement('span');
      body.className = 'msg-body';
      body.textContent = m.body;
      div.appendChild(body);
    }
    if (mine) {
      const status = document.createElement('span');
      status.className = 'msg-status';
      status.textContent = m.serverSeq <= maxOtherLastRead ? '✓✓' : '✓';
      div.appendChild(status);
    }
    list.appendChild(div);
  }
  list.scrollTop = list.scrollHeight;
}

/** گره رسانه در چت — تصویر درون‌خطی یا ردیف پیوست */
function buildMediaNode(media) {
  if (media.kind === 'image') {
    const wrap = document.createElement('div');
    wrap.className = 'media-image-wrap';
    const img = document.createElement('img');
    img.className = 'media-image';
    img.alt = media.originalName ?? 'عکس';
    if (media.width && media.height) img.dataset.ratio = String(media.width / media.height);
    wrap.appendChild(img);
    getMediaSignedUrl(media.id)
      .then((u) => { img.src = u; })
      .catch(() => { img.replaceWith(Object.assign(document.createElement('span'), { className: 'msg-body dim', textContent: 'نمایش عکس ممکن نشد' })); });
    return wrap;
  }
  const row = document.createElement('div');
  row.className = 'media-attach';
  const icon = document.createElement('span');
  icon.className = 'media-attach-icon';
  icon.textContent = media.kind === 'video' ? '🎬' : media.kind === 'audio' ? '🎵' : '📄';
  const meta = document.createElement('span');
  meta.className = 'media-attach-meta';
  const name = document.createElement('b');
  name.textContent = media.originalName ?? 'فایل';
  const size = document.createElement('small');
  size.textContent = `${faDigits(Math.max(1, Math.round(media.size / 1024)))} کیلوبایت`;
  meta.append(name, document.createElement('br'), size);
  row.append(icon, meta);
  row.onclick = async () => {
    try {
      const u = await getMediaSignedUrl(media.id);
      window.open(u, '_blank');
    } catch { /* منقضی — دوباره تلاش با کلیک بعدی */ }
  };
  return row;
}

$('sendMsg').onclick = () => sendMessage();
$('msgInput').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') sendMessage(); });
// «در حال نوشتن» — throttle کلاینت: حداکثر هر ۲٫۵ ثانیه
$('msgInput').addEventListener('input', () => {
  if (!currentConv || !$('msgInput').value.trim()) return;
  const now = Date.now();
  if (now - lastTypingSent > 2500) {
    lastTypingSent = now;
    socket?.emit('typing', { conversationId: currentConv.id });
  }
});

function sendMessage() {
  const body = $('msgInput').value.trim();
  if (!body || !currentConv) return;
  const clientMsgId = uuid();
  $('msgInput').value = '';

  const fallbackRest = async () => {
    try {
      const r = await apiCall(`/conversations/${currentConv.id}/messages`, {
        method: 'POST', token: session.accessToken, body: { clientMsgId, body },
      });
      upsertMessage(r.message);
    } catch {
      /* رد شدن — پیام گم نمی‌شود چون کاربر می‌تواند دوباره بفرستد */
    }
  };

  if (socket?.connected) {
    socket.timeout(8000).emit(
      'message.send',
      { conversationId: currentConv.id, clientMsgId, body },
      (err, ack) => {
        if (!err && ack?.ok && ack.message) upsertMessage(ack.message);
        else void fallbackRest();
      },
    );
  } else {
    void fallbackRest();
  }
}

// ————— گام ۵: رسانه — آپلود مستقیم به S3 با Presigned URL —————

const mediaUrlCache = new Map(); // mediaId → { url, expiresAt }

async function getMediaSignedUrl(mediaId) {
  const hit = mediaUrlCache.get(mediaId);
  if (hit && hit.expiresAt > Date.now() + 60000) return hit.url;
  const res = await apiCall(`/media/${mediaId}/url`, { token: session.accessToken });
  mediaUrlCache.set(mediaId, { url: res.url, expiresAt: new Date(res.expiresAt).getTime() });
  return res.url;
}

async function uploadMediaToS3(file) {
  const pre = await apiCall('/media/presign', {
    method: 'POST',
    token: session.accessToken,
    body: {
      conversationId: currentConv.id,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      originalName: file.name,
    },
  });
  if (pre.mode === 'single' && pre.url) {
    const res = await fetch(pre.url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!res.ok) throw { code: 'UPLOAD_FAILED', message: `آپلود ناموفق (${res.status})` };
  } else if (pre.mode === 'multipart' && pre.partUrls && pre.partSize) {
    const parts = [];
    for (let i = 0; i < pre.partUrls.length; i++) {
      const blob = file.slice(i * pre.partSize, (i + 1) * pre.partSize);
      const res = await fetch(pre.partUrls[i], {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: blob,
      });
      if (!res.ok) throw { code: 'UPLOAD_FAILED', message: `آپلود پارت ${faDigits(i + 1)} ناموفق بود` };
      const etag = res.headers.get('etag');
      if (!etag) throw { code: 'UPLOAD_FAILED', message: 'etag پارت دریافت نشد' };
      parts.push({ partNumber: i + 1, etag });
    }
  }
  return await apiCall('/media/complete', {
    method: 'POST', token: session.accessToken,
    body: { mediaId: pre.mediaId, ...(pre.mode === 'multipart' ? { parts } : {}) },
  });
}

$('attachBtn').onclick = () => $('fileInput').click();
$('fileInput').addEventListener('change', async () => {
  const file = $('fileInput').files[0];
  $('fileInput').value = '';
  if (!file || !currentConv) return;
  const clientMsgId = uuid();
  try {
    const media = await uploadMediaToS3(file);
    const caption = $('msgInput').value.trim();
    $('msgInput').value = '';
    const payload = {
      conversationId: currentConv.id,
      clientMsgId,
      mediaId: media.id,
      ...(caption ? { body: caption } : {}),
    };
    const fallbackRest = async () => {
      const r = await apiCall(`/conversations/${currentConv.id}/messages`, {
        method: 'POST', token: session.accessToken, body: payload,
      });
      upsertMessage(r.message);
    };
    if (socket?.connected) {
      socket.timeout(15000).emit('message.send', payload, (err, ack) => {
        if (!err && ack?.ok && ack.message) upsertMessage(ack.message);
        else void fallbackRest();
      });
    } else {
      void fallbackRest();
    }
  } catch (e) {
    alert(e.code === 'MEDIA_TOO_LARGE'
      ? 'حجم فایل بیشتر از حد مجاز است'
      : e.code === 'MIME_NOT_ALLOWED'
        ? 'این نوع فایل مجاز نیست'
        : e.message ?? 'آپلود فایل ناموفق بود');
  }
});

// ————— گام ۶: تماس صوتی/تصویری — signaling روی WS، مدیا از LiveKit —————

const LK = () => window.LivekitClient ?? null;

function faCallError(e) {
  switch (e.code) {
    case 'CALLS_DISABLED': return 'سرور هنوز LiveKit را پیکربندی نکرده است';
    case 'CALL_BUSY': return 'طرف مقابل در حال حاضر در تماس دیگری است';
    case 'NOT_DIRECT': return 'فعلاً تماس فقط در گفتگوهای ۱:۱ ممکن است';
    case 'INVALID_STATE': return 'این تماس دیگر قابل پاسخ/پایان نیست';
    case 'CALL_NOT_FOUND': return 'این تماس دیگر وجود ندارد';
    case 'NETWORK': return e.message;
    default: return 'تماس ممکن نشد — دوباره تلاش کنید';
  }
}

/** نمایش/به‌روزرسانی لایه تماس مطابق وضعیت */
function renderCall() {
  const overlay = $('callOverlay');
  if (!call) { overlay.classList.add('hidden'); return; }
  overlay.classList.remove('hidden');
  $('callAvatar').textContent = (call.peerName || '؟').trim().charAt(0);
  $('callPeerName').textContent = call.peerName;
  const isVideo = call.kind === 'video';
  const active = call.phase === 'active';
  $('callAccept').classList.toggle('hidden', call.phase !== 'incoming');
  $('callReject').classList.toggle('hidden', call.phase === 'active');
  $('callMute').classList.toggle('hidden', !active);
  $('callCam').classList.toggle('hidden', !active || !isVideo);
  $('callHangup').classList.toggle('hidden', !active);
  $('callScreenShare').classList.toggle('hidden', !active);
  $('callRemoteVideo').classList.add('hidden');
  if (active) {
    $('callStateText').textContent = lkRoom && lkRoom.state === 'connected'
      ? (isVideo ? 'تماس تصویری برقرار است' : 'تماس برقرار است')
      : 'در حال اتصال…';
  } else {
    $('callStateText').textContent = call.phase === 'incoming'
      ? `تماس ${isVideo ? 'تصویری' : 'صوتی'} ورودی…`
      : 'در حال زنگ زدن…';
  }
}

/** شروع تماس از هدر چت */
async function startCall(kind) {
  if (call || !currentConv || currentConv.type === 'group') return;
  try {
    const c = await apiCall('/calls', {
      method: 'POST',
      token: session.accessToken,
      body: { conversationId: currentConv.id, kind },
    });
    call = {
      phase: 'outgoing',
      callId: c.id,
      conversationId: c.conversationId,
      kind,
      peerName: $('chatTitle').textContent || 'گفتگو',
    };
    renderCall();
  } catch (e) {
    alert(faCallError(e));
  }
}

/** اتصال به اتاق LiveKit پس از پاسخ */
async function connectLK() {
  const LKC = LK();
  if (!LKC || !call || !call.url || !call.token) {
    if (call) $('callStateText').textContent = 'این نسخه از تماس پشتیبانی نمی‌کند';
    return;
  }
  try {
    lkRoom = new LKC.Room({ adaptiveStream: true, dynacast: true });
    lkRoom
      .on('trackSubscribed', (track, pub) => {
        if (track.kind === 'video' && pub.source === 'camera') {
          const v = $('callRemoteVideo');
          v.srcObject = new MediaStream([track.mediaStreamTrack]);
          v.classList.remove('hidden');
          $('callInfo').classList.add('compact');
        } else if (track.kind === 'audio') {
          const a = new Audio();
          a.srcObject = new MediaStream([track.mediaStreamTrack]);
          void a.play().catch(() => {});
          lkAudioEls.push(a);
        }
      })
      .on('trackUnsubscribed', (track, pub) => {
        if (pub.source === 'camera') {
          $('callRemoteVideo').classList.add('hidden');
          $('callRemoteVideo').srcObject = null;
        }
      })
      .on('participantDisconnected', () => {
        $('callStateText').textContent = 'طرف مقابل خارج شد…';
      })
      .on('disconnected', () => {
        // سرور call.ended می‌فرستد؛ UI فقط آماده باشد
      });
    await lkRoom.connect(call.url, call.token);
    renderCall();
    if (call.kind === 'video') {
      const TrackSrc = LKC.Track?.Source?.Camera ?? 'camera';
      await lkRoom.localParticipant.setCameraEnabled(true);
      const pub = lkRoom.localParticipant.getTrackPublication(TrackSrc);
      if (pub?.videoTrack) {
        const lv = $('callLocalVideo');
        lv.srcObject = new MediaStream([pub.videoTrack.mediaStreamTrack]);
        lv.classList.remove('hidden');
      }
    }
  } catch {
    $('callStateText').textContent = 'اتصال تماس برقرار نشد';
  }
}

/** جمع‌کردن اتاق LiveKit و المان‌های مدیا */
function teardownLK() {
  try { lkRoom?.disconnect(); } catch { /* بی‌اهمیت */ }
  lkRoom = null;
  for (const a of lkAudioEls) {
    try { a.srcObject = null; } catch { /* بی‌اهمیت */ }
  }
  lkAudioEls = [];
  $('callRemoteVideo').srcObject = null;
  $('callRemoteVideo').classList.add('hidden');
  $('callLocalVideo').srcObject = null;
  $('callLocalVideo').classList.add('hidden');
  $('callInfo').classList.remove('compact');
}

/** بستن تماس سمت کلاینت (سرور هم call.ended می‌فرستد) */
function endCallLocal(msg) {
  const had = call;
  call = null;
  teardownLK();
  renderCall();
  if (msg && had) alert(msg);
}

$('callAudio').onclick = () => void startCall('audio');
$('callVideo').onclick = () => void startCall('video');

$('callAccept').onclick = async () => {
  if (!call || call.phase !== 'incoming') return;
  try {
    const info = await apiCall(`/calls/${call.callId}/accept`, { method: 'POST', token: session.accessToken });
    call.accepting = true;
    call.phase = 'active';
    call.url = info.url;
    call.token = info.token;
    renderCall();
    void connectLK();
  } catch (e) {
    endCallLocal(faCallError(e));
  }
};

$('callReject').onclick = async () => {
  if (!call) return;
  const c = call;
  endCallLocal(null);
  try {
    await apiCall(`/calls/${c.callId}/${c.phase === 'incoming' ? 'reject' : 'cancel'}`, {
      method: 'POST', token: session.accessToken,
    });
  } catch { /* سرور با timeout هم تمیز می‌کند */ }
};

$('callHangup').onclick = async () => {
  if (!call) return;
  const c = call;
  endCallLocal(null);
  try { await apiCall(`/calls/${c.callId}/end`, { method: 'POST', token: session.accessToken }); }
  catch { /* بی‌اهمیت */ }
};

$('callMute').onclick = async () => {
  if (!lkRoom) return;
  const pub = lkRoom.localParticipant.getTrackPublication?.('microphone');
  const next = !(pub?.isMuted ?? false);
  try {
    await lkRoom.localParticipant.setMicrophoneEnabled(!pub?.isMuted);
    $('callMute').classList.toggle('off', pub?.isMuted === true);
    $('callMute').textContent = pub?.isMuted ? '🎙' : '🔇';
  } catch { /* بی‌اهمیت */ }
  void next;
};

$('callCam').onclick = async () => {
  if (!lkRoom) return;
  const pub = lkRoom.localParticipant.getTrackPublication?.('camera');
  try {
    await lkRoom.localParticipant.setCameraEnabled(pub?.isMuted ?? true);
    const lv = $('callLocalVideo');
    if (pub?.isMuted) {
      const p2 = lkRoom.localParticipant.getTrackPublication?.('camera');
      if (p2?.videoTrack) {
        lv.srcObject = new MediaStream([p2.videoTrack.mediaStreamTrack]);
        lv.classList.remove('hidden');
      }
    } else {
      lv.srcObject = null;
      lv.classList.add('hidden');
    }
    $('callCam').classList.toggle('off', !pub?.isMuted);
  } catch { /* بی‌اهمیت */ }
};

// اشتراک صفحه (پروتوتایپ دسکتاپ) — handler اصلی در src/main.js
$('callScreenShare').onclick = async () => {
  if (!lkRoom) return;
  try {
    const on = lkRoom.localParticipant.isScreenShareEnabled;
    await lkRoom.localParticipant.setScreenShareEnabled(!on);
    $('callScreenShare').textContent = !on ? 'قطع اشتراک صفحه' : 'اشتراک صفحه';
  } catch {
    alert('اشتراک صفحه ممکن نشد');
  }
};

// ————— پروفایل —————
$('goProfile').onclick = () => {
  $('hello').textContent = `سلام ${session.user.displayName ?? 'کاربر'} 👋`;
  $('mePhone').textContent = session.user.phone;
  $('meName').textContent = session.user.displayName ?? '—';
  $('meId').textContent = session.user.id.slice(0, 8) + '…';
  $('displayName').value = session.user.displayName ?? '';
  show('profile');
  void checkHealth();
};
$('profileBack').onclick = () => show('chats');

async function checkHealth() {
  const dot = $('healthDot'), txt = $('healthText');
  try {
    const h = await apiCall('/health');
    dot.className = `dot ${h.status === 'ok' ? 'ok' : 'down'}`;
    txt.textContent = h.status === 'ok'
      ? 'سرور و پایگاه‌داده سالم هستند'
      : `سرور فعال — وضعیت: degraded (db: ${h.services.database}, redis: ${h.services.redis})`;
  } catch {
    dot.className = 'dot down';
    txt.textContent = 'سرور در دسترس نیست';
  }
}

$('saveName').onclick = async () => {
  try {
    const user = await apiCall('/users/me', {
      method: 'PATCH',
      token: session.accessToken,
      body: { displayName: $('displayName').value.trim() || undefined },
    });
    session.user = user;
    $('hello').textContent = `سلام ${user.displayName ?? 'کاربر'} 👋`;
    $('meName').textContent = user.displayName ?? '—';
  } catch {
    /* گام بعدی: رفرش خودکار توکن */
  }
};

$('logout').onclick = async () => {
  const rt = store.get('refreshToken');
  if (rt && session) await apiCall('/auth/logout', { method: 'POST', body: { refreshToken: rt } }).catch(() => {});
  store.del('refreshToken');
  endCallLocal(null);
  socket?.disconnect();
  socket = null;
  session = null;
  show('phone');
};

// ————— بوت: بازیابی نشست با refresh token —————
(async () => {
  const rt = store.get('refreshToken');
  if (!rt) return;
  try {
    session = await apiCall('/auth/refresh', { method: 'POST', body: { refreshToken: rt } });
    store.set('refreshToken', session.refreshToken);
    connectWs(session.accessToken);
    enterChats();
  } catch {
    store.del('refreshToken');
  }
})();
