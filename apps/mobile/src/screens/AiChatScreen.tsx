import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import { api, ApiError } from '../api';
import { fs, useTheme, type DelTheme } from '../theme';
import { Title } from '../components/ui';
import { faError } from '../faError';

interface Line {
  me: boolean;
  text: string;
}

/**
 * دستیار دل (v1.4) — اتاق گفتگوی هوشمند.
 * تاریخچه فقط روی دستگاه شما می‌ماند؛ هر پیام با رضایت شما به سرویس AI می‌رود.
 * پیام‌های رمزنگاری‌شدهٔ گفتگوهای واقعی هرگز اینجا استفاده نمی‌شوند.
 */
export function AiChatScreen({
  accessToken,
  onBack,
}: {
  accessToken: string;
  onBack: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<ScrollView>(null);

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [lines, busy]);

  const send = async () => {
    const clean = text.trim();
    if (!clean || busy) return;
    setText('');
    setError(null);
    setLines((l) => [...l, { me: true, text: clean }]);
    setBusy(true);
    try {
      const history = lines.slice(-20).map((l) => `${l.me ? 'من' : 'دستیار'}: ${l.text}`);
      const res = await api.aiChat(accessToken, clean, history);
      setLines((l) => [...l, { me: false, text: res.text }]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError('نشست منقضی شده — دوباره وارد شوید');
      } else {
        setError(e instanceof ApiError ? faError(e) : 'خطای غیرمنتظره');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>‹ بازگشت</Text>
        </TouchableOpacity>
        <View style={styles.headCenter}>
          <Text style={styles.headTitle}>🤖 دستیار دل</Text>
          <Text style={styles.headSub}>هوشمند و فارسی‌زبان</Text>
        </View>
      </View>

      <ScrollView ref={listRef} style={styles.list} contentContainerStyle={styles.listContent}>
        {lines.length === 0 ? (
          <View style={styles.hello}>
            <Text style={styles.helloIcon}>🤖</Text>
            <Title>سلام! من دستیار دل هستم</Title>
            <Text style={styles.helloText}>
              هر سوالی داری بپرس: ترجمه، ایده، خلاصه، پاسخ نامه و…{'\n'}تاریخچهٔ این گفتگو فقط روی
              همین دستگاه ذخیره می‌شود.
            </Text>
          </View>
        ) : (
          lines.map((l, i) => (
            <View key={i} style={[styles.bubble, l.me ? styles.me : styles.other]}>
              <Text style={[styles.bubbleText, { color: l.me ? theme.bubbleMeText : theme.text }]}>
                {l.text}
              </Text>
            </View>
          ))
        )}
        {busy ? <Text style={styles.typing}>دستیار در حال نوشتن…</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inputRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="به دستیار بگو…"
            placeholderTextColor={theme.textDim}
            style={styles.input}
            multiline
            textAlign="right"
            onSubmitEditing={send}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!text.trim() || busy) && styles.sendOff]}
            onPress={send}
            disabled={!text.trim() || busy}
          >
            <Text style={styles.sendIcon}>➤</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (theme: DelTheme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.bg },
    header: {
      flexDirection: 'row-reverse',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingTop: 52,
      paddingBottom: 10,
      backgroundColor: theme.surface,
      borderBottomColor: theme.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    back: { color: theme.accent, fontSize: fs(15), padding: 6 },
    headCenter: { flex: 1, alignItems: 'center' },
    headTitle: { color: theme.text, fontSize: fs(17), fontWeight: '800' },
    headSub: { color: theme.textDim, fontSize: fs(12), marginTop: 1 },
    list: { flex: 1 },
    listContent: { padding: 16, gap: 8 },
    hello: { alignItems: 'center', marginTop: 60, gap: 8 },
    helloIcon: { fontSize: 48 },
    helloText: {
      color: theme.textDim,
      fontSize: fs(14),
      lineHeight: fs(22),
      textAlign: 'center',
      marginTop: 8,
    },
    bubble: {
      maxWidth: '82%',
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    me: {
      alignSelf: 'flex-start',
      backgroundColor: theme.bubbleMe,
      borderBottomRightRadius: 4,
    },
    other: {
      alignSelf: 'flex-end',
      backgroundColor: theme.bubbleOther,
      borderWidth: 1,
      borderColor: theme.border,
      borderBottomLeftRadius: 4,
    },
    bubbleText: { fontSize: fs(15), lineHeight: fs(23) },
    typing: { color: theme.textDim, fontSize: fs(13), textAlign: 'center', marginTop: 6 },
    error: { color: theme.danger, fontSize: fs(13), textAlign: 'center', marginTop: 6 },
    inputRow: {
      flexDirection: 'row-reverse',
      alignItems: 'flex-end',
      gap: 8,
      padding: 10,
      backgroundColor: theme.surface,
      borderTopColor: theme.border,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    input: {
      flex: 1,
      backgroundColor: theme.surfaceAlt,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: 22,
      color: theme.text,
      fontSize: fs(15),
      paddingHorizontal: 16,
      paddingVertical: 10,
      maxHeight: 110,
    },
    sendBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.accentStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendOff: { opacity: 0.4 },
    sendIcon: { color: theme.dark ? '#04121F' : '#FFFFFF', fontSize: 18 },
  });
