import type { DriverDeliveryDto, PendingAction, PendingActionType } from '../types/api';

const INITIAL_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_COUNT = 5;

export function calculateRetryDelayMs(retryCount: number) {
  return INITIAL_RETRY_DELAY_MS * (2 ** Math.max(0, retryCount - 1));
}

export function createPendingAction(
  deliveryId: number,
  actionType: PendingActionType,
  payload?: PendingAction['payload'],
  lastError?: string
): PendingAction {
  return {
    actionId: `${actionType}-${deliveryId}-${Date.now()}`,
    deliveryId,
    actionType,
    state: 'queued',
    payload,
    queuedAt: new Date().toISOString(),
    retryCount: 0,
    nextRetryAt: new Date().toISOString(),
    lastError,
  };
}

export function buildPendingActionCountByDelivery(actions: PendingAction[]) {
  return actions.reduce<Record<number, number>>((accumulator, action) => {
    accumulator[action.deliveryId] = (accumulator[action.deliveryId] ?? 0) + 1;
    return accumulator;
  }, {});
}

export function shouldReplayPendingAction(action: PendingAction, now = Date.now()) {
  if (action.state !== 'queued') {
    return false;
  }

  if (!action.nextRetryAt) {
    return true;
  }

  const nextRetryTimestamp = Date.parse(action.nextRetryAt);

  if (Number.isNaN(nextRetryTimestamp)) {
    return true;
  }

  return nextRetryTimestamp <= now;
}

export function markQueuedActionNetworkFailure(action: PendingAction, message: string, now = Date.now()) {
  const retryCount = action.retryCount + 1;
  const nextRetryAt = new Date(now + calculateRetryDelayMs(retryCount)).toISOString();

  return {
    ...action,
    retryCount,
    nextRetryAt,
    lastError: message,
    state: retryCount >= MAX_RETRY_COUNT ? 'failed' : 'queued',
  } satisfies PendingAction;
}

export function markQueuedActionConflicted(action: PendingAction, message: string) {
  return {
    ...action,
    state: 'conflicted',
    nextRetryAt: undefined,
    lastError: message,
  } satisfies PendingAction;
}

export function resetPendingActionForManualRetry(action: PendingAction) {
  return {
    ...action,
    state: 'queued',
    nextRetryAt: new Date().toISOString(),
  } satisfies PendingAction;
}

export function discardBlockedActions(actions: PendingAction[]) {
  return actions.filter((action) => action.state === 'queued');
}

export function patchDeliveryForOfflineAction(
  delivery: DriverDeliveryDto,
  actionType: PendingActionType,
  payload?: PendingAction['payload']
) {
  const updatedAt = new Date().toISOString();

  if (actionType === 'PICKUP') {
    return { ...delivery, status: 'PICKED_UP', updatedAt } satisfies DriverDeliveryDto;
  }

  if (actionType === 'START') {
    return { ...delivery, status: 'IN_TRANSIT', updatedAt } satisfies DriverDeliveryDto;
  }

  if (actionType === 'COMPLETE') {
    return { ...delivery, status: 'DELIVERED', updatedAt } satisfies DriverDeliveryDto;
  }

  const description = payload?.reason
    ? `${delivery.description ?? ''}${delivery.description ? ' | ' : ''}ECHEC: ${payload.reason}`
    : delivery.description;

  return {
    ...delivery,
    status: 'CANCELLED',
    updatedAt,
    description,
  } satisfies DriverDeliveryDto;
}