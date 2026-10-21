import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useI18n } from '../i18n/I18nProvider';
import { formatDateTime } from '../lib/format';
import { palette } from '../theme/palette';
import type { Delivery, DeliveryHistory, HistoryEvent } from '../types/api';

interface TimelineEntry {
  key: string;
  event: HistoryEvent | string;
  at: string;
  note: string | null;
}

/** Fallback timeline from the delivery's own lifecycle timestamps (offline / history error). */
export function buildFallbackTimeline(delivery: Delivery): TimelineEntry[] {
  const candidates: Array<[HistoryEvent, string | null, string | null]> = [
    ['CREATED', delivery.createdAt, null],
    ['ASSIGNED', delivery.assignedAt, null],
    ['READY', delivery.readyAt, null],
    ['PICKED_UP', delivery.pickedUpAt, null],
    ['DELIVERED', delivery.deliveredAt, null],
    ['FAILED', delivery.failedAt, delivery.failureReason],
    ['CANCELLED', delivery.cancelledAt, delivery.cancellationReason],
  ];

  return candidates
    .filter((entry): entry is [HistoryEvent, string, string | null] => Boolean(entry[1]))
    .sort((a, b) => Date.parse(a[1]) - Date.parse(b[1]))
    .map(([event, at, note]) => ({ key: `fallback-${event}`, event, at, note }));
}

function fromHistory(history: DeliveryHistory[]): TimelineEntry[] {
  return history.map((entry) => ({
    key: `history-${entry.id}`,
    event: entry.event,
    at: entry.createdAt,
    note: entry.note,
  }));
}

interface HistoryTimelineProps {
  delivery: Delivery;
  loadHistory: (deliveryId: number) => Promise<DeliveryHistory[]>;
}

export function HistoryTimeline({ delivery, loadHistory }: HistoryTimelineProps) {
  const { strings, locale } = useI18n();
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const [isFallback, setIsFallback] = useState(false);

  useEffect(() => {
    let isMounted = true;

    loadHistory(delivery.id)
      .then((history) => {
        if (isMounted) {
          setEntries(fromHistory(history));
          setIsFallback(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setEntries(buildFallbackTimeline(delivery));
          setIsFallback(true);
        }
      });

    return () => {
      isMounted = false;
    };
    // Reload when the server copy changes (version bump) or the status changes locally.
  }, [delivery.id, delivery.version, delivery.status]);

  const eventLabel = (event: string) => (strings.detail.historyEvents as Record<string, string>)[event] ?? event;

  return (
    <View testID="history-timeline" style={styles.card}>
      <Text style={styles.title}>{strings.detail.historyTitle}</Text>
      {entries === null ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={palette.primary} />
          <Text style={styles.hint}>{strings.detail.historyLoading}</Text>
        </View>
      ) : null}
      {isFallback ? <Text style={styles.hint}>{strings.detail.historyFallback}</Text> : null}
      {entries && entries.length === 0 ? <Text style={styles.hint}>{strings.detail.historyEmpty}</Text> : null}
      {entries?.map((entry, index) => (
        <View key={entry.key} style={styles.row}>
          <View style={styles.rail}>
            <View style={styles.dot} />
            {index < entries.length - 1 ? <View style={styles.line} /> : null}
          </View>
          <View style={styles.rowContent}>
            <Text style={styles.event}>{eventLabel(entry.event)}</Text>
            <Text style={styles.time}>{formatDateTime(entry.at, locale)}</Text>
            {entry.note ? <Text style={styles.note}>{entry.note}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    backgroundColor: palette.card,
    padding: 18,
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.textStrong,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hint: {
    color: palette.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  rail: {
    alignItems: 'center',
    width: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.primary,
    marginTop: 4,
  },
  line: {
    flex: 1,
    width: 2,
    backgroundColor: palette.borderSoft,
    marginTop: 2,
  },
  rowContent: {
    flex: 1,
    paddingBottom: 12,
    gap: 2,
  },
  event: {
    fontSize: 14,
    fontWeight: '700',
    color: palette.textStrong,
  },
  time: {
    fontSize: 12,
    color: palette.textMuted,
  },
  note: {
    fontSize: 13,
    color: palette.textSubtle,
  },
});
