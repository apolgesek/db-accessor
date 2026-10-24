import { ACCESS_TOKEN_VALIDITY_MINUTES, REFRESH_TOKEN_VALIDITY_HOURS } from './token-lifetimes';

// Pure browser-login-session rules: no AWS and no clock of its own; callers pass `now` in Unix ms.

export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

const MINUTE_MS = 60 * 1000;
const RETENTION_MS =
  REFRESH_TOKEN_VALIDITY_HOURS * 60 * MINUTE_MS + ACCESS_TOKEN_VALIDITY_MINUTES * MINUTE_MS + 24 * 60 * MINUTE_MS;

// Identity taken from a validated web-client access token.
export type SessionClaims = {
  sessionId: string; // origin_jti
  ownerSub: string;
  clientId: string;
  userId: string;
};

export type SessionRecord = {
  sessionId: string;
  ownerSub: string; // immutable binding
  clientId: string; // immutable binding
  userId: string; // normalized app username, diagnostics only
  createdAt: number;
  idleExpiresAt: number; // expired when <= now
  revision: number;
  invalidatedAt?: number; // explicit logout; terminal
  ttl: number; // Unix s; cleanup only
};

export type SessionSnapshot = { sessionId: string; serverNow: number; idleExpiresAt: number; revision: number };

export type SessionRejection = 'SESSION_REQUIRED' | 'SESSION_EXPIRED' | 'SESSION_REVOKED' | 'LOGIN_REQUIRED';

export function newSessionRecord(claims: SessionClaims, now: number): SessionRecord {
  return {
    sessionId: claims.sessionId,
    ownerSub: claims.ownerSub,
    clientId: claims.clientId,
    userId: claims.userId,
    createdAt: now,
    idleExpiresAt: now + IDLE_TIMEOUT_MS,
    revision: 1,
    // Outlives every token of the lineage, so an ended session's row exists while its tokens still work.
    ttl: Math.floor((now + RETENTION_MS) / 1000),
  };
}

export function toSnapshot(record: SessionRecord, now: number): SessionSnapshot {
  return {
    sessionId: record.sessionId,
    serverNow: now,
    idleExpiresAt: record.idleExpiresAt,
    revision: record.revision,
  };
}

// Why a stored row does not admit these claims, or undefined when the session is active.
// A binding mismatch is reported like a missing row: SESSION_REQUIRED.
export function rejectionFor(record: SessionRecord, claims: SessionClaims, now: number): SessionRejection | undefined {
  if (record.ownerSub !== claims.ownerSub || record.clientId !== claims.clientId) return 'SESSION_REQUIRED';
  if (record.invalidatedAt !== undefined) return 'SESSION_REVOKED';
  if (record.idleExpiresAt <= now) return 'SESSION_EXPIRED';

  return undefined;
}

// Establishment found an existing row for the lineage: it is returned only while active and bound to these
// claims. Anything else, including a binding mismatch, is LOGIN_REQUIRED, since only a new login starts a session.
export function establishRejectionFor(
  existing: SessionRecord,
  claims: SessionClaims,
  now: number,
): 'LOGIN_REQUIRED' | undefined {
  return rejectionFor(existing, claims, now) ? 'LOGIN_REQUIRED' : undefined;
}
