import React, { useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { api, ApiError } from '../api';
import { getApiBaseUrl, saveApiBaseUrl, DEFAULT_SERVER_URL } from '../config';
import { theme } from '../theme';
import { Button, Input, Logo, Screen, Subtitle, Title } from '../components/ui';

export function LoginPhoneScreen({
  onCodeSent,
}: {
  onCodeSent: (phone: string, devCode?: string) => void;
}) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [server, setServer] = useState(getApiBaseUrl());

  const submit = async () => {
    setError(null);
    const digits = phone.trim();
    if (digits.length < 10) {
      setError('شماره موبایل را کامل وارد کنید');
      return;
    }
    const srv = server.trim();
    if (showAdvanced && srv && !/^https?:\/\/.+/i.test(srv)) {
      setError('آدرس سرور باید با http:// یا https:// شروع شود');
      return;
    }
    setBusy(true);
    try {
      if (showAdvanced && srv) {
        await saveApiBaseUrl(srv); // آدرس سرور ذخیره می‌شود و همه درخواست‌ها از آن استفاده می‌کنند
      }
      const res = await api.requestOtp(digits);
      onCodeSent(digits, res.devCode);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NETWORK') {
        setError('اتصال به سرور ممکن نشد — اگر سرور دل روی کامپیوتر خودتان است، آن را روشن کنید و در «تنظیمات پیشرفته» پایین صفحه آدرس درست را وارد کنید');
      } else {
        setError(e instanceof ApiError ? faError(e) : 'خطای غیرمنتظره');
      }
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
        autoFocus
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        label="دریافت کد ورود"
        onPress={submit}
        busy={busy}
        disabled={phone.trim().length < 10}
      />

      {/* تنظیمات پیشرفته — برای سرور خودمیزبان؛ پیش‌فرض نیازی به آن نیست */}
      <Text
        style={styles.advancedToggle}
        onPress={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? 'بستن تنظیمات پیشرفته ▴' : 'سرور شخصی دارید؟ تنظیمات پیشرفته ▾'}
      </Text>

      {showAdvanced ? (
        <View style={styles.advancedBox}>
          <Text style={styles.fieldLabel}>آدرس سرور دل</Text>
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
            پیش‌فرض: {DEFAULT_SERVER_URL} — با ذخیره‌شدن در همین صفحه برای دفعات بعد حفظ می‌شود
          </Text>
        </View>
      ) : null}
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
  advancedToggle: {
    color: theme.textDim,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 20,
    textDecorationLine: 'underline',
  },
  advancedBox: {
    marginTop: 8,
  },
  fieldLabel: {
    color: theme.textDim,
    fontSize: 13,
    textAlign: 'right',
    marginBottom: -10,
  },
  fieldHint: {
    color: theme.textDim,
    fontSize: 12,
    textAlign: 'right',
    marginTop: 8,
    lineHeight: 18,
  },
});
