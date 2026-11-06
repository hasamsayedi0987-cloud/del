import React, { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { api, ApiError, absoluteUrl } from '../api';
import { avatarBase64 } from '../media';
import {
  WALLPAPER_CHOICES,
  fs,
  getThemeSettings,
  saveThemeSettings,
  useTheme,
  type DelTheme,
  type ThemeMode,
  type WallpaperKey,
} from '../theme';
import { Button, Card, Screen, Subtitle, Title } from '../components/ui';
import { faError } from '../faError';
import { e2eeIdentityPublic } from '../e2ee/engine';
import { e2eeStore } from '../e2ee/store';
import type { UserDto } from '@del/shared-types';

const THEME_LABELS: Record<ThemeMode, string> = {
  light: '☀️ روشن',
  dark: '🌙 تاریک',
  auto: '🌗 خودکار (شب/روز)',
};

const FONT_SCALES: Array<{ v: number; label: string }> = [
  { v: 0.85, label: 'کوچک' },
  { v: 1, label: 'معمولی' },
  { v: 1.15, label: 'بزرگ' },
  { v: 1.3, label: 'خیلی بزرگ' },
];

/**
 * پروفایل v1.4 — عکس و ایمیل بالا، تنظیمات شخصی‌سازی (تم/فونت/پس‌زمینه)،
 * رمزنگاری، هوش مصنوعی و حساب.
 */
export function ProfileScreen({
  user,
  accessToken,
  onUpdated,
  onLogout,
  onBack,
}: {
  user: UserDto;
  accessToken: string;
  onUpdated: (u: UserDto) => void;
  onLogout: () => void;
  onBack: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const settings = getThemeSettings();

  const [name, setName] = useState(user.displayName ?? '');
  const [about, setAbout] = useState(user.about ?? '');
  const [saving, setSaving] = useState(false);
  const [avatarVersion, setAvatarVersion] = useState(Date.now());
  /** عکس انتخاب‌شده (base64 فشرده) تا «ثبت» شود */
  const [pickedAvatarB64, setPickedAvatarB64] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  // ————— تنظیمات شخصی‌سازی —————
  const [mode, setMode] = useState<ThemeMode>(settings.mode);
  const [fontScale, setFontScale] = useState(settings.fontScale);
  const [wallpaper, setWallpaper] = useState<WallpaperKey>(settings.wallpaper);

  // ————— گام ۹: رضایت هوش مصنوعی —————
  const [aiConsent, setAiConsent] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const s = await api.aiStatus(accessToken);
        setAiConsent(s.globalConsent);
        setAiAvailable(s.available);
      } catch {
        /* بی‌اهمیت */
      }
    })();
  }, [accessToken]);

  // ————— گام ۸: وضعیت رمزنگاری —————
  const [e2eeActive, setE2eeActive] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      setE2eeActive(Boolean(e2eeIdentityPublic()));
      setRecoveryKey(await e2eeStore.getRecoveryKey());
    })();
  }, []);

  /** انتخاب منبع: گالری یا دوربین — پیش‌نمایش می‌آید و با «ثبت عکس پروفایل» آپلود می‌شود */
  const pickAvatar = () => {
    Alert.alert('عکس پروفایل', undefined, [
      { text: 'گالری', onPress: () => void pickFrom(ImagePicker.launchImageLibraryAsync) },
      { text: 'دوربین', onPress: () => void pickFrom(ImagePicker.launchCameraAsync) },
      { text: 'انصراف', style: 'cancel' },
    ]);
  };

  const pickFrom = async (
    launch: typeof ImagePicker.launchImageLibraryAsync,
  ) => {
    const perm = launch === ImagePicker.launchCameraAsync
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('دسترسی', 'برای انتخاب عکس، دسترسی را بدهید');
      return;
    }
    const res = await launch({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (res.canceled || !res.assets[0]) return;
    try {
      setAvatarBusy(true);
      // فشرده‌سازی محلی به ۵۱۲px — عکس خام دوربین از سقف ۵۱۲KB آواتار رد می‌شد
      const b64 = await avatarBase64(res.assets[0].uri);
      // پیش‌نمایش فوری + دکمهٔ «ثبت عکس پروفایل» — هیچ‌چیز بی‌صدا نیست
      setPickedAvatarB64(b64);
    } catch {
      Alert.alert('عکس پروفایل', 'پردازش عکس ناموفق بود — عکس دیگری انتخاب کنید');
    } finally {
      setAvatarBusy(false);
    }
  };

  /** ثبت نهایی عکس — بعد از انتخاب، کاربر با دکمه تأیید می‌کند */
  const confirmAvatar = async () => {
    if (!pickedAvatarB64) return;
    try {
      setAvatarBusy(true);
      const u = await api.uploadAvatar(accessToken, pickedAvatarB64, 'image/jpeg');
      onUpdated(u);
      setPickedAvatarB64(null);
      setAvatarVersion(Date.now());
      Alert.alert('ثبت شد ✓', 'عکس پروفایل شما ذخیره شد');
    } catch (e) {
      Alert.alert('عکس پروفایل', e instanceof ApiError ? faError(e) : 'آپلود ناموفق بود');
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = () => {
    api
      .removeAvatar(accessToken)
      .then((u) => {
        onUpdated(u);
        setAvatarVersion(Date.now());
      })
      .catch(() => Alert.alert('عکس پروفایل', 'حذف ناموفق بود'));
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.updateMe(accessToken, {
        displayName: name.trim() || undefined,
        about: about.trim() || undefined,
      });
      onUpdated(updated);
      Alert.alert('ذخیره شد', 'پروفایل به‌روزرسانی شد');
    } catch {
      Alert.alert('خطا', 'ذخیره ناموفق بود');
    } finally {
      setSaving(false);
    }
  };

  const setModeAndSave = (m: ThemeMode) => {
    setMode(m);
    void saveThemeSettings({ mode: m });
  };
  const setFontAndSave = (v: number) => {
    setFontScale(v);
    void saveThemeSettings({ fontScale: v });
  };
  const setWallAndSave = (w: WallpaperKey) => {
    setWallpaper(w);
    void saveThemeSettings({ wallpaper: w });
  };

  const avatarUri = absoluteUrl(user.avatarUrl);

  return (
    <Screen>
      <Text style={styles.back} onPress={onBack}>
        ‹ بازگشت
      </Text>

      {/* ————— کارت هویت ————— */}
      <View style={styles.hero}>
        <TouchableOpacity onPress={pickAvatar} onLongPress={user.avatarUrl ? removeAvatar : undefined}>
          {pickedAvatarB64 ? (
            <Image source={{ uri: `data:image/jpeg;base64,${pickedAvatarB64}` }} style={styles.avatar} />
          ) : avatarUri ? (
            <Image
              source={{ uri: `${avatarUri}${avatarUri.includes('?') ? '&' : '?'}t=${avatarVersion}` }}
              style={styles.avatar}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarEmpty]}>
              <Text style={styles.avatarPlus}>{avatarBusy ? '…' : '📷'}</Text>
            </View>
          )}
        </TouchableOpacity>
        {pickedAvatarB64 ? (
          <TouchableOpacity style={styles.confirmAvatarBtn} onPress={() => void confirmAvatar()} disabled={avatarBusy}>
            <Text style={styles.confirmAvatarText}>{avatarBusy ? 'در حال ثبت…' : '✓ ثبت عکس پروفایل'}</Text>
          </TouchableOpacity>
        ) : null}
        <Title>{user.displayName ?? 'کاربر دل'}</Title>
        <Text style={styles.email}>{user.email ?? user.phone ?? '—'}</Text>
        <Text style={styles.joined}>
          عضو از {new Date(user.createdAt).toLocaleDateString('fa-IR')}
        </Text>
      </View>

      {/* ————— نام و بیو ————— */}
      <Text style={styles.section}>نام نمایشی و بیو</Text>
      <TextInput
        value={name}
        onChangeText={(t) => setName(t.slice(0, 40))}
        placeholder="نام نمایشی"
        placeholderTextColor={theme.textDim}
        style={styles.input}
        textAlign="right"
        maxLength={40}
      />
      <TextInput
        value={about}
        onChangeText={(t) => setAbout(t.slice(0, 120))}
        placeholder="دربارهٔ من (دیده می‌شود)"
        placeholderTextColor={theme.textDim}
        style={styles.input}
        textAlign="right"
        maxLength={120}
      />
      <Button label="ذخیره پروفایل" onPress={save} busy={saving} />

      {/* ————— شخصی‌سازی ————— */}
      <Text style={styles.section}>شخصی‌سازی</Text>
      <Card>
        <Text style={styles.rowLabel}>تم برنامه</Text>
        <View style={styles.choiceRow}>
          {(Object.keys(THEME_LABELS) as ThemeMode[]).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.chip, mode === m && styles.chipOn]}
              onPress={() => setModeAndSave(m)}
            >
              <Text style={[styles.chipText, mode === m && styles.chipTextOn]}>
                {THEME_LABELS[m]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.rowLabel}>اندازه فونت</Text>
        <View style={styles.choiceRow}>
          {FONT_SCALES.map((f) => (
            <TouchableOpacity
              key={f.v}
              style={[styles.chip, fontScale === f.v && styles.chipOn]}
              onPress={() => setFontAndSave(f.v)}
            >
              <Text style={[styles.chipText, fontScale === f.v && styles.chipTextOn]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.rowLabel}>پس‌زمینهٔ گفتگو</Text>
        <View style={styles.choiceRow}>
          {WALLPAPER_CHOICES.map((w) => (
            <TouchableOpacity
              key={w.key}
              style={[styles.chip, wallpaper === w.key && styles.chipOn]}
              onPress={() => setWallAndSave(w.key)}
            >
              <Text style={[styles.chipText, wallpaper === w.key && styles.chipTextOn]}>
                {w.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </Card>

      {/* ————— رمزنگاری ————— */}
      <Text style={styles.section}>رمزنگاری سرتاسری</Text>
      <Card>
        <Row
          theme={theme}
          styles={styles}
          label="وضعیت"
          value={e2eeActive ? '🔒 فعال (X3DH + Double Ratchet)' : 'غیرفعال — از صفحهٔ گفتگوها فعال کنید'}
        />
        <Row
          theme={theme}
          styles={styles}
          label="کلید بازیابی"
          value={
            recoveryKey
              ? showRecovery && recoveryKey
                ? recoveryKey
                : 'ذخیره‌شده — نمایش'
              : 'روی این دستگاه نیست'
          }
        />
        {recoveryKey ? (
          <Text style={styles.recoveryToggle} onPress={() => setShowRecovery((v) => !v)}>
            {showRecovery ? 'پنهان کردن کلید' : 'نمایش کلید بازیابی'}
          </Text>
        ) : null}
      </Card>

      {/* ————— هوش مصنوعی ————— */}
      <Text style={styles.section}>هوش مصنوعی</Text>
      <Card>
        <Row
          theme={theme}
          styles={styles}
          label="وضعیت سرویس"
          value={aiAvailable ? 'فعال روی سرور' : 'غیرفعال (بدون provider)'}
        />
        <Row theme={theme} styles={styles} label="رضایت من" value={aiConsent ? 'داده شده ✓' : 'داده نشده'} />
        <Text style={styles.aiNote}>
          با رضایت، دستیار دل، ترجمه، پیشنهاد پاسخ و خلاصه فعال می‌شود. پیام‌های رمزنگاری‌شدهٔ
          سرتاسری هرگز برای هوش مصنوعی استفاده نمی‌شوند و رضایت می‌تواند لغو شود.
        </Text>
        <TouchableOpacity
          style={[styles.aiToggle, aiConsent ? styles.aiToggleOn : null]}
          onPress={() => {
            const next = !aiConsent;
            api
              .setAiConsent(accessToken, next)
              .then(() => setAiConsent(next))
              .catch(() => Alert.alert('خطا', 'تغییر رضایت ناموفق بود'));
          }}
        >
          <Text style={styles.aiToggleText}>
            {aiConsent ? 'لغو رضایت هوش مصنوعی' : 'دادن رضایت هوش مصنوعی'}
          </Text>
        </TouchableOpacity>
      </Card>

      <View style={styles.bottom}>
        <Button label="خروج از حساب" variant="danger" onPress={onLogout} />
      </View>
    </Screen>
  );
}

function Row({
  label,
  value,
  theme,
  styles,
}: {
  label: string;
  value: string;
  theme: DelTheme;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (theme: DelTheme) =>
  StyleSheet.create({
    back: { color: theme.accent, fontSize: fs(14), marginBottom: 8 },
    hero: { alignItems: 'center', marginTop: 8 },
    avatar: { width: 116, height: 116, borderRadius: 58, borderWidth: 2, borderColor: theme.accent },
    avatarEmpty: {
      backgroundColor: theme.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarPlus: { fontSize: 36 },
    confirmAvatarBtn: {
      marginTop: 10,
      backgroundColor: theme.accent,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 18,
    },
    confirmAvatarText: { color: '#fff', fontSize: 14, fontWeight: '600' },
    email: {
      color: theme.textDim,
      fontSize: fs(15),
      marginTop: 6,
      fontWeight: '600',
      direction: 'ltr',
      textAlign: 'center',
    },
    joined: { color: theme.textDim, fontSize: fs(12), marginTop: 4, opacity: 0.8 },
    section: {
      color: theme.textDim,
      fontSize: fs(13),
      textAlign: 'right',
      marginTop: 24,
      marginBottom: -12,
      fontWeight: '700',
    },
    input: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: theme.radius,
      color: theme.text,
      fontSize: fs(17),
      paddingVertical: 13,
      paddingHorizontal: 18,
      marginTop: 16,
    },
    choiceRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginTop: 10 },
    chip: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 20,
      paddingVertical: 7,
      paddingHorizontal: 13,
      backgroundColor: theme.bg,
    },
    chipOn: { borderColor: theme.accent, backgroundColor: theme.accentSoft },
    chipText: { color: theme.textDim, fontSize: fs(13), fontWeight: '600' },
    chipTextOn: { color: theme.accent, fontWeight: '800' },
    row: {
      flexDirection: 'row-reverse',
      justifyContent: 'space-between',
      paddingVertical: 8,
    },
    rowLabel: { color: theme.textDim, fontSize: fs(14), marginTop: 8 },
    rowValue: {
      color: theme.text,
      fontSize: fs(14),
      fontWeight: '600',
      flex: 1,
      textAlign: 'left',
    },
    recoveryToggle: {
      color: theme.accent,
      fontSize: fs(13),
      textAlign: 'right',
      marginTop: 6,
      paddingVertical: 4,
    },
    aiNote: {
      color: theme.textDim,
      fontSize: fs(12),
      lineHeight: fs(20),
      textAlign: 'right',
      marginTop: 6,
    },
    aiToggle: {
      marginTop: 10,
      borderColor: theme.accent,
      borderWidth: 1,
      borderRadius: theme.radius,
      paddingVertical: 10,
      alignItems: 'center',
    },
    aiToggleOn: { borderColor: '#ef4444' },
    aiToggleText: { color: theme.accent, fontSize: fs(14), fontWeight: '700' },
    bottom: { marginTop: 'auto', paddingTop: 24 },
  });
