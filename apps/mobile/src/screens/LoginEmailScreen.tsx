import React, { useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { api, ApiError } from '../api';
import { theme } from '../theme';
import { Button, Input, Logo, Screen, Subtitle, Title } from '../components/ui';
import { faError } from '../faError';
import type { RequestOtpResponse } from '@del/shared-types';

/** ورود با ایمیل — تنها راه ورود به دل؛ کد یک‌بارمصرف به ایمیل ارسال می‌شود */
export function LoginEmailScreen({
  onCodeSent,
}: {
  onCodeSent: (email: string, res: RequestOtpResponse) => void;
}) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const mail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      setError('فرمت ایمیل درست نیست');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await api.requestEmailOtp(mail);
      onCodeSent(mail, res);
    } catch (e) {
      setError(e instanceof ApiError ? faError(e) : 'خطای غیرمنتظره');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Logo size={72} />
      <Title>ورود با ایمیل</Title>
      <Subtitle>ایمیل خود را وارد کنید — کد ورود به همان ایمیل ارسال می‌شود</Subtitle>

      <Input
        value={email}
        onChangeText={(t) => setEmail(t.trim())}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="emailAddress"
        onSubmitEditing={submit}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button label="ارسال کد" onPress={submit} busy={busy} disabled={email.trim().length < 5} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: {
    color: theme.danger,
    textAlign: 'right',
    marginTop: 12,
    fontSize: 14,
  },
});
