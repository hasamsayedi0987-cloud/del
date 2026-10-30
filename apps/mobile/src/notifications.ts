/**
 * Del — اعلان‌ها (گام ۷)
 *
 * سه مسیر:
 *  ۱) اعلان محلی برای پیام WS وقتی اپ در پس‌زمینه است (بدون نیاز به هیچ سرویس بیرونی)
 *  ۲) ثبت توکن Expo Push برای اپ بسته/پس‌زمینه کامل (نیازمند projectId از EAS — اختیاری)
 *  ۳) مدیریت تپ روی اعلان → ناوبری به گفتگو
 */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** رفتار اعلان — همیشه نمایش داده شود (سرور تصمیم ارسال را گرفته) */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/** کانال‌های اندروید — اهمیت بالا برای heads-up */
export async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('messages', {
    name: 'پیام‌ها',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: '#38BDF8',
    vibrationPattern: [0, 250, 120, 250],
  }).catch(() => undefined);
  await Notifications.setNotificationChannelAsync('calls', {
    name: 'تماس‌ها',
    importance: Notifications.AndroidImportance.MAX,
    lightColor: '#38BDF8',
    vibrationPattern: [0, 400, 200, 400],
  }).catch(() => undefined);
}

/** درخواست مجوز اعلان — false یعنی کاربر رد کرده (اپ بی‌اعلان کار می‌کند) */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!Device.isDevice) {
    // شبیه‌ساز/Expo Go دسکتاپ — مجوز معمولاً هست اما تضمینی نیست
  }
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted) return true;
  if (settings.ios?.status === Notifications.IosAuthorizationStatus.DENIED) return false;
  const req = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  });
  return Boolean(req.granted ?? req.status === 'granted');
}

/**
 * گرفتن توکن Expo Push — فقط وقتی projectId تنظیم شده باشد (extra.eas.projectId در app.json).
 * بدون projectId چیزی به سرور اعلان نمی‌رود و اعلان محلی (مسیر ۱) کار می‌کند.
 */
export async function registerExpoPushToken(): Promise<string | null> {
  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
      ?.projectId ?? '';
  if (!projectId) return null;
  try {
    if (!Device.isDevice) return null; // شبیه‌ساز push نمی‌گیرد
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token.data ?? null;
  } catch {
    return null;
  }
}

/** اعلان محلی پیام — برای حالت پس‌زمینه با WS زنده */
export async function scheduleMessageNotification(
  title: string,
  body: string,
  data: { conversationId?: string; messageId?: string },
): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data, sound: 'default' },
      trigger: null, // فوری
    });
  } catch {
    /* اعلان حیاتی نیست */
  }
}

/** اعلان محلی تماس ورودی */
export async function scheduleCallNotification(
  callerName: string,
  data: { callId: string; conversationId?: string },
): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: callerName,
        body: '📞 تماس ورودی — برای پاسخ اپ را باز کنید',
        data: { ...data, kind: 'call' },
        sound: 'default',
      },
      trigger: null,
    });
  } catch {
    /* حیاتی نیست */
  }
}

/** تپ روی اعلان → data.conversationId/callId */
export function onNotificationResponse(
  cb: (data: { conversationId?: string; callId?: string; kind?: string }) => void,
): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = (response.notification.request.content.data ?? {}) as {
      conversationId?: string;
      callId?: string;
      kind?: string;
    };
    cb(data);
  });
  return () => sub.remove();
}
