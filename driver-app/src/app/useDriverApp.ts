import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { login } from '../api/auth';
import {
  getApiErrorMessage,
  getApiErrorStatus,
  isRetryableError,
  setAuthToken,
  setUnauthorizedHandler,
} from '../api/client';
import {
  completeDelivery,
  failDelivery,
  fetchDelivery,
  fetchDeliveryHistory,
  fetchMyDeliveries,
  pickupDelivery,
  startDelivery,
  updateMyLocation,
} from '../api/driver';
import {
  clearDeliveryCache,
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
import type { Delivery, PendingAction, PendingActionType, StoredSession } from '../types/api';
import { FAIL_REASON_MAX_LENGTH, isActiveDelivery } from '../types/api';
import {
  isHeartbeatDue,
  LOCATION_HEARTBEAT_INTERVAL_MS,
  LOCATION_PUSH_MIN_INTERVAL_MS,
  shouldPushLocation,
  type LocationPush,
} from './locationThrottle';
import {
  ACTION_TARGET_STATUS,
  applyQueuedActionsToDeliveries,
  buildPendingActionCountByDelivery,
  createPendingAction,
  discardBlockedActions,
  filterQueueForOwner,
  patchDeliveryForOfflineAction,
  replayPendingQueue,
  resetPendingActionForManualRetry,
} from './offlineQueue';

type Screen = 'login' | 'list' | 'detail';

type DriverCoordinates = {
  latitude: number;
  longitude: number;
};

/** Contract 9.1: driver app polls /me every 30 s while in the foreground. */
const POLL_INTERVAL_MS = 30_000;

function executePendingAction(action: PendingAction) {
  switch (action.actionType) {
    case 'PICKUP':
      return pickupDelivery(action.deliveryId);
    case 'START':
      return startDelivery(action.deliveryId);
    case 'COMPLETE':
      return completeDelivery(action.deliveryId);
    default:
      return failDelivery(action.deliveryId, action.payload?.reason ?? '');
  }
}

/** Maps login failures (contract 2.1) to user-facing messages. */
export function getLoginErrorMessage(
  error: unknown,
  hookStrings: { loginInvalidCredentials: string; accountPendingApproval: string; loginNetworkError: string }
) {
  const status = getApiErrorStatus(error);

  if (status === 401) {
    return hookStrings.loginInvalidCredentials;
  }

  if (status === 403) {
    return hookStrings.accountPendingApproval;
  }

  if (isRetryableError(error)) {
    return hookStrings.loginNetworkError;
  }

  return getApiErrorMessage(error);
}

export function useDriverApp() {
  const { strings } = useI18n();
  const stringsRef = useRef(strings);
  stringsRef.current = strings;
  const locationSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const lastLocationPushRef = useRef<LocationPush | null>(null);
  const latestPositionRef = useRef<DriverCoordinates | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trackingGenerationRef = useRef(0);
  const pendingActionsRef = useRef<PendingAction[]>([]);
  const deliveriesRef = useRef<Delivery[]>([]);
  const lastSuccessfulSyncRef = useRef<string | null>(null);
  const sessionRef = useRef<StoredSession | null>(null);
  const isReplayingRef = useRef(false);
  const [session, setSessionState] = useState<StoredSession | null>(null);
  const [screen, setScreen] = useState<Screen>('login');
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<number | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [deliveries, setDeliveriesState] = useState<Delivery[]>([]);
  const [pendingActions, setPendingActionsState] = useState<PendingAction[]>([]);
  const [lastSuccessfulSync, setLastSuccessfulSyncState] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [savingDeliveryId, setSavingDeliveryId] = useState<number | null>(null);
  const [currentLocation, setCurrentLocation] = useState<DriverCoordinates | null>(null);

  const setSession = (next: StoredSession | null) => {
    sessionRef.current = next;
    setSessionState(next);
  };

  const setDeliveries = (next: Delivery[]) => {
    deliveriesRef.current = next;
    setDeliveriesState(next);
  };

  const setLastSuccessfulSync = (next: string | null) => {
    lastSuccessfulSyncRef.current = next;
    setLastSuccessfulSyncState(next);
  };

  const setPendingActions = (next: PendingAction[]) => {
    pendingActionsRef.current = next;
    setPendingActionsState(next);
  };

  const persistPendingQueue = async (nextQueue: PendingAction[]) => {
    setPendingActions(nextQueue);
    await savePendingActions(nextQueue);
  };

  /** Replaces local deliveries and persists them to the (AsyncStorage) cache. */
  const commitDeliveries = async (next: Delivery[], syncTime?: string) => {
    setDeliveries(next);

    if (syncTime) {
      setLastSuccessfulSync(syncTime);
    }

    const cacheSyncTime = syncTime ?? lastSuccessfulSyncRef.current;

    if (cacheSyncTime) {
      await saveDeliveryCache({ deliveries: next, lastSuccessfulSync: cacheSyncTime });
    }
  };

  /** Contract 9.1: after any command, replace the cached delivery with the returned object. */
  const replaceDeliveries = async (updated: Delivery[]) => {
    if (updated.length === 0) {
      return;
    }

    const byId = new Map(updated.map((delivery) => [delivery.id, delivery]));
    const known = new Set(deliveriesRef.current.map((delivery) => delivery.id));
    const next = deliveriesRef.current.map((delivery) => byId.get(delivery.id) ?? delivery);
    updated.forEach((delivery) => {
      if (!known.has(delivery.id)) {
        next.unshift(delivery);
      }
    });
    await commitDeliveries(next);
  };

  const pushLocation = async (coordinates: DriverCoordinates) => {
    lastLocationPushRef.current = { ...coordinates, at: Date.now() };

    try {
      await updateMyLocation(coordinates.latitude, coordinates.longitude);
      void trackDriverEvent('location_sync_success');
    } catch (error) {
      // Location sync is best effort: never block the driver with an error banner.
      if (!isRetryableError(error)) {
        void trackDriverEvent('location_sync_failed', {
          reason: getApiErrorMessage(error),
        });
      }
    }
  };

  const stopLocationTracking = async () => {
    trackingGenerationRef.current += 1;

    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }

    if (locationSubscriptionRef.current) {
      locationSubscriptionRef.current.remove();
      locationSubscriptionRef.current = null;
    }
  };

  /** Foreground-only live location while a delivery is active (contract 9.1). */
  const startLocationTracking = async () => {
    await stopLocationTracking();
    const generation = trackingGenerationRef.current;
    const { status } = await Location.requestForegroundPermissionsAsync();

    if (generation !== trackingGenerationRef.current) {
      return;
    }

    if (status !== 'granted') {
      setBannerMessage(stringsRef.current.hook.locationPermissionDenied);
      void trackDriverEvent('location_permission_denied');
      return;
    }

    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 25,
        timeInterval: LOCATION_PUSH_MIN_INTERVAL_MS,
      },
      (position) => {
        const coordinates = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        latestPositionRef.current = coordinates;
        setCurrentLocation(coordinates);

        if (shouldPushLocation(lastLocationPushRef.current, coordinates, Date.now())) {
          void pushLocation(coordinates);
        }
      }
    );

    if (generation !== trackingGenerationRef.current) {
      subscription.remove();
      return;
    }

    locationSubscriptionRef.current = subscription;
    heartbeatRef.current = setInterval(() => {
      if (latestPositionRef.current && isHeartbeatDue(lastLocationPushRef.current, Date.now())) {
        void pushLocation(latestPositionRef.current);
      }
    }, LOCATION_HEARTBEAT_INTERVAL_MS);
  };

  const resetLocalSessionState = async () => {
    await stopLocationTracking();
    setAuthToken(null);
    setSession(null);
    setDeliveries([]);
    setCurrentLocation(null);
    setSelectedDeliveryId(null);
    setLastSuccessfulSync(null);
    setScreen('login');
    setBannerMessage(null);
    await clearSession();
    await clearDeliveryCache();
  };

  useEffect(() => {
    setUnauthorizedHandler(async () => {
      void trackDriverEvent('session_unauthorized_reset');
      // Contract 9.2: on 401 keep the offline queue; it is replayed after re-login.
      await resetLocalSessionState();
      setErrorMessage(stringsRef.current.hook.sessionExpired);
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
        setErrorMessage(stringsRef.current.hook.restoreSessionFailed);
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

  /** @returns false when replay stopped on a 401 (session is being reset). */
  const replayPendingActions = async () => {
    if (pendingActionsRef.current.length === 0 || isReplayingRef.current) {
      return true;
    }

    isReplayingRef.current = true;

    try {
      const hookStrings = stringsRef.current.hook;
      const outcome = await replayPendingQueue(pendingActionsRef.current, {
        execute: executePendingAction,
        fetchDelivery,
      });

      await persistPendingQueue(outcome.queue);
      await replaceDeliveries(outcome.updatedDeliveries);

      for (const event of outcome.events) {
        const telemetryPayload = {
          actionType: event.action.actionType,
          deliveryId: event.action.deliveryId,
        };

        if (event.type === 'success' || event.type === 'already_done') {
          void trackDriverEvent('queue_replay_success', { ...telemetryPayload, alreadyDone: event.type === 'already_done' });
        } else if (event.type === 'conflict') {
          void trackDriverEvent('queue_replay_conflict', { ...telemetryPayload, reason: event.message });
          setBannerMessage(hookStrings.queueReplayConflict(event.action.deliveryId));
        } else if (event.type === 'dropped') {
          void trackDriverEvent('queue_replay_conflict', { ...telemetryPayload, reason: 'dropped', message: event.message });
          setBannerMessage(hookStrings.queueReplayDropped(event.action.deliveryId));
        } else if (event.type === 'network_retry') {
          void trackDriverEvent('queue_replay_network_failure', telemetryPayload);
          setBannerMessage(hookStrings.queueReplayDeferredByNetwork(event.action.deliveryId));
        } else if (event.type === 'max_retries') {
          void trackDriverEvent('queue_replay_network_failure', { ...telemetryPayload, maxReached: true });
          setBannerMessage(hookStrings.queueReplayMaxReached(event.action.deliveryId));
        }
      }

      if (outcome.stoppedReason === null && outcome.deferredCount > 0) {
        void trackDriverEvent('queue_replay_deferred', { deferredReplayCount: outcome.deferredCount });
        setBannerMessage(hookStrings.queueReplayDeferredCount(outcome.deferredCount));
      }

      return outcome.stoppedReason !== 'unauthorized';
    } finally {
      isReplayingRef.current = false;
    }
  };

  const refreshDeliveries = async () => {
    if (!sessionRef.current) {
      return;
    }

    setIsRefreshing(true);
    setErrorMessage(null);

    try {
      const canContinue = await replayPendingActions();

      if (!canContinue) {
        return;
      }

      const serverDeliveries = await fetchMyDeliveries();
      const syncTime = new Date().toISOString();
      const nextDeliveries = applyQueuedActionsToDeliveries(serverDeliveries, pendingActionsRef.current);

      await commitDeliveries(nextDeliveries, syncTime);

      if (pendingActionsRef.current.length === 0) {
        setBannerMessage(null);
      }

      void trackDriverEvent('deliveries_refresh_success', {
        deliveryCount: nextDeliveries.length,
      });
    } catch (error) {
      if (isRetryableError(error)) {
        const cachedDeliveries = await loadDeliveryCache();

        if (cachedDeliveries) {
          setDeliveries(cachedDeliveries.deliveries);
          setLastSuccessfulSync(cachedDeliveries.lastSuccessfulSync);
          setBannerMessage(stringsRef.current.hook.offlineCacheMode);
          setErrorMessage(null);
          void trackDriverEvent('deliveries_refresh_offline_cache', {
            cachedDeliveryCount: cachedDeliveries.deliveries.length,
          });
        } else {
          setErrorMessage(stringsRef.current.hook.noNetworkAndNoCache);
          void trackDriverEvent('deliveries_refresh_failed', {
            reason: 'network_unavailable_no_cache',
          });
        }
      } else if (getApiErrorStatus(error) !== 401) {
        void trackDriverEvent('deliveries_refresh_failed', {
          reason: getApiErrorMessage(error),
        });
        setErrorMessage(getApiErrorMessage(error));
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  // Keep the selected delivery valid when it disappears after a refresh (e.g. reassigned).
  useEffect(() => {
    if (selectedDeliveryId !== null && screen === 'detail' && !deliveries.some((delivery) => delivery.id === selectedDeliveryId)) {
      setSelectedDeliveryId(null);
      setScreen('list');
    }
  }, [deliveries, selectedDeliveryId, screen]);

  useEffect(() => {
    if (session) {
      void refreshDeliveries();
    }
  }, [session]);

  const hasActiveDelivery = useMemo(() => deliveries.some(isActiveDelivery), [deliveries]);

  // Live location only while a delivery is ASSIGNED | PICKED_UP | IN_TRANSIT.
  useEffect(() => {
    if (!session || !hasActiveDelivery) {
      void stopLocationTracking();
      latestPositionRef.current = null;
      setCurrentLocation(null);
      return;
    }

    void startLocationTracking();

    return () => {
      void stopLocationTracking();
    };
  }, [session, hasActiveDelivery]);

  useEffect(() => {
    if (!session) {
      return;
    }

    let interval: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (!interval) {
        interval = setInterval(() => {
          void refreshDeliveries();
        }, POLL_INTERVAL_MS);
      }
    };
    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    startPolling();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshDeliveries();
        startPolling();
      } else {
        stopPolling();
      }
    });

    return () => {
      stopPolling();
      subscription.remove();
    };
  }, [session]);

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

      // Queued actions belong to the driver who created them.
      const ownedQueue = filterQueueForOwner(pendingActionsRef.current, nextSession.email);

      if (ownedQueue.length !== pendingActionsRef.current.length) {
        await persistPendingQueue(ownedQueue);
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
        status: getApiErrorStatus(error),
      });
      setErrorMessage(getLoginErrorMessage(error, strings.hook));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    void trackDriverEvent('logout');
    // Pending offline actions are kept (and replayed after the same driver logs in again).
    await resetLocalSessionState();
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

  const retryQueuedActions = async () => {
    const retriableQueue = pendingActionsRef.current.map((action) => (
      action.state === 'failed' || action.state === 'queued'
        ? resetPendingActionForManualRetry(action)
        : action
    ));

    await persistPendingQueue(retriableQueue);
    await refreshDeliveries();
  };

  const discardBlockedQueuedActions = async () => {
    const nextQueue = discardBlockedActions(pendingActionsRef.current);
    await persistPendingQueue(nextQueue);
    setBannerMessage(strings.hook.blockedActionsRemoved);
  };

  const retryBlockedAction = async (actionId: string) => {
    const nextQueue = pendingActionsRef.current.map((action) => (
      action.actionId === actionId && action.state === 'failed'
        ? resetPendingActionForManualRetry(action)
        : action
    ));

    await persistPendingQueue(nextQueue);
    setBannerMessage(strings.hook.blockedActionRescheduled);
    await refreshDeliveries();
  };

  const discardBlockedAction = async (actionId: string) => {
    const nextQueue = pendingActionsRef.current.filter((action) => action.actionId !== actionId);
    await persistPendingQueue(nextQueue);
    setBannerMessage(strings.hook.blockedActionRemoved);
    await refreshDeliveries();
  };

  const queueOfflineAction = async (
    deliveryId: number,
    actionType: PendingActionType,
    payload?: PendingAction['payload'],
    lastError?: string
  ) => {
    const currentDelivery = deliveriesRef.current.find((delivery) => delivery.id === deliveryId);

    if (currentDelivery) {
      await replaceDeliveries([patchDeliveryForOfflineAction(currentDelivery, actionType, payload)]);
    }

    const nextQueue = [
      ...pendingActionsRef.current,
      createPendingAction(deliveryId, actionType, payload, lastError, sessionRef.current?.email),
    ];
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
    successMessage: string,
    payload?: PendingAction['payload']
  ) => {
    setSavingDeliveryId(deliveryId);
    setErrorMessage(null);
    setBannerMessage(null);

    try {
      // Preserve ordering: if earlier actions for this delivery are still queued, append to the queue.
      if (pendingActionsRef.current.some((action) => action.deliveryId === deliveryId)) {
        await queueOfflineAction(deliveryId, actionType, payload);
        void refreshDeliveries();
        return;
      }

      const updatedDelivery = await executePendingAction({
        actionId: 'direct',
        deliveryId,
        actionType,
        state: 'queued',
        payload,
        queuedAt: new Date().toISOString(),
        retryCount: 0,
      });
      await replaceDeliveries([updatedDelivery]);
      void trackDriverEvent('delivery_action_success', {
        actionType,
        deliveryId,
      });
      setBannerMessage(successMessage);
    } catch (error) {
      const status = getApiErrorStatus(error);

      if (isRetryableError(error)) {
        await queueOfflineAction(deliveryId, actionType, payload, getApiErrorMessage(error));
        return;
      }

      if (status === 401) {
        return;
      }

      if (status === 409) {
        // Contract 1.2: reload the resource, then let the user decide.
        try {
          const serverDelivery = await fetchDelivery(deliveryId);
          await replaceDeliveries([serverDelivery]);

          if (serverDelivery.status === ACTION_TARGET_STATUS[actionType]) {
            setBannerMessage(successMessage);
            return;
          }
        } catch {
          // fall through to the error message
        }
      }

      void trackDriverEvent('delivery_action_failed', {
        actionType,
        deliveryId,
        reason: getApiErrorMessage(error),
      });
      setErrorMessage(getApiErrorMessage(error));

      if (status === 403 || status === 404) {
        void refreshDeliveries();
      }
    } finally {
      setSavingDeliveryId(null);
    }
  };

  const handleFailDelivery = async (deliveryId: number, rawReason: string) => {
    const reason = rawReason.trim();

    if (!reason) {
      setErrorMessage(strings.hook.failReasonRequired);
      return false;
    }

    if (reason.length > FAIL_REASON_MAX_LENGTH) {
      setErrorMessage(strings.hook.failReasonTooLong);
      return false;
    }

    await runDeliveryAction(deliveryId, 'FAIL', strings.hook.failSuccess, { reason });
    return true;
  };

  const actionHandlers = {
    pickup: (deliveryId: number) => runDeliveryAction(deliveryId, 'PICKUP', strings.hook.pickupSuccess),
    start: (deliveryId: number) => runDeliveryAction(deliveryId, 'START', strings.hook.startSuccess),
    complete: (deliveryId: number) => runDeliveryAction(deliveryId, 'COMPLETE', strings.hook.completeSuccess),
  };

  return {
    session,
    screen,
    selectedDelivery,
    hasActiveDelivery,
    email,
    password,
    deliveries,
    currentLocation,
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
    handleLogin,
    handleLogout,
    refreshDeliveries,
    openDelivery,
    closeDelivery,
    handleFailDelivery,
    loadDeliveryHistory: fetchDeliveryHistory,
    retryQueuedActions,
    discardBlockedQueuedActions,
    retryBlockedAction,
    discardBlockedAction,
    actionHandlers,
  };
}
