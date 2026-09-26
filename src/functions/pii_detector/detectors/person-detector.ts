import { PiiEvidence } from '../../../shared/pii-detection';
import { EntityDetector, PiiObservation } from './entity-detector';

const SPECIFIC_PATH_ALIASES = new Set([
  'first',
  'firstname',
  'given',
  'givenname',
  'middle',
  'middlename',
  'last',
  'lastname',
  'family',
  'familyname',
  'full',
  'fullname',
  'surname',
]);
const AMBIGUOUS_PATH_ALIASES = new Set(['name']);

export class PersonDetector implements EntityDetector {
  readonly entityType = 'PERSON' as const;

  detect({ normalizedProperty }: PiiObservation): PiiEvidence[] {
    if (normalizedProperty && SPECIFIC_PATH_ALIASES.has(normalizedProperty)) {
      return [{ source: 'PATH_RULE', ruleId: 'PATH_ALIAS_PERSON_SPECIFIC', confidence: 0.9 }];
    }

    if (normalizedProperty && AMBIGUOUS_PATH_ALIASES.has(normalizedProperty)) {
      return [{ source: 'PATH_RULE', ruleId: 'PATH_ALIAS_PERSON_AMBIGUOUS', confidence: 0.65 }];
    }

    return [];
  }
}
