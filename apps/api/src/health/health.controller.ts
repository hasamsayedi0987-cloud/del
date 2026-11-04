import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { RedisService } from '../infra/redis.service';
import type { HealthResponse } from '@del/shared-types';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check(): Promise<HealthResponse> {
    const dbUp = await this.prisma
      .$queryRaw`SELECT 1`
      .then(() => true)
      .catch(() => false);
    // Redis اختیاری است: بدون REDIS_URL سرویس‌ها از fallback حافظه‌ای استفاده می‌کنند — این «down» نیست
    const redisConfigured = this.redis.configured;
    const redisUp = await this.redis.ping();
    const redisState: HealthResponse['services']['redis'] = redisUp
      ? 'up'
      : redisConfigured
        ? 'down'
        : 'disabled';

    return {
      status: dbUp && (redisUp || !redisConfigured) ? 'ok' : 'degraded',
      services: { database: dbUp ? 'up' : 'down', redis: redisState },
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.1.0',
    };
  }
}
