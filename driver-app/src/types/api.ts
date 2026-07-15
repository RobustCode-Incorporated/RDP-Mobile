export type UserRole = 'ADMIN' | 'DISPATCHER' | 'RESTAURANT' | 'DRIVER' | 'CUSTOMER';

export interface LoginResponse {
  token: string;
  email: string;
  role: UserRole;
}

export interface DriverDeliveryDto {
  id: number;
  pickupAddress: string;
  deliveryAddress: string;
  description: string | null;
  status: 'PENDING' | 'ASSIGNED' | 'PICKED_UP' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string | null;
  customer?: {
    id: number;
    firstName?: string;
    lastName?: string;
    email?: string;
  };
  restaurant?: {
    id: number;
    name?: string;
    address?: string;
  };
  driver?: {
    id: number;
  };
}

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
  queuedAt: string;
  retryCount: number;
  nextRetryAt?: string;
  lastError?: string;
}

export interface CachedDeliveriesState {
  deliveries: DriverDeliveryDto[];
  lastSuccessfulSync: string;
}