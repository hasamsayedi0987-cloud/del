/**
 * Del — سنجش بار سبک (گام ۱۰)
 * هدف سند ۰۱: ارسال→نمایش p95 < ۳۰۰ms
 * اجرا: node scripts/load/probe.js [تعداد جفت] [مدت ثانیه]
 * روش: N جفت کاربر (هر جفت دو کاربر با WS) — کاربر A پیام می‌فرستد و لحظهٔ
 * دریافت روی WS کاربر B ثبت می‌شود (RTT اپلیکیشن). درصدگیر p50/p95/p99.
 */
const { io } = require('socket.io-client');

const BASE = process.env.DEL_BASE ?? 'http://localhost:3000';
const PAIRS = Number(process.argv[2] ?? 10);
const DURATION_S = Number(process.argv[3] ?? 15);
const API = `${BASE}/api/v1`;

const latencies = [];
let sent = 0;
let received = 0;
const sentAtByClient = new Map();

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function login(phone) {
  const req = await api('POST', '/auth/otp/request', { body: { phone } });
  const v = await api('POST', '/auth/otp/verify', {
    body: { phone, code: req.devCode, platform: 'windows', deviceName: 'load-probe' },
  });
  return v;
}

const uuid = () =>
  'dddd10ad-0000-4000-8000-' + Math.random().toString(16).slice(2, 14).padStart(12, '0');

function connectWs(token) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('ws timeout')), 10000);
  });
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

(async () => {
  console.log(`سنجش بار: ${PAIRS} جفت کاربر × ${DURATION_S} ثانیه`);
  const runTag = String(Date.now()).slice(-7);
  const sessions = [];

  for (let i = 0; i < PAIRS * 2; i++) {
    sessions.push(await login(`+98914${runTag}${String(i).padStart(2, '0')}`));
  }
  console.log(`${sessions.length} کاربر ساخته شد`);

  const pairs = [];
  for (let p = 0; p < PAIRS; p++) {
    const a = sessions[p * 2];
    const b = sessions[p * 2 + 1];
    const conv = await api('POST', '/conversations', {
      token: a.accessToken,
      body: { userId: b.user.id },
    });
    const wsB = await connectWs(b.accessToken);
    const convId = conv.id;
    wsB.on('message.new', (payload) => {
      if (payload.conversationId !== convId) return;
      const t0 = sentAtByClient.get(payload.message.clientMsgId);
      if (t0 !== undefined) {
        latencies.push(Date.now() - t0);
        received++;
      }
    });
    pairs.push({ a, convId });
  }
  console.log('WS گیرنده‌ها متصل شدند — شروع ارسال…');

  const timer = setInterval(() => {
    if (Date.now() - startTime > DURATION_S * 1000) {
      clearInterval(timer);
      setTimeout(finish, 1500);
      return;
    }
    for (const { a, convId } of pairs) {
      const clientMsgId = uuid();
      sentAtByClient.set(clientMsgId, Date.now());
      sent++;
      void api('POST', `/conversations/${convId}/messages`, {
        token: a.accessToken,
        body: { clientMsgId, body: 'پروب بار ' + clientMsgId.slice(0, 8) },
      }).catch(() => {});
    }
  }, 1000);
  const startTime = Date.now();

  function finish() {
    const sorted = [...latencies].sort((x, y) => x - y);
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    const p99 = percentile(sorted, 99);
    const lost = sent - received;
    const sloOk = p95 < 300;
    console.log('\n———— نتیجهٔ سنجش ————');
    console.log(`ارسال‌شده: ${sent}  دریافت‌شده: ${received}  گم‌شده: ${lost}`);
    console.log(`p50=${p50}ms  p95=${p95}ms  p99=${p99}ms`);
    console.log(sloOk ? '✅ هدف سند ۰۱ (p95 < ۳۰۰ms) برقرار است' : '❌ هدف p95 < ۳۰۰ms برقرار نشد');
    process.exit(sloOk ? 0 : 1);
  }
})().catch((e) => {
  console.error('خطا:', e.message);
  process.exit(1);
});
