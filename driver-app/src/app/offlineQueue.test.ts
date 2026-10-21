import { describe, expect, it, jest } from '@jest/globals';
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
  applyQueuedActionsToDeliveries,
  filterQueueForOwner,
  MAX_RETRY_COUNT,
  replayPendingQueue,
} from './offlineQueue';
import { AxiosError, AxiosHeaders } from 'axios';
import type { PendingAction } from '../types/api';
import { buildDelivery } from '../test/fixtures';

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

  it('patches a delivery locally for offline fail actions as FAILED + failureReason', () => {
    const delivery = buildDelivery({ id: 9, description: 'Initiale', status: 'IN_TRANSIT' });

    const patched = patchDeliveryForOfflineAction(delivery, 'FAIL', { reason: 'Client absent' }, new Date('2026-10-16T12:00:00.000Z'));

    expect(patched.status).toBe('FAILED');
    expect(patched.failureReason).toBe('Client absent');
    expect(patched.failedAt).toBe('2026-10-16T12:00:00.000Z');
    expect(patched.description).toBe('Initiale');
    expect(patched.description).not.toContain('ECHEC');
  });

  it('mirrors the server state machine for the other offline transitions', () => {
    const assigned = buildDelivery({ status: 'ASSIGNED' });
    const pickedUp = patchDeliveryForOfflineAction(assigned, 'PICKUP');
    const inTransit = patchDeliveryForOfflineAction(pickedUp, 'START');
    const delivered = patchDeliveryForOfflineAction(inTransit, 'COMPLETE');

    expect(pickedUp.status).toBe('PICKED_UP');
    expect(pickedUp.pickedUpAt).not.toBeNull();
    expect(inTransit.status).toBe('IN_TRANSIT');
    expect(delivered.status).toBe('DELIVERED');
    expect(delivered.deliveredAt).not.toBeNull();
  });

  it('re-applies queued actions over a fresh server list', () => {
    const server = [buildDelivery({ id: 1, status: 'ASSIGNED' }), buildDelivery({ id: 2, status: 'ASSIGNED' })];
    const queue = [
      createPendingAction(1, 'PICKUP'),
      createPendingAction(1, 'START'),
      { ...createPendingAction(2, 'PICKUP'), state: 'conflicted' as const },
    ];

    const merged = applyQueuedActionsToDeliveries(server, queue);

    expect(merged[0].status).toBe('IN_TRANSIT');
    expect(merged[1].status).toBe('ASSIGNED');
  });

  it('keeps only the actions queued by the logged-in driver', () => {
    const queue = [
      createPendingAction(1, 'PICKUP', undefined, undefined, 'a@test.com'),
      createPendingAction(2, 'PICKUP', undefined, undefined, 'b@test.com'),
      createPendingAction(3, 'PICKUP'),
    ];

    expect(filterQueueForOwner(queue, 'a@test.com').map((action) => action.deliveryId)).toEqual([1, 3]);
  });
});

function httpError(status: number | null, message = 'error') {
  const config = { url: '/api/deliveries/1/pickup', headers: new AxiosHeaders() };
  const response = status === null ? undefined : {
    status,
    statusText: '',
    headers: {},
    config,
    data: { status, error: 'x', message, timestamp: 'x', path: config.url },
  };

  return new AxiosError(message, status === null ? 'ERR_NETWORK' : 'ERR_BAD_REQUEST', config, {}, response as never);
}

describe('replayPendingQueue (contract 9.2)', () => {
  const now = () => new Date('2026-10-16T12:00:00.000Z').getTime();
  const queued = (deliveryId: number, actionType: PendingAction['actionType'], payload?: PendingAction['payload']): PendingAction => ({
    ...createPendingAction(deliveryId, actionType, payload),
    actionId: `${actionType}-${deliveryId}`,
    nextRetryAt: undefined,
  });

  it('removes successful actions and returns the server copy', async () => {
    const execute = jest.fn(async () => buildDelivery({ id: 1, status: 'PICKED_UP' }));
    const outcome = await replayPendingQueue([queued(1, 'PICKUP')], { execute, fetchDelivery: jest.fn(async () => buildDelivery()), now });

    expect(outcome.queue).toEqual([]);
    expect(outcome.updatedDeliveries[0].status).toBe('PICKED_UP');
    expect(outcome.events[0].type).toBe('success');
  });

  it('on 409 treats the action as done when the server already has the target status', async () => {
    const execute = jest.fn(async () => { throw httpError(409, 'Cannot change delivery status from FAILED to FAILED'); });
    const serverCopy = buildDelivery({ id: 1, status: 'FAILED', failureReason: 'Client absent' });
    const fetchDelivery = jest.fn(async () => serverCopy);

    const outcome = await replayPendingQueue([queued(1, 'FAIL', { reason: 'Client absent' })], { execute, fetchDelivery, now });

    expect(fetchDelivery).toHaveBeenCalledWith(1);
    expect(outcome.queue).toEqual([]);
    expect(outcome.updatedDeliveries).toEqual([serverCopy]);
    expect(outcome.events[0].type).toBe('already_done');
  });

  it('on 409 marks the action conflicted and surfaces the server state otherwise', async () => {
    const execute = jest.fn(async () => { throw httpError(409, 'Cannot change delivery status from CANCELLED to PICKED_UP'); });
    const serverCopy = buildDelivery({ id: 1, status: 'CANCELLED' });

    const outcome = await replayPendingQueue(
      [queued(1, 'PICKUP'), queued(1, 'START'), queued(2, 'PICKUP')],
      { execute, fetchDelivery: jest.fn(async () => serverCopy), now }
    );

    expect(outcome.queue[0].state).toBe('conflicted');
    expect(outcome.queue[0].lastError).toBe('Cannot change delivery status from CANCELLED to PICKED_UP');
    expect(outcome.updatedDeliveries).toContain(serverCopy);
    expect(outcome.events[0]).toEqual(expect.objectContaining({ type: 'conflict', serverStatus: 'CANCELLED' }));
    // START for delivery 1 waits behind the conflicted PICKUP; delivery 2 is still replayed.
    expect(outcome.queue[1]).toEqual(expect.objectContaining({ actionType: 'START', state: 'queued' }));
    expect(execute).toHaveBeenCalledTimes(2);
    expect(outcome.deferredCount).toBe(1);
  });

  it('drops the action on 403 (reassigned)', async () => {
    const execute = jest.fn(async () => { throw httpError(403, 'Driver not assigned to this delivery'); });
    const outcome = await replayPendingQueue([queued(1, 'PICKUP')], { execute, fetchDelivery: jest.fn(async () => buildDelivery()), now });

    expect(outcome.queue).toEqual([]);
    expect(outcome.droppedDeliveryIds).toEqual([1]);
  });

  it('keeps the queue and stops on 401', async () => {
    const execute = jest.fn(async () => { throw httpError(401, 'Authentication required'); });
    const queue = [queued(1, 'PICKUP'), queued(2, 'PICKUP')];
    const outcome = await replayPendingQueue(queue, { execute, fetchDelivery: jest.fn(async () => buildDelivery()), now });

    expect(outcome.stoppedReason).toBe('unauthorized');
    expect(outcome.queue).toEqual(queue);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('applies bounded backoff on network errors and 5xx', async () => {
    const execute = jest.fn(async () => { throw httpError(null); });
    const first = await replayPendingQueue([queued(1, 'PICKUP')], { execute, fetchDelivery: jest.fn(async () => buildDelivery()), now });

    expect(first.stoppedReason).toBe('network');
    expect(first.queue[0].retryCount).toBe(1);
    expect(first.queue[0].nextRetryAt).toBe('2026-10-16T12:00:30.000Z');

    const execute5xx = jest.fn(async () => { throw httpError(503); });
    const last = await replayPendingQueue(
      [{ ...queued(1, 'PICKUP'), retryCount: MAX_RETRY_COUNT - 1 }],
      { execute: execute5xx, fetchDelivery: jest.fn(async () => buildDelivery()), now }
    );

    expect(last.queue[0].state).toBe('failed');
    expect(last.events[0].type).toBe('max_retries');
  });

  it('retries later when the 409 re-fetch itself fails on the network', async () => {
    const execute = jest.fn(async () => { throw httpError(409); });
    const fetchDelivery = jest.fn(async () => { throw httpError(null); });
    const outcome = await replayPendingQueue([queued(1, 'COMPLETE')], { execute, fetchDelivery, now });

    expect(outcome.queue[0]).toEqual(expect.objectContaining({ state: 'queued', retryCount: 1 }));
    expect(outcome.stoppedReason).toBe('network');
  });
});
