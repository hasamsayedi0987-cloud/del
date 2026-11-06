import { Injectable, Logger } from '@nestjs/common';
import type { PresenceDto } from '@del/shared-types';
import { RedisService } from '../infra/redis.service';

/**
 * PresenceService — حضور کاربران (گام ۳)
 *
 * ساختار: کلید `del:presence:{userId}` = JSON {online, lastSeen}
 *  - online  → با TTL کوتاه (۷۵ ثانیه) ذخیره می‌شود؛ heartbeat هر ۲۵ ثانیه TTL را تمدید می‌کند
 *  - offline → lastSeen ثبت و با TTL بلند ذخیره می‌شود
 * اگر Redis در دسترس نباشد → fallback حافظه‌ای (graceful degradation، مثل محدودساز نرخ)
 */
const KEY = (userId: string): string => `del:presence:${userId}`;
const ONLINE_TTL_SECONDS = 75;
const OFFLINE_TTL_SECONDS = 60 * 60 * 24 * 30;

interface PresenceState {
  online: boolean;
  lastSeen: string | null;
}

@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  private readonly memory = new Map<string, PresenceState>();

  constructor(private readonly redis: RedisService) {}

  async setOnline(userId: string): Promise<void> {
    const state: PresenceState = { online: true, lastSeen: null };
    const stored = await this.redis.safe(async (r) => {
      await r.set(KEY(userId), JSON.stringify(state), 'EX', ONLINE_TTL_SECONDS);
      return true;
    }, false);
    if (stored) this.memory.delete(userId);
    else this.memory.set(userId, state);
  }

  async setOffline(userId: string): Promise<void> {
    const state: PresenceState = { online: false, lastSeen: new Date().toISOString() };
    const stored = await this.redis.safe(async (r) => {
      await r.set(KEY(userId), JSON.stringify(state), 'EX', OFFLINE_TTL_SECONDS);
      return true;
    }, false);
    if (!stored) this.memory.set(userId, state);
  }

  /** تمدید TTL وضعیت online — هر ۲۵ ثانیه از سمت کلاینت فراخوانی می‌شود */
  async heartbeat(userId: string): Promise<void> {
    const stored = await this.redis.safe(async (r) => {
      const raw = await r.get(KEY(userId));
      const state: PresenceState = raw
        ? { ...(JSON.parse(raw) as PresenceState), online: true }
        : { online: true, lastSeen: null };
      await r.set(KEY(userId), JSON.stringify(state), 'EX', ONLINE_TTL_SECONDS);
      return true;
    }, false);
    if (!stored) {
      const cur = this.memory.get(userId);
      this.memory.set(userId, { online: true, lastSeen: cur?.lastSeen ?? null });
    }
  }

  async get(userId: string): Promise<PresenceDto> {
    const raw = await this.redis.safe(async (r) => r.get(KEY(userId)), null as string | null);
    if (raw) {
      try {
        const s = JSON.parse(raw) as PresenceState;
        return { userId, online: s.online, lastSeen: s.lastSeen };
      } catch {
        // کلید خراب — مثل نبود کلید رفتار می‌کنیم
      }
    }
    const m = this.memory.get(userId);
    return { userId, online: m?.online ?? false, lastSeen: m?.lastSeen ?? null };
  }
}
