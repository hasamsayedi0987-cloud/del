/**
 * Del Desktop — renderer logic (vanilla JS, RTL)
 */
const $ = (id) => document.getElementById(id);

const store = {
  get apiBase() { return localStorage.getItem('del.apiBase') || 'http://localhost:3000'; },
  set apiBase(v) { localStorage.setItem('del.apiBase', v.replace(/\/+$/, '')); },
  get: (k) => localStorage.getItem(`del.${k}`),
  set: (k, v) => localStorage.setItem(`del.${k}`, v),
  del: (k) => localStorage.removeItem(`del.${k}`),
};

/** فراخوانی API با مدیریت خطای استاندارد */
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
    throw { code: 'NETWORK', message: 'سرور در دسترس نیست — آدرس سرور را بررسی کنید' };
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw { code: data?.error?.code ?? 'UNKNOWN', message: data?.error?.message ?? 'خطای ناشناخته' };
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
    case 'NETWORK': return e.message;
    default: return 'خطا در ارتباط با سرور';
  }
};

const show = (name) => {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
};

let currentPhone = '';
let session = null; // { accessToken, refreshToken, user }

// ——— صحنه ۱: شماره
$('apiBase').value = store.apiBase;
$('sendOtp').onclick = async () => {
  $('phoneError').textContent = '';
  store.apiBase = $('apiBase').value.trim() || 'http://localhost:3000';
  const btn = $('sendOtp');
  btn.disabled = true; btn.textContent = 'در حال ارسال…';
  try {
    await apiCall('/auth/otp/request', { method: 'POST', body: { phone: $('phone').value.trim() } });
    currentPhone = $('phone').value.trim();
    $('otpHint').textContent = `کد ۶ رقمی برای ${currentPhone} ارسال شد`;
    show('otp');
    $('code').focus();
  } catch (e) {
    $('phoneError').textContent = faError(e);
  } finally {
    btn.disabled = false; btn.textContent = 'دریافت کد ورود';
  }
};

// ——— صحنه ۲: OTP
$('verify').onclick = async () => {
  $('otpError').textContent = '';
  const btn = $('verify');
  btn.disabled = true; btn.textContent = 'در حال بررسی…';
  try {
    session = await apiCall('/auth/otp/verify', {
      method: 'POST',
      body: {
        phone: currentPhone,
        code: $('code').value.trim(),
        platform: 'windows',
        deviceName: 'Del Desktop',
      },
    });
    store.set('refreshToken', session.refreshToken);
    enterHome(session.user);
  } catch (e) {
    $('otpError').textContent = faError(e);
  } finally {
    btn.disabled = false; btn.textContent = 'ورود به دل';
  }
};
$('backToPhone').onclick = () => show('phone');
$('code').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') $('verify').click(); });
$('phone').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') $('sendOtp').click(); });

// ——— صحنه ۳: خانه
function enterHome(user) {
  $('hello').textContent = `سلام ${user.displayName ?? 'کاربر'} 👋`;
  $('mePhone').textContent = user.phone;
  $('meName').textContent = user.displayName ?? '—';
  $('meId').textContent = user.id.slice(0, 8) + '…';
  $('displayName').value = user.displayName ?? '';
  show('home');
  checkHealth();
}

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
      token: session?.accessToken,
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
  session = null;
  show('phone');
};

// ——— بوت: اگر refresh token ذخیره شده، نشست را بازیابی کن
(async () => {
  const rt = store.get('refreshToken');
  if (!rt) return;
  try {
    session = await apiCall('/auth/refresh', { method: 'POST', body: { refreshToken: rt } });
    store.set('refreshToken', session.refreshToken);
    enterHome(session.user);
  } catch {
    store.del('refreshToken');
  }
})();
