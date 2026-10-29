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
  socket = io(store.apiBase, { auth: { token }, transports: ['websocket'] });
  socket.on('connect', () => {
    $('wsDot').className = 'dot ok';
    $('wsText').textContent = 'اتصال بلادرنگ فعال';
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
      const name = c.peer?.displayName ?? c.peer?.phone ?? 'ناشناس';
      row.innerHTML = `
        <div class="avatar">${(name || '؟').trim().charAt(0)}</div>
        <div class="chat-meta">
          <div class="chat-name"></div>
          <div class="chat-preview"></div>
        </div>
        ${c.unreadCount > 0 ? `<div class="badge">${faDigits(c.unreadCount)}</div>` : ''}`;
      row.querySelector('.chat-name').textContent = name;
      row.querySelector('.chat-preview').textContent = c.lastMessage?.body ?? 'بدون پیام';
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

// ————— چت —————
async function openChat(conv) {
  currentConv = conv;
  localMessages = [];
  $('chatTitle').textContent = conv.peer?.displayName ?? conv.peer?.phone ?? 'گفتگو';
  $('msgList').innerHTML = '';
  $('msgInput').value = '';
  show('chat');
  $('msgInput').focus();
  await loadHistory();
  socket?.emit('join', { conversationId: conv.id }); // برای سازگاری آینده؛ اتاق‌ها هنگام اتصال ست می‌شوند
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
    div.textContent = m.body;
    list.appendChild(div);
  }
  list.scrollTop = list.scrollHeight;
}

$('sendMsg').onclick = () => sendMessage();
$('msgInput').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') sendMessage(); });

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
