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
    const redisUp = await this.redis.ping();

    return {
      status: dbUp && redisUp ? 'ok' : 'degraded',
      services: { database: dbUp ? 'up' : 'down', redis: redisUp ? 'up' : 'down' },
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version ?? '0.1.0',
    };
  }
}
