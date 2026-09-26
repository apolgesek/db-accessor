import { AttributeValue } from '@aws-sdk/client-dynamodb';
import { DetectPiiItem } from '../../shared/pii-detection';
import { tokenizePath } from '../../shared/path-pattern';

const MAX_RULESET_PATH_LENGTH = 255;
const MAX_VALUE_BYTES = 16 * 1024;
export const MAX_SCAN_OBSERVATIONS = 25_000;

export type FlattenedObservations = {
  items: DetectPiiItem[];
  recordIndexById: Map<string, number>;
  skippedObservationCount: number;
};

function isRepresentableProperty(key: string): boolean {
  return key.length > 0 && key === key.trim() && !/[.*\[\]]/.test(key);
}

export class ObservationFlattener {
  flatten(records: readonly Record<string, AttributeValue>[]): FlattenedObservations {
    const items: DetectPiiItem[] = [];
    const recordIndexById = new Map<string, number>();
    let skippedObservationCount = 0;
    let sequence = 0;

    const add = (recordIndex: number, path: string, value: string | number) => {
      if (
        items.length >= MAX_SCAN_OBSERVATIONS ||
        path.length > MAX_RULESET_PATH_LENGTH ||
        !tokenizePath(path) ||
        (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES)
      ) {
        skippedObservationCount += 1;
        return;
      }
      const id = `${recordIndex}:${sequence++}`;
      items.push({ id, path, value });
      recordIndexById.set(id, recordIndex);
    };

    const visit = (recordIndex: number, path: string, value: AttributeValue) => {
      if ('S' in value && value.S !== undefined) {
        add(recordIndex, path, value.S);
      } else if ('N' in value && value.N !== undefined) {
        add(recordIndex, path, 0);
      } else if ('M' in value && value.M) {
        for (const [key, nested] of Object.entries(value.M)) {
          if (!isRepresentableProperty(key)) {
            skippedObservationCount += 1;
            continue;
          }
          visit(recordIndex, `${path}.${key}`, nested);
        }
      } else if ('L' in value && value.L) {
        for (const nested of value.L) visit(recordIndex, `${path}[]`, nested);
      } else if ('SS' in value && value.SS) {
        for (const nested of value.SS) add(recordIndex, `${path}[]`, nested);
      } else if ('NS' in value && value.NS) {
        value.NS.forEach(() => add(recordIndex, `${path}[]`, 0));
      } else {
        skippedObservationCount += 1;
      }
    };

    records.forEach((record, recordIndex) => {
      for (const [key, value] of Object.entries(record)) {
        if (!isRepresentableProperty(key)) {
          skippedObservationCount += 1;
          continue;
        }
        visit(recordIndex, key, value);
      }
    });

    return { items, recordIndexById, skippedObservationCount };
  }
}
