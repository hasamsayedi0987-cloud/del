import { API_BASE_URL } from './config';
import type {
  AuthSession,
  ConversationDto,
  MediaAssetDto,
  MediaUrlResponse,
  MessageDto,
  PresenceDto,
  PresignResponse,
  RequestOtpResponse,
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

async function request<T>(path: string, init?: RequestInit & { token?: string }): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.token) headers.Authorization = `Bearer ${init.token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/v1${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'NETWORK', 'سرور در دسترس نیست. اتصال اینترنت و آدرس API را بررسی کنید.');
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

  requestOtp: (phone: string) =>
    request<RequestOtpResponse>('/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),

  verifyOtp: (phone: string, code: string, platform: string) =>
    request<AuthSession>('/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({
        phone,
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
        }),
      },
    ),

  markRead: (token: string, conversationId: string, lastReadSeq: number) =>
    request<void>(`/conversations/${conversationId}/read`, {
      method: 'POST',
      token,
      body: JSON.stringify({ lastReadSeq }),
    }),

  // ————— حضور (گام ۳) —————

  getPresence: (token: string, userId: string) =>
    request<PresenceDto>(`/users/${userId}/presence`, { token }),

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
};

function PlatformOS(): string {
  const { Platform } = require('react-native');
  return Platform.OS;
}
