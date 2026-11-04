/**
 * Del — سیستم تم v1.4
 *  • دو پالت: روشن (پیش‌فرض) و تاریک Crystal Blue
 *  • حالت خودکار: شب (۱۹ تا ۶:۳۰) تاریک، بقیه روشن
 *  • مقیاس فونت + پس‌زمینهٔ گفتگو — همه در پروفایل قابل تنظیم و ماندگار
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export interface DelTheme {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  danger: string;
  success: string;
  /** حباب پیام خودم */
  bubbleMe: string;
  bubbleMeText: string;
  /** حباب پیام طرف مقابل */
  bubbleOther: string;
  radius: number;
  space: number;
  dark: boolean;
}

/** پالت تاریک — Crystal Blue (مطابق docs/design) */
const darkPalette: DelTheme = {
  bg: '#0A1628',
  surface: '#101F38',
  surfaceAlt: '#16294A',
  border: '#1E3A5F',
  text: '#E8F1FB',
  textDim: '#8FA8C8',
  accent: '#38BDF8',
  accentStrong: '#0EA5E9',
  accentSoft: 'rgba(56, 189, 248, 0.14)',
  danger: '#F87171',
  success: '#34D399',
  bubbleMe: '#0E4C6E',
  bubbleMeText: '#EAF6FF',
  bubbleOther: '#16294A',
  radius: 14,
  space: 16,
  dark: true,
};

/** پالت روشن — Crystal Day */
const lightPalette: DelTheme = {
  bg: '#F2F7FC',
  surface: '#FFFFFF',
  surfaceAlt: '#E8F1FA',
  border: '#D4E2F0',
  text: '#122B45',
  textDim: '#5E7A99',
  accent: '#0284C7',
  accentStrong: '#0369A1',
  accentSoft: 'rgba(2, 132, 199, 0.10)',
  danger: '#DC2626',
  success: '#059669',
  bubbleMe: '#0284C7',
  bubbleMeText: '#FFFFFF',
  bubbleOther: '#FFFFFF',
  radius: 14,
  space: 16,
  dark: false,
};

export type ThemeMode = 'light' | 'dark' | 'auto';
export type WallpaperKey = 'none' | 'aurora' | 'waves' | 'dots' | 'bloom' | 'sunset';

export interface ThemeSettings {
  mode: ThemeMode;
  fontScale: number;
  wallpaper: WallpaperKey;
}

const DEFAULT_SETTINGS: ThemeSettings = { mode: 'light', fontScale: 1, wallpaper: 'none' };
const SETTINGS_KEY = 'del.theme.v1';

let currentSettings: ThemeSettings = { ...DEFAULT_SETTINGS };
/** شروع با پالت تاریک تا بوت نپرد؛ loadThemeSettings بلافاصله بعد از بوت صدا زده می‌شود */
let currentPalette: DelTheme = darkPalette;
const listeners = new Set<() => void>();

function nowHour(): number {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}

function paletteFor(mode: ThemeMode): DelTheme {
  if (mode === 'auto') {
    const h = nowHour();
    return h >= 19 || h < 6.5 ? darkPalette : lightPalette;
  }
  return mode === 'dark' ? darkPalette : lightPalette;
}

function apply(settings: ThemeSettings): void {
  currentSettings = settings;
  currentPalette = paletteFor(settings.mode);
  for (const fn of listeners) fn();
}

/** بارگذاری تنظیمات ذخیره‌شده — در بوت اپ */
export async function loadThemeSettings(): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ThemeSettings>;
      apply({
        mode: (parsed.mode as ThemeMode) ?? DEFAULT_SETTINGS.mode,
        fontScale: typeof parsed.fontScale === 'number' ? parsed.fontScale : 1,
        wallpaper: (parsed.wallpaper as WallpaperKey) ?? DEFAULT_SETTINGS.wallpaper,
      });
      return;
    }
  } catch {
    /* تنظیمات خراب — پیش‌فرض */
  }
  apply({ ...DEFAULT_SETTINGS });
}

export async function saveThemeSettings(patch: Partial<ThemeSettings>): Promise<void> {
  const next: ThemeSettings = { ...currentSettings, ...patch };
  apply(next);
  await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(next)).catch(() => undefined);
}

export function getThemeSettings(): ThemeSettings {
  return currentSettings;
}

/** هوک اصلی — تغییر تم همهٔ صفحاتِ رندر را دوباره رندر می‌کند */
export function useTheme(): DelTheme {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((v) => v + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return currentPalette;
}

/** حالت خودکار با باز/بسته‌شدن اپ دوباره ارزیابی شود */
export function watchAutoTheme(): () => void {
  const sub = AppState.addEventListener('change', () => {
    if (currentSettings.mode === 'auto') apply({ ...currentSettings });
  });
  return () => sub.remove();
}

/** اندازه فونت با مقیاس کاربر */
export function fs(size: number): number {
  return Math.round(size * currentSettings.fontScale);
}

/** منبع تصویر پس‌زمینهٔ گفتگو */
export function wallpaperSource(key: WallpaperKey): number | null {
  switch (key) {
    case 'aurora':
      return require('../assets/wallpapers/aurora.jpg');
    case 'waves':
      return require('../assets/wallpapers/waves.jpg');
    case 'dots':
      return require('../assets/wallpapers/dots.jpg');
    case 'bloom':
      return require('../assets/wallpapers/bloom.jpg');
    case 'sunset':
      return require('../assets/wallpapers/sunset.jpg');
    default:
      return null;
  }
}

export const WALLPAPER_CHOICES: Array<{ key: WallpaperKey; label: string }> = [
  { key: 'none', label: 'ساده' },
  { key: 'aurora', label: 'شفق' },
  { key: 'waves', label: 'موج' },
  { key: 'dots', label: 'نقطه' },
  { key: 'bloom', label: 'شکوفه' },
  { key: 'sunset', label: 'غروب' },
];

/** پالت استوری‌های متنی — همان کلیدهای سرور */
export const STORY_BG: Record<string, { colors: [string, string]; text: string }> = {
  aurora: { colors: ['#0EA5E9', '#6366F1'], text: '#FFFFFF' },
  sunset: { colors: ['#F97316', '#DB2777'], text: '#FFFFFF' },
  ocean: { colors: ['#0369A1', '#0F766E'], text: '#FFFFFF' },
  forest: { colors: ['#166534', '#4D7C0F'], text: '#FFFFFF' },
  night: { colors: ['#1E1B4B', '#0F172A'], text: '#E0E7FF' },
  bloom: { colors: ['#DB2777', '#7C3AED'], text: '#FFFFFF' },
};

/** سازگاری: دسترسی به پالتِ فعلی برای صفحات هنوز تبدیل‌نشده (بدون رندر مجدد زنده) */
export const theme: DelTheme = new Proxy({} as DelTheme, {
  get(_t, prop: string) {
    return (currentPalette as unknown as Record<string, unknown>)[prop];
  },
});
