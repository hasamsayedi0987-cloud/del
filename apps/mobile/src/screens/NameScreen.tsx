import React, { useState } from 'react';
import { Alert, Image, Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { api, ApiError } from '../api';
import { avatarBase64 } from '../media';
import { fs, useTheme, type DelTheme } from '../theme';
import { Button, Logo, Screen, Subtitle, Title } from '../components/ui';
import { faError } from '../faError';
import type { UserDto } from '@del/shared-types';

/**
 * تکمیل پروفایل (v1.4) — گام بعد از تأیید کد: نام، بعد عکس اختیاری.
 * هر دو گام قابل ردشدن هستند و بعداً در پروفایل هم قابل ویرایش‌اند.
 */
export function NameScreen({
  accessToken,
  initialName,
  onDone,
  onSkip,
}: {
  accessToken: string;
  initialName: string | null;
  onDone: (u: UserDto) => void;
  onSkip: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [name, setName] = useState(initialName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** عکس انتخاب‌شده (base64) — با «ادامه» آپلود می‌شود */
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  const pick = () => {
    Alert.alert('عکس پروفایل', undefined, [
      { text: 'گالری', onPress: () => void pickWith(ImagePicker.launchImageLibraryAsync) },
      { text: 'دوربین', onPress: () => void pickWith(ImagePicker.launchCameraAsync) },
      { text: 'انصراف', style: 'cancel' },
    ]);
  };

  const pickWith = async (
    launch: typeof ImagePicker.launchImageLibraryAsync,
  ): Promise<void> => {
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
      // فشرده‌سازی محلی ۵۱۲px — سقف ۵۱۲KB آواتار و سقف JSON سرور
      const b64 = await avatarBase64(res.assets[0].uri);
      setImageB64(b64);
      setPreviewUri(res.assets[0].uri);
    } catch {
      Alert.alert('عکس پروفایل', 'پردازش عکس ناموفق بود — عکس دیگری انتخاب کنید');
    }
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      let user = await api.updateMe(accessToken, {
        displayName: name.trim() || undefined,
      });
      if (imageB64) {
        user = await api.uploadAvatar(accessToken, imageB64, 'image/jpeg');
      }
      onDone(user);
    } catch (e) {
      setError(e instanceof ApiError ? faError(e) : 'ذخیره ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Logo size={72} />
      <Title>دلتان خوش آمد!</Title>
      <Subtitle>چطور صدا بزنیمتان؟ (اختیاری)</Subtitle>

      <TouchableOpacity style={styles.avatarWrap} onPress={pick} activeOpacity={0.8}>
        {previewUri ? (
          <Image source={{ uri: previewUri }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarEmpty]}>
            <Text style={styles.avatarPlus}>📷</Text>
          </View>
        )}
        <Text style={styles.avatarHint}>{previewUri ? 'تغییر عکس' : 'انتخاب عکس پروفایل'}</Text>
      </TouchableOpacity>

      <TextInput
        value={name}
        onChangeText={(t) => setName(t.slice(0, 40))}
        placeholder="نام نمایشی مثلاً: علی"
        placeholderTextColor={theme.textDim}
        style={styles.input}
        textAlign="right"
        maxLength={40}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        label={imageB64 || name.trim() ? 'ادامه' : 'رد کردن — بعداً تنظیم می‌کنم'}
        onPress={finish}
        busy={busy}
      />
      {!imageB64 && !name.trim() ? null : (
        <Button label="رد کردن" variant="ghost" onPress={onSkip} />
      )}
    </Screen>
  );
}

const makeStyles = (theme: DelTheme) =>
  StyleSheet.create({
    avatarWrap: { alignItems: 'center', marginTop: 20 },
    avatar: {
      width: 108,
      height: 108,
      borderRadius: 54,
      borderWidth: 2,
      borderColor: theme.accent,
    },
    avatarEmpty: {
      backgroundColor: theme.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarPlus: { fontSize: 34 },
    avatarHint: { color: theme.accent, fontSize: fs(13), marginTop: 8 },
    input: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: theme.radius,
      color: theme.text,
      fontSize: fs(17),
      paddingVertical: 14,
      paddingHorizontal: 18,
      marginTop: 18,
      textAlign: 'right',
    },
    error: { color: theme.danger, fontSize: fs(13), textAlign: 'right', marginTop: 10 },
  });
