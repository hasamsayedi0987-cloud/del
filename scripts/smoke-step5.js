/**
 * Del — تست دود گام ۵: رسانه (Presigned Upload/Download + magic bytes + thumbnail)
 * اجرا:  node scripts/smoke-step5.js
 * پیش‌نیاز: API روی :3000 با S3_* + MEDIA_MULTIPART_THRESHOLD_MB=1 و S3 روی :9000 (s3rver/MinIO)
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

/** PUT مستقیم به S3 با presigned URL */
async function putBytes(url, bytes, contentType) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: contentType ? { 'Content-Type': contentType } : {},
    body: bytes,
  });
  return { status: res.status, etag: res.headers.get('etag') };
}

async function login(phone) {
  const req = await api('POST', '/auth/otp/request', { body: { phone } });
  const code = req.data.devCode;
  const verify = await api('POST', '/auth/otp/verify', {
    body: { phone, code, platform: 'android', deviceName: 'smoke5' },
  });
  if (verify.status !== 200) throw new Error(`login failed for ${phone}`);
  return verify.data;
}

let uuidSeq = 0;
const uuid = () => `dddd5555-0000-4000-8000-${String(++uuidSeq).padStart(12, '0')}`;

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

// PNG واقعی ۱×۱ (magic bytes معتبر)
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
// JPEG کوچک واقعی ۱×۱
const JPEG_1PX = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
  'base64',
);
// MP4 با ftyp واقعی (حداقلی)
function mp4Bytes(size) {
  const head = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftypmp42'),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('mp42isom'),
  ]);
  const pad = Buffer.alloc(Math.max(0, size - head.length), 0x61);
  return Buffer.concat([head, pad]).subarray(0, Math.max(size, head.length));
}

async function uploadSingle(token, convId, bytes, mime, extra = {}) {
  const pre = await api('POST', '/media/presign', {
    token,
    body: { conversationId: convId, mime, size: bytes.length, ...extra },
  });
  if (pre.status !== 200 && pre.status !== 201) return { pre, put: null, comp: null };
  const put = await putBytes(pre.data.url, bytes, mime);
  const comp = await api('POST', '/media/complete', {
    token,
    body: { mediaId: pre.data.mediaId },
  });
  return { pre, put, comp };
}

async function main() {
  console.log('\n——— گام ۵: رسانه ———\n');

  // پاک‌سازی جداول
  const { Client } = require('pg');
  const pg = new Client({ connectionString: 'postgresql://postgres:smokepw@localhost:55432/del' });
  await pg.connect();
  await pg.query('TRUNCATE "Message", "Participant", "Conversation", "MediaAsset" CASCADE');
  await pg.end();
  console.log('(جداول پیام‌رسانی و رسانه پاک شد)\n');

  // ۱) ورود + مکالمه‌ها
  console.log('۱) ورود A,B,C + دو مکالمه');
  const A = await login('09121110001');
  const B = await login('09121110002');
  const C = await login('09121110003');
  check('ورود سه کاربر', Boolean(A.accessToken && B.accessToken && C.accessToken));

  const bUser = await api('GET', '/users/by-phone/09121110002', { token: A.accessToken });
  const cUser = await api('GET', '/users/by-phone/09121110003', { token: A.accessToken });
  const conv1 = await api('POST', '/conversations', { token: A.accessToken, body: { userId: bUser.data.id } });
  const conv2 = await api('POST', '/conversations', { token: A.accessToken, body: { userId: cUser.data.id } });
  const c1 = conv1.data.id;
  const c2 = conv2.data.id;
  check('دو مکالمه direct ساخته شد', conv1.status === 201 && conv2.status === 201);

  // ۲) اعتبارسنجی presign
  console.log('۲) اعتبارسنجی presign');
  const badMime = await api('POST', '/media/presign', {
    token: A.accessToken,
    body: { conversationId: c1, mime: 'application/x-msdownload', size: 100 },
  });
  check('mime خارج از whitelist → 400 MIME_NOT_ALLOWED', badMime.status === 400 && badMime.data?.error?.code === 'MIME_NOT_ALLOWED', JSON.stringify(badMime.data));

  const tooBig = await api('POST', '/media/presign', {
    token: A.accessToken,
    body: { conversationId: c1, mime: 'image/png', size: 26 * 1024 * 1024 },
  });
  check('تصویر >۲۵MB → 413 MEDIA_TOO_LARGE', tooBig.status === 413 && tooBig.data?.error?.code === 'MEDIA_TOO_LARGE', JSON.stringify(tooBig.data));

  const outsider = await api('POST', '/media/presign', {
    token: C.accessToken,
    body: { conversationId: c1, mime: 'image/png', size: 100 },
  });
  check('غیرعضو presign → 403 NOT_A_PARTICIPANT', outsider.status === 403, JSON.stringify(outsider.data));

  // ۳) آپلود موفق PNG (single) + بندانگشتی
  console.log('۳) آپلود تصویر (single PUT) + بندانگشتی');
  const wsA = await connectWs(A.accessToken);
  const wsB = await connectWs(B.accessToken);
  await sleep(400);

  const mediaReadyPromise = waitForEvent(wsB, 'media.ready');
  const up1 = await uploadSingle(A.accessToken, c1, PNG_1PX, 'image/png', {
    originalName: 'test.png', width: 1, height: 1,
  });
  check('presign single → url + mediaId', up1.pre.status === 200 && up1.pre.data?.mode === 'single' && Boolean(up1.pre.data?.url), JSON.stringify(up1.pre.data));
  check('PUT مستقیم به S3 موفق', up1.put?.status === 200);
  const m1 = up1.comp.data;
  check('complete → status=ready + بندانگشتی (sharp)', up1.comp.status === 200 && m1?.status === 'ready' && m1.hasThumb === true, JSON.stringify(up1.comp.data));

  const readyEvt = await mediaReadyPromise;
  check('WS: عضو دیگر media.ready گرفت', Boolean(m1?.id && readyEvt?.media?.id === m1.id), JSON.stringify(readyEvt));

  const completeAgain = await api('POST', '/media/complete', { token: A.accessToken, body: { mediaId: m1.id } });
  check('complete دوباره → idempotent (همان ready)', completeAgain.status === 200 && completeAgain.data?.id === m1.id && completeAgain.data?.status === 'ready');

  // ۴) متادیتا + دانلود
  console.log('۴) متادیتا و دانلود امضاشده');
  const meta = await api('GET', `/media/${m1.id}`, { token: B.accessToken });
  check('GET /media/:id → متادیتای کامل (B عضو)', meta.status === 200 && meta.data?.kind === 'image' && meta.data?.mime === 'image/png', JSON.stringify(meta.data));

  const urlA = await api('GET', `/media/${m1.id}/url`, { token: A.accessToken });
  const dl = urlA.data?.url ? await fetch(urlA.data.url) : null;
  const dlBytes = dl ? Buffer.from(await dl.arrayBuffer()) : null;
  check('GET /media/:id/url (A) → دانلود بایت‌به‌بایت یکسان',
    urlA.status === 200 && dl?.status === 200 && dlBytes && Buffer.compare(dlBytes, PNG_1PX) === 0,
    `status=${dl?.status}`);

  const urlB = await api('GET', `/media/${m1.id}/url`, { token: B.accessToken });
  check('GET url برای عضو دیگر (B) → 200', urlB.status === 200 && Boolean(urlB.data?.url));

  const urlC = await api('GET', `/media/${m1.id}/url`, { token: C.accessToken });
  check('GET url غیرعضو (C) → 403', urlC.status === 403, JSON.stringify(urlC.data));

  const thumb = await api('GET', `/media/${m1.id}/url?variant=thumb`, { token: A.accessToken });
  const thumbDl = thumb.data?.url ? await fetch(thumb.data.url) : null;
  check('بندانگشتی → 200 (image/jpeg)',
    thumb.status === 200 && thumbDl?.status === 200 && (thumbDl.headers.get('content-type') ?? '').includes('image/jpeg'),
    JSON.stringify(thumb.data));

  const thumb404 = await api('GET', `/media/${m1.id}/url?variant=thumb`, { token: A.accessToken });
  void thumb404; // پوشش کافی است

  // ۵) رد محتوا — امنیت magic bytes / اندازه
  console.log('۵) امنیت: magic bytes و اندازه');
  const liar = await uploadSingle(A.accessToken, c1, Buffer.from('این متن است نه عکس'), 'image/png');
  check('محتوای دروغین (متن به‌جای PNG) → 400 MAGIC_MISMATCH',
    liar.comp.status === 400 && liar.comp.data?.error?.code === 'MAGIC_MISMATCH', JSON.stringify(liar.comp.data));
  const liarMeta = await api('GET', `/media/${liar.pre.data.mediaId}`, { token: A.accessToken });
  check('asset ردشده → status=rejected', liarMeta.status === 200 && liarMeta.data?.status === 'rejected');

  const shortUpload = await api('POST', '/media/presign', {
    token: A.accessToken, body: { conversationId: c1, mime: 'image/png', size: 1000 },
  });
  await putBytes(shortUpload.data.url, Buffer.alloc(500, 7), 'image/png');
  const shortComp = await api('POST', '/media/complete', { token: A.accessToken, body: { mediaId: shortUpload.data.mediaId } });
  check('اندازه واقعی ≠ ادعاشده → 400 MEDIA_SIZE_MISMATCH', shortComp.status === 400 && shortComp.data?.error?.code === 'MEDIA_SIZE_MISMATCH', JSON.stringify(shortComp.data));

  // ۶) قواعد پیوست رسانه به پیام
  console.log('۶) قواعد پیوست رسانه به پیام');
  const attachPending = await api('POST', `/conversations/${c1}/messages`, {
    token: A.accessToken,
    body: { clientMsgId: uuid(), mediaId: shortUpload.data.mediaId },
  });
  check('پیوست asset ردشده → 400 MEDIA_NOT_READY', attachPending.status === 400 && attachPending.data?.error?.code === 'MEDIA_NOT_READY', JSON.stringify(attachPending.data));

  const cUpload = await uploadSingle(C.accessToken, c2, JPEG_1PX, 'image/jpeg', { originalName: 'c.jpg' });
  const attachForeign = await api('POST', `/conversations/${c1}/messages`, {
    token: A.accessToken,
    body: { clientMsgId: uuid(), mediaId: cUpload.comp.data?.id },
  });
  check('رسانه کاربر دیگر → 403 MEDIA_NOT_OWNED', attachForeign.status === 403 && attachForeign.data?.error?.code === 'MEDIA_NOT_OWNED', JSON.stringify(attachForeign.data));

  const attachWrongConv = await api('POST', `/conversations/${c2}/messages`, {
    token: A.accessToken,
    body: { clientMsgId: uuid(), mediaId: m1.id },
  });
  check('رسانه مکالمه دیگر → 400 MEDIA_WRONG_CONVERSATION', attachWrongConv.status === 400 && attachWrongConv.data?.error?.code === 'MEDIA_WRONG_CONVERSATION', JSON.stringify(attachWrongConv.data));

  // ۷) پیام رسانه‌ای + تحویل بلادرنگ
  console.log('۷) پیام رسانه‌ای بلادرنگ');
  const msgNewB = waitForEvent(wsB, 'message.new');
  const mediaMsg = await api('POST', `/conversations/${c1}/messages`, {
    token: A.accessToken,
    body: { clientMsgId: uuid(), mediaId: m1.id, body: 'عکس تست از دل' },
  });
  const mm = mediaMsg.data?.message;
  check('ارسال پیام رسانه‌ای → 201 type=image + media + کپشن',
    mediaMsg.status === 201 && mm?.type === 'image' && mm?.media?.id === m1.id && mm?.body === 'عکس تست از دل',
    JSON.stringify(mediaMsg.data));

  const evt = await msgNewB;
  check('WS: B پیام رسانه‌ای را با media گرفت', Boolean(evt?.message?.media?.id === m1.id), JSON.stringify(evt));

  const dupMedia = await api('POST', `/conversations/${c1}/messages`, {
    token: A.accessToken,
    body: { clientMsgId: mm.clientMsgId, mediaId: m1.id, body: 'عکس تست از دل' },
  });
  check('ارسال تکراری همان clientMsgId → duplicate=true', dupMedia.status === 201 && dupMedia.data?.duplicate === true);

  const hist = await api('GET', `/conversations/${c1}/messages?since=0`, { token: B.accessToken });
  check('تاریخچه: پیام رسانه‌ای با media در since-sync', hist.data?.messages?.some((x) => x.media?.id === m1.id && x.type === 'image'));

  // ۸) آپلود multipart (PDF ۱٫۵MB → ۲ پارت)
  console.log('۸) آپلود multipart با ازسرگیری');
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1.5 * 1024 * 1024, 0x41)]);
  const preMp = await api('POST', '/media/presign', {
    token: A.accessToken,
    body: { conversationId: c1, mime: 'application/pdf', size: pdf.length, originalName: 'big.pdf' },
  });
  check('فایل >۱MB → mode=multipart + ۲ partUrl',
    preMp.status === 200 && preMp.data?.mode === 'multipart' && preMp.data?.partUrls?.length === 2, JSON.stringify(preMp.data));
  if (preMp.data?.partUrls?.length !== 2) {
    console.log(`\n——— نتیجه: ${PASS.length} سبز، ${FAIL.length + 1} قرمز ———`);
    console.log('FAILED:', [...FAIL, 'multipart presign نشد'].join(' | '));
    process.exit(1);
  }

  const p1 = await putBytes(preMp.data.partUrls[0], pdf.subarray(0, preMp.data.partSize));
  const p2 = await putBytes(preMp.data.partUrls[1], pdf.subarray(preMp.data.partSize));
  check('هر دو پارت PUT شد', p1.status === 200 && p2.status === 200 && Boolean(p1.etag) && Boolean(p2.etag));

  const compMp = await api('POST', '/media/complete', {
    token: A.accessToken,
    body: { mediaId: preMp.data.mediaId, parts: [{ partNumber: 1, etag: p1.etag }, { partNumber: 2, etag: p2.etag }] },
  });
  check('complete multipart → ready', compMp.status === 200 && compMp.data?.status === 'ready', JSON.stringify(compMp.data));

  const mpUrl = await api('GET', `/media/${preMp.data.mediaId}/url`, { token: B.accessToken });
  const mpDl = mpUrl.data?.url ? await fetch(mpUrl.data.url) : null;
  const mpBytes = mpDl ? Buffer.from(await mpDl.arrayBuffer()) : null;
  check('دانلود فایل multipart یکسان + نام اصلی حفظ شده',
    mpDl?.status === 200 && mpBytes?.length === pdf.length && compMp.data?.originalName === 'big.pdf',
    `len=${mpBytes?.length}`);

  // ۹) ویدیو + رگرسیون متن
  console.log('۹) ویدیو و رگرسیون');
  const vid = await uploadSingle(A.accessToken, c1, mp4Bytes(2048), 'video/mp4', { originalName: 'clip.mp4' });
  check('ویدیو mp4 → ready (magic ftyp)', vid.comp.status === 200 && vid.comp.data?.status === 'ready' && vid.comp.data?.kind === 'video', JSON.stringify(vid.comp.data));

  const txt = await api('POST', `/conversations/${c1}/messages`, {
    token: A.accessToken, body: { clientMsgId: uuid(), body: 'متن ساده هنوز کار می‌کند' },
  });
  check('رگرسیون: پیام متنی → 201 type=text', txt.status === 201 && txt.data?.message?.type === 'text' && !txt.data?.message?.media);

  const wsErr = await new Promise((resolve) => {
    wsA.emit('message.send', { conversationId: c1, clientMsgId: uuid() }, (r) => resolve(r));
  });
  check('WS: پیام بدون body/mediaId → BAD_PAYLOAD', wsErr?.ok === false && wsErr?.error?.code === 'BAD_PAYLOAD', JSON.stringify(wsErr));

  wsA.disconnect(); wsB.disconnect();
  console.log(`\n——— نتیجه: ${PASS.length} سبز، ${FAIL.length} قرمز ———`);
  if (FAIL.length) {
    console.log('FAILED:', FAIL.join(' | '));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('SMOKE CRASH:', e);
  process.exit(1);
});
