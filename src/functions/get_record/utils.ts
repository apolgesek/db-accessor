/* eslint-disable @typescript-eslint/no-explicit-any */
export function toJsonSafe<T>(value: T): any {
  if (value instanceof Set) {
    return Array.from(value, toJsonSafe);
  }

  if (Array.isArray(value)) {
    return value.map(toJsonSafe);
  }

  if (value && typeof value === 'object') {
    const result: any = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      result[key] = toJsonSafe(nestedValue);
    }

    return result;
  }

  return value;
}

export function base64urlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');

  while (base64.length % 4) {
    base64 += '=';
  }

  return Buffer.from(base64, 'base64').toString('utf8');
}
