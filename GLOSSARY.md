# db-accessor

db-accessor controls temporary access to database records. These terms describe its browser access boundary and record-access permissions.

## Language

**Browser login session**:
One successful application login shared by tabs using that login in the same browser profile. Logins in separate browser profiles, browsers, or devices have independent idle deadlines.
_Avoid_: User-wide session, tab session

**Qualifying activity**:
A user-triggered application API request, a keydown inside the application window, or the warning's Continue action that the backend accepts for an active browser login session. Background work and authentication maintenance are excluded.
_Avoid_: Any traffic, heartbeat

**Record-access grant**:
Permission to access records within an approved scope for its own validity period. Activity in a browser login session does not extend a record-access grant.
_Avoid_: Login permission, session extension
