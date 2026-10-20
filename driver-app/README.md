# Driver Mobile - Roadmap Remaining Work

This README tracks what is still pending for the mobile app, based on the roadmap in docs/mobile-development-roadmap.md, adjusted with work already completed in this repository.

## API configuration

Copy `.env.example` to `.env` (git-ignored) and set `EXPO_PUBLIC_API_BASE_URL` if needed.
When it is unset, development builds (`__DEV__`) target the local backend
(Android emulator `http://10.0.2.2:8080`, iOS simulator `http://127.0.0.1:8080`)
and release builds target the hosted Render backend. `EXPO_PUBLIC_*` values are
bundled into the app, so never put secrets in them.

## API contract

The app follows `DeliveryPlatform/docs/api-contract-v2.md` (backend branch
`session-2/unified-flow`): one `Delivery` entity, statuses
`CREATED / ASSIGNED / PICKED_UP / IN_TRANSIT / DELIVERED / FAILED / CANCELLED`,
`customerName` / `customerPhone`, `cashToCollect` for cash on delivery,
`GET /api/deliveries/{id}/history`, `PATCH /api/drivers/me/location`.
Error bodies `{ status, error, message, fieldErrors }` are parsed in `src/api/client.ts`.

## Local storage

- `expo-secure-store`: only the auth session (JWT, email, role) and the UI locale.
- `@react-native-async-storage/async-storage` (installed with `npx expo install`):
  delivery cache and offline action queue. SecureStore has a ~2KB per-value limit on
  some platforms, so lists must never go there. Values written by older builds in
  SecureStore are migrated once at startup (`migrateLegacyStorage` in `src/lib/session.ts`).

## Offline queue

`src/app/offlineQueue.ts` implements contract section 9.2: optimistic local
transitions mirror the server state machine (a failure is `FAILED` + `failureReason`),
`409` re-fetches the delivery and treats the action as done when the target status is
already reached (otherwise the action is marked conflicted and the server copy shown),
`403/404` drop the action, `401` keeps the queue for replay after re-login, network and
`5xx` errors retry with bounded exponential backoff (5 attempts).

## Live location

Foreground only for the pilot: the app sends `PATCH /api/drivers/me/location` at most
every 15 s (earlier on >=150 m movement, 30 s heartbeat when stationary) and only while a
delivery is `ASSIGNED`, `PICKED_UP` or `IN_TRANSIT`. Tracking stops otherwise.

**Session 3:** background location (expo-location background task + `expo-task-manager`,
`locationAlwaysAndWhenInUsePermission`, Android foreground service, store review
justification) is not implemented yet.

## App identity / builds

- Display name `RDP Livreur`, slug `driver-app`, bundle id / package `com.robustcode.rdpdriver`.
- TODO (EAS, needs store accounts - not done): run `eas init` to create the EAS project
  and add `extra.eas.projectId` + `owner` to `app.json`, add `eas.json` with
  `development` / `preview` / `production` profiles (set `EXPO_PUBLIC_API_BASE_URL`
  per profile), add app icons/splash for RDP, configure Apple Team / Google Play
  service account credentials, then `eas build` and `eas submit`.

## Current status snapshot (already done)

- Core driver workflow is implemented (auth, list, detail, transitions).
- Offline queue and replay behavior are implemented (including bounded retries and conflict handling).
- Live location sync is implemented.
- ETA and route scaffold are implemented in delivery detail.
- Telemetry hooks are implemented in app flows.
- User-facing strings are externalized and runtime locale switching (fr/en) is implemented.

## Remaining work (priority order)

## 1) Accessibility review and evidence

- Run a full accessibility pass on Login, Delivery List, and Delivery Detail screens.
- Verify labels, roles, focus order, contrast, touch targets, and screen reader behavior.
- Record formal checklist evidence and outcomes.

Definition of done:
- Accessibility checklist completed and attached to QA evidence docs.
- Any a11y gaps fixed and validated on device/emulator.

## 2) Release-gate evidence for acceptance criteria (AC-DM-001..042)

- Consolidate explicit evidence for every required acceptance criterion.
- Close known IN PROGRESS criteria with objective artifacts.
- Keep traceability between criterion -> test/run -> screenshot/log.

Definition of done:
- All required AC items marked DONE with verifiable evidence.

## 3) Additional integration test coverage

- Add integration tests for remaining critical branches:
  - role mismatch login behavior (AC-DM-002 hardening)
  - replay conflict branches
  - manual retry/discard blocked actions
  - failure/offline UX branches with state merge evidence

Definition of done:
- Integration suite covers remaining high-risk branches and passes in CI/local runs.

## 4) End-to-end validation (happy path + failure path)

- Execute full E2E manual validation on mobile flow:
  - login -> list -> detail -> pickup/start/complete/fail
  - offline/reconnect behavior and queue replay outcomes
- Capture reproducible evidence artifacts (screenshots/logs/time).

Definition of done:
- End-to-end runbook executed and artifacts attached.

## 5) Delivery history (done in session 2)

- Delivery detail shows `GET /api/deliveries/{id}/history` as a timeline, with a
  fallback built from lifecycle timestamps when the history cannot be loaded.

## 6) Telemetry production wiring

- Hook EXPO_PUBLIC_DRIVER_TELEMETRY_ENDPOINT to a real ingest endpoint.
- Validate payload schema, reliability expectations, and dashboard visibility.
- Document event catalog and ownership.

Definition of done:
- Telemetry events are observable in the target analytics backend.

## 7) Roadmap/documentation synchronization

- Update roadmap status in docs/mobile-development-roadmap.md so completed items are no longer shown as TODO.
- Keep this README and roadmap aligned after each completed phase.

Definition of done:
- Docs match actual implementation state.

## Suggested execution sequence

1. Accessibility review and fixes.
2. AC evidence closure and docs update.
3. Remaining integration tests.
4. End-to-end validation evidence.
5. Optional order history feature (if still in scope).
6. Final release readiness review.
