import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Modal, Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import { api, ApiError } from '../api';
import { getSocket } from '../socket';
import { theme } from '../theme';
import { Button, Logo, Screen, Subtitle, Title } from '../components/ui';
import { faError } from './LoginPhoneScreen';
import type {
  ConversationDto,
  WsConversationNew,
  WsConversationUpdated,
  WsMemberRemoved,
} from '@del/shared-types';

export function ChatsScreen({
  accessToken,
  myUserId,
  onOpenChat,
  onOpenProfile,
  onSessionExpired,
}: {
  accessToken: string;
  myUserId: string;
  onOpenChat: (conv: ConversationDto) => void;
  onOpenProfile: () => void;
  onSessionExpired: () => void;
}) {
  const [convs, setConvs] = useState<ConversationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDialog, setNewDialog] = useState(false);
  /** مودال جدید: گفتگوی شخصی یا گروه */
  const [dialogMode, setDialogMode] = useState<'direct' | 'group'>('direct');
  const [phone, setPhone] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [groupPhones, setGroupPhones] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listConversations(accessToken);
      setConvs(list);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onSessionExpired();
    } finally {
      setLoading(false);
    }
  }, [accessToken, onSessionExpired]);

  useEffect(() => {
    void refresh();
    // به‌روزرسانی زنده لیست وقتی پیام جدید در مکالمه‌ای دیگر می‌آید
    const s = getSocket();
    const onUpdate = (payload: WsConversationUpdated) => {
      void refresh();
    };
    // گفتگوی تازه‌ساخته‌شده (مثلاً طرف مقابل شروع کرد یا به گروهی اضافه شدید) → رفرش + join اتاق
    const onNewConv = (payload: WsConversationNew) => {
      const s2 = getSocket();
      s2?.emit('conversation.join', { conversationId: payload.conversationId });
      void refresh();
    };
    // خواندن در دستگاه دیگر → نشان نخوانده به‌روز شود
    const onRead = () => {
      void refresh();
    };
    // عضو گروه حذف/خارج شد → رفرش؛ اگر خودمان بودیم اطلاع بده
    const onMemberRemoved = (p: WsMemberRemoved) => {
      if (p.userId === myUserId) {
        Alert.alert(
          p.left ? 'خروج از گروه' : 'حذف از گروه',
          p.left ? 'شما از گروه خارج شدید' : 'شما از گروه حذف شدید',
        );
      }
      void refresh();
    };
    s?.on('conversation.updated', onUpdate);
    s?.on('conversation.new', onNewConv);
    s?.on('message.read', onRead);
    s?.on('member.removed', onMemberRemoved);
    return () => {
      s?.off('conversation.updated', onUpdate);
      s?.off('conversation.new', onNewConv);
      s?.off('message.read', onRead);
      s?.off('member.removed', onMemberRemoved);
    };
  }, [refresh, myUserId]);

  const startChat = async () => {
    setDialogError(null);
    setBusy(true);
    try {
      const user = await api.findUserByPhone(accessToken, phone.trim());
      const conv = await api.createConversation(accessToken, user.id);
      setNewDialog(false);
      setPhone('');
      onOpenChat(conv);
    } catch (e) {
      setDialogError(
        e instanceof ApiError
          ? e.code === 'USER_NOT_FOUND'
            ? 'کاربری با این شماره در دل نیست'
            : faError(e)
          : 'خطای غیرمنتظره',
      );
    } finally {
      setBusy(false);
    }
  };

  /** ساخت گروه: عنوان + چند شماره (با کاما/فاصله جدا شده) */
  const createGroup = async () => {
    setDialogError(null);
    const phones = groupPhones
      .split(/[,،\s]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (!groupTitle.trim() || phones.length === 0) {
      setDialogError('عنوان گروه و حداقل یک شماره لازم است');
      return;
    }
    setBusy(true);
    try {
      const users = await Promise.all(phones.map((p) => api.findUserByPhone(accessToken, p)));
      const conv = await api.createGroup(
        accessToken,
        groupTitle.trim(),
        users.map((u) => u.id),
      );
      setNewDialog(false);
      setGroupTitle('');
      setGroupPhones('');
      onOpenChat(conv);
    } catch (e) {
      setDialogError(
        e instanceof ApiError
          ? e.code === 'USER_NOT_FOUND'
            ? 'یکی از شماره‌ها در دل نیست'
            : faError(e)
          : 'خطای غیرمنتظره',
      );
    } finally {
      setBusy(false);
    }
  };

  const openNewDialog = (mode: 'direct' | 'group') => {
    setDialogMode(mode);
    setDialogError(null);
    setNewDialog(true);
  };

  return (
    <Screen>
      <View style={styles.header}>
        <TouchableOpacity onPress={onOpenProfile}>
          <Text style={styles.headerAction}>پروفایل</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>گفتگوها</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => openNewDialog('group')}>
            <Text style={styles.headerActionAccent}>+ گروه</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => openNewDialog('direct')}>
            <Text style={styles.headerActionAccent}>+ جدید</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <Subtitle>در حال بارگذاری…</Subtitle>
      ) : convs.length === 0 ? (
        <View style={{ marginTop: 48 }}>
          <Logo size={72} />
          <Title>هنوز گفتگویی ندارید</Title>
          <Subtitle>با «+ جدید» گفتگوی شخصی و با «+ گروه» گروه بسازید</Subtitle>
        </View>
      ) : (
        <FlatList
          data={convs}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => {
            const isGroup = item.type === 'group';
            const name = isGroup
              ? item.title ?? 'گروه'
              : item.peer?.displayName ?? item.peer?.phone ?? 'ناشناس';
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => onOpenChat(item)}
                activeOpacity={0.7}
              >
                {isGroup ? <GroupAvatar title={name} /> : <Avatar name={name} />}
                <View style={styles.rowCenter}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={styles.rowPreview} numberOfLines={1}>
                    {isGroup
                      ? `${toFa(item.memberCount ?? 0)} عضو${item.lastMessage ? ` · ${item.lastMessage.body}` : ''}`
                      : item.lastMessage?.body ?? 'بدون پیام'}
                  </Text>
                </View>
                {item.unreadCount > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{toFa(item.unreadCount)}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          }}
        />
      )}

      <Modal visible={newDialog} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {dialogMode === 'direct' ? (
              <>
                <Title>گفتگوی جدید</Title>
                <Subtitle>شماره موبایل طرف مقابل را وارد کنید</Subtitle>
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="۰۹۱۲ ۱۲۳ ۴۵۶۷"
                  placeholderTextColor={theme.textDim}
                  keyboardType="phone-pad"
                  style={styles.modalInput}
                  textAlign="right"
                />
                {dialogError ? <Text style={styles.error}>{dialogError}</Text> : null}
                <Button label="شروع گفتگو" onPress={startChat} busy={busy} disabled={phone.trim().length < 10} />
                <Button label="انصراف" variant="ghost" onPress={() => setNewDialog(false)} />
              </>
            ) : (
              <>
                <Title>گروه جدید</Title>
                <Subtitle>عنوان گروه و شماره اعضا (با کاما یا فاصله) را وارد کنید</Subtitle>
                <TextInput
                  value={groupTitle}
                  onChangeText={setGroupTitle}
                  placeholder="نام گروه"
                  placeholderTextColor={theme.textDim}
                  style={styles.modalInput}
                  textAlign="right"
                />
                <TextInput
                  value={groupPhones}
                  onChangeText={setGroupPhones}
                  placeholder="۰۹۱۲…، ۰۹۱۳…"
                  placeholderTextColor={theme.textDim}
                  keyboardType="phone-pad"
                  multiline
                  style={[styles.modalInput, { marginTop: 10, minHeight: 72 }]}
                  textAlign="right"
                />
                {dialogError ? <Text style={styles.error}>{dialogError}</Text> : null}
                <Button
                  label="ساخت گروه"
                  onPress={createGroup}
                  busy={busy}
                  disabled={!groupTitle.trim() || !groupPhones.trim()}
                />
                <Button label="انصراف" variant="ghost" onPress={() => setNewDialog(false)} />
              </>
            )}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function GroupAvatar({ title }: { title: string }) {
  const letter = title.trim().charAt(0) || 'گ';
  return (
    <View style={styles.groupAvatar}>
      <Text style={styles.groupAvatarText}>{letter}</Text>
    </View>
  );
}

function Avatar({ name }: { name: string }) {
  const letter = name.trim().charAt(0) || '؟';
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{letter}</Text>
    </View>
  );
}

function toFa(n: number): string {
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  return String(n).replace(/[0-9]/g, (d) => fa[Number(d)] ?? d);
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  headerTitle: { color: theme.text, fontSize: 22, fontWeight: '800' },
  headerAction: { color: theme.textDim, fontSize: 15, padding: 8 },
  headerActionAccent: { color: theme.accent, fontSize: 15, fontWeight: '700', padding: 8 },
  headerActions: { flexDirection: 'row-reverse', gap: 4, alignItems: 'center' },
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    padding: 12,
    marginTop: 10,
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.accentSoft,
    borderWidth: 1,
    borderColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: theme.accent, fontSize: 20, fontWeight: '800' },
  groupAvatar: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: theme.accentSoft,
    borderWidth: 1,
    borderColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupAvatarText: { color: theme.accent, fontSize: 20, fontWeight: '800' },
  rowCenter: { flex: 1 },
  rowName: { color: theme.text, fontSize: 16, fontWeight: '700', textAlign: 'right' },
  rowPreview: { color: theme.textDim, fontSize: 13, marginTop: 2, textAlign: 'right' },
  badge: {
    backgroundColor: theme.accentStrong,
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: '#04121F', fontWeight: '800', fontSize: 12 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(4, 12, 24, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: theme.surfaceAlt,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    padding: 20,
  },
  modalInput: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    color: theme.text,
    fontSize: 17,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 16,
  },
  error: { color: theme.danger, textAlign: 'right', marginTop: 10, fontSize: 13 },
});
