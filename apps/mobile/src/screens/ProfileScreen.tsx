import React, { useEffect, useState } from 'react';
import { Text, TextInput, View, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { api } from '../api';
import { theme } from '../theme';
import { Button, Card, Screen, Subtitle, Title } from '../components/ui';
import { e2eeIdentityPublic } from '../e2ee/engine';
import { e2eeStore } from '../e2ee/store';
import type { UserDto } from '@del/shared-types';

export function ProfileScreen({
  user,
  accessToken,
  onUpdated,
  onLogout,
  onBack,
}: {
  user: UserDto;
  accessToken: string;
  onUpdated: (u: UserDto) => void;
  onLogout: () => void;
  onBack: () => void;
}) {
  const [name, setName] = useState(user.displayName ?? '');
  const [saving, setSaving] = useState(false);

  // ————— گام ۹: رضایت هوش مصنوعی —————
  const [aiConsent, setAiConsent] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const s = await api.aiStatus(accessToken);
        setAiConsent(s.globalConsent);
        setAiAvailable(s.available);
      } catch {
        // بی‌اهمیت — نمایش پیش‌فرض
      }
    })();
  }, [accessToken]);

  // ————— گام ۸: وضعیت رمزنگاری —————
  const [e2eeActive, setE2eeActive] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      setE2eeActive(Boolean(e2eeIdentityPublic()));
      setRecoveryKey(await e2eeStore.getRecoveryKey());
    })();
  }, []);

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
      <Text style={styles.back} onPress={onBack}>
        ‹ بازگشت به گفتگوها
      </Text>
      <Title>{`سلام ${user.displayName ?? 'کاربر'} 👋`}</Title>
      <Subtitle>پروفایل شما در دل — گام ۲: پیام‌رسانی بلادرنگ</Subtitle>

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

      <Text style={styles.section}>رمزنگاری سرتاسری</Text>
      <Card>
        <Row
          label="وضعیت"
          value={e2eeActive ? '🔒 فعال (X3DH + Double Ratchet)' : 'غیرفعال — از صفحه گفتگوها فعال کنید'}
        />
        <Row
          label="کلید بازیابی"
          value={recoveryKey ? (showRecovery && recoveryKey ? recoveryKey : 'ذخیره‌شده — نمایش') : 'روی این دستگاه نیست'}
        />
        {recoveryKey ? (
          <Text style={styles.recoveryToggle} onPress={() => setShowRecovery((v) => !v)}>
            {showRecovery ? 'پنهان کردن کلید' : 'نمایش کلید بازیابی'}
          </Text>
        ) : null}
      </Card>

      <Text style={styles.section}>هوش مصنوعی</Text>
      <Card>
        <Row
          label="وضعیت سرویس"
          value={aiAvailable ? 'فعال روی سرور' : 'غیرفعال (بدون provider)'}
        />
        <Row label="رضایت من" value={aiConsent ? 'داده شده ✓' : 'داده نشده'} />
        <Text style={styles.aiNote}>
          با رضایت، قابلیت‌های ترجمه، پیشنهاد پاسخ و خلاصه فعال می‌شوند. پیام‌های رمزنگاری‌شدهٔ سرتاسری هرگز برای هوش مصنوعی استفاده نمی‌شوند و رضایت می‌تواند برای هر گفتگو جداگانه لغو شود.
        </Text>
        <TouchableOpacity
          style={[styles.aiToggle, aiConsent ? styles.aiToggleOn : null]}
          onPress={() => {
            const next = !aiConsent;
            api
              .setAiConsent(accessToken, next)
              .then(() => setAiConsent(next))
              .catch(() => Alert.alert('خطا', 'تغییر رضایت ناموفق بود'));
          }}
        >
          <Text style={styles.aiToggleText}>
            {aiConsent ? 'لغو رضایت هوش مصنوعی' : 'دادن رضایت هوش مصنوعی'}
          </Text>
        </TouchableOpacity>
      </Card>

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
  back: {
    color: theme.accent,
    fontSize: 14,
    marginBottom: 8,
  },
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
  recoveryToggle: {
    color: theme.accent,
    fontSize: 13,
    textAlign: 'right',
    marginTop: 6,
    paddingVertical: 4,
  },
  aiNote: {
    color: theme.textDim,
    fontSize: 12,
    lineHeight: 20,
    textAlign: 'right',
    marginTop: 6,
  },
  aiToggle: {
    marginTop: 10,
    borderColor: theme.accent,
    borderWidth: 1,
    borderRadius: theme.radius,
    paddingVertical: 10,
    alignItems: 'center',
  },
  aiToggleOn: {
    borderColor: '#ef4444',
  },
  aiToggleText: { color: theme.accent, fontSize: 14, fontWeight: '700' },
  bottom: {
    marginTop: 'auto',
    paddingTop: 24,
  },
});
