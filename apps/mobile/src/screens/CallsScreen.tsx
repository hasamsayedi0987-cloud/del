import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { api, ApiError } from '../api';
import { fs, useTheme, type DelTheme } from '../theme';
import { Screen, Subtitle, Title } from '../components/ui';
import type { CallDto, ConversationDto } from '@del/shared-types';

/**
 * تماس‌ها (v1.4) — تاریخچهٔ تماس‌ها با دکمه تماس دوباره.
 * شروع تماس جدید از داخل گفتگو انجام می‌شود.
 */
export function CallsScreen({
  accessToken,
  onOpenChat,
  onSessionExpired,
}: {
  accessToken: string;
  onOpenChat: (conv: ConversationDto) => void;
  onSessionExpired: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [calls, setCalls] = useState<CallDto[]>([]);
  const [convNames, setConvNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [page, convs] = await Promise.all([
        api.listCalls(accessToken, undefined, undefined, 50),
        api.listConversations(accessToken).catch(() => []),
      ]);
      setCalls(page.calls);
      const names = new Map<string, string>();
      for (const c of convs) {
        names.set(
          c.id,
          c.type === 'group'
            ? c.title ?? 'گروه'
            : c.peer?.displayName ?? c.peer?.phone ?? 'ناشناس',
        );
      }
      setConvNames(names);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onSessionExpired();
    } finally {
      setLoading(false);
    }
  }, [accessToken, onSessionExpired]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const faTime = (iso: string): string =>
    new Date(iso).toLocaleString('fa-IR', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'long' });

  const toFa = (n: number): string =>
    String(n).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);

  return (
    <Screen>
      <Title>تماس‌ها</Title>
      <Subtitle>تاریخچهٔ تماس‌های صوتی و تصویری شما</Subtitle>

      {loading ? (
        <Subtitle>در حال بارگذاری…</Subtitle>
      ) : calls.length === 0 ? (
        <View style={{ marginTop: 40, alignItems: 'center' }}>
          <Text style={styles.emptyIcon}>📞</Text>
          <Title>هنوز تماسی ندارید</Title>
          <Subtitle>از داخل هر گفتگو دکمهٔ تماس صوتی/تصویری را بزنید</Subtitle>
        </View>
      ) : (
        <FlatList
          data={calls}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => {
            const missed = item.endReason === 'reject' || item.endReason === 'timeout';
            const name = convNames.get(item.conversationId) ?? 'گفتگو';
            const when = faTime(item.startedAt);
            return (
              <View style={styles.row}>
                <View style={[styles.iconWrap, missed && styles.iconMissed]}>
                  <Text style={styles.icon}>{item.kind === 'video' ? '🎥' : '📞'}</Text>
                </View>
                <View style={styles.center}>
                  <Text style={styles.name}>{name}</Text>
                  <Text style={[styles.sub, missed && styles.missedText]}>
                    {item.durationS
                      ? `تماس ${toFa(item.durationS)} ثانیه · ${when}`
                      : missed
                        ? `بی‌پاسخ · ${when}`
                        : when}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </Screen>
  );
}

const makeStyles = (theme: DelTheme) =>
  StyleSheet.create({
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
    iconWrap: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconMissed: { backgroundColor: theme.dark ? 'rgba(248,113,113,0.15)' : 'rgba(220,38,38,0.10)' },
    icon: { fontSize: 18 },
    center: { flex: 1 },
    name: { color: theme.text, fontSize: fs(16), fontWeight: '700', textAlign: 'right' },
    sub: { color: theme.textDim, fontSize: fs(13), marginTop: 2, textAlign: 'right' },
    missedText: { color: theme.danger },
    emptyIcon: { fontSize: 44, marginBottom: 8 },
  });
