import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { DriverDeliveryDto, PendingAction } from '../types/api';
import { palette, statusBadgeColors } from '../theme/palette';

const quickFailureReasons = [
  'Client absent',
  'Adresse introuvable',
  'Restaurant ferme',
  'Incident vehicule',
];

interface DeliveryDetailScreenProps {
  delivery: DriverDeliveryDto;
  pendingActionCount: number;
  blockedAction: PendingAction | null;
  failureDraft: string;
  bannerMessage: string | null;
  errorMessage: string | null;
  isSaving: boolean;
  onBack: () => void;
  onRefreshServerState: () => void;
  onRetryBlockedAction: () => void;
  onDiscardBlockedAction: () => void;
  onFailureDraftChange: (value: string) => void;
  onPickup: () => void;
  onStart: () => void;
  onComplete: () => void;
  onFail: () => void;
}

export function DeliveryDetailScreen({
  delivery,
  pendingActionCount,
  blockedAction,
  failureDraft,
  bannerMessage,
  errorMessage,
  isSaving,
  onBack,
  onRefreshServerState,
  onRetryBlockedAction,
  onDiscardBlockedAction,
  onFailureDraftChange,
  onPickup,
  onStart,
  onComplete,
  onFail,
}: DeliveryDetailScreenProps) {
  const trimmedFailureDraft = failureDraft.trim();
  const isFailureDraftInvalid = !trimmedFailureDraft || trimmedFailureDraft.length > 180;
  const isBlockedByConflict = blockedAction?.state === 'conflicted';
  const isBlockedByFailure = blockedAction?.state === 'failed';

  return (
    <ScrollView contentContainerStyle={styles.contentContainer}>
      <Pressable accessibilityRole="button" style={styles.backButton} onPress={onBack}>
        <Text style={styles.backButtonText}>Retour aux livraisons</Text>
      </Pressable>

      <View style={styles.detailCard}>
        <Text style={styles.eyebrow}>Detail livraison</Text>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Livraison #{delivery.id}</Text>
          <Text style={[styles.statusBadge, statusBadgeColors[delivery.status]]}>{delivery.status}</Text>
        </View>

        <Text style={styles.metaLine}>Retrait: {delivery.pickupAddress}</Text>
        <Text style={styles.metaLine}>Destination: {delivery.deliveryAddress}</Text>
        {delivery.restaurant?.name ? <Text style={styles.metaLine}>Restaurant: {delivery.restaurant.name}</Text> : null}
        {delivery.restaurant?.address ? <Text style={styles.metaLine}>Adresse restaurant: {delivery.restaurant.address}</Text> : null}
        {delivery.customer?.email ? <Text style={styles.metaLine}>Client: {delivery.customer.email}</Text> : null}
        {delivery.description ? <Text style={styles.metaLine}>Notes: {delivery.description}</Text> : null}
        <Text style={styles.metaLine}>Creee: {delivery.createdAt}</Text>
        {delivery.updatedAt ? <Text style={styles.metaLine}>Mise a jour: {delivery.updatedAt}</Text> : null}
        {pendingActionCount ? <Text style={styles.pendingText}>Actions en attente: {pendingActionCount}</Text> : null}
      </View>

      {bannerMessage ? <Text style={styles.successText}>{bannerMessage}</Text> : null}
      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

      {blockedAction ? (
        <View style={[styles.recoveryPanel, isBlockedByConflict ? styles.recoveryConflict : styles.recoveryFailure]}>
          <Text style={styles.recoveryPanelTitle}>
            {isBlockedByConflict ? 'Conflit entre file locale et serveur' : 'Action en attente en echec'}
          </Text>
          <Text style={styles.recoveryPanelText}>
            {isBlockedByConflict
              ? 'Le serveur a change d etat avant la relecture. Actualisez d abord la livraison puis supprimez l action locale obsolete.'
              : 'La reprise automatique a atteint sa limite. Vous pouvez reprogrammer l action ou la supprimer apres verification.'}
          </Text>
          {blockedAction.lastError ? <Text style={styles.recoveryError}>Derniere erreur: {blockedAction.lastError}</Text> : null}

          <View style={styles.recoveryActions}>
            <Pressable style={styles.ghostButton} onPress={onRefreshServerState}>
              <Text style={styles.ghostButtonText}>Actualiser l etat serveur</Text>
            </Pressable>
            {isBlockedByFailure ? (
              <Pressable style={styles.secondaryButton} onPress={onRetryBlockedAction}>
                <Text style={styles.secondaryButtonText}>Reprogrammer l action</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.secondaryButton} onPress={onDiscardBlockedAction}>
              <Text style={styles.secondaryButtonText}>Supprimer l action locale</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.actionGroup}>
        {delivery.status === 'ASSIGNED' ? (
          <Pressable style={[styles.primaryButton, isSaving && styles.buttonDisabled]} disabled={isSaving} onPress={onPickup}>
            <Text style={styles.primaryButtonText}>Marquer recuperee</Text>
          </Pressable>
        ) : null}

        {delivery.status === 'PICKED_UP' ? (
          <Pressable style={[styles.primaryButton, isSaving && styles.buttonDisabled]} disabled={isSaving} onPress={onStart}>
            <Text style={styles.primaryButtonText}>Demarrer la livraison</Text>
          </Pressable>
        ) : null}

        {delivery.status === 'IN_TRANSIT' ? (
          <Pressable style={[styles.primaryButton, isSaving && styles.buttonDisabled]} disabled={isSaving} onPress={onComplete}>
            <Text style={styles.primaryButtonText}>Marquer livree</Text>
          </Pressable>
        ) : null}
      </View>

      {(delivery.status === 'ASSIGNED' || delivery.status === 'PICKED_UP' || delivery.status === 'IN_TRANSIT') ? (
        <View style={styles.failurePanel}>
          <Text style={styles.failureLabel}>Motif d echec</Text>
          <View style={styles.quickReasonRow}>
            {quickFailureReasons.map((reason) => (
              <Pressable
                key={reason}
                accessibilityRole="button"
                style={styles.quickReasonChip}
                onPress={() => onFailureDraftChange(reason)}
              >
                <Text style={styles.quickReasonChipText}>{reason}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            multiline
            placeholder="Exemple: client absent, adresse introuvable..."
            placeholderTextColor="#64748b"
            style={styles.textArea}
            value={failureDraft}
            onChangeText={onFailureDraftChange}
          />
          <Text style={[styles.counterText, trimmedFailureDraft.length > 180 && styles.counterTextError]}>
            {trimmedFailureDraft.length}/180 caracteres
          </Text>
          <Pressable
            testID="fail-delivery-button"
            style={[styles.secondaryButton, (isSaving || isFailureDraftInvalid) && styles.buttonDisabled]}
            disabled={isSaving || isFailureDraftInvalid}
            onPress={onFail}
          >
            <Text style={styles.secondaryButtonText}>Signaler un echec</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    padding: 20,
    gap: 16,
    backgroundColor: palette.appBackground,
  },
  backButton: {
    alignSelf: 'flex-start',
  },
  backButtonText: {
    color: palette.primary,
    fontWeight: '700',
    fontSize: 14,
  },
  detailCard: {
    borderRadius: 24,
    backgroundColor: palette.card,
    padding: 20,
    gap: 10,
  },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: palette.textMuted,
    fontWeight: '700',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: palette.textStrong,
    flex: 1,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
  },
  metaLine: {
    fontSize: 14,
    color: palette.textSubtle,
    lineHeight: 20,
  },
  pendingText: {
    fontSize: 13,
    color: palette.warningText,
    fontWeight: '600',
  },
  successText: {
    color: palette.successText,
    fontSize: 14,
    lineHeight: 20,
  },
  errorText: {
    color: palette.dangerText,
    fontSize: 14,
    lineHeight: 20,
  },
  actionGroup: {
    gap: 10,
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
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: palette.secondary,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: palette.secondaryText,
    fontWeight: '700',
    fontSize: 14,
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
  textArea: {
    minHeight: 88,
    textAlignVertical: 'top',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    backgroundColor: palette.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: palette.textStrong,
  },
  quickReasonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickReasonChip: {
    borderRadius: 999,
    backgroundColor: palette.secondary,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  quickReasonChipText: {
    color: palette.secondaryText,
    fontSize: 13,
    fontWeight: '600',
  },
  counterText: {
    color: palette.textMuted,
    fontSize: 12,
    textAlign: 'right',
  },
  counterTextError: {
    color: palette.dangerText,
    fontWeight: '700',
  },
  failurePanel: {
    gap: 10,
    borderRadius: 22,
    backgroundColor: palette.card,
    padding: 18,
  },
  recoveryPanel: {
    borderRadius: 22,
    padding: 18,
    gap: 10,
  },
  recoveryConflict: {
    backgroundColor: palette.dangerBg,
  },
  recoveryFailure: {
    backgroundColor: palette.warningBg,
  },
  recoveryPanelTitle: {
    color: palette.dangerText,
    fontSize: 15,
    fontWeight: '700',
  },
  recoveryPanelText: {
    color: palette.textSubtle,
    fontSize: 13,
    lineHeight: 20,
  },
  recoveryError: {
    color: palette.dangerText,
    fontSize: 12,
    lineHeight: 18,
  },
  recoveryActions: {
    gap: 10,
  },
  failureLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: palette.textStrong,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});