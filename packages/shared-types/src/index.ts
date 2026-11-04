/**
 * Del — Shared types (Step 1: Auth foundation)
 * این تایپ‌ها قرارداد مشترک بین API و کلاینت‌ها هستند.
 * قرارداد کامل در docs/05-api-design.md توصیف شده است.
 */

export type DevicePlatform = 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'web';

export interface UserDto {
  id: string;
  /** ورود با شماره — کاربرِ ایمیل‌محور null دارد */
  phone: string | null;
  /** ورود با ایمیل — کاربرِ شماره‌محور null دارد */
  email?: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  about: string | null;
  /** رضایت کلی هوش مصنوعی (گام ۹) */
  aiConsent: boolean;
  /** نقش سیستمی (گام ۱۰) — admin پنل مدیریت دارد */
  role: 'user' | 'admin';
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** طول عمر access token بر حسب ثانیه (پیش‌فرض ۹۰۰ = ۱۵ دقیقه) */
  expiresIn: number;
}

export interface AuthSession extends AuthTokens {
  user: UserDto;
}

export interface RequestOtpResponse {
  /** فقط در حالت توسعه (AUTH_DEV_MODE=true) برگردانده می‌شود */
  devCode?: string;
  /** true = کد با پیامک واقعی ارسال شد (سرویس SMS پیکربندی شده) */
  smsSent?: boolean;
  /** true = کد با ایمیل واقعی ارسال شد (SMTP پیکربندی شده) */
  emailSent?: boolean;
  expiresInSeconds: number;
}

/** قالب استاندارد خطای API — همه خطاها با این شکل برمی‌گردند */
export interface ApiError {
  error: {
    code: string;
    message: string;
    /** فیلدهای مرتبط با خطا (اختیاری) */
    details?: unknown;
  };
  statusCode: number;
}

/** پاسخ health-check — GET /api/v1/health */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  services: {
    database: 'up' | 'down';
    /** disabled یعنی REDIS_URL تنظیم نشده و fallback حافظه‌ای فعال است — وضعیت طبیعی تک‌نود */
    redis: 'up' | 'down' | 'disabled';
  };
  uptimeSeconds: number;
  timestamp: string;
  version: string;
}

// ————— پیام‌رسانی (گام ۲) —————

export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  /** شماره ترتیبی یگانه در مکالمه — مبنای مرتب‌سازی و cursor */
  serverSeq: number;
  clientMsgId: string;
  type: 'text' | 'image' | 'video' | 'audio' | 'file' | string;
  body: string;
  /** رمزنگاری سرتاسری (گام ۸) — body پاکت رمز است؛ کلاینت با کلید خودش باز می‌کند */
  isE2ee?: boolean;
  /** پیام رسانه‌ای (گام ۵) — متادیتا بدون URL؛ URL کوتاه‌عمر با GET /media/:id/url گرفته می‌شود */
  media?: MediaAssetDto | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface ParticipantDto {
  userId: string;
  displayName: string | null;
  phone: string | null;
  lastReadSeq: number;
  /** نقش در گروه (گام ۴) — فقط گروه */
  role?: 'admin' | 'member';
}

export interface ConversationDto {
  id: string;
  type: 'direct' | 'group';
  title: string | null;
  lastSeq: number;
  lastMessageAt: string | null;
  createdAt: string;
  /** فقط در direct: طرف مقابل */
  peer: ParticipantDto | null;
  /** تعداد اعضا — گروه‌ها */
  memberCount?: number;
  /** نقش من در این گروه (گام ۴) */
  myRole?: 'admin' | 'member' | null;
  /** اعضای کامل — فقط در پاسخ جزئیات (GET /:id) */
  participants?: ParticipantDto[];
  /** تعداد پیام‌های خوانده‌نشده این کاربر */
  unreadCount: number;
  /** پیش‌نمایش آخرین پیام */
  lastMessage: { body: string; createdAt: string; senderId: string } | null;
  /** رضایت هوش مصنوعی من در این گفتگو (گام ۹) — null = تبعیت از رضایت کلی */
  myAiConsent?: boolean | null;
}

/** پیام broadcast سرور به کلاینت‌های عضو مکالمه (رویداد message.new) */
export interface WsMessageNew {
  conversationId: string;
  message: MessageDto;
}

/** رویداد به‌روزرسانی مکالمه (پیام جدید/خواندن) برای بازسازی لیست گفتگوها */
export interface WsConversationUpdated {
  conversationId: string;
  lastSeq: number;
  lastMessageAt: string;
}

/** مکالمه تازه برای کاربر آنلاین ساخته شد — کلاینت لیست را رفرش می‌کند */
export interface WsConversationNew {
  conversationId: string;
  /** اعضای مکالمه (برای multi-device و اشکال‌زدایی) */
  participantUserIds: string[];
}

/** وضعیت حضور کاربر (گام ۳) */
export interface PresenceDto {
  userId: string;
  online: boolean;
  /** فقط وقتی offline — ISO timestamp */
  lastSeen: string | null;
}

/** رویداد تغییر حضور (به اتاق شخصی هم‌مکالمه‌ها فرستاده می‌شود) */
export interface WsPresenceUpdate {
  userId: string;
  online: boolean;
  lastSeen: string | null;
}

/** رویداد «در حال نوشتن…» */
export interface WsTyping {
  conversationId: string;
  userId: string;
}

/** رسید خواندن بلادرنگ — تا lastReadSeq خوانده شده */
export interface WsMessageRead {
  conversationId: string;
  userId: string;
  lastReadSeq: number;
}

// ————— گروه‌ها (گام ۴) —————

/** عضو تازه به گروه اضافه شد — به اتاق گروه + اتاق شخصی عضو تازه */
export interface WsMemberAdded {
  conversationId: string;
  /** کاربر اضافه‌شده */
  userId: string;
  /** ادمینی که اضافه کرد */
  addedBy: string;
}

/** عضو از گروه حذف/خارج شد — به اتاق گروه + اتاق شخصی عضو حذف‌شده */
export interface WsMemberRemoved {
  conversationId: string;
  /** کاربر حذف‌شده */
  userId: string;
  removedBy: string;
  /** true = خودش خارج شد */
  left: boolean;
}

// ————— رسانه (گام ۵) —————

export type MediaKind = 'image' | 'video' | 'audio' | 'file';

/** متادیتای فایل رسانه‌ای — بایت‌ها هرگز از API عبور نمی‌کنند (presigned S3) */
export interface MediaAssetDto {
  id: string;
  ownerId: string;
  conversationId: string;
  kind: MediaKind;
  mime: string;
  /** اندازه بایت — همان که در presign ادعا شده */
  size: number;
  originalName: string | null;
  width: number | null;
  height: number | null;
  status: 'pending' | 'ready' | 'rejected';
  /** فقط تصاویر — بندانگشتی ۷۶۸px سمت سرور ساخته می‌شود */
  hasThumb: boolean;
  createdAt: string;
}

/** پاسخ POST /media/presign — مستقیم به S3 آپلود کن */
export interface PresignResponse {
  mediaId: string;
  mode: 'single' | 'multipart';
  /** فقط mode=single — PUT کامل فایل */
  url?: string;
  /** فقط mode=multipart */
  uploadId?: string;
  partSize?: number;
  /** فقط mode=multipart — URL هر پارت به ترتیب (partNumber = index+1) */
  partUrls?: string[];
  expiresAt: string;
}

/** پاسخ GET /media/:id/url — لینک دانلود امضاشده کوتاه‌عمر */
export interface MediaUrlResponse {
  url: string;
  expiresAt: string;
  kind: MediaKind;
  mime: string;
  size: number;
  originalName: string | null;
}

/** آپلود فایل نهایی و تأیید شد — به اتاق مکالمه broadcast می‌شود */
export interface WsMediaReady {
  conversationId: string;
  media: MediaAssetDto;
}

// ————— تماس‌ها (گام ۶) —————
// signaling روی WS؛ صدا/تصویر از LiveKit (SFU) — بایت‌های مدیا از API عبور نمی‌کنند

export type CallKind = 'audio' | 'video';

export type CallStatus =
  | 'ringing'
  | 'active'
  | 'ended'
  | 'missed'
  | 'rejected'
  | 'cancelled';

export type CallEndReason = 'hangup' | 'reject' | 'cancel' | 'timeout';

export interface CallDto {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  kind: CallKind;
  status: CallStatus;
  endReason: CallEndReason | null;
  /** شروع زنگ */
  startedAt: string;
  /** لحظه برقراری (پاسخ طرف مقابل) */
  connectedAt: string | null;
  endedAt: string | null;
  /** طول گفت‌وگوی مؤثر بر حسب ثانیه */
  durationS: number | null;
}

/** تماس ورودی — به اتاق شخصی گیرنده فرستاده می‌شود */
export interface WsCallIncoming {
  call: CallDto;
  caller: { id: string; displayName: string | null; phone: string };
}

/** تماس پاسخ داده شد — هر طرف توکن LiveKit خودش را می‌گیرد */
export interface WsCallAccepted {
  call: CallDto;
  /** آدرس WebSocket سرور LiveKit */
  url: string;
  /** توکن اتصال LiveKit (JWT یک‌ساعته) */
  token: string;
  /** نام اتاق LiveKit — call:{callId} */
  room: string;
}

/** تماس تمام شد — به اتاق شخصی هر دو طرف */
export interface WsCallEnded {
  callId: string;
  conversationId: string;
  reason: CallEndReason;
  /** کاربری که تماس را تمام کرد */
  by: string;
  durationS: number | null;
}

/** پاسخ REST شروع/پذیرش تماس — شامل اطلاعات اتصال LiveKit */
export interface CallJoinInfo {
  call: CallDto;
  url: string;
  token: string;
  room: string;
}

/** تاریخچه تماس — GET /calls */
export interface CallPage {
  calls: CallDto[];
  hasMore: boolean;
  /** ISO cursor برای صفحه بعد (قدیمی‌تر) */
  nextBefore: string | null;
}

// ————— اعلان‌ها و همگام‌سازی (گام ۷) —————

/** دستگاه ثبت‌شده کاربر — GET /devices */
export interface DeviceDto {
  id: string;
  platform: DevicePlatform | string;
  name: string | null;
  /** آیا توکن push ثبت شده است؟ (خود توکن هرگز به کلاینت برنمی‌گردد) */
  pushRegistered: boolean;
  lastActiveAt: string;
  createdAt: string;
}

/** پاسخ POST /devices/push-token */
export interface PushTokenResponse {
  deviceId: string | null;
  registered: boolean;
}

/** payload یک اعلان push سمت سرور — به provider (Expo/webhook) داده می‌شود */
export interface DelPushPayload {
  /** گیرنده (برای webhook) — هر دریافت‌کننده یک payload */
  userId: string;
  kind: 'message' | 'call';
  title: string;
  body: string;
  /** payload سفارشی برای ناوبری کلاینت */
  data: {
    conversationId?: string;
    messageId?: string;
    callId?: string;
    [k: string]: unknown;
  };
  /** توکن‌های push این کاربر که این بسته برای آن‌هاست */
  tokens: string[];
}

/** پاسخ GET /sync/bootstrap — بوت‌استرپ کامل یک دستگاه تازه */
export interface SyncBootstrap {
  serverTime: string;
  user: UserDto;
  conversations: ConversationDto[];
}

/** پاسخ GET /sync/updates — فقط مکالمه‌های تغییریافته پس از since */
export interface SyncUpdates {
  serverTime: string;
  conversations: ConversationDto[];
  /** مکالمه‌هایی که دیگر عضوشان نیستید (اخراج/خروج در دستگاه دیگر) */
  removedConversationIds: string[];
}

// ————— رمزنگاری سرتاسری (گام ۸) —————

/** وضعیت E2EE خودم — GET /e2ee/status */
export interface E2eeStatus {
  /** آیا هویت E2EE روی سرور دارم؟ */
  identity: boolean;
  /** آیا پشتیبان (کلید بازیابی) روی سرور هست؟ */
  backup: boolean;
  /** تعداد دستگاه‌های دارای هویت */
  deviceCount: number;
}

/** هویت عمومی یک دستگاه — GET /e2ee/devices/:userId */
export interface E2eeDeviceKeys {
  deviceId: string;
  ikEd: string;
  ikX: string;
  spkKeyId: number;
  spk: string;
  spkSig: string;
  /** کلیدهای یک‌بارمصرف باقی‌مانده (برای top-up سمت صاحب کلید) */
  otkCount: number;
  createdAt: string;
}

/** بسته کامل برای X3DH — GET /e2ee/bundle/:userId (یک OTK مصرف می‌شود) */
export interface E2eeBundle {
  userId: string;
  deviceId: string;
  ikEd: string;
  ikX: string;
  spkKeyId: number;
  spk: string;
  spkSig: string;
  /** null = OTK ته کشیده — X3DH بدون DH4 */
  otk: { keyId: number; key: string } | null;
}

/** پشتیبان هویت — GET /e2ee/backup (blob رمز است؛ کلید بازیابی نزد کاربر است) */
export interface E2eeBackup {
  blob: string;
  salt: string;
  updatedAt: string;
}

// ————— هوش مصنوعی (گام ۹) —————

export type AiFeature = 'translate' | 'fix' | 'suggest' | 'summarize';

export type AiProviderName = 'mock' | 'openai' | 'webhook';

/** بدنه پاسخ درخواست‌های AI — بدون کلید provider (سرور آن را نگه می‌دارد) */
export interface AiTextResult {
  feature: AiFeature;
  text: string;
  provider: AiProviderName | string;
  /** زبان مقصد برای translate */
  target?: string;
}

/** رکورد مصرف — GET /ai/usage (فقط متادیتا برای کنترل هزینه) */
export interface AiUsageDto {
  id: string;
  feature: AiFeature | string;
  provider: string;
  ok: boolean;
  charsIn: number;
  charsOut: number;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
  conversationId: string | null;
  createdAt: string;
}

/** پاسخ GET /ai/usage */
export interface AiUsageReport {
  items: AiUsageDto[];
  total: number;
  /** جمع کاراکتر ورودی/خروجی برای برآورد هزینه */
  charsIn: number;
  charsOut: number;
}

/** پاسخ GET /ai/status — وضعیت قابلیت AI برای این کاربر */
export interface AiStatus {
  /** آیا سرور اصلاً provider AI دارد؟ */
  available: boolean;
  provider: AiProviderName | string | null;
  globalConsent: boolean;
}

// ————— مدیریت، گزارش و مسدودسازی (گام ۱۰) —————

export type UserRole = 'user' | 'admin';

/** کاربر از دید ادمین — آمار و وضعیت انسداد */
export interface AdminUserDto {
  id: string;
  phone: string | null;
  displayName: string | null;
  role: UserRole;
  blockedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  stats: {
    conversations: number;
    messages: number;
    devices: number;
    reportsAgainst: number;
  };
  /** علتی که ادمین هنگام مسدودسازی ثبت کرده */
  blockReason?: string | null;
}

export interface AdminUserPage {
  items: AdminUserDto[];
  total: number;
  page: number;
  pageSize: number;
}

export type ReportReason = 'spam' | 'abuse' | 'impersonation' | 'other';
export type ReportStatus = 'open' | 'resolved' | 'dismissed';

export interface ReportDto {
  id: string;
  reporter: { id: string; displayName: string | null; phone: string | null };
  reported: { id: string; displayName: string | null; phone: string | null; blockedAt: string | null };
  conversationId: string | null;
  reason: ReportReason;
  note: string | null;
  status: ReportStatus;
  resolution: string | null;
  handledBy: string | null;
  handledAt: string | null;
  createdAt: string;
}

export interface ReportPage {
  items: ReportDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** رکورد دفتر ثبت اقدامات مدیریتی — GET /admin/audit */
export interface AuditLogDto {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

/** متریک‌های کلی پنل مدیریت — GET /admin/metrics */
export interface AdminMetrics {
  users: { total: number; admins: number; blocked: number };
  conversations: { total: number; direct: number; group: number };
  messages: { total: number; last24h: number };
  media: { total: number; bytes: number };
  calls: { total: number; last24h: number };
  reports: { open: number; total: number };
  /** تعداد کاربران آنلاین همین الان (از gateway) */
  onlineNow: number;
}

/** فهرست مسدودسازی‌های من — GET /users/me/blocks */
export interface BlockListDto {
  items: { userId: string; displayName: string | null; phone: string | null; createdAt: string }[];
}

/** رویداد WS مسدودسازی حساب توسط ادمین — socket بلافاصله قطع می‌شود */
export interface WsAccountBlocked {
  code: 'ACCOUNT_BLOCKED';
  message: string;
}
