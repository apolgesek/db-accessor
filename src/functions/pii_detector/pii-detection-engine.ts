import {
  DetectPiiRequest,
  DetectPiiResponse,
  PiiDetection,
  PiiEntityType,
  PiiEvidence,
} from '../../shared/pii-detection';
import { getFinalPropertyToken, tokenizePath } from '../../shared/path-pattern';
import { AddressDetector } from './detectors/address-detector';
import { CreditCardDetector } from './detectors/credit-card-detector';
import { DateOfBirthDetector } from './detectors/date-of-birth-detector';
import { EmailDetector } from './detectors/email-detector';
import { EntityDetector, PiiObservation } from './detectors/entity-detector';
import { IbanDetector } from './detectors/iban-detector';
import { IpAddressDetector } from './detectors/ip-address-detector';
import { PersonDetector } from './detectors/person-detector';
import { PhoneDetector } from './detectors/phone-detector';
import { PostalCodeDetector } from './detectors/postal-code-detector';

const DEFAULT_ENTITY_DETECTORS: readonly EntityDetector[] = [
  new PersonDetector(),
  new EmailDetector(),
  new PhoneDetector(),
  new DateOfBirthDetector(),
  new AddressDetector(),
  new PostalCodeDetector(),
  new CreditCardDetector(),
  new IbanDetector(),
  new IpAddressDetector(),
];

function normalizePropertyName(property: string): string {
  return property.toLowerCase().replace(/[\s_-]+/g, '');
}

function toSortedDetections(evidenceByType: Map<PiiEntityType, PiiEvidence[]>): PiiDetection[] {
  return [...evidenceByType.entries()]
    .map(([entityType, evidence]) => ({
      entityType,
      confidence: Math.max(...evidence.map((item) => item.confidence)),
      evidence,
    }))
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        (left.entityType < right.entityType ? -1 : left.entityType > right.entityType ? 1 : 0),
    );
}

export class PiiDetectionEngine {
  constructor(private readonly entityDetectors: readonly EntityDetector[] = DEFAULT_ENTITY_DETECTORS) {}

  detect(request: DetectPiiRequest): DetectPiiResponse {
    return {
      version: 1,
      results: request.items.map((item) => {
        const tokens = tokenizePath(item.path);
        if (!tokens) {
          return {
            id: item.id,
            path: item.path,
            status: 'UNSUPPORTED_PATH' as const,
            detections: [],
          };
        }

        const finalProperty = getFinalPropertyToken(tokens);
        const observation: PiiObservation = {
          normalizedProperty: finalProperty ? normalizePropertyName(finalProperty) : undefined,
          value: item.value,
        };
        const evidenceByType = new Map<PiiEntityType, PiiEvidence[]>();

        for (const detector of this.entityDetectors) {
          const evidence = detector.detect(observation);
          if (evidence.length === 0) continue;

          const existing = evidenceByType.get(detector.entityType);
          if (existing) existing.push(...evidence);
          else evidenceByType.set(detector.entityType, [...evidence]);
        }

        const detections = toSortedDetections(evidenceByType);
        return {
          id: item.id,
          path: item.path,
          status: detections.length > 0 ? ('DETECTED' as const) : ('NOT_DETECTED' as const),
          detections,
        };
      }),
    };
  }
}
