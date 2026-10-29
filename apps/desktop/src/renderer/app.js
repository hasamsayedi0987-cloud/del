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
  // گفتگوی تازه (اضافه شدن به گروه) → عضویت در اتاق + رفرش
  socket.on('conversation.new', (p) => {
    if (p?.conversationId) socket.emit('conversation.join', { conversationId: p.conversationId });
    void renderChatList();
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
    const body = document.createElement('span');
    body.className = 'msg-body';
    body.textContent = m.body;
    div.appendChild(body);
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
