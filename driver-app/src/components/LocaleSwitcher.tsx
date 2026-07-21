import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useI18n } from '../i18n/I18nProvider';
import type { Locale } from '../i18n/strings';
import { palette } from '../theme/palette';

function LocaleButton({
  locale,
  activeLocale,
  onSelect,
}: {
  locale: Locale;
  activeLocale: Locale;
  onSelect: (value: Locale) => void;
}) {
  const isActive = locale === activeLocale;

  return (
    <Pressable
      accessibilityRole="button"
      style={[styles.button, isActive && styles.buttonActive]}
      onPress={() => onSelect(locale)}
    >
      <Text style={[styles.buttonText, isActive && styles.buttonTextActive]}>{locale.toUpperCase()}</Text>
    </Pressable>
  );
}

export function LocaleSwitcher() {
  const { locale, setLocale } = useI18n();

  return (
    <View style={styles.container}>
      <LocaleButton locale="fr" activeLocale={locale} onSelect={setLocale} />
      <LocaleButton locale="en" activeLocale={locale} onSelect={setLocale} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    overflow: 'hidden',
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: palette.card,
  },
  buttonActive: {
    backgroundColor: palette.primary,
  },
  buttonText: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  buttonTextActive: {
    color: palette.primaryText,
  },
});
