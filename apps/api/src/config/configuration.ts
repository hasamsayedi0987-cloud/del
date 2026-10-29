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
  /** سقف درخواست OTP به ازای هر شماره در پنجره زمانی */
  otpPerPhoneLimit: number;
  otpPhoneWindowSec: number;
  otpTtlSec: number;
  otpMaxAttempts: number;
  version: string;
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
      otpPerPhoneLimit: Number(env.OTP_PER_PHONE_LIMIT ?? 3),
      otpPhoneWindowSec: Number(env.OTP_PHONE_WINDOW_SEC ?? 600),
      otpTtlSec: Number(env.OTP_TTL_SEC ?? 300),
      otpMaxAttempts: Number(env.OTP_MAX_ATTEMPTS ?? 5),
      version: env.npm_package_version ?? '0.1.0',
    };
  },
};
