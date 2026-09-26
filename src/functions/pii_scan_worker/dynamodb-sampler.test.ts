import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDbSampler } from './dynamodb-sampler';

describe('DynamoDbSampler', () => {
  test('spreads a bounded eventually-consistent scan across sixteen segments', async () => {
    const send = jest.fn(async (command: ScanCommand) => {
      const input = command.input;
      return {
        Items: [{ segment: { N: String(input.Segment) } }],
        ScannedCount: 1,
        ConsumedCapacity: { CapacityUnits: 0.5 },
      };
    });
    const client = { send } as unknown as DynamoDBClient;

    const result = await new DynamoDbSampler(client, () => 0.5).sample('customers');

    expect(send).toHaveBeenCalledTimes(16);
    const inputs = send.mock.calls.map(([command]) => command.input);
    expect(inputs.map((input) => input.Segment).sort((a, b) => Number(a) - Number(b))).toEqual(
      Array.from({ length: 16 }, (_, index) => index),
    );
    expect(inputs.reduce((total, input) => total + Number(input.Limit), 0)).toBe(1000);
    expect(inputs.every((input) => input.TotalSegments === 16 && input.ConsistentRead === false)).toBe(true);
    expect(result.items).toHaveLength(16);
    expect(result.evaluatedItemCount).toBe(16);
    expect(result.consumedCapacityUnits).toBe(8);
  });
});
