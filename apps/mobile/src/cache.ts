/**
 * کش آفلاین — گفتگوها و پیام‌های اخیر روی دیسک ذخیره می‌شوند تا بدون اینترنت هم
 * آخرین وضعیت دیده شود (issue: عدم بارگذاری پیام‌ها در حالت آفلاین).
 * AsyncStorage اینجا فقط متادیتا/متن است؛ کلیدهای رمزنگاری در SecureStore می‌مانند.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ConversationDto, MessageDto } from '@del/shared-types';

export type CachedMsg = MessageDto & {
  status?: 'sending' | 'sent' | 'failed';
};

const KEY_CONVS = 'del.cache.convs.v1';
const keyMsgs = (conversationId: string) => `del.cache.msgs.v1.${conversationId}`;
/** سقف نگهداری پیام هر گفتگو در کش */
const MSG_CACHE_LIMIT = 200;

export async function saveConvs(list: ConversationDto[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_CONVS, JSON.stringify({ at: Date.now(), list }));
  } catch {
    // کش قصور کرد — بارگذاری زنده همان کار می‌کند
  }
}

export async function loadConvs(): Promise<ConversationDto[] | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_CONVS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { list?: ConversationDto[] };
    return Array.isArray(parsed.list) ? parsed.list : null;
  } catch {
    return null;
  }
}

/** فقط پیام‌های ثبت‌شدهٔ سرور کش می‌شوند — موقت‌های optimistic نه */
export async function saveMessages(conversationId: string, msgs: CachedMsg[]): Promise<void> {
  try {
    const keep = msgs
      .filter((m) => m.serverSeq < Number.MAX_SAFE_INTEGER && m.status !== 'failed')
      .slice(-MSG_CACHE_LIMIT);
    if (!keep.length) return;
    await AsyncStorage.setItem(keyMsgs(conversationId), JSON.stringify(keep));
  } catch {
    // ignore
  }
}

export async function loadMessages(conversationId: string): Promise<CachedMsg[] | null> {
  try {
    const raw = await AsyncStorage.getItem(keyMsgs(conversationId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedMsg[];
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}
