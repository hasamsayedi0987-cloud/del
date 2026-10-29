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
