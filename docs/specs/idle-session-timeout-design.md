# Idle session timeout technical design

Status: technical design confirmed by the user on 2026-10-23, including Q1-Q12 and the final implementation details reviewed in Q13. The design session is complete. No implementation is authorized by this document.

The [functional specification](idle-session-timeout.md) is fixed. This companion records implementation facts and tracks decisions; recommendations remain proposals until resolved with the user.

## Existing ownership and extension points

| Concern | Existing location | Implication |
| --- | --- | --- |
| Cognito login and role claims | `infra/lib/cognito.ts`, `src/functions/pre_token_generation/main.ts` | The existing V3 pre-token trigger is an extension point for distinguishing new hosted login from refresh. It currently only maps roles and intentionally has no logging permissions. |
| Protected REST methods | `infra/lib/rest-api.ts` | All 18 methods share Cognito authorization; there is no shared runtime HTTP enforcement wrapper today. |
| HTTP contracts | `src/shared/response.ts`, colocated request schemas | Preserve current response bodies and validation conventions when adding session metadata. |
| Persistent application state | `infra/lib/dynamodb-tables.ts` | Existing domain tables use DynamoDB on-demand billing. Session lifetime is separate from grants and rulesets. |
| WebSocket authentication and connection state | `src/functions/websocket_authorizer/main.ts`, `src/functions/websocket_connect/main.ts` | Connections currently bind to a user, without a browser login session. |
| Protected notification delivery | `src/functions/request_status_notification_worker/main.ts` | A single worker persists user notifications and sends them to that user's connections; session enforcement must cover each delivery attempt. |
| UI authentication bootstrap | `../db-accessor-ui/src/app/app.config.ts`, `auth/local-storage.service.ts` | OIDC authorization-code flow and refresh already use shared local storage. Current bootstrap does not distinguish fresh login from reuse for backend purposes. |
| UI authentication identity | `../db-accessor-ui/src/app/core/services/auth.service.ts` | Owns authenticated state and roles; no idle-session coordinator exists. |
| UI shell and logout | `../db-accessor-ui/src/app/app.ts` | Owns notification startup and the current local logout/Cognito redirect sequence. |
| Notification UI state | `../db-accessor-ui/src/app/core/services/notification.service.ts` | Owns pagination, unread state, and WebSocket transport. |

UI source paths above are relative to the backend repository root and refer to its sibling repository.

## Decision tree

Accepted first-round decisions (Q1-Q6):

- Q1: Extend the existing Cognito pre-token trigger with a random, signed bootstrap-proof claim issued only during hosted login, absent on refresh. Consume the proof once to establish a session; retries may recover the same active session without extension. Retain replay protection beyond idle expiry. Actual token-family behavior remains an integration validation requirement. Existing users must explicitly log in once at cutover.
- Q2: Keep Cognito REST authorization and introduce a mandatory shared wrapper before business validation. Enforce wrapper inclusion through common entrypoint/build wiring and coverage assertions, rather than individual handlers opting in. Attach accepted session timing to successful and business-error responses while preserving existing authorization checks.
- Q3: Add a dedicated on-demand DynamoDB session table and shared backend session module. Use strong reads and conditional writes, without positive session-authorization caching. Notification workers receive read-only session access.
- Q4: Use one root Angular session coordinator per tab with namespaced local storage and storage events, without an elected tab leader. Keep identity/roles in AuthService and notification state/transport in NotificationService. Render the warning with ng-zorro in the application shell.
- Q5: Enforce WebSocket expiry at authorization immediately before dispatch. Already-authorized messages in flight may complete after expiry. New attempts authorized at or after expiry are rejected.
- Q6: Retain permanent UI regression coverage for this critical feature with existing Karma/Jasmine tooling, alongside backend boundary tests, CDK assertions, and a real two-tab smoke check. This feature-specific approval overrides the UI repository's default throwaway-test convention; it is not authorization to add unrelated tests or a new framework.

Q7-Q12 below were accepted together on 2026-10-08. The final design details were confirmed together in Q13 on 2026-10-23.

## Accepted second-round decisions (Q7-Q12)

### Q7: Session record and concurrency

Use the random signed bootstrap-proof identifier as the session ID and table key. Derive it from the validated initial access token, not a client-supplied proof body. One record serves as the session and consumed-proof marker, avoiding a separate proof ledger and cross-record transaction. Bind immutable Cognito subject, client ID, and refresh-token lineage; validate actual `origin_jti` behavior before relying on it.

Store creation time, authoritative idle deadline, initial proof-token expiry, revision, invalidation state, and cleanup TTL. Retain a record beyond both its current idle deadline and initial proof-token expiry plus verifier clock tolerance. Only establishment can conditionally create a row. Repeated establishment returns the same active session without extending it; expired/revoked rows cannot be re-established. The original signed token's validity bounds an unused proof's admission; no shorter bootstrap lifetime is proposed.

Use strong reads and conditional version updates. Extension checks ownership, non-invalidation, and deadline strictly greater than fresh server admission time, then preserves the greater of the existing deadline and admission time plus 15 minutes. On conflict, reread and re-evaluate time and state. Do not blindly replay stale timestamped SDK mutations. On uncertain write acknowledgement, use non-extending reconciliation. Explicit logout invalidates conditionally; timeout detection must never unconditionally invalidate from a client deadline.

### Q8: HTTP contract

Endpoints: `POST /session` establishes from a validated login-proof-bearing access token; `GET /session` observes; `POST /session/activity` accepts keyboard/Continue activity; `DELETE /session` explicitly invalidates. Logout must be idempotent and able to acknowledge an already-ended session without extending it.

Keep the existing Cognito Authorization bearer header. Established-session requests additionally carry `X-App-Session-Id`. Business requests explicitly marked as user-triggered carry `X-App-Activity: user`; omitted activity is background. This declares request cause; it does not attest that a human physically initiated it. Authentication and server state remain the access boundary.

Session responses return session ID, server time, idle deadline, and revision. Preserve existing business response bodies; expose equivalent timing headers through CORS on successes and business errors after session acceptance. Session responses use `Cache-Control: no-store`. Session rejection uses 401 with a stable code; session-store unavailability uses 503 and must not execute protected work. Business 400/403 responses retain their current meaning and may carry accepted activity metadata.

### Q9: Request causes and keyboard cadence

Use per-request Angular HttpContext with background as the default. Explicit user action handlers and transient router navigation `info` propagate foreground cause through their resulting reads. Capture navigation cause during resolver execution; do not persist it in browser history. Initial loads/new tabs, autonomous follow-up work, and automatic retries stay background. Programmatic form population must not accidentally inherit a foreground cause.

Use a five-second leading/trailing keyboard coalescing window per tab: send the first keydown promptly, retain the latest pending keydown, and flush once at the trailing boundary. Continue and keydowns during the warning bypass the ordinary delay, with concurrent bursts coalesced while a prompt signal is in flight. A hung request must not indefinitely block later genuine activity. Stop after pending activity is flushed; no unconditional heartbeat. Backend receipt before expiry is necessary; browser/network stalls cannot be eliminated by scheduling. This favors prompt confirmation over the lower request volume of a longer coalescing window.

### Q10: Unconfirmed expiry in a stale or offline tab

At suspected expiry, reread shared confirmed state and request non-extending server status. Another tab may have extended the session; localStorage writes themselves have no cross-tab compare-and-swap, so the persisted snapshot is not authoritative.

If confirmation cannot be obtained by the last confirmed deadline, block protected UI/API use and close that tab's socket without broadcasting authoritative expiry or clearing shared OIDC storage. If status later confirms expiry, perform the shared timeout logout. If it confirms an extension, resume from that state. The user accepted this narrow failure-mode clarification: an offline tab cannot guarantee both immediate global logout and avoidance of falsely logging out an active shared session. No new local deadline or backend access is granted while uncertain.

### Q11: Explicit logout when invalidation cannot be confirmed

Unlike suspected expiry, explicit user logout is an intentional session-wide action. Perform immediate local teardown and same-session tab notification, with a bounded server invalidation attempt before the existing redirect. If invalidation cannot be confirmed, report that fact without persisting credentials for a background retry queue. The backend may continue to recognize the session until its existing idle deadline; it cannot learn about an offline action. The user accepted this limitation instead of holding logout indefinitely for server confirmation.

### Q12: Deployment and compatibility

Both repositories deploy independently on merged PRs; their concurrency groups do not coordinate across repositories. Use a coordinated backend-enforcement-first, then UI cutover, accepting a brief interruption and the already-approved one-time login. Old clients and legacy WebSocket rows fail closed once enforcement is active. The user chose this over a three-stage compatibility rollout. No sessionless compatibility path remains after enforcement.

## Concrete wiring and verification consequences

The existing Lambda factory can select a single shared protected REST entrypoint and use an esbuild define to select the existing business module at build time. Preserve separate function bundles, IAM, and handler files. Register protected functions and have the REST route helper reject unregistered integrations at synthesis, with an explicit establishment-route exception and operation-specific session lifecycle policies. Internal workers and WebSocket handlers retain their own entrypoints.

Implementation validation must invoke a built protected export as well as test route-registration coverage; direct business-handler tests cannot prove wrapper deployment. The installed esbuild constant substitution was inspected, but full protected-entrypoint bundling remains to validate during implementation.

The approved permanent UI workflow suite should run in UI CI, which currently runs only build and lint. Keep constructor-injected persistence/time seams for backend boundary tests, and test successful/failed conditional updates and concurrent outcomes rather than only generated SDK arguments. Concrete coverage and observability are specified below.

## Confirmed final design details

### Module ownership and boundaries

| Location | Responsibility |
| --- | --- |
| `src/shared/` session contracts, session service, DynamoDB store, protected REST entrypoint | Browser-session decisions, persistence, mandatory REST admission, and response metadata. Constructor-injected clock/store follow existing handler patterns; keep AWS persistence separate from policy logic. |
| `src/functions/pre_token_generation/` | Stateless initial-login proof generation alongside existing role mapping. Preserve its intentionally absent logging permissions; do not store per-login data in Cognito user attributes. |
| New `src/functions/establish_session/`, `get_session/`, `record_session_activity/`, `invalidate_session/` handlers | Thin session HTTP boundaries with existing LambdaHandler, Joi, and APIResponse conventions. |
| Existing business handlers | Business validation and admin/grant/ruleset authorization after session admission. Session activity does not alter grant validity. |
| Existing WebSocket authorizer/connect/disconnect and notification worker | Session-bound connection admission and per-attempt notification authorization; user notification persistence remains independent. |
| `infra/lib/dynamodb-tables.ts`, `lambda-factory.ts`, `lambda-functions.ts`, `rest-api.ts`, `websocket-api.ts` | Session resources, least-privilege IAM, wrapped entrypoint wiring, lifecycle-route policies, CORS, and handshake identity inputs. Shared edge already disables REST caching and forwards the required headers. |
| UI `core/services/`, `core/models/`, and functional interceptor | Root coordinator, typed SessionHttp wrapper/DTOs, session headers, response handling, and request-generation fencing. |
| UI `app.config.ts`, `app.ts`, `app.html`, login component | Bootstrap gating, shell warning/lock, shared logout sequence, and login-page reason display. |
| UI action handlers, route resolvers, and thin HTTP services | Explicit per-request activity cause propagation. No general application state framework or new event bus. |

Session HTTP interactions are synchronous because accepted state must be known before granting access or claiming extension. Notification persistence/delivery keeps the existing asynchronous SQS pipeline. Internal scan/audit/email workers do not become browser-session participants.

### Stored record and access rules

Use an opaque cryptographically random proof/session identifier. The record contains `sessionId` (partition key), `ownerSub`, normalized `userId`, `clientId`, `originJti`, `createdAt`, `idleExpiresAt`, `proofExpiresAt`, `revision`, optional `invalidatedAt`, and `ttl`. Authoritative times use Unix milliseconds; DynamoDB TTL uses seconds. No groups, JWTs, refresh tokens, key values, or form contents are stored in the session row. Role decisions use the current authenticated request's claims.

Cleanup TTL is at least one day beyond the later of the current idle deadline and original proof expiry plus the verifier's accepted clock tolerance. Update it when extending the deadline. TTL is cleanup only: authorization rejects expired rows regardless of their presence. With no account-wide listing or administration requirement, no session GSI is needed.

Only establishment may create a row, using a condition that it does not exist. Establishment requires the supported client, access-token type, required scope, and initial-login proof from validated claims; a supplied identifier alone is insufficient. An active duplicate returns 200 with the existing snapshot; a new row returns 201. An expired/revoked duplicate is rejected. Missing proof requires explicit login; neither refresh nor a missing local session identifier enables replacement establishment.

All subsequent REST and WebSocket admission binds the supplied session ID to the authenticated subject, client, and refresh lineage. A session ID is not sufficient authorization on its own. Do not accept a fallback identity derived only from username, token issue time, or authentication time. If required claims are absent or actual lineage behavior fails validation, fail closed and revisit this binding before release.

Atomic extension uses revision, non-invalidation, and deadline conditions together. Natural expiry needs no scheduled transition: `idleExpiresAt <= admissionTime` is expired. Explicit invalidation increments revision and is terminal. Application-controlled retries reread state and obtain fresh admission time; bound contention retries and return 503 if they cannot complete. Configure timestamped DynamoDB mutations for a single transport attempt so hidden retries cannot replay an old admission decision. Reconcile uncertain outcomes with a strong read; never reclassify an automatic retry as new user activity.

### HTTP metadata and route policies

Session snapshots use `{ sessionId, serverNow, idleExpiresAt, revision }`. Expose `X-App-Session-Id`, `X-App-Server-Time`, `X-App-Session-Deadline`, and `X-App-Session-Revision` on admitted business responses; serialize numeric values as decimal header strings. The wrapper samples server time near response construction while retaining the deadline/revision actually confirmed by admission. A later operation response is not a fresh activity event and may already be obsolete.

Allow the request session/activity headers in CORS and expose the response headers on success and business errors. Use no-store on session-dependent API responses. Do not cache session checks in Lambda globals, API authorization results, a CDN, or the browser; JWT public-key caching is unrelated and may remain.

Session errors preserve the existing message field and add a machine-readable code: `SESSION_REQUIRED`, `SESSION_INVALID`, `SESSION_EXPIRED`, `SESSION_REVOKED`, or `LOGIN_REQUIRED` with 401; `SESSION_UNAVAILABLE` with 503. Avoid revealing another session's ownership or existence. Existing business errors retain their meanings. The wrapper maps an uncaught business exception to a generic 500 with accepted timing metadata, without exposing internal error details; a function timeout or lost response remains unconfirmed and requires status reconciliation. A plain Cognito 401 cannot be treated as proof that the application session expired or as permission to establish a replacement.

| Route policy | Admission behavior |
| --- | --- |
| Business REST | Cognito authentication, session/owner check, optional activity acceptance, then business validation. An eventual business 400/403 does not undo activity. |
| Establish | Cognito plus supported fresh-login proof, with conditional creation/reuse. No active-session prerequisite. |
| Status | Cognito plus owner/session validation; observe only. |
| Activity | Cognito plus active-session validation; atomically extend before returning 200 snapshot. |
| Invalidate | Cognito plus ownership validation; revoke without extending, returning 204 idempotently when already ended. It must not require an unexpired session to acknowledge logout. |
| OPTIONS | Public CORS preflight only; no activity or session mutation. |

API infrastructure must enumerate these policies explicitly. A missing session or an unregistered business integration cannot silently select the establishment exception.

### UI lifecycle, timing, and cross-tab behavior

Use coordinator states `bootstrapping`, `active`, `warning`, `locked`, `terminating`, and `signedOut`. Warning is a presentation of the confirmed deadline's final two minutes. Hold authenticated route activation and notification startup until session establishment/status succeeds; an OIDC authenticated event by itself cannot set the application to active.

On a validated fresh-login callback, establish once. On ordinary reload/new-tab startup, read the stored identity and request status without extension. Read-only status reconciliation also runs on resume, online recovery, or explicit Retry. Deduplicate concurrent synchronization in each tab; do not add polling or a heartbeat. A terminal session cannot return to active from an old response. A new login creates a new generation.

Share session ID, deadline, server revision, and generation-scoped terminal events through namespaced storage. Apply same-tab writes locally because that tab receives no storage event for its own write. Ignore lower revisions and other-session responses/messages. Recheck persisted generation before processing asynchronous completions, because a resumed tab can receive a network callback before its storage event. Storage is an advisory snapshot: concurrent writes are not atomic compare-and-swap, so startup/resume still asks the backend.

Each tab owns its own server-clock sample from request/response timing; never share a raw monotonic-clock reading across tabs. Derive remaining time from the absolute server deadline, not by decrementing an assumed 15-minute counter. Use monotonic elapsed time during normal operation and compare wall-clock elapsed time to detect suspension or clock changes. Resume or a suspect clock triggers status reconciliation before protected access resumes. Browser sleep behavior varies, so a monotonic timer alone is insufficient ([MDN performance.now](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now)).

Network delay makes browser/server clock alignment approximate. Maintain a server-time interval from the response's server timestamp and measured request duration, advancing it with local elapsed time. Use the lower time bound to avoid declaring the warning threshold reached prematurely, and the upper bound to trigger conservative locking/status reconciliation at possible expiry. Display a conservative remaining countdown; unavoidable network uncertainty can shorten the visible warning or temporarily lock slightly early. Prefer a fresh, short status sample when uncertainty affects a boundary. The backend remains the access authority. Rendering, countdowns, and tab messages never grant a later deadline. A fresh timing sample must not override a higher session revision or a terminal generation.

Warnings and temporary locks keep routed forms mounted. A locked tab covers and disables protected content, blocks business requests and keyboard activity signaling, and closes its socket. Permit only authentication maintenance and non-extending status reconciliation. Confirmed active status restores the same form/route and actual remaining time; do not replay queued keydowns or failed mutations. Confirmed expiry or explicit logout clears protected state and terminates the generation before redirect. There are no existing unsaved-form guards to refactor; terminal logout must remain independent of such guards if added later.

Use the existing ng-zorro modal with backdrop dismissal disabled. Escape still qualifies as keydown; only accepted extension clears the warning. Continue failures remain visible without resetting the deadline. A successful extension clears synchronized warnings and preserves forms.

Do not infer activity from any global recent-click flag. Carry user action cause through its directly resulting reads/navigation; automatic retries, viewport filling, mark-read work, token maintenance, and unrelated follow-up refreshes are background. Browser back/forward after bootstrap follows user navigation under the current application; initial navigation and new-tab bootstrap remain background. Each request gets its own HttpContext.

Installed OIDC 21.0.1 can complete a refresh after `logoffLocal()` and write credentials again. Fence configured token-endpoint refresh responses with the same captured login generation used for business requests; cancel/suppress old-generation completions before the OIDC library receives them. Complete canceled old work rather than fabricating an error that could clear a newer login's credentials. Keep these requests excluded from activity. Do not terminate refresh solely because the coordinator is temporarily locked; reconciliation may need valid credentials.

Notification HTTP callbacks and socket events also carry generation fences. Terminal teardown cancels old work and clears notification arrays/counts as well as closing the socket. Reconnect only after active status is confirmed, reading the current access token at connection time.

If shared storage is unavailable at startup, show a blocking session setup error rather than silently creating an independent in-memory session. A mid-session storage failure locks that tab and allows retry. Malformed data triggers reconciliation, never replacement creation. If storage also prevents an explicit-logout broadcast, local cleanup and backend invalidation still proceed; disconnected tabs cannot be guaranteed immediate receipt of that event.

Use a three-second upper bound for the explicit logout invalidation attempt, capture the request credentials in memory before local cleanup, and perform no persistent retry queue. Preserve the Cognito allowlisted `/login` redirect. Keep a non-sensitive namespaced login reason so the login page can explain inactivity or unconfirmed sign-out; scope delayed logout work to its original session so it cannot clear a newer login.

### WebSocket admission, delivery, and cleanup

Use the existing query-token handshake with a current access token plus `sessionId`; restrict the verifier to access tokens, aligning with REST rather than keeping dual ID/access token rules. Configure both handshake identity inputs. Admission checks current session state and matching identity; connect rechecks before persisting. Neither step extends the deadline.

Connection rows contain existing `connectionId`, normalized `userId`, `connectedAt`, and cleanup TTL, plus trusted `ownerSub` and `sessionId`. Never persist JWTs. Legacy rows without binding cannot receive protected delivery and are not backfilled from user identity alone.

Persist notifications per user first, then discover that user's connections. Before each actual send attempt, strongly read and validate the referenced session and subject. Expired, revoked, missing, mismatched, or legacy destinations are successful skips. A session-store outage prevents that destination's send and contributes to the existing SQS record failure; independently validated destinations can finish. Await all destination results before reporting batch failure.

Disable hidden API Gateway Management SDK send retries and let SQS retries pass through fresh session checks. A single already-authorized send may still finish after expiry under Q5. AWS defines maximum attempts as including the initial attempt, so one attempt disables automatic retries ([AWS retry behavior](https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html)). Existing record-level retries can duplicate successful notification delivery; do not add a deduplication redesign here.

Reuse disconnect handling, GoneException deletion, and the existing connection TTL for cleanup. Do not introduce an expiry scheduler, per-session connection index, or server DeleteConnection calls. Denying delivery is the backend enforcement boundary; browser teardown closes its own sockets.

### Observability

Reuse CloudWatch and existing console logging. Emit structured operation/outcome/reason, request or message ID, and latency for session establishment/invalidation, rejection, and operational failures. Do not log every accepted keyboard extension. Exclude JWTs, proof/session identifiers, record keys, form data, notification payloads, and raw WebSocket query strings. Expected expiry is an ordinary rejection, not an infrastructure fault.

Recommend a low-cardinality operational-failure log counter with a CloudWatch alarm on any failure within a five-minute period, and an alarm on a nonempty notification DLQ, following the existing CDK alarm style. Missing data is non-breaching. Handled HTTP 503 and SQS partial failures must increment the failure signal because they do not reliably appear as native Lambda errors. There is no existing alarm-action destination; create visible alarm state without introducing a new messaging integration or claiming someone will be paged. No dashboard, logger framework, or separate audit stream is required.

### Verification and release gates

| Boundary | Required coverage |
| --- | --- |
| Cognito proof and ownership | Hosted login gets proof; refresh does not; old initial-token replay after idle expiry/revocation cannot recreate; subject/client/family mismatch rejects; parallel bootstrap returns one session. |
| Backend request handling | Exact 13/15-minute timing policy, business failure still counts accepted activity, excluded traffic observes only, explicit invalidation races activity, concurrent extension never regresses deadline, cleanup cannot revive, uncertain write reconciles, unavailable store prevents business work. |
| Built REST integration | Invoke the bundled protected export with missing/expired sessions and prove business work is unreachable. Assert every protected API integration is registered and raw integrations fail synthesis; check lifecycle exceptions explicitly. |
| WebSocket and worker | New connection rejects expired/mismatched session, connect crossing expiry, per-user active and expired sessions isolated, legacy rows skipped, notification persistence preserved, operational lookup failure retries while other valid destinations finish, fresh check on every SQS send attempt. |
| Permanent Angular workflow suite | Real keydown events, five-second final-event flush, warning/Continue success and failure, activity causes through navigation/forms/notifications, error-response timing, form preservation, exact countdown thresholds with controlled clocks, locked recovery, stale response/storage/socket rejection, storage errors, and OIDC refresh completing after logout/new login. |
| Real browser and test environment | Two tabs extend/warn/logout together; separate browser logins stay independent; reload/new tab does not extend; sleep/resume both before and after expiry; lost acknowledgement and offline lock; REST/WS enforcement without client logout; reconnect uses current token. |

Use existing Jest and Karma/Jasmine with injected clocks, stores, and HTTP responses. No new browser-test framework is required: supplement deterministic suites with a documented manual two-tab smoke check. Exercise concurrent conditional behavior against the real test-environment DynamoDB table before release, rather than assuming a fake store proves AWS consistency. Add the permanent UI workflow suite to CI. Run backend compile/lint/unit, affected infrastructure build/tests/synth, and UI build/lint/tests during implementation.

Before cutover, verify real Cognito claims through hosted login, refresh, SSO re-entry, and independent browsers: a new login must have a distinct proof, refresh must not carry it, and the session binding must remain stable only within the intended login. No credentials or tokens belong in logs or committed test fixtures. If this gate fails, revise the binding design; do not add a sessionless fallback.

The common-entrypoint build mechanism must also be validated against the installed CDK/esbuild bundle, including isolated business-module selection. Documentation inspection has not proven those runtime gates.

Release backend enforcement, then UI in the agreed brief cutover window. Existing clients must reload and explicitly sign in; old unbound connections are denied. No data backfill or grant migration is needed. Rollback must not silently reopen sessionless access: prefer a corrective release or keep affected access unavailable. Shared hosting configuration requires no change unless implementation uncovers a concrete CORS/header discrepancy.

## Coverage of the requested design review

Module placement, existing architectural patterns, frontend/backend ownership, persistence, API contracts, domain boundaries, synchronous/asynchronous interactions, concurrency, caching, authentication/authorization, failures, compatibility, observability, and testing are all addressed above. Q1-Q12 and the final-detail package are confirmed. No design decisions remain open in this session. Runtime validation gates remain required implementation work; no feature implementation or deployment has been authorized or performed in this design session.

## Accepted WebSocket timing limit

DynamoDB authorization and API Gateway WebSocket delivery cannot form one atomic operation. A message authorized while the session is active can arrive after expiry. The user accepted enforcement at authorization immediately before dispatch (Q5), including completion of already-authorized messages in flight.

## Documentation and validation

The [glossary](../../GLOSSARY.md) records terminology already settled by the functional specification. [ADR 0001](../adr/0001-browser-session-enforcement.md) records the accepted authentication and enforcement boundary. Source inspection only; no builds, tests, deployment, or feature implementation has been performed.
