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
    // گام ۹ — هوش مصنوعی
    case 'AI_CONSENT_REQUIRED': return e.message;
    case 'AI_RATE_LIMITED': return e.message;
    case 'AI_PROVIDER_ERROR': return 'سرویس هوش مصنوعی موقتاً در دسترس نیست؛ دوباره تلاش کنید';
    case 'AI_E2EE_UNAVAILABLE': return 'پیام‌های رمزنگاری‌شدهٔ سرتاسری قابل ترجمه نیستند';
    case 'AI_NOTHING_TO_READ': return e.message;
    case 'AI_DISABLED': return 'قابلیت هوش مصنوعی روی این سرور فعال نیست';
    case 'AI_TEXT_TOO_LONG': return 'متن بیش از حد بلند است';
    // گام ۱۰ — مدیریت و مسدودسازی
    case 'USER_BLOCKED': return 'گفتگوی مستقیم بین این دو حساب مسدود است';
    case 'ACCOUNT_BLOCKED': return 'حساب شما مسدود شده است';
    case 'ADMIN_ONLY': return 'این بخش فقط برای مدیران است';
    case 'NETWORK': return e.message;
    default: return e.message || 'خطا در ارتباط با سرور';
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

// ————— گام ۷: اعلان بومی + badge —————
let chatListCache = []; // آخرین لیست گفتگوها برای عنوان اعلان و تپ

// ————— گام ۹: هوش مصنوعی —————
let aiBusy = false;

// ————— گام ۱۰: مسدودسازی و پنل مدیریت —————
let blockedByMe = new Set(); // userIdهایی که من مسدود کرده‌ام
let adminTab = 'metrics';
let peerMenuConv = null; // گفتگوی باز در منوی گزینه‌ها

/** اجرای عملیات AI با مدیریت رضایت — در 403، پرسش فعال‌سازی و تلاش دوباره */
async function runAi(fn) {
  if (aiBusy) return null;
  aiBusy = true;
  try {
    return await fn();
  } catch (e) {
    if (e?.code === 'AI_CONSENT_REQUIRED') {
      if (confirm(
        'برای قابلیت‌های هوشمند باید رضایت دهید.\nمحتوای گفتگو فقط با رضایت شما به سرویس هوش مصنوعی ارسال می‌شود؛ پیام‌های رمزنگاری‌شده هرگز استفاده نمی‌شوند.\n\nفعال شود؟',
      )) {
        await apiCall('/ai/consent', {
          method: 'PATCH', token: session.accessToken, body: { enabled: true },
        });
        return await fn();
      }
      return null;
    }
    alert(faError(e));
    return null;
  } finally {
    aiBusy = false;
  }
}

function showAiModal(title, text) {
  $('aiModalTitle').textContent = title;
  $('aiModalText').textContent = text;
  $('aiModal').classList.remove('hidden');
}
$('aiModalClose').onclick = () => $('aiModal').classList.add('hidden');

/** منوی ✨ — سه عمل + بستن، در همان نوار چیپ */
function showAiMenu() {
  const box = $('aiChips');
  box.innerHTML = '';
  const mk = (label, fn) => {
    const b = document.createElement('button');
    b.className = 'ai-chip';
    b.textContent = label;
    b.onclick = () => { box.classList.add('hidden'); void fn(); };
    return b;
  };
  box.appendChild(mk('✨ پیشنهاد پاسخ', aiSuggest));
  box.appendChild(mk('🧾 خلاصهٔ گفتگو', aiSummarize));
  box.appendChild(mk('🌐 ترجمهٔ آخرین پیام', aiTranslateLast));
  const close = document.createElement('button');
  close.className = 'ai-chip ai-chip-close';
  close.textContent = '✕';
  close.onclick = () => box.classList.add('hidden');
  box.appendChild(close);
  box.classList.remove('hidden');
}
$('aiMenuBtn').onclick = showAiMenu;

async function aiSuggest() {
  if (!currentConv) return;
  await runAi(async () => {
    const r = await apiCall('/ai/suggest', {
      method: 'POST', token: session.accessToken,
      body: { conversationId: currentConv.id, count: 3 },
    });
    const lines = String(r.text ?? '').split('\n').filter((l) => l.trim());
    if (!lines.length) return;
    const box = $('aiChips');
    box.innerHTML = '';
    for (const line of lines) {
      const b = document.createElement('button');
      b.className = 'ai-chip';
      b.title = line;
      b.textContent = line;
      b.onclick = () => {
        $('msgInput').value = line.replace(/^پیشنهاد \d+[^:]*: /, '').trim();
        box.classList.add('hidden');
        $('msgInput').focus();
      };
      box.appendChild(b);
    }
    const close = document.createElement('button');
    close.className = 'ai-chip ai-chip-close';
    close.textContent = '✕';
    close.onclick = () => box.classList.add('hidden');
    box.appendChild(close);
    box.classList.remove('hidden');
  });
}

async function aiSummarize() {
  if (!currentConv) return;
  await runAi(async () => {
    const r = await apiCall('/ai/summarize', {
      method: 'POST', token: session.accessToken,
      body: { conversationId: currentConv.id, limit: 20 },
    });
    showAiModal('خلاصهٔ گفتگو', r.text);
  });
}

/** ترجمهٔ یک پیام — با دوبار کلیک روی پیام یا «ترجمهٔ آخرین پیام» منو */
function aiTranslateMessage(m) {
  if (!m || m.isE2ee) {
    if (m?.isE2ee) alert('پیام‌های رمزنگاری‌شدهٔ سرتاسری قابل ترجمه نیستند');
    return;
  }
  void runAi(async () => {
    const r = await apiCall('/ai/translate', {
      method: 'POST', token: session.accessToken, body: { messageId: m.id },
    });
    showAiModal('ترجمه', `${r.text}\n\n— متن اصلی: ${m.body}`);
  });
}

function aiTranslateLast() {
  const last = [...localMessages].reverse().find((m) => m.senderId !== session.user.id && m.body && !m.isE2ee);
  if (!last) {
    alert('پیام قابل‌ترجمه‌ای از طرف مقابل نیست');
    return;
  }
  aiTranslateMessage(last);
}

/** پروفایل: وضعیت + رضایت AI */
async function refreshAiProfile() {
  try {
    const s = await apiCall('/ai/status', { token: session.accessToken });
    $('aiStatusVal').textContent = s.available
      ? `${s.provider} — رضایت: ${s.globalConsent ? 'داده شده ✓' : 'داده نشده'}`
      : 'غیرفعال (بدون provider)';
    const btn = $('aiConsentToggle');
    btn.classList.remove('hidden');
    btn.textContent = s.globalConsent ? 'لغو رضایت هوش مصنوعی' : 'دادن رضایت هوش مصنوعی';
    btn.onclick = async () => {
      try {
        await apiCall('/ai/consent', {
          method: 'PATCH', token: session.accessToken, body: { enabled: !s.globalConsent },
        });
        void refreshAiProfile();
      } catch (e) {
        alert(faError(e));
      }
    };
  } catch {
    $('aiStatusVal').textContent = 'نامشخص';
    $('aiConsentToggle').classList.add('hidden');
  }
}

function updateBadge() {
  const total = chatListCache.reduce((s, c) => s + (c.unreadCount ?? 0), 0);
  window.delDesktop?.setBadge(total);
}

function notifyDesktop({ title, body, conversationId, kind }) {
  if (!window.delDesktop) return;
  if (document.hasFocus()) return; // پنجره جلو است — اعلان لازم نیست
  window.delDesktop.notify({ title, body, conversationId, kind });
}

function convDisplayName(c) {
  return c?.type === 'group'
    ? c.title ?? 'گروه'
    : c?.peer?.displayName ?? c?.peer?.phone ?? 'پیام جدید';
}

window.delDesktop?.onNotifyClick((data) => {
  if (!data?.conversationId) return;
  const conv = chatListCache.find((c) => c.id === data.conversationId);
  if (conv) openChat(conv);
});

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
    void e2eeInit(session.accessToken, session.user.id); // گام ۸
    $('goAdmin').classList.toggle('hidden', session.user?.role !== 'admin'); // گام ۱۰
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
    // گام ۷: رفرش لیست هم — badge چنددستگاهی به‌روز شود
    void renderChatList();
    if (currentConv) {
      socket.emit('conversation.join', { conversationId: currentConv.id });
      const realSeqs = localMessages.map((m) => m.serverSeq).filter((s) => s < Number.MAX_SAFE_INTEGER);
      const maxSeq = realSeqs.length ? Math.max(...realSeqs) : 0;
      if (maxSeq > 0) {
        void apiCall(`/conversations/${currentConv.id}/messages?since=${maxSeq}`, { token: session.accessToken })
          .then(async (page) => {
            for (const m of page.messages ?? []) {
              if (e2eeIsEcho(m)) continue;
              upsertMessage(await e2eeTryDecrypt(session.accessToken, m));
            }
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
      void (async () => {
        // گام ۸: echo خودِ این دستگاه متن موضعی را حفظ می‌کند؛ پیام رمز باز می‌شود
        if (e2eeIsEcho(message)) {
          const known = localMessages.find((x) => x.clientMsgId === message.clientMsgId);
          upsertMessage({ ...message, body: known?.body ?? message.body });
        } else {
          upsertMessage(await e2eeTryDecrypt(session.accessToken, message));
        }
      })();
      void apiCall(`/conversations/${conversationId}/read`, {
        method: 'POST', token: session.accessToken, body: { lastReadSeq: message.serverSeq },
      }).catch(() => {});
    } else if (message.senderId !== session.user.id) {
      // گام ۷: پنجره فوکوس ندارد → اعلان بومی
      notifyDesktop({
        title: convDisplayName(chatListCache.find((c) => c.id === conversationId)),
        body: message.isE2ee ? '🔒 پیام رمزنگاری‌شده' : (message.body?.trim() ? message.body : 'پیام رسانه‌ای'),
        conversationId,
        kind: 'message',
      });
    }
    // پیش‌نمایش/شمارنده لیست هم به‌روز شود
    void renderChatList();
  });
  // گام ۱۰: مسدودسازی حساب توسط ادمین — بلافاصله خروج
  socket.on('account.blocked', () => {
    alert('حساب شما توسط پشتیبانی مسدود شده است.');
    $('logout').click();
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
    // گام ۷: اگر پنجره فوکوس ندارد، اعلان تماس هم بزن
    notifyDesktop({
      title: call.peerName,
      body: p.call.kind === 'video' ? '📞 تماس تصویری ورودی' : '📞 تماس صوتی ورودی',
      conversationId: p.call.conversationId,
      kind: 'call',
    });
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
    chatListCache = convs;
    updateBadge(); // گام ۷: badge آیکون اپ
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
      row.querySelector('.chat-name').textContent = (!isGroup && e2eeIdentity ? '🔒 ' : '') + name;
      row.querySelector('.chat-preview').textContent = isGroup
        ? `${faDigits(c.memberCount ?? 0)} عضو${c.lastMessage ? ` · ${c.lastMessage.body}` : ''}`
        : c.lastMessage?.body ?? 'بدون پیام';
      row.onclick = () => openChat(c);
      listEl.appendChild(row);
    }
    updateE2eeBanner();
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
let e2eeActiveConv = false; // گام ۸: گفتگوی فعلی رمزنگاری‌شده است؟

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
  e2eeActiveConv = false;
  const baseName = isGroupChat
    ? conv.title ?? 'گروه'
    : conv.peer?.displayName ?? conv.peer?.phone ?? 'گفتگو';
  $('chatTitle').textContent = baseName;
  $('chatStatus').innerHTML = '&nbsp;';
  $('msgList').innerHTML = '';
  $('msgInput').value = '';
  $('aiChips').classList.add('hidden'); // گام ۹ — پاک‌سازی چیپ‌های گفتگوی قبلی
  show('chat');
  $('msgInput').focus();
  // گام ۶: دکمه‌های تماس فقط در گفتگوهای ۱:۱
  const direct = conv.type !== 'group';
  $('callAudio').classList.toggle('hidden', !direct);
  $('callVideo').classList.toggle('hidden', !direct);
  // گام ۱۰: منوی گزینه‌ها فقط در گفتگوی خصوصی
  $('peerMenuBtn').classList.toggle('hidden', !direct);
  void refreshBlockedByMe();
  if (isGroupChat) void refreshGroupDetail();
  // گام ۸: اگر هر دو طرف هویت دارند ← این گفتگو رمز می‌شود
  if (direct && currentPeerId && e2eeReadyLocal()) {
    void e2eePeerSupports(session.accessToken, currentPeerId).then((ok) => {
      e2eeActiveConv = ok;
      if (ok) {
        $('chatTitle').textContent = `🔒 ${baseName}`;
        void e2eeTopUp(session.accessToken);
      }
    });
  }
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
    // گام ۸: پیام‌های رمز به ترتیب صعودی باز می‌شوند
    const decrypted = [];
    for (const m of page.messages) decrypted.push(await e2eeTryDecrypt(session.accessToken, m));
    localMessages = before ? [...decrypted, ...localMessages] : decrypted;
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
      // گام ۹: دوبار کلیک روی پیام طرف مقابل (غیررمز) → ترجمه
      if (!mine && !m.isE2ee) {
        body.title = 'دوبار کلیک: ترجمه ✨';
        body.classList.add('msg-body-ai');
        body.ondblclick = () => aiTranslateMessage(m);
      }
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

  // گام ۸: گفتگوی خصوصی با هویت هر دو طرف ← پاکت multi-device
  if (!isGroupChat && e2eeActiveConv && currentPeerId) {
    void (async () => {
      try {
        const envelope = await e2eeEncryptDirect(session.accessToken, currentConv.id, currentPeerId, body);
        const sendRest = async () => {
          const r = await apiCall(`/conversations/${currentConv.id}/messages`, {
            method: 'POST', token: session.accessToken, body: { clientMsgId, body: envelope, isE2ee: true },
          });
          upsertMessage({ ...r.message, body });
        };
        if (socket?.connected) {
          socket.timeout(15000).emit(
            'message.send',
            { conversationId: currentConv.id, clientMsgId, body: envelope, isE2ee: true },
            (err, ack) => {
              if (!err && ack?.ok && ack.message) upsertMessage({ ...ack.message, body });
              else void sendRest();
            },
          );
        } else {
          void sendRest();
        }
      } catch {
        alert('رمزگذاری پیام ناموفق بود — دوباره تلاش کنید.');
      }
    })();
    return;
  }

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
  // گام ۸: وضعیت رمزنگاری + کلید بازیابی
  const active = e2eeReadyLocal();
  $('e2eeStatus').textContent = active ? '🔒 فعال (X3DH + Double Ratchet)' : 'غیرفعال';
  $('showRecovery').classList.toggle('hidden', !e2eeStoreLocal.recovery());
  void refreshAiProfile(); // گام ۹
  show('profile');
  void checkHealth();
};
$('showRecovery').onclick = () => {
  const key = e2eeStoreLocal.recovery();
  if (key) alert(`کلید بازیابی شما:\n\n${key}\n\nآن را جایی امن نگه دارید.`);
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
  if (session) await apiCall('/devices/push-token', { method: 'DELETE', token: session.accessToken }).catch(() => {}); // گام ۷
  store.del('refreshToken');
  window.delDesktop?.setBadge(0);
  endCallLocal(null);
  socket?.disconnect();
  socket = null;
  session = null;
  show('phone');
};

// ————— گام ۸: رمزنگاری سرتاسری — موتور روی window.DelE2ee —————

const E2 = () => window.DelE2ee;
const e2eeRng = (n) => {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
};

// ————— ذخیره‌سازی localStorage —————
const e2eeStoreLocal = {
  identity: () => { try { return JSON.parse(store.get('e2ee.identity') ?? 'null'); } catch { return null; } },
  setIdentity: (id) => store.set('e2ee.identity', JSON.stringify(id)),
  recovery: () => store.get('e2ee.recovery'),
  setRecovery: (k) => store.set('e2ee.recovery', k),
  otks: () => { try { return JSON.parse(store.get('e2ee.otks') ?? '{"privs":{},"nextKeyId":1}'); } catch { return { privs: {}, nextKeyId: 1 }; } },
  setOtks: (o) => store.set('e2ee.otks', JSON.stringify(o)),
  consumeOtkPriv: (keyId) => {
    const o = e2eeStoreLocal.otks();
    const priv = o.privs[String(keyId)] ?? null;
    if (priv) { delete o.privs[String(keyId)]; e2eeStoreLocal.setOtks(o); }
    return priv;
  },
  sessions: (peerUserId) => { try { return JSON.parse(store.get(`e2ee.s.${peerUserId}`) ?? '{}'); } catch { return {}; } },
  saveSession: (peerUserId, st) => {
    const all = e2eeStoreLocal.sessions(peerUserId);
    all[st.peerDeviceId] = st;
    store.set(`e2ee.s.${peerUserId}`, JSON.stringify(all));
  },
};

// ————— وضعیت —————
let e2eeIdentity = null;
let e2eeDeviceId = null;

function e2eeReadyLocal() {
  return Boolean(e2eeIdentity && e2eeDeviceId && E2());
}

/** پس از ورود: شناسه دستگاه + هویت محلی */
async function e2eeInit(token, userId) {
  if (!E2()) return;
  E2().setRng(e2eeRng);
  try {
    const me = await apiCall('/auth/me', { token });
    e2eeDeviceId = me.deviceId ?? null;
  } catch { e2eeDeviceId = null; }
  e2eeIdentity = e2eeStoreLocal.identity();
  void userId;
  updateE2eeBanner();
}

function updateE2eeBanner() {
  const banner = $('e2eeBanner');
  if (!banner) return;
  banner.classList.toggle('hidden', Boolean(e2eeIdentity ?? e2eeStoreLocal.identity()));
}

/** آپلود هویت + دسته اولیه OTK */
async function e2eePublish(token) {
  if (!e2eeIdentity) throw new Error('E2EE_NO_IDENTITY');
  const batch = e2eeMakeOtks(40);
  await apiCall('/e2ee/identity', {
    method: 'POST',
    token,
    body: {
      ikEd: e2eeIdentity.ikEd.pub,
      ikX: e2eeIdentity.ikX.pub,
      spkKeyId: e2eeIdentity.spk.keyId,
      spk: e2eeIdentity.spk.pub,
      spkSig: e2eeIdentity.spk.sig,
      otks: batch.map((o) => ({ keyId: o.keyId, key: o.pub })),
    },
  });
}

function e2eeMakeOtks(count) {
  const st = e2eeStoreLocal.otks();
  const batch = E2().makeOtkBatch(e2eeRng, count, st.nextKeyId);
  for (const o of batch) st.privs[String(o.keyId)] = o.priv;
  st.nextKeyId += count;
  e2eeStoreLocal.setOtks(st);
  return batch;
}

/** پر کردن مجدد OTK اگر کم شده */
async function e2eeTopUp(token) {
  if (!e2eeReadyLocal()) return;
  try {
    const devices = await apiCall(`/e2ee/devices/${session.user.id}`, { token });
    const mine = devices.find((d) => d.deviceId === e2eeDeviceId);
    if (mine && mine.otkCount < 10) {
      const batch = e2eeMakeOtks(40);
      await apiCall('/e2ee/otks', { method: 'POST', token, body: { otks: batch.map((o) => ({ keyId: o.keyId, key: o.pub })) } });
    }
  } catch { /* بی‌اهمیت */ }
}

async function e2eePeerSupports(token, peerUserId) {
  try {
    const devices = await apiCall(`/e2ee/devices/${peerUserId}`, { token });
    return devices.length > 0;
  } catch { return false; }
}

/** راه‌اندازی تازه — کلید بازیابی برمی‌گردد */
async function e2eeSetupNew(token) {
  e2eeIdentity = E2().generateIdentity(e2eeRng);
  e2eeStoreLocal.setIdentity(e2eeIdentity);
  await e2eePublish(token);
  const recoveryKey = E2().generateRecoveryKey();
  const backup = E2().createBackup(e2eeIdentity, E2().parseRecoveryKey(recoveryKey));
  await apiCall('/e2ee/backup', { method: 'PUT', token, body: backup });
  e2eeStoreLocal.setRecovery(recoveryKey);
  return recoveryKey;
}

/** بازیابی هویت با کلید بازیابی */
async function e2eeRestore(token, recoveryDisplay) {
  const backup = await apiCall('/e2ee/backup', { token });
  const restored = E2().restoreBackup(backup.blob, backup.salt, E2().parseRecoveryKey(recoveryDisplay));
  e2eeIdentity = E2().identityFromPrivate(restored.ikEdPriv, restored.ikXPriv, e2eeRng);
  e2eeStoreLocal.setIdentity(e2eeIdentity);
  await e2eePublish(token);
  const blob = E2().createBackup(e2eeIdentity, E2().parseRecoveryKey(recoveryDisplay));
  await apiCall('/e2ee/backup', { method: 'PUT', token, body: blob });
  e2eeStoreLocal.setRecovery(recoveryDisplay.trim());
}

// ————— رمز کردن / باز کردن —————

async function e2eeEncryptTo(token, conversationId, peerUserId, bundle, plaintext) {
  const sessions = e2eeStoreLocal.sessions(peerUserId);
  const saved = sessions[bundle.deviceId];
  const sessionObj = saved ? E2().DelSession.load(saved) : E2().DelSession.initiate(e2eeIdentity, peerUserId, bundle, e2eeRng);
  const ad = E2().DelSession.ad(conversationId, e2eeDeviceId, bundle.deviceId);
  const entry = sessionObj.encrypt(plaintext, ad);
  e2eeStoreLocal.saveSession(peerUserId, sessionObj.serialize());
  return { deviceId: bundle.deviceId, from: e2eeDeviceId, ...(entry.pm ? { pm: entry.pm } : {}), ct: entry.ct };
}

async function e2eeEncryptDirect(token, conversationId, peerUserId, plaintext) {
  if (!e2eeReadyLocal()) throw new Error('E2EE_NOT_READY');
  const [peerBundles, myDevices] = await Promise.all([
    apiCall(`/e2ee/bundle/${peerUserId}`, { token }),
    apiCall(`/e2ee/devices/${session.user.id}`, { token }),
  ]);
  const entries = [];
  for (const b of peerBundles.bundles ?? []) {
    entries.push(await e2eeEncryptTo(token, conversationId, peerUserId, b, plaintext));
  }
  for (const dev of myDevices) {
    if (dev.deviceId === e2eeDeviceId) continue;
    entries.push(await e2eeEncryptTo(token, conversationId, session.user.id, {
      deviceId: dev.deviceId, ikEd: dev.ikEd, ikX: dev.ikX,
      spkKeyId: dev.spkKeyId, spk: dev.spk, spkSig: dev.spkSig, otk: null,
    }, plaintext));
  }
  if (!entries.length) throw new Error('E2EE_NO_RECIPIENTS');
  return JSON.stringify(E2().buildEnvelope(entries, e2eeDeviceId));
}

/** خروجی: { ok, text } — ok=false یعنی این دستگاه گیرنده نبود یا session نیست */
async function e2eeDecryptDirect(token, conversationId, senderId, body) {
  if (!e2eeReadyLocal()) return { ok: false };
  const envelope = E2().isE2eeEnvelope(body);
  if (!envelope) return { ok: false };
  const entry = (envelope.to ?? []).find((e) => e.deviceId === e2eeDeviceId);
  if (!entry) return { ok: false };
  const ad = E2().DelSession.ad(conversationId, entry.from, e2eeDeviceId);
  const sessions = e2eeStoreLocal.sessions(senderId);
  const saved = sessions[entry.from];
  if (saved) {
    try {
      const sessionObj = E2().DelSession.load(saved);
      const text = sessionObj.decrypt({ ct: entry.ct }, ad);
      e2eeStoreLocal.saveSession(senderId, sessionObj.serialize());
      return { ok: true, text };
    } catch { /* ادامه با pm */ }
  }
  if (entry.pm) {
    try {
      const otkPriv = entry.pm.otkKeyId != null ? e2eeStoreLocal.consumeOtkPriv(entry.pm.otkKeyId) : null;
      const sessionObj = E2().DelSession.accept(e2eeIdentity, senderId, entry.from, entry.pm, otkPriv ? E2().fromB64(otkPriv) : null);
      const text = sessionObj.decrypt({ ct: entry.ct }, ad);
      e2eeStoreLocal.saveSession(senderId, sessionObj.serialize());
      void e2eeTopUp(token);
      return { ok: true, text };
    } catch { return { ok: false }; }
  }
  return { ok: false };
}

/** پیام E2EE → متن یا placeholder */
async function e2eeTryDecrypt(token, m) {
  if (!m.isE2ee) return m;
  try {
    const r = await e2eeDecryptDirect(token, m.conversationId, m.senderId, m.body);
    if (r.ok) return { ...m, body: r.text };
  } catch { /* پایین‌تر */ }
  return {
    ...m,
    body: m.senderId === session.user.id
      ? '🔒 پیام شما از دستگاه دیگر — در این دستگاه باز نمی‌شود'
      : '🔒 پیام رمزنگاری‌شده — در این دستگاه باز نمی‌شود',
  };
}

/** آیا این پیام خودِ این دستگاه بوده؟ (echo) */
function e2eeIsEcho(m) {
  return localMessages.some((x) => x.clientMsgId === m.clientMsgId);
}

// ————— مودال E2EE —————
function e2eeOpenModal(step) {
  $('e2eeStepChoose').classList.toggle('hidden', step !== 'choose');
  $('e2eeStepShowKey').classList.toggle('hidden', step !== 'show-key');
  $('e2eeStepRestore').classList.toggle('hidden', step !== 'restore');
  $('e2eeModal').classList.remove('hidden');
}
$('e2eeBanner').onclick = async () => {
  $('e2eeChooseError').textContent = '';
  try {
    await apiCall('/e2ee/backup', { token: session.accessToken });
    $('e2eeRestoreStep').classList.remove('hidden');
  } catch {
    $('e2eeRestoreStep').classList.add('hidden');
  }
  e2eeOpenModal('choose');
};
$('e2eeClose').onclick = () => $('e2eeModal').classList.add('hidden');
$('e2eeNew').onclick = async () => {
  const btn = $('e2eeNew');
  btn.disabled = true; btn.textContent = 'در حال ساخت کلیدها…';
  $('e2eeChooseError').textContent = '';
  try {
    const key = await e2eeSetupNew(session.accessToken);
    $('e2eeRecoveryKey').textContent = key;
    e2eeOpenModal('show-key');
    updateE2eeBanner();
  } catch (e) {
    $('e2eeChooseError').textContent = faError(e);
  } finally {
    btn.disabled = false; btn.textContent = 'راه‌اندازی تازه — کلید بازیابی جدید';
  }
};
$('e2eeSaved').onclick = () => {
  $('e2eeModal').classList.add('hidden');
  alert('رمزنگاری سرتاسری فعال شد — پیام‌های خصوصی از این پس رمز می‌شوند.');
};
$('e2eeRestoreStep').onclick = () => e2eeOpenModal('restore');
$('e2eeRestoreCancel').onclick = () => $('e2eeModal').classList.add('hidden');
$('e2eeRestoreGo').onclick = async () => {
  const btn = $('e2eeRestoreGo');
  btn.disabled = true; btn.textContent = 'در حال بازیابی…';
  $('e2eeRestoreError').textContent = '';
  try {
    await e2eeRestore(session.accessToken, $('e2eeRecoveryInput').value);
    $('e2eeModal').classList.add('hidden');
    alert('هویت رمزنگاری بازگردانده شد — پیام‌های جدید رمزنگاری می‌شوند.');
    updateE2eeBanner();
  } catch (e) {
    $('e2eeRestoreError').textContent =
      e.code === 'E2EE_BACKUP_MISSING' ? 'پشتیبانی روی سرور نیست — راه‌اندازی تازه را انتخاب کنید' : 'کلید بازیابی اشتباه است';
  } finally {
    btn.disabled = false; btn.textContent = 'بازیابی';
  }
};

// ————— بوت: بازیابی نشست با refresh token —————
(async () => {
  const rt = store.get('refreshToken');
  if (!rt) return;
  try {
    session = await apiCall('/auth/refresh', { method: 'POST', body: { refreshToken: rt } });
    store.set('refreshToken', session.refreshToken);
    connectWs(session.accessToken);
    void e2eeInit(session.accessToken, session.user.id); // گام ۸
    $('goAdmin').classList.toggle('hidden', session.user?.role !== 'admin'); // گام ۱۰
    enterChats();
  } catch {
    store.del('refreshToken');
  }
})();

// ————— گام ۱۰: مسدودسازی و گزارش کاربر + پنل مدیریت —————

async function refreshBlockedByMe() {
  try {
    const r = await apiCall('/users/me/blocks', { token: session.accessToken });
    blockedByMe = new Set((r.items ?? []).map((b) => b.userId));
  } catch { /* غیرحیاتی */ }
}

function peerDisplayName() {
  return currentConv?.peer?.displayName ?? currentConv?.peer?.phone ?? 'کاربر';
}

// — منوی گزینه‌های گفتگوی خصوصی —
$('peerMenuBtn').onclick = async () => {
  if (!currentConv || isGroupChat || !currentPeerId) return;
  peerMenuConv = currentConv;
  $('peerMenuTitle').textContent = 'گزینه‌های گفتگو';
  $('peerMenuPeer').textContent = peerDisplayName();
  await refreshBlockedByMe();
  const blocked = blockedByMe.has(currentPeerId);
  const btn = $('peerBlockToggle');
  btn.textContent = blocked ? 'رفع مسدودسازی کاربر' : 'مسدودسازی کاربر';
  btn.className = blocked ? 'ghost' : 'danger';
  $('peerMenuModal').classList.remove('hidden');
};
$('peerMenuClose').onclick = () => $('peerMenuModal').classList.add('hidden');

$('peerBlockToggle').onclick = async () => {
  if (!currentPeerId) return;
  const blocked = blockedByMe.has(currentPeerId);
  try {
    if (blocked) {
      await apiCall(`/users/${currentPeerId}/block`, { method: 'DELETE', token: session.accessToken });
      blockedByMe.delete(currentPeerId);
      alert('مسدودسازی برداشته شد — گفتگوی مستقیم آزاد شد.');
    } else {
      await apiCall(`/users/${currentPeerId}/block`, { method: 'POST', token: session.accessToken });
      blockedByMe.add(currentPeerId);
      alert('کاربر مسدود شد — گفتگوی مستقیم دوطرفه بسته شد.');
    }
    $('peerMenuModal').classList.add('hidden');
  } catch (e) {
    alert(faError(e));
  }
};

$('peerReportOpen').onclick = () => {
  $('peerMenuModal').classList.add('hidden');
  $('reportError').textContent = '';
  $('reportNote').value = '';
  $('reportModal').classList.remove('hidden');
};
$('reportCancel').onclick = () => $('reportModal').classList.add('hidden');
$('reportSend').onclick = async () => {
  const btn = $('reportSend');
  btn.disabled = true;
  try {
    await apiCall(`/users/${currentPeerId}/report`, {
      method: 'POST',
      token: session.accessToken,
      body: { reason: $('reportReason').value, note: $('reportNote').value.trim() || undefined },
    });
    $('reportModal').classList.add('hidden');
    alert('گزارش شما ثبت شد و به صف رسیدگی مدیران رفت. سپاس از همکاری شما.');
  } catch (e) {
    $('reportError').textContent = faError(e);
  } finally {
    btn.disabled = false;
  }
};

// ————— پنل مدیریت —————
const faDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' }) +
      ' ' + new Date(iso).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
};
const faNum = (n) => faDigits(String(n ?? 0));
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('goAdmin').onclick = () => { adminTab = 'metrics'; show('admin'); renderAdminTab(); };
$('adminBack').onclick = () => show('chats');
$('adminTabMetrics').onclick = () => { adminTab = 'metrics'; renderAdminTab(); };
$('adminTabUsers').onclick = () => { adminTab = 'users'; renderAdminTab(); };
$('adminTabReports').onclick = () => { adminTab = 'reports'; renderAdminTab(); };
$('adminTabAudit').onclick = () => { adminTab = 'audit'; renderAdminTab(); };

function renderAdminTab() {
  ['metrics', 'users', 'reports', 'audit'].forEach((t) => {
    $('adminTab' + t[0].toUpperCase() + t.slice(1)).classList.toggle('active', adminTab === t);
  });
  const box = $('adminContent');
  box.innerHTML = '<p class="sub">در حال بارگذاری…</p>';
  if (adminTab === 'metrics') void loadAdminMetrics(box);
  if (adminTab === 'users') void loadAdminUsers(box, '');
  if (adminTab === 'reports') void loadAdminReports(box, 'open');
  if (adminTab === 'audit') void loadAdminAudit(box);
}

async function loadAdminMetrics(box) {
  try {
    const m = await apiCall('/admin/metrics', { token: session.accessToken });
    const card = (label, value, accent) => `
      <div class="admin-card ${accent ? 'accent' : ''}">
        <div class="admin-card-value">${esc(value)}</div>
        <div class="admin-card-label">${esc(label)}</div>
      </div>`;
    box.innerHTML = `
      <div class="admin-grid">
        ${card('کاربران', faNum(m.users.total))}
        ${card('مدیران', faNum(m.users.admins))}
        ${card('مسدودشده', faNum(m.users.blocked), m.users.blocked > 0)}
        ${card('آنلاین همین حالا', faNum(m.onlineNow), true)}
        ${card('گفتگوها', faNum(m.conversations.total))}
        ${card('گروه‌ها', faNum(m.conversations.group))}
        ${card('پیام‌ها', faNum(m.messages.total))}
        ${card('پیام ۲۴ ساعت', faNum(m.messages.last24h))}
        ${card('رسانه‌ها', faNum(m.media.total))}
        ${card('تماس‌ها', faNum(m.calls.total))}
        ${card('گزارش باز', faNum(m.reports.open), m.reports.open > 0)}
        ${card('کل گزارش‌ها', faNum(m.reports.total))}
      </div>`;
  } catch (e) {
    box.innerHTML = `<p class="error">${faError(e)}</p>`;
  }
}

async function loadAdminUsers(box, q) {
  try {
    const page = await apiCall(`/admin/users?pageSize=50${q ? `&q=${encodeURIComponent(q)}` : ''}`, { token: session.accessToken });
    box.innerHTML = `
      <input id="adminUserSearch" type="text" placeholder="جست‌وجو با شماره یا نام…" dir="rtl" />
      <div class="admin-table">
        <div class="admin-tr admin-th"><span>کاربر</span><span>نقش</span><span>آمار</span><span>وضعیت</span><span></span></div>
        ${page.items.map((u) => `
          <div class="admin-tr" data-uid="${u.id}">
            <span class="admin-user"><b>${esc(u.displayName ?? 'بدون نام')}</b><i dir="ltr">${esc(u.phone)}</i></span>
            <span>${u.role === 'admin' ? '<b class="tag-admin">مدیر</b>' : 'کاربر'}</span>
            <span class="admin-stats">${faNum(u.stats.conversations)} گفتگو · ${faNum(u.stats.messages)} پیام · ${faNum(u.stats.reportsAgainst)} گزارش</span>
            <span>${u.blockedAt ? '<b class="tag-blocked">مسدود</b>' : `<span class="muted">${faDate(u.lastSeenAt)}</span>`}</span>
            <span>${u.role === 'admin' ? '' : `<button class="${u.blockedAt ? 'ghost' : 'danger'} small-btn" data-act="${u.blockedAt ? 'unblock' : 'block'}">${u.blockedAt ? 'رفع مسدودی' : 'مسدودسازی'}</button>`}</span>
          </div>`).join('')}
      </div>
      <p class="sub">مجموع: ${faNum(page.total)} کاربر</p>`;
    $('adminUserSearch').value = q;
    $('adminUserSearch').onkeydown = (ev) => { if (ev.key === 'Enter') void loadAdminUsers(box, $('adminUserSearch').value.trim()); };
    box.querySelectorAll('button[data-act]').forEach((b) => {
      b.onclick = async () => {
        const uid = b.closest('[data-uid]').dataset.uid;
        const act = b.dataset.act;
        if (act === 'block' && !confirm('این کاربر مسدود شود؟ همه نشست‌هایش بلافاصله بسته می‌شود.')) return;
        b.disabled = true;
        try {
          await apiCall(`/admin/users/${uid}/${act}`, {
            method: 'POST', token: session.accessToken,
            body: act === 'block' ? { reason: 'از پنل مدیریت' } : {},
          });
          void loadAdminUsers(box, $('adminUserSearch').value.trim());
        } catch (e) {
          alert(faError(e));
          b.disabled = false;
        }
      };
    });
  } catch (e) {
    box.innerHTML = `<p class="error">${faError(e)}</p>`;
  }
}

async function loadAdminReports(box, status) {
  try {
    const page = await apiCall(`/admin/reports?pageSize=50${status ? `&status=${status}` : ''}`, { token: session.accessToken });
    const reasonFa = { spam: 'هرزنامه', abuse: 'آزار', impersonation: 'جعل هویت', other: 'سایر' };
    box.innerHTML = `
      <div class="admin-filter">
        <button class="ghost small-btn ${status === 'open' ? '' : 'active'}" data-f="open">باز</button>
        <button class="ghost small-btn" data-f="">همه</button>
      </div>
      <div class="admin-table">
        ${page.items.map((r) => `
          <div class="admin-report" data-rid="${r.id}">
            <div class="admin-report-head">
              <b>${reasonFa[r.reason] ?? esc(r.reason)}</b>
              <span class="muted">از ${esc(r.reporter.displayName ?? r.reporter.phone)} علیه ${esc(r.reported.displayName ?? r.reported.phone)}</span>
              <span class="tag-${r.status === 'open' ? 'open' : r.status}">${r.status === 'open' ? 'باز' : r.status === 'resolved' ? 'رسیدگی شد' : 'رد شد'}</span>
            </div>
            ${r.note ? `<div class="admin-report-note">«${esc(r.note)}»</div>` : ''}
            ${r.status === 'open'
              ? `<div class="admin-report-actions">
                   <button class="primary small-btn" data-act="resolve">رسیدگی (تأیید تخلف)</button>
                   <button class="ghost small-btn" data-act="dismiss">رد گزارش</button>
                 </div>`
              : `<div class="muted admin-report-actions">${r.resolution ? 'یادداشت: ' + esc(r.resolution) : ''} ${faDate(r.handledAt)}</div>`}
          </div>`).join('') || '<p class="sub">گزارشی نیست.</p>'}
      </div>`;
    box.querySelectorAll('.admin-filter button').forEach((b) => {
      b.onclick = () => loadAdminReports(box, b.dataset.f || undefined);
    });
    box.querySelectorAll('button[data-act]').forEach((b) => {
      b.onclick = async () => {
        const rid = b.closest('[data-rid]').dataset.rid;
        b.disabled = true;
        try {
          await apiCall(`/admin/reports/${rid}/handle`, {
            method: 'POST', token: session.accessToken,
            body: { action: b.dataset.act },
          });
          void loadAdminReports(box, status);
        } catch (e) {
          alert(faError(e));
          b.disabled = false;
        }
      };
    });
  } catch (e) {
    box.innerHTML = `<p class="error">${faError(e)}</p>`;
  }
}

async function loadAdminAudit(box) {
  try {
    const r = await apiCall('/admin/audit?limit=100', { token: session.accessToken });
    const actionFa = {
      'user.block': 'مسدودسازی کاربر',
      'user.unblock': 'رفع مسدودی',
      'report.resolve': 'رسیدگی به گزارش',
      'report.dismiss': 'رد گزارش',
    };
    box.innerHTML = `
      <div class="admin-table">
        ${r.items.map((a) => `
          <div class="admin-tr audit">
            <span><b>${actionFa[a.action] ?? esc(a.action)}</b></span>
            <span class="muted">${esc(a.actorName ?? 'سیستم')}</span>
            <span class="muted">${faDate(a.createdAt)}</span>
          </div>`).join('') || '<p class="sub">دفتر خالی است.</p>'}
      </div>`;
  } catch (e) {
    box.innerHTML = `<p class="error">${faError(e)}</p>`;
  }
}
