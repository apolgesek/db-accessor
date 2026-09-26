import { AttributeValue, DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';

const TOTAL_SEGMENTS = 16;
const MAX_EVALUATED_ITEMS = 1_000;
const SAMPLE_SIZE = 100;
const MAX_CONCURRENT_SEGMENTS = 4;

export type SampledDynamoDbTable = {
  items: Record<string, AttributeValue>[];
  evaluatedItemCount: number;
  consumedCapacityUnits: number;
};

export class DynamoDbSampler {
  constructor(
    private readonly client: Pick<DynamoDBClient, 'send'>,
    private readonly random: () => number = Math.random,
  ) {}

  async sample(tableName: string): Promise<SampledDynamoDbTable> {
    const sample: Record<string, AttributeValue>[] = [];
    let evaluatedItemCount = 0;
    let consumedCapacityUnits = 0;
    let nextSegment = 0;

    const consider = (item: Record<string, AttributeValue>) => {
      evaluatedItemCount += 1;
      if (sample.length < SAMPLE_SIZE) {
        sample.push(item);
        return;
      }
      const replacementIndex = Math.floor(this.random() * evaluatedItemCount);
      if (replacementIndex < SAMPLE_SIZE) sample[replacementIndex] = item;
    };

    const scanSegment = async (segment: number) => {
      const segmentBudget =
        Math.floor(MAX_EVALUATED_ITEMS / TOTAL_SEGMENTS) + (segment < MAX_EVALUATED_ITEMS % TOTAL_SEGMENTS ? 1 : 0);
      let remaining = segmentBudget;
      let exclusiveStartKey: Record<string, AttributeValue> | undefined;

      do {
        const response = await this.client.send(
          new ScanCommand({
            TableName: tableName,
            Segment: segment,
            TotalSegments: TOTAL_SEGMENTS,
            Limit: remaining,
            ExclusiveStartKey: exclusiveStartKey,
            ConsistentRead: false,
            ReturnConsumedCapacity: 'TOTAL',
          }),
        );
        consumedCapacityUnits += response.ConsumedCapacity?.CapacityUnits ?? 0;
        for (const item of response.Items ?? []) consider(item);
        const evaluated = response.ScannedCount ?? response.Items?.length ?? 0;
        remaining = Math.max(0, remaining - evaluated);
        exclusiveStartKey = response.LastEvaluatedKey;
      } while (remaining > 0 && exclusiveStartKey);
    };

    const runners = Array.from({ length: MAX_CONCURRENT_SEGMENTS }, async () => {
      while (nextSegment < TOTAL_SEGMENTS) {
        const segment = nextSegment;
        nextSegment += 1;
        await scanSegment(segment);
      }
    });
    await Promise.all(runners);

    return { items: sample, evaluatedItemCount, consumedCapacityUnits };
  }
}
