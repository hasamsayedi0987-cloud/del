/**
 * Del — Shared types (Step 1: Auth foundation)
 * این تایپ‌ها قرارداد مشترک بین API و کلاینت‌ها هستند.
 * قرارداد کامل در docs/05-api-design.md توصیف شده است.
 */

export type DevicePlatform = 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'web';

export interface UserDto {
  id: string;
  phone: string;
  displayName: string | null;
  avatarUrl: string | null;
  about: string | null;
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
    redis: 'up' | 'down';
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
  type: 'text' | string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface ParticipantDto {
  userId: string;
  displayName: string | null;
  phone: string;
  lastReadSeq: number;
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
  /** تعداد پیام‌های خوانده‌نشده این کاربر */
  unreadCount: number;
  /** پیش‌نمایش آخرین پیام */
  lastMessage: { body: string; createdAt: string; senderId: string } | null;
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
