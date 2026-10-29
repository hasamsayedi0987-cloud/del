import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * RedisService — کلاینت Redis با «شکست نرم» (graceful degradation):
 * اگر Redis در دسترس نباشد، سرویس‌ها به حالت جایگزین (مثل محدودساز درون‌حافظه‌ای) می‌روند
 * و API بالا می‌ماند. برای Step 1 این رفتار عمدی است.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null;

  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.warn('REDIS_URL not set — running without Redis (memory fallbacks active)');
      this.client = null;
      return;
    }
    this.client = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times) => (times > 10 ? null : Math.min(times * 500, 3000)),
    });
    this.client.on('error', (err) => {
      // بدون این listener، ioredis خطای unhandled می‌دهد
      this.logger.warn(`Redis error: ${err.message}`);
    });
    void this.client.connect().catch(() => {
      this.logger.warn('Redis initial connect failed — will retry in background');
    });
  }

  get connected(): boolean {
    return this.client?.status === 'ready';
  }

  /** اجرای دستور با تلورانس خطا — در صورت قطعی Redis مقدار پیش‌فرض برمی‌گردد */
  async safe<T>(fn: (redis: Redis) => Promise<T>, fallback: T): Promise<T> {
    if (!this.client || !this.connected) return fallback;
    try {
      return await fn(this.client);
    } catch {
      return fallback;
    }
  }

  async ping(): Promise<boolean> {
    return this.safe(async (redis) => (await redis.ping()) === 'PONG', false);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }
}
