import { isIP } from 'net';
import { PiiEvidence } from '../../../shared/pii-detection';
import { EntityDetector, PiiObservation } from './entity-detector';

const SPECIFIC_PATH_ALIASES = new Set(['ipaddress', 'ipv4', 'ipv4address', 'ipv6', 'ipv6address']);
const AMBIGUOUS_PATH_ALIASES = new Set(['ip']);

export class IpAddressDetector implements EntityDetector {
  readonly entityType = 'IP_ADDRESS' as const;

  detect({ normalizedProperty, value }: PiiObservation): PiiEvidence[] {
    const evidence: PiiEvidence[] = [];

    if (normalizedProperty && SPECIFIC_PATH_ALIASES.has(normalizedProperty)) {
      evidence.push({ source: 'PATH_RULE', ruleId: 'PATH_ALIAS_IP_SPECIFIC', confidence: 0.9 });
    } else if (normalizedProperty && AMBIGUOUS_PATH_ALIASES.has(normalizedProperty)) {
      evidence.push({ source: 'PATH_RULE', ruleId: 'PATH_ALIAS_IP_AMBIGUOUS', confidence: 0.65 });
    }

    if (typeof value === 'string' && isIP(value.trim()) !== 0) {
      evidence.push({ source: 'VALUE_VALIDATOR', ruleId: 'VALUE_IP_ADDRESS', confidence: 0.99 });
    }

    return evidence;
  }
}
