import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { Text, View } from 'react-native';
import { triggerUnauthorizedHandlerForTests } from '../api/client';
import { failDelivery, fetchDelivery, fetchMyDeliveries, startDelivery } from '../api/driver';
import { AxiosError, AxiosHeaders } from 'axios';
import { clearDeliveryCache, clearPendingActions, clearSession, loadDeliveryCache, loadPendingActions, loadSession, saveDeliveryCache, savePendingActions } from '../lib/session';
import { useDriverApp } from './useDriverApp';
import { buildDelivery } from '../test/fixtures';
import type { Delivery, PendingAction, StoredSession } from '../types/api';

jest.mock('../api/auth', () => ({
  login: jest.fn(),
}));

jest.mock('../api/driver', () => ({
  fetchMyDeliveries: jest.fn(),
  fetchDelivery: jest.fn(),
  fetchDeliveryHistory: jest.fn(),
  updateMyLocation: jest.fn(),
  pickupDelivery: jest.fn(),
  startDelivery: jest.fn(),
  completeDelivery: jest.fn(),
  failDelivery: jest.fn(),
}));

jest.mock('../lib/session', () => ({
  saveSession: jest.fn(),
  loadSession: jest.fn(),
  clearSession: jest.fn(),
  saveDeliveryCache: jest.fn(),
  loadDeliveryCache: jest.fn(),
  clearDeliveryCache: jest.fn(),
  savePendingActions: jest.fn(),
  loadPendingActions: jest.fn(),
  clearPendingActions: jest.fn(),
}));

const loadSessionMock = loadSession as jest.MockedFunction<typeof loadSession>;
const loadDeliveryCacheMock = loadDeliveryCache as jest.MockedFunction<typeof loadDeliveryCache>;
const loadPendingActionsMock = loadPendingActions as jest.MockedFunction<typeof loadPendingActions>;
const fetchMyDeliveriesMock = fetchMyDeliveries as jest.MockedFunction<typeof fetchMyDeliveries>;
const startDeliveryMock = startDelivery as jest.MockedFunction<typeof startDelivery>;
const savePendingActionsMock = savePendingActions as jest.MockedFunction<typeof savePendingActions>;
const clearSessionMock = clearSession as jest.MockedFunction<typeof clearSession>;
const clearPendingActionsMock = clearPendingActions as jest.MockedFunction<typeof clearPendingActions>;
const failDeliveryMock = failDelivery as jest.MockedFunction<typeof failDelivery>;
const fetchDeliveryMock = fetchDelivery as jest.MockedFunction<typeof fetchDelivery>;
const saveDeliveryCacheMock = saveDeliveryCache as jest.MockedFunction<typeof saveDeliveryCache>;

function httpError(status: number | null, message = 'error') {
  const config = { url: '/api/deliveries/1/fail', headers: new AxiosHeaders() };
  const response = status === null ? undefined : {
    status, statusText: '', headers: {}, config,
    data: { status, error: 'x', message, timestamp: 'x', path: config.url },
  };
  return new AxiosError(message, status === null ? 'ERR_NETWORK' : 'ERR_BAD_REQUEST', config, {}, response as never);
}

const clearDeliveryCacheMock = clearDeliveryCache as jest.MockedFunction<typeof clearDeliveryCache>;

const baseSession: StoredSession = {
  token: 'token-123',
  email: 'driver@test.com',
  role: 'DRIVER',
};

const pickedUpDelivery: Delivery = buildDelivery({
  id: 1,
  status: 'PICKED_UP',
  updatedAt: '2026-07-15T08:30:00.000Z',
});

let latestApp: ReturnType<typeof useDriverApp> | null = null;

function DriverAppHarness() {
  const app = useDriverApp();
  latestApp = app;

  return (
    <View>
      <Text>{`screen:${app.screen}`}</Text>
      <Text>{`session:${app.session?.email ?? 'none'}`}</Text>
      <Text>{`deliveries:${app.deliveries.length}`}</Text>
      <Text>{`error:${app.errorMessage ?? 'none'}`}</Text>
      <Text>{`banner:${app.bannerMessage ?? 'none'}`}</Text>
      <Text>{`pending:${app.pendingActions.length}`}</Text>
      <Text>{`statuses:${app.deliveries.map((delivery) => delivery.status).join(',')}`}</Text>
    </View>
  );
}

describe('useDriverApp integration coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadSessionMock.mockResolvedValue(baseSession);
    loadDeliveryCacheMock.mockResolvedValue(null);
    loadPendingActionsMock.mockResolvedValue([]);
    fetchMyDeliveriesMock.mockResolvedValue([pickedUpDelivery]);
    startDeliveryMock.mockResolvedValue({
      ...pickedUpDelivery,
      status: 'IN_TRANSIT',
      updatedAt: '2026-07-15T11:20:00.000Z',
    });
  });

  it('resets session state on unauthorized callback', async () => {
    const screen = await render(<DriverAppHarness />);

    await waitFor(() => {
      expect(screen.getByText('session:driver@test.com')).toBeTruthy();
      expect(screen.getByText('screen:list')).toBeTruthy();
    });

    await act(async () => {
      await triggerUnauthorizedHandlerForTests();
    });

    await waitFor(() => {
      expect(screen.getByText('session:none')).toBeTruthy();
      expect(screen.getByText('screen:login')).toBeTruthy();
      expect(screen.getByText('error:Votre session a expire. Veuillez vous reconnecter.')).toBeTruthy();
    });

    expect(clearSessionMock).toHaveBeenCalled();
    expect(clearDeliveryCacheMock).toHaveBeenCalled();
    // Contract 9.2: a 401 keeps the offline queue so it can be replayed after re-login.
    expect(clearPendingActionsMock).not.toHaveBeenCalled();
  });

  it('replays queued actions during refresh and clears replayed queue items', async () => {
    const queuedStartAction: PendingAction = {
      actionId: 'queued-1',
      deliveryId: 1,
      actionType: 'START',
      state: 'queued',
      queuedAt: '2026-07-15T11:00:00.000Z',
      retryCount: 0,
    };

    loadDeliveryCacheMock.mockResolvedValue({
      deliveries: [pickedUpDelivery],
      lastSuccessfulSync: '2026-07-15T11:05:00.000Z',
    });
    loadPendingActionsMock.mockResolvedValue([queuedStartAction]);
    fetchMyDeliveriesMock.mockResolvedValue([
      {
        ...pickedUpDelivery,
        status: 'IN_TRANSIT',
        updatedAt: '2026-07-15T11:20:00.000Z',
      },
    ]);

    const screen = await render(<DriverAppHarness />);

    await waitFor(() => {
      expect(startDeliveryMock).toHaveBeenCalledWith(1);
    });

    await waitFor(() => {
      expect(savePendingActionsMock).toHaveBeenCalledWith([]);
      expect(screen.getByText('pending:0')).toBeTruthy();
    });
  });

  it('queues an offline failure as FAILED + failureReason (no CANCELLED / ECHEC hack)', async () => {
    failDeliveryMock.mockRejectedValue(httpError(null));
    const screen = await render(<DriverAppHarness />);

    await waitFor(() => {
      expect(screen.getByText('statuses:PICKED_UP')).toBeTruthy();
    });

    await act(async () => {
      await latestApp!.handleFailDelivery(1, 'Client absent');
    });

    await waitFor(() => {
      expect(screen.getByText('statuses:FAILED')).toBeTruthy();
      expect(screen.getByText('pending:1')).toBeTruthy();
    });

    const savedQueue = savePendingActionsMock.mock.calls.at(-1)?.[0] as PendingAction[];
    expect(savedQueue[0]).toEqual(expect.objectContaining({ actionType: 'FAIL', payload: { reason: 'Client absent' }, ownerEmail: 'driver@test.com' }));
    const savedCache = saveDeliveryCacheMock.mock.calls.at(-1)?.[0];
    expect(savedCache?.deliveries[0]).toEqual(expect.objectContaining({ status: 'FAILED', failureReason: 'Client absent' }));
    expect(savedCache?.deliveries[0].description).toBe(pickedUpDelivery.description);
  });

  it('refuses to fail a delivery without a reason', async () => {
    const screen = await render(<DriverAppHarness />);
    await waitFor(() => expect(screen.getByText('screen:list')).toBeTruthy());

    let accepted = true;
    await act(async () => {
      accepted = await latestApp!.handleFailDelivery(1, '   ');
    });

    expect(accepted).toBe(false);
    expect(failDeliveryMock).not.toHaveBeenCalled();
    expect(screen.getByText('error:Veuillez saisir une raison d echec avant l envoi.')).toBeTruthy();
  });

  it('replays a queued action that gets 409 as done when the server already reached the target status', async () => {
    const queuedFail: PendingAction = {
      actionId: 'queued-fail',
      deliveryId: 1,
      actionType: 'FAIL',
      state: 'queued',
      payload: { reason: 'Client absent' },
      queuedAt: '2026-07-15T11:00:00.000Z',
      retryCount: 0,
    };
    const failedOnServer = { ...pickedUpDelivery, status: 'FAILED' as const, failureReason: 'Client absent' };
    loadPendingActionsMock.mockResolvedValue([queuedFail]);
    failDeliveryMock.mockRejectedValue(httpError(409, 'Cannot change delivery status from FAILED to FAILED'));
    fetchDeliveryMock.mockResolvedValue(failedOnServer);
    fetchMyDeliveriesMock.mockResolvedValue([failedOnServer]);

    const screen = await render(<DriverAppHarness />);

    await waitFor(() => {
      expect(fetchDeliveryMock).toHaveBeenCalledWith(1);
      expect(screen.getByText('pending:0')).toBeTruthy();
      expect(screen.getByText('statuses:FAILED')).toBeTruthy();
    });
  });
});
