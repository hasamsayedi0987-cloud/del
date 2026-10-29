import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

export interface AccessPayload {
  sub: string;
  did: string | null;
  typ: 'access';
}

export interface AuthedRequest extends Request {
  user: AccessPayload;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: { code: 'NO_TOKEN', message: 'Authorization header with Bearer token required' },
      });
    }
    try {
      const payload = this.jwt.verify<AccessPayload>(header.slice(7));
      if (payload.typ !== 'access' || !payload.sub) throw new Error('bad payload');
      (req as AuthedRequest).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException({
        statusCode: 401,
        error: { code: 'TOKEN_INVALID_OR_EXPIRED', message: 'Access token is invalid or expired' },
      });
    }
  }
}
