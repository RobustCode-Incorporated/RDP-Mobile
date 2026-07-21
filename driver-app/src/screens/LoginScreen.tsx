import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { LocaleSwitcher } from '../components/LocaleSwitcher';
import { useI18n } from '../i18n/I18nProvider';
import { palette } from '../theme/palette';

interface LoginScreenProps {
  email: string;
  password: string;
  errorMessage: string | null;
  isSubmitting: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
}

export function LoginScreen({
  email,
  password,
  errorMessage,
  isSubmitting,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: LoginScreenProps) {
  const { strings } = useI18n();

  return (
    <View style={styles.container}>
      <LocaleSwitcher />
      <Text style={styles.eyebrow}>{strings.login.eyebrow}</Text>
      <Text style={styles.title}>{strings.login.title}</Text>
      <Text style={styles.subtitle}>{strings.login.subtitle}</Text>

      <TextInput
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder={strings.login.emailPlaceholder}
        placeholderTextColor="#64748b"
        style={styles.input}
        value={email}
        onChangeText={onEmailChange}
      />
      <TextInput
        placeholder={strings.login.passwordPlaceholder}
        placeholderTextColor="#64748b"
        secureTextEntry
        style={styles.input}
        value={password}
        onChangeText={onPasswordChange}
      />

      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

      <Pressable
        accessibilityRole="button"
        style={[styles.primaryButton, isSubmitting && styles.buttonDisabled]}
        disabled={isSubmitting}
        onPress={onSubmit}
      >
        <Text style={styles.primaryButtonText}>{isSubmitting ? strings.login.submitting : strings.login.submit}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 14,
    backgroundColor: palette.appBackground,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: palette.textMuted,
    fontWeight: '700',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: palette.textStrong,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: palette.textSubtle,
  },
  input: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    backgroundColor: palette.card,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: palette.textStrong,
  },
  primaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: palette.primary,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: palette.primaryText,
    fontWeight: '700',
    fontSize: 15,
  },
  errorText: {
    color: palette.dangerText,
    fontSize: 14,
    lineHeight: 20,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});