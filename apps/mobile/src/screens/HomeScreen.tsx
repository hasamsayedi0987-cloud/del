import React, { useState } from 'react';
import { Text, TextInput, View, StyleSheet } from 'react-native';
import { api } from '../api';
import { theme } from '../theme';
import { Button, Card, Screen, Subtitle, Title } from '../components/ui';
import type { UserDto } from '@del/shared-types';

export function HomeScreen({
  user,
  accessToken,
  onUpdated,
  onLogout,
}: {
  user: UserDto;
  accessToken: string;
  onUpdated: (u: UserDto) => void;
  onLogout: () => void;
}) {
  const [name, setName] = useState(user.displayName ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.updateMe(accessToken, { displayName: name.trim() || undefined });
      onUpdated(updated);
    } catch {
      // نمایش خطا در گام‌های بعدی بهتر می‌شود
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Title>{`سلام ${user.displayName ?? 'کاربر'} 👋`}</Title>
      <Subtitle>حساب شما ساخته شد. این «گام ۱» پروژه دل است: زیرساخت احراز هویت.</Subtitle>

      <Card>
        <Row label="شماره" value={toFaDigits(user.phone)} />
        <Row label="شناسه کاربر" value={user.id.slice(0, 8) + '…'} />
        <Row label="تاریخ عضویت" value={new Date(user.createdAt).toLocaleDateString('fa-IR')} />
      </Card>

      <Text style={styles.section}>نام نمایشی</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="مثلاً: علی"
        placeholderTextColor={theme.textDim}
        style={styles.nameInput}
        textAlign="right"
      />

      <Button label="ذخیره" onPress={save} busy={saving} />

      <View style={styles.bottom}>
        <Button label="خروج از حساب" variant="danger" onPress={onLogout} />
      </View>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function toFaDigits(s: string): string {
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  return s.replace(/[0-9]/g, (d) => fa[Number(d)] ?? d);
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  rowLabel: { color: theme.textDim, fontSize: 14 },
  rowValue: { color: theme.text, fontSize: 14, fontWeight: '600' },
  section: {
    color: theme.textDim,
    fontSize: 13,
    textAlign: 'right',
    marginTop: 24,
    marginBottom: -12,
  },
  nameInput: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    color: theme.text,
    fontSize: 17,
    paddingVertical: 14,
    paddingHorizontal: 18,
    marginTop: 24,
  },
  bottom: {
    marginTop: 'auto',
    paddingTop: 24,
  },
});
