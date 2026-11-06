/**
 * Del — تست دود گام ۶: تماس صوتی/تصویری ۱:۱ (signaling WS + توکن LiveKit + تاریخچه + قوانین)
 * اجرا:  node scripts/smoke-step6.js
 * پیش‌نیاز: API روی :3000 با LIVEKIT_URL/API_KEY/API_SECRET (و PostgreSQL روشن)
 *
 * خودش دو نمونه موقت هم بوت می‌کند:
 *   :3001 با CALL_RING_TIMEOUT_SEC=3  → تست timeout زنگ
 *   :3002 بدون LIVEKIT_*              → تست 503 CALLS_DISABLED
 */
const { io } = require('socket.io-client');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const path = require('node:path');

const BASE = 'http://localhost:3000';
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

async function api(base, method, path, { token, body } = {}) {
  const res = await fetch(`${base}/api/v1${path}`, {
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

async function login(base, phone) {
  const root = base.replace(/\/api\/v1$/, ''); // base ممکن است /api/v1 داشته باشد
  const req = await api(root, 'POST', '/auth/otp/request', { body: { phone } });
  const code = req.data.devCode;
  const verify = await api(root, 'POST', '/auth/otp/verify', {
    body: { phone, code, platform: 'android', deviceName: 'smoke6' },
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

/** تأیید کامل امضای HS256 + استخراج ادعاهای توکن LiveKit */
function verifyLkJwt(token, secret) {
  try {
    const [h, p, s] = token.split('.');
    const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    return { ok: s === expected, claims };
  } catch {
    return { ok: false, claims: null };
  }
}

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
      ...extraEnv,
    },
    stdio: 'ignore',
    detached: false,
  });
  // انتظار برای health
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
  console.log('\n———— گام ۶: تماس صوتی/تصویری —————\n');

  const secret = 'devsecret-0123456789abcdef0123456789abcdef';
  const LK = { LIVEKIT_URL: 'ws://localhost:7880', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: secret };

  const A = await login(BASE, '+989720000001');
  const B = await login(BASE, '+989720000002');
  const C = await login(BASE, '+989720000003');

  const userB = (await api(BASE, 'GET', '/users/by-phone/+989720000002', { token: A.accessToken })).data;
  const userC = (await api(BASE, 'GET', '/users/by-phone/+989720000003', { token: A.accessToken })).data;

  const conv = (await api(BASE, 'POST', '/conversations', { token: A.accessToken, body: { userId: userB.id } })).data;
  const convCB = (await api(BASE, 'POST', '/conversations', { token: C.accessToken, body: { userId: userB.id } })).data;
  const group = (await api(BASE, 'POST', '/conversations/group', {
    token: A.accessToken, body: { title: 'گروه دود ۶', memberUserIds: [userB.id, userC.id] },
  })).data;

  const wsA = await connectWs('http://localhost:3000', A.accessToken);
  const wsB = await connectWs('http://localhost:3000', B.accessToken);
  const wsC = await connectWs('http://localhost:3000', C.accessToken);

  // ————— قوانین ورودی —————
  console.log('— قوانین ورودی و مجوزها');
  const noToken = await api(BASE, 'POST', '/calls', { body: { conversationId: conv.id, kind: 'audio' } });
  check('بدون توکن → 401', noToken.status === 401, `got ${noToken.status}`);

  const badConv = await api(BASE, 'POST', '/calls', {
    token: A.accessToken, body: { conversationId: '00000000-0000-4000-8000-000000000000', kind: 'audio' },
  });
  check('گفتگوی ناموجود → 404', badConv.status === 404, `got ${badConv.status}`);

  const outsider = await api(BASE, 'POST', '/calls', {
    token: C.accessToken, body: { conversationId: conv.id, kind: 'audio' },
  });
  check('غیرعضو شروع کند → 403 NOT_A_PARTICIPANT', outsider.status === 403 && outsider.data?.error?.code === 'NOT_A_PARTICIPANT', JSON.stringify(outsider.data));

  const groupCall = await api(BASE, 'POST', '/calls', {
    token: A.accessToken, body: { conversationId: group.id, kind: 'audio' },
  });
  check('تماس گروهی → 409 NOT_DIRECT', groupCall.status === 409 && groupCall.data?.error?.code === 'NOT_DIRECT', `got ${groupCall.status}`);

  const badKind = await api(BASE, 'POST', '/calls', {
    token: A.accessToken, body: { conversationId: conv.id, kind: 'fax' },
  });
  check('kind نامعتبر → 400', badKind.status === 400, `got ${badKind.status}`);

  // ————— جریان کامل صوتی —————
  console.log('— جریان کامل: زنگ → پاسخ → پایان');
  // نکته: eventهای WS هم‌زمان با پردازش REST emit می‌شوند — listener را قبل از زدن درخواست می‌بندیم
  const incomingP = waitForEvent(wsB, 'call.incoming');
  const incomingAP = waitForEvent(wsA, 'call.incoming', 1500);
  const start = await api(BASE, 'POST', '/calls', {
    token: A.accessToken, body: { conversationId: conv.id, kind: 'audio' },
  });
  check('شروع تماس → 201 ringing', start.status === 201 && start.data?.status === 'ringing', JSON.stringify(start.data));
  check('گیرنده درست است', start.data?.calleeId === userB.id);
  const callId = start.data?.id;

  const incoming = await incomingP;
  check('B تماس ورودی را در WS می‌شنود', !!incoming && incoming.call?.id === callId && incoming.caller?.id === A.user.id);
  const incomingA = await incomingAP;
  check('A خودش زنگ را نمی‌شنود (بدون echo)', incomingA === null);

  const busy = await api(BASE, 'POST', '/calls', {
    token: A.accessToken, body: { conversationId: conv.id, kind: 'audio' },
  });
  check('شروع مجدد هنگام زنگ → 409 CALL_BUSY', busy.status === 409 && busy.data?.error?.code === 'CALL_BUSY', `got ${busy.status}`);

  const busyC = await api(BASE, 'POST', '/calls', {
    token: C.accessToken, body: { conversationId: convCB.id, kind: 'audio' },
  });
  check('تماس به B مشغول → 409 CALL_BUSY', busyC.status === 409 && busyC.data?.error?.code === 'CALL_BUSY', `got ${busyC.status}`);

  const accByCaller = await api(BASE, 'POST', `/calls/${callId}/accept`, { token: A.accessToken });
  check('پاسخ توسط تماس‌گیرنده → 403 NOT_CALLEE', accByCaller.status === 403 && accByCaller.data?.error?.code === 'NOT_CALLEE', `got ${accByCaller.status}`);

  const accByC = await api(BASE, 'POST', `/calls/${callId}/accept`, { token: C.accessToken });
  check('پاسخ توسط شخص ثالث → 403 NOT_CALLEE', accByC.status === 403, `got ${accByC.status}`);

  const accAP = waitForEvent(wsA, 'call.accepted');
  const accBP = waitForEvent(wsB, 'call.accepted');
  const accB = await api(BASE, 'POST', `/calls/${callId}/accept`, { token: B.accessToken });
  check('پاسخ گیرنده → 200 active', accB.status === 200 && accB.data?.call?.status === 'active', JSON.stringify(accB.data?.call?.status));
  check('پاسخ شامل URL و room درست', accB.data?.url === 'ws://localhost:7880' && accB.data?.room === `call:${callId}`, JSON.stringify({ url: accB.data?.url, room: accB.data?.room }));
  check('connectedAt ثبت شد', !!accB.data?.call?.connectedAt);

  const wsAccA = await accAP;
  check('A رویداد call.accepted را می‌شنود', !!wsAccA && wsAccA.call?.id === callId && !!wsAccA.token);
  const wsAccB = await accBP;
  check('B هم call.accepted را می‌شنود', !!wsAccB && !!wsAccB.token);

  // تأیید کامل توکن‌های LiveKit (امضای HS256 + ادعاهای spec)
  const vA = verifyLkJwt(wsAccA.token, secret);
  const vB = verifyLkJwt(accB.data.token, secret);
  check('توکن LiveKit امضای معتبر دارد', vA.ok && vB.ok);
  check('iss = apiKey و sub = هویت کاربر', vA.claims?.iss === 'devkey' && vA.claims?.sub === A.user.id && vB.claims?.sub === B.user.id, JSON.stringify({ iss: vA.claims?.iss }));
  check('video.roomJoin=true و room=call:{id}', vA.claims?.video?.roomJoin === true && vA.claims?.video?.room === `call:${callId}`);
  check('توکن کوتاه‌عمر (~1 ساعت) است', vA.claims?.exp && vA.claims?.exp - Date.now() / 1000 > 3000 && vA.claims?.exp - Date.now() / 1000 <= 3600 + 15, `ttl=${Math.round((vA.claims?.exp - Date.now() / 1000) || 0)}`);
  check('توکن دو طرف متفاوت است (identity جدا)', wsAccA.token !== accB.data.token);

  const accAgain = await api(BASE, 'POST', `/calls/${callId}/accept`, { token: B.accessToken });
  check('پاسخ مجدد → 409 INVALID_STATE', accAgain.status === 409, `got ${accAgain.status}`);

  const endByC = await api(BASE, 'POST', `/calls/${callId}/end`, { token: C.accessToken });
  check('پایان توسط شخص ثالث → 403', endByC.status === 403 && endByC.data?.error?.code === 'NOT_CALL_PARTICIPANT', `got ${endByC.status}`);

  const endedBP = waitForEvent(wsB, 'call.ended');
  const endA = await api(BASE, 'POST', `/calls/${callId}/end`, { token: A.accessToken });
  check('پایان توسط تماس‌گیرنده → 200 ended/hangup', endA.status === 200 && endA.data?.status === 'ended' && endA.data?.endReason === 'hangup', JSON.stringify(endA.data?.endReason));
  check('durationS محاسبه شد', typeof endA.data?.durationS === 'number' && endA.data.durationS >= 0);
  const endedB = await endedBP;
  check('B رویداد call.ended (hangup) را می‌شنود', !!endedB && endedB.reason === 'hangup' && endedB.callId === callId);

  // ————— تماس تصویری —————
  console.log('— تماس تصویری');
  const vStart = await api(BASE, 'POST', '/calls', {
    token: A.accessToken, body: { conversationId: conv.id, kind: 'video' },
  });
  const vAcc = await api(BASE, 'POST', `/calls/${vStart.data.id}/accept`, { token: B.accessToken });
  check('تماس تصویری برقرار می‌شود', vStart.data?.kind === 'video' && vAcc.data?.call?.status === 'active');
  const vEnd = await api(BASE, 'POST', `/calls/${vStart.data.id}/end`, { token: B.accessToken });
  check('پایان توسط گیرنده هم ممکن است', vEnd.status === 200 && vEnd.data?.endReason === 'hangup');

  // ————— مشغولی در تماس فعال —————
  console.log('— مشغولی');
  const bStart = await api(BASE, 'POST', '/calls', {
    token: A.accessToken, body: { conversationId: conv.id, kind: 'audio' },
  });
  await api(BASE, 'POST', `/calls/${bStart.data.id}/accept`, { token: B.accessToken });
  const busyActive = await api(BASE, 'POST', '/calls', {
    token: C.accessToken, body: { conversationId: convCB.id, kind: 'audio' },
  });
  check('تماس به کاربر در تماس فعال → 409 CALL_BUSY', busyActive.status === 409 && busyActive.data?.error?.code === 'CALL_BUSY', `got ${busyActive.status}`);
  await api(BASE, 'POST', `/calls/${bStart.data.id}/end`, { token: A.accessToken });

  // ————— رد و لغو —————
  console.log('— رد / لغو');
  const rStart = await api(BASE, 'POST', '/calls', {
    token: A.accessToken, body: { conversationId: conv.id, kind: 'audio' },
  });
  await waitForEvent(wsB, 'call.incoming');
  const rEndedP = waitForEvent(wsA, 'call.ended');
  const rej = await api(BASE, 'POST', `/calls/${rStart.data.id}/reject`, { token: B.accessToken });
  check('رد توسط گیرنده → 204', rej.status === 204, `got ${rej.status}`);
  const rEnded = await rEndedP;
  check('A رویداد call.ended (reject) را می‌شنود', !!rEnded && rEnded.reason === 'reject');

  const cStart = await api(BASE, 'POST', '/calls', {
    token: A.accessToken, body: { conversationId: conv.id, kind: 'audio' },
  });
  await waitForEvent(wsB, 'call.incoming');
  const cEndedP = waitForEvent(wsB, 'call.ended');
  const canc = await api(BASE, 'POST', `/calls/${cStart.data.id}/cancel`, { token: A.accessToken });
  check('لغو توسط تماس‌گیرنده → 204', canc.status === 204, `got ${canc.status}`);
  const cEnded = await cEndedP;
  check('B رویداد call.ended (cancel) را می‌شنود', !!cEnded && cEnded.reason === 'cancel');

  // ————— تاریخچه —————
  console.log('— تاریخچه');
  const hist = await api(BASE, 'GET', `/calls?conversationId=${conv.id}`, { token: A.accessToken });
  check('تاریخچه گفتگو حداقل ۵ تماس', (hist.data?.calls?.length ?? 0) >= 5, `got ${hist.data?.calls?.length}`);
  const times = (hist.data?.calls ?? []).map((c) => c.startedAt);
  check('مرتب‌شده از تازه به قدیم', times.every((t, i) => i === 0 || times[i - 1] >= t));
  const paged = await api(BASE, 'GET', `/calls?conversationId=${conv.id}&limit=2`, { token: A.accessToken });
  check('صفحه‌بندی: hasMore + nextBefore', paged.data?.hasMore === true && !!paged.data?.nextBefore, JSON.stringify({ hasMore: paged.data?.hasMore }));
  const histC = await api(BASE, 'GET', `/calls?conversationId=${conv.id}`, { token: C.accessToken });
  check('تاریخچه فقط تماس‌های خود کاربر', (histC.data?.calls?.length ?? 0) === 0);

  // ————— timeout زنگ (نمونه :3001 با زنگ ۳ ثانیه‌ای) —————
  console.log('— timeout زنگ (نمونه :3001)');
  const api1 = await bootApi(3001, { ...LK, CALL_RING_TIMEOUT_SEC: '3' });
  try {
    const wsA1 = await connectWs('http://localhost:3001', A.accessToken);
    const wsB1 = await connectWs('http://localhost:3001', B.accessToken);
    const tEndedAP = waitForEvent(wsA1, 'call.ended', 10000);
    const tEndedBP = waitForEvent(wsB1, 'call.ended', 12000);
    const tStart = await api('http://localhost:3001', 'POST', '/calls', {
      token: A.accessToken, body: { conversationId: conv.id, kind: 'audio' },
    });
    check('شروع تماس بدون پاسخ → 201', tStart.status === 201);
    const tEndedA = await tEndedAP;
    const tEndedB = await tEndedBP;
    check('زنگ بی‌پاسخ → call.ended با reason=timeout', !!tEndedA && tEndedA.reason === 'timeout' && tEndedA.callId === tStart.data.id, JSON.stringify(tEndedA?.reason));
    check('هر دو طرف timeout را می‌شنوند', !!tEndedB && tEndedB.reason === 'timeout');
    const tHist = await api('http://localhost:3001', 'GET', `/calls?conversationId=${conv.id}&limit=1`, { token: A.accessToken });
    check('وضعیت در تاریخچه = missed', tHist.data?.calls?.[0]?.status === 'missed', JSON.stringify(tHist.data?.calls?.[0]?.status));
    wsA1.disconnect();
    wsB1.disconnect();
  } finally {
    await killApi(api1);
  }

  // ————— نمونه بدون LiveKit (:3002) → 503 —————
  console.log('— تماس بدون پیکربندی LiveKit');
  const api2 = await bootApi(3002, {});
  try {
    const D = await login('http://localhost:3002', '+989720000004');
    const disabled = await api('http://localhost:3002', 'POST', '/calls', {
      token: D.accessToken, body: { conversationId: conv.id, kind: 'audio' },
    });
    check('بدون LIVEKIT_* → 503 CALLS_DISABLED', disabled.status === 503 && disabled.data?.error?.code === 'CALLS_DISABLED', `got ${disabled.status}`);
  } finally {
    await killApi(api2);
  }

  wsA.disconnect();
  wsB.disconnect();
  wsC.disconnect();

  // ————— نتیجه —————
  console.log(`\n———————————————`);
  console.log(`✅ پاس‌شده: ${PASS.length}   ❌ رد‌شده: ${FAIL.length}`);
  if (FAIL.length) {
    console.log('سناریوهای رد‌شده:');
    for (const f of FAIL) console.log(`  - ${f}`);
    process.exit(1);
  }
})().catch((e) => {
  console.error('خطای اجرای تست:', e);
  process.exit(1);
});
