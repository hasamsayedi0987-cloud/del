import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar, View, Text, StyleSheet, ActivityIndicator, Alert, AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { api } from './src/api';
import { loadApiBaseUrl } from './src/config';
import { connectSocket, disconnectSocket, getSocket } from './src/socket';
import { theme } from './src/theme';
import { setupCallGlobals } from './src/lk';
import {
  ensureAndroidChannels,
  requestNotificationPermission,
  registerExpoPushToken,
  scheduleMessageNotification,
  scheduleCallNotification,
  onNotificationResponse,
} from './src/notifications';
import { LoginPhoneScreen } from './src/screens/LoginPhoneScreen';
import { LoginOtpScreen } from './src/screens/LoginOtpScreen';
import { ChatsScreen } from './src/screens/ChatsScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { CallScreen } from './src/screens/CallScreen';
import { initE2ee } from './src/e2ee/engine';
import type { CallState } from './src/screens/CallScreen';
import type { AuthSession, ConversationDto, UserDto } from '@del/shared-types';

setupCallGlobals(); // فقط در dev/production build فعال است — در Expo Go بی‌اثر

type Route =
  | { name: 'boot' }
  | { name: 'login-phone' }
  | { name: 'login-otp'; phone: string }
  | { name: 'chats' }
  | { name: 'chat'; conversation: ConversationDto }
  | { name: 'profile' };

const KEYS = {
  access: 'del.accessToken',
  refresh: 'del.refreshToken',
  user: 'del.user',
};

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'boot' });
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserDto | null>(null);

  // ————— گام ۶: وضعیت تماس —————
  const [callState, setCallState] = useState<CallState | null>(null);
  const callStateRef = useRef<CallState | null>(null);
  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);
  const acceptingRef = useRef<string | null>(null); // callId که همین دستگاه پاسخ داده

  // ————— گام ۷: مسیر فعلی + کش گفتگوها برای عنوان اعلان‌ها —————
  const routeRef = useRef<Route>(route);
  useEffect(() => {
    routeRef.current = route;
  }, [route]);
  const convCacheRef = useRef<Map<string, ConversationDto>>(new Map());

  /** بوت‌استرپ — همه گفتگوها یک‌جا؛ برای عنوان اعلان و ناوبری تپ */
  const refreshConvCache = useCallback(async (token: string) => {
    try {
      const boot = await api.syncBootstrap(token);
      const map = convCacheRef.current;
      map.clear();
      for (const c of boot.conversations) map.set(c.id, c);
    } catch {
      /* بعداً تلاش می‌شود */
    }
  }, []);

  const titleOf = useCallback((conv: ConversationDto, senderId?: string): string => {
    if (conv.type === 'group') return conv.title ?? 'گروه';
    const peerName = conv.peer?.displayName ?? conv.peer?.phone ?? 'گفتگو';
    return peerName;
  }, []);

  // بوت: بازیابی نشست ذخیره‌شده
  useEffect(() => {
    (async () => {
      try {
        await loadApiBaseUrl(); // گام ۱۱: آدرس سرور ذخیره‌شده — قبل از هر درخواست
        const [a, r, userJson] = await Promise.all([
          SecureStore.getItemAsync(KEYS.access),
          SecureStore.getItemAsync(KEYS.refresh),
          SecureStore.getItemAsync(KEYS.user),
        ]);
        if (a && userJson) {
          const u = JSON.parse(userJson) as UserDto;
          setAccessToken(a);
          setRefreshToken(r);
          setUser(u);
          connectSocket(a);
          void initE2ee(a, u.id); // گام ۸ — شناسه دستگاه + هویت محلی
          setRoute({ name: 'chats' });
          return;
        }
      } catch {
        // نشست خراب — ورود مجدد
      }
      setRoute({ name: 'login-phone' });
    })();
  }, []);

  const persistSession = useCallback(async (session: AuthSession) => {
    setAccessToken(session.accessToken);
    setRefreshToken(session.refreshToken);
    setUser(session.user);
    await SecureStore.setItemAsync(KEYS.access, session.accessToken);
    await SecureStore.setItemAsync(KEYS.refresh, session.refreshToken);
    await SecureStore.setItemAsync(KEYS.user, JSON.stringify(session.user));
    connectSocket(session.accessToken);
    void initE2ee(session.accessToken, session.user.id); // گام ۸
  }, []);

  const logout = useCallback(async () => {
    if (accessToken) await api.deletePushToken(accessToken).catch(() => undefined); // گام ۷
    if (refreshToken) await api.logout(refreshToken).catch(() => undefined);
    disconnectSocket();
    await Promise.all([
      SecureStore.deleteItemAsync(KEYS.access),
      SecureStore.deleteItemAsync(KEYS.refresh),
      SecureStore.deleteItemAsync(KEYS.user),
    ]).catch(() => undefined);
    setAccessToken(null);
    setRefreshToken(null);
    setUser(null);
    setRoute({ name: 'login-phone' });
  }, [refreshToken, accessToken]);

  const sessionExpired = useCallback(async () => {
    // تلاش یک‌باره برای رفرش، وگرنه خروج
    if (!refreshToken) {
      await logout();
      return;
    }
    try {
      const session = await api.refresh(refreshToken);
      await persistSession(session);
    } catch {
      await logout();
    }
  }, [refreshToken, logout, persistSession]);

  // ————— گام ۷: کانال‌ها + مجوز + ثبت توکن push (اختیاری — بدون projectId رد می‌شود) —————
  useEffect(() => {
    if (!accessToken) return;
    void (async () => {
      await ensureAndroidChannels();
      const granted = await requestNotificationPermission();
      if (!granted) return;
      const pushToken = await registerExpoPushToken();
      if (pushToken) {
        await api.registerPushToken(accessToken, pushToken).catch(() => undefined);
      }
    })();
  }, [accessToken]);

  // ————— گام ۷: کش گفتگوها بعد از ورود/بوت —————
  useEffect(() => {
    if (!accessToken) return;
    void refreshConvCache(accessToken);
  }, [accessToken, refreshConvCache]);

  // ————— گام ۷: اعلان محلی برای پیام WS در پس‌زمینه + cache از conversation.new —————
  useEffect(() => {
    if (!accessToken) return;
    const s = getSocket();
    if (!s) return;

    const isViewing = (conversationId: string): boolean =>
      routeRef.current.name === 'chat' && routeRef.current.conversation.id === conversationId;

    const onMessageNew = (p: { conversationId: string; message: { senderId: string; body: string; type: string; clientMsgId: string } }) => {
      if (isViewing(p.conversationId)) return; // ChatScreen خودش مدیریت می‌کند
      if (AppState.currentState === 'active') return; // اپ جلو چشم — اعلان سیستم لازم نیست
      const cached = convCacheRef.current.get(p.conversationId);
      const title = cached
        ? titleOf(cached, p.message.senderId)
        : 'پیام جدید';
      const body = p.message.body?.trim()
        ? p.message.body
        : p.message.type === 'text'
          ? 'پیام جدید'
          : '📎 پیام رسانه‌ای';
      void scheduleMessageNotification(title, body, { conversationId: p.conversationId });
    };

    const onConvNew = () => {
      void refreshConvCache(accessToken);
    };

    // گام ۱۰: مسدودسازی حساب توسط ادمین — خروج فوری با پیام شفاف
    const onAccountBlocked = () => {
      disconnectSocket();
      void (async () => {
        await Promise.all([
          SecureStore.deleteItemAsync(KEYS.access),
          SecureStore.deleteItemAsync(KEYS.refresh),
          SecureStore.deleteItemAsync(KEYS.user),
        ]).catch(() => undefined);
        setAccessToken(null);
        setRefreshToken(null);
        setUser(null);
        Alert.alert('حساب مسدود شد', 'حساب شما توسط پشتیبانی مسدود شده است.');
        setRoute({ name: 'login-phone' });
      })();
    };

    s.on('message.new', onMessageNew);
    s.on('conversation.new', onConvNew);
    s.on('account.blocked', onAccountBlocked);
    return () => {
      s.off('message.new', onMessageNew);
      s.off('conversation.new', onConvNew);
      s.off('account.blocked', onAccountBlocked);
    };
  }, [accessToken, refreshConvCache, titleOf]);

  // ————— گام ۷: تماس ورودی در پس‌زمینه — اعلان محلی —————
  useEffect(() => {
    if (!accessToken) return;
    const s = getSocket();
    if (!s) return;
    const onIncoming = (p: { call: { id: string; conversationId: string } ; caller: { displayName: string | null; phone: string } }) => {
      if (callStateRef.current) return;
      if (AppState.currentState === 'active') return; // CallScreen روبه‌روست
      void scheduleCallNotification(p.caller.displayName ?? p.caller.phone ?? 'تماس ورودی', {
        callId: p.call.id,
        conversationId: p.call.conversationId,
      });
    };
    s.on('call.incoming', onIncoming);
    return () => {
      s.off('call.incoming', onIncoming);
    };
  }, [accessToken]);

  // ————— گام ۷: تپ روی اعلان → ناوبری به گفتگو —————
  useEffect(() => {
    if (!accessToken) return;
    return onNotificationResponse((data) => {
      if (data.conversationId) {
        void (async () => {
          const cached = convCacheRef.current.get(data.conversationId!);
          if (cached) {
            setRoute({ name: 'chat', conversation: cached });
            return;
          }
          await refreshConvCache(accessToken);
          const conv = convCacheRef.current.get(data.conversationId!);
          setRoute(conv ? { name: 'chat', conversation: conv } : { name: 'chats' });
        })();
      } else {
        setRoute({ name: 'chats' });
      }
    });
  }, [accessToken, refreshConvCache]);

  // ————— گام ۶: signaling تماس روی WS —————
  useEffect(() => {
    if (!accessToken) return;
    const s = getSocket();
    if (!s) return;

    const faNum = (n: number): string =>
      String(n).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);

    const closeCall = () => {
      acceptingRef.current = null;
      setCallState(null);
    };

    const onIncoming = (p: {
      call: { id: string; conversationId: string; kind: 'audio' | 'video' };
      caller: { id: string; displayName: string | null; phone: string };
    }) => {
      if (callStateRef.current) return; // مشغول — سرور هم جلوی تماس دوم را می‌گیرد
      setCallState({
        phase: 'incoming',
        callId: p.call.id,
        conversationId: p.call.conversationId,
        kind: p.call.kind,
        peerName: p.caller.displayName ?? p.caller.phone ?? 'ناشناس',
      });
    };

    const onAccepted = (p: {
      call: { id: string };
      url: string;
      token: string;
      room: string;
    }) => {
      const cur = callStateRef.current;
      if (!cur || cur.callId !== p.call.id) return;
      if (cur.phase === 'outgoing') {
        // ما تماس‌گیرنده‌ایم — با توکن این دستگاه وصل شو
        setCallState({ ...cur, phase: 'active', url: p.url, token: p.token });
      } else if (cur.phase === 'incoming' && acceptingRef.current !== p.call.id) {
        // در دستگاه دیگری پاسخ داده شد — بستن
        closeCall();
        Alert.alert('تماس', 'تماس در دستگاه دیگری پاسخ داده شد.');
      }
      // phase==='incoming' با acceptingRef همین دستگاه → پاسخ REST خودش متصل می‌کند
    };

    const onEnded = (p: {
      callId: string;
      reason: 'hangup' | 'reject' | 'cancel' | 'timeout';
      durationS: number | null;
    }) => {
      const cur = callStateRef.current;
      if (!cur || cur.callId !== p.callId) return;
      let msg = 'تماس پایان یافت';
      if (p.reason === 'timeout') msg = 'پاسخی داده نشد';
      else if (p.reason === 'reject') msg = cur.phase === 'outgoing' ? 'تماس رد شد' : 'تماس را رد کردید';
      else if (p.reason === 'cancel') msg = cur.phase === 'incoming' ? 'تماس لغو شد' : 'تماس لغو شد';
      else if (p.reason === 'hangup' && p.durationS !== null) msg = `پایان تماس · ${faNum(p.durationS)} ثانیه`;
      closeCall();
      Alert.alert('تماس', msg);
    };

    s.on('call.incoming', onIncoming);
    s.on('call.accepted', onAccepted);
    s.on('call.ended', onEnded);
    return () => {
      s.off('call.incoming', onIncoming);
      s.off('call.accepted', onAccepted);
      s.off('call.ended', onEnded);
    };
  }, [accessToken]);

  // ————— گام ۶: اکشن‌های تماس —————
  const startCall = useCallback(
    async (conversation: ConversationDto, kind: 'audio' | 'video') => {
      if (!accessToken || callStateRef.current) return;
      const peerName =
        conversation.type === 'group'
          ? conversation.title ?? 'گروه'
          : conversation.peer?.displayName ?? conversation.peer?.phone ?? 'گفتگو';
      try {
        const call = await api.startCall(accessToken, conversation.id, kind);
        setCallState({
          phase: 'outgoing',
          callId: call.id,
          conversationId: call.conversationId,
          kind,
          peerName,
        });
      } catch (e) {
        Alert.alert('تماس', faCallError(e));
      }
    },
    [accessToken],
  );

  const acceptCall = useCallback(async () => {
    const cur = callStateRef.current;
    if (!cur || !accessToken) return;
    acceptingRef.current = cur.callId;
    try {
      const info = await api.acceptCall(accessToken, cur.callId);
      setCallState({ ...cur, phase: 'active', url: info.url, token: info.token });
    } catch (e) {
      acceptingRef.current = null;
      setCallState(null);
      Alert.alert('تماس', faCallError(e));
    }
  }, [accessToken]);

  const rejectCall = useCallback(async () => {
    const cur = callStateRef.current;
    if (!cur || !accessToken) return;
    setCallState(null);
    await api.rejectCall(accessToken, cur.callId).catch(() => undefined);
  }, [accessToken]);

  const cancelCall = useCallback(async () => {
    const cur = callStateRef.current;
    if (!cur || !accessToken) return;
    setCallState(null);
    await api.cancelCall(accessToken, cur.callId).catch(() => undefined);
  }, [accessToken]);

  const hangupCall = useCallback(async () => {
    const cur = callStateRef.current;
    if (!cur || !accessToken) return;
    setCallState(null);
    await api.endCall(accessToken, cur.callId).catch(() => undefined);
  }, [accessToken]);


  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
      {route.name === 'boot' && <Boot />}
      {route.name === 'login-phone' && (
        <LoginPhoneScreen onCodeSent={(phone) => setRoute({ name: 'login-otp', phone })} />
      )}
      {route.name === 'login-otp' && (
        <LoginOtpScreen
          phone={route.phone}
          onVerified={async (session) => {
            await persistSession(session);
            setRoute({ name: 'chats' });
          }}
          onBack={() => setRoute({ name: 'login-phone' })}
        />
      )}
      {route.name === 'chats' && accessToken && user && (
        <ChatsScreen
          accessToken={accessToken}
          myUserId={user.id}
          onOpenChat={(conversation) => setRoute({ name: 'chat', conversation })}
          onOpenProfile={() => setRoute({ name: 'profile' })}
          onSessionExpired={sessionExpired}
        />
      )}
      {route.name === 'chat' && accessToken && user && (
        <ChatScreen
          accessToken={accessToken}
          myUserId={user.id}
          conversation={route.conversation}
          onBack={() => setRoute({ name: 'chats' })}
          onRequestCall={startCall}
        />
      )}
      {route.name === 'profile' && accessToken && user && (
        <ProfileScreen
          user={user}
          accessToken={accessToken}
          onUpdated={(u) => setUser(u)}
          onLogout={logout}
          onBack={() => setRoute({ name: 'chats' })}
        />
      )}
      {/* لایه تماس — روی همه صحنه‌ها (گام ۶) */}
      {callState && (
        <CallScreen
          state={callState}
          onAccept={acceptCall}
          onReject={rejectCall}
          onCancel={cancelCall}
          onHangup={hangupCall}
        />
      )}
    </View>
  );
}

function Boot() {
  return (
    <View style={styles.boot}>
      <ActivityIndicator color={theme.accent} size="large" />
      <Text style={styles.bootText}>در حال بازکردن دل…</Text>
    </View>
  );
}

/** پیام خطای تماس به فارسی (گام ۶) */
function faCallError(e: unknown): string {
  const code = (e as { code?: string }).code;
  switch (code) {
    case 'CALLS_DISABLED':
      return 'سرور هنوز LiveKit را پیکربندی نکرده است';
    case 'CALL_BUSY':
      return 'طرف مقابل در حال حاضر در تماس دیگری است';
    case 'NOT_DIRECT':
      return 'فعلاً تماس فقط در گفتگوهای ۱:۱ ممکن است';
    case 'INVALID_STATE':
      return 'این تماس دیگر قابل پاسخ/پایان نیست';
    case 'CALL_NOT_FOUND':
      return 'این تماس دیگر وجود ندارد';
    case 'NETWORK':
      return 'سرور در دسترس نیست';
    default:
      return 'تماس ممکن نشد — دوباره تلاش کنید';
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  bootText: { color: theme.textDim, fontSize: 15 },
});
