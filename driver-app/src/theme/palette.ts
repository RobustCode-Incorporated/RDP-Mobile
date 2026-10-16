import type { DeliveryStatus } from '../types/api';

export const palette = {
  appBackground: '#F6F3EE',
  card: '#FFFFFF',
  textStrong: '#0F172A',
  textMuted: '#64748B',
  textSubtle: '#475569',
  borderSoft: '#E2E8F0',
  primary: '#111111',
  primaryText: '#FFFFFF',
  secondary: '#F1F5F9',
  secondaryText: '#0F172A',
  successBg: '#ECFDF3',
  successText: '#047857',
  dangerBg: '#FFF1F2',
  dangerText: '#BE123C',
  warningBg: '#FFFBEB',
  warningText: '#B45309',
};

type BadgeColors = { backgroundColor: string; color: string };

export const statusBadgeColors: Record<DeliveryStatus, BadgeColors> = {
  CREATED: { backgroundColor: '#F1F5F9', color: '#475569' },
  ASSIGNED: { backgroundColor: '#E0E7FF', color: '#4338CA' },
  PICKED_UP: { backgroundColor: '#FEF3C7', color: '#B45309' },
  IN_TRANSIT: { backgroundColor: '#CFFAFE', color: '#0E7490' },
  DELIVERED: { backgroundColor: '#D1FAE5', color: '#047857' },
  FAILED: { backgroundColor: '#FFE4E6', color: '#BE123C' },
  CANCELLED: { backgroundColor: '#E2E8F0', color: '#334155' },
};

const unknownStatusColors: BadgeColors = { backgroundColor: '#F1F5F9', color: '#475569' };

/** Tolerates unknown enum values coming from a newer backend (contract 1, "Enums"). */
export function getStatusBadgeColors(status: string): BadgeColors {
  return statusBadgeColors[status as DeliveryStatus] ?? unknownStatusColors;
}
