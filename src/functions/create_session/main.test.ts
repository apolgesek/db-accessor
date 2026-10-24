import { SessionService } from '../../shared/session-service';
import { InMemorySessionStore } from '../../shared/testing/in-memory-session-store';
import { createSessionEvent, sessionClaims } from '../../shared/testing/session-events';
import { LambdaHandler } from './main';

const NOW = 1_800_000_000_000;

describe('POST /session', () => {
  let store: InMemorySessionStore;
  let now: number;
  let handler: LambdaHandler;

  beforeEach(() => {
    process.env.COGNITO_CLIENT_ID = 'web-client';
    process.env.USERNAME_PREFIX = 'external-idp_';
    for (const level of ['log', 'info', 'warn', 'error'] as const) {
      jest.spyOn(console, level).mockImplementation();
    }
    store = new InMemorySessionStore();
    now = NOW;
    handler = new LambdaHandler(new SessionService(store, () => now));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('establishes a new browser login session with a 15-minute idle deadline', async () => {
    const result = await handler.handle(createSessionEvent(sessionClaims()));

    expect(result.statusCode).toBe(201);
    expect(result.headers).toMatchObject({ 'Cache-Control': 'no-store' });
    expect(JSON.parse(result.body)).toEqual({
      sessionId: 'lineage-1',
      serverNow: NOW,
      idleExpiresAt: 1_800_000_900_000,
      revision: 1,
    });
    expect(store.records.get('lineage-1')).toEqual({
      sessionId: 'lineage-1',
      ownerSub: 'sub-1',
      clientId: 'web-client',
      userId: 'user-1',
      createdAt: NOW,
      idleExpiresAt: 1_800_000_900_000,
      revision: 1,
      // createdAt + 12 h refresh + 15 min access + 1 day, in Unix seconds
      ttl: 1_800_130_500,
    });
  });

  test('returns the existing session unchanged on reload or in a new tab', async () => {
    await handler.handle(createSessionEvent(sessionClaims()));
    now = NOW + 5 * 60 * 1000;

    const result = await handler.handle(createSessionEvent(sessionClaims({ jti: 'token-2' })));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({
      sessionId: 'lineage-1',
      serverNow: NOW + 5 * 60 * 1000,
      idleExpiresAt: 1_800_000_900_000,
      revision: 1,
    });
    expect(store.records.get('lineage-1')?.idleExpiresAt).toBe(1_800_000_900_000);
  });

  test.each([
    ['expired at its idle deadline', { idleExpiresAt: NOW }],
    ['revoked by explicit logout', { invalidatedAt: NOW - 1000 }],
    ['bound to another owner', { ownerSub: 'sub-2' }],
    ['bound to another client', { clientId: 'other-client' }],
  ])('refuses a lineage whose session is %s', async (_, ended) => {
    const row = { ...existingRecord(), ...ended };
    store.records.set('lineage-1', row);

    const result = await handler.handle(createSessionEvent(sessionClaims()));

    expect(result.statusCode).toBe(401);
    expect(result.headers).toMatchObject({ 'Cache-Control': 'no-store' });
    expect(JSON.parse(result.body)).toEqual({ message: 'Login required', code: 'LOGIN_REQUIRED' });
    expect(store.records.get('lineage-1')).toEqual(row);
  });

  test.each([
    ['an ID token', { token_use: 'id' }],
    ['a token for another client', { client_id: 'other-client' }],
    ['a token without sub', { sub: undefined }],
    ['a token without origin_jti', { origin_jti: undefined }],
  ])('refuses %s without creating a session', async (_, overrides) => {
    const result = await handler.handle(createSessionEvent(sessionClaims(overrides)));

    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body)).toEqual({ message: 'Login required', code: 'LOGIN_REQUIRED' });
    expect(store.records.size).toBe(0);
  });

  test('creates exactly one session when tabs establish the same new lineage in parallel', async () => {
    const results = await Promise.all([
      handler.handle(createSessionEvent(sessionClaims())),
      handler.handle(createSessionEvent(sessionClaims())),
    ]);

    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 201]);
    expect(new Set(results.map((result) => JSON.parse(result.body).idleExpiresAt))).toEqual(
      new Set([1_800_000_900_000]),
    );
    expect(store.records.size).toBe(1);
  });

  test('reports an unavailable session store as 503 and counts an operational failure', async () => {
    process.env.METRICS_NAMESPACE = 'db-accessor-dev';
    store.unavailable = true;

    const result = await handler.handle(createSessionEvent(sessionClaims()));

    expect(result.statusCode).toBe(503);
    expect(result.headers).toMatchObject({ 'Cache-Control': 'no-store' });
    expect(JSON.parse(result.body)).toEqual({ message: 'Session unavailable', code: 'SESSION_UNAVAILABLE' });
    expect(loggedJson()).toContainEqual(
      expect.objectContaining({
        _aws: expect.objectContaining({
          CloudWatchMetrics: [
            {
              Namespace: 'db-accessor-dev',
              Dimensions: [[]],
              Metrics: [{ Name: 'OperationalFailures', Unit: 'Count' }],
            },
          ],
        }),
        OperationalFailures: 1,
      }),
    );
  });

  test('logs each establishment outcome without tokens or session IDs', async () => {
    await handler.handle(createSessionEvent(sessionClaims()));
    await handler.handle(createSessionEvent(sessionClaims({ token_use: 'id' })));
    store.unavailable = true;
    await handler.handle(createSessionEvent(sessionClaims({ origin_jti: 'lineage-2' })));

    expect(loggedJson()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'establish', outcome: 'created', requestId: 'request-1' }),
        expect.objectContaining({ operation: 'establish', outcome: 'rejected', reason: 'LOGIN_REQUIRED' }),
        expect.objectContaining({ operation: 'establish', outcome: 'unavailable' }),
      ]),
    );
    const output = loggedText();
    for (const secret of ['lineage-1', 'lineage-2', 'token-1', 'fake-access-token']) {
      expect(output).not.toContain(secret);
    }
  });
});

function loggedLines(): string[] {
  return (['log', 'info', 'warn', 'error'] as const)
    .flatMap((level) => (console[level] as jest.Mock).mock.calls)
    .map((args: unknown[]) => args.map(String).join(' '));
}

function loggedText(): string {
  return loggedLines().join(' | ');
}

function loggedJson(): Record<string, unknown>[] {
  return loggedLines()
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line));
}

function existingRecord() {
  return {
    sessionId: 'lineage-1',
    ownerSub: 'sub-1',
    clientId: 'web-client',
    userId: 'user-1',
    createdAt: NOW - 10 * 60 * 1000,
    idleExpiresAt: NOW + 5 * 60 * 1000,
    revision: 1,
    ttl: 1_800_130_000,
  };
}
