/**
 * Del — تست دود گام ۱۰: مدیریت، گزارش/مسدودسازی، سخت‌سازی
 * پیش‌نیاز: سرور با ADMIN_PHONES="+989120000010" روی :3000 بالا باشد
 * اجرا:  node scripts/smoke-step10.js
 */
const { io } = require('socket.io-client');

const BASE = 'http://localhost:3000/api/v1';
const PASS = [];
const FAIL = [];

function check(name, cond, extra = '') {
  if (cond) {
    PASS.push(name);
    console.log(`  ✅ ${name}`);
  } else {
    FAIL.push(name);
    console.log(`  ❌ ${name} ${extra}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
}

function errCode(r) {
  return r.data?.error?.code ?? '(none)';
}

async function login(phone) {
  const req = await api('POST', '/auth/otp/request', { body: { phone } });
  const code = req.data.devCode;
  const verify = await api('POST', '/auth/otp/verify', {
    body: { phone, code, platform: 'android', deviceName: 'smoke10' },
  });
  if (verify.status !== 200) throw new Error(`login failed for ${phone}: ${JSON.stringify(verify.data)}`);
  return verify.data;
}

let uuidSeq = 0;
const uuid = () => `cccc10aa-0000-4000-8000-${String(++uuidSeq).padStart(12, '0')}`;

function connectWs(token) {
  return new Promise((resolve, reject) => {
    const s = io('http://localhost:3000', { auth: { token }, transports: ['websocket'] });
    const t = setTimeout(() => reject(new Error('ws connect timeout')), 8000);
    s.on('connect', () => { clearTimeout(t); resolve(s); });
    s.on('connect_error', (e) => { clearTimeout(t); reject(e); });
    s.on('account.blocked', () => { s.__blockedEvent = true; });
  });
}

function waitForEvent(socket, event, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, (p) => { clearTimeout(t); resolve(p); });
  });
}

async function main() {
  console.log('——— گام ۱۰: مدیریت، گزارش/مسدودسازی، سخت‌سازی ———\n');

  // ۱) ورود ادمین و سه کاربر عادی — شماره کاربران در هر اجرا یکتاست (بدون نشت دادهٔ اجرای قبل)
  const runTag = String(Date.now()).slice(-7);
  const phoneA = `+98913${runTag}1`;
  const phoneB = `+98913${runTag}2`;
  const phoneC = `+98913${runTag}3`;
  const admin = await login('+989120000010');
  check('ورود ادمین با ADMIN_PHONES → role=admin', admin.user?.role === 'admin', JSON.stringify(admin.user));
  const A = await login(phoneA);
  const B = await login(phoneB);
  const C = await login(phoneC);
  check('کاربر عادی → role=user', A.user?.role === 'user' && B.user?.role === 'user');

  // ۲) دسترسی پنل: کاربر عادی → 403 ADMIN_ONLY
  const deny = await api('GET', '/admin/users', { token: A.accessToken });
  check('GET /admin/users با کاربر عادی → 403 ADMIN_ONLY', deny.status === 403 && errCode(deny) === 'ADMIN_ONLY', `${deny.status}/${errCode(deny)}`);

  // ۳) فهرست و جست‌وجوی کاربران
  const list = await api('GET', '/admin/users?pageSize=100', { token: admin.accessToken });
  check('GET /admin/users با ادمین → 200 با آیتم', list.status === 200 && list.data.items.length >= 4);
  const search = await api('GET', `/admin/users?q=${encodeURIComponent(phoneB)}`, { token: admin.accessToken });
  check('جست‌وجوی کاربر با q → همان کاربر', search.data?.items?.length === 1 && search.data.items[0].id === B.user.id, `items=${search.data?.items?.length}`);
  const withStats = search.data.items[0];
  check('آمار کاربر (conversations/messages/devices) موجود', typeof withStats.stats?.messages === 'number');

  // ۴) گزارش سوءاستفاده — صف ادمین
  const rep1 = await api('POST', `/users/${B.user.id}/report`, {
    token: A.accessToken,
    body: { reason: 'spam', note: 'تبلیغ مزاحم' },
  });
  check('گزارش کاربر توسط A → 200 باز', rep1.status === 200 && rep1.data.report.status === 'open', JSON.stringify(rep1.data).slice(0, 120));
  const rep1b = await api('POST', `/users/${B.user.id}/report`, { token: A.accessToken, body: { reason: 'abuse' } });
  check('گزارش تکراری باز → همان رکورد (idempotent)', rep1b.data?.duplicate === true && rep1b.data.report.id === rep1.data.report.id);
  const repSelf = await api('POST', `/users/${A.user.id}/report`, { token: A.accessToken, body: { reason: 'other' } });
  check('گزارش خودم → 400 CANNOT_REPORT_SELF', repSelf.status === 400 && errCode(repSelf) === 'CANNOT_REPORT_SELF');

  const queue = await api('GET', '/admin/reports?status=open', { token: admin.accessToken });
  check('صف گزارش‌های باز ادمین شامل گزارش تازه', queue.status === 200 && queue.data.items.some((r) => r.id === rep1.data.report.id));
  const handled = await api('POST', `/admin/reports/${rep1.data.report.id}/handle`, {
    token: admin.accessToken,
    body: { action: 'resolve', note: 'تأیید شد' },
  });
  check('رسیدگی ادمین → resolved با handledBy', handled.status === 200 && handled.data.status === 'resolved' && handled.data.handledBy === admin.user.id, `status=${handled.status} ${JSON.stringify(handled.data ?? null).slice(0, 120)}`);
  const rehandle = await api('POST', `/admin/reports/${rep1.data.report.id}/handle`, { token: admin.accessToken, body: { action: 'dismiss' } });
  check('رسیدگی دوباره → 409 REPORT_HANDLED', rehandle.status === 409 && errCode(rehandle) === 'REPORT_HANDLED');

  // ۵) مسدودسازی کاربر-به-کاربر
  const blockedList0 = await api('GET', '/users/me/blocks', { token: A.accessToken });
  check('فهرست مسدودی‌های من در ابتدا خالی', blockedList0.status === 200 && blockedList0.data.items.length === 0);
  const blk = await api('POST', `/users/${B.user.id}/block`, { token: A.accessToken });
  check('A کاربر B را مسدود کرد → 204', blk.status === 204);
  const blkAgain = await api('POST', `/users/${B.user.id}/block`, { token: A.accessToken });
  check('مسدودسازی تکراری idempotent → 204', blkAgain.status === 204);
  const blockedList = await api('GET', '/users/me/blocks', { token: A.accessToken });
  check('فهرست مسدودی‌ها شامل B', blockedList.data.items.some((x) => x.userId === B.user.id));

  // گفتگوی مستقیم تازه ممنوع — و ساخت DM پیش از مسدودی برای آزمون ارسال
  const dmAC0 = await api('POST', '/conversations', { token: A.accessToken, body: { userId: C.user.id } });
  check('DM تازه A→C ساخته شد (قبل از مسدودی)', (dmAC0.status === 200 || dmAC0.status === 201) && dmAC0.data.id, `status=${dmAC0.status} ${JSON.stringify(dmAC0.data).slice(0, 80)}`);
  const convAC = dmAC0.data.id;

  const dmNew = await api('POST', '/conversations', { token: A.accessToken, body: { userId: B.user.id } });
  check('DM تازه A→B → 403 USER_BLOCKED', dmNew.status === 403 && errCode(dmNew) === 'USER_BLOCKED', `${dmNew.status}/${errCode(dmNew)}`);
  const dmNewRev = await api('POST', '/conversations', { token: B.accessToken, body: { userId: A.user.id } });
  check('DM تازه B→A → 403 USER_BLOCKED (دوطرفه)', dmNewRev.status === 403 && errCode(dmNewRev) === 'USER_BLOCKED');

  await api('POST', `/users/${C.user.id}/block`, { token: A.accessToken });
  const sendBlocked = await api('POST', `/conversations/${convAC}/messages`, {
    token: A.accessToken, body: { clientMsgId: uuid(), body: 'سلام' },
  });
  check('ارسال پیام در DM موجود A→C → 403 USER_BLOCKED', sendBlocked.status === 403 && errCode(sendBlocked) === 'USER_BLOCKED', `${sendBlocked.status}/${errCode(sendBlocked)}`);
  const sendBlockedRev = await api('POST', `/conversations/${convAC}/messages`, {
    token: C.accessToken, body: { clientMsgId: uuid(), body: 'پاسخ' },
  });
  check('ارسال معکوس C→A در DM → 403 USER_BLOCKED', sendBlockedRev.status === 403 && errCode(sendBlockedRev) === 'USER_BLOCKED');

  // رفع مسدودی → ارسال آزاد می‌شود
  await api('DELETE', `/users/${C.user.id}/block`, { token: A.accessToken });
  const sendOk = await api('POST', `/conversations/${convAC}/messages`, {
    token: A.accessToken, body: { clientMsgId: uuid(), body: 'رفع مسدودی شد' },
  });
  check('بعد از unblock ارسال A→C → 2xx', sendOk.status >= 200 && sendOk.status < 300, `${sendOk.status}/${errCode(sendOk)}`);

  // گروه‌ها مشمول مسدودسازی نیستند: گروه A+B، B عضو مسدودشده‌ی A است اما پیام گروهی آزاد است
  const grp = await api('POST', '/conversations/group', {
    token: A.accessToken, body: { title: 'گزارش‌ها', memberUserIds: [B.user.id] },
  });
  check('گروه با عضو مسدودی‌شده ساخته می‌شود (گروه مستقل از مسدودی DM)', (grp.status === 200 || grp.status === 201) && Boolean(grp.data?.id), `status=${grp.status} ${JSON.stringify(grp.data ?? null).slice(0, 100)}`);
  const grpMsg = await api('POST', `/conversations/${grp.data.id}/messages`, {
    token: B.accessToken, body: { clientMsgId: uuid(), body: 'در گروه آزاد است' },
  });
  check('پیام گروهی از B (مسدودی A) → 2xx', grpMsg.status >= 200 && grpMsg.status < 300, `${grpMsg.status}/${errCode(grpMsg)}`);

  // ۶) مسدودسازی ادمین — همه‌جانبه
  const wsC = await connectWs(C.accessToken);
  const blockedEvt = waitForEvent(wsC, 'account.blocked', 7000);
  const blockedC = await api('POST', `/admin/users/${C.user.id}/block`, {
    token: admin.accessToken, body: { reason: 'تخلف جدی' },
  });
  check('ادمین کاربر C را مسدود کرد → 200 با blockedAt', blockedC.status === 200 && Boolean(blockedC.data?.blockedAt), `status=${blockedC.status} ${JSON.stringify(blockedC.data ?? null).slice(0, 140)}`);
  const wsKicked = await blockedEvt;
  check('WS کاربر C رویداد account.blocked گرفت و قطع شد', Boolean(wsKicked) && (wsC.connected === false || wsC.__blockedEvent));

  const apiBlocked = await api('GET', '/users/me', { token: C.accessToken });
  check('API با توکن موجود C → 403 ACCOUNT_BLOCKED (گارد زنده)', apiBlocked.status === 403 && errCode(apiBlocked) === 'ACCOUNT_BLOCKED', `${apiBlocked.status}/${errCode(apiBlocked)}`);

  const otpC = await api('POST', '/auth/otp/request', { body: { phone: phoneC } });
  const loginC = await api('POST', '/auth/otp/verify', { body: { phone: phoneC, code: otpC.data.devCode } });
  check('ورود مجدد C مسدود → 403 ACCOUNT_BLOCKED', loginC.status === 403 && errCode(loginC) === 'ACCOUNT_BLOCKED');

  const refreshC = await api('POST', '/auth/refresh', { body: { refreshToken: C.refreshToken } });
  // مسدودسازی همه refresh tokenها را باطل می‌کند — پس یا ACCOUNT_BLOCKED (۴۰۳) یا REFRESH_REUSED (۴۰۱) می‌آید؛ هر دو یعنی دسترسی بسته است
  check('refresh توکن C مسدود → رد می‌شود (ACCOUNT_BLOCKED/REFRESH_REUSED)',
    (refreshC.status === 403 && errCode(refreshC) === 'ACCOUNT_BLOCKED') ||
    (refreshC.status === 401 && errCode(refreshC) === 'REFRESH_REUSED'),
    `${refreshC.status}/${errCode(refreshC)}`);

  const reconnect = await new Promise((resolve) => {
    const s = io('http://localhost:3000', { auth: { token: C.accessToken }, transports: ['websocket'] });
    let kicked = false;
    s.on('account.blocked', () => { kicked = true; });
    setTimeout(() => { resolve(kicked || !s.connected); s.disconnect(); }, 4000);
  });
  check('اتصال WS تازهٔ C بلافاصله بسته می‌شود', reconnect === true);

  // ادمین نمی‌تواند خودش/ادمین دیگر را مسدود کند
  const blockSelf = await api('POST', `/admin/users/${admin.user.id}/block`, { token: admin.accessToken, body: {} });
  // هر دو حفاظ معتبرند: ادمین‌ها قابل مسدودشدن نیستند و خودمسدودی هم ممنوع است
  check('ادمین خودش را مسدود کند → 409 (CANNOT_BLOCK_ADMIN/CANNOT_BLOCK_SELF)',
    blockSelf.status === 409 && (errCode(blockSelf) === 'CANNOT_BLOCK_SELF' || errCode(blockSelf) === 'CANNOT_BLOCK_ADMIN'),
    `${blockSelf.status}/${errCode(blockSelf)}`);

  // ۷) رفع مسدودی ادمین
  const unblocked = await api('POST', `/admin/users/${C.user.id}/unblock`, { token: admin.accessToken });
  check('unblock ادمین → 200 بدون blockedAt', unblocked.status === 200 && unblocked.data.blockedAt === null);
  const loginAgain = await login(phoneC);
  check('ورود C بعد از رفع مسدودی → 200', loginAgain.user?.id === C.user.id);

  // ۸) متریک‌ها و دفتر اقدامات
  const met = await api('GET', '/admin/metrics', { token: admin.accessToken });
  check('GET /admin/metrics → 200 با همه بخش‌ها',
    met.status === 200 &&
    typeof met.data.users?.total === 'number' &&
    typeof met.data.messages?.last24h === 'number' &&
    typeof met.data.reports?.open === 'number' &&
    typeof met.data.onlineNow === 'number',
    JSON.stringify(met.data).slice(0, 160));
  check('متریک: blocked هم‌اکنون ۰ است (C رفع مسدود شد)', met.data.users?.blocked === 0, `blocked=${met.data.users?.blocked}`);
  check('متریک: open reports = ۰ (همه رسیدگی شد)', met.data.reports?.open === 0, `open=${met.data.reports?.open}`);

  const audit = await api('GET', '/admin/audit?limit=100', { token: admin.accessToken });
  const actions = audit.data?.items?.map((a) => a.action) ?? [];
  check('audit شامل user.block', actions.includes('user.block'));
  check('audit شامل user.unblock', actions.includes('user.unblock'));
  check('audit شامل report.resolve', actions.includes('report.resolve'));
  const blockEntry = audit.data.items.find((a) => a.action === 'user.block' && a.targetId === C.user.id);
  check('رکورد user.block دارای actor و meta.reason است', Boolean(blockEntry?.actorId) && blockEntry?.meta?.reason === 'تخلف جدی', JSON.stringify(blockEntry ?? null).slice(0, 140));

  // ۹) سخت‌سازی: سرآیندهای امنیتی
  const sec = await fetch(`${BASE}/health`);
  check('هدر X-Content-Type-Options: nosniff', sec.headers.get('x-content-type-options') === 'nosniff');
  check('هدر X-Frame-Options: DENY', sec.headers.get('x-frame-options') === 'DENY');
  check('هدر Referrer-Policy: no-referrer', sec.headers.get('referrer-policy') === 'no-referrer');
  check('هدر X-Powered-By حذف شده', sec.headers.get('x-powered-by') === null);

  // ————— نتیجه —————
  console.log(`\n——— نتیجه: ${PASS.length} سبز / ${FAIL.length} قرمز ———`);
  if (FAIL.length) {
    console.log('موارد قرمز:');
    for (const f of FAIL) console.log('  -', f);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('خطای اجرا:', e);
  process.exit(1);
});
