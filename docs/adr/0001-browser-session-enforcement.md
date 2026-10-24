---
status: accepted
---

# Enforce idle browser login sessions in the backend, keyed by Cognito login lineage

Cognito token refresh can keep credentials valid long after a browser login session's 15-minute idle deadline, so a valid JWT alone must not authorize interactive use. We keep the existing Cognito OIDC flow and REST authorizer and add backend-owned session state in a dedicated DynamoDB table, keyed by the access token's `origin_jti`: the identifier Cognito assigns to one login's refresh-token lineage. A new login gets a new `origin_jti` and refreshes keep it, so the server derives the session from the token itself, and a retained row for an ended session stops every token of that login from starting a new idle window. Every protected REST handler is explicitly wrapped with a session guard, and a unit test fails when a registered REST route's handler is not wrapped. WebSocket connections bind to the same session, and each notification send is authorized immediately before dispatch.

The idle deadline moves only through an explicit activity endpoint that the UI calls for keydowns, clicks, and Continue inside the application. Business API requests require an active session but never extend it.

A tab that cannot confirm whether the session has expired locks itself instead of logging out every tab; only confirmed expiry triggers the shared timeout logout. Explicit logout always tears down local access immediately and makes one bounded server invalidation attempt, accepting that an unreachable server keeps recognizing the session until its existing idle deadline.

## Considered Options

- **Signed single-use bootstrap proof from the pre-token trigger as the session ID.** Rejected as the primary design: it adds a custom claim, a client-sent session header, and proof-expiry bookkeeping, yet still needed `origin_jti` to bind refreshed tokens to the login. It remains the fallback if `origin_jti` fails validation.
- **Counting user-triggered business API requests as activity.** Rejected: every action handler and route resolver would have to classify its requests, and misclassification is silent. Counting the gestures themselves is simpler and almost equivalent; the difference is that a click which sends no request also counts.
- **Build-time shared entrypoint selected with an esbuild define.** Rejected: unproven bundling behavior and harder to follow than an explicit wrapper, which gets the same guarantee from a coverage test.
- **Replacement Lambda REST authorizer or backend OAuth token exchange.** Rejected: a larger migration that re-implements Cognito validation and loses the existing authorizer.
- **Global logout from any tab whose local deadline elapsed.** Rejected: a stale or offline tab would falsely end a session another tab had just extended.

## Consequences

- Session rows must be retained for at least the longest lifetime of a login lineage (refresh-token validity plus access-token validity). Changing Cognito token lifetimes, disabling token revocation (without which Cognito omits `origin_jti`), or enabling refresh-token rotation requires revisiting this decision.
- Access and ID tokens last 15 minutes and refresh tokens 12 hours. With rotation off, Cognito counts refresh validity from the original login, so the refresh token also caps every login at 12 hours regardless of activity; no separate absolute-lifetime mechanism exists. The short access token bounds how long a disabled user or a removed group membership keeps working, because the REST authorizer validates JWTs without checking revocation.
- Authorizing a WebSocket message and delivering it cannot be atomic, so a message authorized just before expiry may arrive just after it.
- There is no sessionless compatibility path. Once backend enforcement is live, clients without session support fail closed until they reload the updated UI.
