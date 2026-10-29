import { io, type Socket } from "socket.io-client";
import { useStore, uid, type User } from "./store";
import { seedDemo } from "./demo";

/**
 * Server mode: REST + WebSocket client for the Del API (apps/api).
 * All endpoints are prefixed with /v1 and use JWT bearer auth.
 */
let socket: Socket | null = null;

function base(): string {
  let u = useStore.getState().serverUrl.trim();
  if (!u) return "";
  if (!/^https?:\/\//.test(u)) u = `http://${u}`;
  return u.replace(/\/+$/, "");
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = useStore.getState().token;
  const res = await fetch(`${base()}/v1${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${body.slice(0, 120)}`);
  }
  return res.json() as Promise<T>;
}

export async function serverRequestOtp(phone: string): Promise<string | undefined> {
  const r = await req<{ ok: boolean; devCode?: string }>("/auth/otp/request", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
  return r.devCode;
}

export async function serverVerifyOtp(phone: string, code: string) {
  const r = await req<{ token: string; user: User }>("/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ phone, code }),
  });
  return r;
}

export async function serverUpdateMe(patch: { name?: string; color?: number }) {
  return req<User>("/users/me", { method: "PATCH", body: JSON.stringify(patch) });
}

export async function serverLoadChats() {
  const rows = await req<
    {
      id: string;
      peer: { id: string; name: string; phone: string; color: number };
      messages: { id: string; senderId: string; body: string; createdAt: string }[];
      unread: number;
    }[]
  >("/conversations");
  const meId = useStore.getState().user?.id;
  const convs = rows.map((r) => ({
    id: r.id,
    peer: { ...r.peer, color: r.peer.color ?? 0 },
    unread: r.unread,
    typing: false,
    messages: r.messages.map((m) => ({
      id: m.id,
      mine: m.senderId === meId,
      text: m.body,
      at: new Date(m.createdAt).getTime(),
      status: "read" as const,
    })),
  }));
  useStore.setState({ convs, contacts: convs.map((c) => ({ ...c.peer })) });
}

export async function serverCreateConv(peerPhone: string) {
  const r = await req<{ id: string; peer: { id: string; name: string; phone: string; color: number } }>(
    "/conversations",
    { method: "POST", body: JSON.stringify({ peerPhone }) }
  );
  return r;
}

export async function serverSendMsg(convId: string, text: string) {
  const r = await req<{ id: string; createdAt: string }>(
    `/conversations/${convId}/messages`,
    { method: "POST", body: JSON.stringify({ body: text, clientMsgId: uid() }) }
  );
  return r;
}

export async function connectServer(): Promise<boolean> {
  const st = useStore.getState();
  if (!st.serverUrl.trim() || !st.token) return false;
  useStore.setState({ connState: "connecting" });
  try {
    await serverLoadChats();
    if (socket) socket.disconnect();
    socket = io(base(), {
      auth: { token: st.token },
      transports: ["websocket", "polling"],
      reconnection: true,
    });
    socket.on("connect", () => useStore.setState({ connState: "ok" }));
    socket.on("connect_error", () => useStore.setState({ connState: "fail" }));
    socket.on("disconnect", () => useStore.setState({ connState: "idle" }));
    socket.on(
      "message:new",
      (m: { convId: string; id: string; senderId: string; body: string; createdAt: string }) => {
        const meId = useStore.getState().user?.id;
        if (m.senderId === meId) return;
        const conv = useStore.getState().convs.find((c) => c.id === m.convId);
        if (conv) useStore.getState().receiveMsg(m.convId, m.body);
        else void serverLoadChats();
      }
    );
    await serverLoadChats();
    useStore.setState({ connState: "ok" });
    return true;
  } catch {
    useStore.setState({ connState: "fail" });
    return false;
  }
}

export function disconnectServer() {
  socket?.disconnect();
  socket = null;
  useStore.setState({ mode: "demo", connState: "idle", token: null, screen: "chats" });
  seedDemo();
}
