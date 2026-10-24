# Enforce a 15-minute idle session timeout with a two-minute warning

## Problem Statement

An unattended db-accessor browser session can remain authenticated through automatic token renewal. Users need a clear warning before inactivity signs them out, and the backend must stop accepting access from an expired session even if the browser does not run its logout code.

The current application uses Cognito authentication, REST APIs, and WebSocket request-status notifications. It has no application-level idle-session tracking. The existing logout flow clears local authentication, closes the current tab's notification connection, and redirects through Cognito to the login page.

## Solution

Introduce a 15-minute idle timeout for each browser login session, shared by its tabs and enforced by the backend. Qualifying activity is a user-triggered application API request, any keydown inside the application window, or the warning modal's Continue action. Automatic background traffic and token renewal do not count.

After 13 minutes without qualifying activity, display a modal with the remaining time in minutes and seconds, a Continue button, and a warning that unsaved changes will be lost. An accepted activity signal resets the deadline to a fresh 15 minutes and clears warnings across the session's tabs. At the deadline, expire the session and log out even when unsaved changes exist.

Keyboard activity and Continue must reach the backend to extend its deadline. Local activity cannot override server expiry. An expired session cannot be revived by a late request, keypress, refresh token, page reload, or newly opened tab. The user returns to the existing login/SSO flow; fresh credential entry is not required by this feature.

## User Stories

1. As a signed-in user, I want my session to expire after 15 minutes without qualifying activity, so that leaving the application unattended does not leave it accessible indefinitely.
2. As a requester, I want user-triggered API requests to count as activity, so that requesting access, navigating records, and using application features keep my active session alive.
3. As an administrator, I want user-triggered administrative API requests to count as activity, so that reviewing access requests and managing rulesets follow the same session policy.
4. As a user editing a form, I want any keydown inside the application to count as activity, so that typing does not expire my session merely because I have not submitted the form.
5. As a keyboard user, I want keyboard navigation and modifier keydowns inside the application to follow the same activity rule, so that activity detection does not depend on entering text into a particular input.
6. As a signed-in user, I want automatic token renewal excluded from activity, so that authentication maintenance does not keep an unattended session alive.
7. As a signed-in user, I want background API requests excluded from activity, so that automated notification loading or maintenance does not silently reset my idle timer.
8. As a signed-in user, I want incoming WebSocket notifications excluded from activity, so that other people's actions do not extend my session.
9. As a signed-in user, I want a warning after 13 minutes of inactivity, so that I have two minutes to prevent logout.
10. As a warned user, I want a live minutes-and-seconds countdown, so that I know how much time remains before logout.
11. As a user with unsaved edits, I want the warning to explain that those edits will be lost, so that I can make an informed decision before the deadline.
12. As a warned user, I want Continue to request a fresh 15-minute window, so that I can resume working without signing in again while the session is still valid.
13. As a user who continues working, I want a successful extension to preserve the current route and form values, so that keeping my session alive does not discard my work.
14. As a warned keyboard user, I want keydown activity to reset the session under the same rule as other keydowns, so that the warning does not introduce a conflicting activity policy.
15. As a user with multiple tabs, I want activity in any tab to extend the shared browser login session, so that another idle tab does not log me out while I am working.
16. As a user with multiple tabs, I want warnings and accepted extensions synchronized, so that tabs do not show contradictory deadlines.
17. As a user with multiple tabs, I want expiry or logout to end the session across those tabs, so that another tab cannot retain access after sign-out.
18. As a user opening or reloading a tab, I want it to use the existing session deadline, so that page lifecycle events do not grant a fresh idle window by themselves.
19. As a user signed in on separate browsers or devices, I want those login sessions to expire independently, so that activity on one device does not keep another unattended device signed in.
20. As a user returning from computer sleep or a suspended tab, I want the application to recognize elapsed time immediately, so that suspended browser timers do not extend my session.
21. As a user returning before expiry but within the final two minutes, I want to see the actual remaining countdown, so that suspension does not restart the warning period.
22. As a user who ignores the warning, I want logout to occur at the deadline even with unsaved changes, so that the idle policy remains predictable.
23. As a user whose connection fails, I want an unsuccessful Continue action to report the failure and retain the existing deadline, so that the UI does not falsely claim that the backend extended my session.
24. As a user whose authenticated operation fails business validation, I want that attempted operation to count as activity when the backend has accepted the session, so that an ordinary application error does not make my interaction invisible.
25. As an application owner, I want invalid authentication and requests that never reach the backend excluded from extension, so that a client cannot locally manufacture a valid server session.
26. As an application owner, I want protected API requests from expired sessions rejected even when their Cognito tokens have not expired, so that browser-side logout is not the only enforcement mechanism.
27. As an application owner, I want existing notification connections to stop receiving protected notifications after session expiry, so that WebSockets do not bypass the same access boundary.
28. As an application owner, I want late or concurrent activity unable to revive an expired session, so that timing races cannot bypass the timeout.
29. As a logged-out user, I want a clear inactivity-expiry message on the login page, so that I understand why I was signed out.
30. As a logged-out user, I want to use the existing login and SSO flow, so that this feature does not introduce an additional credential-entry policy.

## Implementation Decisions

- Apply the same fixed policy to requester and administrator sessions: 15 minutes idle, warning during the final two minutes, expired at or after the deadline. Retain existing token lifetimes; do not introduce an absolute maximum session duration.
- Define a session per browser login, shared across same-origin tabs using that login. Separate browser profiles, browsers, and devices remain independent. Do not key the idle deadline only by user identity.
- Establish server-side session identity and persistent session state bound to validated authentication. State must support ownership, the authoritative idle deadline, and invalidation. Session creation must distinguish completion of a new login from reuse of existing credentials; merely holding an old valid JWT must not let an expired login obtain a replacement session. Exact storage keys and endpoint names are implementation choices.
- Start the initial 15-minute window when the backend establishes a session after successful login. Reuse its deadline on reload, tab creation, and ordinary authentication bootstrap. A new session after expiry requires the existing explicit login/SSO flow.
- Keep Cognito authentication and existing role, grant, and ruleset checks. Add an application-session check for every protected REST entrypoint, including read-only and background requests. A request can require an active session without counting as activity. Inactivity expiry must not be bypassed by a missing session identifier, token refresh, cached authorization, or a handler that omits the check.
- Qualifying user-triggered API requests extend an authenticated, unexpired session when accepted by the backend, before the business operation completes. A later validation or business failure does not undo accepted activity. Authentication/session rejection and traffic that never reaches the backend do not extend the server deadline. Receiving a late response is not itself new activity.
- Identify request causes explicitly at the UI action/request boundary. Navigation initiated by the user and its resulting API requests count. Startup loads, autonomous notification loading, automatic viewport-filling pagination, automatic mark-read work, polling, retries without a new user action, and authentication maintenance do not independently count. A URL alone cannot reliably distinguish these causes.
- Treat any keydown delivered inside the application window as activity, including while the warning modal is displayed. Do not collect key values or form contents. Browser chrome, other applications, pointer movement, focus changes, or clicks that neither issue a qualifying request nor activate Continue do not qualify on their own.
- Provide authenticated activity signaling for keyboard interaction and Continue. The backend returns enough session timing information for the UI to follow the authoritative deadline. Status synchronization must be distinguishable from activity so that observing a session cannot keep it alive.
- Keyboard signaling may coalesce events to control request volume, but must preserve the latest activity and must not allow an otherwise valid, actively used session to expire because a throttler postponed its signal past the deadline. Continue requests extension promptly. Avoid unconditional heartbeats and activity requests that recursively generate further activity requests. Exact scheduling mechanics remain implementation details to validate at boundary conditions.
- The backend determines whether a session is still active before extending it. Updates must preserve this condition under concurrent requests. Client-supplied timestamps or local storage changes cannot directly grant a later server deadline. Cleanup timing is not access enforcement; an expired record remaining in storage must still be rejected.
- Keep one application-wide session coordinator and reuse the existing UI component system for the warning. The modal reports the remaining time and potential loss of unsaved changes, and provides Continue. Backdrop dismissal cannot suspend the countdown or reset the session. A key such as Escape still follows the agreed any-keydown activity rule.
- Treat the last server-confirmed deadline as authoritative. On failed or unconfirmed extension, do not grant a fresh local 15-minute session. Report Continue failures without discarding the active form before the existing deadline. Non-extending synchronization can reconcile activity accepted by the backend when an acknowledgement was lost; it must not revive an expired session.
- Share accepted deadline changes and invalidation across tabs, scoped to the current login session. Ignore stale responses and messages from earlier sessions. Refresh deadline state on startup and resume without resetting it merely because the tab became visible. Browser scheduling suspension must not create an extra grace period.
- At expiry, clear authentication and session UI state, close the browser's notification connections, and perform the existing logout/login transition across tabs. Do not let unsaved-form navigation guards indefinitely postpone logout. Later completion of an in-flight operation must not restore an expired UI session. This does not require rolling back server work already accepted before expiry.
- Reuse session invalidation for explicit logout so another tab cannot continue using the same login session. Closing a single tab is not itself a new account-wide logout requirement.
- Technical failure clarification accepted on 2026-10-08: a tab whose last confirmed deadline has elapsed must reconcile shared state and non-extending server status before declaring session-wide expiry. If confirmation is unavailable, lock that tab's protected UI and API use and close its socket, without clearing shared credentials or broadcasting authoritative expiry; another tab may have extended the session. Confirmed expiry performs normal shared logout. This uncertainty state grants no extra access or new deadline.
- Technical failure clarification accepted on 2026-10-08: explicit logout tears down local access and notifies the same-session tabs immediately, with a bounded attempt at server invalidation before redirect. If the server cannot be reached, report that invalidation was not confirmed; do not persist credentials for a retry queue. Previously issued credentials may remain accepted by the backend until its existing deadline because an offline logout cannot be communicated to it.
- Bind WebSocket connections to the browser login session as well as the user. Reject new connections for expired sessions and prevent subsequent protected notification sends to expired sessions, even when the browser has not closed its connection. Notification persistence and delivery to the user's other active sessions continue normally. Incoming notifications never extend idle lifetime. This is a necessary coverage detail of backend enforcement, not a separate notification feature.
- WebSocket timing clarification accepted on 2026-10-08: authorize immediately before dispatch and reject new attempts authorized at or after expiry. A message already authorized and in flight may arrive after expiry; database authorization and network delivery cannot be made atomic.
- Coordinate implementation across the backend/application infrastructure and Angular UI repositories. Reuse existing authentication, response, dependency-injection, runtime-configuration, and notification patterns. Add infrastructure permissions and storage only as required for session enforcement. Internal scan workers and other service-to-service processing are not interactive browser sessions.
- Preserve existing grant expiration, record redaction, and administrative authorization. Session activity extends the login session, not a record-access grant.

## Testing Decisions

The following testing boundaries were accepted during technical design on 2026-10-08, including permanent UI regression coverage for this feature. Prefer two cohesive suites at public boundaries rather than separate tests for every timer, interceptor, storage helper, and component method.

1. **Backend session enforcement through request handling.** Exercise session establishment, status, extension, and protected requests through the handler/authorization boundary with a controllable clock and injected persistence. Reuse existing Jest handler tests and constructor-injected dependencies. Assert returned decisions, deadlines, protected-operation access, and observable state transitions rather than internal call choreography. Include the WebSocket connection and notification-delivery boundary for the same session policy.
2. **Browser session workflow through the application shell.** Exercise rendered countdown/warning behavior, Continue, actual keydown events, HTTP activity classification, logout navigation, and preservation of unsaved form values using the existing Angular Karma/Jasmine tooling with controlled time and API responses. Verify real cross-tab propagation and suspension/resume in a browser with two tabs; this check complements the deterministic shell tests because a mocked storage event cannot establish real browser synchronization behavior.

Required behavioral coverage:

- No modal before 13 minutes; correct remaining time from 13 minutes onward; expiry at 15 minutes, including exact threshold boundaries.
- Each qualifying activity source independently extends a still-valid session. Excluded traffic does not extend it, including silent token renewal and requests generated by the session machinery itself.
- Typing without business API requests stays active when activity signals are accepted. Coalescing does not drop the final keydown, extend indefinitely after typing stops, or create a premature expiry near a threshold.
- Continue and keydown during warning dismiss synchronized warnings after extension and preserve the current route and unsaved form values.
- Authentication failure, network failure, server rejection, and lost acknowledgements never create an unconfirmed local extension. Business errors after successful activity acceptance follow the agreed counting rule.
- Activity, Continue, and logout synchronize between two tabs. Separate browser login sessions remain isolated.
- Refreshing, opening a tab, focus/visibility changes, computer sleep, and resuming after expiry do not reset the server deadline. Resuming during the warning window shows only the actual remaining time.
- Valid Cognito credentials alone cannot bypass expired application sessions. Old-session requests, responses, activity signals, and cross-tab messages cannot revive a session or overwrite a new login's state.
- Concurrent activity and expiry have a consistent server outcome. State cleanup delays, retries, and authorization caching cannot authorize an expired session.
- Expired sessions cannot access protected REST operations or receive new protected WebSocket notifications. Active sessions for the same user remain usable.
- Both requester and administrator operations retain their existing authorization and grant-expiry behavior.
- Unsaved changes do not block timeout logout. The login page explains inactivity expiry and continues to use the existing SSO flow.

Prior art and validation:

- Existing backend PII detector handler tests exercise exported handlers, invalid inputs, and injected clocks. Existing issue-tracking audit worker tests demonstrate constructor-injected dependencies and response/error behavior. Existing WebSocket authorizer tests demonstrate allow/deny contract assertions.
- The UI has Karma/Jasmine and ChromeHeadless configuration, but no existing application spec files were found during inspection. Its repository guidance requests throwaway UI tests unless permanent tests are explicitly requested; on 2026-10-08 the user explicitly approved permanent session regression coverage using the existing tooling. A new browser-test framework is not authorized by that decision.
- Existing CDK assertion tests provide the pattern for focused checks that new session resources, permissions, and enforcement wiring are present. Infrastructure assertions supplement the two behavior boundaries; they do not prove runtime expiry by themselves.
- During implementation, run affected backend tests, backend compile/lint, infrastructure build/tests/synthesis for infrastructure changes, and UI build/lint plus the proposed session checks. Perform a browser integration smoke check against a test environment for REST, WebSockets, cross-tab behavior, and login/SSO. No feature tests or deployments have been performed while drafting this specification.

## Out of Scope

- A new absolute session lifetime or changes to Cognito access-token/refresh-token lifetime configuration.
- Requiring fresh credentials, MFA, or forced identity-provider reauthentication after idle logout.
- Automatic draft saving, draft recovery, or preventing logout because a form has unsaved changes.
- Mouse movement, passive reading, or generic focus/visibility events as activity sources.
- Monitoring keys outside the application, recording which keys were pressed, or collecting form content.
- Account-wide timers that couple separate browser logins or devices.
- Extending or otherwise changing record-access grants, redaction, approval rules, or administrative permissions.
- A new session-management dashboard, configurable per-role timeout policies, or general notification redesign.
- Cancelling or rolling back backend work accepted before the session expired.
- Committing, deploying, or implementing the feature as part of writing this specification.

## Further Notes

- Product behavior is synthesized from the completed requirements discussion. The final login behavior is the existing SSO flow, and the original API-only definition of inactivity has been superseded by user-triggered API requests plus keydown activity.
- Infrastructure and authentication coverage details above are engineering consequences of the agreed backend enforcement requirement. Exact API route names, storage schema, session-binding mechanism, activity transport, and tab coordination mechanism are implementation choices, constrained by the listed behavioral requirements and tests.
- No project domain glossary or authentication ADR was found during inspection. Terms in this specification follow the current application: requester, administrator, access request, grant, ruleset, record, and request-status notification.
- The user does not have an issue tracker. This local project document is the specification deliverable; tracker setup, issue publication, and triage labels are not required.
- The testing boundaries and permanent session regression coverage were accepted on 2026-10-08. Detailed technical decisions are tracked in [the design companion](idle-session-timeout-design.md). No issue has been created, and the feature has not been implemented by preparing these documents.
