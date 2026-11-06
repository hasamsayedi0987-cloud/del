/**
 * بارگذار امن LiveKit (گام ۶)
 * ماژول‌های WebRTC نیتیو هستند؛ در Expo Go (بدون dev build) در دسترس نیستند —
 * پس require را در try نگه می‌داریم تا کل اپ در Expo Go سالم بماند و تماس با پیام شفاف رد شود.
 * در بیلد توسعه/پروداکشن (با پلاگین @livekit/react-native در app.json) همه‌چیز فعال است.
 */

type LiveKitRN = {
  registerGlobals: () => void;
  AudioSession: {
    startAudioSession: () => Promise<void>;
    stopAudioSession: () => Promise<void>;
    setupAudioSession: (mode?: string) => void;
  };
};

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
function loadLiveKitRN(): LiveKitRN | null {
  try {
    const mod = require('@livekit/react-native');
    if (mod?.registerGlobals && mod?.AudioSession) return mod as LiveKitRN;
    return null;
  } catch {
    return null;
  }
}
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

const lkRN = loadLiveKitRN();

/** یک‌بار در ابتدای اپ — WebRTC globals را در RN می‌سازد (فقط در dev build) */
export function setupCallGlobals(): void {
  if (!lkRN) return;
  try {
    lkRN.registerGlobals();
  } catch {
    /* قبلاً ثبت شده */
  }
}

/** آیا این بیلد از تماس پشتیبانی می‌کند؟ (Expo Go: خیر) */
export function callsSupported(): boolean {
  return lkRN !== null;
}

export async function startAudioSession(): Promise<void> {
  if (!lkRN) return;
  try {
    await lkRN.AudioSession.startAudioSession();
  } catch {
    /* بی‌اهمیت */
  }
}

export async function stopAudioSession(): Promise<void> {
  if (!lkRN) return;
  try {
    await lkRN.AudioSession.stopAudioSession();
  } catch {
    /* بی‌اهمیت */
  }
}

/** Room از livekit-client — بعد از registerGlobals کار می‌کند؛ در Expo Go null */
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
export function createLKRoom(options: Record<string, unknown>): any | null {
  try {
    const { Room } = require('livekit-client');
    return new Room(options);
  } catch {
    return null;
  }
}

/** VideoTrack از @livekit/react-native برای نمایش ویدیوی دورین */
export function getVideoTrackComponent(): any | null {
  try {
    return require('@livekit/react-native').VideoTrack ?? null;
  } catch {
    return null;
  }
}
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
