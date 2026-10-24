---
status: accepted
---

# Enforce browser login sessions alongside Cognito authentication

Accepted on 2026-10-08. Cognito token renewal can outlive the application's idle deadline, and an old valid JWT must not create a replacement for an expired browser login session. Keep the existing browser OIDC flow and Cognito REST authorizer; extend the existing pre-token trigger to issue a signed, single-use bootstrap proof only during hosted login, and enforce persistent session state through a mandatory shared REST wrapper wired at the entrypoint/build boundary.

Use a dedicated DynamoDB session table with strong reads, conditional updates, and retained replay protection; a valid Cognito token alone does not authorize an interactive request. This preserves existing handler contracts and role/grant checks while avoiding a backend OAuth-exchange migration or replacement REST authorizer, at the cost of enforcing wrapper coverage and coordinating the frontend/backend cutover.

WebSocket connections reference the same browser login session, and the notification worker checks it immediately before dispatch. Already-authorized messages may complete after expiry because database authorization and network delivery cannot be atomic. Notification persistence remains per user, independently of which browser sessions are active.

The [design companion](../specs/idle-session-timeout-design.md) tracks dependent decisions and validation, including actual Cognito refresh-lineage behavior. This decision authorizes design documentation only, not implementation or deployment.
