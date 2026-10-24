import { SessionRecord } from '../session-policy';
import { SessionStore, SessionUnavailableError } from '../session-store';

// Test double with the same write conditions as the DynamoDB store.
export class InMemorySessionStore implements SessionStore {
  readonly records = new Map<string, SessionRecord>();
  unavailable = false;

  async create(record: SessionRecord): Promise<boolean> {
    if (this.unavailable) throw new SessionUnavailableError();
    if (this.records.has(record.sessionId)) return false;

    this.records.set(record.sessionId, { ...record });
    return true;
  }

  async get(sessionId: string): Promise<SessionRecord | undefined> {
    if (this.unavailable) throw new SessionUnavailableError();
    const record = this.records.get(sessionId);
    return record && { ...record };
  }
}
