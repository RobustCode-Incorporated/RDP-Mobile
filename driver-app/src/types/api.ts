/**
 * Types aligned with DeliveryPlatform/docs/api-contract-v2.md (section 10.3).
 * Server responses always contain every documented field; absent values are null.
 */
export type UserRole = 'ADMIN' | 'DISPATCHER' | 'RESTAURANT' | 'DRIVER' | 'CUSTOMER';

export type DeliveryStatus =
  | 'CREATED'
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'FAILED'
  | 'CANCELLED';

export type PaymentMode = 'PREPAID' | 'CASH_ON_DELIVERY';
export type AvailabilityStatus = 'AVAILABLE' | 'BUSY' | 'OFFLINE';
export type HistoryEvent =
  | 'CREATED'
  | 'ASSIGNED'
  | 'REASSIGNED'
  | 'READY'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'FAILED'
  | 'CANCELLED'
  | 'MIGRATED';

/** Error body returned on every non-2xx response (contract section 1.1). */
export interface ApiError {
  status: number;
  error: string;
  message: string;
  timestamp: string;
  path: string;
  fieldErrors?: Record<string, string>;
}

export interface LoginResponse {
  token: string;
  email: string;
  role: UserRole;
}

export interface DeliveryRestaurant {
  id: number;
  name: string;
  address: string;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface DeliveryDriver {
  id: number;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  vehicleType: string | null;
  latitude: number | null;
  longitude: number | null;
  lastLocationAt: string | null;
}

export interface Delivery {
  id: number;
  status: DeliveryStatus;
  version: number;
  restaurant: DeliveryRestaurant;
  driver: DeliveryDriver | null;
  customerName: string | null;
  customerPhone: string | null;
  pickupAddress: string;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  deliveryAddress: string;
  deliveryLatitude: number | null;
  deliveryLongitude: number | null;
  description: string | null;
  notes: string | null;
  orderReference: string | null;
  orderAmount: number | null;
  paymentMode: PaymentMode;
  cashToCollect: number | null;
  deliveryFee: number | null;
  failureReason: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string | null;
  readyAt: string | null;
  assignedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
}

export interface DeliveryHistory {
  id: number;
  event: HistoryEvent;
  oldStatus: DeliveryStatus | null;
  newStatus: DeliveryStatus;
  changedBy: string;
  note: string | null;
  createdAt: string;
}

export interface Driver {
  id: number;
  userId: number;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  vehicleType: string | null;
  vehiclePlate: string | null;
  availabilityStatus: AvailabilityStatus;
  currentLatitude: number | null;
  currentLongitude: number | null;
  lastLocationAt: string | null;
}

/** `fail.reason`: required, not blank, max 180 (contract 4.9). */
export const FAIL_REASON_MAX_LENGTH = 180;

export const ACTIVE_DELIVERY_STATUSES: readonly DeliveryStatus[] = ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'];
export const TERMINAL_DELIVERY_STATUSES: readonly DeliveryStatus[] = ['DELIVERED', 'FAILED', 'CANCELLED'];

export function isActiveDelivery(delivery: Pick<Delivery, 'status'>) {
  return ACTIVE_DELIVERY_STATUSES.includes(delivery.status);
}

export function isTerminalDelivery(delivery: Pick<Delivery, 'status'>) {
  return TERMINAL_DELIVERY_STATUSES.includes(delivery.status);
}

/* ---- Local (client-only) types ---- */

export interface StoredSession {
  token: string;
  email: string;
  role: UserRole;
}

export type PendingActionType = 'PICKUP' | 'START' | 'COMPLETE' | 'FAIL';

export interface PendingAction {
  actionId: string;
  deliveryId: number;
  actionType: PendingActionType;
  state: 'queued' | 'failed' | 'conflicted';
  payload?: {
    reason?: string;
  };
  /** Email of the driver who queued the action; actions of another driver are dropped at login. */
  ownerEmail?: string;
  queuedAt: string;
  retryCount: number;
  nextRetryAt?: string;
  lastError?: string;
}

export interface CachedDeliveriesState {
  deliveries: Delivery[];
  lastSuccessfulSync: string;
}
