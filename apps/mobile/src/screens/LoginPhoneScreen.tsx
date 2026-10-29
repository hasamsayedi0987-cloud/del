import React, { useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { api, ApiError } from '../api';
import { theme } from '../theme';
import { Button, Input, Logo, Screen, Subtitle, Title } from '../components/ui';

export function LoginPhoneScreen({ onCodeSent }: { onCodeSent: (phone: string) => void }) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
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

      <Input
        value={phone}
        onChangeText={setPhone}
        placeholder="۰۹۱۲ ۱۲۳ ۴۵۶۷"
        keyboardType="phone-pad"
        maxLength={24}
        onSubmitEditing={submit}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button label="دریافت کد ورود" onPress={submit} busy={busy} disabled={phone.trim().length < 10} />

      <View style={styles.devNote}>
        <Text style={styles.devNoteText}>
          حالت توسعه: کد OTP در پاسخ سرور برگردانده می‌شود (سرویس پیامک هنوز متصل نیست)
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
