import React from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { fs, useTheme, type DelTheme } from '../theme';

/** صفحه پایه با تم پویا (روشن/تاریک) و چیدمان RTL */
export function Screen({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    // padding روی اندروید هم لازم است — edge-to-edge (SDK 35) پنجره را resize نمی‌کند
    <KeyboardAvoidingView
      style={styles.flex}
      behavior="padding"
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Logo({ size = 96 }: { size?: number }) {
  // لوگوی رسمی دل (حباب گفتگو + گوشی) — asset شفاف
  return (
    <Image
      source={require('../assets/logo.png')}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return <Text style={styles.title}>{children}</Text>;
}

export function Subtitle({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return <Text style={styles.subtitle}>{children}</Text>;
}

export function Input(props: React.ComponentProps<typeof TextInput>) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return (
    <TextInput
      placeholderTextColor={theme.textDim}
      style={styles.input}
      {...props}
    />
  );
}

export function Button({
  label,
  onPress,
  busy,
  variant = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const bg =
    variant === 'primary'
      ? theme.accentStrong
      : variant === 'danger'
        ? theme.dark
          ? 'rgba(248,113,113,0.15)'
          : 'rgba(220,38,38,0.10)'
        : 'transparent';
  const fg =
    variant === 'primary'
      ? theme.dark
        ? '#04121F'
        : '#FFFFFF'
      : variant === 'danger'
        ? theme.danger
        : theme.accent;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
        variant === 'ghost' && { borderWidth: 1, borderColor: theme.border },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  return <View style={styles.card}>{children}</View>;
}

const makeStyles = (theme: DelTheme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    container: {
      flexGrow: 1,
      padding: theme.space * 1.5,
      paddingTop: 72,
    },
    logo: {
      alignSelf: 'center',
      backgroundColor: theme.accentSoft,
      borderWidth: 2,
      borderColor: theme.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoText: {
      color: theme.accent,
      fontWeight: '800',
    },
    title: {
      color: theme.text,
      fontSize: fs(26),
      fontWeight: '800',
      textAlign: 'center',
      marginTop: 24,
    },
    subtitle: {
      color: theme.textDim,
      fontSize: fs(15),
      textAlign: 'center',
      marginTop: 8,
      lineHeight: fs(24),
    },
    input: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: theme.radius,
      color: theme.text,
      fontSize: fs(17),
      paddingVertical: 14,
      paddingHorizontal: 18,
      textAlign: 'right',
      marginTop: 24,
    },
    button: {
      borderRadius: theme.radius,
      paddingVertical: 15,
      alignItems: 'center',
      marginTop: 14,
    },
    buttonText: {
      fontSize: fs(17),
      fontWeight: '700',
    },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: theme.radius,
      padding: theme.space,
      marginTop: theme.space,
    },
  });
