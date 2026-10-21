import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, within } from '@testing-library/react-native';
import { DeliveryListScreen } from './DeliveryListScreen';
import { buildDelivery } from '../test/fixtures';
import type { Delivery } from '../types/api';

const today = new Date().toISOString();

function renderList(deliveries: Delivery[]) {
  return render(
    <DeliveryListScreen
      session={{ token: 't', email: 'driver@test.com', role: 'DRIVER' }}
      currentLocation={null}
      deliveries={deliveries}
      pendingActionCountByDelivery={{}}
      blockedActionByDelivery={{}}
      blockedActionCount={0}
      lastSuccessfulSync={null}
      bannerMessage={null}
      errorMessage={null}
      isRefreshing={false}
      onRefresh={jest.fn()}
      onRetryQueuedActions={jest.fn()}
      onDiscardBlockedActions={jest.fn()}
      onLogout={jest.fn()}
      onOpenDelivery={jest.fn()}
    />
  );
}

describe('DeliveryListScreen', () => {
  it('shows restaurant, customer, address, ready and cash badges on active cards', async () => {
    const screen = await renderList([
      buildDelivery({
        id: 7,
        status: 'ASSIGNED',
        readyAt: today,
        paymentMode: 'CASH_ON_DELIVERY',
        cashToCollect: 34,
      }),
    ]);

    const card = within(screen.getByTestId('delivery-card-7'));
    expect(card.getByText('Chez Mama Africa')).toBeTruthy();
    expect(card.getByText('Client : Claire Client')).toBeTruthy();
    expect(card.getByText('Avenue Louise 100, 1050 Ixelles')).toBeTruthy();
    expect(card.getByText('Prête')).toBeTruthy();
    expect(card.getByTestId('cash-badge').props.children).toMatch(/^Espèces : 34,00\s€$/);
    expect(card.getByText('Assignée')).toBeTruthy();
  });

  it('orders active deliveries ASSIGNED -> PICKED_UP -> IN_TRANSIT and collapses finished ones', async () => {
    const screen = await renderList([
      buildDelivery({ id: 1, status: 'IN_TRANSIT' }),
      buildDelivery({ id: 2, status: 'DELIVERED', deliveredAt: today }),
      buildDelivery({ id: 3, status: 'ASSIGNED' }),
      buildDelivery({ id: 4, status: 'FAILED', failedAt: today, failureReason: 'Client absent' }),
      buildDelivery({ id: 5, status: 'PICKED_UP' }),
    ]);

    const cardIds = screen.getAllByTestId(/^delivery-card-/).map((node) => node.props.testID);
    expect(cardIds).toEqual(['delivery-card-3', 'delivery-card-5', 'delivery-card-1']);
    expect(screen.getByText("Terminées aujourd'hui (2)")).toBeTruthy();

    await fireEvent.press(screen.getByTestId('toggle-finished-section'));

    expect(screen.getByTestId('delivery-card-2')).toBeTruthy();
    expect(screen.getByText('Motif : Client absent')).toBeTruthy();
  });

  it('does not show the ready badge once picked up and hides cash badge for prepaid', async () => {
    const screen = await renderList([buildDelivery({ id: 9, status: 'PICKED_UP', readyAt: today })]);

    expect(screen.queryByTestId('ready-badge')).toBeNull();
    expect(screen.queryByTestId('cash-badge')).toBeNull();
  });
});
