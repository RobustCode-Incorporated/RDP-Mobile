import { getApiErrorMessage, getApiErrorStatus, isRetryableError } from '../api/client';
import type { Delivery, DeliveryStatus, PendingAction, PendingActionType } from '../types/api';
import { isTerminalDelivery } from '../types/api';

const INITIAL_RETRY_DELAY_MS = 30_000;
export const MAX_RETRY_COUNT = 5;

/** Server status reached when the action succeeds (contract 4.9). */
export const ACTION_TARGET_STATUS: Record<PendingActionType, DeliveryStatus> = {
  PICKUP: 'PICKED_UP',
  START: 'IN_TRANSIT',
  COMPLETE: 'DELIVERED',
  FAIL: 'FAILED',
};

export function calculateRetryDelayMs(retryCount: number) {
  return INITIAL_RETRY_DELAY_MS * (2 ** Math.max(0, retryCount - 1));
}

export function createPendingAction(
  deliveryId: number,
  actionType: PendingActionType,
  payload?: PendingAction['payload'],
  lastError?: string,
  ownerEmail?: string
): PendingAction {
  return {
    actionId: `${actionType}-${deliveryId}-${Date.now()}`,
    deliveryId,
    actionType,
    state: 'queued',
    payload,
    ownerEmail,
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

/** Keeps only actions queued by `email` (or legacy actions without owner). */
export function filterQueueForOwner(actions: PendingAction[], email: string) {
  return actions.filter((action) => !action.ownerEmail || action.ownerEmail === email);
}

/**
 * Optimistic local transition, mirroring the server state machine (contract 3.1).
 * A failure is `FAILED` + `failureReason` (the v1 `CANCELLED` + "ECHEC:" hack is gone, contract 9.2).
 */
export function patchDeliveryForOfflineAction(
  delivery: Delivery,
  actionType: PendingActionType,
  payload?: PendingAction['payload'],
  now = new Date()
): Delivery {
  const timestamp = now.toISOString();
  const base = { ...delivery, status: ACTION_TARGET_STATUS[actionType], updatedAt: timestamp };

  if (actionType === 'PICKUP') {
    return { ...base, pickedUpAt: timestamp };
  }

  if (actionType === 'COMPLETE') {
    return { ...base, deliveredAt: timestamp };
  }

  if (actionType === 'FAIL') {
    return { ...base, failedAt: timestamp, failureReason: payload?.reason ?? null };
  }

  return base;
}

/**
 * Re-applies still-queued actions on top of a fresh server list so the driver keeps
 * seeing the optimistic state while an action waits for its next retry.
 */
export function applyQueuedActionsToDeliveries(deliveries: Delivery[], queue: PendingAction[]) {
  const queued = queue.filter((action) => action.state === 'queued');

  if (queued.length === 0) {
    return deliveries;
  }

  return deliveries.map((delivery) => queued
    .filter((action) => action.deliveryId === delivery.id)
    .reduce((current, action) => (
      current.status === ACTION_TARGET_STATUS[action.actionType] || isTerminalDelivery(current)
        ? current
        : patchDeliveryForOfflineAction(current, action.actionType, action.payload)
    ), delivery));
}

/* ------------------------------------------------------------------ */
/* Replay (contract 9.2)                                               */
/* ------------------------------------------------------------------ */

export type ReplayEventType =
  | 'success'
  | 'already_done'
  | 'conflict'
  | 'dropped'
  | 'network_retry'
  | 'max_retries'
  | 'unauthorized';

export interface ReplayEvent {
  type: ReplayEventType;
  action: PendingAction;
  message?: string;
  serverStatus?: DeliveryStatus;
}

export interface ReplayDependencies {
  execute: (action: PendingAction) => Promise<Delivery>;
  fetchDelivery: (deliveryId: number) => Promise<Delivery>;
  now?: () => number;
}

export interface ReplayOutcome {
  queue: PendingAction[];
  /** Fresh server copies to replace locally. */
  updatedDeliveries: Delivery[];
  /** Deliveries whose action was dropped (reassigned / not found). */
  droppedDeliveryIds: number[];
  events: ReplayEvent[];
  /** Number of queued actions that were not due yet (backoff) or waiting behind a blocked one. */
  deferredCount: number;
  stoppedReason: null | 'network' | 'unauthorized';
}

/**
 * Replays the queue in order:
 * - 200 -> success, replace local copy.
 * - 409 -> GET the delivery; if it already has the action's target status the action is
 *   done, otherwise it is marked conflicted and the server copy is surfaced.
 * - 403 / 404 -> delivery reassigned or gone: drop the action.
 * - 401 -> stop, keep the queue (re-login, then replay).
 * - network / 5xx -> bounded exponential backoff, stop for this round.
 * - other 4xx -> conflicted with the server message.
 * Later actions of a delivery wait while an earlier one for the same delivery is blocked.
 */
export async function replayPendingQueue(
  queue: PendingAction[],
  dependencies: ReplayDependencies
): Promise<ReplayOutcome> {
  const now = dependencies.now ?? Date.now;
  let workingQueue = [...queue];
  const updatedDeliveries: Delivery[] = [];
  const droppedDeliveryIds: number[] = [];
  const events: ReplayEvent[] = [];
  const blockedDeliveryIds = new Set<number>();
  let deferredCount = 0;

  const replace = (actionId: string, next: PendingAction | null) => {
    workingQueue = next
      ? workingQueue.map((item) => (item.actionId === actionId ? next : item))
      : workingQueue.filter((item) => item.actionId !== actionId);
  };

  const outcome = (stoppedReason: ReplayOutcome['stoppedReason']): ReplayOutcome => ({
    queue: workingQueue,
    updatedDeliveries,
    droppedDeliveryIds,
    events,
    deferredCount,
    stoppedReason,
  });

  const handleRetryable = (action: PendingAction, error: unknown) => {
    const next = markQueuedActionNetworkFailure(action, getApiErrorMessage(error), now());
    replace(action.actionId, next);
    events.push({ type: next.state === 'failed' ? 'max_retries' : 'network_retry', action: next });
  };

  for (const action of queue) {
    if (action.state !== 'queued') {
      blockedDeliveryIds.add(action.deliveryId);
      continue;
    }

    if (blockedDeliveryIds.has(action.deliveryId) || !shouldReplayPendingAction(action, now())) {
      blockedDeliveryIds.add(action.deliveryId);
      deferredCount += 1;
      continue;
    }

    try {
      const updated = await dependencies.execute(action);
      updatedDeliveries.push(updated);
      replace(action.actionId, null);
      events.push({ type: 'success', action, serverStatus: updated.status });
      continue;
    } catch (error) {
      if (isRetryableError(error)) {
        handleRetryable(action, error);
        return outcome('network');
      }

      const status = getApiErrorStatus(error);

      if (status === 401) {
        events.push({ type: 'unauthorized', action });
        return outcome('unauthorized');
      }

      if (status === 403 || status === 404) {
        replace(action.actionId, null);
        droppedDeliveryIds.push(action.deliveryId);
        events.push({ type: 'dropped', action, message: getApiErrorMessage(error) });
        continue;
      }

      if (status !== 409) {
        replace(action.actionId, markQueuedActionConflicted(action, getApiErrorMessage(error)));
        blockedDeliveryIds.add(action.deliveryId);
        events.push({ type: 'conflict', action, message: getApiErrorMessage(error) });
        continue;
      }

      // 409: re-fetch and compare with the action's target status.
      try {
        const serverDelivery = await dependencies.fetchDelivery(action.deliveryId);
        updatedDeliveries.push(serverDelivery);

        if (serverDelivery.status === ACTION_TARGET_STATUS[action.actionType]) {
          replace(action.actionId, null);
          events.push({ type: 'already_done', action, serverStatus: serverDelivery.status });
        } else {
          replace(action.actionId, markQueuedActionConflicted(action, getApiErrorMessage(error)));
          blockedDeliveryIds.add(action.deliveryId);
          events.push({
            type: 'conflict',
            action,
            message: getApiErrorMessage(error),
            serverStatus: serverDelivery.status,
          });
        }
      } catch (fetchError) {
        if (isRetryableError(fetchError)) {
          handleRetryable(action, fetchError);
          return outcome('network');
        }

        const fetchStatus = getApiErrorStatus(fetchError);

        if (fetchStatus === 401) {
          events.push({ type: 'unauthorized', action });
          return outcome('unauthorized');
        }

        if (fetchStatus === 403 || fetchStatus === 404) {
          replace(action.actionId, null);
          droppedDeliveryIds.push(action.deliveryId);
          events.push({ type: 'dropped', action, message: getApiErrorMessage(fetchError) });
          continue;
        }

        replace(action.actionId, markQueuedActionConflicted(action, getApiErrorMessage(error)));
        blockedDeliveryIds.add(action.deliveryId);
        events.push({ type: 'conflict', action, message: getApiErrorMessage(error) });
      }
    }
  }

  return outcome(null);
}
