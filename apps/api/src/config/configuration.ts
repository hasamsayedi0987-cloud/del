export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  databaseUrl: string;
  redisUrl: string | undefined;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  accessTokenTtl: number;
  refreshTokenTtl: number;
  /** حالت توسعه: کد OTP در پاسخ برگردانده می‌شود (بدون سرویس SMS) */
  authDevMode: boolean;
  // ————— پیامک (گام ۱۱) — کاوه‌نگار —————
  /** در صورت تنظیم KAVENEGAR_API_KEY کد ورود با پیامک واقعی ارسال می‌شود */
  smsProvider: 'kavenegar' | undefined;
  smsApiKey: string | undefined;
  /** شماره فرستنده خط خدماتی (اختیاری — فقط برای sms/send) */
  smsSender: string | undefined;
  /** قالب Verify Lookup در پنل کاوه‌نگار (اختیاری — اگر تنظیم شود از verify/lookup استفاده می‌شود) */
  smsOtpTemplate: string | undefined;
  /** آیا پیامک واقعی فعال است؟ */
  smsConfigured: boolean;
  /** سقف درخواست OTP به ازای هر شماره در پنجره زمانی */
  otpPerPhoneLimit: number;
  otpPhoneWindowSec: number;
  /** سقف درخواست OTP به ازای هر IP در پنجره (پیش‌فرض ۲۰) */
  otpPerIpLimit: number;
  otpTtlSec: number;
  otpMaxAttempts: number;
  version: string;
  // ————— رسانه (گام ۵) — S3/MinIO —————
  s3Endpoint: string | undefined;
  s3Region: string;
  s3Bucket: string;
  s3AccessKey: string | undefined;
  s3SecretKey: string | undefined;
  s3ForcePathStyle: boolean;
  mediaSignedUrlTtlSec: number;
  mediaMultipartThresholdBytes: number;
  mediaPartSizeBytes: number;
  mediaMaxImageBytes: number;
  mediaMaxFileBytes: number;
  /** آیا پیکربندی storage رسانه کامل است؟ */
  mediaConfigured: boolean;
  // ————— تماس‌ها (گام ۶) — LiveKit SFU —————
  /** آدرس WebSocket سرور LiveKit که به کلاینت‌ها داده می‌شود (wss://… یا ws://…) */
  livekitUrl: string | undefined;
  livekitApiKey: string | undefined;
  livekitApiSecret: string | undefined;
  /** عمر توکن LiveKit */
  livekitTokenTtlSec: number;
  /** سقف زمان زنگ خوردن بدون پاسخ */
  callRingTimeoutSec: number;
  /** آیا پیکربندی تماس کامل است؟ */
  callsConfigured: boolean;
  // ————— اعلان‌ها (گام ۷) — Push —————
  /** اگر تنظیم شود، payload اعلان به این URL هم POST می‌شود (تست/یکپارچه‌سازی خودمیزبان) */
  pushWebhookUrl: string | undefined;
  /** ارسال به سرویس Expo Push برای توکن‌های ExpoPushToken (پیش‌فرض روشن) */
  pushExpoEnabled: boolean;
  // ————— هوش مصنوعی (گام ۹) —————
  /** mock | openai | webhook — پیش‌فرض: خودکار (openai اگر کلید باشد، webhook اگر URL باشد، وگرنه mock) */
  aiProvider: 'mock' | 'openai' | 'webhook' | undefined;
  /** آدرس پایه سازگار با OpenAI (مثلاً https://api.openai.com/v1 یا vLLM محلی) */
  aiBaseUrl: string | undefined;
  aiApiKey: string | undefined;
  aiModel: string;
  /** URL سرویس webhook عمومی (تست/یکپارچه‌سازی خودمیزبان) */
  aiWebhookUrl: string | undefined;
  /** سقف فراخوانی AI به ازای هر کاربر در دقیقه */
  aiRatePerMin: number;
  /** آیا قابلیت AI فعال است؟ (AI_ENABLED=false خاموشش می‌کند) */
  aiEnabled: boolean;
  // ————— مدیریت (گام ۱۰) —————
  /** شماره‌های ادمین جداشده با کاما — در ورود، نقش admin می‌گیرند (ADMIN_PHONES=+98912…,+98913…) */
  adminPhones: string[];
  /** آدرس ایمیل/نشانی DPO برای سیاست حریم خصوصی (سند ۰۹) */
  privacyContact: string | undefined;
}

export const appConfig = {
  load: (): AppConfig => {
    const env = process.env;
    return {
      nodeEnv: (env.NODE_ENV as AppConfig['nodeEnv']) ?? 'development',
      port: Number(env.PORT ?? 3000),
      databaseUrl: env.DATABASE_URL ?? '',
      redisUrl: env.REDIS_URL,
      jwtAccessSecret: env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me',
      jwtRefreshSecret: env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me',
      accessTokenTtl: Number(env.ACCESS_TOKEN_TTL ?? 900),
      refreshTokenTtl: Number(env.REFRESH_TOKEN_TTL ?? 2592000),
      authDevMode: (env.AUTH_DEV_MODE ?? 'true') === 'true',
      smsProvider: env.KAVENEGAR_API_KEY ? 'kavenegar' : undefined,
      smsApiKey: env.KAVENEGAR_API_KEY,
      smsSender: env.KAVENEGAR_SENDER,
      smsOtpTemplate: env.KAVENEGAR_OTP_TEMPLATE,
      smsConfigured: Boolean(env.KAVENEGAR_API_KEY),
      otpPerPhoneLimit: Number(env.OTP_PER_PHONE_LIMIT ?? 3),
      otpPhoneWindowSec: Number(env.OTP_PHONE_WINDOW_SEC ?? 600),
      otpPerIpLimit: Number(env.OTP_PER_IP_LIMIT ?? 20),
      otpTtlSec: Number(env.OTP_TTL_SEC ?? 300),
      otpMaxAttempts: Number(env.OTP_MAX_ATTEMPTS ?? 5),
      version: env.npm_package_version ?? '0.1.0',
      s3Endpoint: env.S3_ENDPOINT,
      s3Region: env.S3_REGION ?? 'us-east-1',
      s3Bucket: env.S3_BUCKET ?? 'del-media',
      s3AccessKey: env.S3_ACCESS_KEY,
      s3SecretKey: env.S3_SECRET_KEY,
      s3ForcePathStyle: (env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
      mediaSignedUrlTtlSec: Number(env.MEDIA_SIGNED_URL_TTL_SEC ?? 300),
      mediaMultipartThresholdBytes:
        Number(env.MEDIA_MULTIPART_THRESHOLD_MB ?? 10) * 1024 * 1024,
      mediaPartSizeBytes: Number(env.MEDIA_PART_SIZE_MB ?? 8) * 1024 * 1024,
      mediaMaxImageBytes: Number(env.MEDIA_MAX_IMAGE_MB ?? 25) * 1024 * 1024,
      mediaMaxFileBytes: Number(env.MEDIA_MAX_FILE_MB ?? 1024) * 1024 * 1024,
      mediaConfigured: Boolean(env.S3_ENDPOINT && env.S3_ACCESS_KEY && env.S3_SECRET_KEY),
      livekitUrl: env.LIVEKIT_URL,
      livekitApiKey: env.LIVEKIT_API_KEY,
      livekitApiSecret: env.LIVEKIT_API_SECRET,
      livekitTokenTtlSec: Number(env.LIVEKIT_TOKEN_TTL_SEC ?? 3600),
      callRingTimeoutSec: Number(env.CALL_RING_TIMEOUT_SEC ?? 45),
      callsConfigured: Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET),
      pushWebhookUrl: env.PUSH_WEBHOOK_URL,
      pushExpoEnabled: (env.PUSH_EXPO_ENABLED ?? 'true') === 'true',
      aiProvider:
        env.AI_PROVIDER === 'mock' || env.AI_PROVIDER === 'openai' || env.AI_PROVIDER === 'webhook'
          ? env.AI_PROVIDER
          : undefined,
      aiBaseUrl: env.AI_BASE_URL,
      aiApiKey: env.AI_API_KEY,
      aiModel: env.AI_MODEL ?? 'gpt-4o-mini',
      aiWebhookUrl: env.AI_WEBHOOK_URL,
      aiRatePerMin: Number(env.AI_RATE_PER_MIN ?? 20),
      aiEnabled: (env.AI_ENABLED ?? 'true') === 'true',
      adminPhones: (env.ADMIN_PHONES ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      privacyContact: env.PRIVACY_CONTACT,
    };
  },
};
