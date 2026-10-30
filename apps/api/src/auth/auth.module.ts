import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RateLimitService } from '../common/rate-limit.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, RateLimitService, JwtAuthGuard],
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me',
        signOptions: { expiresIn: Number(process.env.ACCESS_TOKEN_TTL ?? 900) },
      }),
    }),
  ],
  exports: [JwtAuthGuard, JwtModule, RateLimitService],
})
export class AuthModule {}
