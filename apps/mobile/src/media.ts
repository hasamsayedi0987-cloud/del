/**
 * گام ۵ — رسانه سمت موبایل
 * آپلود مستقیم به S3 با Presigned URL (single یا multipart) — بایت‌ها از API عبور نمی‌کنند.
 * + کش URL امضاشده دانلود برای نمایش تصاویر.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { getApiBaseUrl } from './config';
import { api } from './api';
import type { MediaAssetDto, PresignResponse } from '@del/shared-types';

export interface PickFile {
  /** file:// یا content:// — خروجی expo-image-picker */
  uri: string;
  mime: string;
  size: number;
  name: string;
  width?: number;
  height?: number;
}

/** آپلود کامل: خواندن بایت‌ها → presign با اندازهٔ واقعی → PUT مستقیم → complete */
export async function uploadMedia(
  token: string,
  conversationId: string,
  file: PickFile,
): Promise<MediaAssetDto> {
  // بایت‌ها اول خوانده می‌شوند — دو دلیل:
  //  ۱) asset.fileSize روی اندروید اغلب undefined است؛ presign با size=0 باعث
  //     MEDIA_SIZE_MISMATCH در complete می‌شد (باگ «آپلود فایل ناموفق بود»).
  //  ۲) Response.arrayBuffer() در React Native همیشه هست؛ Blob.arrayBuffer() نیست.
  const res = await fetch(file.uri);
  if (!res.ok && res.status !== 200) {
    throw new Error(`cannot read file: ${res.status}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const size = bytes.byteLength || file.size;
  if (!size) throw new Error('empty file');

  const pre: PresignResponse = await api.presignMedia(token, {
    conversationId,
    mime: file.mime,
    size,
    originalName: file.name,
    width: file.width,
    height: file.height,
  });

  if (pre.mode === 'single' && pre.url) {
    const put = await fetch(pre.url, {
      method: 'PUT',
      headers: { 'Content-Type': file.mime },
      body: bytes as unknown as Blob,
    });
    if (!put.ok) throw new Error(`upload failed: ${put.status}`);
  } else if (pre.mode === 'multipart' && pre.partUrls && pre.partSize) {
    const parts: { partNumber: number; etag: string }[] = [];
    for (let i = 0; i < pre.partUrls.length; i++) {
      const partUrl = pre.partUrls[i]!;
      const slice = bytes.subarray(i * pre.partSize, (i + 1) * pre.partSize);
      const put = await fetch(partUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.mime },
        body: slice as unknown as Blob,
      });
      if (!put.ok) throw new Error(`part ${i + 1} upload failed: ${put.status}`);
      const etag = put.headers.get('etag');
      if (!etag) throw new Error('missing etag from part upload');
      parts.push({ partNumber: i + 1, etag });
    }
    return await api.completeMedia(token, pre.mediaId, parts);
  }

  return await api.completeMedia(token, pre.mediaId);
}

// ————— کش URL امضاشده — URLها کوتاه‌عمرند (۵ دقیقه) —————

interface CacheEntry {
  url: string;
  expiresAt: number;
}

const urlCache = new Map<string, CacheEntry>();

/** URL امضاشده (با کش تا نیمه عمر) — برای <Image> و دانلود */
export async function getSignedUrl(
  token: string,
  mediaId: string,
  variant: 'thumb' | 'original' = 'original',
): Promise<string> {
  const key = `${mediaId}:${variant}`;
  const hit = urlCache.get(key);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.url;
  const res = await api.getMediaUrl(token, mediaId, variant);
  urlCache.set(key, { url: res.url, expiresAt: new Date(res.expiresAt).getTime() });
  return res.url;
}

export function invalidateUrl(mediaId: string): void {
  urlCache.delete(`${mediaId}:original`);
  urlCache.delete(`${mediaId}:thumb`);
}

/** PUT خالی برای تست اتصال S3 (بدون استفاده در UI) */
export function MEDIA_API(): string {
  return `${getApiBaseUrl()}/api/v1/media`;
}

// ————— عکس پروفایل — فشرده‌سازی محلی تا زیر سقف ۵۱۲KB سرور —————

/**
 * عکس گالری/دوربین → مربع ۵۱۲px با کیفیت ۰٫۷ → base64 jpeg.
 * بدون این، عکس دوربینِ امروز (۳۰۰۰px+) حتی با quality پایین از سقف آواتار
 * و سقف JSON سرور رد می‌شد (باگ «عکس پروفایل گذاشتن نمی‌شود»).
 */
export async function avatarBase64(uri: string): Promise<string> {
  const out = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 512, height: 512 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!out.base64) throw new Error('resize failed');
  return out.base64;
}
