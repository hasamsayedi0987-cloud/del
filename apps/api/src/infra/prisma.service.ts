import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ log: [{ emit: 'stdout', level: 'error' }] });
  }

  async onModuleInit(): Promise<void> {
    // Prisma اتصال را lazy برقرار می‌کند؛ اینجا فقط بررسی می‌کنیم که DB در دسترس است
    try {
      await this.$queryRaw`SELECT 1`;
      this.logger.log('Database connection OK');
    } catch (err) {
      // در بوت اولیه سخت گیرانه fail نمی‌کنیم — health endpoint وضعیت را گزارش می‌کند
      this.logger.error(`Database not reachable yet: ${(err as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
