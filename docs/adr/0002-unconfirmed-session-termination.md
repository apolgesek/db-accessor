---
status: accepted
---

# Distinguish suspected expiry from explicit logout

Accepted on 2026-10-08. A tab can miss an extension accepted for another tab, and an offline browser cannot communicate a logout to the server. When an elapsed local deadline cannot be reconciled, lock that tab's protected UI and API use and close its socket without invalidating the shared session or clearing shared credentials; only confirmed expiry triggers shared timeout logout.

Explicit logout is intentional invalidation regardless of the deadline: tear down local access, notify the same-session tabs, and make a bounded server invalidation attempt before redirect. Report an unconfirmed attempt without storing credentials for later retries, accepting that backend access may persist until the existing deadline if the server could not be reached.

These choices avoid falsely ending another tab's active session and avoid indefinitely blocking explicit logout. They clarify the [functional specification](../specs/idle-session-timeout.md) under network failure; they do not create a grace period or allow protected access while session validity is uncertain.
