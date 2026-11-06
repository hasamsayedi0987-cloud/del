import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RedisService } from '../infra/redis.service';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * محدودساز نرخ درخواست — دو مسیر:
 *  1) Redis (INCR + EXPIRE) — حالت عادی و پروداکشن
 *  2) Map درون‌حافظه‌ای — fallback وقتی Redis قطع است (تک‌نود)
 */
@Injectable()
export class RateLimitService {
  private readonly memory = new Map<string, Bucket>();

  constructor(private readonly redis: RedisService) {}

  /** در صورت عبور از سقف، 429 پرتاب می‌کند */
  async hit(key: string, windowSec: number, max: number): Promise<void> {
    const count = await this.redis.safe(
      async (r) => {
        const n = await r.incr(`rl:${key}`);
        if (n === 1) await r.expire(`rl:${key}`, windowSec);
        return n;
      },
      -1,
    );

    let current: number;
    if (count === -1) {
      current = this.memoryHit(key, windowSec);
    } else {
      current = count;
    }

    if (current > max) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Please try later.' },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private memoryHit(key: string, windowSec: number): number {
    const now = Date.now();
    const bucket = this.memory.get(key);
    if (!bucket || bucket.resetAt < now) {
      this.memory.set(key, { count: 1, resetAt: now + windowSec * 1000 });
      return 1;
    }
    bucket.count += 1;
    return bucket.count;
  }
}
