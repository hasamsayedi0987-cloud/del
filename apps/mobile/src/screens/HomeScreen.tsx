import React, { useState } from 'react';
import { Platform, StatusBar, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { fs, useTheme, type DelTheme } from '../theme';
import { ChatsScreen } from './ChatsScreen';
import { CallsScreen } from './CallsScreen';
import { StoriesScreen } from './StoriesScreen';
import type { ConversationDto } from '@del/shared-types';

export type HomeTab = 'chats' | 'calls' | 'stories';

/**
 * صفحهٔ اصلی v1.4 — نوار ناوبری پایین: گفتگوها / تماس‌ها / استوری‌ها
 * دکمهٔ شناور (FAB) برای دسترسی سریع به گفتگوی جدید.
 */
export function HomeScreen({
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
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [tab, setTab] = useState<HomeTab>('chats');

  return (
    <View style={styles.root}>
      <StatusBar
        barStyle={theme.dark ? 'light-content' : 'dark-content'}
        backgroundColor={theme.bg}
      />
      <View style={styles.body}>
        {tab === 'chats' && (
          <ChatsScreen
            accessToken={accessToken}
            myUserId={myUserId}
            onOpenChat={onOpenChat}
            onOpenProfile={onOpenProfile}
            onSessionExpired={onSessionExpired}
            embedded
          />
        )}
        {tab === 'calls' && (
          <CallsScreen
            accessToken={accessToken}
            onOpenChat={onOpenChat}
            onSessionExpired={onSessionExpired}
          />
        )}
        {tab === 'stories' && (
          <StoriesScreen accessToken={accessToken} onSessionExpired={onSessionExpired} />
        )}
      </View>

      <View style={styles.tabbar}>
        <TabButton
          theme={theme}
          styles={styles}
          label="گفتگوها"
          icon="💬"
          active={tab === 'chats'}
          onPress={() => setTab('chats')}
        />
        <TabButton
          theme={theme}
          styles={styles}
          label="تماس‌ها"
          icon="📞"
          active={tab === 'calls'}
          onPress={() => setTab('calls')}
        />
        <TabButton
          theme={theme}
          styles={styles}
          label="استوری‌ها"
          icon="✨"
          active={tab === 'stories'}
          onPress={() => setTab('stories')}
        />
      </View>
    </View>
  );
}

function TabButton({
  theme,
  styles,
  label,
  icon,
  active,
  onPress,
}: {
  theme: DelTheme;
  styles: ReturnType<typeof makeStyles>;
  label: string;
  icon: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.tabBtn} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.tabIcon, active && styles.tabIconActive]}>{icon}</Text>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (theme: DelTheme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.bg },
    body: { flex: 1 },
    tabbar: {
      flexDirection: 'row-reverse',
      backgroundColor: theme.surface,
      borderTopColor: theme.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingBottom: Platform.OS === 'ios' ? 18 : 6,
      paddingTop: 6,
    },
    tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 4 },
    tabIcon: { fontSize: 20, opacity: 0.55 },
    tabIconActive: { opacity: 1 },
    tabLabel: {
      color: theme.textDim,
      fontSize: fs(12),
      marginTop: 2,
      fontWeight: '600',
    },
    tabLabelActive: { color: theme.accent, fontWeight: '800' },
  });
