# Driver Mobile - Roadmap Remaining Work

This README tracks what is still pending for the mobile app, based on the roadmap in docs/mobile-development-roadmap.md, adjusted with work already completed in this repository.

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

## 5) Optional feature: order history enhancement

- Implement optional order history view using:
  - GET /api/orders/{id}/history
- Add UI mapping and error/empty states.

Definition of done:
- Feature merged with tests and clear fallback UX when data is unavailable.

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
