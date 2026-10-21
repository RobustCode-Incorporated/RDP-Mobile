import { StyleSheet, Text, View } from 'react-native';
import { useI18n } from '../i18n/I18nProvider';
import { getStatusLabel } from '../i18n/strings';
import { formatEur } from '../lib/format';
import { getStatusBadgeColors, palette } from '../theme/palette';
import type { Delivery } from '../types/api';

export function StatusBadge({ status }: { status: string }) {
  const { strings } = useI18n();

  return (
    <Text testID="status-badge" style={[styles.badge, getStatusBadgeColors(status)]}>
      {getStatusLabel(status, strings)}
    </Text>
  );
}

/** "Prête" when food is ready (before pickup) and cash-on-delivery amount. */
export function DeliveryBadges({ delivery }: { delivery: Delivery }) {
  const { strings } = useI18n();
  const isReady = Boolean(delivery.readyAt) && (delivery.status === 'ASSIGNED' || delivery.status === 'CREATED');
  const isCashOnDelivery = delivery.paymentMode === 'CASH_ON_DELIVERY';

  if (!isReady && !isCashOnDelivery) {
    return null;
  }

  return (
    <View style={styles.row}>
      {isReady ? (
        <Text testID="ready-badge" style={[styles.badge, styles.ready]}>{strings.list.readyBadge}</Text>
      ) : null}
      {isCashOnDelivery ? (
        <Text testID="cash-badge" style={[styles.badge, styles.cash]}>
          {strings.list.cashBadge(formatEur(delivery.cashToCollect))}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
  },
  ready: {
    backgroundColor: palette.successBg,
    color: palette.successText,
  },
  cash: {
    backgroundColor: palette.warningBg,
    color: palette.warningText,
  },
});
