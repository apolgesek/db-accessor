import {
  establishRejectionFor,
  IDLE_TIMEOUT_MS,
  newSessionRecord,
  rejectionFor,
  SessionClaims,
  SessionRecord,
  SessionRejection,
  SessionSnapshot,
  toSnapshot,
} from './session-policy';
import { createSessionStoreClient, DynamoDbSessionStore, SessionStore } from './session-store';

export type SessionDecision =
  { ok: true; snapshot: SessionSnapshot; created: boolean } | { ok: false; code: SessionRejection };

// Combines the session policy and store. Samples `now` once per decision.
export class SessionService {
  constructor(
    private readonly store: SessionStore,
    private readonly clock: () => number = Date.now,
  ) {}

  // Creates the session if its lineage has no row; never extends an existing one.
  async establish(claims: SessionClaims): Promise<SessionDecision> {
    const now = this.clock();
    const record = newSessionRecord(claims, now);
    if (await this.store.create(record)) {
      return { ok: true, snapshot: toSnapshot(record, now), created: true };
    }

    // An ended lineage can never start a new idle window; a row that vanished since the write ended too.
    const existing = await this.store.get(claims.sessionId);
    if (!existing || establishRejectionFor(existing, claims, now)) return { ok: false, code: 'LOGIN_REQUIRED' };

    return { ok: true, snapshot: toSnapshot(existing, now), created: false };
  }

  // Read only: never creates or extends.
  async observe(claims: SessionClaims): Promise<SessionDecision> {
    const now = this.clock();
    return this.decideStored(await this.store.get(claims.sessionId), claims, now);
  }

  // Qualifying activity: the only operation that extends.
  async recordActivity(claims: SessionClaims): Promise<SessionDecision> {
    const now = this.clock();
    const extended = await this.store.extend(claims, now, now + IDLE_TIMEOUT_MS);
    if (extended) return { ok: true, snapshot: toSnapshot(extended, now), created: false };

    // No retry: the read only explains the refused write. A session still active lost the race to a deadline at
    // least as late, which is returned unchanged.
    return this.decideStored(await this.store.get(claims.sessionId), claims, now);
  }

  private decideStored(record: SessionRecord | undefined, claims: SessionClaims, now: number): SessionDecision {
    if (!record) return { ok: false, code: 'SESSION_REQUIRED' };

    const code = rejectionFor(record, claims, now);
    if (code) return { ok: false, code };

    return { ok: true, snapshot: toSnapshot(record, now), created: false };
  }
}

// The session service the Lambdas use: the sessions table through a single-attempt DynamoDB client.
export function createSessionService(): SessionService {
  return new SessionService(
    new DynamoDbSessionStore(createSessionStoreClient(), process.env.SESSIONS_TABLE_NAME ?? ''),
  );
}
