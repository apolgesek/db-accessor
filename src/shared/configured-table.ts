export type ConfiguredDynamoDbTable = {
  pk: string;
  sk: string;
  entityType: 'CONFIGURED_TABLE';
  accountId: string;
  region: string;
  table: string;
  pkName: string;
  skName?: string;
  createdAt: string;
  createdAtTimestamp: number;
  createdBy: string;
  gsiAllPk: string;
  gsiAllSk: string;
  gsiAccountPk: string;
  gsiAccountSk: string;
  gsiAccountRegionPk: string;
  gsiAccountRegionSk: string;
};

export const CONFIGURED_TABLE_SK = 'METADATA';
export const CONFIGURED_TABLES_ALL_PK = 'CONFIGURED_TABLES';

export function getConfiguredTablePk(accountId: string, region: string, table: string): string {
  return `CONFIGURED_TABLE#${accountId}#${region}#${table}`;
}

export function getConfiguredTableAccountPk(accountId: string): string {
  return `ACCOUNT#${accountId}`;
}

export function getConfiguredTableAccountRegionPk(accountId: string, region: string): string {
  return `ACCOUNT_REGION#${accountId}#${region}`;
}

export function getConfiguredTableSortKey(createdAtTimestamp: number, ...parts: string[]): string {
  return [createdAtTimestamp.toString(), ...parts].join('#');
}
