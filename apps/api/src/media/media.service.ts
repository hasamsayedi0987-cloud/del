import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  conversationId: string;
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
    } else {
      this.logger.warn('Media storage NOT configured — S3_* env missing؛ endpointهای رسانه 503 می‌دهند');
    }
  }

  private mustStorage(): S3Client {
    if (!this.s3) {
      throw httpError(503, 'MEDIA_NOT_CONFIGURED', 'Media storage is not configured on the server');
    }
    return this.s3;
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
      conversationId: string;
      mime: string;
      size: number;
      originalName?: string;
      width?: number;
      height?: number;
    },
  ): Promise<PresignResponse> {
    const s3 = this.mustStorage();
    await this.requireParticipant(meId, input.conversationId);

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
        conversationId: input.conversationId,
        kind: rule.kind,
        mime,
        size: input.size,
        originalName: input.originalName?.trim().slice(0, 255) || null,
        width: input.width ?? null,
        height: input.height ?? null,
        storageKey: `${input.conversationId}/${crypto.randomUUID()}`,
      },
    });

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    this.logger.log(`presign ${asset.kind} ${input.size}B → ${asset.id}`);

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
    const s3 = this.mustStorage();
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: input.mediaId } });
    if (!asset) throw httpError(404, 'MEDIA_NOT_FOUND', 'Media asset does not exist');
    if (asset.ownerId !== meId) {
      throw httpError(403, 'MEDIA_FORBIDDEN', 'Only the uploader can complete this upload');
    }
    if (asset.status === 'ready') return toMediaDto(asset); // idempotent
    if (asset.status === 'rejected') {
      throw httpError(400, 'MEDIA_REJECTED', asset.error ?? 'Upload was rejected earlier');
    }

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

      // اندازه واقعی
      const head = await s3.send(
        new HeadObjectCommand({ Bucket: this.cfg.s3Bucket, Key: asset.storageKey }),
      );
      const actualSize = head.ContentLength ?? 0;
      if (actualSize !== asset.size) {
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
        data: { status: 'ready', thumbKey, readyAt: new Date(), error: null },
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

  /** علامت رد + پاکسازی آبجکت — امنیت: محتوای نامعتبر هرگز ready نمی‌شود */
  private async reject(mediaId: string, storageKey: string, code: string): Promise<void> {
    const row = await this.prisma.mediaAsset
      .update({ where: { id: mediaId }, data: { status: 'rejected', error: code } })
      .catch(() => null);
    if (!this.s3 || !row) return;
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
    await this.requireParticipant(meId, asset.conversationId);
    return asset;
  }

  async getUrl(
    meId: string,
    mediaId: string,
    variant: 'thumb' | 'original' = 'original',
  ): Promise<{ url: string; expiresAt: string; kind: string; mime: string; size: number; originalName: string | null }> {
    this.mustStorage();
    const asset = await this.getAssetChecked(meId, mediaId);
    if (asset.status !== 'ready') {
      throw httpError(400, 'MEDIA_NOT_READY', 'Upload is not completed yet');
    }
    if (variant === 'thumb' && !asset.thumbKey) {
      throw httpError(404, 'THUMB_NOT_AVAILABLE', 'This asset has no thumbnail');
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
}
