import { useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DeliveryBadges, StatusBadge } from '../components/DeliveryBadges';
import { DeliveryMapCard } from '../components/DeliveryMapCard';
import { FailureReasonPanel } from '../components/FailureReasonPanel';
import { HistoryTimeline } from '../components/HistoryTimeline';
import { LocaleSwitcher } from '../components/LocaleSwitcher';
import { useI18n } from '../i18n/I18nProvider';
import { formatEur } from '../lib/format';
import { buildNavigationUrls, buildTelUrl, type NavigationTarget } from '../lib/navigation';
import { palette } from '../theme/palette';
import type { Delivery, DeliveryHistory, PendingAction } from '../types/api';
import { isActiveDelivery } from '../types/api';

type Coordinates = {
  latitude: number;
  longitude: number;
};

interface DeliveryDetailScreenProps {
  delivery: Delivery;
  currentLocation: Coordinates | null;
  pendingActionCount: number;
  blockedAction: PendingAction | null;
  bannerMessage: string | null;
  errorMessage: string | null;
  isSaving: boolean;
  onBack: () => void;
  onRefreshServerState: () => void;
  onRetryBlockedAction: () => void;
  onDiscardBlockedAction: () => void;
  onPickup: () => void;
  onStart: () => void;
  onComplete: () => void;
  /** Resolves to true when the reason was accepted. */
  onFail: (reason: string) => void | Promise<boolean | void>;
  loadHistory: (deliveryId: number) => Promise<DeliveryHistory[]>;
}

function openUrl(url: string | null) {
  if (url) {
    void Linking.openURL(url).catch(() => undefined);
  }
}

export function DeliveryDetailScreen({
  delivery,
  currentLocation,
  pendingActionCount,
  blockedAction,
  bannerMessage,
  errorMessage,
  isSaving,
  onBack,
  onRefreshServerState,
  onRetryBlockedAction,
  onDiscardBlockedAction,
  onPickup,
  onStart,
  onComplete,
  onFail,
  loadHistory,
}: DeliveryDetailScreenProps) {
  const { strings } = useI18n();
  const [isFailurePanelOpen, setIsFailurePanelOpen] = useState(false);
  const isBlockedByConflict = blockedAction?.state === 'conflicted';
  const isBlockedByFailure = blockedAction?.state === 'failed';
  const isCashOnDelivery = delivery.paymentMode === 'CASH_ON_DELIVERY';
  const cashLabel = formatEur(delivery.cashToCollect) || '-';

  const openNavigationChooser = (target: NavigationTarget) => {
    const urls = buildNavigationUrls(target);
    // Android alerts support at most 3 buttons: Google Maps, Waze, Cancel.
    const buttons = [
      { text: strings.detail.googleMaps, onPress: () => openUrl(urls.google) },
      { text: strings.detail.waze, onPress: () => openUrl(urls.waze) },
      ...(Platform.OS === 'ios' ? [{ text: strings.detail.appleMaps, onPress: () => openUrl(urls.apple) }] : []),
      { text: strings.detail.cancel, style: 'cancel' as const },
    ];

    Alert.alert(strings.detail.navigateChooserTitle, strings.detail.navigateChooserMessage, buttons);
  };

  const handleCompletePress = () => {
    if (!isCashOnDelivery) {
      onComplete();
      return;
    }

    Alert.alert(
      strings.detail.cashConfirmTitle,
      strings.detail.cashConfirmMessage(cashLabel),
      [
        { text: strings.detail.cancel, style: 'cancel' },
        { text: strings.detail.cashConfirmAction, onPress: onComplete },
      ],
      { cancelable: true }
    );
  };

  const handleFailSubmit = async (reason: string) => {
    const accepted = await onFail(reason);

    if (accepted !== false) {
      setIsFailurePanelOpen(false);
    }
  };

  const restaurantTel = buildTelUrl(delivery.restaurant.phone);
  const customerTel = buildTelUrl(delivery.customerPhone);

  return (
    <ScrollView contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
      <LocaleSwitcher />
      <Pressable accessibilityRole="button" style={styles.backButton} onPress={onBack}>
        <Text style={styles.backButtonText}>{strings.detail.back}</Text>
      </Pressable>

      {/* Header */}
      <View style={styles.card}>
        <Text style={styles.eyebrow}>{strings.detail.title}</Text>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{strings.detail.deliveryTitle(delivery.id)}</Text>
          <StatusBadge status={delivery.status} />
        </View>
        <DeliveryBadges delivery={delivery} />
        {delivery.orderReference ? <Text style={styles.metaLine}>{strings.detail.orderReference(delivery.orderReference)}</Text> : null}
        {delivery.description ? <Text style={styles.metaLine}>{strings.detail.orderDescription(delivery.description)}</Text> : null}
        {delivery.status === 'FAILED' && delivery.failureReason ? (
          <Text style={styles.dangerLine}>{strings.detail.failureReasonDisplay(delivery.failureReason)}</Text>
        ) : null}
        {delivery.status === 'CANCELLED' && delivery.cancellationReason ? (
          <Text style={styles.dangerLine}>{strings.detail.cancellationReasonDisplay(delivery.cancellationReason)}</Text>
        ) : null}
        {pendingActionCount ? <Text style={styles.pendingText}>{strings.detail.pendingActions(pendingActionCount)}</Text> : null}
      </View>

      {/* Payment */}
      <View testID="payment-block" style={[styles.card, isCashOnDelivery && styles.cashCard]}>
        <Text style={styles.blockTitle}>{strings.detail.paymentBlockTitle}</Text>
        {isCashOnDelivery ? (
          <>
            <Text style={styles.cashMode}>{strings.detail.cashOnDelivery}</Text>
            <Text testID="cash-to-collect" style={styles.cashAmount}>{strings.detail.cashToCollect(cashLabel)}</Text>
          </>
        ) : (
          <Text style={styles.metaLine}>{strings.detail.prepaid}</Text>
        )}
        {delivery.orderAmount !== null ? <Text style={styles.metaLine}>{strings.detail.orderAmount(formatEur(delivery.orderAmount))}</Text> : null}
        {delivery.deliveryFee !== null ? <Text style={styles.metaLine}>{strings.detail.deliveryFee(formatEur(delivery.deliveryFee))}</Text> : null}
      </View>

      {/* Restaurant */}
      <View testID="restaurant-block" style={styles.card}>
        <Text style={styles.blockTitle}>{strings.detail.restaurantBlockTitle}</Text>
        <Text style={styles.blockName}>{delivery.restaurant.name}</Text>
        <Text style={styles.metaLine}>{delivery.pickupAddress}</Text>
        <View style={styles.buttonRow}>
          <Pressable
            testID="call-restaurant"
            accessibilityRole="button"
            style={[styles.ghostButton, !restaurantTel && styles.buttonDisabled]}
            disabled={!restaurantTel}
            onPress={() => openUrl(restaurantTel)}
          >
            <Text style={styles.ghostButtonText}>{restaurantTel ? strings.detail.call : strings.detail.noPhone}</Text>
          </Pressable>
          <Pressable
            testID="navigate-restaurant"
            accessibilityRole="button"
            style={styles.ghostButton}
            onPress={() => openNavigationChooser({
              latitude: delivery.pickupLatitude,
              longitude: delivery.pickupLongitude,
              address: delivery.pickupAddress,
            })}
          >
            <Text style={styles.ghostButtonText}>{strings.detail.navigate}</Text>
          </Pressable>
        </View>
      </View>

      {/* Customer */}
      <View testID="customer-block" style={styles.card}>
        <Text style={styles.blockTitle}>{strings.detail.customerBlockTitle}</Text>
        {delivery.customerName ? <Text style={styles.blockName}>{delivery.customerName}</Text> : null}
        <Text style={styles.metaLine}>{delivery.deliveryAddress}</Text>
        {delivery.notes ? <Text style={styles.notes}>{strings.detail.customerNotes(delivery.notes)}</Text> : null}
        <View style={styles.buttonRow}>
          <Pressable
            testID="call-customer"
            accessibilityRole="button"
            style={[styles.ghostButton, !customerTel && styles.buttonDisabled]}
            disabled={!customerTel}
            onPress={() => openUrl(customerTel)}
          >
            <Text style={styles.ghostButtonText}>{customerTel ? strings.detail.call : strings.detail.noPhone}</Text>
          </Pressable>
          <Pressable
            testID="navigate-customer"
            accessibilityRole="button"
            style={styles.ghostButton}
            onPress={() => openNavigationChooser({
              latitude: delivery.deliveryLatitude,
              longitude: delivery.deliveryLongitude,
              address: delivery.deliveryAddress,
            })}
          >
            <Text style={styles.ghostButtonText}>{strings.detail.navigate}</Text>
          </Pressable>
        </View>
      </View>

      {bannerMessage ? <Text style={styles.successText}>{bannerMessage}</Text> : null}
      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

      {blockedAction ? (
        <View style={[styles.recoveryPanel, isBlockedByConflict ? styles.recoveryConflict : styles.recoveryFailure]}>
          <Text style={styles.recoveryPanelTitle}>
            {isBlockedByConflict ? strings.detail.recoveryConflictTitle : strings.detail.recoveryFailedTitle}
          </Text>
          <Text style={styles.recoveryPanelText}>
            {isBlockedByConflict ? strings.detail.recoveryConflictText : strings.detail.recoveryFailedText}
          </Text>
          {blockedAction.lastError ? <Text style={styles.recoveryError}>{strings.detail.recoveryLastError(blockedAction.lastError)}</Text> : null}

          <View style={styles.recoveryActions}>
            <Pressable style={styles.ghostButton} onPress={onRefreshServerState}>
              <Text style={styles.ghostButtonText}>{strings.detail.refreshServerState}</Text>
            </Pressable>
            {isBlockedByFailure ? (
              <Pressable style={styles.secondaryButton} onPress={onRetryBlockedAction}>
                <Text style={styles.secondaryButtonText}>{strings.detail.rescheduleAction}</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.secondaryButton} onPress={onDiscardBlockedAction}>
              <Text style={styles.secondaryButtonText}>{strings.detail.removeLocalAction}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Actions */}
      <View style={styles.actionGroup}>
        {delivery.status === 'ASSIGNED' ? (
          <Pressable testID="pickup-button" style={[styles.primaryButton, isSaving && styles.buttonDisabled]} disabled={isSaving} onPress={onPickup}>
            <Text style={styles.primaryButtonText}>{strings.detail.markPickedUp}</Text>
          </Pressable>
        ) : null}

        {delivery.status === 'PICKED_UP' ? (
          <Pressable testID="start-button" style={[styles.primaryButton, isSaving && styles.buttonDisabled]} disabled={isSaving} onPress={onStart}>
            <Text style={styles.primaryButtonText}>{strings.detail.startDelivery}</Text>
          </Pressable>
        ) : null}

        {delivery.status === 'IN_TRANSIT' ? (
          <Pressable
            testID="complete-button"
            style={[styles.primaryButton, isSaving && styles.buttonDisabled]}
            disabled={isSaving}
            onPress={handleCompletePress}
          >
            <Text style={styles.primaryButtonText}>
              {isCashOnDelivery ? `${strings.detail.markDelivered} · ${cashLabel}` : strings.detail.markDelivered}
            </Text>
          </Pressable>
        ) : null}

        {isActiveDelivery(delivery) && !isFailurePanelOpen ? (
          <Pressable
            testID="fail-delivery-button"
            style={[styles.dangerOutlineButton, isSaving && styles.buttonDisabled]}
            disabled={isSaving}
            onPress={() => setIsFailurePanelOpen(true)}
          >
            <Text style={styles.dangerOutlineText}>{strings.detail.reportFailure}</Text>
          </Pressable>
        ) : null}
      </View>

      {isActiveDelivery(delivery) && isFailurePanelOpen ? (
        <FailureReasonPanel
          isSaving={isSaving}
          onSubmit={(reason) => void handleFailSubmit(reason)}
          onCancel={() => setIsFailurePanelOpen(false)}
        />
      ) : null}

      <DeliveryMapCard delivery={delivery} currentLocation={currentLocation} />

      <HistoryTimeline delivery={delivery} loadHistory={loadHistory} />
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
  card: {
    borderRadius: 22,
    backgroundColor: palette.card,
    padding: 18,
    gap: 8,
  },
  cashCard: {
    borderWidth: 2,
    borderColor: palette.warningText,
    backgroundColor: palette.warningBg,
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
  blockTitle: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: palette.textMuted,
    fontWeight: '700',
  },
  blockName: {
    fontSize: 18,
    fontWeight: '700',
    color: palette.textStrong,
  },
  metaLine: {
    fontSize: 14,
    color: palette.textSubtle,
    lineHeight: 20,
  },
  notes: {
    fontSize: 14,
    color: palette.textStrong,
    lineHeight: 20,
    fontWeight: '600',
  },
  dangerLine: {
    fontSize: 14,
    color: palette.dangerText,
    lineHeight: 20,
    fontWeight: '600',
  },
  cashMode: {
    fontSize: 14,
    color: palette.warningText,
    fontWeight: '700',
  },
  cashAmount: {
    fontSize: 24,
    color: palette.warningText,
    fontWeight: '800',
  },
  pendingText: {
    fontSize: 13,
    color: palette.warningText,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
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
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: palette.primaryText,
    fontWeight: '700',
    fontSize: 16,
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
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.borderSoft,
    backgroundColor: palette.card,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  ghostButtonText: {
    color: palette.textStrong,
    fontWeight: '600',
    fontSize: 14,
  },
  dangerOutlineButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.dangerText,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  dangerOutlineText: {
    color: palette.dangerText,
    fontWeight: '700',
    fontSize: 15,
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
  buttonDisabled: {
    opacity: 0.6,
  },
});
