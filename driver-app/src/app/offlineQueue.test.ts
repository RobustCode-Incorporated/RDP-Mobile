import { describe, expect, it } from '@jest/globals';
import {
  buildPendingActionCountByDelivery,
  calculateRetryDelayMs,
  createPendingAction,
  discardBlockedActions,
  markQueuedActionConflicted,
  markQueuedActionNetworkFailure,
  patchDeliveryForOfflineAction,
  resetPendingActionForManualRetry,
  shouldReplayPendingAction,
} from './offlineQueue';
import type { DriverDeliveryDto, PendingAction } from '../types/api';

describe('offlineQueue helpers', () => {
  it('counts queued actions by delivery', () => {
    const actions: PendingAction[] = [
      { ...createPendingAction(1, 'PICKUP'), state: 'queued' },
      { ...createPendingAction(1, 'START'), state: 'queued' },
      { ...createPendingAction(2, 'FAIL'), state: 'failed' },
    ];

    expect(buildPendingActionCountByDelivery(actions)).toEqual({ 1: 2, 2: 1 });
  });

  it('marks queued actions as failed after max retries', () => {
    const failed = markQueuedActionNetworkFailure(
      {
        ...createPendingAction(3, 'COMPLETE'),
        retryCount: 4,
      },
      'Network down'
    );

    expect(failed.retryCount).toBe(5);
    expect(failed.state).toBe('failed');
    expect(failed.lastError).toBe('Network down');
  });

  it('applies exponential backoff between queued replay attempts', () => {
    expect(calculateRetryDelayMs(1)).toBe(30_000);
    expect(calculateRetryDelayMs(2)).toBe(60_000);
    expect(calculateRetryDelayMs(3)).toBe(120_000);
  });

  it('waits until the scheduled retry time before replaying a queued action', () => {
    const waitingAction: PendingAction = {
      ...createPendingAction(7, 'START'),
      nextRetryAt: '2026-07-15T10:05:00.000Z',
    };

    expect(shouldReplayPendingAction(waitingAction, new Date('2026-07-15T10:04:59.000Z').getTime())).toBe(false);
    expect(shouldReplayPendingAction(waitingAction, new Date('2026-07-15T10:05:00.000Z').getTime())).toBe(true);
  });

  it('resets a blocked action for immediate manual replay', () => {
    const reset = resetPendingActionForManualRetry({
      ...createPendingAction(8, 'FAIL'),
      state: 'failed',
      retryCount: 5,
      nextRetryAt: '2026-07-15T11:00:00.000Z',
    });

    expect(reset.state).toBe('queued');
    expect(reset.nextRetryAt).toBeDefined();
  });

  it('marks queued actions as conflicted on server-state mismatch', () => {
    const conflicted = markQueuedActionConflicted(createPendingAction(4, 'FAIL'), 'Conflict');
    expect(conflicted.state).toBe('conflicted');
    expect(conflicted.lastError).toBe('Conflict');
  });

  it('discards only blocked actions and keeps queued ones', () => {
    const actions: PendingAction[] = [
      { ...createPendingAction(1, 'PICKUP'), state: 'queued' },
      { ...createPendingAction(2, 'START'), state: 'failed' },
      { ...createPendingAction(3, 'FAIL'), state: 'conflicted' },
    ];

    expect(discardBlockedActions(actions)).toHaveLength(1);
    expect(discardBlockedActions(actions)[0].deliveryId).toBe(1);
  });

  it('patches a delivery locally for offline fail actions', () => {
    const delivery: DriverDeliveryDto = {
      id: 9,
      pickupAddress: 'A',
      deliveryAddress: 'B',
      description: 'Initiale',
      status: 'IN_TRANSIT',
      createdAt: '2026-07-15T10:00:00',
      updatedAt: null,
    };

    const patched = patchDeliveryForOfflineAction(delivery, 'FAIL', { reason: 'Client absent' });

    expect(patched.status).toBe('CANCELLED');
    expect(patched.description).toContain('ECHEC: Client absent');
  });
});