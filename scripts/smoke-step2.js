/**
 * Del — تست دود گام ۲: پیام‌رسانی بلادرنگ
 * اجرا:  node scripts/smoke-step2.js   (سرور باید روی :3000 باشد)
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
    body: { phone, code, platform: 'android', deviceName: 'smoke2' },
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
    socket.once(event, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

async function main() {
  console.log('\n——— گام ۲: پیام‌رسانی بلادرنگ ———\n');

  // پاک‌سازی جداول پیام‌رسانی برای اجرای قطعی (کاربران باقی می‌مانند)
  const { Client } = require('pg');
  const pg = new Client({ connectionString: 'postgresql://postgres:smokepw@localhost:55432/del' });
  await pg.connect();
  await pg.query('TRUNCATE "Message", "Participant", "Conversation" CASCADE');
  await pg.end();
  console.log('(جداول پیام‌رسانی پاک شد)\n');

  // ۱) ورود دو کاربر
  console.log('۱) ورود کاربران A و B');
  const A = await login('09121110001');
  const B = await login('09121110002');
  check('ورود A و B', Boolean(A.accessToken && B.accessToken));

  // ۲) یافتن B با شماره + ساخت مکالمه (دوبار برای idempotency)
  console.log('۲) ساخت مکالمه مستقیم (idempotent)');
  const byPhone = await api('GET', '/users/by-phone/09121110002', { token: A.accessToken });
  check('جستجوی کاربر با شماره', byPhone.status === 200 && byPhone.data.id === B.user.id);

  const conv1 = await api('POST', '/conversations', { token: A.accessToken, body: { userId: B.user.id } });
  const conv2 = await api('POST', '/conversations', { token: A.accessToken, body: { userId: B.user.id } });
  check('مکالمه یکتا ساخته شد', conv1.status === 201 && conv1.data.id === conv2.data.id, JSON.stringify(conv1.data));

  const convId = conv1.data.id;

  // ۳) اتصال WS هر دو کاربر
  console.log('۳) اتصال WebSocket');
  const wsA = await connectWs(A.accessToken);
  const wsB = await connectWs(B.accessToken);
  check('WS هر دو متصل', wsA.connected && wsB.connected);
  await sleep(300); // فرصت join اتاق‌ها

  // ۴) ارسال از مسیر WS → دریافت بلادرنگ
  console.log('۴) ارسال پیام از A (WS) و دریافت بلادرنگ توسط B');
  const bPromise = waitForEvent(wsB, 'message.new');
  const aPromise = waitForEvent(wsA, 'message.new');
  const cmid1 = 'aaaa1111-0000-4000-8000-000000000001';
  let ack = null;
  wsA.timeout(8000).emit('message.send', { conversationId: convId, clientMsgId: cmid1, body: 'سلام از A 🌊' }, (e, r) => { ack = { e, r }; });
  await sleep(200);
  const bMsg = await bPromise;
  const aMsg = await aPromise;
  check('ack موفق برای فرستنده', ack && !ack.e && ack.r?.ok === true);
  check('B پیام را بلادرنگ گرفت', bMsg && bMsg.message.clientMsgId === cmid1);
  check('فرستنده هم broadcast خودش را گرفت (dedupe سمت کلاینت)', aMsg && aMsg.message.clientMsgId === cmid1);
  check('serverSeq = 1', bMsg?.message?.serverSeq === 1);

  // ۵) idempotency: همان clientMsgId دوباره
  console.log('۵) ارسال تکراری همان clientMsgId (idempotency)');
  const bPromise2 = waitForEvent(wsB, 'message.new', 1500);
  let ack2 = null;
  wsA.timeout(8000).emit('message.send', { conversationId: convId, clientMsgId: cmid1, body: 'سلام از A 🌊' }, (e, r) => { ack2 = { e, r }; });
  await sleep(300);
  const bDup = await bPromise2;
  check('پاسخ duplicate=true و همان پیام', ack2?.r?.ok === true && ack2.r.duplicate === true && ack2.r.message.serverSeq === 1);
  check('هیچ broadcast تکراری برای B نیامد', bDup === null);

  // ۶) ارسال از مسیر REST
  console.log('۶) ارسال از مسیر REST (fallback)');
  const bPromise3 = waitForEvent(wsB, 'message.new');
  const rest = await api('POST', `/conversations/${convId}/messages`, {
    token: A.accessToken,
    body: { clientMsgId: 'aaaa1111-0000-4000-8000-000000000002', body: 'پیام REST' },
  });
  const bMsg3 = await bPromise3;
  check('REST 201 + duplicate=false', rest.status === 201 && rest.data?.duplicate === false, `status=${rest.status} body=${JSON.stringify(rest.data).slice(0, 150)}`);
  check('B دوباره بلادرنگ گرفت', bMsg3 && bMsg3.message.body === 'پیام REST' && bMsg3.message.serverSeq === 2);

  // ۷) صفحه‌بندی cursor
  console.log('۷) صفحه‌بندی cursor');
  for (let i = 3; i <= 7; i++) {
    await api('POST', `/conversations/${convId}/messages`, {
      token: A.accessToken,
      body: { clientMsgId: `aaaa1111-0000-4000-8000-00000000000${i}`, body: `msg ${i}` },
    });
  }
  const page1 = await api('GET', `/conversations/${convId}/messages?limit=3`, { token: B.accessToken });
  const page2 = await api('GET', `/conversations/${convId}/messages?limit=3&before=${page1.data.nextBefore}`, { token: B.accessToken });
  check('صفحه ۱: ۳ پیام آخر با hasMore', page1.data.messages.length === 3 && page1.data.hasMore === true);
  check('صفحه ۲: ادامه صحیح', page2.data.messages.length === 3 && page2.data.messages[0].serverSeq === 2, JSON.stringify(page2.data.messages.map((m) => m.serverSeq)));
  const seqs = [...page2.data.messages, ...page1.data.messages].map((m) => m.serverSeq);
  const monotonic = seqs.every((s, i) => i === 0 || s > seqs[i - 1]);
  check('صفحه‌ها بدون همپوشانی و صعودی', monotonic && new Set(seqs).size === seqs.length, JSON.stringify(seqs));

  // ۸) خواندن + شمارنده نخوانده
  console.log('۸) markRead و unreadCount');
  const listBefore = await api('GET', '/conversations', { token: B.accessToken });
  const unreadBefore = listBefore.data.find((c) => c.id === convId)?.unreadCount ?? -1;
  await api('POST', `/conversations/${convId}/read`, { token: B.accessToken, body: { lastReadSeq: 7 } });
  const listAfter = await api('GET', '/conversations', { token: B.accessToken });
  const unreadAfter = listAfter.data.find((c) => c.id === convId)?.unreadCount ?? -1;
  check('unreadCount از ۷ به ۰ رسید', unreadBefore === 7 && unreadAfter === 0, `${unreadBefore} → ${unreadAfter}`);

  // ۹) امنیت: دسترسی غیرعضو
  console.log('۹) امنیت — دسترسی غیرعضو');
  const C = await login('09121110003');
  const forbidden = await api('GET', `/conversations/${convId}/messages`, { token: C.accessToken });
  check('غیرعضو → 403', forbidden.status === 403 && forbidden.data.error.code === 'NOT_A_PARTICIPANT');

  // ۱۰) WS با توکن نامعتبر → قطع
  console.log('۱۰) WS با توکن نامعتبر');
  const badWs = await new Promise((resolve) => {
    const s = io('http://localhost:3000', { auth: { token: 'invalid-token' }, transports: ['websocket'] });
    let sawError = false;
    s.on('ws.error', () => { sawError = true; });
    s.on('disconnect', () => resolve(sawError || 'disconnected'));
    setTimeout(() => resolve(s.connected ? 'still-connected' : 'no-disconnect-event'), 4000);
  });
  check('WS نامعتبر قطع شد', badWs === true || badWs === 'disconnected');

  wsA.disconnect();
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
