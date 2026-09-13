import { DetectPiiRequest } from '../../shared/pii-detection';

const MAX_ITEMS = 1_000;
const MAX_ID_LENGTH = 128;
const MAX_PATH_LENGTH = 512;
const MAX_VALUE_BYTES = 16 * 1024;

export class InvalidDetectPiiRequestError extends Error {
  constructor() {
    super('Invalid DetectPii request');
    this.name = 'InvalidDetectPiiRequestError';
  }
}

function hasOnlyKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length && keys.every((key) => expectedKeys.includes(key));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new InvalidDetectPiiRequestError();
}

export function validateDetectPiiRequest(value: unknown): asserts value is DetectPiiRequest {
  if (!isObject(value) || !hasOnlyKeys(value, ['version', 'items'])) invalid();
  if (value.version !== 1 || !Array.isArray(value.items) || value.items.length > MAX_ITEMS) invalid();

  const ids = new Set<string>();
  for (const item of value.items) {
    if (!isObject(item) || !hasOnlyKeys(item, ['id', 'path', 'value'])) invalid();
    if (typeof item.id !== 'string' || item.id.length === 0 || item.id.length > MAX_ID_LENGTH) invalid();
    if (ids.has(item.id)) invalid();
    ids.add(item.id);

    if (typeof item.path !== 'string' || item.path.length > MAX_PATH_LENGTH) invalid();
    if (typeof item.value === 'string') {
      if (Buffer.byteLength(item.value, 'utf8') > MAX_VALUE_BYTES) invalid();
    } else if (typeof item.value !== 'number' || !Number.isFinite(item.value)) {
      invalid();
    }
  }
}
