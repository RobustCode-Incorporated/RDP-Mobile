type DriverTelemetryEventName =
  | 'auth_login_attempt'
  | 'auth_login_success'
  | 'auth_login_failed'
  | 'session_restore_success'
  | 'session_restore_failed'
  | 'session_unauthorized_reset'
  | 'deliveries_refresh_success'
  | 'deliveries_refresh_offline_cache'
  | 'deliveries_refresh_failed'
  | 'delivery_action_success'
  | 'delivery_action_failed'
  | 'delivery_action_queued_offline'
  | 'queue_replay_success'
  | 'queue_replay_network_failure'
  | 'queue_replay_conflict'
  | 'queue_replay_deferred'
  | 'location_permission_denied'
  | 'location_sync_success'
  | 'location_sync_failed'
  | 'logout';

interface DriverTelemetryEvent {
  app: 'driver-mobile';
  eventName: DriverTelemetryEventName;
  occurredAt: string;
  payload?: Record<string, unknown>;
}

function getTelemetryEndpoint() {
  const endpoint = process.env.EXPO_PUBLIC_DRIVER_TELEMETRY_ENDPOINT;

  if (!endpoint) {
    return null;
  }

  return endpoint.trim() || null;
}

export async function trackDriverEvent(
  eventName: DriverTelemetryEventName,
  payload?: Record<string, unknown>
) {
  const endpoint = getTelemetryEndpoint();

  if (!endpoint) {
    return;
  }

  const body: DriverTelemetryEvent = {
    app: 'driver-mobile',
    eventName,
    occurredAt: new Date().toISOString(),
    payload,
  };

  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Telemetry must never block core delivery workflow.
  }
}
