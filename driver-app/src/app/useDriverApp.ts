import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
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
  updateMyLocation,
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
import { useI18n } from '../i18n/I18nProvider';
import { trackDriverEvent } from '../lib/telemetry';
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

type DriverCoordinates = {
  latitude: number;
  longitude: number;
};

export function useDriverApp() {
  const { strings } = useI18n();
  const locationSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const lastLocationPushAtRef = useRef(0);
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
  const [currentLocation, setCurrentLocation] = useState<DriverCoordinates | null>(null);

  const stopLocationTracking = async () => {
    if (!locationSubscriptionRef.current) {
      return;
    }

    locationSubscriptionRef.current.remove();
    locationSubscriptionRef.current = null;
  };

  const startLocationTracking = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();

    if (status !== 'granted') {
      setBannerMessage(strings.hook.locationPermissionDenied);
      void trackDriverEvent('location_permission_denied');
      return;
    }

    await stopLocationTracking();

    locationSubscriptionRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 25,
        timeInterval: 15000,
      },
      async (position) => {
        const now = Date.now();

        if (now - lastLocationPushAtRef.current < 10000) {
          return;
        }

        lastLocationPushAtRef.current = now;

        try {
          setCurrentLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
          await updateMyLocation(position.coords.latitude, position.coords.longitude);
          void trackDriverEvent('location_sync_success');
        } catch (error) {
          if (isRecoverableNetworkError(error)) {
            return;
          }

          void trackDriverEvent('location_sync_failed', {
            reason: getApiErrorMessage(error),
          });
          setErrorMessage(getApiErrorMessage(error));
        }
      }
    );
  };

  useEffect(() => {
    setUnauthorizedHandler(async () => {
      void trackDriverEvent('session_unauthorized_reset');
      await stopLocationTracking();
      setAuthToken(null);
      setSession(null);
      setDeliveries([]);
      setCurrentLocation(null);
      setSelectedDeliveryId(null);
      setFailureDrafts({});
      setPendingActions([]);
      setLastSuccessfulSync(null);
      setScreen('login');
      setBannerMessage(null);
      setErrorMessage(strings.hook.sessionExpired);
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
        void trackDriverEvent('session_restore_success', {
          hasCachedDeliveries: Boolean(cachedDeliveries?.deliveries.length),
          pendingActionCount: queuedActions.length,
        });
      } catch {
        void trackDriverEvent('session_restore_failed');
        setErrorMessage(strings.hook.restoreSessionFailed);
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

      void trackDriverEvent('deliveries_refresh_success', {
        deliveryCount: nextDeliveries.length,
      });
    } catch (error) {
      if (isRecoverableNetworkError(error)) {
        const cachedDeliveries = await loadDeliveryCache();

        if (cachedDeliveries) {
          setDeliveries(cachedDeliveries.deliveries);
          setLastSuccessfulSync(cachedDeliveries.lastSuccessfulSync);
          setBannerMessage(strings.hook.offlineCacheMode);
          setErrorMessage(null);
          void trackDriverEvent('deliveries_refresh_offline_cache', {
            cachedDeliveryCount: cachedDeliveries.deliveries.length,
          });
        } else {
          setErrorMessage(strings.hook.noNetworkAndNoCache);
          void trackDriverEvent('deliveries_refresh_failed', {
            reason: 'network_unavailable_no_cache',
          });
        }
      } else {
        void trackDriverEvent('deliveries_refresh_failed', {
          reason: getApiErrorMessage(error),
        });
        setErrorMessage(getApiErrorMessage(error));
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!session) {
      void stopLocationTracking();
      setDeliveries([]);
      setCurrentLocation(null);
      return;
    }

    void refreshDeliveries();
    void startLocationTracking();
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
      setErrorMessage(strings.hook.loginRequiredFields);
      return;
    }

    void trackDriverEvent('auth_login_attempt', {
      email: email.trim(),
    });

    setIsSubmitting(true);
    setErrorMessage(null);
    setBannerMessage(null);

    try {
      const nextSession = await login({ email: email.trim(), password });

      if (nextSession.role !== 'DRIVER') {
        throw new Error(strings.hook.roleNotDriver);
      }

      setAuthToken(nextSession.token);
      await saveSession(nextSession);
      setSession(nextSession);
      setPassword('');
      setScreen('list');
      void trackDriverEvent('auth_login_success', {
        role: nextSession.role,
      });
    } catch (error) {
      setAuthToken(null);
      setSession(null);
      void trackDriverEvent('auth_login_failed', {
        reason: getApiErrorMessage(error),
      });
      setErrorMessage(getApiErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    void trackDriverEvent('logout');
    await stopLocationTracking();
    setAuthToken(null);
    setSession(null);
    setDeliveries([]);
    setCurrentLocation(null);
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
        void trackDriverEvent('queue_replay_success', {
          actionType: action.actionType,
          deliveryId: action.deliveryId,
        });
        workingQueue = workingQueue.filter((item) => item.actionId !== action.actionId);
      } catch (error) {
        if (isRecoverableNetworkError(error)) {
          const nextQueue = workingQueue.map((item) => (
            item.actionId === action.actionId
              ? markQueuedActionNetworkFailure(item, getApiErrorMessage(error))
              : item
          ));

          await persistPendingQueue(nextQueue);
          void trackDriverEvent('queue_replay_network_failure', {
            actionType: action.actionType,
            deliveryId: action.deliveryId,
          });

          if ((action.retryCount + 1) >= 5) {
            setBannerMessage(strings.hook.queueReplayMaxReached(action.deliveryId));
          } else {
            setBannerMessage(strings.hook.queueReplayDeferredByNetwork(action.deliveryId));
          }

          return;
        }

        workingQueue = workingQueue.map((item) => (
          item.actionId === action.actionId
            ? markQueuedActionConflicted(item, getApiErrorMessage(error))
            : item
        ));
        await persistPendingQueue(workingQueue);
        void trackDriverEvent('queue_replay_conflict', {
          actionType: action.actionType,
          deliveryId: action.deliveryId,
          reason: getApiErrorMessage(error),
        });
        setBannerMessage(strings.hook.queueReplayConflict(action.deliveryId));
      }
    }

    await persistPendingQueue(workingQueue);

    if (deferredReplayCount > 0 && workingQueue.some((action) => action.state === 'queued')) {
      void trackDriverEvent('queue_replay_deferred', {
        deferredReplayCount,
      });
      setBannerMessage(strings.hook.queueReplayDeferredCount(deferredReplayCount));
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
    setBannerMessage(strings.hook.blockedActionsRemoved);
  };

  const retryBlockedAction = async (actionId: string) => {
    const nextQueue = pendingActions.map((action) => (
      action.actionId === actionId && action.state === 'failed'
        ? resetPendingActionForManualRetry(action)
        : action
    ));

    await persistPendingQueue(nextQueue);
    setBannerMessage(strings.hook.blockedActionRescheduled);
    await refreshDeliveries();
  };

  const discardBlockedAction = async (actionId: string) => {
    const nextQueue = pendingActions.filter((action) => action.actionId !== actionId);
    await persistPendingQueue(nextQueue);
    setBannerMessage(strings.hook.blockedActionRemoved);
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
    void trackDriverEvent('delivery_action_queued_offline', {
      actionType,
      deliveryId,
    });
    setBannerMessage(strings.hook.offlineActionQueued);
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
      void trackDriverEvent('delivery_action_success', {
        actionType,
        deliveryId,
      });
      setBannerMessage(successMessage);
    } catch (error) {
      if (isRecoverableNetworkError(error)) {
        const currentDelivery = deliveries.find((delivery) => delivery.id === deliveryId);

        if (currentDelivery) {
          patchLocalDelivery(deliveryId, patchDeliveryForOfflineAction(currentDelivery, actionType, payload));
        }

        await queuePendingAction(deliveryId, actionType, payload, getApiErrorMessage(error));
      } else {
        void trackDriverEvent('delivery_action_failed', {
          actionType,
          deliveryId,
          reason: getApiErrorMessage(error),
        });
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
      setErrorMessage(strings.hook.failReasonRequired);
      return;
    }

    if (reason.length > 180) {
      setErrorMessage(strings.hook.failReasonTooLong);
      return;
    }

    await runDeliveryAction(
      deliveryId,
      'FAIL',
      () => failDelivery(deliveryId, reason),
      strings.hook.failSuccess,
      'CANCELLED',
      { reason }
    );

    setFailureDraft(deliveryId, '');
  };

  const actionHandlers = {
    pickup: (deliveryId: number) => runDeliveryAction(deliveryId, 'PICKUP', () => pickupDelivery(deliveryId), strings.hook.pickupSuccess, 'PICKED_UP'),
    start: (deliveryId: number) => runDeliveryAction(deliveryId, 'START', () => startDelivery(deliveryId), strings.hook.startSuccess, 'IN_TRANSIT'),
    complete: (deliveryId: number) => runDeliveryAction(deliveryId, 'COMPLETE', () => completeDelivery(deliveryId), strings.hook.completeSuccess, 'DELIVERED'),
  };

  return {
    session,
    screen,
    selectedDelivery,
    email,
    password,
    deliveries,
    currentLocation,
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