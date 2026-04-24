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

describe('ruleset helpers', () => {
  it('builds keys for all required access patterns', () => {
    expect(getRulesetHistoryPk('123456789012')).toBe('ACCOUNT#123456789012');
    expect(getRulesetHistorySk(1713866823000, 'eu-west-1', 'Customers', 'scope-1')).toBe(
      '1713866823000#eu-west-1#Customers#scope-1',
    );
    expect(getRulesetAccountRegionPk('123456789012', 'eu-west-1')).toBe('ACCOUNT_REGION#123456789012#eu-west-1');
    expect(getRulesetAccountRegionSk(1713866823000, 'Customers', 'scope-1')).toBe('1713866823000#Customers#scope-1');
    expect(getRulesetAccountRegionTablePk('123456789012', 'eu-west-1', 'Customers')).toBe(
      'ACCOUNT_REGION_TABLE#123456789012#eu-west-1#Customers',
    );
    expect(getRulesetAccountRegionTableSk(1713866823000, 'scope-1')).toBe('1713866823000#scope-1');
    expect(getRulesetSnapshotPk('123456789012', 'eu-west-1', 'Customers')).toBe(
      'ACTIVE_RULESET#123456789012#eu-west-1#Customers',
    );
    expect(ACTIVE_RULESET_SK).toBe('ACTIVE');
  });

  it('creates deterministic and distinct scope keys', () => {
    expect(getRulesetScopeKey('USER#1', 'PROFILE#1', 'EQUALS')).toBe(
      getRulesetScopeKey('USER#1', 'PROFILE#1', 'EQUALS'),
    );
    expect(getRulesetScopeKey('USER#1', 'PROFILE#1', 'EQUALS')).not.toBe(
      getRulesetScopeKey('USER#1', 'PROFILE#2', 'EQUALS'),
    );
  });

  it('matches prefix and exact scope rules', () => {
    expect(
      resolveActiveMaskRuleset(
        {
          exact: {
            targetPK: 'USER#1',
            targetSK: 'PROFILE#1',
            operator: 'EQUALS',
            updatedAt: '2026-04-23T00:00:00.000Z',
            ruleset: [{ path: 'email' }],
          },
          prefix: {
            targetPK: 'USER#1',
            targetSK: 'ORDER#',
            operator: 'BEGINS_WITH',
            updatedAt: '2026-04-23T00:00:00.000Z',
            ruleset: [{ path: 'payments[].cardNumber' }],
          },
        },
        { targetPK: 'USER#1', targetSK: 'ORDER#100' },
      ),
    ).toEqual(['payments[].cardNumber']);
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
            operator: 'EQUALS',
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
            operator: 'EQUALS',
            updatedAt: '2026-04-23T00:00:00.000Z',
            ruleset: [{ path: 'email' }],
          },
        },
        { targetPK: 'USER#1', targetSK: 'PROFILE#1' },
      ),
    ).toBeNull();
  });
});
