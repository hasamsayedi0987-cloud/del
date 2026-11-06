/**
 * Del — تست دود گام ۹: هوش مصنوعی (ترجمه / اصلاح / پیشنهاد / خلاصه)
 * اجرا:  node scripts/smoke-step9.js
 * پیش‌نیاز: PostgreSQL روشن (:55432) — نمونه API اختصاصی خودش بوت می‌کند
 *
 *   :3002  API با AI_WEBHOOK_URL=http://127.0.0.1:3998/ai و AI_RATE_PER_MIN=20
 *   :3998  سرویس webhook AI قابل‌برنامه‌ریزی (پاسخ موفق/خطا)
 *
 * پوشش:
 *   A) بدون رضایت → 403 AI_CONSENT_REQUIRED روی همه قابلیت‌ها (هیچ محتوایی ارسال نمی‌شود)
 *   B) رضایت کلی → translate/fix/suggest/summarize موفق با provider=webhook
 *   C) رضایت گفتگو-محور: override خاموش در یک گفتگو → 403؛ روشن در گفتگوی دیگر → 200
 *   D) پیام E2EE → 422 AI_E2EE_UNAVAILABLE (سرور محتوا را نمی‌فهمد)
 *   E) خطای provider → 502 AI_PROVIDER_ERROR؛ مصرف ok=false ثبت می‌شود
 *   F) محدودیت نرخ → 429 AI_RATE_LIMITED
 *   G) غیرعضو → 403 NOT_A_MEMBER؛ پیام ناموجود → 404
 *   H) گزارش مصرف GET /ai/usage (جمع کاراکتر و رکوردها)
 *   I) خوانده‌نشده: summarize unreadOnly؛ نبود پیام قابل‌خواندن → 422 AI_NOTHING_TO_READ
 *   J) دوباره لغو رضایت → قابلیت‌ها 403 می‌دهند
 */
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const API_PORT = 3002;
const HOOK_PORT = 3998;
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

async function api(method, p, { token, body } = {}) {
  const res = await fetch(`${BASE}/api/v1${p}`, {
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

async function login(phone, deviceName = 'smoke9') {
  const req = await api('POST', '/auth/otp/request', { body: { phone } });
  const code = req.data.devCode;
  const verify = await api('POST', '/auth/otp/verify', {
    body: { phone, code, platform: 'android', deviceName },
  });
  if (verify.status !== 200) throw new Error(`login failed for ${phone}`);
  return verify.data;
}

const uuid = () => crypto.randomUUID();

// ————— سرویس webhook AI قابل‌برنامه‌ریزی —————
let aiMode = 'ok'; // ok | fail
let aiCalls = []; // بدنه‌های دریافتی
const hook = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/ai') {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw); } catch { /* بدنه خراب */ }
      aiCalls.push(body);
      res.writeHead(aiMode === 'ok' ? 200 : 500, { 'Content-Type': 'application/json' });
      if (aiMode === 'ok') {
        const label = {
          translate: `[ترجمهٔ سرویس آزمایشی → ${body.target}] ${body.user}`,
          fix: `[متن اصلاح‌شده] ${body.user}`,
          suggest: 'جواب بله\nجواب نه\nجواب شاید',
          summarize: `خلاصهٔ سرویس آزمایشی از ${body.user.split('\n').filter((x) => x.includes(': ')).length} پیام`,
        }[body.feature] ?? 'پاسخ نامشخص';
        res.end(JSON.stringify({ text: label, usage: { promptTokens: 11, completionTokens: 22 } }));
      } else {
        res.end('{"error":"down"}');
      }
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
      AI_WEBHOOK_URL: `http://127.0.0.1:${HOOK_PORT}/ai`,
      AI_RATE_PER_MIN: '20',
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
  console.log(`\n— سرویس AI آزمایشی (webhook) روی :${HOOK_PORT} —`);

  try {
    api1 = await bootApi(API_PORT);
    console.log(`— API روی :${API_PORT} با AI_WEBHOOK_URL —\n`);

    const rnd = String(Date.now()).slice(-7);
    const A = await login(`+98972${rnd}01`, 'smoke9-a');
    const B = await login(`+98972${rnd}02`, 'smoke9-b');
    const C = await login(`+98972${rnd}03`, 'smoke9-c');
    const D = await login(`+98972${rnd}04`, 'smoke9-d');

    // ————— A) بدون رضایت —————
    console.log('A) بدون رضایت — هیچ قابلیتی پاسخ نمی‌دهد');
    const st0 = await api('GET', '/ai/status', { token: A.accessToken });
    check('GET /ai/status — available=true (provider webhook) و رضایت=false',
      st0.status === 200 && st0.data?.available === true && st0.data?.provider === 'webhook' && st0.data?.globalConsent === false);

    const conv = await api('POST', '/conversations', { token: A.accessToken, body: { userId: B.user.id } });
    const convId = conv.data.id;
    const m1 = await api('POST', `/conversations/${convId}/messages`, {
      token: A.accessToken, body: { clientMsgId: uuid(), body: 'سلام دنیا — پیام آزمون ترجمه' },
    });
    check('پیام آزمون ارسال شد', m1.status === 201 && Boolean(m1.data?.message?.id));

    const callsBefore = aiCalls.length;
    const tr0 = await api('POST', '/ai/translate', { token: A.accessToken, body: { messageId: m1.data.message.id } });
    check('ترجمه بدون رضایت → 403 AI_CONSENT_REQUIRED',
      tr0.status === 403 && tr0.data?.error?.code === 'AI_CONSENT_REQUIRED');
    const fx0 = await api('POST', '/ai/fix', { token: A.accessToken, body: { text: 'slam' } });
    check('اصلاح بدون رضایت → 403', fx0.status === 403 && fx0.data?.error?.code === 'AI_CONSENT_REQUIRED');
    const sg0 = await api('POST', '/ai/suggest', { token: A.accessToken, body: { conversationId: convId } });
    check('پیشنهاد بدون رضایت → 403', sg0.status === 403);
    const sm0 = await api('POST', '/ai/summarize', { token: A.accessToken, body: { conversationId: convId } });
    check('خلاصه بدون رضایت → 403', sm0.status === 403);
    check('بدون رضایت هیچ محتوایی به سرویس AI نرفت', aiCalls.length === callsBefore);
    const usage0 = await api('GET', '/ai/usage', { token: A.accessToken });
    check('مصرف ثبت نشده (بدون رضایت صفر رکورد)', usage0.status === 200 && usage0.data?.total === 0);

    // ————— B) رضایت کلی — همه قابلیت‌ها —————
    console.log('B) رضایت کلی → قابلیت‌ها فعال');
    const cs = await api('PATCH', '/ai/consent', { token: A.accessToken, body: { enabled: true } });
    check('PATCH /ai/consent → ok و aiConsent=true', cs.status === 200 && cs.data?.aiConsent === true);
    const me = await api('GET', '/users/me', { token: A.accessToken });
    check('users/me هم aiConsent=true را نشان می‌دهد', me.status === 200 && me.data?.aiConsent === true);

    const tr = await api('POST', '/ai/translate', { token: A.accessToken, body: { messageId: m1.data.message.id, target: 'en' } });
    check('ترجمه موفق — متن سرویس آزمایشی برگشت',
      tr.status === 200 && tr.data?.feature === 'translate' && tr.data?.provider === 'webhook'
      && String(tr.data?.text ?? '').includes('[ترجمهٔ سرویس آزمایشی') && String(tr.data?.text ?? '').includes('سلام دنیا'));
    check('پیکربندی به سرویس رفت (feature/target)', aiCalls.at(-1)?.feature === 'translate' && aiCalls.at(-1)?.target === 'انگلیسی');

    const fx = await api('POST', '/ai/fix', { token: A.accessToken, body: { text: '  سلام   دنیا  ' } });
    check('اصلاح موفق', fx.status === 200 && fx.data?.feature === 'fix' && String(fx.data?.text).includes('[متن اصلاح‌شده]'));

    const m2 = await api('POST', `/conversations/${convId}/messages`, {
      token: B.accessToken, body: { clientMsgId: uuid(), body: 'پیام از طرف ب برای پیشنهاد' },
    });
    const sg = await api('POST', '/ai/suggest', { token: A.accessToken, body: { conversationId: convId, count: 2 } });
    check('پیشنهاد موفق — فقط ۲ خط',
      sg.status === 200 && sg.data?.text.split('\n').length === 2 && sg.data?.text.includes('جواب بله'));

    const sm = await api('POST', '/ai/summarize', { token: A.accessToken, body: { conversationId: convId, limit: 10 } });
    check('خلاصه موفق', sm.status === 200 && sm.data?.feature === 'summarize' && String(sm.data?.text).includes('خلاصهٔ سرویس آزمایشی'));

    // ————— C) رضایت گفتگو-محور —————
    console.log('C) رضایت گفتگو-محور (override)');
    const conv2 = await api('POST', '/conversations', { token: A.accessToken, body: { userId: C.user.id } });
    const conv2Id = conv2.data.id;
    await api('POST', `/conversations/${conv2Id}/messages`, {
      token: C.accessToken, body: { clientMsgId: uuid(), body: 'پیام سی در گفتگوی دوم' },
    });
    const sg2 = await api('POST', '/ai/suggest', { token: A.accessToken, body: { conversationId: conv2Id } });
    check('گفتگوی دیگر با رضایت کلی → 200', sg2.status === 200);
    const off = await api('PATCH', `/conversations/${conv2Id}/ai-consent`, { token: A.accessToken, body: { enabled: false } });
    check('override خاموش در گفتگوی ۲', off.status === 200 && off.data?.aiConsent === false);
    const sg3 = await api('POST', '/ai/suggest', { token: A.accessToken, body: { conversationId: conv2Id } });
    check('پیشنهاد در گفتگوی ۲ → 403 (حتی با رضایت کلی)', sg3.status === 403 && sg3.data?.error?.code === 'AI_CONSENT_REQUIRED');
    const sg4 = await api('POST', '/ai/suggest', { token: A.accessToken, body: { conversationId: convId } });
    check('گفتگوی ۱ بدون override → همچنان 200', sg4.status === 200);
    const on = await api('PATCH', `/conversations/${conv2Id}/ai-consent`, { token: A.accessToken, body: { enabled: true } });
    const sg5 = await api('POST', '/ai/suggest', { token: A.accessToken, body: { conversationId: conv2Id } });
    check('override روشن → 200 دوباره', on.status === 200 && sg5.status === 200);
    const nu = await api('PATCH', `/conversations/${conv2Id}/ai-consent`, { token: A.accessToken, body: {} });
    check('override null → تبعیت از رضایت کلی (200)', nu.status === 200 && nu.data?.aiConsent === null);

    // ————— D) پیام E2EE —————
    console.log('D) پیام رمزنگاری‌شدهٔ سرتاسری');
    const e2eeMsg = await api('POST', `/conversations/${convId}/messages`, {
      token: B.accessToken, body: { clientMsgId: uuid(), body: 'fake-e2ee-envelope', isE2ee: true },
    });
    if (e2eeMsg.status !== 201) {
      // اگر API ارسال مستقیم isE2ee را نمی‌پذیرد، مستقیم در DB درج می‌کنیم
      const { Client } = require(path.join(API_DIR, 'node_modules', 'pg'));
      const c = new Client({ host: 'localhost', port: 55432, user: 'postgres', password: 'smokepw', database: 'del' });
      await c.connect();
      await c.query(
        'INSERT INTO "Message" (id, "conversationId", "senderId", "serverSeq", "clientMsgId", type, body, "isE2ee") VALUES ($1,$2,$3,$4,$5,$6,$7,true)',
        [uuid(), convId, B.user.id, (e2eeMsg.status === 201 ? 0 : 99) + 1000, uuid(), 'text', 'envelope-xyz'],
      );
      await c.end();
    }
    const msgList = await api('GET', `/conversations/${convId}/messages`, { token: A.accessToken });
    const e2eeRow = (msgList.data?.messages ?? []).find((x) => x.isE2ee);
    check('پیام E2EE در تاریخچه هست', Boolean(e2eeRow));
    const trE2ee = await api('POST', '/ai/translate', { token: A.accessToken, body: { messageId: e2eeRow.id } });
    check('ترجمهٔ پیام E2EE → 422 AI_E2EE_UNAVAILABLE',
      trE2ee.status === 422 && trE2ee.data?.error?.code === 'AI_E2EE_UNAVAILABLE');
    const e2eeBefore = aiCalls.length;
    const smE2eeOnly = await api('POST', '/ai/summarize', { token: A.accessToken, body: { conversationId: convId, limit: 1 } });
    void smE2eeOnly;
    check('محتوای پاکت رمز هرگز به سرویس AI نرفت', !aiCalls.slice(e2eeBefore).some((c) => String(c.user).includes('envelope-xyz')));

    // ————— E) خطای provider —————
    console.log('E) خطای provider → fallback');
    aiMode = 'fail';
    const trFail = await api('POST', '/ai/translate', { token: A.accessToken, body: { messageId: m1.data.message.id } });
    check('خطای سرویس → 502 AI_PROVIDER_ERROR',
      trFail.status === 502 && trFail.data?.error?.code === 'AI_PROVIDER_ERROR');
    aiMode = 'ok';
    const usageF = await api('GET', '/ai/usage?limit=200', { token: A.accessToken });
    const failRow = (usageF.data?.items ?? []).find((x) => x.ok === false);
    check('مصرف ناموفق هم ثبت شد (ok=false، provider=webhook)',
      Boolean(failRow) && failRow.feature === 'translate' && failRow.provider === 'webhook');

    // ————— F) محدودیت نرخ —————
    console.log('F) محدودیت نرخ (سقف ۲۰ در دقیقه)');
    await api('PATCH', '/ai/consent', { token: B.accessToken, body: { enabled: true } });
    let got429 = false;
    let fixCalls = 0;
    for (let i = 0; i < 30; i++) {
      const r = await api('POST', '/ai/fix', { token: B.accessToken, body: { text: 'کمی بعد' } });
      fixCalls++;
      if (r.status === 429 && r.data?.error?.code === 'AI_RATE_LIMITED') { got429 = true; break; }
      if (r.status === 403) break; // رضایت فعال نشد — نباید رخ دهد
    }
    check('عبور از سقف → 429 AI_RATE_LIMITED', got429);
    check('سقف دقیقاً روی ۲۱مین فراخوانی خورد', got429 && fixCalls === 21);

    // ————— G) مجوزها —————
    console.log('G) مجوزها');
    const stranger = await api('POST', '/ai/suggest', { token: C.accessToken, body: { conversationId: convId } });
    check('غیرعضو → 403 NOT_A_MEMBER', stranger.status === 403 && stranger.data?.error?.code === 'NOT_A_MEMBER');
    const ghost = await api('POST', '/ai/translate', { token: A.accessToken, body: { messageId: uuid() } });
    check('پیام ناموجود → 404 MESSAGE_NOT_FOUND', ghost.status === 404 && ghost.data?.error?.code === 'MESSAGE_NOT_FOUND');
    const noauth = await api('GET', '/ai/status');
    check('بدون توکن → 401', noauth.status === 401);

    // ————— I) خوانده‌نشده و نبودِ پیام قابل‌خواندن —————
    console.log('I) unreadOnly و AI_NOTHING_TO_READ');
    const conv3 = await api('POST', '/conversations', { token: A.accessToken, body: { userId: D.user.id } });
    check('گفتگوی خالی ساخته شد', conv3.status === 200 || conv3.status === 201);
    const sgEmpty = await api('POST', '/ai/suggest', { token: A.accessToken, body: { conversationId: conv3.data.id } });
    check('گفتگوی بدون پیام → 422 AI_NOTHING_TO_READ',
      sgEmpty.status === 422 && sgEmpty.data?.error?.code === 'AI_NOTHING_TO_READ');
    const emptyConvId = conv3.data.id;
    await api('POST', `/conversations/${emptyConvId}/messages`, {
      token: D.accessToken, body: { clientMsgId: uuid(), body: 'این پیام خوانده‌نشده د است' },
    });
    const smUnread = await api('POST', '/ai/summarize', {
      token: A.accessToken, body: { conversationId: emptyConvId, unreadOnly: true },
    });
    check('summarize unreadOnly — خلاصه از پیام خوانده‌نشده ساخته شد',
      smUnread.status === 200 && String(smUnread.data?.text).includes('خلاصهٔ سرویس آزمایشی'));
    const readAll = await api('GET', `/conversations/${emptyConvId}/messages`, { token: A.accessToken });
    const lastSeq = readAll.data?.messages?.at(-1)?.serverSeq ?? 1;
    await api('POST', `/conversations/${emptyConvId}/read`, { token: A.accessToken, body: { lastReadSeq: lastSeq } });
    const smUnread2 = await api('POST', '/ai/summarize', {
      token: A.accessToken, body: { conversationId: emptyConvId, unreadOnly: true },
    });
    check('پس از خواندن، unreadOnly → 422', smUnread2.status === 422);

    // ————— H) گزارش مصرف —————
    console.log('H) گزارش مصرف');
    const usage = await api('GET', '/ai/usage?limit=200', { token: A.accessToken });
    const feats = new Set((usage.data?.items ?? []).map((x) => x.feature));
    check('usage — رکوردها و جمع کاراکتر',
      usage.status === 200 && usage.data?.total > 0 && (usage.data?.charsIn ?? 0) > 0
      && feats.has('translate') && feats.has('fix') && feats.has('suggest') && feats.has('summarize'));
    check('usage — توکن‌های سرویس ثبت شده‌اند',
      (usage.data?.items ?? []).some((x) => x.promptTokens === 11 && x.completionTokens === 22));
    const usageB = await api('GET', '/ai/usage', { token: B.accessToken });
    check('usage کاربر ب — فقط ۲۰ فراخوانی موفق قبل از 429',
      usageB.status === 200 && usageB.data?.total === 20);
    const usageD = await api('GET', '/ai/usage', { token: D.accessToken });
    check('usage کاربر بی‌سرویس — صفر (ایزوله‌سازی)', usageD.status === 200 && usageD.data?.total === 0);

    // ————— J) لغو رضایت —————
    console.log('J) لغو رضایت');
    const off2 = await api('PATCH', '/ai/consent', { token: A.accessToken, body: { enabled: false } });
    check('لغو رضایت کلی', off2.status === 200 && off2.data?.aiConsent === false);
    const trOff = await api('POST', '/ai/translate', { token: A.accessToken, body: { messageId: m1.data.message.id } });
    check('ترجمه پس از لغو → 403 (حتی با override گفتگو)', trOff.status === 403 && trOff.data?.error?.code === 'AI_CONSENT_REQUIRED');
    const finalUsage = await api('GET', '/ai/usage', { token: A.accessToken });
    const afterOff = finalUsage.data?.total ?? 0;
    await api('POST', '/ai/fix', { token: A.accessToken, body: { text: 'تست نهایی پس از لغو رضایت' } });
    const finalUsage2 = await api('GET', '/ai/usage', { token: A.accessToken });
    check('پس از لغو، هیچ فراخوانی AI ثبت/ارسال نشد', finalUsage2.data?.total === afterOff);
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
