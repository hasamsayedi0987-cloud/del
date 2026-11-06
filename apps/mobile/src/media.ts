/**
 * گام ۵ — رسانه سمت موبایل
 * آپلود مستقیم با Presigned URL (single یا multipart) — بایت‌ها از API عبور نمی‌کنند.
 * PUT با uploadAsync نیتیو انجام می‌شود (fetch در RN با file:// و اندازهٔ بدنه مشکل داشت).
 * + کش URL امضاشده دانلود برای نمایش تصاویر.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
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

/** اندازهٔ فایل محلی — getInfoAsync دقیق است؛ اگر نشد اعلام‌شدهٔ picker؛ ۰ = نامعلوم */
async function fileSizeOf(uri: string, fallback: number): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && typeof (info as { size?: number }).size === 'number' && (info as { size?: number }).size! > 0) {
      return (info as { size?: number }).size!;
    }
  } catch {
    // content:// — بی‌خیال؛ سرور اندازهٔ نامعلوم (۰) را با اندازهٔ واقعی جبران می‌کند
  }
  return fallback;
}

/** آپلود کامل: اندازهٔ محلی → presign → PUT نیتیو → complete.
 *  conversationId خالی = رسانهٔ شخصی مالک (استوری) */
export async function uploadMedia(
  token: string,
  conversationId: string | null,
  file: PickFile,
): Promise<MediaAssetDto> {
  const size = await fileSizeOf(file.uri, file.size);

  const pre: PresignResponse = await api.presignMedia(token, {
    ...(conversationId ? { conversationId } : {}),
    mime: file.mime,
    size,
    originalName: file.name,
    width: file.width,
    height: file.height,
  });

  if (pre.mode === 'single' && pre.url) {
    // PUT نیتیو — BINARY_CONTENT خودش بایت‌های فایل را می‌خواند؛
    // با file:// و content:// کار می‌کند و وابسته به fetch/Blob در RN نیست
    const res = await FileSystem.uploadAsync(pre.url, file.uri, {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': file.mime },
    });
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(`upload failed: ${res.status} ${String(res.body ?? '').slice(0, 120)}`);
    }
  } else if (pre.mode === 'multipart' && pre.partUrls && pre.partSize) {
    // فقط حالت S3 با فایل >۱۰MB — بخش‌بخش با fetch
    const blob = await (await fetch(file.uri)).blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
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

// ————— استوری تصویری — فشرده‌سازی تا ۱۰۸۰px و خروجی فایل برای آپلود pipeline —————

export async function storyImageFile(uri: string): Promise<{ uri: string; width?: number; height?: number }> {
  const out = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1080 } }],
    { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG },
  );
  return { uri: out.uri, width: out.width, height: out.height };
}
