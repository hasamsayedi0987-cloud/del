import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../infra/prisma.service';

export interface AccessPayload {
  sub: string;
  did: string | null;
  typ: 'access';
}

export interface AuthedRequest extends Request {
  user: AccessPayload & { role: 'user' | 'admin' };
  /** نام نمایشی برای دفتر اقدامات (audit) — از همان بررسی زنده می‌آید */
  userName?: string | null;
}

/**
 * گارد JWT — و تأیید زندهٔ وضعیت حساب در هر درخواست (گام ۱۰):
 * مسدودسازی ادمین همان لحظه همهٔ مسیرهای API را برای کاربر می‌بندد
 * (تناظر ASVS V4.1 — اعتبارسنجی سمت سرور در هر درخواست).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: { code: 'NO_TOKEN', message: 'Authorization header with Bearer token required' },
      });
    }
    let payload: AccessPayload;
    try {
      payload = this.jwt.verify<AccessPayload>(header.slice(7));
      if (payload.typ !== 'access' || !payload.sub) throw new Error('bad payload');
    } catch {
      throw new UnauthorizedException({
        statusCode: 401,
        error: { code: 'TOKEN_INVALID_OR_EXPIRED', message: 'Access token is invalid or expired' },
      });
    }

    // بررسی زندهٔ نقش/انسداد — یک findUnique روی کلید اصلی، ارزان است
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { blockedAt: true, role: true, displayName: true },
    });
    if (!user) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: { code: 'TOKEN_INVALID_OR_EXPIRED', message: 'Access token is invalid or expired' },
      });
    }
    if (user.blockedAt) {
      throw new ForbiddenException({
        statusCode: 403,
        error: { code: 'ACCOUNT_BLOCKED', message: 'This account has been blocked' },
      });
    }
    (req as AuthedRequest).user = {
      ...payload,
      role: user.role as 'user' | 'admin',
    };
    (req as AuthedRequest).userName = user.displayName;
    return true;
  }
}
