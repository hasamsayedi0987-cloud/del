import { getApiBaseUrl } from './config';
import type {
  AiStatus,
  AiTextResult,
  AiUsageReport,
  AuthSession,
  CallDto,
  CallJoinInfo,
  CallPage,
  BlockListDto,
  ConversationDto,
  DeviceDto,
  E2eeBackup,
  E2eeBundle,
  E2eeDeviceKeys,
  E2eeStatus,
  MediaAssetDto,
  MediaUrlResponse,
  MessageDto,
  PresenceDto,
  PresignResponse,
  PushTokenResponse,
  ReportDto,
  RequestOtpResponse,
  StoryDto,
  StoryGroupDto,
  SyncBootstrap,
  SyncUpdates,
  UserDto,
} from '@del/shared-types';

/** خطای استاندارد API */
export class ApiError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** تبدیل مسیر نسبی سرور (آواتار/رسانه) به آدرس مطلق برای Image */
export function absoluteUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${getApiBaseUrl()}${path}`;
}

/** مهلت پیش‌فرض هر درخواست — سرور free-tier رندر در اولین درخواست سرد ~۴۰ث می‌برد */
const REQUEST_TIMEOUT_MS = 45_000;

async function request<T>(path: string, init?: RequestInit & { token?: string }): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.token) headers.Authorization = `Bearer ${init.token}`;

  // بدون این مهلت، اگر سرور پاسخ ندهد fetch تا ابد معلق می‌ماند و اپ برای همیشه می‌چرخد
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}/api/v1${path}`, {
      ...init,
      headers,
      signal: abort.signal,
    });
  } catch {
    if (abort.signal.aborted) {
      throw new ApiError(0, 'TIMEOUT', 'پاسخی از سرور نرسید؛ چند لحظه بعد دوباره تلاش کنید.');
    }
    throw new ApiError(
      0,
      'NETWORK',
      'سرور در دسترس نیست. اتصال اینترنت و آدرس API را بررسی کنید.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 204) return undefined as T;

  const body = (await res.json().catch(() => null)) as
    | { error?: { code?: string; message?: string } }
    | null;

  if (!res.ok) {
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? 'خطای ناشناخته',
    );
  }
  return body as T;
}

export const api = {
  health: () => request<{ status: string }>('/health'),

  requestEmailOtp: (email: string) =>
    request<RequestOtpResponse>('/auth/otp/request-email', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  verifyEmailOtp: (email: string, code: string, platform: string) =>
    request<AuthSession>('/auth/otp/verify-email', {
      method: 'POST',
      body: JSON.stringify({
        email,
        code,
        platform,
        deviceName: `${PlatformOS()} · Del Mobile`,
      }),
    }),

  refresh: (refreshToken: string) =>
    request<AuthSession>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),

  logout: (refreshToken: string) =>
    request<void>('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }),

  me: (token: string) => request<UserDto>('/users/me', { token }),

  updateMe: (token: string, patch: { displayName?: string; about?: string }) =>
    request<UserDto>('/users/me', {
      method: 'PATCH',
      token,
      body: JSON.stringify(patch),
    }),

  // ————— پیام‌رسانی (گام ۲) —————

  /** یافتن کاربر با شماره موبایل — برای شروع گفتگوی جدید */
  findUserByPhone: (token: string, phone: string) =>
    request<{ id: string; displayName: string | null; phone: string }>(
      `/users/by-phone/${encodeURIComponent(phone)}`,
      { token },
    ),

  /** یافتن کاربر با ایمیل — جست‌وجوی اصلی اپ (v1.4) */
  findUserByEmail: (token: string, email: string) =>
    request<{ id: string; displayName: string | null; email: string }>(
      `/users/by-email/${encodeURIComponent(email)}`,
      { token },
    ),

  /** آپلود عکس پروفایل — jpeg base64 (≤512KB) */
  uploadAvatar: (token: string, imageDataBase64: string, mime = 'image/jpeg') =>
    request<UserDto>('/users/me/avatar', {
      method: 'POST',
      token,
      body: JSON.stringify({ imageData: imageDataBase64, mime }),
    }),

  removeAvatar: (token: string) =>
    request<UserDto>('/users/me/avatar', { method: 'DELETE', token }),

  /** پیام‌های محوشونده — TTL گفتگو (v1.4) */
  setDisappear: (token: string, conversationId: string, disappearSec: number) =>
    request<ConversationDto>(`/conversations/${conversationId}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ disappearSec }),
    }),

  // ————— استوری‌ها (v1.4) —————

  createStory: (token: string, input: { kind: 'text' | 'image'; text?: string; bgKey?: string; imageData?: string }) =>
    request<StoryDto>('/stories', { method: 'POST', token, body: JSON.stringify(input) }),

  listStories: (token: string) => request<{ groups: StoryGroupDto[] }>('/stories', { token }),

  viewStory: (token: string, storyId: string) =>
    request<{ ok: true }>(`/stories/${storyId}/view`, { method: 'POST', token }),

  deleteStory: (token: string, storyId: string) =>
    request<{ ok: true }>(`/stories/${storyId}`, { method: 'DELETE', token }),

  /** گفتگو با دستیار دل — تاریخچه محلیِ کلاینت برای زمینه می‌رود */
  aiChat: (token: string, text: string, history: string[]) =>
    request<AiTextResult>('/ai/chat', {
      method: 'POST',
      token,
      body: JSON.stringify({ text, history }),
    }),

  createConversation: (token: string, userId: string) =>
    request<ConversationDto>('/conversations', {
      method: 'POST',
      token,
      body: JSON.stringify({ userId }),
    }),

  listConversations: (token: string) =>
    request<ConversationDto[]>('/conversations', { token }),

  getMessages: (
    token: string,
    conversationId: string,
    before?: number,
    since?: number,
  ) => {
    const params: string[] = [];
    if (before !== undefined) params.push(`before=${before}`);
    if (since !== undefined) params.push(`since=${since}`);
    const qs = params.length ? `?${params.join('&')}` : '';
    return request<{
      messages: MessageDto[];
      hasMore: boolean;
      nextBefore: number | null;
      nextSince: number | null;
    }>(`/conversations/${conversationId}/messages${qs}`, { token });
  },

  sendMessageRest: (
    token: string,
    conversationId: string,
    clientMsgId: string,
    body?: string,
    mediaId?: string,
    isE2ee?: boolean,
  ) =>
    request<{ message: MessageDto; duplicate: boolean }>(
      `/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        token,
        body: JSON.stringify({
          clientMsgId,
          ...(body !== undefined ? { body } : {}),
          ...(mediaId ? { mediaId } : {}),
          ...(isE2ee ? { isE2ee: true } : {}),
        }),
      },
    ),

  markRead: (token: string, conversationId: string, lastReadSeq: number) =>
    request<void>(`/conversations/${conversationId}/read`, {
      method: 'POST',
      token,
      body: JSON.stringify({ lastReadSeq }),
    }),

  // ————— اعلان‌ها و همگام‌سازی (گام ۷) —————

  /** ثبت/به‌روزرسانی توکن push این دستگاه */
  registerPushToken: (token: string, pushToken: string) =>
    request<PushTokenResponse>('/devices/push-token', {
      method: 'POST',
      token,
      body: JSON.stringify({ token: pushToken }),
    }),

  /** حذف توکن push این دستگاه — هنگام خروج */
  deletePushToken: (token: string) =>
    request<PushTokenResponse>('/devices/push-token', { method: 'DELETE', token }),

  listDevices: (token: string) => request<DeviceDto[]>('/devices', { token }),

  /** بوت‌استرپ کامل — دستگاه تازه همه مکالمه‌ها را یک‌جا می‌گیرد */
  syncBootstrap: (token: string) => request<SyncBootstrap>('/sync/bootstrap', { token }),

  /** همگام‌سازی افزایشی — فقط مکالمه‌های تغییریافته پس از cursor */
  syncUpdates: (token: string, since: string) =>
    request<SyncUpdates>(`/sync/updates?since=${encodeURIComponent(since)}`, { token }),

  // ————— رمزنگاری سرتاسری (گام ۸) —————

  /** شناسه دستگاه این نشست (از JWT) — برای آدرس‌دهی پاکت E2EE */
  authMe: (token: string) =>
    request<{ userId: string; deviceId: string | null }>('/auth/me', { token }),

  e2eeStatus: (token: string) => request<E2eeStatus>('/e2ee/status', { token }),

  e2eeUploadIdentity: (
    token: string,
    payload: {
      ikEd: string;
      ikX: string;
      spkKeyId: number;
      spk: string;
      spkSig: string;
      otks?: { keyId: number; key: string }[];
    },
  ) =>
    request<{ ok: true }>('/e2ee/identity', {
      method: 'POST',
      token,
      body: JSON.stringify(payload),
    }),

  e2eeAddOtks: (token: string, otks: { keyId: number; key: string }[]) =>
    request<{ ok: true }>('/e2ee/otks', {
      method: 'POST',
      token,
      body: JSON.stringify({ otks }),
    }),

  e2eeDeviceKeys: (token: string, userId: string) =>
    request<E2eeDeviceKeys[]>(`/e2ee/devices/${userId}`, { token }),

  e2eeFetchBundles: (token: string, userId: string) =>
    request<{ userId: string; bundles: E2eeBundle[] }>(`/e2ee/bundle/${userId}`, { token }),

  e2eeSaveBackup: (token: string, blob: string, salt: string) =>
    request<{ ok: true }>('/e2ee/backup', {
      method: 'PUT',
      token,
      body: JSON.stringify({ blob, salt }),
    }),

  e2eeGetBackup: (token: string) => request<E2eeBackup>('/e2ee/backup', { token }),

  e2eeDeleteIdentity: (token: string) =>
    request<void>('/e2ee/identity', { method: 'DELETE', token }),

  // ————— حضور (گام ۳) —————

  getPresence: (token: string, userId: string) =>
    request<PresenceDto>(`/users/${userId}/presence`, { token }),

  // ————— مسدودسازی و گزارش (گام ۱۰) —————

  listBlocks: (token: string) =>
    request<BlockListDto>('/users/me/blocks', { token }),

  blockUser: (token: string, userId: string) =>
    request<void>(`/users/${userId}/block`, { method: 'POST', token }),

  unblockUser: (token: string, userId: string) =>
    request<void>(`/users/${userId}/block`, { method: 'DELETE', token }),

  reportUser: (
    token: string,
    userId: string,
    body: { reason: 'spam' | 'abuse' | 'impersonation' | 'other'; note?: string },
  ) =>
    request<{ report: ReportDto; duplicate: boolean }>(`/users/${userId}/report`, {
      method: 'POST',
      token,
      body: JSON.stringify(body),
    }),

  // ————— گروه‌ها (گام ۴) —————

  createGroup: (token: string, title: string, memberUserIds: string[]) =>
    request<ConversationDto>('/conversations/group', {
      method: 'POST',
      token,
      body: JSON.stringify({ title, memberUserIds }),
    }),

  getConversation: (token: string, conversationId: string) =>
    request<ConversationDto>(`/conversations/${conversationId}`, { token }),

  addGroupMembers: (token: string, conversationId: string, userIds: string[]) =>
    request<ConversationDto>(`/conversations/${conversationId}/members`, {
      method: 'POST',
      token,
      body: JSON.stringify({ userIds }),
    }),

  removeGroupMember: (token: string, conversationId: string, userId: string) =>
    request<void>(`/conversations/${conversationId}/members/${userId}`, { method: 'DELETE', token }),

  leaveGroup: (token: string, conversationId: string) =>
    request<void>(`/conversations/${conversationId}/leave`, { method: 'POST', token }),

  renameGroup: (token: string, conversationId: string, title: string) =>
    request<ConversationDto>(`/conversations/${conversationId}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ title }),
    }),

  // ————— رسانه (گام ۵) —————

  presignMedia: (
    token: string,
    input: {
      conversationId: string;
      mime: string;
      size: number;
      originalName?: string;
      width?: number;
      height?: number;
    },
  ) =>
    request<PresignResponse>('/media/presign', {
      method: 'POST',
      token,
      body: JSON.stringify(input),
    }),

  completeMedia: (
    token: string,
    mediaId: string,
    parts?: { partNumber: number; etag: string }[],
  ) =>
    request<MediaAssetDto>('/media/complete', {
      method: 'POST',
      token,
      body: JSON.stringify({ mediaId, ...(parts ? { parts } : {}) }),
    }),

  getMediaMeta: (token: string, mediaId: string) =>
    request<MediaAssetDto>(`/media/${mediaId}`, { token }),

  getMediaUrl: (token: string, mediaId: string, variant: 'thumb' | 'original' = 'original') =>
    request<MediaUrlResponse>(`/media/${mediaId}/url?variant=${variant}`, { token }),

  // ————— تماس‌ها (گام ۶) —————

  startCall: (token: string, conversationId: string, kind: 'audio' | 'video') =>
    request<CallDto>('/calls', {
      method: 'POST',
      token,
      body: JSON.stringify({ conversationId, kind }),
    }),

  acceptCall: (token: string, callId: string) =>
    request<CallJoinInfo>(`/calls/${callId}/accept`, { method: 'POST', token }),

  rejectCall: (token: string, callId: string) =>
    request<void>(`/calls/${callId}/reject`, { method: 'POST', token }),

  cancelCall: (token: string, callId: string) =>
    request<void>(`/calls/${callId}/cancel`, { method: 'POST', token }),

  endCall: (token: string, callId: string) =>
    request<CallDto>(`/calls/${callId}/end`, { method: 'POST', token }),

  listCalls: (token: string, conversationId?: string, before?: string, limit?: number) => {
    const params: string[] = [];
    if (conversationId) params.push(`conversationId=${conversationId}`);
    if (before) params.push(`before=${encodeURIComponent(before)}`);
    if (limit) params.push(`limit=${limit}`);
    const qs = params.length ? `?${params.join('&')}` : '';
    return request<CallPage>(`/calls${qs}`, { token });
  },

  // ————— هوش مصنوعی (گام ۹) —————

  aiStatus: (token: string) => request<AiStatus>('/ai/status', { token }),

  setAiConsent: (token: string, enabled: boolean) =>
    request<{ ok: true; aiConsent: boolean }>('/ai/consent', {
      method: 'PATCH',
      token,
      body: JSON.stringify({ enabled }),
    }),

  setConversationAiConsent: (token: string, conversationId: string, enabled: boolean | null) =>
    request<{ ok: true; conversationId: string; aiConsent: boolean | null }>(
      `/conversations/${conversationId}/ai-consent`,
      {
        method: 'PATCH',
        token,
        body: JSON.stringify({ enabled }),
      },
    ),

  aiTranslate: (token: string, messageId: string, target?: string) =>
    request<AiTextResult>('/ai/translate', {
      method: 'POST',
      token,
      body: JSON.stringify({ messageId, ...(target ? { target } : {}) }),
    }),

  aiFix: (token: string, text: string) =>
    request<AiTextResult>('/ai/fix', {
      method: 'POST',
      token,
      body: JSON.stringify({ text }),
    }),

  aiSuggest: (token: string, conversationId: string, count = 3) =>
    request<AiTextResult>('/ai/suggest', {
      method: 'POST',
      token,
      body: JSON.stringify({ conversationId, count }),
    }),

  aiSummarize: (token: string, conversationId: string, opts?: { limit?: number; unreadOnly?: boolean }) =>
    request<AiTextResult>('/ai/summarize', {
      method: 'POST',
      token,
      body: JSON.stringify({ conversationId, ...opts }),
    }),

  aiUsage: (token: string, limit = 50) =>
    request<AiUsageReport>(`/ai/usage?limit=${limit}`, { token }),
};

function PlatformOS(): string {
  const { Platform } = require('react-native');
  return Platform.OS;
}
