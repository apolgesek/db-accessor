import { PiiEvidence } from '../../../shared/pii-detection';
import { EntityDetector, PiiObservation } from './entity-detector';

const SPECIFIC_PATH_ALIASES = new Set([
  'addressline',
  'addressline1',
  'addressline2',
  'address1',
  'address2',
  'streetaddress',
]);
const AMBIGUOUS_PATH_ALIASES = new Set(['address']);

export class AddressDetector implements EntityDetector {
  readonly entityType = 'ADDRESS' as const;

  detect({ normalizedProperty }: PiiObservation): PiiEvidence[] {
    if (normalizedProperty && SPECIFIC_PATH_ALIASES.has(normalizedProperty)) {
      return [{ source: 'PATH_RULE', ruleId: 'PATH_ALIAS_ADDRESS_SPECIFIC', confidence: 0.9 }];
    }

    if (normalizedProperty && AMBIGUOUS_PATH_ALIASES.has(normalizedProperty)) {
      return [{ source: 'PATH_RULE', ruleId: 'PATH_ALIAS_ADDRESS_AMBIGUOUS', confidence: 0.65 }];
    }

    return [];
  }
}
