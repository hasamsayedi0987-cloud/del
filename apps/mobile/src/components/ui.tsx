import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { theme } from '../theme';

/** صفحه پایه با پس‌زمینه Crystal Blue و چیدمان RTL */
export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
  return (
    <View style={[styles.logo, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.logoText, { fontSize: size * 0.42 }]}>دل</Text>
    </View>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Subtitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.subtitle}>{children}</Text>;
}

export function Input(props: React.ComponentProps<typeof TextInput>) {
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
  const bg =
    variant === 'primary'
      ? theme.accentStrong
      : variant === 'danger'
        ? 'rgba(248,113,113,0.15)'
        : 'transparent';
  const fg = variant === 'primary' ? '#04121F' : variant === 'danger' ? theme.danger : theme.accent;

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
        <ActivityIndicator color={variant === 'primary' ? '#04121F' : theme.accent} />
      ) : (
        <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

const styles = StyleSheet.create({
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
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 24,
  },
  subtitle: {
    color: theme.textDim,
    fontSize: 15,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 24,
  },
  input: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    color: theme.text,
    fontSize: 17,
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
    fontSize: 17,
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
