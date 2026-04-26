import { createHash } from 'crypto';

export type RulesetRule = {
  path: string;
};

export type RulesetOperator = 'BEGINS_WITH' | 'EQUALS';

export type ActiveRulesetScope = {
  targetPK: string;
  targetSK?: string;
  pkOperator?: RulesetOperator;
  skOperator?: RulesetOperator;
  ruleset: RulesetRule[];
  updatedAt: string;
};

export type ActiveRulesetSnapshot = {
  PK: string;
  SK: string;
  entityType: 'ACTIVE_RULESET';
  accountId: string;
  region: string;
  table: string;
  updatedAt: string;
  activeRulesets: Record<string, ActiveRulesetScope>;
};

export const ACTIVE_RULESET_SK = 'ACTIVE';

export function getRulesetHistoryPk(accountId: string, timeBucket: string): string {
  return `ACCOUNT#${accountId}#${timeBucket}`;
}

export function getRulesetHistorySk(
  createdAtTimestamp: number,
  region: string,
  table: string,
  scopeKey: string,
): string {
  return `${createdAtTimestamp}#${region}#${table}#${scopeKey}`;
}

export function getRulesetAccountRegionPk(accountId: string, region: string, timeBucket: string): string {
  return `ACCOUNT_REGION#${accountId}#${region}#${timeBucket}`;
}

export function getRulesetAccountRegionSk(createdAtTimestamp: number, table: string, scopeKey: string): string {
  return `${createdAtTimestamp}#${table}#${scopeKey}`;
}

export function getRulesetAccountRegionTablePk(
  accountId: string,
  region: string,
  table: string,
  timeBucket: string,
): string {
  return `ACCOUNT_REGION_TABLE#${accountId}#${region}#${table}#${timeBucket}`;
}

export function getRulesetAccountRegionTableSk(createdAtTimestamp: number, scopeKey: string): string {
  return `${createdAtTimestamp}#${scopeKey}`;
}

export function getRulesetSnapshotPk(accountId: string, region: string, table: string): string {
  return `ACTIVE_RULESET#${accountId}#${region}#${table}`;
}

export function getRulesetScopeKey(
  targetPK: string,
  targetSK?: string,
  pkOperator?: RulesetOperator,
  skOperator?: RulesetOperator,
): string {
  return createHash('sha256')
    .update(`${targetPK}#${targetSK || ''}#${pkOperator || ''}#${skOperator || ''}`)
    .digest()
    .subarray(0, 12)
    .toString('base64url');
}

export function getRulesetPaths(ruleset: RulesetRule[] | undefined): string[] {
  return ruleset?.map((rule) => rule.path) ?? [];
}

function matchesScope(
  scope: ActiveRulesetScope,
  request: {
    targetPK: string;
    targetSK?: string;
  },
): boolean {
  if (scope.pkOperator === 'BEGINS_WITH') {
    if (!request.targetPK.startsWith(scope.targetPK)) {
      return false;
    }
  } else if (scope.targetPK !== request.targetPK) {
    return false;
  }

  if (!scope.targetSK) {
    return true;
  }

  if (!request.targetSK) {
    return false;
  }

  if (scope.skOperator === 'BEGINS_WITH') {
    return request.targetSK.startsWith(scope.targetSK);
  }

  return request.targetSK === scope.targetSK;
}

export function resolveActiveMaskRuleset(
  activeRulesets: Record<string, ActiveRulesetScope> | undefined,
  request: {
    targetPK: string;
    targetSK?: string;
  },
): string[] | null {
  if (!activeRulesets) {
    return null;
  }

  const rules = Object.values(activeRulesets)
    .filter((scope) => matchesScope(scope, request))
    .flatMap((scope) => getRulesetPaths(scope.ruleset));

  const uniqueRules = Array.from(new Set(rules));
  return uniqueRules.length > 0 ? uniqueRules : null;
}
