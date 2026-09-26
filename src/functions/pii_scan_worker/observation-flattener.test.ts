import { AttributeValue } from '@aws-sdk/client-dynamodb';
import { ObservationFlattener } from './observation-flattener';

describe('ObservationFlattener', () => {
  test('creates redactor-compatible observations without exposing numeric values', () => {
    const records: Record<string, AttributeValue>[] = [
      {
        email: { S: 'person@example.com' },
        profile: { M: { phone_number: { S: '+48123456789' } } },
        contacts: { L: [{ M: { email: { S: 'other@example.com' } } }] },
        identifiers: { NS: ['12345678901234567890'] },
        'unsupported.key': { S: 'must-not-be-observed' },
        active: { BOOL: true },
      },
    ];

    const result = new ObservationFlattener().flatten(records);

    expect(result.items.map(({ path, value }) => ({ path, value }))).toEqual([
      { path: 'email', value: 'person@example.com' },
      { path: 'profile.phone_number', value: '+48123456789' },
      { path: 'contacts[].email', value: 'other@example.com' },
      { path: 'identifiers[]', value: 0 },
    ]);
    expect(result.skippedObservationCount).toBe(2);
    expect([...result.recordIndexById.values()]).toEqual([0, 0, 0, 0]);
  });

  test('skips strings and paths that cannot be sent as ruleset suggestions', () => {
    const result = new ObservationFlattener().flatten([
      {
        huge: { S: 'x'.repeat(16 * 1024 + 1) },
        [`a${'b'.repeat(255)}`]: { S: 'value' },
      },
    ]);

    expect(result.items).toEqual([]);
    expect(result.skippedObservationCount).toBe(2);
  });
});
