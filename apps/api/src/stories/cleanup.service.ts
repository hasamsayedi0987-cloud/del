import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../infra/prisma.service';
import { StoriesService } from './stories.service';

/** هر ۵ دقیقه: استوری منقضی و پیام محوشونده را پاک می‌کند */
@Injectable()
export class CleanupService implements OnModuleInit {
  private readonly logger = new Logger(CleanupService.name);
  private timer: NodeJS.Timeout | null = null;
  private stories?: StoriesService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.run(), 5 * 60 * 1000);
    this.timer.unref?.();
  }

  private async run(): Promise<void> {
    try {
      if (!this.stories) this.stories = this.moduleRef.get(StoriesService, { strict: false });
      await this.stories.cleanupExpired();
      const gone = await this.prisma.message.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (gone.count > 0) this.logger.log(`cleaned ${gone.count} expired messages`);
    } catch (e) {
      this.logger.warn(`cleanup failed: ${String(e)}`);
    }
  }
}
