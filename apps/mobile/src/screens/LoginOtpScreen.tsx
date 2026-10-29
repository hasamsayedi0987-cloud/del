import React, { useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { api, ApiError } from '../api';
import { theme } from '../theme';
import { Button, Input, Logo, Screen, Subtitle, Title } from '../components/ui';
import { faError } from './LoginPhoneScreen';
import { Platform } from 'react-native';
import type { AuthSession } from '@del/shared-types';

export function LoginOtpScreen({
  phone,
  onVerified,
  onBack,
}: {
  phone: string;
  onVerified: (session: AuthSession) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const session = await api.verifyOtp(phone, code.trim(), Platform.OS);
      onVerified(session);
    } catch (e) {
      setError(e instanceof ApiError ? faError(e) : 'خطای غیرمنتظره');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Logo size={72} />
      <Title>کد تأیید</Title>
      <Subtitle>کد ۶ رقمی برای {phone} ارسال شد</Subtitle>

      <Input
        value={code}
        onChangeText={(t) => setCode(t.replace(/[^0-9۰-۹]/g, ''))}
        placeholder="______"
        keyboardType="number-pad"
        maxLength={6}
        onSubmitEditing={submit}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button label="ورود به دل" onPress={submit} busy={busy} disabled={code.length < 4} />
      <Button label="تغییر شماره" variant="ghost" onPress={onBack} />
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
