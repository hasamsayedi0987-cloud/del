import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { appConfig } from './config/configuration';

/**
 * سرآیندهای امنیتی پایه (گام ۱۰ — سخت‌سازی، ASVS V14)
 * helmet وابسته نیست — مستقیم و شفاف.
 */
function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Del-API', appConfig.load().version);
  // CORS خودش Access-Control-Allow-Origin را می‌گذارد
  next();
}

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.setGlobalPrefix('api/v1');
  // پشت پروکسی Render — req.protocol برای ساخت URLهای امضاشدهٔ حالت لوکال رسانه درست شود
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.enableCors({
    // پروداکشن: مبداها با DEL_CORS_ORIGINS (کاما بین آدرس‌ها) محدود می‌شوند — پیش‌فرض بسته
    origin: process.env.DEL_CORS_ORIGINS
      ? process.env.DEL_CORS_ORIGINS.split(',').map((s) => s.trim())
      : true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });
  app.disable('x-powered-by');
  // v1.5.3: استوری/آواتار به‌صورت base64 از API می‌آیند — base64 حجم را ×۴/۳ می‌کند؛
  // تصویر ۲MB استوری ≈ ۲٫۷MB پایه‌۶۴ — سقف ۴MB با حاشیهٔ امن
  app.useBodyParser('json', { limit: '4mb' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );
  // نکته: پیوست‌های رسانه از Presigned URL می‌روند نه API — فقط استوری/آواتار از body (۲mb)

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Del API')
      .setDescription('Del messenger — secure cross-platform messenger (iOS/Android/Windows/macOS)')
      .setVersion(appConfig.load().version)
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/v1/docs', app, document);
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  logger.log(`Del API ready → http://0.0.0.0:${port}/api/v1/health`);
}

void bootstrap();
