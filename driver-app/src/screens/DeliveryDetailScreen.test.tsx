import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { DeliveryDetailScreen } from './DeliveryDetailScreen';
import type { DriverDeliveryDto, PendingAction } from '../types/api';

jest.mock('expo-location', () => ({
  geocodeAsync: jest.fn(async () => []),
}));

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockMapView = (props: any) => React.createElement(View, { testID: 'mock-map-view' }, props.children);
  const MockMarker = (props: any) => React.createElement(View, { testID: 'mock-map-marker' }, props.children);
  const MockPolyline = (props: any) => React.createElement(View, { testID: 'mock-map-polyline' }, props.children);

  return {
    __esModule: true,
    default: MockMapView,
    Marker: MockMarker,
    Polyline: MockPolyline,
  };
});

const delivery: DriverDeliveryDto = {
  id: 42,
  pickupAddress: '12 Rue du Depart',
  deliveryAddress: '90 Avenue du Port',
  description: 'Commande fragile',
  status: 'ASSIGNED',
  createdAt: '2026-07-15T10:00:00.000Z',
  updatedAt: '2026-07-15T10:05:00.000Z',
  restaurant: {
    id: 7,
    name: 'Harbor Bowl Kitchen',
    address: '18 Quai des Saveurs',
  },
  customer: {
    id: 9,
    email: 'customer@test.com',
  },
};

const blockedAction: PendingAction = {
  actionId: 'FAIL-42-1',
  deliveryId: 42,
  actionType: 'FAIL',
  state: 'conflicted',
  queuedAt: '2026-07-15T10:06:00.000Z',
  retryCount: 2,
  lastError: 'Server state changed',
};

describe('DeliveryDetailScreen', () => {
  it('prefills a quick failure reason when a chip is pressed', async () => {
    const onFailureDraftChange = jest.fn();
    const screen = await render(
      <DeliveryDetailScreen
        delivery={delivery}
        currentLocation={null}
        pendingActionCount={0}
        blockedAction={null}
        failureDraft=""
        bannerMessage={null}
        errorMessage={null}
        isSaving={false}
        onBack={jest.fn()}
        onRefreshServerState={jest.fn()}
        onRetryBlockedAction={jest.fn()}
        onDiscardBlockedAction={jest.fn()}
        onFailureDraftChange={onFailureDraftChange}
        onPickup={jest.fn()}
        onStart={jest.fn()}
        onComplete={jest.fn()}
        onFail={jest.fn()}
      />
    );

    fireEvent.press(screen.getByText('Client absent'));

    expect(onFailureDraftChange).toHaveBeenCalledWith('Client absent');
  });

  it('disables failure submit when the reason is empty', async () => {
    const onFail = jest.fn();
    const screen = await render(
      <DeliveryDetailScreen
        delivery={delivery}
        currentLocation={null}
        pendingActionCount={0}
        blockedAction={null}
        failureDraft="   "
        bannerMessage={null}
        errorMessage={null}
        isSaving={false}
        onBack={jest.fn()}
        onRefreshServerState={jest.fn()}
        onRetryBlockedAction={jest.fn()}
        onDiscardBlockedAction={jest.fn()}
        onFailureDraftChange={jest.fn()}
        onPickup={jest.fn()}
        onStart={jest.fn()}
        onComplete={jest.fn()}
        onFail={onFail}
      />
    );

    fireEvent.press(screen.getByTestId('fail-delivery-button'));

    expect(onFail).not.toHaveBeenCalled();
  });

  it('shows the live character counter for the failure reason', async () => {
    const screen = await render(
      <DeliveryDetailScreen
        delivery={delivery}
        currentLocation={null}
        pendingActionCount={0}
        blockedAction={null}
        failureDraft="Client absent"
        bannerMessage={null}
        errorMessage={null}
        isSaving={false}
        onBack={jest.fn()}
        onRefreshServerState={jest.fn()}
        onRetryBlockedAction={jest.fn()}
        onDiscardBlockedAction={jest.fn()}
        onFailureDraftChange={jest.fn()}
        onPickup={jest.fn()}
        onStart={jest.fn()}
        onComplete={jest.fn()}
        onFail={jest.fn()}
      />
    );

    expect(screen.getByText('13/180 caracteres')).toBeTruthy();
  });

  it('shows conflict recovery guidance when a blocked action exists', async () => {
    const onDiscardBlockedAction = jest.fn();
    const screen = await render(
      <DeliveryDetailScreen
        delivery={delivery}
        currentLocation={null}
        pendingActionCount={1}
        blockedAction={blockedAction}
        failureDraft="Client absent"
        bannerMessage={null}
        errorMessage={null}
        isSaving={false}
        onBack={jest.fn()}
        onRefreshServerState={jest.fn()}
        onRetryBlockedAction={jest.fn()}
        onDiscardBlockedAction={onDiscardBlockedAction}
        onFailureDraftChange={jest.fn()}
        onPickup={jest.fn()}
        onStart={jest.fn()}
        onComplete={jest.fn()}
        onFail={jest.fn()}
      />
    );

    expect(screen.getByText('Conflit entre file locale et serveur')).toBeTruthy();
    fireEvent.press(screen.getByText('Supprimer l action locale'));
    expect(onDiscardBlockedAction).toHaveBeenCalled();
  });
});