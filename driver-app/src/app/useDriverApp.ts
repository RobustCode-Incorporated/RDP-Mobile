import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { login } from '../api/auth';
import {
  getApiErrorMessage,
  isRecoverableNetworkError,
  setAuthToken,
  setUnauthorizedHandler,
} from '../api/client';
import {
  completeDelivery,
  failDelivery,
  fetchMyDeliveries,
  pickupDelivery,
  startDelivery,
} from '../api/driver';
import {
  clearDeliveryCache,
  clearPendingActions,
  clearSession,
  loadDeliveryCache,
  loadPendingActions,
  loadSession,
  saveDeliveryCache,
  savePendingActions,
  saveSession,
} from '../lib/session';
import type { DriverDeliveryDto, PendingAction, PendingActionType, StoredSession } from '../types/api';
import {
  buildPendingActionCountByDelivery,
  createPendingAction,
  discardBlockedActions,
  markQueuedActionConflicted,
  markQueuedActionNetworkFailure,
  patchDeliveryForOfflineAction,
  resetPendingActionForManualRetry,
  shouldReplayPendingAction,
} from './offlineQueue';

type Screen = 'login' | 'list' | 'detail';

export function useDriverApp() {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [screen, setScreen] = useState<Screen>('login');
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<number | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [deliveries, setDeliveries] = useState<DriverDeliveryDto[]>([]);
  const [failureDrafts, setFailureDrafts] = useState<Record<number, string>>({});
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [savingDeliveryId, setSavingDeliveryId] = useState<number | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(async () => {
      setAuthToken(null);
      setSession(null);
      setDeliveries([]);
      setSelectedDeliveryId(null);
      setFailureDrafts({});
      setPendingActions([]);
      setLastSuccessfulSync(null);
      setScreen('login');
      setBannerMessage(null);
      setErrorMessage('Votre session a expire. Veuillez vous reconnecter.');
      await clearSession();
      await clearPendingActions();
      await clearDeliveryCache();
    });

    return () => {
      setUnauthorizedHandler(null);
    };
  }, []);

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const savedSession = await loadSession();
        const cachedDeliveries = await loadDeliveryCache();
        const queuedActions = await loadPendingActions();

        if (cachedDeliveries) {
          setDeliveries(cachedDeliveries.deliveries);
          setLastSuccessfulSync(cachedDeliveries.lastSuccessfulSync);
        }

        setPendingActions(queuedActions);

        if (!savedSession) {
          return;
        }

        setAuthToken(savedSession.token);
        setSession(savedSession);
        setScreen('list');
      } catch {
        setErrorMessage('Impossible de restaurer la session enregistree.');
      } finally {
        setIsRestoring(false);
      }
    };

    void restoreSession();
  }, []);

  const selectedDelivery = useMemo(
    () => deliveries.find((delivery) => delivery.id === selectedDeliveryId) ?? null,
    [deliveries, selectedDeliveryId]
  );

  const pendingActionCountByDelivery = useMemo(() => (
    buildPendingActionCountByDelivery(pendingActions)
  ), [pendingActions]);

  const blockedActions = useMemo(
    () => pendingActions.filter((action) => action.state === 'failed' || action.state === 'conflicted'),
    [pendingActions]
  );

  const blockedActionByDelivery = useMemo(() => (
    blockedActions.reduce<Record<number, PendingAction>>((accumulator, action) => {
      if (!accumulator[action.deliveryId]) {
        accumulator[action.deliveryId] = action;
      }

      return accumulator;
    }, {})
  ), [blockedActions]);

  const persistPendingQueue = async (nextQueue: PendingAction[]) => {
    setPendingActions(nextQueue);
    await savePendingActions(nextQueue);
  };

  const refreshDeliveries = async () => {
    setIsRefreshing(true);
    setErrorMessage(null);

    try {
      await replayPendingActions();
      const nextDeliveries = await fetchMyDeliveries();
      const syncTime = new Date().toISOString();

      setDeliveries(nextDeliveries);
      setLastSuccessfulSync(syncTime);
      await saveDeliveryCache({ deliveries: nextDeliveries, lastSuccessfulSync: syncTime });
      if (pendingActions.length === 0) {
        setBannerMessage(null);
      }

      if (selectedDeliveryId && !nextDeliveries.some((delivery) => delivery.id === selectedDeliveryId)) {
        setSelectedDeliveryId(null);
        setScreen('list');
      }
    } catch (error) {
      if (isRecoverableNetworkError(error)) {
        const cachedDeliveries = await loadDeliveryCache();

        if (cachedDeliveries) {
          setDeliveries(cachedDeliveries.deliveries);
          setLastSuccessfulSync(cachedDeliveries.lastSuccessfulSync);
          setBannerMessage('Mode hors ligne: affichage des livraisons en cache.');
          setErrorMessage(null);
        } else {
          setErrorMessage('Connexion indisponible et aucun cache local disponible.');
        }
      } else {
        setErrorMessage(getApiErrorMessage(error));
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!session) {
      setDeliveries([]);
      return;
    }

    void refreshDeliveries();
  }, [session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshDeliveries();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [session, pendingActions]);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setErrorMessage('Email et mot de passe sont requis.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setBannerMessage(null);

    try {
      const nextSession = await login({ email: email.trim(), password });

      if (nextSession.role !== 'DRIVER') {
        throw new Error('Ce compte ne dispose pas du role chauffeur.');
      }

      setAuthToken(nextSession.token);
      await saveSession(nextSession);
      setSession(nextSession);
      setPassword('');
      setScreen('list');
    } catch (error) {
      setAuthToken(null);
      setSession(null);
      setErrorMessage(getApiErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    setAuthToken(null);
    setSession(null);
    setDeliveries([]);
    setFailureDrafts({});
    setPendingActions([]);
    setLastSuccessfulSync(null);
    setSelectedDeliveryId(null);
    setScreen('login');
    setBannerMessage(null);
    await clearSession();
    await clearPendingActions();
    await clearDeliveryCache();
  };

  const openDelivery = (deliveryId: number) => {
    setSelectedDeliveryId(deliveryId);
    setBannerMessage(null);
    setErrorMessage(null);
    setScreen('detail');
  };

  const closeDelivery = () => {
    setSelectedDeliveryId(null);
    setScreen('list');
  };

  const updateDelivery = (updatedDelivery: DriverDeliveryDto) => {
    setDeliveries((currentDeliveries) => currentDeliveries.map((delivery) => (
      delivery.id === updatedDelivery.id ? updatedDelivery : delivery
    )));
  };

  const patchLocalDelivery = (deliveryId: number, patch: Partial<DriverDeliveryDto>) => {
    setDeliveries((currentDeliveries) => currentDeliveries.map((delivery) => (
      delivery.id === deliveryId
        ? {
          ...delivery,
          ...patch,
        }
        : delivery
    )));
  };

  const replayPendingActions = async () => {
    if (pendingActions.length === 0) {
      return;
    }

    let workingQueue = [...pendingActions];
    let deferredReplayCount = 0;

    for (const action of pendingActions) {
      if (!shouldReplayPendingAction(action)) {
        deferredReplayCount += 1;
        continue;
      }

      if (action.state !== 'queued') {
        continue;
      }

      try {
        let updatedDelivery: DriverDeliveryDto;

        if (action.actionType === 'PICKUP') {
          updatedDelivery = await pickupDelivery(action.deliveryId);
        } else if (action.actionType === 'START') {
          updatedDelivery = await startDelivery(action.deliveryId);
        } else if (action.actionType === 'COMPLETE') {
          updatedDelivery = await completeDelivery(action.deliveryId);
        } else {
          updatedDelivery = await failDelivery(action.deliveryId, action.payload?.reason ?? '');
        }

        updateDelivery(updatedDelivery);
        workingQueue = workingQueue.filter((item) => item.actionId !== action.actionId);
      } catch (error) {
        if (isRecoverableNetworkError(error)) {
          const nextQueue = workingQueue.map((item) => (
            item.actionId === action.actionId
              ? markQueuedActionNetworkFailure(item, getApiErrorMessage(error))
              : item
          ));

          await persistPendingQueue(nextQueue);

          if ((action.retryCount + 1) >= 5) {
            setBannerMessage(`L action en attente pour la livraison #${action.deliveryId} a atteint la limite de relecture automatique.`);
          } else {
            setBannerMessage(`Relecture differee pour la livraison #${action.deliveryId} apres une erreur reseau.`);
          }

          return;
        }

        workingQueue = workingQueue.map((item) => (
          item.actionId === action.actionId
            ? markQueuedActionConflicted(item, getApiErrorMessage(error))
            : item
        ));
        await persistPendingQueue(workingQueue);
        setBannerMessage(`Action en attente en conflit pour la livraison #${action.deliveryId}. Une action manuelle est requise.`);
      }
    }

    await persistPendingQueue(workingQueue);

    if (deferredReplayCount > 0 && workingQueue.some((action) => action.state === 'queued')) {
      setBannerMessage(`${deferredReplayCount} action(s) en attente patienteront avant la prochaine relecture automatique.`);
    }
  };

  const retryQueuedActions = async () => {
    const retriableQueue = pendingActions.map((action) => (
      action.state === 'failed'
        ? resetPendingActionForManualRetry(action)
        : action
    ));

    await persistPendingQueue(retriableQueue);
    await refreshDeliveries();
  };

  const discardBlockedQueuedActions = async () => {
    const nextQueue = discardBlockedActions(pendingActions);
    await persistPendingQueue(nextQueue);
    setBannerMessage('Actions bloquees supprimees de la file locale.');
  };

  const retryBlockedAction = async (actionId: string) => {
    const nextQueue = pendingActions.map((action) => (
      action.actionId === actionId && action.state === 'failed'
        ? resetPendingActionForManualRetry(action)
        : action
    ));

    await persistPendingQueue(nextQueue);
    setBannerMessage('Action en echec reprogramme pour une nouvelle tentative.');
    await refreshDeliveries();
  };

  const discardBlockedAction = async (actionId: string) => {
    const nextQueue = pendingActions.filter((action) => action.actionId !== actionId);
    await persistPendingQueue(nextQueue);
    setBannerMessage('Action locale supprimee. L etat serveur reste prioritaire.');
    await refreshDeliveries();
  };

  const queuePendingAction = async (
    deliveryId: number,
    actionType: PendingActionType,
    payload?: PendingAction['payload'],
    lastError?: string
  ) => {
    const nextQueue = [...pendingActions, createPendingAction(deliveryId, actionType, payload, lastError)];
    await persistPendingQueue(nextQueue);
    setBannerMessage('Action hors ligne enregistree. Elle sera rejouee des le retour du reseau.');
  };

  const runDeliveryAction = async (
    deliveryId: number,
    actionType: PendingActionType,
    action: () => Promise<DriverDeliveryDto>,
    successMessage: string,
    offlineStatus: DriverDeliveryDto['status'],
    payload?: PendingAction['payload']
  ) => {
    setSavingDeliveryId(deliveryId);
    setErrorMessage(null);
    setBannerMessage(null);

    try {
      const updatedDelivery = await action();
      updateDelivery(updatedDelivery);
      setBannerMessage(successMessage);
    } catch (error) {
      if (isRecoverableNetworkError(error)) {
        const currentDelivery = deliveries.find((delivery) => delivery.id === deliveryId);

        if (currentDelivery) {
          patchLocalDelivery(deliveryId, patchDeliveryForOfflineAction(currentDelivery, actionType, payload));
        }

        await queuePendingAction(deliveryId, actionType, payload, getApiErrorMessage(error));
      } else {
        setErrorMessage(getApiErrorMessage(error));
      }
    } finally {
      setSavingDeliveryId(null);
    }
  };

  const setFailureDraft = (deliveryId: number, value: string) => {
    setFailureDrafts((currentDrafts) => ({ ...currentDrafts, [deliveryId]: value }));
  };

  const handleFailDelivery = async (deliveryId: number) => {
    const reason = (failureDrafts[deliveryId] ?? '').trim();

    if (!reason) {
      setErrorMessage('Veuillez saisir une raison d echec avant l envoi.');
      return;
    }

    if (reason.length > 180) {
      setErrorMessage('La raison d echec doit contenir au maximum 180 caracteres.');
      return;
    }

    await runDeliveryAction(
      deliveryId,
      'FAIL',
      () => failDelivery(deliveryId, reason),
      'La livraison a ete marquee en echec.',
      'CANCELLED',
      { reason }
    );

    setFailureDraft(deliveryId, '');
  };

  const actionHandlers = {
    pickup: (deliveryId: number) => runDeliveryAction(deliveryId, 'PICKUP', () => pickupDelivery(deliveryId), 'Commande recuperee.', 'PICKED_UP'),
    start: (deliveryId: number) => runDeliveryAction(deliveryId, 'START', () => startDelivery(deliveryId), 'Livraison demarree.', 'IN_TRANSIT'),
    complete: (deliveryId: number) => runDeliveryAction(deliveryId, 'COMPLETE', () => completeDelivery(deliveryId), 'Livraison terminee.', 'DELIVERED'),
  };

  return {
    session,
    screen,
    selectedDelivery,
    email,
    password,
    deliveries,
    failureDrafts,
    pendingActions,
    pendingActionCountByDelivery,
    blockedActions,
    blockedActionByDelivery,
    lastSuccessfulSync,
    bannerMessage,
    errorMessage,
    isRestoring,
    isSubmitting,
    isRefreshing,
    savingDeliveryId,
    setEmail,
    setPassword,
    setFailureDraft,
    handleLogin,
    handleLogout,
    refreshDeliveries,
    openDelivery,
    closeDelivery,
    handleFailDelivery,
    retryQueuedActions,
    discardBlockedQueuedActions,
    retryBlockedAction,
    discardBlockedAction,
    actionHandlers,
  };
}