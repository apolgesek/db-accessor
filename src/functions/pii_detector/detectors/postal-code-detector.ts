import { PiiEvidence } from '../../../shared/pii-detection';
import { EntityDetector, PiiObservation } from './entity-detector';

const PATH_ALIASES = new Set(['postalcode', 'postcode', 'zip', 'zipcode']);

export class PostalCodeDetector implements EntityDetector {
  readonly entityType = 'POSTAL_CODE' as const;

  detect({ normalizedProperty }: PiiObservation): PiiEvidence[] {
    if (normalizedProperty && PATH_ALIASES.has(normalizedProperty)) {
      return [{ source: 'PATH_RULE', ruleId: 'PATH_ALIAS_POSTAL_CODE', confidence: 0.9 }];
    }

    return [];
  }
}
