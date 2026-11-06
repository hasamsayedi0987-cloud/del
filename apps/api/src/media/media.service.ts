import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { UploadPartCommand } from '@aws-sdk/client-s3';
import type { AppConfig } from '../config/configuration';
import { appConfig } from '../config/configuration';
import { PrismaService } from '../infra/prisma.service';
import type { MediaAssetDto, MediaKind, PresignResponse } from '@del/shared-types';

function httpError(status: number, code: string, message: string): HttpException {
  return new HttpException({ statusCode: status, error: { code, message } }, status);
}

/** whitelist نوع فایل — نقش ← kind (docs/05-api-design.md §۵) */
const MIME_RULES: Record<string, { kind: MediaKind }> = {
  'image/jpeg': { kind: 'image' },
  'image/png': { kind: 'image' },
  'image/gif': { kind: 'image' },
  'image/webp': { kind: 'image' },
  'video/mp4': { kind: 'video' },
  'video/webm': { kind: 'video' },
  'video/quicktime': { kind: 'video' },
  'audio/mpeg': { kind: 'audio' },
  'audio/mp4': { kind: 'audio' },
  'audio/ogg': { kind: 'audio' },
  'audio/wav': { kind: 'audio' },
  'audio/webm': { kind: 'audio' },
  'application/pdf': { kind: 'file' },
  'application/zip': { kind: 'file' },
  'application/msword': { kind: 'file' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { kind: 'file' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { kind: 'file' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { kind: 'file' },
  'text/plain': { kind: 'file' },
};

/** امضاهای بایتی (magic bytes) برای تأیید محتوا در complete — مقدار دروغ برای امنیت است */
function detectMagic(buf: Uint8Array): string | null {
  if (buf.length < 12) return null;
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...buf.slice(from, to));
  const startsWith = (...bytes: number[]) =>
    bytes.every((b, i) => buf[i] === b);

  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (ascii(0, 3) === 'GIF') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp') return 'video/mp4'; // mp4/mov — هر دو ftyp
  if (startsWith(0x1a, 0x45, 0xdf, 0xa3)) return 'video/webm'; // webm/mkv
  if (ascii(0, 4) === '%PDF') return 'application/pdf';
  if (ascii(0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (ascii(0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
  if (startsWith(0x50, 0x4b)) return 'application/zip'; // zip/docx/xlsx/pptx
  return null;
}

/** آیا mime ادعاشده با magic سازگار است؟ (مثل mp4/mov که هر دو ftyp می‌سازند) */
function magicCompatible(claimedMime: string, magic: string): boolean {
  if (magic === claimedMime) return true;
  const family: string[][] = [
    ['video/mp4', 'video/quicktime'],
    ['video/webm', 'audio/webm'],
  ];
  return family.some((f) => f.includes(claimedMime) && f.includes(magic));
}

interface MediaRow {
  id: string;
  ownerId: string;
  /** null برای رسانهٔ شخصی مالک (استوری) */
  conversationId: string | null;
  kind: string;
  mime: string;
  size: number;
  originalName: string | null;
  width: number | null;
  height: number | null;
  status: string;
  storageKey: string;
  thumbKey: string | null;
  createdAt: Date;
}

export function toMediaDto(m: MediaRow): MediaAssetDto {
  return {
    id: m.id,
    ownerId: m.ownerId,
    conversationId: m.conversationId,
    kind: m.kind as MediaKind,
    mime: m.mime,
    size: m.size,
    originalName: m.originalName,
    width: m.width,
    height: m.height,
    status: m.status as MediaAssetDto['status'],
    hasThumb: Boolean(m.thumbKey),
    createdAt: m.createdAt.toISOString(),
  };
}

@Injectable()
export class MediaService implements OnModuleDestroy {
  private readonly logger = new Logger(MediaService.name);
  private cfg: AppConfig;
  private s3: S3Client | null = null;
  /** حالت لوکال — بدون S3؛ فایل روی دیسک سرور ذخیره و با URL امضاشده سرو می‌شود */
  localMode = false;
  private localDir = '';

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {
    void config;
    this.cfg = appConfig.load();
    if (this.cfg.mediaConfigured) {
      this.s3 = new S3Client({
        endpoint: this.cfg.s3Endpoint,
        region: this.cfg.s3Region,
        forcePathStyle: this.cfg.s3ForcePathStyle,
        // checksum پیش‌فرض SDK v3 → presigned URL را برای کلاینت‌های ساده (fetch) قابل‌استفاده نمی‌کند
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        credentials: {
          accessKeyId: this.cfg.s3AccessKey!,
          secretAccessKey: this.cfg.s3SecretKey!,
        },
      });
      this.logger.log(`S3 ready → ${this.cfg.s3Endpoint} bucket=${this.cfg.s3Bucket}`);
      return;
    }
    // fallback لوکال — آپلود کار می‌کند حتی بدون S3 (دیسک موقت روی Render: تا دپلوی بعدی)
    this.localMode = true;
    this.localDir = process.env.MEDIA_LOCAL_DIR?.trim() || path.join(os.tmpdir(), 'del-media');
    fs.mkdirSync(this.localDir, { recursive: true });
    this.logger.warn(
      `S3_* env missing — LOCAL media storage at ${this.localDir} (files are temporary on ephemeral hosts)`,
    );
  }

  /** امضای HMAC مشترک URLهای آپلود/دانلود حالت لوکال */
  private localSig(payload: string): string {
    return createHmac('sha256', this.cfg.jwtAccessSecret).update(payload).digest('hex');
  }

  /** توکن PUT آپلود لوکال — ۱۵ دقیقه اعتبار مثل presign */
  uploadToken(mediaId: string): { expires: number; sig: string } {
    const expires = Math.floor(Date.now() / 1000) + 15 * 60;
    return { expires, sig: this.localSig(`up:${mediaId}:${expires}`) };
  }

  assertUploadToken(mediaId: string, expires: string | undefined, sig: string | undefined): void {
    const exp = Number(expires);
    if (!Number.isFinite(exp) || exp * 1000 < Date.now() || !sig) {
      throw httpError(403, 'MEDIA_URL_EXPIRED', 'Upload URL is expired or invalid');
    }
    const expect = this.localSig(`up:${mediaId}:${exp}`);
    if (
      sig.length !== expect.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expect))
    ) {
      throw httpError(403, 'MEDIA_URL_INVALID', 'Upload URL signature mismatch');
    }
  }

  assertDownloadToken(
    mediaId: string,
    variant: string,
    expires: string | undefined,
    sig: string | undefined,
  ): void {
    const exp = Number(expires);
    if (!Number.isFinite(exp) || exp * 1000 < Date.now() || !sig) {
      throw httpError(403, 'MEDIA_URL_EXPIRED', 'Media URL is expired');
    }
    const expect = this.localSig(`dl:${mediaId}:${variant}:${exp}`);
    if (
      sig.length !== expect.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expect))
    ) {
      throw httpError(403, 'MEDIA_URL_INVALID', 'Media URL signature mismatch');
    }
  }

  /** مسیر فایل لوکال روی دیسک — کلید DB استفاده می‌شود تا کلاینت چیزی نفهمد */
  localPath(storageKey: string): string {
    const safe = storageKey.replace(/[^a-zA-Z0-9/_.-]/g, '');
    return path.join(this.localDir, safe);
  }

  /** پایهٔ URL برای لینک‌های لوکال — env بُرنده است، وگرنه از درخواست ساخته می‌شود */
  publicBaseOf(req: { protocol?: string; headers: Record<string, string | string[] | undefined> }): string {
    if (this.cfg.mediaLocalPublicBase) return this.cfg.mediaLocalPublicBase.replace(/\/+$/, '');
    const proto = String(req.protocol ?? 'http');
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost');
    return `${proto}://${host}`;
  }

  private assertStorage(): void {
    if (!this.localMode && !this.s3) {
      throw httpError(503, 'MEDIA_NOT_CONFIGURED', 'Media storage is not configured on the server');
    }
  }

  private async requireParticipant(meId: string, conversationId: string) {
    const part = await this.prisma.participant.findUnique({
      where: { conversationId_userId: { conversationId, userId: meId } },
    });
    if (!part) {
      throw httpError(403, 'NOT_A_PARTICIPANT', 'You are not a participant of this conversation');
    }
    return part;
  }

  // ————— ۱) presign — صدور مجوز آپلود مستقیم —————

  async presign(
    meId: string,
    input: {
      conversationId?: string;
      mime: string;
      size: number;
      originalName?: string;
      width?: number;
      height?: number;
    },
    publicBase?: string,
  ): Promise<PresignResponse> {
    this.assertStorage();
    // بدون گفتگو → رسانهٔ شخصی مالک (استوری) — مشارکت چک نمی‌شود
    if (input.conversationId) {
      await this.requireParticipant(meId, input.conversationId);
    }

    const mime = input.mime.toLowerCase().trim();
    const rule = MIME_RULES[mime];
    if (!rule) {
      throw httpError(400, 'MIME_NOT_ALLOWED', `MIME type ${mime} is not allowed`);
    }
    const limit = rule.kind === 'image' ? this.cfg.mediaMaxImageBytes : this.cfg.mediaMaxFileBytes;
    if (input.size > limit) {
      throw httpError(
        413,
        'MEDIA_TOO_LARGE',
        `File too large — max ${Math.round(limit / 1024 / 1024)}MB for ${rule.kind}`,
      );
    }

    const asset = await this.prisma.mediaAsset.create({
      data: {
        ownerId: meId,
        conversationId: input.conversationId ?? null,
        kind: rule.kind,
        mime,
        size: input.size,
        originalName: input.originalName?.trim().slice(0, 255) || null,
        width: input.width ?? null,
        height: input.height ?? null,
        storageKey: `${input.conversationId ?? 'story'}/${crypto.randomUUID()}`,
      },
    });

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    this.logger.log(`presign ${asset.kind} ${input.size}B → ${asset.id}`);

    // ————— حالت لوکال (بدون S3): PUT به خود API؛ حجم‌های بزرگ هم تک‌مرحله‌ای —————
    if (this.localMode) {
      const { expires, sig } = this.uploadToken(asset.id);
      const base = (publicBase ?? '').replace(/\/+$/, '');
      return {
        mediaId: asset.id,
        mode: 'single',
        url: `${base}/api/v1/media/local/${asset.id}/upload?expires=${expires}&sig=${sig}`,
        expiresAt,
      };
    }
    const s3 = this.s3!;

    // فایل بزرگ — آپلود multipart با ازسرگیری (docs: >۱۰MB)
    if (input.size > this.cfg.mediaMultipartThresholdBytes) {
      const partSize = Math.max(
        this.cfg.mediaPartSizeBytes,
        Math.ceil(input.size / 10000), // سقف ۱۰۰۰۰ پارت S3
      );
      const partCount = Math.ceil(input.size / partSize);
      const mp = await s3.send(
        new CreateMultipartUploadCommand({
          Bucket: this.cfg.s3Bucket,
          Key: asset.storageKey,
          ContentType: mime,
        }),
      );
      if (!mp.UploadId) throw httpError(502, 'MEDIA_STORAGE_ERROR', 'Failed to create multipart upload');
      // uploadId در DB می‌ماند — complete/abort در هر نمونه‌ای از API کار می‌کند
      await this.prisma.mediaAsset.update({ where: { id: asset.id }, data: { uploadId: mp.UploadId } });
      const partUrls: string[] = [];
      for (let i = 1; i <= partCount; i++) {
        partUrls.push(
          await getSignedUrl(
            s3,
            new UploadPartCommand({
              Bucket: this.cfg.s3Bucket,
              Key: asset.storageKey,
              PartNumber: i,
              UploadId: mp.UploadId,
            }),
            { expiresIn: 900 },
          ),
        );
      }
      return { mediaId: asset.id, mode: 'multipart', uploadId: mp.UploadId, partSize, partUrls, expiresAt };
    }

    // فایل معمولی — PUT تک‌مرحله‌ای (بدون ContentLength تا امضا ساده بماند)
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: this.cfg.s3Bucket,
        Key: asset.storageKey,
        ContentType: mime,
      }),
      { expiresIn: 900 },
    );
    return { mediaId: asset.id, mode: 'single', url, expiresAt };
  }

  // ————— ۲) complete — تأیید نهایی + magic bytes + thumbnail —————

  async complete(
    meId: string,
    input: { mediaId: string; parts?: { partNumber: number; etag: string }[] },
  ): Promise<MediaAssetDto> {
    this.assertStorage();
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: input.mediaId } });
    if (!asset) throw httpError(404, 'MEDIA_NOT_FOUND', 'Media asset does not exist');
    if (asset.ownerId !== meId) {
      throw httpError(403, 'MEDIA_FORBIDDEN', 'Only the uploader can complete this upload');
    }
    if (asset.status === 'ready') return toMediaDto(asset); // idempotent
    if (asset.status === 'rejected') {
      throw httpError(400, 'MEDIA_REJECTED', asset.error ?? 'Upload was rejected earlier');
    }
    if (this.localMode) return this.completeLocal(asset);
    const s3 = this.s3!;

    try {
      // multipart — نهایی‌سازی پارت‌ها (uploadId از DB)
      if (input.parts?.length) {
        if (!asset.uploadId) {
          throw httpError(400, 'BAD_UPLOAD', 'This asset was not started as a multipart upload');
        }
        await s3.send(
          new CompleteMultipartUploadCommand({
            Bucket: this.cfg.s3Bucket,
            Key: asset.storageKey,
            UploadId: asset.uploadId,
            MultipartUpload: {
              Parts: input.parts
                .slice()
                .sort((a, b) => a.partNumber - b.partNumber)
                .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
            },
          }),
        );
      }

      // اندازه واقعی — اگر مالک اندازه را نمی‌دانسته (۰)، اندازهٔ واقعی ثبت می‌شود
      const head = await s3.send(
        new HeadObjectCommand({ Bucket: this.cfg.s3Bucket, Key: asset.storageKey }),
      );
      const actualSize = head.ContentLength ?? 0;
      if (asset.size > 0 && actualSize !== asset.size) {
        throw httpError(
          400,
          'MEDIA_SIZE_MISMATCH',
          `Uploaded ${actualSize}B but declared ${asset.size}B — upload the exact file`,
        );
      }

      // magic bytes — ۲۶ بایت اول کافی است
      const headBytes = await s3.send(
        new GetObjectCommand({ Bucket: this.cfg.s3Bucket, Key: asset.storageKey, Range: 'bytes=0-25' }),
      );
      const chunk = new Uint8Array(await this.readAll(headBytes.Body));
      const magic = detectMagic(chunk);
      const opaque = asset.kind === 'file' && !['application/pdf', 'application/zip'].includes(asset.mime);
      if (!magic) {
        if (!opaque) {
          throw httpError(400, 'MAGIC_MISMATCH', `Content does not look like ${asset.mime}`);
        }
      } else if (!magicCompatible(asset.mime, magic)) {
        throw httpError(400, 'MAGIC_MISMATCH', `Content is ${magic} but declared ${asset.mime}`);
      }

      // بندانگشتی تصویر (sharp اختیاری — نبودش خطا نیست)
      let thumbKey: string | null = null;
      if (asset.kind === 'image') {
        thumbKey = await this.makeThumb(asset.storageKey, asset.mime);
      }

      const updated = await this.prisma.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status: 'ready',
          thumbKey,
          readyAt: new Date(),
          error: null,
          // اندازهٔ اعلام‌نشده → اندازهٔ واقعی
          ...(asset.size === 0 ? { size: actualSize } : {}),
        },
      });
      this.logger.log(`media ready ${asset.id} (${asset.kind}, ${actualSize}B, thumb=${Boolean(thumbKey)})`);
      this.events.emit('media.ready', { conversationId: asset.conversationId, media: toMediaDto(updated) });
      return toMediaDto(updated);
    } catch (e) {
      if (e instanceof HttpException) {
        // رد نهایی — آبجکت حذف و asset به rejected می‌رود
        await this.reject(asset.id, asset.storageKey, (e.getResponse() as { error?: { code?: string } })?.error?.code ?? 'MEDIA_REJECTED');
      }
      throw e;
    }
  }

  /** complete در حالت لوکال — همان قواعد S3: اندازه + magic bytes + بندانگشتی */
  private async completeLocal(asset: MediaRow): Promise<MediaAssetDto> {
    const filePath = this.localPath(asset.storageKey);
    try {
      const st = await fsp.stat(filePath).catch(() => null);
      if (!st) {
        throw httpError(400, 'MEDIA_NOT_UPLOADED', 'File bytes never reached the server — retry the upload');
      }
      if (asset.size > 0 && st.size !== asset.size) {
        throw httpError(
          400,
          'MEDIA_SIZE_MISMATCH',
          `Uploaded ${st.size}B but declared ${asset.size}B — upload the exact file`,
        );
      }

      // magic bytes — ۲۶ بایت اول کافی است
      const fh = await fsp.open(filePath, 'r');
      const headBuf = Buffer.alloc(Math.min(26, st.size));
      await fh.read(headBuf, 0, headBuf.length, 0);
      await fh.close();
      const magic = detectMagic(new Uint8Array(headBuf));
      const opaque = asset.kind === 'file' && !['application/pdf', 'application/zip'].includes(asset.mime);
      if (!magic) {
        if (!opaque) {
          throw httpError(400, 'MAGIC_MISMATCH', `Content does not look like ${asset.mime}`);
        }
      } else if (!magicCompatible(asset.mime, magic)) {
        throw httpError(400, 'MAGIC_MISMATCH', `Content is ${magic} but declared ${asset.mime}`);
      }

      let thumbKey: string | null = null;
      if (asset.kind === 'image') {
        thumbKey = await this.makeThumbLocal(filePath, asset.storageKey);
      }

      const updated = await this.prisma.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status: 'ready',
          thumbKey,
          readyAt: new Date(),
          error: null,
          ...(asset.size === 0 ? { size: st.size } : {}),
        },
      });
      this.logger.log(`media ready(local) ${asset.id} (${asset.kind}, ${st.size}B, thumb=${Boolean(thumbKey)})`);
      this.events.emit('media.ready', { conversationId: asset.conversationId, media: toMediaDto(updated) });
      return toMediaDto(updated);
    } catch (e) {
      if (e instanceof HttpException) {
        await this.reject(asset.id, asset.storageKey, (e.getResponse() as { error?: { code?: string } })?.error?.code ?? 'MEDIA_REJECTED');
      }
      throw e;
    }
  }

  /** بندانگشتی لوکال با sharp — در نبود sharp بی‌صدا رد می‌شود */
  private async makeThumbLocal(filePath: string, storageKey: string): Promise<string | null> {
    try {
      const sharp = (await import('sharp')).default;
      const bytes = await fsp.readFile(filePath);
      const thumb = await sharp(bytes)
        .rotate()
        .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      const meta = await sharp(bytes).metadata();
      const thumbKey = `${storageKey}.thumb.jpg`;
      await fsp.writeFile(this.localPath(thumbKey), thumb);
      if (meta.width && meta.height) {
        await this.prisma.mediaAsset.update({
          where: { storageKey },
          data: { width: meta.width, height: meta.height },
        });
      }
      return thumbKey;
    } catch (e) {
      this.logger.warn(`thumbnail skipped: ${(e as Error).message}`);
      return null;
    }
  }

  /** PUT بایت‌های آپلود لوکال — استریم مستقیم به دیسک با سقف حجم */
  async writeLocalUpload(mediaId: string, stream: import('node:stream').Readable): Promise<void> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!asset) throw httpError(404, 'MEDIA_NOT_FOUND', 'Media asset does not exist');
    if (asset.status !== 'pending') {
      throw httpError(400, 'BAD_UPLOAD', 'This asset can no longer accept bytes');
    }
    const limit = asset.kind === 'image' ? this.cfg.mediaMaxImageBytes : this.cfg.mediaMaxFileBytes;
    const filePath = this.localPath(asset.storageKey);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });

    let total = 0;
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(filePath);
      stream.on('data', (chunk: Buffer | string) => {
        total += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
        if (total > limit) {
          stream.destroy();
          out.destroy();
          fsp.rm(filePath, { force: true }).catch(() => undefined);
          reject(httpError(413, 'MEDIA_TOO_LARGE', 'Stream exceeded the size limit'));
        }
      });
      stream.on('error', reject);
      out.on('error', reject);
      out.on('finish', () => resolve());
      stream.pipe(out);
    });
    this.logger.log(`local upload received ${mediaId} (${total}B)`);
  }

  /** فایل لوکال برای دانلود — پس از تأیید امضا؛ فقط asset آماده */
  async localFileForDownload(
    mediaId: string,
    variant: string,
  ): Promise<{ filePath: string; mime: string; name: string | null }> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!asset || asset.status !== 'ready') {
      throw httpError(404, 'MEDIA_NOT_FOUND', 'Media asset does not exist');
    }
    const key = variant === 'thumb' ? (asset.thumbKey ?? asset.storageKey) : asset.storageKey;
    return {
      filePath: this.localPath(key),
      mime: variant === 'thumb' ? 'image/jpeg' : asset.mime,
      name: asset.originalName,
    };
  }

  /** علامت رد + پاکسازی آبجکت — امنیت: محتوای نامعتبر هرگز ready نمی‌شود */
  private async reject(mediaId: string, storageKey: string, code: string): Promise<void> {
    const row = await this.prisma.mediaAsset
      .update({ where: { id: mediaId }, data: { status: 'rejected', error: code } })
      .catch(() => null);
    if (!row) return;
    if (this.localMode) {
      await fsp.rm(this.localPath(storageKey), { force: true }).catch(() => undefined);
      await fsp.rm(`${this.localPath(storageKey)}.thumb.jpg`, { force: true }).catch(() => undefined);
      return;
    }
    if (!this.s3) return;
    if (row.uploadId) {
      await this.s3
        .send(new AbortMultipartUploadCommand({ Bucket: this.cfg.s3Bucket, Key: storageKey, UploadId: row.uploadId }))
        .catch(() => undefined);
    }
    await this.s3
      .send(new DeleteObjectCommand({ Bucket: this.cfg.s3Bucket, Key: storageKey }))
      .catch(() => undefined);
  }

  /** ساخت بندانگشتی ۷۶۸px با sharp — در نبود sharp بی‌صدا رد می‌شود (hasThumb=false) */
  private async makeThumb(storageKey: string, mime: string): Promise<string | null> {
    try {
      const sharp = (await import('sharp')).default;
      const s3 = this.s3!;
      const obj = await s3.send(
        new GetObjectCommand({ Bucket: this.cfg.s3Bucket, Key: storageKey }),
      );
      const bytes = Buffer.from(await obj.Body!.transformToByteArray());
      const thumb = await sharp(bytes)
        .rotate()
        .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      const meta = await sharp(bytes).metadata();
      const thumbKey = `${storageKey}.thumb.jpg`;
      await s3.send(
        new PutObjectCommand({
          Bucket: this.cfg.s3Bucket,
          Key: thumbKey,
          Body: thumb,
          ContentType: 'image/jpeg',
        }),
      );
      // ابعاد واقعی تصویر را هم ذخیره کنیم
      if (meta.width && meta.height) {
        await this.prisma.mediaAsset.update({
          where: { storageKey },
          data: { width: meta.width, height: meta.height },
        });
      }
      return thumbKey;
    } catch (e) {
      this.logger.warn(`thumbnail skipped: ${(e as Error).message}`);
      return null;
    }
  }

  private readAll(body: unknown): Promise<Uint8Array> {
    const b = body as { transformToByteArray?: () => Promise<Uint8Array> };
    if (b?.transformToByteArray) return b.transformToByteArray();
    throw new Error('unreadable object body');
  }

  // ————— ۳) متادیتا + ۴) URL دانلود —————

  async getMeta(meId: string, mediaId: string): Promise<MediaAssetDto> {
    return toMediaDto(await this.getAssetChecked(meId, mediaId));
  }

  private async getAssetChecked(meId: string, mediaId: string): Promise<MediaRow> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!asset) throw httpError(404, 'MEDIA_NOT_FOUND', 'Media asset does not exist');
    if (asset.conversationId === null) {
      // رسانهٔ شخصی مالک (استوری) — فقط خودش
      if (asset.ownerId !== meId) {
        throw httpError(404, 'MEDIA_NOT_FOUND', 'Media asset does not exist');
      }
      return asset;
    }
    await this.requireParticipant(meId, asset.conversationId);
    return asset;
  }

  async getUrl(
    meId: string,
    mediaId: string,
    variant: 'thumb' | 'original' = 'original',
    publicBase?: string,
  ): Promise<{ url: string; expiresAt: string; kind: string; mime: string; size: number; originalName: string | null }> {
    this.assertStorage();
    const asset = await this.getAssetChecked(meId, mediaId);
    if (asset.status !== 'ready') {
      throw httpError(400, 'MEDIA_NOT_READY', 'Upload is not completed yet');
    }
    if (variant === 'thumb' && !asset.thumbKey) {
      throw httpError(404, 'THUMB_NOT_AVAILABLE', 'This asset has no thumbnail');
    }

    // حالت لوکال — URL امضاشده به خود API
    if (this.localMode) {
      const expires = Math.floor(Date.now() / 1000) + this.cfg.mediaSignedUrlTtlSec;
      const sig = this.localSig(`dl:${asset.id}:${variant}:${expires}`);
      const base = (publicBase ?? '').replace(/\/+$/, '');
      return {
        url: `${base}/api/v1/media/local/${asset.id}?variant=${variant}&expires=${expires}&sig=${sig}`,
        expiresAt: new Date(expires * 1000).toISOString(),
        kind: asset.kind,
        mime: variant === 'thumb' ? 'image/jpeg' : asset.mime,
        size: asset.size,
        originalName: asset.originalName,
      };
    }

    const key = variant === 'thumb' && asset.thumbKey ? asset.thumbKey : asset.storageKey;
    const url = await getSignedUrl(
      this.s3!,
      new GetObjectCommand({ Bucket: this.cfg.s3Bucket, Key: key }),
      { expiresIn: this.cfg.mediaSignedUrlTtlSec },
    );
    return {
      url,
      expiresAt: new Date(Date.now() + this.cfg.mediaSignedUrlTtlSec * 1000).toISOString(),
      kind: asset.kind,
      mime: variant === 'thumb' ? 'image/jpeg' : asset.mime,
      size: asset.size,
      originalName: asset.originalName,
    };
  }

  onModuleDestroy(): void {
    this.s3?.destroy();
  }

  // ————— رسانهٔ استوری — مالکیت/دسترسی را StoriesService کنترل می‌کند —————

  /** URL امضاشدهٔ دانلود بدون چک مشارکتِ گفتگو — فقط asset آمادهٔ متعلق به ساختار استوری.
   *  فراخواننده (StoriesService) باید دیده‌شدن استوری را خودش تأیید کرده باشد. */
  async mintUrlForAsset(
    assetId: string,
    variant: 'thumb' | 'original' = 'original',
    publicBase?: string,
  ): Promise<{ url: string; expiresAt: string; kind: string; mime: string; size: number }> {
    this.assertStorage();
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.status !== 'ready') {
      throw httpError(404, 'MEDIA_NOT_FOUND', 'Media asset does not exist');
    }
    if (this.localMode) {
      const expires = Math.floor(Date.now() / 1000) + this.cfg.mediaSignedUrlTtlSec;
      const sig = this.localSig(`dl:${asset.id}:${variant}:${expires}`);
      const base = (publicBase ?? '').replace(/\/+$/, '');
      return {
        url: `${base}/api/v1/media/local/${asset.id}?variant=${variant}&expires=${expires}&sig=${sig}`,
        expiresAt: new Date(expires * 1000).toISOString(),
        kind: asset.kind,
        mime: asset.mime,
        size: asset.size,
      };
    }
    const key = variant === 'thumb' && asset.thumbKey ? asset.thumbKey : asset.storageKey;
    const url = await getSignedUrl(
      this.s3!,
      new GetObjectCommand({ Bucket: this.cfg.s3Bucket, Key: key }),
      { expiresIn: this.cfg.mediaSignedUrlTtlSec },
    );
    return {
      url,
      expiresAt: new Date(Date.now() + this.cfg.mediaSignedUrlTtlSec * 1000).toISOString(),
      kind: asset.kind,
      mime: asset.mime,
      size: asset.size,
    };
  }

  /** حذف کامل asset — ردیف DB + فایل/آبجکت (پاک‌سازی استوری منقضی) */
  async deleteAssetHard(assetId: string): Promise<void> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: assetId } }).catch(() => null);
    if (!asset) return;
    await this.prisma.mediaAsset.delete({ where: { id: assetId } }).catch(() => undefined);
    if (this.localMode) {
      await fsp.rm(this.localPath(asset.storageKey), { force: true }).catch(() => undefined);
      await fsp.rm(`${this.localPath(asset.storageKey)}.thumb.jpg`, { force: true }).catch(() => undefined);
      return;
    }
    if (!this.s3) return;
    await this.s3
      .send(new DeleteObjectCommand({ Bucket: this.cfg.s3Bucket, Key: asset.storageKey }))
      .catch(() => undefined);
    if (asset.thumbKey) {
      await this.s3
        .send(new DeleteObjectCommand({ Bucket: this.cfg.s3Bucket, Key: asset.thumbKey }))
        .catch(() => undefined);
    }
  }
}
