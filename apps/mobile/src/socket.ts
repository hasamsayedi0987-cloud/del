import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from './config';

/**
 * مدیریت اتصال Socket.IO — یک نمونه مشترک برای کل اپ
 * سرور در handshake توکن access را اعتبارسنجی می‌کند؛ در صورت قطع، خودکار وصل می‌شود.
 */
let socket: Socket | null = null;
let currentToken: string | null = null;

export function connectSocket(token: string): Socket {
  if (socket && currentToken === token) return socket;
  socket?.disconnect();
  currentToken = token;
  socket = io(API_BASE_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
  currentToken = null;
}

/** uuid سبک برای client_msg_id — کافی و امن برای این منظور (نه امنیتی) */
export function uuid(): string {
  let out = '';
  const hex = '0123456789abcdef';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}
