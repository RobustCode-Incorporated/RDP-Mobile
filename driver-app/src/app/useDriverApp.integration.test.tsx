import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { Text, View } from 'react-native';
import { triggerUnauthorizedHandlerForTests } from '../api/client';
import { fetchMyDeliveries, startDelivery } from '../api/driver';
import { clearDeliveryCache, clearPendingActions, clearSession, loadDeliveryCache, loadPendingActions, loadSession, savePendingActions } from '../lib/session';
import { useDriverApp } from './useDriverApp';
import type { DriverDeliveryDto, PendingAction, StoredSession } from '../types/api';

jest.mock('../api/auth', () => ({
  login: jest.fn(),
}));

jest.mock('../api/driver', () => ({
  fetchMyDeliveries: jest.fn(),
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
const clearDeliveryCacheMock = clearDeliveryCache as jest.MockedFunction<typeof clearDeliveryCache>;

const baseSession: StoredSession = {
  token: 'token-123',
  email: 'driver@test.com',
  role: 'DRIVER',
};

const pickedUpDelivery: DriverDeliveryDto = {
  id: 1,
  pickupAddress: '18 Quai des Saveurs, Paris',
  deliveryAddress: 'QA MOBILE - 12 Rue des Fleurs, Paris',
  description: 'QA sample',
  status: 'PICKED_UP',
  createdAt: '2026-07-15T08:00:00.000Z',
  updatedAt: '2026-07-15T08:30:00.000Z',
};

function DriverAppHarness() {
  const app = useDriverApp();

  return (
    <View>
      <Text>{`screen:${app.screen}`}</Text>
      <Text>{`session:${app.session?.email ?? 'none'}`}</Text>
      <Text>{`deliveries:${app.deliveries.length}`}</Text>
      <Text>{`error:${app.errorMessage ?? 'none'}`}</Text>
      <Text>{`banner:${app.bannerMessage ?? 'none'}`}</Text>
      <Text>{`pending:${app.pendingActions.length}`}</Text>
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
    expect(clearPendingActionsMock).toHaveBeenCalled();
    expect(clearDeliveryCacheMock).toHaveBeenCalled();
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
});
