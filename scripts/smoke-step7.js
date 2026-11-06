/**
 * Del — تست دود گام ۷: اعلان‌های push + همگام‌سازی چنددستگاهی
 * اجرا:  node scripts/smoke-step7.js
 * پیش‌نیاز: PostgreSQL روشن (:55432) — نمونه API اختصاصی خودش بوت می‌کند
 *
 *   :3001 با PUSH_WEBHOOK_URL=http://127.0.0.1:3997/push و PUSH_EXPO_ENABLED=false
 *   :3997 سرور webhook ضبط‌کننده payload اعلان‌ها
 *
 * پوشش:
 *   A) ثبت/حذف توکن push + 401 + فهرست دستگاه‌ها (توکن هرگز برگردانده نمی‌شود)
 *   B) پیام به کاربر آفلاین → webhook اعلان می‌گیرد (شکل کامل payload)
 *   C) کاربر آنلاین (WS زنده) → push ارسال نمی‌شود
 *   D) تماس ورودی به کاربر آفلاین → push kind=call
 *   E) sync/bootstrap و sync/updates (cursor زمانی + خطای 400)
 *   F) همگام‌سازی خوانده‌نشده چنددستگاهی (message.new/message.read روی ۲ socket)
 *   G) گروه: اعلان با عنوان گروه + ظاهرشدن گروه در updates
 */
const { io } = require('socket.io-client');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const API_PORT = 3001;
const HOOK_PORT = 3997;
const BASE = `http://localhost:${API_PORT}`;
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

async function api(base, method, p, { token, body } = {}) {
  const res = await fetch(`${base}/api/v1${p}`, {
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

async function login(base, phone, deviceName = 'smoke7') {
  const req = await api(base, 'POST', '/auth/otp/request', { body: { phone } });
  const code = req.data.devCode;
  const verify = await api(base, 'POST', '/auth/otp/verify', {
    body: { phone, code, platform: 'android', deviceName },
  });
  if (verify.status !== 200) throw new Error(`login failed for ${phone}`);
  return verify.data;
}

function connectWs(base, token) {
  return new Promise((resolve, reject) => {
    const s = io(base, { auth: { token }, transports: ['websocket'] });
    const t = setTimeout(() => reject(new Error('ws connect timeout')), 8000);
    s.on('connect', () => { clearTimeout(t); resolve(s); });
    s.on('connect_error', (e) => { clearTimeout(t); reject(e); });
  });
}

function waitForEvent(socket, event, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, (payload) => { clearTimeout(t); resolve(payload); });
  });
}

/** منتظر می‌ماند تا شرط برقرار شود (polling) — برای webhook غیرهمزمان */
async function waitFor(fn, timeoutMs = 6000, step = 120) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
}

const uuid = () => crypto.randomUUID();

// ————— سرور webhook ضبط‌کننده —————
const pushes = []; // DelPushPayload[]
const hook = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/push') {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      try { pushes.push(JSON.parse(raw)); } catch { /* بدنه خراب */ }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    return;
  }
  res.writeHead(404).end();
});

const API_DIR = path.join(__dirname, '..', 'apps', 'api');

async function bootApi(port, extraEnv = {}) {
  const child = spawn('node', [path.join(API_DIR, 'dist', 'main.js')], {
    env: {
      ...process.env,
      DATABASE_URL: 'postgresql://postgres:smokepw@localhost:55432/del?schema=public',
      PORT: String(port),
      AUTH_DEV_MODE: 'true',
      JWT_ACCESS_SECRET: 'dev-access-secret-smoke-0123456789abcdef',
      JWT_REFRESH_SECRET: 'dev-refresh-secret-smoke-9876543210fedcba',
      NODE_ENV: 'development',
      // تماس‌ها (برای تست push تماس) — مقدارهای توسعه؛ LiveKit واقعی لازم نیست (فقط توکن ساخته می‌شود)
      LIVEKIT_URL: 'ws://localhost:7880',
      LIVEKIT_API_KEY: 'devkey',
      LIVEKIT_API_SECRET: 'devsecret-0123456789abcdef0123456789abcdef',
      ...extraEnv,
    },
    stdio: 'ignore',
    detached: false,
  });
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/api/v1/health`);
      if (res.ok) return child;
    } catch { /* هنوز بالا نیامده */ }
    await sleep(500);
  }
  child.kill('SIGKILL');
  throw new Error(`api on :${port} did not come up`);
}

function killApi(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.on('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* تمیز شده */ } }, 4000);
  });
}

// ————— سناریو —————
(async () => {
  let api1 = null;
  await new Promise((r) => hook.listen(HOOK_PORT, '127.0.0.1', r));
  console.log(`\n— webhook recorder on :${HOOK_PORT} —`);

  try {
    api1 = await bootApi(API_PORT, {
      PUSH_WEBHOOK_URL: `http://127.0.0.1:${HOOK_PORT}/push`,
      PUSH_EXPO_ENABLED: 'false',
    });
    console.log(`— API on :${API_PORT} با PUSH_WEBHOOK_URL —\n`);

    // شماره‌های یکتا در هر اجرا — تا rerun روی همان DB هم قطعی باشد
    const rnd = String(Date.now()).slice(-7);
    const phoneA = `+98971${rnd}01`;
    const phoneB = `+98971${rnd}02`;
    const A = await login(BASE, phoneA);
    const B = await login(BASE, phoneB);
    const B2 = await login(BASE, phoneB, 'smoke7-device2');

    // ————— A: ثبت توکن push —————
    console.log('A) دستگاه‌ها و توکن push');
    const unauth = await api(BASE, 'POST', '/devices/push-token', { body: { token: 'ExpoPushToken[x]' } });
    check('بدون توکن → 401', unauth.status === 401);

    const reg = await api(BASE, 'POST', '/devices/push-token', {
      token: B.accessToken, body: { token: 'ExpoPushToken[smoke-b-device1]' },
    });
    check('ثبت توکن push → registered=true و deviceId درست', reg.status === 200 && reg.data?.registered === true && Boolean(reg.data?.deviceId));

    const reg2 = await api(BASE, 'POST', '/devices/push-token', {
      token: B2.accessToken, body: { token: 'ExpoPushToken[smoke-b-device2]' },
    });
    check('ثبت توکن دستگاه دوم → موفق', reg2.status === 200 && reg2.data?.registered === true);

    const devs = await api(BASE, 'GET', '/devices', { token: B.accessToken });
    const myDev = (devs.data ?? []).find((d) => d.id === reg.data.deviceId);
    check('GET /devices — pushRegistered=true و خودِ توکن برگردانده نشده',
      devs.status === 200 && (devs.data ?? []).length >= 2
      && myDev?.pushRegistered === true
      && !JSON.stringify(devs.data).includes('ExpoPushToken[smoke'));

    // ————— B: پیام به کاربر آفلاین → webhook —————
    console.log('B) پیام به کاربر آفلاین');
    const conv = await api(BASE, 'POST', '/conversations', {
      token: A.accessToken, body: { userId: B.user.id },
    });
    check('گفتگوی مستقیم ساخته شد', (conv.status === 200 || conv.status === 201) && Boolean(conv.data?.id));
    const convId = conv.data.id;

    const m1 = await api(BASE, 'POST', `/conversations/${convId}/messages`, {
      token: A.accessToken, body: { clientMsgId: uuid(), body: 'سلام از تست دود گام ۷' },
    });
    check('پیام ۱ ارسال شد', m1.status === 201 && m1.data?.message?.serverSeq === 1);

    const p1 = await waitFor(() => pushes.find((x) => x.userId === B.user.id && x.kind === 'message'));
    check('push به گیرنده آفلاین رسید', Boolean(p1));
    check('شکل payload کامل (kind/title/body/data/tokens×۲)',
      Boolean(p1)
      && p1.title === phoneA
      && typeof p1.body === 'string' && p1.body.includes('گام ۷')
      && p1.data?.conversationId === convId
      && Array.isArray(p1.tokens) && p1.tokens.length === 2);

    await api(BASE, 'POST', `/conversations/${convId}/messages`, {
      token: A.accessToken, body: { clientMsgId: uuid(), body: 'پیام دوم' },
    });
    const twoMsgs = await waitFor(() => pushes.filter((x) => x.kind === 'message' && x.userId === B.user.id).length >= 2);
    check('پیام دوم هم push شد (شمار ۲)', Boolean(twoMsgs));

    // ————— C: کاربر آنلاین → push نه —————
    console.log('C) مهار push برای کاربر آنلاین');
    const wsB = await connectWs(BASE, B.accessToken);
    const baseCount = pushes.length;
    await sleep(300);
    await api(BASE, 'POST', `/conversations/${convId}/messages`, {
      token: A.accessToken, body: { clientMsgId: uuid(), body: 'وقتی آنلاینم push نخور' },
    });
    await sleep(1500);
    check('کاربر آنلاین push نگرفت', pushes.length === baseCount);

    // ————— D: تماس ورودی به کاربر آفلاین —————
    console.log('D) push تماس ورودی');
    wsB.disconnect();
    await sleep(500);
    const call = await api(BASE, 'POST', '/calls', {
      token: A.accessToken, body: { conversationId: convId, kind: 'audio' },
    });
    check('تماس آغاز شد', call.status === 201 || call.status === 200);
    const pc = await waitFor(() => pushes.find((x) => x.kind === 'call' && x.userId === B.user.id));
    check('push kind=call رسید', Boolean(pc) && Boolean(pc?.data?.callId));
    if (call.data?.call?.id) {
      await api(BASE, 'POST', `/calls/${call.data.call.id}/cancel`, { token: A.accessToken });
    }

    // ————— E: همگام‌سازی —————
    console.log('E) sync/bootstrap و sync/updates');
    const boot1 = await api(BASE, 'GET', '/sync/bootstrap', { token: B.accessToken });
    const convBoot = (boot1.data?.conversations ?? []).find((c) => c.id === convId);
    check('bootstrap — کاربر و مکالمه و شمارنده خوانده‌نشده',
      boot1.status === 200 && boot1.data?.user?.phone === phoneB
      && Boolean(boot1.data?.serverTime)
      && convBoot?.unreadCount === 3);
    check('bootstrap — direct دارای peer', convBoot?.peer?.phone === phoneA);
    const serverTime1 = boot1.data.serverTime;

    await api(BASE, 'POST', `/conversations/${convId}/messages`, {
      token: A.accessToken, body: { clientMsgId: uuid(), body: 'پیام بعد از bootstrap' },
    });
    await sleep(400);
    const up1 = await api(BASE, 'GET', `/sync/updates?since=${encodeURIComponent(serverTime1)}`, { token: B.accessToken });
    const up1conv = (up1.data?.conversations ?? []).find((c) => c.id === convId);
    check('updates پس از پیام جدید — مکالمه با lastSeq=۴ و unread=۴',
      up1.status === 200 && up1conv?.lastSeq === 4 && up1conv?.unreadCount === 4);

    await api(BASE, 'POST', `/conversations/${convId}/read`, {
      token: B.accessToken, body: { lastReadSeq: 4 },
    });
    await sleep(300);
    const up2 = await api(BASE, 'GET', `/sync/updates?since=${encodeURIComponent(serverTime1)}`, { token: B.accessToken });
    const up2conv = (up2.data?.conversations ?? []).find((c) => c.id === convId);
    check('updates پس از خواندن — unread=۰ (همگام‌سازی بین دستگاه‌ها)',
      up2.status === 200 && up2conv?.unreadCount === 0);

    const future = new Date(Date.now() + 3000).toISOString();
    const up3 = await api(BASE, 'GET', `/sync/updates?since=${encodeURIComponent(future)}`, { token: B.accessToken });
    check('updates با cursor آینده — خالی', up3.status === 200 && (up3.data?.conversations ?? []).length === 0);

    const bad = await api(BASE, 'GET', `/sync/updates?since=not-a-date`, { token: B.accessToken });
    check('since نامعتبر → 400', bad.status === 400);

    // ————— F: همگام‌سازی چنددستگاهی روی WS —————
    console.log('F) چنددستگاهی روی WS');
    const wsB1 = await connectWs(BASE, B.accessToken);
    const wsB2 = await connectWs(BASE, B2.accessToken);
    const n1 = waitForEvent(wsB1, 'message.new');
    const n2 = waitForEvent(wsB2, 'message.new');
    await api(BASE, 'POST', `/conversations/${convId}/messages`, {
      token: A.accessToken, body: { clientMsgId: uuid(), body: 'به هر دو دستگاه' },
    });
    const [r1, r2] = [await n1, await n2];
    check('message.new به هر دو socket رسید',
      Boolean(r1) && Boolean(r2) && r1.message?.serverSeq === 5 && r2.message?.serverSeq === 5);

    const rd1 = waitForEvent(wsB1, 'message.read');
    const rd2 = waitForEvent(wsB2, 'message.read');
    await api(BASE, 'POST', `/conversations/${convId}/read`, {
      token: B.accessToken, body: { lastReadSeq: 5 },
    });
    const [q1, q2] = [await rd1, await rd2];
    check('message.read به دستگاه دوم هم رسید (badge sync)',
      Boolean(q1) && Boolean(q2) && q2.lastReadSeq === 5);
    const up4 = await api(BASE, 'GET', `/sync/updates?since=${encodeURIComponent(serverTime1)}`, { token: B.accessToken });
    check('REST updates هم unread=۰ را تأیید می‌کند',
      (up4.data?.conversations ?? []).find((c) => c.id === convId)?.unreadCount === 0);

    // ————— G: گروه —————
    console.log('G) گروه و اعلان گروهی');
    const g = await api(BASE, 'POST', '/conversations/group', {
      token: A.accessToken, body: { title: 'گروه دود ۷', memberUserIds: [B.user.id] },
    });
    check('گروه ساخته شد', (g.status === 200 || g.status === 201) && g.data?.type === 'group');
    const gid = g.data.id;
    const up5 = await api(BASE, 'GET', `/sync/updates?since=${encodeURIComponent(serverTime1)}`, { token: B.accessToken });
    check('گروه تازه در updates ظاهر شد', (up5.data?.conversations ?? []).some((c) => c.id === gid));

    wsB1.disconnect(); wsB2.disconnect();
    await sleep(500);
    await api(BASE, 'POST', `/conversations/${gid}/messages`, {
      token: A.accessToken, body: { clientMsgId: uuid(), body: 'سلام گروه' },
    });
    const pg = await waitFor(() => pushes.find((x) => x.kind === 'message' && x.userId === B.user.id && x.data?.conversationId === gid));
    check('اعلان گروهی — عنوان شامل نام گروه', Boolean(pg) && String(pg?.title ?? '').includes('گروه دود ۷'));

    // ————— H: حذف توکن —————
    console.log('H) حذف توکن push');
    const del = await api(BASE, 'DELETE', '/devices/push-token', { token: B.accessToken });
    const devs2 = await api(BASE, 'GET', '/devices', { token: B.accessToken });
    const myDev2 = (devs2.data ?? []).find((d) => d.id === del.data?.deviceId);
    check('حذف توکن → pushRegistered=false', del.status === 200 && del.data?.registered === false && myDev2?.pushRegistered === false);
  } catch (e) {
    console.error('💥 خطای غیرمنتظره:', e);
    check('بدون خطای غیرمنتظره', false, String(e?.message ?? e));
  } finally {
    await killApi(api1);
    hook.close();
  }

  console.log(`\n———————————`);
  console.log(`✅ پاس‌شده: ${PASS.length}   ❌ رد‌شده: ${FAIL.length}`);
  if (FAIL.length) {
    console.log('موارد رد‌شده:');
    for (const f of FAIL) console.log(`  - ${f}`);
    process.exit(1);
  }
})();
