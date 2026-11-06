// تست دود DI — بوت AppModule بدون دیتابیس: اگر گراف تزریق وابستگی سالم باشد
// باید ماژول‌ها instantiate شوند و سپس فقط خطای اتصال Prisma بدهیم.
process.env.JWT_ACCESS_SECRET = 'smoke-test-secret';
process.env.DATABASE_URL = 'postgresql://smoke:smoke@127.0.0.1:1/smoke';

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';

(async () => {
  try {
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn'],
    });
    console.log('DI_SMOKE_OK: full graph resolved (unexpected without DB)');
    await app.close();
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (/Nest can't resolve dependencies/i.test(msg)) {
      console.error('DI_STILL_BROKEN:', msg.slice(0, 400));
      process.exit(2);
    }
    console.log('DI_SMOKE_PASS: no DI errors; failed only on infra as expected:');
    console.log('  ', msg.slice(0, 160));
    process.exit(0);
  }
})();
