import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar, View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { api } from './src/api';
import { connectSocket, disconnectSocket } from './src/socket';
import { theme } from './src/theme';
import { LoginPhoneScreen } from './src/screens/LoginPhoneScreen';
import { LoginOtpScreen } from './src/screens/LoginOtpScreen';
import { ChatsScreen } from './src/screens/ChatsScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import type { AuthSession, ConversationDto, UserDto } from '@del/shared-types';

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

  // بوت: بازیابی نشست ذخیره‌شده
  useEffect(() => {
    (async () => {
      try {
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
  }, []);

  const logout = useCallback(async () => {
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
  }, [refreshToken]);

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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  bootText: { color: theme.textDim, fontSize: 15 },
});
