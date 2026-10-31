import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * آدرس سرور API — در نسخه نصب‌شده (release) قابل تغییر از داخل اپ است.
 *  • حالت توسعه:  شبیه‌ساز اندروید → http://10.0.2.2:3000  |  شبیه‌ساز iOS → http://localhost:3000
 *  • نسخه نصب‌شده: پیش‌فرض خالی — کاربر در صفحه ورود آدرس سرور خودش را وارد می‌کند
 *    (مثلاً http://192.168.1.5:3000 یا https://api.example.com) و در SecureStore ذخیره می‌شود.
 */
const STORE_KEY = 'del.server.url';

let current = __DEV__
  ? Platform.OS === 'android'
    ? 'http://10.0.2.2:3000'
    : 'http://localhost:3000'
  : '';

/** آدرس فعلی سرور — هنگام بوت، loadApiBaseUrl مقدار ذخیره‌شده را می‌خواند */
export function getApiBaseUrl(): string {
  return current;
}

/** بازیابی آدرس ذخیره‌شده — هنگام بوت اپ (App.tsx) */
export async function loadApiBaseUrl(): Promise<void> {
  try {
    const saved = await SecureStore.getItemAsync(STORE_KEY);
    if (saved) current = saved;
  } catch {
    /* خواندن نشد — پیش‌فرض می‌ماند */
  }
}

/** ذخیره آدرس جدید (بدون اسلش انتهایی) — از صفحه ورود */
export async function saveApiBaseUrl(url: string): Promise<string> {
  const clean = url.trim().replace(/\/+$/, '');
  current = clean;
  try {
    await SecureStore.setItemAsync(STORE_KEY, clean);
  } catch {
    /* حافظه امن در دسترس نیست — فقط در حافظه همین اجرا می‌ماند */
  }
  return clean;
}
