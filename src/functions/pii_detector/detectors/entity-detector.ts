import { PiiEntityType, PiiEvidence } from '../../../shared/pii-detection';

export type PiiObservation = {
  normalizedProperty?: string;
  value: string | number;
};

export interface EntityDetector {
  readonly entityType: PiiEntityType;
  detect(observation: PiiObservation): PiiEvidence[];
}
