import { API_BASE_URL } from './config';
import type {
  AuthSession,
  ConversationDto,
  MessageDto,
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

  getMessages: (token: string, conversationId: string, before?: number) =>
    request<{ messages: MessageDto[]; hasMore: boolean; nextBefore: number | null }>(
      `/conversations/${conversationId}/messages${before !== undefined ? `?before=${before}` : ''}`,
      { token },
    ),

  sendMessageRest: (
    token: string,
    conversationId: string,
    clientMsgId: string,
    body: string,
  ) =>
    request<{ message: MessageDto; duplicate: boolean }>(
      `/conversations/${conversationId}/messages`,
      { method: 'POST', token, body: JSON.stringify({ clientMsgId, body }) },
    ),

  markRead: (token: string, conversationId: string, lastReadSeq: number) =>
    request<void>(`/conversations/${conversationId}/read`, {
      method: 'POST',
      token,
      body: JSON.stringify({ lastReadSeq }),
    }),
};

function PlatformOS(): string {
  const { Platform } = require('react-native');
  return Platform.OS;
}
