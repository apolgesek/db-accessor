import { PiiEvidence } from '../../../shared/pii-detection';
import { EntityDetector, PiiObservation } from './entity-detector';

const PATH_ALIASES = new Set(['iban', 'ibancode']);

// SWIFT IBAN Registry release 102 (June 2026).
const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BI: 27,
  BR: 29,
  BY: 28,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DJ: 27,
  DK: 18,
  DO: 28,
  EE: 20,
  EG: 29,
  ES: 24,
  FI: 18,
  FK: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HN: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IQ: 23,
  IS: 26,
  IT: 27,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LC: 32,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  LY: 25,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MN: 20,
  MR: 27,
  MT: 31,
  MU: 30,
  NI: 28,
  NL: 18,
  NO: 15,
  OM: 23,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RU: 33,
  RS: 22,
  SA: 24,
  SC: 31,
  SD: 18,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  SO: 23,
  ST: 25,
  SV: 28,
  TL: 23,
  TN: 24,
  TR: 26,
  UA: 29,
  VA: 22,
  VG: 24,
  XK: 20,
  YE: 30,
};

export function isIban(value: string): boolean {
  const candidate = value.trim();
  if (!/^[A-Za-z0-9 ]+$/.test(candidate)) return false;

  const iban = candidate.replace(/ /g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  if (IBAN_LENGTHS[iban.slice(0, 2)] !== iban.length) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;

  for (const character of rearranged) {
    const numeric = character >= 'A' ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
  }

  return remainder === 1;
}

export class IbanDetector implements EntityDetector {
  readonly entityType = 'IBAN_CODE' as const;

  detect({ normalizedProperty, value }: PiiObservation): PiiEvidence[] {
    const evidence: PiiEvidence[] = [];

    if (normalizedProperty && PATH_ALIASES.has(normalizedProperty)) {
      evidence.push({ source: 'PATH_RULE', ruleId: 'PATH_ALIAS_IBAN', confidence: 0.9 });
    }

    if (typeof value === 'string' && isIban(value)) {
      evidence.push({ source: 'VALUE_VALIDATOR', ruleId: 'VALUE_IBAN_MOD_97', confidence: 0.99 });
    }

    return evidence;
  }
}
