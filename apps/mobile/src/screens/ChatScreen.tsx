import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet,
} from 'react-native';
import { api } from '../api';
import { getSocket, uuid } from '../socket';
import { theme } from '../theme';
import type { ConversationDto, MessageDto, WsMessageNew } from '@del/shared-types';

interface LocalMsg extends MessageDto {
  status?: 'sending' | 'sent' | 'failed';
}

export function ChatScreen({
  accessToken,
  myUserId,
  conversation,
  onBack,
}: {
  accessToken: string;
  myUserId: string;
  conversation: ConversationDto;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<LocalMsg[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<LocalMsg>>(null);

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
    })();

    const s = getSocket();
    const onNew = (payload: WsMessageNew) => {
      if (payload.conversationId !== convId) return;
      upsert(payload.message);
      void api.markRead(accessToken, convId, payload.message.serverSeq).catch(() => undefined);
    };
    s?.on('message.new', onNew);
    return () => {
      cancelled = true;
      s?.off('message.new', onNew);
    };
  }, [accessToken, convId, upsert]);

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

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>‹ بازگشت</Text>
        </TouchableOpacity>
        <Text style={styles.headerName} numberOfLines={1}>
          {conversation.peer?.displayName ?? conversation.peer?.phone ?? 'گفتگو'}
        </Text>
        <View style={{ width: 60 }} />
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
          return (
            <View style={[styles.bubbleRow, mine ? { justifyContent: 'flex-start' } : { justifyContent: 'flex-end' }]}>
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubblePeer]}>
                <Text style={styles.bubbleText}>{item.body}</Text>
                {mine && item.status === 'sending' ? <Text style={styles.status}>… در حال ارسال</Text> : null}
                {mine && item.status === 'failed' ? <Text style={styles.statusFailed}>✗ ارسال نشد</Text> : null}
              </View>
            </View>
          );
        }}
      />

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
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
  headerName: { color: theme.text, fontSize: 17, fontWeight: '800', flex: 1, textAlign: 'center' },
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
  status: { color: 'rgba(4,18,31,0.55)', fontSize: 11, marginTop: 2, textAlign: 'left' },
  statusFailed: { color: '#7f1d1d', fontSize: 11, marginTop: 2, textAlign: 'left', fontWeight: '700' },
  composer: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-end',
    padding: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
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
