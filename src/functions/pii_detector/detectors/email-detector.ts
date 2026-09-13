import { PiiEvidence } from '../../../shared/pii-detection';
import { EntityDetector, PiiObservation } from './entity-detector';

const PATH_ALIASES = new Set(['email', 'emailaddress']);
const EMAIL_PATTERN =
  /^[A-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,63}$/i;

export function isEmail(value: string): boolean {
  const candidate = value.trim();
  if (candidate.length === 0 || candidate.length > 254) return false;

  const separator = candidate.lastIndexOf('@');
  if (separator <= 0 || separator > 64) return false;
  return EMAIL_PATTERN.test(candidate);
}

export class EmailDetector implements EntityDetector {
  readonly entityType = 'EMAIL_ADDRESS' as const;

  detect({ normalizedProperty, value }: PiiObservation): PiiEvidence[] {
    const evidence: PiiEvidence[] = [];

    if (normalizedProperty && PATH_ALIASES.has(normalizedProperty)) {
      evidence.push({ source: 'PATH_RULE', ruleId: 'PATH_ALIAS_EMAIL', confidence: 0.9 });
    }

    if (typeof value === 'string' && isEmail(value)) {
      evidence.push({ source: 'VALUE_VALIDATOR', ruleId: 'VALUE_EMAIL_FORMAT', confidence: 0.99 });
    }

    return evidence;
  }
}
