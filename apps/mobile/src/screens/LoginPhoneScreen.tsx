import React, { useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { api, ApiError } from '../api';
import { getApiBaseUrl, saveApiBaseUrl } from '../config';
import { theme } from '../theme';
import { Button, Input, Logo, Screen, Subtitle, Title } from '../components/ui';

export function LoginPhoneScreen({ onCodeSent }: { onCodeSent: (phone: string) => void }) {
  const [server, setServer] = useState(getApiBaseUrl());
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const srv = server.trim();
    if (!/^https?:\/\/.+/i.test(srv)) {
      setError('آدرس سرور باید با http:// یا https:// شروع شود');
      return;
    }
    setBusy(true);
    try {
      await saveApiBaseUrl(srv); // گام ۱۱: آدرس سرور ذخیره می‌شود و همه درخواست‌ها از آن استفاده می‌کنند
      await api.requestOtp(phone.trim());
      onCodeSent(phone.trim());
    } catch (e) {
      setError(e instanceof ApiError ? faError(e) : 'خطای غیرمنتظره');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Logo />
      <Title>به دل خوش آمدید</Title>
      <Subtitle>برای ورود یا ثبت‌نام، شماره موبایل خود را وارد کنید</Subtitle>

      <Text style={styles.fieldLabel}>آدرس سرور</Text>
      <Input
        value={server}
        onChangeText={setServer}
        placeholder="http://192.168.1.5:3000"
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={submit}
      />
      <Text style={styles.fieldHint}>
        آدرس سرور دل که روی کامپیوتر یا سرور خودتان اجرا کرده‌اید
      </Text>

      <Input
        value={phone}
        onChangeText={setPhone}
        placeholder="۰۹۱۲ ۱۲۳ ۴۵۶۷"
        keyboardType="phone-pad"
        maxLength={24}
        onSubmitEditing={submit}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        label="دریافت کد ورود"
        onPress={submit}
        busy={busy}
        disabled={phone.trim().length < 10 || !/^https?:\/\/.+/i.test(server.trim())}
      />

      <View style={styles.devNote}>
        <Text style={styles.devNoteText}>
          کد OTP در پاسخ سرور برگردانده می‌شود (سرویس پیامک هنوز متصل نیست)
        </Text>
      </View>
    </Screen>
  );
}

/** ترجمه خطاهای API به پیام فارسی */
export function faError(e: ApiError): string {
  switch (e.code) {
    case 'PHONE_INVALID':
      return 'شماره موبایل معتبر نیست';
    case 'TOO_MANY_REQUESTS':
      return 'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید';
    case 'OTP_INVALID':
      return 'کد وارد شده اشتباه است';
    case 'OTP_EXPIRED':
      return 'کد منقضی شده است؛ کد جدید بگیرید';
    case 'OTP_LOCKED':
      return 'تلاش‌های ناموفق زیاد بود؛ کد جدید بگیرید';
    case 'OTP_NOT_FOUND':
      return 'کد فعالی وجود ندارد؛ کد جدید بگیرید';
    case 'NETWORK':
      return e.message;
    default:
      return 'خطا در ارتباط با سرور';
  }
}

const styles = StyleSheet.create({
  error: {
    color: theme.danger,
    textAlign: 'right',
    marginTop: 12,
    fontSize: 14,
  },
  fieldLabel: {
    color: theme.textDim,
    fontSize: 13,
    textAlign: 'right',
    marginTop: 24,
    marginBottom: -10,
  },
  fieldHint: {
    color: theme.textDim,
    fontSize: 12,
    textAlign: 'right',
    marginTop: 8,
    lineHeight: 18,
  },
  devNote: {
    marginTop: 'auto',
    paddingTop: 32,
  },
  devNoteText: {
    color: theme.textDim,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 20,
  },
});
