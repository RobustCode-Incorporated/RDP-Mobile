import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useI18n } from '../i18n/I18nProvider';
import { localizedStrings } from '../i18n/strings';
import { palette } from '../theme/palette';
import { FAIL_REASON_MAX_LENGTH } from '../types/api';

export const FAILURE_PRESET_KEYS = [
  'CUSTOMER_ABSENT',
  'ADDRESS_NOT_FOUND',
  'CUSTOMER_UNREACHABLE',
  'REFUSED',
  'OTHER',
] as const;

export type FailurePresetKey = (typeof FAILURE_PRESET_KEYS)[number];

/**
 * Builds the `reason` sent to PUT /fail. Preset labels are always sent in French
 * (the language of restaurants/admins in the pilot) whatever the UI locale.
 * "OTHER" requires free text; other presets accept optional details.
 */
export function composeFailureReason(preset: FailurePresetKey | null, details: string) {
  const trimmedDetails = details.trim();

  if (!preset) {
    return '';
  }

  if (preset === 'OTHER') {
    return trimmedDetails;
  }

  const label = localizedStrings.fr.detail.failurePresets[preset];
  return trimmedDetails ? `${label} - ${trimmedDetails}` : label;
}

interface FailureReasonPanelProps {
  isSaving: boolean;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}

export function FailureReasonPanel({ isSaving, onSubmit, onCancel }: FailureReasonPanelProps) {
  const { strings } = useI18n();
  const [preset, setPreset] = useState<FailurePresetKey | null>(null);
  const [details, setDetails] = useState('');
  const reason = composeFailureReason(preset, details);
  const isTooLong = reason.length > FAIL_REASON_MAX_LENGTH;
  const isValid = reason.length > 0 && !isTooLong;

  return (
    <View testID="failure-panel" style={styles.panel}>
      <Text style={styles.title}>{strings.detail.failureTitle}</Text>
      <View style={styles.chipRow}>
        {FAILURE_PRESET_KEYS.map((key) => {
          const isSelected = preset === key;

          return (
            <Pressable
              key={key}
              testID={`failure-preset-${key}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              style={[styles.chip, isSelected && styles.chipSelected]}
              onPress={() => setPreset(key)}
            >
              <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                {strings.detail.failurePresets[key]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {preset ? (
        <TextInput
          testID="failure-details-input"
          multiline
          maxLength={FAIL_REASON_MAX_LENGTH}
          placeholder={preset === 'OTHER' ? strings.detail.failureOtherPlaceholder : strings.detail.failureDetailsPlaceholder}
          placeholderTextColor="#64748b"
          style={styles.textArea}
          value={details}
          onChangeText={setDetails}
        />
      ) : (
        <Text style={styles.hint}>{strings.detail.failureChooseReason}</Text>
      )}

      {preset ? (
        <Text style={[styles.counter, isTooLong && styles.counterError]}>
          {strings.detail.failureCounter(reason.length)}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable accessibilityRole="button" style={styles.ghostButton} onPress={onCancel}>
          <Text style={styles.ghostButtonText}>{strings.detail.cancel}</Text>
        </Pressable>
        <Pressable
          testID="confirm-failure-button"
          accessibilityRole="button"
          accessibilityState={{ disabled: !isValid || isSaving }}
          style={[styles.dangerButton, (!isValid || isSaving) && styles.buttonDisabled]}
          disabled={!isValid || isSaving}
          onPress={() => onSubmit(reason)}
        >
          <Text style={styles.dangerButtonText}>{strings.detail.failureConfirm}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: 10,
    borderRadius: 22,
    backgroundColor: palette.card,
    padding: 18,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.textStrong,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    backgroundColor: palette.secondary,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  chipSelected: {
    backgroundColor: palette.primary,
  },
  chipText: {
    color: palette.secondaryText,
    fontSize: 14,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: palette.primaryText,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    backgroundColor: palette.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: palette.textStrong,
  },
  hint: {
    color: palette.textMuted,
    fontSize: 13,
  },
  counter: {
    color: palette.textMuted,
    fontSize: 12,
    textAlign: 'right',
  },
  counterError: {
    color: palette.dangerText,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
  },
  ghostButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  ghostButtonText: {
    color: palette.textSubtle,
    fontWeight: '600',
    fontSize: 14,
  },
  dangerButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: palette.dangerText,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  dangerButtonText: {
    color: palette.primaryText,
    fontWeight: '700',
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
