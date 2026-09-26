import { parsePhoneNumberWithError } from 'libphonenumber-js';
import { PiiEvidence } from '../../../shared/pii-detection';
import { EntityDetector, PiiObservation } from './entity-detector';

const PATH_ALIASES = new Set(['phone', 'phonenumber', 'mobile', 'mobilenumber', 'telephone', 'telephonenumber']);

export function isInternationalPhone(value: string): boolean {
  const candidate = value.trim();
  if (!candidate.startsWith('+')) return false;

  try {
    return parsePhoneNumberWithError(candidate, { extract: false }).isValid();
  } catch {
    return false;
  }
}

export class PhoneDetector implements EntityDetector {
  readonly entityType = 'PHONE_NUMBER' as const;

  detect({ normalizedProperty, value }: PiiObservation): PiiEvidence[] {
    const evidence: PiiEvidence[] = [];

    if (normalizedProperty && PATH_ALIASES.has(normalizedProperty)) {
      evidence.push({ source: 'PATH_RULE', ruleId: 'PATH_ALIAS_PHONE', confidence: 0.9 });
    }

    if (typeof value === 'string' && isInternationalPhone(value)) {
      evidence.push({ source: 'VALUE_VALIDATOR', ruleId: 'VALUE_INTERNATIONAL_PHONE', confidence: 0.95 });
    }

    return evidence;
  }
}
