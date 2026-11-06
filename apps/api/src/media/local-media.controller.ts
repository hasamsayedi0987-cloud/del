import { Logger } from '@nestjs/common';
import { Controller, Get, Param, ParseUUIDPipe, Put, Query, Req, Res } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import * as fs from 'node:fs';
import { MediaService } from './media.service';

/**
 * endpointهای حالت لوکال رسانه — وقتی S3 تنظیم نشده است.
 * قرارداد با کلاینت عیناً مثل S3 است: PUT به URL امضاشده، سپس complete؛
 * دانلود هم URL امضاشدهٔ کوتاه‌عمر — اینجا بایت‌ها از خود API عبور می‌کنند.
 */
@ApiTags('media-local')
@Controller('media/local')
export class LocalMediaController {
  private readonly logger = new Logger('LocalMedia');
  constructor(private readonly media: MediaService) {}

  /** PUT بایت‌ها — توکن HMAC در query (۱۵ دقیقه اعتبار مثل presign) */
  @Put(':id/upload')
  async upload(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    this.media.assertUploadToken(id, expires, sig);
    try {
      await this.media.writeLocalUpload(id, req);
      res.status(200).json({ ok: true });
    } catch (e) {
      const status = e instanceof HttpException ? e.getStatus() : 400;
      const body = e instanceof HttpException
        ? e.getResponse()
        : { statusCode: 400, error: { code: 'UPLOAD_FAILED', message: 'Upload failed' } };
      res.status(status).json(body);
    }
  }

  /** GET فایل — امضای HMAC + انقضا در query؛ پاسخ استریم فایل از دیسک */
  @Get(':id')
  download(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('variant') variant: string | undefined,
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): void {
    const v = variant === 'thumb' ? 'thumb' : 'original';
    this.media.assertDownloadToken(id, v, expires, sig);
    void this.media
      .localFileForDownload(id, v)
      .then(({ filePath, mime, name }) => {
        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', 'private, max-age=240');
        if (name) {
          res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
        }
        const stream = fs.createReadStream(filePath);
        stream.on('error', (err) => {
          this.logger.warn(`local file read failed: ${err.message}`);
          if (!res.headersSent) res.status(404).json({ statusCode: 404, error: { code: 'MEDIA_GONE', message: 'File is gone from local storage' } });
          else res.end();
        });
        stream.pipe(res);
      })
      .catch((e: unknown) => {
        if (!res.headersSent) {
          const status = e instanceof HttpException ? e.getStatus() : 500;
          const body = e instanceof HttpException
            ? e.getResponse()
            : { statusCode: 500, error: { code: 'MEDIA_ERROR', message: 'Media download failed' } };
          res.status(status).json(body);
        }
      });
  }
}
