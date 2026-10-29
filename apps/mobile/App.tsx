import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar, View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { api } from './src/api';
import { theme } from './src/theme';
import { LoginPhoneScreen } from './src/screens/LoginPhoneScreen';
import { LoginOtpScreen } from './src/screens/LoginOtpScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import type { AuthSession, UserDto } from '@del/shared-types';

type Route =
  | { name: 'boot' }
  | { name: 'login-phone' }
  | { name: 'login-otp'; phone: string }
  | { name: 'home'; user: UserDto };

const KEYS = {
  access: 'del.accessToken',
  refresh: 'del.refreshToken',
  user: 'del.user',
};

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'boot' });
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);

  // بوت: اگر نشست ذخیره‌شده وجود دارد، سعی در بازیابی
  useEffect(() => {
    (async () => {
      try {
        const [a, r, userJson] = await Promise.all([
          SecureStore.getItemAsync(KEYS.access),
          SecureStore.getItemAsync(KEYS.refresh),
          SecureStore.getItemAsync(KEYS.user),
        ]);
        if (a && userJson) {
          const user = JSON.parse(userJson) as UserDto;
          setAccessToken(a);
          setRefreshToken(r);
          setRoute({ name: 'home', user });
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
    await SecureStore.setItemAsync(KEYS.access, session.accessToken);
    await SecureStore.setItemAsync(KEYS.refresh, session.refreshToken);
    await SecureStore.setItemAsync(KEYS.user, JSON.stringify(session.user));
  }, []);

  const logout = useCallback(async () => {
    if (refreshToken) {
      await api.logout(refreshToken).catch(() => undefined);
    }
    await Promise.all([
      SecureStore.deleteItemAsync(KEYS.access),
      SecureStore.deleteItemAsync(KEYS.refresh),
      SecureStore.deleteItemAsync(KEYS.user),
    ]).catch(() => undefined);
    setAccessToken(null);
    setRefreshToken(null);
    setRoute({ name: 'login-phone' });
  }, [refreshToken]);

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
            setRoute({ name: 'home', user: session.user });
          }}
          onBack={() => setRoute({ name: 'login-phone' })}
        />
      )}
      {route.name === 'home' && (
        <HomeScreen
          user={route.user}
          accessToken={accessToken ?? ''}
          onUpdated={(user) => setRoute({ name: 'home', user })}
          onLogout={logout}
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
