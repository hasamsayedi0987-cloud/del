import { create } from "zustand";
import type { Lang } from "./i18n";

export type Screen =
  | "splash"
  | "phone"
  | "otp"
  | "name"
  | "chats"
  | "chat"
  | "newchat"
  | "settings";

export interface User {
  id: string;
  name: string;
  phone: string;
  color: number;
}

export interface Msg {
  id: string;
  mine: boolean;
  text: string;
  at: number; // epoch ms
  status: "sending" | "sent" | "read";
}

export interface Conv {
  id: string;
  peer: { id?: string; name: string; phone: string; color: number };
  messages: Msg[];
  unread: number;
  typing: boolean;
}

export const AVATAR_COLORS = [
  "#4f8ef7",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
];

interface Store {
  screen: Screen;
  lang: Lang;
  theme: "dark" | "light";
  serverUrl: string;
  mode: "demo" | "server";
  connState: "idle" | "connecting" | "ok" | "fail";
  user: User | null;
  token: string | null;
  phoneInput: string;
  otpCode: string; // expected code (demo/dev)
  convs: Conv[];
  openConvId: string | null;
  toast: string | null;
  contacts: { id: string; name: string; phone: string; color: number }[];

  // actions
  set<K extends keyof Store>(patch: Partial<Pick<Store, K>>): void;
  showToast(t: string): void;
  go(s: Screen): void;
  login(u: User, token: string | null, mode: "demo" | "server"): void;
  logout(): void;
  openConv(id: string): void;
  sendMsg(convId: string, text: string): void;
  receiveMsg(convId: string, text: string): void;
  markRead(convId: string): void;
  createConv(peer: { id?: string; name: string; phone: string; color: number }): string;
  loadSaved(): void;
}

const LS = {
  settings: "del.settings.v1",
  user: "del.user.v1",
  chats: "del.chats.v1",
};

export const uid = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;

function readLS<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const useStore = create<Store>((set, get) => ({
  screen: "splash",
  lang: "fa",
  theme: "dark",
  serverUrl: "",
  mode: "demo",
  connState: "idle",
  user: null,
  token: null,
  phoneInput: "",
  otpCode: "",
  convs: [],
  openConvId: null,
  toast: null,
  contacts: [],

  set: (patch) => set(patch as Partial<Store>),
  showToast: (t) => {
    set({ toast: t });
    setTimeout(() => set({ toast: null }), 2200);
  },
  go: (s) => set({ screen: s }),

  login: (u, token, mode) => {
    localStorage.setItem(LS.user, JSON.stringify({ ...u, token, mode }));
    set({ user: u, token, mode, screen: "chats" });
  },

  logout: () => {
    localStorage.removeItem(LS.user);
    localStorage.removeItem(LS.chats);
    set({ user: null, token: null, convs: [], mode: "demo", screen: "phone" });
  },

  openConv: (id) => {
    set((st) => ({
      openConvId: id,
      screen: "chat",
      convs: st.convs.map((c) => (c.id === id ? { ...c, unread: 0 } : c)),
    }));
  },

  createConv: (peer) => {
    const st = get();
    const existing = st.convs.find((c) => c.peer.phone === peer.phone);
    if (existing) {
      set({ openConvId: existing.id, screen: "chat" });
      return existing.id;
    }
    const id = uid();
    set((s) => ({
      convs: [{ id, peer, messages: [], unread: 0, typing: false }, ...s.convs],
      openConvId: id,
      screen: "chat",
    }));
    return id;
  },

  sendMsg: (convId, text) => {
    const msg: Msg = { id: uid(), mine: true, text, at: Date.now(), status: "sending" };
    set((st) => ({
      convs: st.convs.map((c) => (c.id === convId ? { ...c, messages: [...c.messages, msg] } : c)),
    }));
    // simulate delivery -> read for demo; server mode upgrades via api layer
    setTimeout(() => {
      set((st) => ({
        convs: st.convs.map((c) =>
          c.id === convId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === msg.id ? { ...m, status: "sent" } : m
                ),
              }
            : c
        ),
      }));
    }, 500);
    persistChats(get().convs);
  },

  receiveMsg: (convId, text) => {
    const msg: Msg = { id: uid(), mine: false, text, at: Date.now(), status: "read" };
    set((st) => ({
      convs: st.convs.map((c) =>
        c.id === convId
          ? {
              ...c,
              typing: false,
              unread: st.screen === "chat" && st.openConvId === convId ? 0 : c.unread + 1,
              messages: [...c.messages, msg],
            }
          : c
      ),
    }));
    persistChats(get().convs);
  },

  markRead: (convId) => {
    set((st) => ({
      convs: st.convs.map((c) =>
        c.id === convId
          ? {
              ...c,
              unread: 0,
              messages: c.messages.map((m) =>
                m.mine && m.status !== "read" ? { ...m, status: "read" } : m
              ),
            }
          : c
      ),
    }));
    persistChats(get().convs);
  },

  loadSaved: () => {
    const s = readLS<Partial<Store>>(LS.settings, {});
    const u = readLS<{ token?: string; mode?: "demo" | "server" } & User>(LS.user, null as never);
    const chats = readLS<Conv[]>(LS.chats, []);
    set({
      lang: s.lang ?? "fa",
      theme: s.theme ?? "dark",
      serverUrl: s.serverUrl ?? "",
      user: u && u.id ? u : null,
      token: u?.token ?? null,
      mode: u?.mode ?? "demo",
      convs: chats,
    });
  },
}));

export function persistChats(convs: Conv[]) {
  // keep only last 60 messages per conversation to bound storage
  const trimmed = convs.map((c) => ({ ...c, messages: c.messages.slice(-60) }));
  try {
    localStorage.setItem(LS.chats, JSON.stringify(trimmed));
  } catch {
    /* storage full - ignore */
  }
}

export function persistSettings(s: { lang: Lang; theme: "dark" | "light"; serverUrl: string }) {
  localStorage.setItem(LS.settings, JSON.stringify(s));
}
