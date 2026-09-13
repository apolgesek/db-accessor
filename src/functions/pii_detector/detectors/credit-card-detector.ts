import { PiiEvidence } from '../../../shared/pii-detection';
import { EntityDetector, PiiObservation } from './entity-detector';

const SPECIFIC_PATH_ALIASES = new Set(['creditcard', 'creditcardnumber', 'paymentcard', 'paymentcardnumber']);
const AMBIGUOUS_PATH_ALIASES = new Set(['cardnumber']);

export function isCreditCard(value: string): boolean {
  const candidate = value.trim();
  if (!/^[\d -]+$/.test(candidate)) return false;

  const digits = candidate.replace(/[ -]/g, '');
  if (!/^\d{12,19}$/.test(digits)) return false;

  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }

  return sum % 10 === 0;
}

export class CreditCardDetector implements EntityDetector {
  readonly entityType = 'CREDIT_CARD' as const;

  detect({ normalizedProperty, value }: PiiObservation): PiiEvidence[] {
    const evidence: PiiEvidence[] = [];

    if (normalizedProperty && SPECIFIC_PATH_ALIASES.has(normalizedProperty)) {
      evidence.push({ source: 'PATH_RULE', ruleId: 'PATH_ALIAS_CREDIT_CARD_SPECIFIC', confidence: 0.9 });
    } else if (normalizedProperty && AMBIGUOUS_PATH_ALIASES.has(normalizedProperty)) {
      evidence.push({ source: 'PATH_RULE', ruleId: 'PATH_ALIAS_CREDIT_CARD_AMBIGUOUS', confidence: 0.65 });
    }

    if (typeof value === 'string' && isCreditCard(value)) {
      evidence.push({ source: 'VALUE_VALIDATOR', ruleId: 'VALUE_CREDIT_CARD_LUHN', confidence: 0.99 });
    }

    return evidence;
  }
}
