import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getSyncStatus } from '../app/syncStatus';
import { LocaleSwitcher } from '../components/LocaleSwitcher';
import { useI18n } from '../i18n/I18nProvider';
import type { DriverDeliveryDto, PendingAction, StoredSession } from '../types/api';
import { palette, statusBadgeColors } from '../theme/palette';

interface DeliveryListScreenProps {
  session: StoredSession;
  deliveries: DriverDeliveryDto[];
  pendingActionCountByDelivery: Record<number, number>;
  blockedActionByDelivery: Record<number, PendingAction>;
  blockedActionCount: number;
  lastSuccessfulSync: string | null;
  bannerMessage: string | null;
  errorMessage: string | null;
  isRefreshing: boolean;
  onRefresh: () => void;
  onRetryQueuedActions: () => void;
  onDiscardBlockedActions: () => void;
  onLogout: () => void;
  onOpenDelivery: (deliveryId: number) => void;
}

export function DeliveryListScreen({
  session,
  deliveries,
  pendingActionCountByDelivery,
  blockedActionByDelivery,
  blockedActionCount,
  lastSuccessfulSync,
  bannerMessage,
  errorMessage,
  isRefreshing,
  onRefresh,
  onRetryQueuedActions,
  onDiscardBlockedActions,
  onLogout,
  onOpenDelivery,
}: DeliveryListScreenProps) {
  const { strings } = useI18n();
  const syncStatus = getSyncStatus(lastSuccessfulSync, Date.now(), strings.sync);
  const conflictedCount = Object.values(blockedActionByDelivery).filter((action) => action.state === 'conflicted').length;
  const failedCount = Object.values(blockedActionByDelivery).filter((action) => action.state === 'failed').length;

  return (
    <ScrollView
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
    >
      <View style={styles.headerCard}>
        <LocaleSwitcher />
        <Text style={styles.eyebrow}>{strings.list.activeSession}</Text>
        <Text style={styles.title}>{strings.list.hello(session.email)}</Text>
        <Text style={styles.subtitle}>{strings.list.detectedRole(session.role)}</Text>
        {syncStatus ? (
          <Text style={[styles.syncText, syncStatus.isStale && styles.syncTextStale]}>{syncStatus.label}</Text>
        ) : null}

        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            style={[styles.secondaryButton, isRefreshing && styles.buttonDisabled]}
            disabled={isRefreshing}
            onPress={onRefresh}
          >
            <Text style={styles.secondaryButtonText}>{isRefreshing ? strings.list.refreshing : strings.list.refresh}</Text>
          </Pressable>
          <Pressable style={styles.ghostButton} onPress={onLogout}>
            <Text style={styles.ghostButtonText}>{strings.list.logout}</Text>
          </Pressable>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.secondaryButton} onPress={onRetryQueuedActions}>
            <Text style={styles.secondaryButtonText}>{strings.list.replayQueue}</Text>
          </Pressable>
          <Pressable style={styles.ghostButton} onPress={onDiscardBlockedActions}>
            <Text style={styles.ghostButtonText}>{strings.list.removeConflicts(blockedActionCount)}</Text>
          </Pressable>
        </View>
      </View>

      {blockedActionCount > 0 ? (
        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>{strings.list.blockedActionsTitle}</Text>
          <Text style={styles.warningText}>
            {strings.list.blockedActionsText(blockedActionCount)}
          </Text>
          <Text style={styles.warningMeta}>{strings.list.blockedActionsMeta(conflictedCount, failedCount)}</Text>
        </View>
      ) : null}

      {bannerMessage ? <Text style={styles.successText}>{bannerMessage}</Text> : null}
      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

      {isRefreshing && deliveries.length === 0 ? (
        <ActivityIndicator size="large" color={palette.primary} />
      ) : null}

      {deliveries.length === 0 && !isRefreshing ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{strings.list.noDeliveriesTitle}</Text>
          <Text style={styles.emptyText}>{strings.list.noDeliveriesText}</Text>
        </View>
      ) : null}

      {deliveries.map((delivery) => (
        (() => {
          const blockedAction = blockedActionByDelivery[delivery.id];

          return (
        <Pressable
          key={delivery.id}
          accessibilityRole="button"
          style={styles.deliveryCard}
          onPress={() => onOpenDelivery(delivery.id)}
        >
          <View style={styles.deliveryHeader}>
            <Text style={styles.deliveryTitle}>{strings.list.deliveryTitle(delivery.id)}</Text>
            <Text style={[styles.statusBadge, statusBadgeColors[delivery.status]]}>{delivery.status}</Text>
          </View>
          <Text style={styles.deliveryMeta}>{strings.list.pickup(delivery.pickupAddress)}</Text>
          <Text style={styles.deliveryMeta}>{strings.list.destination(delivery.deliveryAddress)}</Text>
          {delivery.restaurant?.name ? <Text style={styles.deliveryMeta}>{strings.list.restaurant(delivery.restaurant.name)}</Text> : null}
          {pendingActionCountByDelivery[delivery.id] ? (
            <Text style={styles.pendingText}>{strings.list.pendingAction(pendingActionCountByDelivery[delivery.id])}</Text>
          ) : null}
          {blockedAction ? (
            <View style={[styles.recoveryCard, blockedAction.state === 'conflicted' ? styles.conflictCard : styles.failedCard]}>
              <Text style={styles.recoveryTitle}>
                {blockedAction.state === 'conflicted' ? strings.list.conflictDetected : strings.list.recoveryRequired}
              </Text>
              <Text style={styles.recoveryText}>
                {blockedAction.state === 'conflicted'
                  ? strings.list.conflictText
                  : strings.list.failedReplayText}
              </Text>
            </View>
          ) : null}
          <Text style={styles.linkText}>{strings.list.openDetail}</Text>
        </Pressable>
          );
        })()
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    padding: 20,
    gap: 16,
    backgroundColor: palette.appBackground,
  },
  headerCard: {
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
  syncText: {
    fontSize: 13,
    color: palette.textMuted,
  },
  syncTextStale: {
    color: palette.warningText,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
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
  warningCard: {
    borderRadius: 18,
    backgroundColor: palette.warningBg,
    padding: 16,
    gap: 6,
  },
  warningTitle: {
    color: palette.warningText,
    fontSize: 15,
    fontWeight: '700',
  },
  warningText: {
    color: palette.warningText,
    fontSize: 13,
    lineHeight: 20,
  },
  warningMeta: {
    color: palette.warningText,
    fontSize: 12,
    fontWeight: '700',
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
  emptyCard: {
    borderRadius: 22,
    backgroundColor: palette.card,
    padding: 20,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: palette.textStrong,
  },
  emptyText: {
    fontSize: 14,
    color: palette.textMuted,
    lineHeight: 20,
  },
  deliveryCard: {
    borderRadius: 22,
    backgroundColor: palette.card,
    padding: 18,
    gap: 10,
  },
  deliveryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  deliveryTitle: {
    fontSize: 18,
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
  deliveryMeta: {
    fontSize: 14,
    color: palette.textSubtle,
    lineHeight: 20,
  },
  pendingText: {
    fontSize: 13,
    color: palette.warningText,
    fontWeight: '600',
  },
  recoveryCard: {
    borderRadius: 16,
    padding: 12,
    gap: 6,
  },
  conflictCard: {
    backgroundColor: palette.dangerBg,
  },
  failedCard: {
    backgroundColor: palette.warningBg,
  },
  recoveryTitle: {
    color: palette.dangerText,
    fontSize: 13,
    fontWeight: '700',
  },
  recoveryText: {
    color: palette.textSubtle,
    fontSize: 12,
    lineHeight: 18,
  },
  linkText: {
    color: palette.primary,
    fontWeight: '700',
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});