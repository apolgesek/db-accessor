import { createHash } from 'crypto';
import { PiiEntityType, PiiEvidence } from './pii-detection';

export type PiiScanTrigger = 'ENABLED' | 'SCHEDULED';
export type PiiScanStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export type PiiScanFailureCode =
  | 'ACCESS_DENIED'
  | 'TABLE_NOT_FOUND'
  | 'DETECTOR_ERROR'
  | 'TIMEOUT'
  | 'INVALID_TASK'
  | 'INTERNAL_ERROR';

export type PiiScanTask = {
  version: 1;
  scanId: string;
  trigger: PiiScanTrigger;
  accountId: string;
  region: string;
  table: string;
  requestedAt: string;
};

export type PiiSuggestionDetection = {
  entityType: PiiEntityType;
  confidence: number;
  detectedRecordCount: number;
  evidence: PiiEvidence[];
};

export type PiiRulesetSuggestion = {
  path: string;
  confidence: number;
  observedRecordCount: number;
  detectedRecordCount: number;
  detections: PiiSuggestionDetection[];
};

export type PiiScanSummary = {
  scanId: string;
  trigger: PiiScanTrigger;
  status: PiiScanStatus;
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  evaluatedItemCount?: number;
  sampledItemCount?: number;
  analyzedObservationCount?: number;
  skippedObservationCount?: number;
  unsupportedPathCount?: number;
  consumedCapacityUnits?: number;
  failureCode?: PiiScanFailureCode;
};

export type PiiSuggestionState = {
  pk: string;
  sk: 'STATE';
  entityType: 'PII_SUGGESTION_STATE';
  accountId: string;
  region: string;
  table: string;
  latestScan: PiiScanSummary;
  suggestions?: PiiRulesetSuggestion[];
  suggestionsGeneratedAt?: string;
  totalSuggestionCount?: number;
  suggestionsTruncated?: boolean;
};

export const PII_SUGGESTION_STATE_SK = 'STATE';

export function getPiiSuggestionPk(accountId: string, region: string, table: string): string {
  return `PII_SUGGESTION#${accountId}#${region}#${table}`;
}

export function getPiiScanMessageGroupId(accountId: string, region: string, table: string): string {
  return createHash('sha256').update(`${accountId}#${region}#${table}`).digest('hex').slice(0, 32);
}

export function getScheduledPiiScanId(accountId: string, region: string, table: string, date: Date): string {
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `scheduled-${day}-${getPiiScanMessageGroupId(accountId, region, table)}`;
}
