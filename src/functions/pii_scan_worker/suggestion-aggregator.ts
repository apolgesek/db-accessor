import { DetectPiiResult, PiiDetection, PiiEvidence, PiiEntityType } from '../../shared/pii-detection';
import { PiiRulesetSuggestion } from '../../shared/pii-scan';

type DetectionAggregate = {
  confidence: number;
  records: Set<number>;
  evidence: Map<string, PiiEvidence>;
};

type PathAggregate = {
  observedRecords: Set<number>;
  detectedRecords: Set<number>;
  detections: Map<PiiEntityType, DetectionAggregate>;
};

function evidenceKey(evidence: PiiEvidence): string {
  return `${evidence.source}#${evidence.ruleId}#${evidence.confidence}`;
}

function addDetection(aggregate: DetectionAggregate, recordIndex: number, detection: PiiDetection): void {
  aggregate.confidence = Math.max(aggregate.confidence, detection.confidence);
  aggregate.records.add(recordIndex);
  for (const evidence of detection.evidence) aggregate.evidence.set(evidenceKey(evidence), evidence);
}

export function aggregateSuggestions(
  observations: readonly { id: string; path: string }[],
  recordIndexById: ReadonlyMap<string, number>,
  results: readonly DetectPiiResult[],
): PiiRulesetSuggestion[] {
  const paths = new Map<string, PathAggregate>();
  for (const observation of observations) {
    const recordIndex = recordIndexById.get(observation.id);
    if (recordIndex === undefined) continue;
    const aggregate = paths.get(observation.path) ?? {
      observedRecords: new Set<number>(),
      detectedRecords: new Set<number>(),
      detections: new Map<PiiEntityType, DetectionAggregate>(),
    };
    aggregate.observedRecords.add(recordIndex);
    paths.set(observation.path, aggregate);
  }

  for (const result of results) {
    if (result.status !== 'DETECTED') continue;
    const recordIndex = recordIndexById.get(result.id);
    if (recordIndex === undefined) continue;
    const aggregate = paths.get(result.path);
    if (!aggregate) continue;
    aggregate.detectedRecords.add(recordIndex);
    for (const detection of result.detections) {
      const detectionAggregate = aggregate.detections.get(detection.entityType) ?? {
        confidence: 0,
        records: new Set<number>(),
        evidence: new Map<string, PiiEvidence>(),
      };
      addDetection(detectionAggregate, recordIndex, detection);
      aggregate.detections.set(detection.entityType, detectionAggregate);
    }
  }

  return [...paths.entries()]
    .filter(([, aggregate]) => aggregate.detections.size > 0)
    .map(([path, aggregate]) => {
      const detections = [...aggregate.detections.entries()]
        .map(([entityType, detection]) => ({
          entityType,
          confidence: detection.confidence,
          detectedRecordCount: detection.records.size,
          evidence: [...detection.evidence.values()].sort(
            (left, right) => right.confidence - left.confidence || left.ruleId.localeCompare(right.ruleId),
          ),
        }))
        .sort((left, right) => right.confidence - left.confidence || left.entityType.localeCompare(right.entityType));
      return {
        path,
        confidence: Math.max(...detections.map((detection) => detection.confidence)),
        observedRecordCount: aggregate.observedRecords.size,
        detectedRecordCount: aggregate.detectedRecords.size,
        detections,
      };
    })
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        right.detectedRecordCount - left.detectedRecordCount ||
        left.path.localeCompare(right.path),
    );
}
