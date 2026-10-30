import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthedRequest } from './jwt-auth.guard';

/**
 * گارد ادمین (گام ۱۰) — بعد از JwtAuthGuard می‌نشیند
 * و نقش admin را از تأیید زندهٔ همان گارد می‌خواند.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (req.user?.role !== 'admin') {
      throw new ForbiddenException({
        statusCode: 403,
        error: { code: 'ADMIN_ONLY', message: 'Admin role required' },
      });
    }
    return true;
  }
}
