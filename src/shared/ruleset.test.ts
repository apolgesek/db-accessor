import {
  ACTIVE_RULESET_SK,
  getRulesetAccountRegionPk,
  getRulesetAccountRegionSk,
  getRulesetAccountRegionTablePk,
  getRulesetAccountRegionTableSk,
  getRulesetHistoryPk,
  getRulesetHistorySk,
  getRulesetScopeKey,
  getRulesetSnapshotPk,
  resolveActiveMaskRuleset,
} from './ruleset';
import { getTimeBucket } from './time.util';

describe('ruleset helpers', () => {
  it('builds keys for all required access patterns', () => {
    const ts = 1713866823000; // 2024-04-23T11:47:03Z
    const bucket = getTimeBucket(ts);
    expect(bucket).toBe('2024-04');
    expect(getRulesetHistoryPk('123456789012', bucket)).toBe('ACCOUNT#123456789012#2024-04');
    expect(getRulesetHistorySk(ts, 'eu-west-1', 'Customers', 'scope-1')).toBe(
      '1713866823000#eu-west-1#Customers#scope-1',
    );
    expect(getRulesetAccountRegionPk('123456789012', 'eu-west-1', bucket)).toBe(
      'ACCOUNT_REGION#123456789012#eu-west-1#2024-04',
    );
    expect(getRulesetAccountRegionSk(ts, 'Customers', 'scope-1')).toBe('1713866823000#Customers#scope-1');
    expect(getRulesetAccountRegionTablePk('123456789012', 'eu-west-1', 'Customers', bucket)).toBe(
      'ACCOUNT_REGION_TABLE#123456789012#eu-west-1#Customers#2024-04',
    );
    expect(getRulesetAccountRegionTableSk(ts, 'scope-1')).toBe('1713866823000#scope-1');
    expect(getRulesetSnapshotPk('123456789012', 'eu-west-1', 'Customers')).toBe(
      'ACTIVE_RULESET#123456789012#eu-west-1#Customers',
    );
    expect(ACTIVE_RULESET_SK).toBe('ACTIVE');
  });

  it('creates deterministic and distinct scope keys', () => {
    expect(getRulesetScopeKey('USER#1', 'PROFILE#1', 'EQUALS', 'EQUALS')).toBe(
      getRulesetScopeKey('USER#1', 'PROFILE#1', 'EQUALS', 'EQUALS'),
    );
    expect(getRulesetScopeKey('USER#1', 'PROFILE#1', 'EQUALS', 'EQUALS')).not.toBe(
      getRulesetScopeKey('USER#1', 'PROFILE#2', 'EQUALS', 'EQUALS'),
    );
    expect(getRulesetScopeKey('USER#1', 'PROFILE#1', 'BEGINS_WITH', 'EQUALS')).not.toBe(
      getRulesetScopeKey('USER#1', 'PROFILE#1', 'EQUALS', 'EQUALS'),
    );
  });

  it('matches prefix and exact scope rules', () => {
    expect(
      resolveActiveMaskRuleset(
        {
          exact: {
            targetPK: 'USER#1',
            targetSK: 'PROFILE#1',
            skOperator: 'EQUALS',
            updatedAt: '2026-04-23T00:00:00.000Z',
            ruleset: [{ path: 'email' }],
          },
          prefix: {
            targetPK: 'USER#1',
            targetSK: 'ORDER#',
            skOperator: 'BEGINS_WITH',
            updatedAt: '2026-04-23T00:00:00.000Z',
            ruleset: [{ path: 'payments[].cardNumber' }],
          },
        },
        { targetPK: 'USER#1', targetSK: 'ORDER#100' },
      ),
    ).toEqual(['payments[].cardNumber']);
  });

  it('matches BEGINS_WITH on PK only', () => {
    expect(
      resolveActiveMaskRuleset(
        {
          pkPrefix: {
            targetPK: 'USER#',
            pkOperator: 'BEGINS_WITH',
            updatedAt: '2026-04-23T00:00:00.000Z',
            ruleset: [{ path: 'ssn' }],
          },
        },
        { targetPK: 'USER#42' },
      ),
    ).toEqual(['ssn']);
  });

  it('matches BEGINS_WITH on both PK and SK', () => {
    expect(
      resolveActiveMaskRuleset(
        {
          both: {
            targetPK: 'USER#',
            targetSK: 'ORDER#',
            pkOperator: 'BEGINS_WITH',
            skOperator: 'BEGINS_WITH',
            updatedAt: '2026-04-23T00:00:00.000Z',
            ruleset: [{ path: 'payments[].cardNumber' }],
          },
        },
        { targetPK: 'USER#99', targetSK: 'ORDER#5' },
      ),
    ).toEqual(['payments[].cardNumber']);
  });

  it('does not match when PK prefix does not fit', () => {
    expect(
      resolveActiveMaskRuleset(
        {
          pkPrefix: {
            targetPK: 'USER#',
            pkOperator: 'BEGINS_WITH',
            updatedAt: '2026-04-23T00:00:00.000Z',
            ruleset: [{ path: 'ssn' }],
          },
        },
        { targetPK: 'ORG#42' },
      ),
    ).toBeNull();
  });

  it('merges and deduplicates matching paths', () => {
    expect(
      resolveActiveMaskRuleset(
        {
          allPk: {
            targetPK: 'USER#1',
            updatedAt: '2026-04-23T00:00:00.000Z',
            ruleset: [{ path: 'email' }, { path: 'name' }],
          },
          exact: {
            targetPK: 'USER#1',
            targetSK: 'PROFILE#1',
            skOperator: 'EQUALS',
            updatedAt: '2026-04-23T00:00:00.000Z',
            ruleset: [{ path: 'email' }, { path: 'phone' }],
          },
        },
        { targetPK: 'USER#1', targetSK: 'PROFILE#1' },
      ),
    ).toEqual(['email', 'name', 'phone']);
  });

  it('returns null when no snapshot scope applies', () => {
    expect(
      resolveActiveMaskRuleset(
        {
          exact: {
            targetPK: 'USER#2',
            targetSK: 'PROFILE#1',
            skOperator: 'EQUALS',
            updatedAt: '2026-04-23T00:00:00.000Z',
            ruleset: [{ path: 'email' }],
          },
        },
        { targetPK: 'USER#1', targetSK: 'PROFILE#1' },
      ),
    ).toBeNull();
  });
});
