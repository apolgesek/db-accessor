import { PiiEvidence } from '../../../shared/pii-detection';
import { EntityDetector, PiiObservation } from './entity-detector';

const PATH_ALIASES = new Set(['dateofbirth', 'birthdate', 'dob']);

export class DateOfBirthDetector implements EntityDetector {
  readonly entityType = 'DATE_OF_BIRTH' as const;

  detect({ normalizedProperty }: PiiObservation): PiiEvidence[] {
    if (normalizedProperty && PATH_ALIASES.has(normalizedProperty)) {
      return [{ source: 'PATH_RULE', ruleId: 'PATH_ALIAS_DOB', confidence: 0.9 }];
    }

    return [];
  }
}
