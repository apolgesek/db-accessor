# db-accessor

db-accessor controls temporary access to database records. These terms describe its browser access boundary and record-access permissions.

## Language

### Browser access

**Browser login session**:
One completed application login, including a silent SSO re-entry, shared by every tab of the browser profile that uses it. Separate browser profiles, browsers, and devices have separate browser login sessions.
_Avoid_: User session, account session, tab session

**Idle deadline**:
The server-recorded moment at which a browser login session expires unless qualifying activity is accepted first. Only the backend moves it, and only forward.
_Avoid_: Local timer, token expiry

**Qualifying activity**:
A keydown, click, or tap inside the application window, or Continue on the expiry warning, that the backend accepts while the browser login session is still active. API requests, background work, incoming notifications, and authentication maintenance are never qualifying activity on their own.
_Avoid_: Any traffic, heartbeat, API activity

**Expiry warning**:
The notice shown during the final two minutes before the idle deadline, with a live countdown and a Continue action.
_Avoid_: Timeout popup, idle modal

**Timeout logout**:
The end of a browser login session because the backend confirmed its idle deadline has passed.
_Avoid_: Auto-logout, session kill

**Explicit logout**:
The end of a browser login session because the user chose to sign out, regardless of its idle deadline.
_Avoid_: Sign-off, local logout

**Login expiry**:
The end of a browser login session because its login reached the 12-hour maximum and can no longer renew authentication, regardless of qualifying activity.
_Avoid_: Timeout logout, token expiry

**Locked tab**:
A tab that cannot confirm whether its browser login session is still active, so it withholds protected content and use until the backend answers, without ending the session for other tabs.
_Avoid_: Grace period, suspended session

### Record access

**Record-access grant**:
Permission to access records within an approved scope for its own validity period. Qualifying activity extends a browser login session, never a record-access grant.
_Avoid_: Login permission, session extension
