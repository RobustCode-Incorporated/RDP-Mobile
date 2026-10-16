import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';
import { DeliveryDetailScreen } from './DeliveryDetailScreen';
import { buildDelivery } from '../test/fixtures';
import type { Delivery, DeliveryHistory, PendingAction } from '../types/api';

const blockedAction: PendingAction = {
  actionId: 'FAIL-42-1',
  deliveryId: 42,
  actionType: 'FAIL',
  state: 'conflicted',
  queuedAt: '2026-07-15T10:06:00.000Z',
  retryCount: 2,
  lastError: 'Server state changed',
};

const history: DeliveryHistory[] = [
  { id: 1, event: 'CREATED', oldStatus: null, newStatus: 'CREATED', changedBy: 'resto@test', note: null, createdAt: '2026-10-16T09:00:00.000Z' },
  { id: 2, event: 'ASSIGNED', oldStatus: 'CREATED', newStatus: 'ASSIGNED', changedBy: 'admin@test', note: 'Assigned to driver #4', createdAt: '2026-10-16T09:05:00.000Z' },
];

type Handlers = {
  onComplete: jest.Mock<() => void>;
  onFail: jest.Mock<(reason: string) => Promise<boolean>>;
  loadHistory: jest.Mock<(id: number) => Promise<DeliveryHistory[]>>;
};

async function renderDetail(delivery: Delivery, overrides: Partial<Handlers> & { blockedAction?: PendingAction | null; onDiscardBlockedAction?: () => void } = {}) {
  const handlers: Handlers = {
    onComplete: overrides.onComplete ?? jest.fn<() => void>(),
    onFail: overrides.onFail ?? jest.fn<(reason: string) => Promise<boolean>>(async () => true),
    loadHistory: overrides.loadHistory ?? jest.fn<(id: number) => Promise<DeliveryHistory[]>>(async () => history),
  };

  const screen = await render(
    <DeliveryDetailScreen
      delivery={delivery}
      currentLocation={null}
      pendingActionCount={0}
      blockedAction={overrides.blockedAction ?? null}
      bannerMessage={null}
      errorMessage={null}
      isSaving={false}
      onBack={jest.fn()}
      onRefreshServerState={jest.fn()}
      onRetryBlockedAction={jest.fn()}
      onDiscardBlockedAction={overrides.onDiscardBlockedAction ?? jest.fn()}
      onPickup={jest.fn()}
      onStart={jest.fn()}
      onComplete={handlers.onComplete}
      onFail={handlers.onFail}
      loadHistory={handlers.loadHistory}
    />
  );

  return { screen, handlers };
}

describe('DeliveryDetailScreen', () => {
  let alertSpy: jest.SpiedFunction<typeof Alert.alert>;
  let openUrlSpy: jest.SpiedFunction<typeof Linking.openURL>;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  describe('cash on delivery', () => {
    const codDelivery = buildDelivery({ id: 42, status: 'IN_TRANSIT', paymentMode: 'CASH_ON_DELIVERY', cashToCollect: 34 });

    it('shows the amount to collect prominently', async () => {
      const { screen } = await renderDetail(codDelivery);

      expect(screen.getByTestId('cash-to-collect').props.children).toMatch(/^À encaisser : 34,00\s€$/);
    });

    it('asks to collect the cash before confirming "Livrée"', async () => {
      const { screen, handlers } = await renderDetail(codDelivery);

      await fireEvent.press(screen.getByTestId('complete-button'));

      expect(handlers.onComplete).not.toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledTimes(1);
      const [title, message, buttons] = alertSpy.mock.calls[0];
      expect(title).toBe('Paiement en espèces');
      expect(message).toMatch(/^Encaisser 34,00\s€ avant de confirmer$/);

      // Cancel does nothing, confirm completes.
      buttons?.find((button) => button.style === 'cancel')?.onPress?.();
      expect(handlers.onComplete).not.toHaveBeenCalled();
      buttons?.find((button) => button.text === 'Espèces encaissées')?.onPress?.();
      expect(handlers.onComplete).toHaveBeenCalledTimes(1);
    });

    it('completes a prepaid delivery without the cash dialog', async () => {
      const { screen, handlers } = await renderDetail(buildDelivery({ id: 43, status: 'IN_TRANSIT', paymentMode: 'PREPAID' }));

      await fireEvent.press(screen.getByTestId('complete-button'));

      expect(alertSpy).not.toHaveBeenCalled();
      expect(handlers.onComplete).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Commande déjà payée : rien à encaisser')).toBeTruthy();
    });
  });

  describe('failure reason', () => {
    const active = buildDelivery({ id: 42, status: 'PICKED_UP' });

    it('requires a reason before the failure can be confirmed', async () => {
      const { screen, handlers } = await renderDetail(active);

      await fireEvent.press(screen.getByTestId('fail-delivery-button'));
      expect(screen.getByText('Choisissez un motif pour continuer.')).toBeTruthy();

      await fireEvent.press(screen.getByTestId('confirm-failure-button'));
      expect(handlers.onFail).not.toHaveBeenCalled();

      await fireEvent.press(screen.getByTestId('failure-preset-CUSTOMER_ABSENT'));
      await fireEvent.press(screen.getByTestId('confirm-failure-button'));
      expect(handlers.onFail).toHaveBeenCalledWith('Client absent');
    });

    it('offers the pilot presets', async () => {
      const { screen } = await renderDetail(active);
      await fireEvent.press(screen.getByTestId('fail-delivery-button'));

      ['Client absent', 'Adresse introuvable', 'Client injoignable', 'Refus du client', 'Autre'].forEach((label) => {
        expect(screen.getByText(label)).toBeTruthy();
      });
    });

    it('requires free text when "Autre" is selected', async () => {
      const { screen, handlers } = await renderDetail(active);
      await fireEvent.press(screen.getByTestId('fail-delivery-button'));
      await fireEvent.press(screen.getByTestId('failure-preset-OTHER'));

      await fireEvent.press(screen.getByTestId('confirm-failure-button'));
      expect(handlers.onFail).not.toHaveBeenCalled();

      await fireEvent.changeText(screen.getByTestId('failure-details-input'), 'Immeuble en travaux');
      await fireEvent.press(screen.getByTestId('confirm-failure-button'));
      expect(handlers.onFail).toHaveBeenCalledWith('Immeuble en travaux');
    });

    it('appends optional details to a preset and shows the counter', async () => {
      const { screen, handlers } = await renderDetail(active);
      await fireEvent.press(screen.getByTestId('fail-delivery-button'));
      await fireEvent.press(screen.getByTestId('failure-preset-CUSTOMER_UNREACHABLE'));
      await fireEvent.changeText(screen.getByTestId('failure-details-input'), 'appelé 3x');

      expect(screen.getByText('30/180 caracteres')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('confirm-failure-button'));
      expect(handlers.onFail).toHaveBeenCalledWith('Client injoignable - appelé 3x');
    });

    it('shows the failure reason of a failed delivery and no action buttons', async () => {
      const { screen } = await renderDetail(buildDelivery({ status: 'FAILED', failureReason: 'Client absent', failedAt: '2026-10-16T10:00:00.000Z' }));

      expect(screen.getByText("Motif de l'échec : Client absent")).toBeTruthy();
      expect(screen.queryByTestId('fail-delivery-button')).toBeNull();
      expect(screen.queryByTestId('complete-button')).toBeNull();
    });
  });

  describe('restaurant and customer blocks', () => {
    it('calls the restaurant and the customer via tel:', async () => {
      const { screen } = await renderDetail(buildDelivery({ status: 'ASSIGNED' }));

      expect(screen.getByText('Chez Mama Africa')).toBeTruthy();
      expect(screen.getByText('Claire Client')).toBeTruthy();
      expect(screen.getByText('Instructions : Sonner 2x')).toBeTruthy();

      await fireEvent.press(screen.getByTestId('call-restaurant'));
      await fireEvent.press(screen.getByTestId('call-customer'));

      expect(openUrlSpy).toHaveBeenCalledWith('tel:+3221234567');
      expect(openUrlSpy).toHaveBeenCalledWith('tel:+32470123456');
    });

    it('opens a navigation app chooser with the delivery coordinates', async () => {
      const { screen } = await renderDetail(buildDelivery({ status: 'IN_TRANSIT' }));

      await fireEvent.press(screen.getByTestId('navigate-customer'));

      const buttons = alertSpy.mock.calls[0][2] ?? [];
      expect(buttons.map((button) => button.text)).toEqual(expect.arrayContaining(['Google Maps', 'Waze', 'Annuler']));
      buttons.find((button) => button.text === 'Waze')?.onPress?.();
      expect(openUrlSpy).toHaveBeenCalledWith('https://waze.com/ul?ll=50.827%2C4.364&navigate=yes');
    });

    it('disables the call button when no phone is known', async () => {
      const { screen } = await renderDetail(buildDelivery({ customerPhone: null }));

      expect(screen.getByText('Téléphone non renseigné')).toBeTruthy();
    });
  });

  describe('history timeline', () => {
    it('renders the server history', async () => {
      const { screen, handlers } = await renderDetail(buildDelivery({ id: 42 }));

      expect(await screen.findByText('Assigned to driver #4')).toBeTruthy();
      expect(handlers.loadHistory).toHaveBeenCalledWith(42);
    });

    it('falls back to lifecycle timestamps when history cannot be loaded', async () => {
      const { screen } = await renderDetail(buildDelivery({ id: 42 }), {
        loadHistory: jest.fn<(id: number) => Promise<DeliveryHistory[]>>(async () => { throw new Error('offline'); }),
      });

      expect(await screen.findByText('Historique détaillé indisponible. Étapes connues :')).toBeTruthy();
      await waitFor(() => expect(screen.getAllByText('Assignée').length).toBeGreaterThan(1));
    });
  });

  it('shows conflict recovery guidance when a blocked action exists', async () => {
    const onDiscardBlockedAction = jest.fn();
    const { screen } = await renderDetail(buildDelivery({ id: 42 }), { blockedAction, onDiscardBlockedAction });

    expect(screen.getByText('Conflit entre file locale et serveur')).toBeTruthy();
    await fireEvent.press(screen.getByText('Supprimer l action locale'));
    expect(onDiscardBlockedAction).toHaveBeenCalled();
  });
});
