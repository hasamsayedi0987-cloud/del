import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { api, ApiError } from '../api';
import { getSignedUrl, uploadMedia } from '../media';
import { getSocket, uuid } from '../socket';
import { fs, getThemeSettings, useTheme, wallpaperSource, type DelTheme, type WallpaperKey } from '../theme';
import { ImageBackground } from 'react-native';
import { loadMessages, saveMessages } from '../cache';
import {
  decryptDirect,
  encryptDirect,
  e2eeReady,
  peerSupportsE2ee,
  topUpOtksIfNeeded,
} from '../e2ee/engine';
import type {
  ConversationDto,
  MediaAssetDto,
  MessageDto,
  ParticipantDto,
  PresenceDto,
  WsMemberRemoved,
  WsMessageNew,
  WsMessageRead,
  WsPresenceUpdate,
  WsTyping,
} from '@del/shared-types';

interface LocalMsg extends MessageDto {
  status?: 'sending' | 'sent' | 'failed';
  /** برچسب موقت برای حباب آپلود رسانه */
  pendingLabel?: string;
}

/** حباب خطادار ساده برای fallback آپلود */
function optimisticFail(
  clientMsgId: string,
  conversationId: string,
  senderId: string,
): LocalMsg {
  return {
    id: clientMsgId,
    conversationId,
    senderId,
    serverSeq: Number.MAX_SAFE_INTEGER,
    clientMsgId,
    type: 'image',
    body: '',
    media: null,
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    status: 'failed',
  };
}

export function ChatScreen({
  accessToken,
  myUserId,
  conversation,
  onBack,
  onRequestCall,
}: {
  accessToken: string;
  myUserId: string;
  conversation: ConversationDto;
  onBack: () => void;
  /** گام ۶: درخواست تماس صوتی/تصویری — فقط گفتگوهای ۱:۱ */
  onRequestCall?: (conversation: ConversationDto, kind: 'audio' | 'video') => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [messages, setMessages] = useState<LocalMsg[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState('');
  const [uploading, setUploading] = useState(false);
  const listRef = useRef<FlatList<LocalMsg>>(null);
  // ————— v1.4: پس‌زمینهٔ گفتگو + پیام محوشونده —————
  const wallpaper: WallpaperKey = getThemeSettings().wallpaper;
  const wallSrc = wallpaperSource(wallpaper);
  const [disappearSec, setDisappearSec] = useState(conversation.disappearSec ?? 0);
  const [disappearDialog, setDisappearDialog] = useState(false);

  // ————— گام ۴: گروه‌ها — جزئیات کامل (اعضا + نقش‌ها) —————
  const isGroup = conversation.type === 'group';
  const [groupDetail, setGroupDetail] = useState<ConversationDto | null>(null);
  const members = groupDetail?.participants ?? conversation.participants ?? [];
  const memberCount = groupDetail?.memberCount ?? conversation.memberCount ?? members.length;
  const senderName = useCallback(
    (senderId: string): string => {
      if (!isGroup) return '';
      const p: ParticipantDto | undefined = members.find((m) => m.userId === senderId);
      return p?.displayName ?? p?.phone ?? 'عضو';
    },
    [isGroup, members],
  );

  // ————— گام ۳: حضور + تایپینگ + رسید خواندن —————
  const peerId = conversation.peer?.userId ?? null;
  const [peerPresence, setPeerPresence] = useState<PresenceDto | null>(null);
  const [typingName, setTypingName] = useState<string | null>(null);
  /** بیشترین lastReadSeq سایر اعضا (در گروه: هر عضوی؛ در direct: طرف مقابل) */
  const [maxOtherLastRead, setMaxOtherLastRead] = useState<number>(conversation.peer?.lastReadSeq ?? 0);
  const typingHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);
  const messagesRef = useRef<LocalMsg[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // ————— گام ۸: رمزنگاری سرتاسری چت خصوصی —————
  const [e2eeOn, setE2eeOn] = useState(false);

  // ————— گام ۱۰: مسدودسازی و گزارش کاربر —————
  const [blockedPeer, setBlockedPeer] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [reportReason, setReportReason] = useState<'spam' | 'abuse' | 'impersonation' | 'other'>('spam');
  const [reportNote, setReportNote] = useState('');

  useEffect(() => {
    if (isGroup || !peerId) {
      setBlockedPeer(false);
      return;
    }
    void api
      .listBlocks(accessToken)
      .then((r) => setBlockedPeer(r.items.some((b) => b.userId === peerId)))
      .catch(() => {});
  }, [accessToken, isGroup, peerId]);

  const toggleBlockPeer = useCallback(async () => {
    if (!peerId) return;
    try {
      if (blockedPeer) {
        await api.unblockUser(accessToken, peerId);
        setBlockedPeer(false);
        Alert.alert('رفع مسدودسازی', 'گفتگوی مستقیم دوباره آزاد شد.');
      } else {
        await api.blockUser(accessToken, peerId);
        setBlockedPeer(true);
        Alert.alert('مسدودسازی', 'گفتگوی مستقیم دوطرفه بسته شد.');
      }
    } catch (e) {
      Alert.alert('خطا', e instanceof ApiError ? e.message : 'عملیات انجام نشد');
    }
  }, [accessToken, blockedPeer, peerId]);

  const sendReport = useCallback(async () => {
    if (!peerId) return;
    try {
      await api.reportUser(accessToken, peerId, {
        reason: reportReason,
        note: reportNote.trim() || undefined,
      });
      setReportVisible(false);
      setReportNote('');
      Alert.alert('گزارش ثبت شد', 'گزارش شما به صف رسیدگی مدیران رفت. سپاس از همکاری شما.');
    } catch (e) {
      Alert.alert('خطا', e instanceof ApiError ? e.message : 'ارسال گزارش انجام نشد');
    }
  }, [accessToken, peerId, reportNote, reportReason]);

  const openPeerMenu = useCallback(() => {
    const peerName = conversation.peer?.displayName ?? conversation.peer?.phone ?? 'کاربر';
    Alert.alert(
      peerName,
      blockedPeer ? 'این کاربر مسدود است.' : 'گزینه‌های گفتگوی خصوصی',
      [
        {
          text: blockedPeer ? 'رفع مسدودسازی' : 'مسدودسازی کاربر',
          style: blockedPeer ? 'default' : 'destructive',
          onPress: () => void toggleBlockPeer(),
        },
        { text: 'گزارش تخلف', onPress: () => setReportVisible(true) },
        { text: 'انصراف', style: 'cancel' },
      ],
    );
  }, [blockedPeer, conversation.peer, toggleBlockPeer]);

  /** دکمه‌های تماس در همهٔ چت‌ها — گروه فعلاً پشتیبانی نمی‌شود و پیام شفاف می‌دهد */
  const requestCall = useCallback(
    (kind: 'audio' | 'video') => {
      if (isGroup) {
        Alert.alert('تماس', 'فعلاً تماس صوتی/تصویری فقط در گفتگوهای دو\u200cنفره ممکن است.');
        return;
      }
      onRequestCall?.(conversation, kind);
    },
    [isGroup, onRequestCall, conversation],
  );

  // ————— گام ۹: هوش مصنوعی (ترجمه/پیشنهاد/خلاصه با رضایت opt-in) —————
  const [aiBusy, setAiBusy] = useState(false);
  const [aiChips, setAiChips] = useState<string[]>([]);
  const [aiResult, setAiResult] = useState<{ title: string; text: string } | null>(null);

  /** پیام E2EE → متن؛ اگر این دستگاه گیرنده نبود/کلید نبود → placeholder */
  const tryDecrypt = useCallback(
    async (m: MessageDto): Promise<LocalMsg> => {
      if (!m.isE2ee) return m;
      try {
        const r = await decryptDirect(accessToken, m.conversationId, m.senderId, m.body);
        if (r.ok) return { ...m, body: r.text };
      } catch {
        // پایین‌تر placeholder
      }
      return {
        ...m,
        body:
          m.senderId === myUserId
            ? '\ud83d\udd12 پیام شما از دستگاه دیگر — در این دستگاه باز نمی\u200cشود'
            : '\ud83d\udd12 پیام رمزنگاری\u200cشده — در این دستگاه باز نمی\u200cشود',
      };
    },
    [accessToken, myUserId],
  );

  // فعال‌سازی E2EE وقتی هر دو طرف هویت دارند — فقط direct
  useEffect(() => {
    if (isGroup || !peerId) return;
    let cancelled = false;
    (async () => {
      if (!e2eeReady()) return;
      const ok = await peerSupportsE2ee(accessToken, peerId);
      if (!cancelled && ok) setE2eeOn(true);
      void topUpOtksIfNeeded(accessToken);
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, peerId, isGroup]);

  const convId = conversation.id;

  // ————— کش آفلاین — هر تغییر پیام‌ها (با تأخیر) روی دیسک ذخیره می‌شود —————
  useEffect(() => {
    const t = setTimeout(() => {
      void saveMessages(convId, messagesRef.current);
    }, 800);
    return () => clearTimeout(t);
  }, [messages, convId]);

  /** افزودن/به‌روزرسانی پیام با dedupe روی clientMsgId */
  const upsert = useCallback((msg: LocalMsg) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.clientMsgId === msg.clientMsgId);
      if (idx === -1) return [...prev, msg];
      const next = [...prev];
      next[idx] = msg;
      return next;
    });
  }, []);

  // بارگذاری تاریخچه + اتصال به رویداد زنده
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // ۱) نمایش فوری از کش آفلاین — حتی با اینترنت قطع
      const cached = await loadMessages(convId);
      if (!cancelled && cached && messagesRef.current.length === 0) {
        setMessages(cached as LocalMsg[]);
      }
      // ۲) تازه‌سازی از سرور — پیام‌های رمز به ترتیب صعودی باز می‌شوند (ratchet ترتیب‌مند است)
      try {
        const page = await api.getMessages(accessToken, convId);
        if (cancelled) return;
        // پیام‌های رمز به ترتیب صعودی باز می‌شوند (ratchet ترتیب‌مند است)
        const decrypted: LocalMsg[] = [];
        for (const m of page.messages) decrypted.push(await tryDecrypt(m));
        setMessages(decrypted);
        setHasMore(page.hasMore);
        const latest = page.messages[page.messages.length - 1];
        if (latest) void api.markRead(accessToken, convId, latest.serverSeq).catch(() => undefined);
      } catch {
        // نمایش خطا در گام‌های بعد
      }
      // گروه: جزئیات کامل (اعضا/نقش‌ها) برای نام فرستنده‌ها
      if (isGroup) {
        try {
          const detail = await api.getConversation(accessToken, convId);
          if (!cancelled) {
            setGroupDetail(detail);
            const otherMax = (detail.participants ?? [])
              .filter((p) => p.userId !== myUserId)
              .reduce((mx, p) => Math.max(mx, p.lastReadSeq), 0);
            setMaxOtherLastRead((prev) => Math.max(prev, otherMax));
          }
        } catch {
          // ignore
        }
      }
    })();

    const s = getSocket();
    // عضویت در اتاق — برای مکالمه‌های ساخته‌شده پس از اتصال socket
    s?.emit('conversation.join', { conversationId: convId });

    // حضور اولیه طرف مقابل
    if (peerId) {
      void api
        .getPresence(accessToken, peerId)
        .then((p) => {
          if (!cancelled) setPeerPresence(p);
        })
        .catch(() => undefined);
    }

    const onNew = (payload: WsMessageNew) => {
      if (payload.conversationId !== convId) return;
      void (async () => {
        // پیام خودِ این دستگاه (echo) — متن موضعی حفظ می‌شود
        const known = messagesRef.current.find((m) => m.clientMsgId === payload.message.clientMsgId);
        if (known) {
          upsert({ ...payload.message, body: known.body, status: 'sent' });
        } else if (payload.message.isE2ee) {
          upsert(await tryDecrypt(payload.message));
        } else {
          upsert(payload.message);
        }
        void api.markRead(accessToken, convId, payload.message.serverSeq).catch(() => undefined);
      })();
    };
    const onPresence = (p: WsPresenceUpdate) => {
      if (p.userId !== peerId) return;
      setPeerPresence({ userId: p.userId, online: p.online, lastSeen: p.lastSeen });
    };
    const onTyping = (t: WsTyping) => {
      if (t.conversationId !== convId || t.userId === myUserId) return;
      if (!isGroup && t.userId !== peerId) return;
      setTypingName(isGroup ? senderName(t.userId) : '');
      if (typingHideTimer.current) clearTimeout(typingHideTimer.current);
      typingHideTimer.current = setTimeout(() => setTypingName(null), 4000);
    };
    const onRead = (r: WsMessageRead) => {
      if (r.conversationId !== convId || r.userId === myUserId) return;
      setMaxOtherLastRead((prev) => Math.max(prev, r.lastReadSeq));
    };
    const onMemberRemoved = (p: WsMemberRemoved) => {
      if (p.conversationId !== convId) return;
      if (p.userId === myUserId) {
        // حذف/خروج از همین گروه — به لیست برمی‌گردیم
        onBack();
        return;
      }
      // جزئیات گروه تازه شود (تعداد اعضا)
      if (isGroup) {
        void api
          .getConversation(accessToken, convId)
          .then(setGroupDetail)
          .catch(() => undefined);
      }
    };
    const onReconnect = () => {
      // بعد از اتصال مجدد: عضویت مجدد در اتاق + همگام‌سازی پیام‌های از دست رفته + حضور تازه
      s?.emit('conversation.join', { conversationId: convId });
      const realSeqs = messagesRef.current
        .filter((m) => m.serverSeq < Number.MAX_SAFE_INTEGER)
        .map((m) => m.serverSeq);
      const maxSeq = realSeqs.length ? Math.max(...realSeqs) : 0;
      if (maxSeq > 0) {
        void api
          .getMessages(accessToken, convId, undefined, maxSeq)
          .then(async (page) => {
            if (cancelled || !page.messages.length) return;
            for (const m of page.messages) {
              const known = messagesRef.current.some((x) => x.clientMsgId === m.clientMsgId);
              if (known) continue;
              upsert(m.isE2ee ? await tryDecrypt(m) : m);
            }
            const latest = page.messages[page.messages.length - 1];
            if (latest) {
              void api.markRead(accessToken, convId, latest.serverSeq).catch(() => undefined);
            }
          })
          .catch(() => undefined);
      }
      if (peerId) {
        void api
          .getPresence(accessToken, peerId)
          .then(setPeerPresence)
          .catch(() => undefined);
      }
    };

    s?.on('message.new', onNew);
    s?.on('presence.update', onPresence);
    s?.on('typing', onTyping);
    s?.on('message.read', onRead);
    s?.on('member.removed', onMemberRemoved);
    s?.on('connect', onReconnect);
    return () => {
      cancelled = true;
      if (typingHideTimer.current) clearTimeout(typingHideTimer.current);
      s?.off('message.new', onNew);
      s?.off('presence.update', onPresence);
      s?.off('typing', onTyping);
      s?.off('message.read', onRead);
      s?.off('member.removed', onMemberRemoved);
      s?.off('connect', onReconnect);
    };
  }, [accessToken, convId, peerId, upsert, isGroup, myUserId, senderName, tryDecrypt]);

  /** ارسال پیام رسانه‌ای — آپلود مستقیم به S3 سپس پیام با mediaId */
  const sendMedia = useCallback(async () => {
    if (uploading) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('دسترسی لازم است', 'برای ارسال عکس، دسترسی گالری را تأیید کنید.');
        return;
      }
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.8,
        allowsMultipleSelection: false,
      });
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      const mime = asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
      const name = asset.fileName ?? `del-${Date.now()}.${mime.split('/')[1] ?? 'bin'}`;

      setUploading(true);
      const clientMsgId = uuid();
      // حباب موقت تا پایان آپلود
      upsert({
        id: clientMsgId,
        conversationId: convId,
        senderId: myUserId,
        serverSeq: Number.MAX_SAFE_INTEGER,
        clientMsgId,
        type: 'image',
        body: '',
        media: null,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
        status: 'sending',
        pendingLabel: asset.type === 'video' ? 'در حال ارسال ویدیو…' : 'در حال ارسال عکس…',
      });

      try {
        const media = await uploadMedia(accessToken, convId, {
          uri: asset.uri,
          mime,
          size: asset.fileSize ?? 0,
          name,
          width: asset.width,
          height: asset.height,
        });
        const caption = draft.trim();
        setDraft('');
        const s = getSocket();
        if (s?.connected) {
          s.timeout(15000).emit(
            'message.send',
            { conversationId: convId, clientMsgId, mediaId: media.id, ...(caption ? { body: caption } : {}) },
            (err: unknown, ack?: { ok: boolean; message?: MessageDto }) => {
              if (!err && ack?.ok && ack.message) {
                upsert({ ...ack.message, status: 'sent' });
              } else {
                upsert({ ...optimisticFail(clientMsgId, convId, myUserId) });
              }
            },
          );
        } else {
          const r = await api.sendMessageRest(accessToken, convId, clientMsgId, caption || undefined, media.id);
          upsert({ ...r.message, status: 'sent' });
        }
      } catch {
        upsert({
          id: clientMsgId,
          conversationId: convId,
          senderId: myUserId,
          serverSeq: Number.MAX_SAFE_INTEGER,
          clientMsgId,
          type: 'image',
          body: '',
          media: null,
          createdAt: new Date().toISOString(),
          editedAt: null,
          deletedAt: null,
          status: 'failed',
        });
        Alert.alert('خطا', 'آپلود فایل ناموفق بود.');
      }
    } finally {
      setUploading(false);
    }
  }, [uploading, accessToken, convId, myUserId, draft, upsert]);

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body) return;
    const clientMsgId = uuid();
    const optimistic: LocalMsg = {
      id: clientMsgId,
      conversationId: convId,
      senderId: myUserId,
      serverSeq: Number.MAX_SAFE_INTEGER,
      clientMsgId,
      type: 'text',
      body,
      isE2ee: e2eeOn,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
      status: 'sending',
    };
    upsert(optimistic);
    setDraft('');

    // گام ۸: چت خصوصی با هویت هر دو طرف ← پاکت multi-device رمز می‌شود
    if (!isGroup && e2eeOn && peerId) {
      try {
        const envelope = await encryptDirect(accessToken, convId, peerId, body);
        const s = getSocket();
        if (s?.connected) {
          s.timeout(15000).emit(
            'message.send',
            { conversationId: convId, clientMsgId, body: envelope, isE2ee: true },
            (err: unknown, ack?: { ok: boolean; message?: MessageDto }) => {
              if (!err && ack?.ok && ack.message) {
                // متن موضعی حفظ می‌شود — body پاکت رمز است
                upsert({ ...ack.message, body, isE2ee: true, status: 'sent' });
              } else {
                void (async () => {
                  try {
                    const r = await api.sendMessageRest(accessToken, convId, clientMsgId, envelope, undefined, true);
                    upsert({ ...r.message, body, isE2ee: true, status: 'sent' });
                  } catch {
                    upsert({ ...optimistic, status: 'failed' });
                  }
                })();
              }
            },
          );
        } else {
          const r = await api.sendMessageRest(accessToken, convId, clientMsgId, envelope, undefined, true);
          upsert({ ...r.message, body, isE2ee: true, status: 'sent' });
        }
      } catch {
        upsert({ ...optimistic, status: 'failed' });
        Alert.alert('خطا', 'رمزگذاری پیام ناموفق بود — دوباره تلاش کنید.');
      }
      return;
    }

    // تلاش مسیر WS با fallback به REST
    const s = getSocket();
    if (s?.connected) {
      s.timeout(8000).emit(
        'message.send',
        { conversationId: convId, clientMsgId, body },
        (err: unknown, ack?: { ok: boolean; message?: MessageDto }) => {
          if (!err && ack?.ok && ack.message) {
            upsert({ ...ack.message, status: 'sent' });
          } else {
            upsert({ ...optimistic, status: 'failed' });
          }
        },
      );
    } else {
      try {
        const r = await api.sendMessageRest(accessToken, convId, clientMsgId, body);
        upsert({ ...r.message, status: 'sent' });
      } catch {
        upsert({ ...optimistic, status: 'failed' });
      }
    }
  }, [draft, convId, myUserId, accessToken, upsert, isGroup, e2eeOn, peerId]);

  const loadOlder = useCallback(async () => {
    const first = messages[0];
    if (!first || first.serverSeq === Number.MAX_SAFE_INTEGER) return;
    try {
      const page = await api.getMessages(accessToken, convId, first.serverSeq);
      setMessages((prev) => [...page.messages, ...prev]);
      setHasMore(page.hasMore);
    } catch {
      // ignore
    }
  }, [messages, accessToken, convId]);

  const onChangeDraft = useCallback(
    (text: string) => {
      setDraft(text);
      // throttle کلاینت: حداکثر هر ۲٫۵ ثانیه یک رویداد typing
      const now = Date.now();
      if (text.trim() && now - lastTypingSent.current > 2500) {
        lastTypingSent.current = now;
        getSocket()?.emit('typing', { conversationId: convId });
      }
    },
    [convId],
  );

  // ————— گام ۹: هندلرهای هوش مصنوعی —————

  /** در 403 رضایت: پرسش فعال‌سازی و تلاش دوباره */
  const ensureAiConsent = useCallback(
    async (retry: () => Promise<void>) => {
      Alert.alert(
        'هوش مصنوعی',
        'برای قابلیت‌های هوشمند باید رضایت دهید. محتوای گفتگو فقط با رضایت شما به سرویس هوش مصنوعی ارسال می‌شود؛ پیام‌های رمزنگاری‌شده هرگز استفاده نمی‌شوند. فعال شود؟',
        [
          { text: 'نه', style: 'cancel' },
          {
            text: 'فعال می‌کنم',
            onPress: () => {
              void (async () => {
                try {
                  await api.setAiConsent(accessToken, true);
                  await retry();
                } catch {
                  Alert.alert('خطا', 'فعال‌سازی رضایت ناموفق بود.');
                }
              })();
            },
          },
        ],
      );
    },
    [accessToken],
  );

  const runAi = useCallback(
    async (fn: () => Promise<void>) => {
      setAiBusy(true);
      try {
        await fn();
      } catch (e) {
        const err = e as { code?: string; message?: string };
        if (err?.code === 'AI_CONSENT_REQUIRED') {
          await ensureAiConsent(fn);
        } else {
          Alert.alert('هوش مصنوعی', err?.message ?? 'خطای ناشناخته');
        }
      } finally {
        setAiBusy(false);
      }
    },
    [ensureAiConsent],
  );

  /** ترجمه — با نگه‌داشتن روی پیام طرف مقابل (غیررمز) */
  const translateMessage = useCallback(
    (m: LocalMsg) => {
      if (m.isE2ee) {
        Alert.alert(
          'ترجمه ممکن نیست',
          'پیام‌های رمزنگاری‌شدهٔ سرتاسری قابل ترجمه نیستند — سرور محتوایشان را نمی‌فهمد.',
        );
        return;
      }
      void runAi(async () => {
        const r = await api.aiTranslate(accessToken, m.id);
        setAiResult({ title: 'ترجمه', text: r.text });
      });
    },
    [accessToken, runAi],
  );

  const runSuggest = useCallback(() => {
    void runAi(async () => {
      const r = await api.aiSuggest(accessToken, convId, 3);
      setAiChips(r.text.split('\n').filter((l) => l.trim()));
    });
  }, [accessToken, convId, runAi]);

  const runSummary = useCallback(() => {
    void runAi(async () => {
      const r = await api.aiSummarize(accessToken, convId, { limit: 20 });
      setAiResult({ title: 'خلاصهٔ گفتگو', text: r.text });
    });
  }, [accessToken, convId, runAi]);

  const body = (
    // padding روی اندروید هم لازم است — edge-to-edge (SDK 35) پنجره را resize نمی‌کند
    // و کیبورد روی کادر تایپ می‌افتد (باگ اسکرین‌شات)
    <KeyboardAvoidingView
      style={[styles.root, wallSrc ? { backgroundColor: 'transparent' } : null]}
      behavior="padding"
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>‹ بازگشت</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerName} numberOfLines={1}>
            {e2eeOn && !isGroup ? '\ud83d\udd12 ' : ''}
            {isGroup
              ? conversation.title ?? groupDetail?.title ?? 'گروه'
              : conversation.peer?.displayName ?? conversation.peer?.phone ?? 'گفتگو'}
          </Text>
          <Text
            style={[styles.headerStatus, typingName !== null ? styles.headerTyping : null]}
            numberOfLines={1}
          >
            {typingName !== null
              ? isGroup
                ? `${typingName} در حال نوشتن…`
                : 'در حال نوشتن…'
              : isGroup
                ? `${faNum(memberCount)} عضو${groupDetail?.myRole === 'admin' ? ' · شما ادمین هستید' : ''}`
                : peerPresence?.online
                  ? e2eeOn
                    ? 'آنلاین · رمزنگاری سرتاسری فعال'
                    : 'آنلاین'
                  : e2eeOn
                    ? 'رمزنگاری سرتاسری فعال'
                    : peerPresence?.lastSeen
                      ? `آخرین بازدید ${faRelative(peerPresence.lastSeen)}`
                      : ' '}
          </Text>
        </View>
        {/* دکمه‌های تماس در همهٔ گفتگوها + ⏲ محوشونده + منو در ۱:۱ */}
        <View style={styles.callBtns}>
          <TouchableOpacity
            style={styles.callBtn}
            onPress={() => requestCall('audio')}
            accessibilityLabel="تماس صوتی"
          >
            <Text style={styles.callBtnIcon}>📞</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.callBtn}
            onPress={() => requestCall('video')}
            accessibilityLabel="تماس تصویری"
          >
            <Text style={styles.callBtnIcon}>🎥</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.callBtn}
            onPress={() => setDisappearDialog(true)}
            accessibilityLabel="پیام محوشونده"
          >
            <Text style={[styles.callBtnIcon, disappearSec > 0 ? styles.disappearOn : null]}>
              ⏲
            </Text>
          </TouchableOpacity>
          {!isGroup ? (
            <TouchableOpacity
              style={styles.callBtn}
              onPress={openPeerMenu}
              accessibilityLabel="گزینه‌های گفتگو"
            >
              <Text style={styles.callBtnIcon}>⋯</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {hasMore ? (
        <TouchableOpacity onPress={loadOlder}>
          <Text style={styles.loadOlder}>بارگذاری پیام‌های قدیمی‌تر…</Text>
        </TouchableOpacity>
      ) : null}

      <FlatList
        ref={listRef}
        data={[...messages].sort((a, b) =>
          a.serverSeq === b.serverSeq ? 0 : a.serverSeq - b.serverSeq,
        )}
        keyExtractor={(m) => m.clientMsgId}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const mine = item.senderId === myUserId;
          const read = mine && item.serverSeq <= maxOtherLastRead;
          const from = mine ? '' : senderName(item.senderId);
          // گام ۹: نگه‌داشتن روی پیام طرف مقابل (متنی، غیررمز) → ترجمه
          const aiAble = !mine && Boolean(item.body) && !item.isE2ee;
          const BubbleView: React.ElementType = aiAble ? TouchableOpacity : View;
          return (
            <View style={[styles.bubbleRow, mine ? { justifyContent: 'flex-start' } : { justifyContent: 'flex-end' }]}>
              <BubbleView
                style={[styles.bubble, mine ? styles.bubbleMine : styles.bubblePeer]}
                activeOpacity={0.85}
                onLongPress={aiAble ? () => translateMessage(item) : undefined}
              >
                {from ? <Text style={styles.senderName}>{from}</Text> : null}
                {item.media ? (
                  <MediaBubble token={accessToken} media={item.media} mine={mine} />
                ) : null}
                {item.body ? (
                  <Text style={mine ? styles.bubbleTextMine : styles.bubbleTextPeer}>
                    {item.body}
                  </Text>
                ) : null}
                {aiAble ? <Text style={styles.aiHint}>نگه‌دارید: ترجمه ✨</Text> : null}
                {mine && item.status === 'sending' ? (
                  <Text style={styles.status}>{item.pendingLabel ?? '… در حال ارسال'}</Text>
                ) : null}
                {mine && item.status === 'failed' ? <Text style={styles.statusFailed}>✗ ارسال نشد</Text> : null}
                {mine && item.status === 'sent' ? (
                  <Text style={styles.ticks}>{read ? '✓✓' : '✓'}</Text>
                ) : null}
              </BubbleView>
            </View>
          );
        }}
      />

      {/* گام ۹: هوش مصنوعی — چیپ‌های پیشنهاد یا نوار دکمه‌ها */}
      {aiChips.length > 0 ? (
        <View style={styles.aiChipsWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.aiChipsInner}>
            {aiChips.map((c, i) => (
              <TouchableOpacity
                key={String(i)}
                style={styles.aiChip}
                onPress={() => {
                  setDraft(c.replace(/^پیشنهاد \d+[^:]*: /, '').trim());
                  setAiChips([]);
                }}
              >
                <Text style={styles.aiChipText} numberOfLines={1}>
                  {c}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.aiChipClose} onPress={() => setAiChips([])}>
              <Text style={styles.aiChipText}>✕</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      ) : (
        <View style={styles.aiBar}>
          <TouchableOpacity style={styles.aiBtn} onPress={runSuggest} disabled={aiBusy}>
            <Text style={styles.aiBtnText}>{aiBusy ? '… در حال اجرا' : '✨ پیشنهاد پاسخ'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.aiBtn} onPress={runSummary} disabled={aiBusy}>
            <Text style={styles.aiBtnText}>🧾 خلاصهٔ گفتگو</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* گام ۹: نتیجهٔ ترجمه/خلاصه */}
      <Modal
        visible={aiResult !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setAiResult(null)}
      >
        <View style={styles.aiModalBackdrop}>
          <View style={styles.aiModalCard}>
            <Text style={styles.aiModalTitle}>{aiResult?.title}</Text>
            <ScrollView style={styles.aiModalBody}>
              <Text style={styles.aiModalText}>{aiResult?.text}</Text>
            </ScrollView>
            <TouchableOpacity style={styles.aiModalClose} onPress={() => setAiResult(null)}>
              <Text style={styles.aiModalCloseText}>بستن</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {blockedPeer ? (
        <View style={styles.blockBanner}>
          <Text style={styles.blockBannerText}>شما این کاربر را مسدود کرده‌اید — گفتگوی مستقیم بسته است</Text>
          <TouchableOpacity onPress={() => void toggleBlockPeer()}>
            <Text style={styles.blockBannerBtn}>رفع مسدودی</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* گام ۱۰: مودال گزارش تخلف */}
      <Modal
        visible={reportVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setReportVisible(false)}
      >
        <View style={styles.aiModalBackdrop}>
          <View style={styles.aiModalCard}>
            <Text style={styles.aiModalTitle}>گزارش تخلف</Text>
            <View style={styles.reportReasons}>
              {(
                [
                  ['spam', 'هرزنامه'],
                  ['abuse', 'آزار و اذیت'],
                  ['impersonation', 'جعل هویت'],
                  ['other', 'سایر'],
                ] as const
              ).map(([value, label]) => (
                <TouchableOpacity
                  key={value}
                  style={[styles.reportChip, reportReason === value ? styles.reportChipOn : null]}
                  onPress={() => setReportReason(value)}
                >
                  <Text style={reportReason === value ? styles.reportChipTextOn : styles.reportChipText}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              value={reportNote}
              onChangeText={setReportNote}
              placeholder="توضیح (اختیاری)"
              placeholderTextColor={theme.textDim}
              style={styles.reportNoteInput}
              multiline
              maxLength={1000}
            />
            <TouchableOpacity style={styles.aiModalClose} onPress={() => void sendReport()}>
              <Text style={styles.aiModalCloseText}>ارسال گزارش</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setReportVisible(false)}>
              <Text style={styles.reportCancelText}>انصراف</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <View style={styles.composer}>
        <TouchableOpacity
          style={styles.attachBtn}
          onPress={sendMedia}
          disabled={uploading}
          accessibilityLabel="ارسال عکس یا ویدیو"
        >
          <Text style={styles.attachIcon}>{uploading ? '…' : '📎'}</Text>
        </TouchableOpacity>
        <TextInput
          value={draft}
          onChangeText={onChangeDraft}
          placeholder="پیام…"
          placeholderTextColor={theme.textDim}
          style={styles.input}
          multiline
          onSubmitEditing={send}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={send} disabled={!draft.trim()}>
          <Text style={styles.sendText}>ارسال</Text>
        </TouchableOpacity>
      </View>

      {/* ————— v1.4: گفتگوی پیام محوشونده ————— */}
      <Modal visible={disappearDialog} transparent animationType="fade">
        <View style={styles.disappearBackdrop}>
          <View style={styles.disappearCard}>
            <Text style={styles.disappearTitle}>پیام‌های محوشونده</Text>
            <Text style={styles.disappearSub}>
              پیام‌های جدید بعد از مدت انتخابی به‌طور خودکار از سرور و دستگاه‌ها پاک می‌شوند.
            </Text>
            {[
              { v: 0, label: 'خاموش' },
              { v: 3600, label: '۱ ساعت' },
              { v: 86400, label: '۲۴ ساعت' },
              { v: 604800, label: '۷ روز' },
              { v: 2592000, label: '۳۰ روز' },
            ].map((o) => (
              <TouchableOpacity
                key={o.v}
                style={[styles.disappearOption, disappearSec === o.v && styles.disappearOptionOn]}
                onPress={() => {
                  const next = o.v;
                  setDisappearSec(next);
                  setDisappearDialog(false);
                  if (next !== disappearSec) {
                    api
                      .setDisappear(accessToken, conversation.id, next)
                      .then(() => undefined)
                      .catch(() => undefined);
                  }
                }}
              >
                <Text
                  style={[
                    styles.disappearOptionText,
                    disappearSec === o.v && styles.disappearOptionTextOn,
                  ]}
                >
                  {o.label}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.disappearCancel}
              onPress={() => setDisappearDialog(false)}
            >
              <Text style={styles.disappearCancelText}>بستن</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );

  if (!wallSrc) return body;
  return (
    <ImageBackground source={wallSrc} style={styles.root} imageStyle={styles.wallImage}>
      {body}
    </ImageBackground>
  );
}

const makeStyles = (theme: DelTheme) =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  wallImage: { opacity: theme.dark ? 0.16 : 0.35 },
  disappearOn: { color: theme.accent },
  disappearBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  disappearCard: { width: '100%', maxWidth: 360, backgroundColor: theme.surfaceAlt, borderColor: theme.border, borderWidth: 1, borderRadius: theme.radius, padding: 18 },
  disappearTitle: { color: theme.text, fontSize: fs(17), fontWeight: '800', textAlign: 'right' },
  disappearSub: { color: theme.textDim, fontSize: fs(13), lineHeight: fs(20), textAlign: 'right', marginTop: 6 },
  disappearOption: { borderWidth: 1, borderColor: theme.border, borderRadius: theme.radius, paddingVertical: 11, alignItems: 'center', marginTop: 10 },
  disappearOptionOn: { borderColor: theme.accent, backgroundColor: theme.accentSoft },
  disappearOptionText: { color: theme.textDim, fontSize: fs(15), fontWeight: '700' },
  disappearOptionTextOn: { color: theme.accent },
  disappearCancel: { alignItems: 'center', marginTop: 14, padding: 8 },
  disappearCancelText: { color: theme.textDim, fontSize: fs(14) },
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  back: { color: theme.accent, fontSize: 15, padding: 8 },
  headerCenter: { flex: 1, alignItems: 'center' },
  callBtns: { flexDirection: 'row', gap: 6 },
  callBtn: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  callBtnIcon: { fontSize: 16 },
  headerName: { color: theme.text, fontSize: 17, fontWeight: '800' },
  headerStatus: { color: theme.textDim, fontSize: 12, marginTop: 2 },
  headerTyping: { color: theme.accent },
  loadOlder: { color: theme.accent, textAlign: 'center', paddingVertical: 10, fontSize: 13 },
  list: { padding: 12, flexGrow: 1, justifyContent: 'flex-end' },
  bubbleRow: { flexDirection: 'row', marginTop: 6 },
  bubble: {
    maxWidth: '78%',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  bubbleMine: {
    backgroundColor: theme.accentStrong,
    borderTopRightRadius: 4,
  },
  bubblePeer: {
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.border,
    borderTopLeftRadius: 4,
  },
  // متن هر حباب از پالت تم می‌آید — ثابتِ روشن روی حبابِ روشن، متن دریافتی را ناخوانا می‌کرد
  bubbleTextMine: { color: theme.bubbleMeText, fontSize: fs(16), lineHeight: fs(24), textAlign: 'right' },
  bubbleTextPeer: { color: theme.text, fontSize: fs(16), lineHeight: fs(24), textAlign: 'right' },
  senderName: { color: theme.accent, fontSize: fs(12), fontWeight: '700', marginBottom: 2, textAlign: 'right' },
  status: { color: theme.dark ? 'rgba(234,246,255,0.65)' : 'rgba(4,18,31,0.55)', fontSize: fs(11), marginTop: 2, textAlign: 'left' },
  statusFailed: { color: theme.danger, fontSize: fs(11), marginTop: 2, textAlign: 'left', fontWeight: '700' },
  ticks: { color: theme.dark ? 'rgba(234,246,255,0.7)' : 'rgba(4,18,31,0.6)', fontSize: fs(11), marginTop: 2, textAlign: 'left', fontWeight: '700' },
  // ————— گام ۹: هوش مصنوعی —————
  aiHint: { color: theme.textDim, fontSize: 10, marginTop: 3, textAlign: 'left' },
  aiBar: {
    flexDirection: 'row-reverse',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  aiBtn: {
    flex: 1,
    backgroundColor: theme.surface,
    borderColor: theme.accent,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 8,
    alignItems: 'center',
  },
  aiBtnText: { color: theme.accent, fontSize: 13, fontWeight: '700' },
  aiChipsWrap: { paddingVertical: 6, paddingHorizontal: 10 },
  aiChipsInner: { flexDirection: 'row-reverse', gap: 8, alignItems: 'center' },
  aiChip: {
    backgroundColor: theme.surface,
    borderColor: theme.accent,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    maxWidth: 220,
  },
  aiChipClose: {
    backgroundColor: 'transparent',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  aiChipText: { color: theme.accent, fontSize: 13 },
  aiModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,10,18,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  aiModalCard: {
    width: '100%',
    maxHeight: '78%',
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
  },
  aiModalTitle: { color: theme.accent, fontSize: 16, fontWeight: '800', marginBottom: 10, textAlign: 'right' },
  aiModalBody: { flexGrow: 0 },
  aiModalText: { color: theme.text, fontSize: 15, lineHeight: 24, textAlign: 'right' },
  aiModalClose: {
    marginTop: 14,
    backgroundColor: theme.accentStrong,
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: 'center',
  },
  aiModalCloseText: { color: '#04121F', fontWeight: '800' },
  // ————— گام ۱۰ —————
  blockBanner: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FDECEC',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  blockBannerText: { color: '#C0392B', fontSize: 12, fontWeight: '700', flex: 1, textAlign: 'right' },
  blockBannerBtn: { color: '#1462B8', fontSize: 12, fontWeight: '800', paddingHorizontal: 8 },
  reportReasons: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  reportChip: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  reportChipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  reportChipText: { color: theme.text, fontSize: 12 },
  reportChipTextOn: { color: '#04121F', fontSize: 12, fontWeight: '700' },
  reportNoteInput: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    color: theme.text,
    padding: 8,
    minHeight: 60,
    textAlignVertical: 'top',
    marginBottom: 10,
    textAlign: 'right',
  },
  reportCancelText: { color: theme.textDim, fontSize: 13, marginTop: 8, textAlign: 'center' },
  composer: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-end',
    padding: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  attachBtn: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  attachIcon: { fontSize: 18 },
  mediaImage: {
    width: 220,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  mediaPlaceholder: { aspectRatio: 4 / 3 },
  mediaFallback: { color: theme.textDim, fontSize: 13, paddingVertical: 8 },
  attachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 10,
    padding: 8,
    minWidth: 160,
  },
  attachRowIcon: { fontSize: 22 },
  attachRowText: { flexShrink: 1 },
  attachRowName: { color: '#EAF6FF', fontSize: 13, fontWeight: '700' },
  attachRowSize: { color: theme.textDim, fontSize: 11, marginTop: 2 },
  input: {
    flex: 1,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 20,
    color: theme.text,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    maxHeight: 120,
    textAlign: 'right',
  },
  sendBtn: {
    backgroundColor: theme.accentStrong,
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  sendText: { color: '#04121F', fontWeight: '800', fontSize: 15 },
});

/** «۵ دقیقه پیش» — نمایش نسبی فارسی */
function faRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.max(0, Math.floor(diff / 60000));
  const fa = (n: number) => String(n).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);
  if (min < 1) return 'همین حالا';
  if (min < 60) return `${fa(min)} دقیقه پیش`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${fa(h)} ساعت پیش`;
  const d = Math.floor(h / 24);
  return `${fa(d)} روز پیش`;
}

/** عدد فارسی */
function faNum(n: number): string {
  return String(n).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);
}

// ————— گام ۵: حباب رسانه — تصویر درون‌خطی، ویدیو/فایل ردیف پیوست —————

function MediaBubble({
  token,
  media,
  mine,
}: {
  token: string;
  media: MediaAssetDto;
  mine: boolean;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (media.kind === 'image') {
      setFailed(false);
      getSignedUrl(token, media.id, 'original')
        .then((u) => {
          if (!cancelled) setUrl(u);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [token, media.id, media.kind]);

  const openOriginal = useCallback(async () => {
    try {
      const u = await getSignedUrl(token, media.id, 'original');
      await Linking.openURL(u);
    } catch {
      // بی‌صدا — URL شاید منقضی شده باشد
    }
  }, [token, media.id]);

  if (media.kind === 'image') {
    if (failed) {
      return <Text style={styles.mediaFallback}>نمایش عکس ممکن نشد</Text>;
    }
    if (!url) {
      return <View style={[styles.mediaImage, styles.mediaPlaceholder]} />;
    }
    const ratio = media.width && media.height ? media.width / media.height : 4 / 3;
    return (
      <TouchableOpacity activeOpacity={0.9} onPress={openOriginal}>
        <Image
          source={{ uri: url }}
          style={[styles.mediaImage, { aspectRatio: ratio }]}
          resizeMode="cover"
        />
      </TouchableOpacity>
    );
  }

  // ویدیو / صوت / فایل — ردیف پیوست با نام و اندازه
  const icon = media.kind === 'video' ? '🎬' : media.kind === 'audio' ? '🎵' : '📄';
  return (
    <TouchableOpacity style={styles.attachRow} onPress={openOriginal} activeOpacity={0.8}>
      <Text style={styles.attachRowIcon}>{icon}</Text>
      <View style={styles.attachRowText}>
        <Text style={styles.attachRowName} numberOfLines={1}>
          {media.originalName ?? 'فایل'}
        </Text>
        <Text style={styles.attachRowSize}>{faNum(Math.max(1, Math.round(media.size / 1024)))} کیلوبایت — باز کردن</Text>
      </View>
    </TouchableOpacity>
  );
}
