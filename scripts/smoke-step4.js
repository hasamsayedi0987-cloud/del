/**
 * Del — تست دود گام ۴: مکالمه‌های گروهی
 * اجرا:  node scripts/smoke-step4.js   (سرور باید روی :3000 باشد)
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
    body: { phone, code, platform: 'android', deviceName: 'smoke4' },
  });
  if (verify.status !== 200) throw new Error(`login failed for ${phone}: ${JSON.stringify(verify.data)}`);
  return verify.data;
}

let uuidSeq = 0;
const uuid = () => `cccc4444-0000-4000-8000-${String(++uuidSeq).padStart(12, '0')}`;

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

async function main() {
  console.log('\n——— گام ۴: مکالمه‌های گروهی ———\n');

  // پاک‌سازی جداول پیام‌رسانی
  const { Client } = require('pg');
  const pg = new Client({ connectionString: 'postgresql://postgres:smokepw@localhost:55432/del' });
  await pg.connect();
  await pg.query('TRUNCATE "Message", "Participant", "Conversation" CASCADE');
  await pg.end();
  console.log('(جداول پیام‌رسانی پاک شد)\n');

  // ۱) ورود چهار کاربر + رگرسیون direct
  console.log('۱) ورود A,B,C,D + رگرسیون گفتگوی مستقیم');
  const A = await login('09121110001');
  const B = await login('09121110002');
  const C = await login('09121110003');
  const D = await login('09121110004');
  check('ورود چهار کاربر', Boolean(A.accessToken && B.accessToken && C.accessToken && D.accessToken));

  const bUser = await api('GET', '/users/by-phone/09121110002', { token: A.accessToken });
  const cUser = await api('GET', '/users/by-phone/09121110003', { token: A.accessToken });
  const dUser = await api('GET', '/users/by-phone/09121110004', { token: A.accessToken });
  const dir1 = await api('POST', '/conversations', { token: A.accessToken, body: { userId: bUser.data.id } });
  const dir2 = await api('POST', '/conversations', { token: A.accessToken, body: { userId: bUser.data.id } });
  check('رگرسیون: direct idempotent (دو بار ساخت → همان id)', dir1.status === 201 && dir2.data.id === dir1.data.id);

  // ۲) ساخت گروه
  console.log('۲) ساخت گروه + اعتبارسنجی');
  const bad = await api('POST', '/conversations/group', { token: A.accessToken, body: { title: '  ' } });
  check('گروه بدون عنوان → 400', bad.status === 400, JSON.stringify(bad.data));

  const group = await api('POST', '/conversations/group', {
    token: A.accessToken,
    body: { title: 'گروه دود', memberUserIds: [bUser.data.id, cUser.data.id] },
  });
  const g = group.data;
  const gid = g?.id;
  check('گروه ساخته شد (type=group, ۳ عضو, ادمین A)',
    group.status === 201 && g.type === 'group' && g.title === 'گروه دود'
      && g.memberCount === 3 && g.myRole === 'admin', JSON.stringify(g));

  const detail = await api('GET', `/conversations/${gid}`, { token: B.accessToken });
  const aRow = detail.data.participants?.find((p) => p.userId === A.user.id);
  const bRow = detail.data.participants?.find((p) => p.userId === B.user.id);
  check('نقش‌ها: A=admin، B=member، اعضای کامل در GET /:id',
    detail.status === 200 && aRow?.role === 'admin' && bRow?.role === 'member' && detail.data.participants.length === 3,
    JSON.stringify(detail.data));

  // ۳) اتصال WS همه
  console.log('۳) پیام گروهی بلادرنگ');
  const wsA = await connectWs(A.accessToken);
  const wsB = await connectWs(B.accessToken);
  const wsC = await connectWs(C.accessToken);
  const wsD = await connectWs(D.accessToken);
  await sleep(400);

  const cGotP = waitForEvent(wsC, 'message.new', 6000);
  const send1 = await api('POST', `/conversations/${gid}/messages`, {
    token: B.accessToken, body: { clientMsgId: uuid(), body: 'سلام گروه' },
  });
  const cGot = await cGotP;
  check('B پیام گروهی فرستاد (seq=1)', send1.status === 201 && send1.data.message.serverSeq === 1);
  check('C پیام گروهی را بلادرنگ گرفت', cGot && cGot.message.body === 'سلام گروه', JSON.stringify(cGot));

  // ۴) افزودن عضو
  console.log('۴) افزودن عضو — مجوز و اطلاع‌رسانی');
  const deniedAdd = await api('POST', `/conversations/${gid}/members`, {
    token: B.accessToken, body: { userIds: [dUser.data.id] },
  });
  check('افزودن عضو توسط غیرادمین → 403 NOT_GROUP_ADMIN',
    deniedAdd.status === 403 && deniedAdd.data.error.code === 'NOT_GROUP_ADMIN', JSON.stringify(deniedAdd.data));

  const dConvNewP = waitForEvent(wsD, 'conversation.new', 6000);
  const addD = await api('POST', `/conversations/${gid}/members`, {
    token: A.accessToken, body: { userIds: [dUser.data.id] },
  });
  check('ادمین D را افزود → 200 و ۴ عضو', addD.status === 200 && addD.data.memberCount === 4, JSON.stringify(addD.data));
  const dConvNew = await dConvNewP;
  check('D رویداد conversation.new گرفت', dConvNew && dConvNew.conversationId === gid, JSON.stringify(dConvNew));
  await sleep(400); // فرصت join سمت سرور
  const dJoin = await new Promise((resolve) => {
    wsD.timeout(4000).emit('conversation.join', { conversationId: gid }, (e, r) => resolve(r));
  });
  check('D می‌تواند در اتاق گروه join کند', dJoin && dJoin.ok === true, JSON.stringify(dJoin));

  // افزودن تکراری — idempotent
  const addDup = await api('POST', `/conversations/${gid}/members`, {
    token: A.accessToken, body: { userIds: [dUser.data.id] },
  });
  check('افزودن تکراری D → عضو تکراری نمی‌سازد (۴ عضو)', addDup.status === 200 && addDup.data.memberCount === 4);

  // ۵) تغییر نام
  console.log('۵) تغییر نام گروه');
  const deniedRename = await api('PATCH', `/conversations/${gid}`, { token: B.accessToken, body: { title: 'هک' } });
  check('تغییر نام توسط غیرادمین → 403', deniedRename.status === 403, JSON.stringify(deniedRename.data));

  const renamed = await api('PATCH', `/conversations/${gid}`, { token: A.accessToken, body: { title: 'گروه دود ۲' } });
  const bList = await api('GET', '/conversations', { token: B.accessToken });
  const inList = bList.data.find((c) => c.id === gid);
  check('ادمین نام را تغییر داد و B در لیست عنوان تازه را می‌بیند',
    renamed.status === 200 && renamed.data.title === 'گروه دود ۲' && inList?.title === 'گروه دود ۲',
    JSON.stringify(inList));

  // ۶) تایپینگ و رسید خواندن گروهی
  console.log('۶) تایپینگ + رسید خواندن در گروه');
  const aTypingP = waitForEvent(wsA, 'typing', 5000);
  wsB.emit('typing', { conversationId: gid });
  const aTyping = await aTypingP;
  check('A رویداد typing گروهی از B گرفت', aTyping && aTyping.userId === B.user.id && aTyping.conversationId === gid, JSON.stringify(aTyping));

  const aReadP = waitForEvent(wsA, 'message.read', 5000);
  await api('POST', `/conversations/${gid}/read`, { token: B.accessToken, body: { lastReadSeq: 1 } });
  const aRead = await aReadP;
  check('A رسید خواندن B را گرفت (lastReadSeq=1)', aRead && aRead.userId === B.user.id && aRead.lastReadSeq === 1, JSON.stringify(aRead));

  // ۷) حذف عضو
  console.log('۷) حذف عضو — امنیت');
  const cRemovedP = waitForEvent(wsC, 'member.removed', 6000);
  const rmC = await api('DELETE', `/conversations/${gid}/members/${C.user.id}`, { token: A.accessToken });
  const cRemoved = await cRemovedP;
  check('A حذف C کرد و C رویداد member.removed گرفت',
    rmC.status === 204 && cRemoved && cRemoved.userId === C.user.id && cRemoved.left === false,
    JSON.stringify(cRemoved));
  await sleep(400);
  const cAfter = await api('GET', `/conversations/${gid}/messages`, { token: C.accessToken });
  check('C دیگر دسترسی ندارد → 403', cAfter.status === 403, JSON.stringify(cAfter.data));

  // پیام بعد از حذف — C نباید پیام جدید بگیرد
  let cGotAfterRemoval = false;
  wsC.on('message.new', () => { cGotAfterRemoval = true; });
  await api('POST', `/conversations/${gid}/messages`, { token: A.accessToken, body: { clientMsgId: uuid(), body: 'مخفی' } });
  await sleep(700);
  check('C پس از حذف پیام جدید دریافت نمی‌کند (خروج از اتاق)', cGotAfterRemoval === false);

  // ۸) خروج و قانون آخرین ادمین
  console.log('۸) خروج از گروه + قانون LAST_ADMIN + ارتقا');
  const lastAdmin = await api('POST', `/conversations/${gid}/leave`, { token: A.accessToken });
  check('خروج آخرین ادمین با عضو باقی‌مانده → 400 LAST_ADMIN',
    lastAdmin.status === 400 && lastAdmin.data.error.code === 'LAST_ADMIN', JSON.stringify(lastAdmin.data));

  const promote = await api('PATCH', `/conversations/${gid}/members/${B.user.id}`, {
    token: A.accessToken, body: { role: 'admin' },
  });
  check('ارتقای B به ادمین → 204', promote.status === 204, JSON.stringify(promote.data));

  const dLeave = await api('POST', `/conversations/${gid}/leave`, { token: D.accessToken });
  const dAfter = await api('GET', `/conversations/${gid}`, { token: D.accessToken });
  check('D خارج شد → 204 و دسترسی قطع', dLeave.status === 204 && dAfter.status === 403, JSON.stringify(dAfter.data));

  const dRemovedP = waitForEvent(wsB, 'member.removed', 5000);
  void dRemovedP;
  const aLeave = await api('POST', `/conversations/${gid}/leave`, { token: A.accessToken });
  check('خروج A پس از وجود ادمین دیگر → 204', aLeave.status === 204, JSON.stringify(aLeave.data));

  // ۹) ارسال بعد از حذف — غیرعضو
  const dSend = await api('POST', `/conversations/${gid}/messages`, {
    token: D.accessToken, body: { clientMsgId: uuid(), body: 'باید رد شود' },
  });
  check('ارسال پیام توسط غیرعضو حذف‌شده → 403', dSend.status === 403);

  // ۱۰) رگرسیون: direct بعد از همه این‌ها سالم است
  const dirMsg = await api('POST', `/conversations/${dir1.data.id}/messages`, {
    token: A.accessToken, body: { clientMsgId: uuid(), body: 'دایرکت سالم' },
  });
  check('رگرسیون: direct همچنان سالم', dirMsg.status === 201);

  wsA.disconnect();
  wsB.disconnect();
  wsC.disconnect();
  wsD.disconnect();

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
