import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { AuthSession, RequestOtpResponse, UserDto } from '@del/shared-types';
import { AppConfig, appConfig } from '../config/configuration';
import { PrismaService } from '../infra/prisma.service';
import { RateLimitService } from '../common/rate-limit.service';
import type { AccessPayload } from '../common/jwt-auth.guard';
import type { DevicePlatform } from '@del/shared-types';
import { toE164 } from './phone.util';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

const OTP_SALT = 'del.otp.v1';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function httpError(status: number, code: string, message: string): HttpException {
  return new HttpException({ statusCode: status, error: { code, message } }, status);
}

function toUserDto(u: {
  id: string;
  phone: string;
  displayName: string | null;
  avatarUrl: string | null;
  about: string | null;
  aiConsent: boolean;
  role: string;
  createdAt: Date;
}): UserDto {
  return {
    id: u.id,
    phone: u.phone,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    about: u.about,
    aiConsent: u.aiConsent,
    role: u.role as UserDto['role'],
    createdAt: u.createdAt.toISOString(),
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private cfg(): AppConfig {
    // configuration از process.env خوانده می‌شود (همان منبع ConfigModule)
    return appConfig.load();
  }

  /**
   * گام ۱ ورود: تولید و ذخیره کد OTP
   * در حالت توسعه (AUTH_DEV_MODE=true) کد در پاسخ برگردانده می‌شود چون سرویس SMS متصل نیست.
   */
  async requestOtp(dto: RequestOtpDto, ip: string): Promise<RequestOtpResponse> {
    const cfg = this.cfg();
    const phone = toE164(dto.phone);
    if (!phone) {
      throw httpError(400, 'PHONE_INVALID', 'Phone number format is not valid');
    }

    await this.rateLimit.hit(`otp:ip:${ip}`, 600, cfg.otpPerIpLimit);
    await this.rateLimit.hit(`otp:phone:${phone}`, cfg.otpPhoneWindowSec, cfg.otpPerPhoneLimit);

    const code = String(randomInt(100000, 1000000));
    await this.prisma.$transaction([
      // باطل‌کردن کدهای قبلیِ فعالِ همین شماره
      this.prisma.otpCode.updateMany({
        where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      }),
      this.prisma.otpCode.create({
        data: {
          phone,
          codeHash: sha256(`${OTP_SALT}:${phone}:${code}`),
          expiresAt: new Date(Date.now() + cfg.otpTtlSec * 1000),
        },
      }),
    ]);

    if (cfg.authDevMode) {
      this.logger.log(`[DEV MODE] OTP for ${phone}: ${code}`);
      return { devCode: code, expiresInSeconds: cfg.otpTtlSec };
    }

    // TODO(Step 2): اتصال به سرویس SMS (Kavenegar/SMS.ir) — docs/02-architecture.md
    this.logger.log(`OTP generated for ${phone} — SMS provider not configured yet`);
    return { expiresInSeconds: cfg.otpTtlSec };
  }

  /** گام ۲ ورود: بررسی کد، ساخت/به‌روزرسانی کاربر و صدور توکن‌ها */
  async verifyOtp(dto: VerifyOtpDto): Promise<AuthSession> {
    const cfg = this.cfg();
    const phone = toE164(dto.phone);
    if (!phone) {
      throw httpError(400, 'PHONE_INVALID', 'Phone number format is not valid');
    }

    const otp = await this.prisma.otpCode.findFirst({
      where: { phone, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      throw httpError(400, 'OTP_NOT_FOUND', 'No active code for this phone. Request a new one.');
    }
    if (otp.expiresAt < new Date()) {
      throw httpError(400, 'OTP_EXPIRED', 'Code expired. Request a new one.');
    }
    if (otp.attempts >= cfg.otpMaxAttempts) {
      throw httpError(429, 'OTP_LOCKED', 'Too many wrong attempts. Request a new code.');
    }

    if (otp.codeHash !== sha256(`${OTP_SALT}:${phone}:${dto.code}`)) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw httpError(400, 'OTP_INVALID', 'Code is wrong');
    }

    await this.prisma.otpCode.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });

    // ساخت کاربر در صورت نبود (Upsert) — شماره‌های ادمین (ADMIN_PHONES) نقش admin می‌گیرند
    const isAdminPhone = cfg.adminPhones.includes(phone);
    const user = await this.prisma.user.upsert({
      where: { phone },
      update: {
        lastSeenAt: new Date(),
        ...(isAdminPhone && { role: 'admin' }),
      },
      create: { phone, lastSeenAt: new Date(), role: isAdminPhone ? 'admin' : 'user' },
    });

    // حساب مسدودشده (گام ۱۰) — حتی با کد صحیح ورود نمی‌کند
    if (user.blockedAt) {
      throw httpError(403, 'ACCOUNT_BLOCKED', 'This account has been blocked');
    }

    const device = await this.prisma.device.create({
      data: {
        userId: user.id,
        platform: dto.platform ?? 'android',
        name: dto.deviceName ?? null,
      },
    });

    const session = await this.issueTokens(user.id, device.id, cfg);
    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresIn: session.expiresIn,
      user: toUserDto(user),
    };
  }

  /** چرخش refresh token — توکن قدیمی باطل و جفت جدید صادر می‌شود */
  async refresh(refreshToken: string): Promise<AuthSession> {
    const cfg = this.cfg();
    const hash = sha256(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: { user: true },
    });

    if (!stored) {
      throw httpError(401, 'REFRESH_INVALID', 'Refresh token is invalid or expired');
    }

    // تشخیص استفاده مجدد از توکنِ باطل‌شده → همه نشست‌های کاربر باطل می‌شوند (counter-theft)
    if (stored.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw httpError(401, 'REFRESH_REUSED', 'Refresh token reuse detected — all sessions revoked');
    }

    if (stored.expiresAt < new Date()) {
      throw httpError(401, 'REFRESH_INVALID', 'Refresh token is invalid or expired');
    }

    // حساب مسدودشده (گام ۱۰) — چرخش توکن بسته است
    if (stored.user.blockedAt) {
      throw httpError(403, 'ACCOUNT_BLOCKED', 'This account has been blocked');
    }

    const newTokens = await this.issueTokens(stored.userId, stored.deviceId, cfg);
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: {
        revokedAt: new Date(),
        replacedById: newTokens.refreshRowId,
      },
    });

    return {
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken,
      expiresIn: newTokens.expiresIn,
      user: toUserDto(stored.user),
    };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(
    userId: string,
    deviceId: string | null,
    cfg: AppConfig,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; refreshRowId: string }> {
    const accessPayload: Omit<AccessPayload, 'did'> & { did?: string } = {
      sub: userId,
      typ: 'access',
    };
    const accessToken = await this.jwt.signAsync(
      deviceId ? { ...accessPayload, did: deviceId } : accessPayload,
      { secret: cfg.jwtAccessSecret, expiresIn: cfg.accessTokenTtl },
    );

    const refreshToken = randomBytes(48).toString('hex');
    const created = await this.prisma.refreshToken.create({
      data: {
        userId,
        deviceId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + cfg.refreshTokenTtl * 1000),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: cfg.accessTokenTtl,
      refreshRowId: created.id,
    };
  }
}
