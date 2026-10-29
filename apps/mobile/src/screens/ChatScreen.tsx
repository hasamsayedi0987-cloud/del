import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { api } from '../api';
import { getSignedUrl, uploadMedia } from '../media';
import { getSocket, uuid } from '../socket';
import { theme } from '../theme';
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
  const [messages, setMessages] = useState<LocalMsg[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState('');
  const [uploading, setUploading] = useState(false);
  const listRef = useRef<FlatList<LocalMsg>>(null);

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

  const convId = conversation.id;

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
      try {
        const page = await api.getMessages(accessToken, convId);
        if (cancelled) return;
        setMessages(page.messages);
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
      upsert(payload.message);
      void api.markRead(accessToken, convId, payload.message.serverSeq).catch(() => undefined);
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
          .then((page) => {
            if (cancelled || !page.messages.length) return;
            page.messages.forEach(upsert);
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
  }, [accessToken, convId, peerId, upsert, isGroup, myUserId, senderName]);

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
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
      status: 'sending',
    };
    upsert(optimistic);
    setDraft('');

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
  }, [draft, convId, myUserId, accessToken, upsert]);

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

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>‹ بازگشت</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerName} numberOfLines={1}>
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
                  ? 'آنلاین'
                  : peerPresence?.lastSeen
                    ? `آخرین بازدید ${faRelative(peerPresence.lastSeen)}`
                    : ' '}
          </Text>
        </View>
        {/* گام ۶: دکمه‌های تماس — فقط گفتگوهای ۱:۱ */}
        {!isGroup && onRequestCall ? (
          <View style={styles.callBtns}>
            <TouchableOpacity
              style={styles.callBtn}
              onPress={() => onRequestCall(conversation, 'audio')}
              accessibilityLabel="تماس صوتی"
            >
              <Text style={styles.callBtnIcon}>📞</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.callBtn}
              onPress={() => onRequestCall(conversation, 'video')}
              accessibilityLabel="تماس تصویری"
            >
              <Text style={styles.callBtnIcon}>🎥</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ width: 64 }} />
        )}
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
          return (
            <View style={[styles.bubbleRow, mine ? { justifyContent: 'flex-start' } : { justifyContent: 'flex-end' }]}>
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubblePeer]}>
                {from ? <Text style={styles.senderName}>{from}</Text> : null}
                {item.media ? (
                  <MediaBubble token={accessToken} media={item.media} mine={mine} />
                ) : null}
                {item.body ? <Text style={styles.bubbleText}>{item.body}</Text> : null}
                {mine && item.status === 'sending' ? (
                  <Text style={styles.status}>{item.pendingLabel ?? '… در حال ارسال'}</Text>
                ) : null}
                {mine && item.status === 'failed' ? <Text style={styles.statusFailed}>✗ ارسال نشد</Text> : null}
                {mine && item.status === 'sent' ? (
                  <Text style={styles.ticks}>{read ? '✓✓' : '✓'}</Text>
                ) : null}
              </View>
            </View>
          );
        }}
      />

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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
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
  bubbleText: { color: '#EAF6FF', fontSize: 16, lineHeight: 24, textAlign: 'right' },
  senderName: { color: theme.accent, fontSize: 12, fontWeight: '700', marginBottom: 2, textAlign: 'right' },
  status: { color: 'rgba(4,18,31,0.55)', fontSize: 11, marginTop: 2, textAlign: 'left' },
  statusFailed: { color: '#7f1d1d', fontSize: 11, marginTop: 2, textAlign: 'left', fontWeight: '700' },
  ticks: { color: 'rgba(4,18,31,0.6)', fontSize: 11, marginTop: 2, textAlign: 'left', fontWeight: '700' },
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
