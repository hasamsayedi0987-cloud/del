/**
 * گام ۵ — رسانه سمت موبایل
 * آپلود مستقیم به S3 با Presigned URL (single یا multipart) — بایت‌ها از API عبور نمی‌کنند.
 * + کش URL امضاشده دانلود برای نمایش تصاویر.
 */
import { API_BASE_URL } from './config';
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

/** آپلود کامل: presign → PUT مستقیم به S3 → complete */
export async function uploadMedia(
  token: string,
  conversationId: string,
  file: PickFile,
): Promise<MediaAssetDto> {
  const pre: PresignResponse = await api.presignMedia(token, {
    conversationId,
    mime: file.mime,
    size: file.size,
    originalName: file.name,
    width: file.width,
    height: file.height,
  });

  // خواندن بایت‌ها — برای multipart بخش‌بخش ارسال می‌شود
  const blob = await (await fetch(file.uri)).blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());

  if (pre.mode === 'single' && pre.url) {
    const res = await fetch(pre.url, {
      method: 'PUT',
      headers: { 'Content-Type': file.mime },
      body: bytes as unknown as Blob,
    });
    if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  } else if (pre.mode === 'multipart' && pre.partUrls && pre.partSize) {
    const parts: { partNumber: number; etag: string }[] = [];
    for (let i = 0; i < pre.partUrls.length; i++) {
      const partUrl = pre.partUrls[i]!;
      const slice = bytes.subarray(i * pre.partSize, (i + 1) * pre.partSize);
      const res = await fetch(partUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.mime },
        body: slice as unknown as Blob,
      });
      if (!res.ok) throw new Error(`part ${i + 1} upload failed: ${res.status}`);
      const etag = res.headers.get('etag');
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
export const MEDIA_API = `${API_BASE_URL}/api/v1/media`;
