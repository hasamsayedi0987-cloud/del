/**
 * Del — تست دود گام ۳: حضور + تایپینگ + رسید خواندن + همگام‌سازی آفلاین
 * اجرا:  node scripts/smoke-step3.js   (سرور باید روی :3000 باشد)
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

async function login(phone) {
  const req = await api('POST', '/auth/otp/request', { body: { phone } });
  const code = req.data.devCode;
  const verify = await api('POST', '/auth/otp/verify', {
    body: { phone, code, platform: 'android', deviceName: 'smoke3' },
  });
  if (verify.status !== 200) throw new Error(`login failed for ${phone}: ${JSON.stringify(verify.data)}`);
  return verify.data;
}

function connectWs(token) {
  return new Promise((resolve, reject) => {
    const s = io('http://localhost:3000', { auth: { token }, transports: ['websocket'] });
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

/** شمارش رویدادها در یک بازه زمانی */
function countEvents(socket, event, windowMs) {
  return new Promise((resolve) => {
    let n = 0;
    socket.on(event, () => { n++; });
    setTimeout(() => resolve(n), windowMs);
  });
}

async function main() {
  console.log('\n——— گام ۳: حضور، تایپینگ، رسید خواندن، همگام‌سازی آفلاین ———\n');

  // پاک‌سازی جداول پیام‌رسانی
  const { Client } = require('pg');
  const pg = new Client({ connectionString: 'postgresql://postgres:smokepw@localhost:55432/del' });
  await pg.connect();
  await pg.query('TRUNCATE "Message", "Participant", "Conversation" CASCADE');
  await pg.end();
  console.log('(جداول پیام‌رسانی پاک شد)\n');

  // ۱) ورود و ساخت مکالمه + چند پیام پایه
  console.log('۱) ورود A و B، ساخت مکالمه، ۳ پیام پایه');
  const A = await login('09121110001');
  const B = await login('09121110002');
  check('ورود A و B', Boolean(A.accessToken && B.accessToken));

  const byPhone = await api('GET', '/users/by-phone/09121110002', { token: A.accessToken });
  const conv = await api('POST', '/conversations', { token: A.accessToken, body: { userId: byPhone.data.id } });
  const convId = conv.data.id;
  for (let i = 1; i <= 3; i++) {
    await api('POST', `/conversations/${convId}/messages`, {
      token: A.accessToken,
      body: { clientMsgId: `bbbb2222-0000-4000-8000-00000000000${i}`, body: `msg ${i}` },
    });
  }
  check('مکالمه و ۳ پیام آماده شد', conv.status === 201);

  // ۲) حضور: اتصال WS → online
  console.log('۲) حضور — اتصال و قطع');
  const wsA = await connectWs(A.accessToken);
  const wsB = await connectWs(B.accessToken);
  await sleep(400);

  const presA = await api('GET', `/users/${A.user.id}/presence`, { token: B.accessToken });
  check('A پس از اتصال online است', presA.status === 200 && presA.data.online === true, JSON.stringify(presA.data));
  const presB = await api('GET', `/users/${B.user.id}/presence`, { token: A.accessToken });
  check('B پس از اتصال online است', presB.status === 200 && presB.data.online === true);

  // قطع A → offline + lastSeen
  const bPresencePromise = waitForEvent(wsB, 'presence.update', 6000);
  wsA.disconnect();
  await sleep(600);
  const bPresence = await bPresencePromise;
  check(
    'B رویداد presence.update گرفت (A قطع شد)',
    bPresence && bPresence.userId === A.user.id && bPresence.online === false && !!bPresence.lastSeen,
    JSON.stringify(bPresence),
  );
  const presA2 = await api('GET', `/users/${A.user.id}/presence`, { token: B.accessToken });
  check('A الان offline با lastSeen', presA2.data.online === false && !!presA2.data.lastSeen);

  // A دوباره وصل شود برای ادامه تست‌ها
  const wsA2 = await connectWs(A.accessToken);
  await sleep(300);

  // ۳) تایپینگ
  console.log('۳) تایپینگ — broadcast + throttle + عضویت');
  const typingPromise = waitForEvent(wsB, 'typing', 5000);
  wsA2.timeout(4000).emit('typing', { conversationId: convId }, () => undefined);
  const typing = await typingPromise;
  check(
    'B رویداد typing گرفت',
    typing && typing.conversationId === convId && typing.userId === A.user.id,
    JSON.stringify(typing),
  );

  // throttle: ۴ emit پشت سر هم → حداکثر ۱ رویداد اضافه در ۱٫۶ ثانیه
  const extraCount = await countEvents(wsB, 'typing', 1600);
  for (let i = 0; i < 4; i++) {
    wsA2.timeout(4000).emit('typing', { conversationId: convId }, () => undefined);
    await sleep(30);
  }
  const finalCount = await countEvents(wsB, 'typing', 200);
  // finalCount شمارش ادامه‌ی همان بازه است؛ جمع باید ≤ ۲ باشد (t=0 و t=1.5s)
  check('throttle سرور کار می‌کند', extraCount + finalCount <= 2, `extra=${extraCount} final=${finalCount}`);

  // عضویت: C غیرعضو نباید typing بفرستد
  const C = await login('09121110003');
  const wsC = await connectWs(C.accessToken);
  await sleep(200);
  const denied = await new Promise((resolve) => {
    wsC.timeout(4000).emit('typing', { conversationId: convId }, (e, r) => resolve(r));
  });
  check('typing غیرعضو رد شد', denied && denied.ok === false && denied.error?.code === 'NOT_A_PARTICIPANT', JSON.stringify(denied));
  wsC.disconnect(); // برای بررسی presence آفلاین C در ادامه

  // ۴) رسید خواندن
  console.log('۴) رسید خواندن بلادرنگ');
  const readPromise = waitForEvent(wsA2, 'message.read', 5000);
  const readRes = await api('POST', `/conversations/${convId}/read`, {
    token: B.accessToken,
    body: { lastReadSeq: 3 },
  });
  const readEvent = await readPromise;
  check(
    'A رویداد message.read گرفت',
    readEvent && readEvent.conversationId === convId && readEvent.userId === B.user.id && readEvent.lastReadSeq === 3,
    JSON.stringify(readEvent),
  );
  check('POST read هم 204 داد', readRes.status === 204);

  // ۵) همگام‌سازی آفلاین since
  console.log('۵) همگام‌سازی آفلاین (?since=)');
  for (let i = 4; i <= 6; i++) {
    await api('POST', `/conversations/${convId}/messages`, {
      token: A.accessToken,
      body: { clientMsgId: `bbbb2222-0000-4000-8000-00000000000${i}`, body: `msg ${i}` },
    });
  }
  const s1 = await api('GET', `/conversations/${convId}/messages?since=1`, { token: B.accessToken });
  check(
    'since=1 → پیام‌های ۲..۶ صعودی',
    s1.data.messages.map((m) => m.serverSeq).join(',') === '2,3,4,5,6' && s1.data.hasMore === false,
    JSON.stringify(s1.data.messages.map((m) => m.serverSeq)),
  );
  const s2 = await api('GET', `/conversations/${convId}/messages?since=0&limit=2`, { token: B.accessToken });
  check(
    'since=0&limit=2 → ۱و۲ با hasMore و nextSince=2',
    s2.data.messages.map((m) => m.serverSeq).join(',') === '1,2' && s2.data.hasMore === true && s2.data.nextSince === 2,
    JSON.stringify(s2.data),
  );
  const s3 = await api('GET', `/conversations/${convId}/messages?since=${s2.data.nextSince}`, { token: B.accessToken });
  check('ادامه sync از nextSince → ۳..۶', s3.data.messages.map((m) => m.serverSeq).join(',') === '3,4,5,6');

  // رگرسیون: before همچنان کار می‌کند
  const b1 = await api('GET', `/conversations/${convId}/messages?limit=2`, { token: B.accessToken });
  check(
    'رگرسیون: before هنوز سالم (۲ پیام آخر نزولی گرفته، پاسخ صعودی)',
    b1.data.messages.map((m) => m.serverSeq).join(',') === '5,6' && b1.data.hasMore === true,
    JSON.stringify(b1.data.messages.map((m) => m.serverSeq)),
  );

  // ۶) حضور کاربر بدون WS (C در گام ۳ قطع شد)
  await sleep(500);
  const presC = await api('GET', `/users/${C.user.id}/presence`, { token: A.accessToken });
  check('C پس از قطع → offline و lastSeen ثبت شده', presC.data.online === false && !!presC.data.lastSeen, JSON.stringify(presC.data));

  // heartbeat
  const hb = await new Promise((resolve) => {
    wsA2.timeout(4000).emit('presence.heartbeat', {}, (e, r) => resolve(r));
  });
  check('heartbeat ack می‌دهد', hb && hb.ok === true, JSON.stringify(hb));

  wsA2.disconnect();
  wsB.disconnect();

  console.log(`\n——— نتیجه: ${PASS.length} سبز / ${FAIL.length} قرمز ———`);
  if (FAIL.length) {
    console.log('موارد ناموفق:', FAIL.join(' | '));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
