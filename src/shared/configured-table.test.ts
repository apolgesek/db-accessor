import {
  CONFIGURED_TABLES_ALL_PK,
  CONFIGURED_TABLE_SK,
  getConfiguredTableAccountPk,
  getConfiguredTableAccountRegionPk,
  getConfiguredTablePk,
  getConfiguredTableSortKey,
} from './configured-table';

describe('configured table keys', () => {
  it('creates stable primary and index keys', () => {
    expect(CONFIGURED_TABLE_SK).toBe('METADATA');
    expect(CONFIGURED_TABLES_ALL_PK).toBe('CONFIGURED_TABLES');
    expect(getConfiguredTablePk('123456789012', 'eu-central-1', 'Orders')).toBe(
      'CONFIGURED_TABLE#123456789012#eu-central-1#Orders',
    );
    expect(getConfiguredTableAccountPk('123456789012')).toBe('ACCOUNT#123456789012');
    expect(getConfiguredTableAccountRegionPk('123456789012', 'eu-central-1')).toBe(
      'ACCOUNT_REGION#123456789012#eu-central-1',
    );
    expect(getConfiguredTableSortKey(1700000000000, 'eu-central-1', 'Orders')).toBe(
      '1700000000000#eu-central-1#Orders',
    );
  });
});
