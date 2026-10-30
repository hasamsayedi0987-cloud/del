/**
 * Del — تست دود گام ۸: رمزنگاری سرتاسری (E2EE) چت خصوصی + بازیابی حساب
 * اجرا:  node scripts/smoke-step8.js
 * پیش‌نیاز: PostgreSQL روشن (:55432) — نمونه API اختصاصی خودش بوت می‌کند
 *
 * پوشش:
 *   A) آپلود هویت + وضعیت + idempotency + کلیدهای یک‌بارمصرف (401/200)
 *   B) فهرست دستگاه‌ها + مصرف یگانه OTK در bundle
 *   C) توافق X3DH: session آغازگر/پاسخ‌گو — باز شدن پیام اول واقعی روی سیم
 *   D) سرور نابینا: در DB فقط ciphertext است — plaintext هرگز ذخیره نمی‌شود
 *   E) زنجیره پاسخ: B با همان session پاسخ می‌دهد؛ A باز می‌کند (DH ratchet)
 *   F) پیام ردشده (out-of-order) — skipped keys
 *   G) دستکاری ciphertext → باز شدن با خطا
 *   H) دریافت بلادرنگ روی WS + باز کردن زنده
 *   I) چنددستگاهی: دو دستگاه B + پاکت چندگانه + خود-دستگاه (پیام من روی دستگاه دیگرم)
 *   J) بازیابی حساب: پشتیبان + کلید بازیابی → همان هویت؛ کلید اشتباه رد می‌شود
 *   K) پیش‌نمایش امن: «🔒 پیام رمزنگاری‌شده» در لیست گفتگوها
 *   L) امنیت: پشتیبان هر کاربر فقط خودش؛ ریست هویت
 */
const { io } = require('socket.io-client');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');

const E2 = require('@del/e2ee');
const { webcrypto } = require('node:crypto');
const rng = (n) => { const b = new Uint8Array(n); webcrypto.getRandomValues(b); return b; };
E2.setRng(rng);

const API_PORT = 3001;
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

async function login(base, phone, deviceName = 'smoke8') {
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

function waitForEvent(socket, event, timeoutMs = 7000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, (payload) => { clearTimeout(t); resolve(payload); });
  });
}

const uuid = () => crypto.randomUUID();

const API_DIR = path.join(__dirname, '..', 'apps', 'api');

async function bootApi(port) {
  const child = spawn('node', [path.join(API_DIR, 'dist', 'main.js')], {
    env: {
      ...process.env,
      DATABASE_URL: 'postgresql://postgres:smokepw@localhost:55432/del?schema=public',
      PORT: String(port),
      AUTH_DEV_MODE: 'true',
      JWT_ACCESS_SECRET: 'dev-access-secret-smoke-0123456789abcdef',
      JWT_REFRESH_SECRET: 'dev-refresh-secret-smoke-9876543210fedcba',
      NODE_ENV: 'development',
      LIVEKIT_URL: 'ws://localhost:7880',
      LIVEKIT_API_KEY: 'devkey',
      LIVEKIT_API_SECRET: 'devsecret-0123456789abcdef0123456789abcdef',
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
    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* تمیز */ } }, 4000);
  });
}

/** کلاینت E2EE شبیه‌سازی‌شده — همان کاری که اپ موبایل/دسکتاپ می‌کند */
// (سناریو مستقیماً با کتابخانه @del/e2ee جلو می‌رود)

// ————— سناریو —————
(async () => {
  let api1 = null;
  const pg = new Client({ host: '127.0.0.1', port: 55432, user: 'postgres', password: 'smokepw', database: 'del' });

  try {
    api1 = await bootApi(API_PORT);
    await pg.connect();
    console.log(`— API on :${API_PORT} + دسترسی مستقیم DB برای آزمون نابینایی سرور —\n`);

    const rnd = String(Date.now()).slice(-7);
    const phoneA = `+98972${rnd}01`;
    const phoneB = `+98972${rnd}02`;

    const A = await login(BASE, phoneA, 'smoke8-A-dev1');
    const B = await login(BASE, phoneB, 'smoke8-B-dev1');
    const meA = (await api(BASE, 'GET', '/auth/me', { token: A.accessToken })).data;
    const meB = (await api(BASE, 'GET', '/auth/me', { token: B.accessToken })).data;
    check('auth/me: deviceId در توکن هست', Boolean(meA.deviceId) && Boolean(meB.deviceId));

    // ————— A) هویت —————
    console.log('A) آپلود هویت و وضعیت');
    const unauth = await api(BASE, 'GET', '/e2ee/status');
    check('بدون توکن → 401', unauth.status === 401);

    const identityA = E2.generateIdentity(rng);
    const otkBatchA = E2.makeOtkBatch(rng, 5, 1000);
    const upA = await api(BASE, 'POST', '/e2ee/identity', {
      token: A.accessToken,
      body: {
        ikEd: identityA.ikEd.pub, ikX: identityA.ikX.pub,
        spkKeyId: identityA.spk.keyId, spk: identityA.spk.pub, spkSig: identityA.spk.sig,
        otks: otkBatchA.map((o) => ({ keyId: o.keyId, key: o.pub })),
      },
    });
    check('آپلود هویت A → ok', upA.status === 200 && upA.data?.ok === true);

    const stA = (await api(BASE, 'GET', '/e2ee/status', { token: A.accessToken })).data;
    check('وضعیت A: identity=true backup=false devices=۱', stA.identity === true && stA.backup === false && stA.deviceCount === 1);

    // idempotent — آپلود مجدد همان
    const upA2 = await api(BASE, 'POST', '/e2ee/identity', {
      token: A.accessToken,
      body: {
        ikEd: identityA.ikEd.pub, ikX: identityA.ikX.pub,
        spkKeyId: identityA.spk.keyId, spk: identityA.spk.pub, spkSig: identityA.spk.sig,
        otks: [{ keyId: otkBatchA[0].keyId, key: otkBatchA[0].pub }],
      },
    });
    check('آپلود تکراری هویت A → ok (idempotent)', upA2.status === 200);

    const identityB = E2.generateIdentity(rng);
    const otkBatchB = E2.makeOtkBatch(rng, 5, 2000);
    await api(BASE, 'POST', '/e2ee/identity', {
      token: B.accessToken,
      body: {
        ikEd: identityB.ikEd.pub, ikX: identityB.ikX.pub,
        spkKeyId: identityB.spk.keyId, spk: identityB.spk.pub, spkSig: identityB.spk.sig,
        otks: otkBatchB.map((o) => ({ keyId: o.keyId, key: o.pub })),
      },
    });
    const otkPrivB = new Map(otkBatchB.map((o) => [o.keyId, o.priv])); // خصوصی‌ها فقط سمت B

    // ————— B) bundle و مصرف OTK —————
    console.log('B) bundle و مصرف یگانه OTK');
    const dkA = (await api(BASE, 'GET', `/e2ee/devices/${meA.userId}`, { token: B.accessToken })).data;
    check('devices کاربر A از دید B — با otkCount', Array.isArray(dkA) && dkA.length === 1 && dkA[0].otkCount === 5);

    const bundle1 = (await api(BASE, 'GET', `/e2ee/bundle/${meB.userId}`, { token: A.accessToken })).data;
    check('bundle B: یک OTK برگشت', bundle1.bundles.length === 1 && bundle1.bundles[0].otk !== null);
    const usedOtkId = bundle1.bundles[0].otk.keyId;

    const dkB1 = (await api(BASE, 'GET', `/e2ee/devices/${meB.userId}`, { token: A.accessToken })).data;
    check('بعد از fetch: otkCount کم شد (۴)', dkB1[0].otkCount === 4);

    // OTKها را می‌کشیم تا bundle بدون OTK هم کار کند
    let lastBundle = null;
    for (let i = 0; i < 4; i++) lastBundle = await api(BASE, 'GET', `/e2ee/bundle/${meB.userId}`, { token: A.accessToken });
    const emptyBundle = await api(BASE, 'GET', `/e2ee/bundle/${meB.userId}`, { token: A.accessToken });
    check('OTK تمام → bundle با otk=null', emptyBundle.data.bundles[0].otk === null);

    // پر کردن مجدد
    const refill = E2.makeOtkBatch(rng, 5, 3000);
    await api(BASE, 'POST', '/e2ee/otks', {
      token: B.accessToken,
      body: { otks: refill.map((o) => ({ keyId: o.keyId, key: o.pub })) },
    });
    for (const o of refill) otkPrivB.set(o.keyId, o.priv); // خصوصی‌های دسته تازه هم نزد B می‌مانند
    const dkB2 = (await api(BASE, 'GET', `/e2ee/devices/${meB.userId}`, { token: A.accessToken })).data;
    check('top-up OTK → otkCount=۵', dkB2[0].otkCount === 5);

    // ————— C) مکالمه + X3DH واقعی —————
    console.log('C) X3DH و باز شدن پیام اول');
    const conv = (await api(BASE, 'POST', '/conversations', { token: A.accessToken, body: { userId: meB.userId } })).data;
    check('ساخت مکالمه direct', Boolean(conv.id) && conv.type === 'direct');

    const bundleFresh = (await api(BASE, 'GET', `/e2ee/bundle/${meB.userId}`, { token: A.accessToken })).data.bundles[0];
    const sessionA = E2.DelSession.initiate(identityA, meB.userId, bundleFresh);
    const adAB = E2.DelSession.ad(conv.id, meA.deviceId, bundleFresh.deviceId);
    const entry1 = sessionA.encrypt('سلام رمزی!', adAB);
    const envelope1 = E2.buildEnvelope([entry1], meA.deviceId);

    const sent = await api(BASE, 'POST', `/conversations/${conv.id}/messages`, {
      token: A.accessToken,
      body: { clientMsgId: uuid(), body: JSON.stringify(envelope1), isE2ee: true },
    });
    check('ارسال پیام E2EE → isE2ee=true', sent.status === 201 && sent.data.message.isE2ee === true);

    // B باز می‌کند
    const hist = (await api(BASE, 'GET', `/conversations/${conv.id}/messages`, { token: B.accessToken })).data;
    const lastMsg = hist.messages[hist.messages.length - 1];
    const envB = E2.isE2eeEnvelope(lastMsg.body);
    const entryB = envB.to.find((e) => e.deviceId === meB.deviceId);
    check('پیام برای دستگاه B آدرس‌دهی شده', Boolean(entryB));
    const sessionB = E2.DelSession.accept(identityB, meA.userId, entryB.from, entryB.pm, otkPrivB.get(entryB.pm.otkKeyId) ? E2.fromB64(otkPrivB.get(entryB.pm.otkKeyId)) : null);
    const adRecvB = E2.DelSession.ad(conv.id, entryB.from, meB.deviceId); // AD دریافت: فرستنده A
    const adSendB = E2.DelSession.ad(conv.id, meB.deviceId, meA.deviceId); // AD ارسال: فرستنده B
    const plainB = sessionB.decrypt({ ct: entryB.ct }, adRecvB);
    check('B پیام اول را باز کرد: «سلام رمزی!»', plainB === 'سلام رمزی!', `got=${plainB}`);

    // ————— D) سرور نابینا —————
    console.log('D) نابینایی سرور — DB فقط ciphertext دارد');
    const dbMsg = await pg.query('SELECT body, "isE2ee" FROM "Message" WHERE "conversationId" = $1 ORDER BY "serverSeq" DESC LIMIT 1', [conv.id]);
    const dbBody = dbMsg.rows[0].body;
    check('پرچم isE2ee در DB', dbMsg.rows[0].isE2ee === true);
    check('DB بدون plaintext («سلام رمزی» نیست)', !dbBody.includes('سلام رمزی'));
    check('DB همان پاکت رمز است (v:1)', E2.isE2eeEnvelope(dbBody) !== null);

    // ————— E) زنجیره پاسخ + DH ratchet —————
    console.log('E) پاسخ B و DH ratchet');
    const replyEntry = sessionB.encrypt('پاسخ رمزی از B', adSendB);
    const replyEnv = E2.buildEnvelope([replyEntry], meB.deviceId);
    const sentReply = await api(BASE, 'POST', `/conversations/${conv.id}/messages`, {
      token: B.accessToken,
      body: { clientMsgId: uuid(), body: JSON.stringify(replyEnv), isE2ee: true },
    });
    check('B پاسخ رمز فرستاد', sentReply.status === 201);

    const histA = (await api(BASE, 'GET', `/conversations/${conv.id}/messages`, { token: A.accessToken })).data;
    const replyMsg = histA.messages[histA.messages.length - 1];
    const envA = E2.isE2eeEnvelope(replyMsg.body);
    const entryA = envA.to.find((e) => e.deviceId === meA.deviceId);
    const adAB2 = E2.DelSession.ad(conv.id, entryA.from, meA.deviceId);
    const plainA = sessionA.decrypt({ ct: entryA.ct }, adAB2);
    check('A پاسخ B را باز کرد: «پاسخ رمزی از B»', plainA === 'پاسخ رمزی از B', `got=${plainA}`);

    // ————— F) out-of-order —————
    console.log('F) پیام‌های ردشده (out-of-order)');
    const oooEntries = [
      sessionA.encrypt('یک', adAB),
      sessionA.encrypt('دو', adAB),
      sessionA.encrypt('سه', adAB),
    ];
    for (const [i, e] of oooEntries.entries()) {
      await api(BASE, 'POST', `/conversations/${conv.id}/messages`, {
        token: A.accessToken,
        body: { clientMsgId: uuid(), body: JSON.stringify(E2.buildEnvelope([e], meA.deviceId)), isE2ee: true },
      });
      void i;
    }
    const histOoo = (await api(BASE, 'GET', `/conversations/${conv.id}/messages`, { token: B.accessToken })).data;
    const oooMsgs = histOoo.messages.slice(-3).map((m) => E2.isE2eeEnvelope(m.body).to.find((e) => e.deviceId === meB.deviceId));
    // ترتیب مخلوط: سوم، اول، دوم
    const d3 = sessionB.decrypt({ ct: oooMsgs[2].ct }, adRecvB);
    const d1 = sessionB.decrypt({ ct: oooMsgs[0].ct }, adRecvB);
    const d2 = sessionB.decrypt({ ct: oooMsgs[1].ct }, adRecvB);
    check('باز کردن به‌ترتیب ۳،۱،۲ → «سه، یک، دو»', d3 === 'سه' && d1 === 'یک' && d2 === 'دو', `got=${d3},${d1},${d2}`);

    // ————— G) دستکاری —————
    console.log('G) دستکاری ciphertext');
    const tampered = { ct: oooMsgs[0].ct.slice(0, -4) + 'AAAA' };
    let tamperThrew = false;
    try { sessionB.decrypt(tampered, adRecvB); } catch { tamperThrew = true; }
    check('باز کردن پیام دستکاری‌شده → خطا', tamperThrew);

    // ————— H) دریافت زنده WS —————
    console.log('H) WS زنده');
    const sockB = await connectWs(BASE, B.accessToken);
    const livePromise = waitForEvent(sockB, 'message.new');
    const liveEntry = sessionA.encrypt('زنده و رمزی', adAB);
    await api(BASE, 'POST', `/conversations/${conv.id}/messages`, {
      token: A.accessToken,
      body: { clientMsgId: uuid(), body: JSON.stringify(E2.buildEnvelope([liveEntry], meA.deviceId)), isE2ee: true },
    });
    const live = await livePromise;
    const liveOk = live && live.message?.isE2ee === true;
    let livePlain = null;
    if (liveOk) {
      const envLive = E2.isE2eeEnvelope(live.message.body);
      const eLive = envLive.to.find((e) => e.deviceId === meB.deviceId);
      livePlain = sessionB.decrypt({ ct: eLive.ct }, adRecvB);
    }
    check('message.new زنده: isE2ee و باز شد → «زنده و رمزی»', liveOk && livePlain === 'زنده و رمزی', `got=${livePlain}`);
    sockB.disconnect();

    // ————— I) چنددستگاهی —————
    console.log('I) چنددستگاهی + خود-دستگاه');
    const B2 = await login(BASE, phoneB, 'smoke8-B-dev2');
    const meB2 = (await api(BASE, 'GET', '/auth/me', { token: B2.accessToken })).data;
    const identityB2 = E2.generateIdentity(rng);
    await api(BASE, 'POST', '/e2ee/identity', {
      token: B2.accessToken,
      body: {
        ikEd: identityB2.ikEd.pub, ikX: identityB2.ikX.pub,
        spkKeyId: identityB2.spk.keyId, spk: identityB2.spk.pub, spkSig: identityB2.spk.sig,
        otks: E2.makeOtkBatch(rng, 5, 4000).map((o) => ({ keyId: o.keyId, key: o.pub })),
      },
    });

    const bundles2 = (await api(BASE, 'GET', `/e2ee/bundle/${meB.userId}`, { token: A.accessToken })).data.bundles;
    check('bundle B: حالا دو دستگاه', bundles2.length === 2);

    const entries2 = [];
    for (const bundle of bundles2) {
      const s = bundle.deviceId === meB.deviceId ? sessionA : null;
      if (s) {
        entries2.push(s.encrypt('برای هر دو دستگاه', E2.DelSession.ad(conv.id, meA.deviceId, bundle.deviceId)));
      } else {
        const sNew = E2.DelSession.initiate(identityA, meB.userId, bundle);
        entries2.push(sNew.encrypt('برای هر دو دستگاه', E2.DelSession.ad(conv.id, meA.deviceId, bundle.deviceId)));
      }
    }
    await api(BASE, 'POST', `/conversations/${conv.id}/messages`, {
      token: A.accessToken,
      body: { clientMsgId: uuid(), body: JSON.stringify(E2.buildEnvelope(entries2, meA.deviceId)), isE2ee: true },
    });
    const histMulti = (await api(BASE, 'GET', `/conversations/${conv.id}/messages`, { token: B2.accessToken })).data;
    const multiMsg = histMulti.messages[histMulti.messages.length - 1];
    const envMulti = E2.isE2eeEnvelope(multiMsg.body);
    const entryB2 = envMulti.to.find((e) => e.deviceId === meB2.deviceId);
    check('پاکت شامل ورودی دستگاه دوم B هم هست', Boolean(entryB2));

    // دستگاه دوم B: X3DH با pm خودش
    const histB1 = (await api(BASE, 'GET', `/conversations/${conv.id}/messages`, { token: B.accessToken })).data;
    const multiForB1 = E2.isE2eeEnvelope(histB1.messages[histB1.messages.length - 1].body).to.find((e) => e.deviceId === meB.deviceId);
    check('دستگاه اول B هم ورودی خودش را دارد', Boolean(multiForB1));

    // خود-دستگاه: A دستگاه دوم → پیام A شامل ورودی دستگاه دوم A
    const A2 = await login(BASE, phoneA, 'smoke8-A-dev2');
    const meA2 = (await api(BASE, 'GET', '/auth/me', { token: A2.accessToken })).data;
    const identityA2 = E2.generateIdentity(rng);
    const otkBatchA2 = E2.makeOtkBatch(rng, 5, 5000);
    await api(BASE, 'POST', '/e2ee/identity', {
      token: A2.accessToken,
      body: {
        ikEd: identityA2.ikEd.pub, ikX: identityA2.ikX.pub,
        spkKeyId: identityA2.spk.keyId, spk: identityA2.spk.pub, spkSig: identityA2.spk.sig,
        otks: otkBatchA2.map((o) => ({ keyId: o.keyId, key: o.pub })),
      },
    });
    const myDevices = (await api(BASE, 'GET', `/e2ee/devices/${meA.userId}`, { token: A.accessToken })).data;
    check('دستگاه‌های خود A: دو عدد', myDevices.length === 2);
    const selfBundle = myDevices.find((d) => d.deviceId === meA2.deviceId);
    const selfSession = E2.DelSession.initiate(identityA, meA.userId, {
      deviceId: selfBundle.deviceId, ikEd: selfBundle.ikEd, ikX: selfBundle.ikX,
      spkKeyId: selfBundle.spkKeyId, spk: selfBundle.spk, spkSig: selfBundle.spkSig, otk: null,
    });
    const selfEntry = selfSession.encrypt('پیام خودم برای دستگاه دیگرم', E2.DelSession.ad(conv.id, meA.deviceId, meA2.deviceId));
    await api(BASE, 'POST', `/conversations/${conv.id}/messages`, {
      token: A.accessToken,
      body: { clientMsgId: uuid(), body: JSON.stringify(E2.buildEnvelope([selfEntry], meA.deviceId)), isE2ee: true },
    });
    const histSelf = (await api(BASE, 'GET', `/conversations/${conv.id}/messages`, { token: A2.accessToken })).data;
    const selfMsg = histSelf.messages[histSelf.messages.length - 1];
    const envSelf = E2.isE2eeEnvelope(selfMsg.body);
    const selfEntry2 = envSelf.to.find((e) => e.deviceId === meA2.deviceId);
    const sessionA2 = E2.DelSession.accept(identityA2, meA.userId, selfEntry2.from, selfEntry2.pm, null);
    const selfPlain = sessionA2.decrypt({ ct: selfEntry2.ct }, E2.DelSession.ad(conv.id, selfEntry2.from, meA2.deviceId));
    check('دستگاه دوم A پیام خودِ کاربر را باز کرد: «پیام خودم برای دستگاه دیگرم»', selfPlain === 'پیام خودم برای دستگاه دیگرم', `got=${selfPlain}`);

    // ————— J) بازیابی حساب —————
    console.log('J) پشتیبان و کلید بازیابی');
    const recoveryKey = E2.generateRecoveryKey();
    const backup = E2.createBackup(identityA, E2.parseRecoveryKey(recoveryKey));
    const saved = await api(BASE, 'PUT', '/e2ee/backup', { token: A.accessToken, body: backup });
    check('ذخیره پشتیبان → ok', saved.status === 200);

    const stA2 = (await api(BASE, 'GET', '/e2ee/status', { token: A.accessToken })).data;
    check('وضعیت A: backup=true', stA2.backup === true);

    const fetched = (await api(BASE, 'GET', '/e2ee/backup', { token: A.accessToken })).data;
    const restored = E2.restoreBackup(fetched.blob, fetched.salt, E2.parseRecoveryKey(recoveryKey));
    const restoredIdentity = E2.identityFromPrivate(restored.ikEdPriv, restored.ikXPriv, rng);
    check('بازیابی → همان هویت (ikX و ikEd برابر)', restoredIdentity.ikX.pub === identityA.ikX.pub && restoredIdentity.ikEd.pub === identityA.ikEd.pub);

    let wrongKeyThrew = false;
    try {
      E2.restoreBackup(fetched.blob, fetched.salt, E2.parseRecoveryKey('0000 0000 0000 0000 0000 0000 0000 0000'));
    } catch { wrongKeyThrew = true; }
    check('کلید بازیابی اشتباه → رد', wrongKeyThrew);

    // ————— K) پیش‌نمایش امن —————
    console.log('K) پیش‌نمایش امن لیست');
    const convsB = (await api(BASE, 'GET', '/conversations', { token: B.accessToken })).data;
    const convB = convsB.find((c) => c.id === conv.id);
    check('پیش‌نمایش: «🔒 پیام رمزنگاری‌شده»', convB?.lastMessage?.body === '🔒 پیام رمزنگاری‌شده', `got=${convB?.lastMessage?.body}`);

    // ————— L) امنیت پشتیبان + ریست —————
    console.log('L) امنیت پشتیبان و ریست هویت');
    const othersBackup = await api(BASE, 'GET', '/e2ee/backup', { token: B.accessToken });
    check('پشتیبان A برای B → 404', othersBackup.status === 404);

    // پیام عادی هنوز کار می‌کند (بدون isE2ee)
    const plain = await api(BASE, 'POST', `/conversations/${conv.id}/messages`, {
      token: A.accessToken,
      body: { clientMsgId: uuid(), body: 'پیام ساده', isE2ee: false },
    });
    check('پیام ساده (isE2ee=false) سالم', plain.status === 201 && plain.data.message.body === 'پیام ساده');

    const delId = await api(BASE, 'DELETE', '/e2ee/identity', { token: A.accessToken });
    const stA3 = (await api(BASE, 'GET', '/e2ee/status', { token: A.accessToken })).data;
    check('ریست هویت → identity=false، پشتیبان باقی', delId.status === 204 && stA3.identity === false && stA3.backup === true);
  } catch (e) {
    console.error('FATAL:', e);
    check('بدون خطای مرگبار', false, String(e?.message ?? e));
  } finally {
    await killApi(api1);
    try { await pg.end(); } catch { /* بسته */ }
  }

  console.log(`\n———————————————`);
  console.log(`نتیجه گام ۸: ${PASS.length} سبز / ${FAIL.length} قرمز`);
  if (FAIL.length) {
    console.log('قرمزها:', FAIL.join(' · '));
    process.exit(1);
  }
})();
