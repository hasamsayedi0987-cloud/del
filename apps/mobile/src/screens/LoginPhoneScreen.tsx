import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
  StyleSheet,
} from 'react-native';
import { api, ApiError } from '../api';
import {
  getApiBaseUrl,
  saveApiBaseUrl,
  loadSavedCountry,
  saveCountry,
  DEFAULT_SERVER_URL,
} from '../config';
import {
  COUNTRIES,
  POPULAR_CC,
  DEFAULT_COUNTRY,
  flagOf,
  toLatinDigits,
  type Country,
} from '../countries';
import { theme } from '../theme';
import { Button, Input, Logo, Screen, Subtitle, Title } from '../components/ui';

/** فهرست نمایشی: پرطرفدارها (ایران، ترکیه، افغانستان، …) اول */
const DISPLAY_LIST: Country[] = [
  ...POPULAR_CC.map((cc) => COUNTRIES.find((c) => c.cc === cc)!).filter(Boolean),
  ...COUNTRIES.filter((c) => !POPULAR_CC.includes(c.cc)),
];

export function LoginPhoneScreen({
  onCodeSent,
}: {
  onCodeSent: (phone: string, devCode?: string) => void;
}) {
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [server, setServer] = useState(getApiBaseUrl());

  // بازیابی کشور انتخابی دفعهٔ قبل (مثلاً ترکیه یا آلمان)
  useEffect(() => {
    loadSavedCountry().then((cc) => {
      if (cc) {
        const c = COUNTRIES.find((x) => x.cc === cc);
        if (c) setCountry(c);
      }
    });
  }, []);

  const filtered = useMemo(() => {
    const q = toLatinDigits(query).trim().toLowerCase();
    if (!q) return DISPLAY_LIST;
    return DISPLAY_LIST.filter(
      (c) =>
        c.name.includes(query.trim()) ||
        c.dial.startsWith(q.replace(/\+/g, '')) ||
        c.cc.toLowerCase().includes(q),
    );
  }, [query]);

  const pickCountry = (c: Country) => {
    setCountry(c);
    setPickerOpen(false);
    setQuery('');
    saveCountry(c.cc);
    setError(null);
  };

  const submit = async () => {
    setError(null);
    // فقط رقم‌ها — ارقام فارسی هم پذیرفته می‌شود — صفر ابتدای شماره محلی حذف می‌شود
    const national = toLatinDigits(phone).replace(/\D/g, '').replace(/^0+/, '');
    if (national.length < 6 || national.length > 14) {
      setError('شماره موبایل را کامل و بدون پیش‌شمارهٔ کشور وارد کنید');
      return;
    }
    // شماره کامل بین‌المللی E.164 — مثال: انتخاب ترکیه و 532… → +90532…
    const e164 = `+${country.dial}${national}`;
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
      const res = await api.requestOtp(e164);
      onCodeSent(e164, res.devCode);
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
      <Subtitle>کشور را انتخاب و شماره موبایل خود را وارد کنید — کد ورود با پیامک ارسال می‌شود</Subtitle>

      <View style={styles.phoneRow}>
        <Pressable
          style={styles.countryBox}
          onPress={() => setPickerOpen(true)}
          testID="country-picker"
        >
          <Text style={styles.flag}>{flagOf(country.cc)}</Text>
          <Text style={styles.dial}>+{country.dial}</Text>
          <Text style={styles.chev}>▾</Text>
        </Pressable>
        <View style={styles.phoneInputWrap}>
          <Input
            value={phone}
            onChangeText={setPhone}
            placeholder="912 123 4567"
            keyboardType="phone-pad"
            maxLength={18}
            onSubmitEditing={submit}
            autoFocus
          />
        </View>
      </View>
      <Text style={styles.hint}>
        {flagOf(country.cc)} {country.name} — شماره را بدون صفر اول وارد کنید
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        label="دریافت کد ورود"
        onPress={submit}
        busy={busy}
        disabled={toLatinDigits(phone).replace(/\D/g, '').length < 6}
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

      {/* انتخابگر کشور — همهٔ کشورهای جهان */}
      <Modal
        visible={pickerOpen}
        animationType="slide"
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={styles.modalWrap}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>انتخاب کشور</Text>
            <Pressable onPress={() => setPickerOpen(false)}>
              <Text style={styles.modalClose}>بستن ✕</Text>
            </Pressable>
          </View>
          <View style={styles.searchBox}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="جست‌وجو: نام کشور یا کد (مثلاً ۹۰ یا 90)"
              placeholderTextColor={theme.textDim}
              style={styles.searchInput}
              autoCorrect={false}
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(c) => c.cc}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [
                  styles.countryRow,
                  pressed && styles.countryRowPressed,
                  item.cc === country.cc && styles.countryRowActive,
                ]}
                onPress={() => pickCountry(item)}
              >
                <View style={styles.countryLeft}>
                  <Text style={styles.rowFlag}>{flagOf(item.cc)}</Text>
                  <Text style={styles.rowName}>{item.name}</Text>
                </View>
                <Text style={styles.rowDial}>+{item.dial}</Text>
              </Pressable>
            )}
            initialNumToRender={24}
            maxToRenderPerBatch={24}
            windowSize={9}
          />
        </View>
      </Modal>
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
  phoneRow: {
    flexDirection: 'row-reverse', // انتخابگر کشور سمت راست، ورودی شماره سمت چپ
    gap: 8,
  },
  countryBox: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius,
    paddingHorizontal: 10,
    paddingVertical: 12,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    minWidth: 104,
    justifyContent: 'center',
  },
  flag: {
    fontSize: 22,
  },
  dial: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
  },
  chev: {
    color: theme.textDim,
    fontSize: 12,
  },
  phoneInputWrap: {
    flex: 1,
  },
  hint: {
    color: theme.textDim,
    fontSize: 12,
    textAlign: 'right',
    marginTop: 8,
  },
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
  // ——— مودال انتخاب کشور ———
  modalWrap: {
    flex: 1,
    backgroundColor: theme.bg,
    paddingHorizontal: 16,
    paddingTop: 48,
  },
  modalHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    color: theme.text,
    fontSize: 20,
    fontWeight: '700',
  },
  modalClose: {
    color: theme.accent,
    fontSize: 14,
  },
  searchBox: {
    marginBottom: 10,
  },
  searchInput: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius,
    color: theme.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    textAlign: 'right',
  },
  countryRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  countryRowPressed: {
    backgroundColor: theme.surface,
  },
  countryRowActive: {
    backgroundColor: theme.accentSoft,
  },
  countryLeft: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  rowFlag: {
    fontSize: 24,
  },
  rowName: {
    color: theme.text,
    fontSize: 16,
    textAlign: 'right',
    flexShrink: 1,
  },
  rowDial: {
    color: theme.textDim,
    fontSize: 14,
    direction: 'ltr',
  },
});
