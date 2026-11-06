/**
 * k6 — تست بار API پیام‌رسانی دل (گام ۱۰)
 * هدف سند ۰۱: p95 ارسال پیام < ۳۰۰ms
 * (سنجش RTT کامل «ارسال→نمایش روی WS» با scripts/load/probe.js انجام می‌شود.)
 *
 * اجرا:
 *   k6 run -e BASE=http://localhost:3000 -e PHONE_PREFIX=+98915 \
 *          -e PAIRS=100 -e RATE=200 -e DURATION=30s scripts/load/k6-messages.js
 * نکته: برای setup، سرور باید OTP_PER_IP_LIMIT بالا داشته باشد (مثلاً ۱۰۰۰۰).
 */
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE || 'http://localhost:3000';
const PREFIX = __ENV.PHONE_PREFIX || '+98915';
const PAIRS = Number(__ENV.PAIRS || 100);

export const options = {
  scenarios: {
    messaging: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 200), // پیام در ثانیه
      timeUnit: '1s',
      duration: __ENV.DURATION || '30s',
      preAllocatedVUs: 50,
      maxVUs: 400,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  const users = [];
  for (let i = 0; i < PAIRS * 2; i++) {
    const phone = `${PREFIX}${String(Date.now()).slice(-7)}${String(i).padStart(3, '0')}`;
    const req = http.post(`${BASE}/api/v1/auth/otp/request`, JSON.stringify({ phone }), {
      headers: { 'Content-Type': 'application/json' },
    });
    const code = req.json('devCode');
    const v = http.post(
      `${BASE}/api/v1/auth/otp/verify`,
      JSON.stringify({ phone, code, platform: 'windows', deviceName: 'k6' }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    check(v, { 'login ok': (r) => r.status === 200 });
    users.push({ accessToken: v.json('accessToken'), userId: v.json('user.id') });
  }
  const pairs = [];
  for (let p = 0; p < PAIRS; p++) {
    const a = users[p * 2];
    const b = users[p * 2 + 1];
    const conv = http.post(`${BASE}/api/v1/conversations`, JSON.stringify({ userId: b.userId }), {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${a.accessToken}`,
      },
    });
    check(conv, { 'conv ok': (r) => r.status === 200 || r.status === 201 });
    pairs.push({ a, convId: conv.json('id') });
  }
  return { pairs };
}

export default function (data) {
  const pair = data.pairs[Math.floor(Math.random() * data.pairs.length)];
  const clientMsgId = `${__VU}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = http.post(
    `${BASE}/api/v1/conversations/${pair.convId}/messages`,
    JSON.stringify({ clientMsgId, body: 'k6 بار ' + clientMsgId.slice(-6) }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pair.a.accessToken}`,
      },
    },
  );
  check(res, { 'send ok': (r) => r.status === 200 || r.status === 201 });
}
