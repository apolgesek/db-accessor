import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { DetectPiiItem, DetectPiiResponse } from '../../shared/pii-detection';

const MAX_BATCH_ITEMS = 1_000;
const MAX_BATCH_BYTES = 5 * 1024 * 1024;

export class PiiDetectorInvocationError extends Error {
  constructor() {
    super('PII detector invocation failed');
    this.name = 'PiiDetectorInvocationError';
  }
}

function createBatches(items: readonly DetectPiiItem[]): DetectPiiItem[][] {
  const batches: DetectPiiItem[][] = [];
  let current: DetectPiiItem[] = [];

  for (const item of items) {
    const candidate = [...current, item];
    const bytes = Buffer.byteLength(JSON.stringify({ version: 1, items: candidate }), 'utf8');
    if (current.length > 0 && (candidate.length > MAX_BATCH_ITEMS || bytes > MAX_BATCH_BYTES)) {
      batches.push(current);
      current = [item];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export class PiiDetectorClient {
  constructor(private readonly client: Pick<LambdaClient, 'send'>, private readonly functionName: string) {}

  async detect(items: readonly DetectPiiItem[]): Promise<DetectPiiResponse['results']> {
    const results: DetectPiiResponse['results'] = [];
    for (const batch of createBatches(items)) {
      const response = await this.client.send(
        new InvokeCommand({
          FunctionName: this.functionName,
          InvocationType: 'RequestResponse',
          Payload: Buffer.from(JSON.stringify({ version: 1, items: batch })),
        }),
      );
      if (response.FunctionError || !response.Payload) throw new PiiDetectorInvocationError();

      let payload: DetectPiiResponse | null;
      try {
        payload = JSON.parse(Buffer.from(response.Payload).toString('utf8')) as DetectPiiResponse | null;
      } catch {
        throw new PiiDetectorInvocationError();
      }
      if (
        !payload ||
        payload.version !== 1 ||
        !Array.isArray(payload.results) ||
        payload.results.length !== batch.length ||
        payload.results.some((result, index) => result?.id !== batch[index].id || result.path !== batch[index].path)
      ) {
        throw new PiiDetectorInvocationError();
      }
      results.push(...payload.results);
    }
    return results;
  }
}
