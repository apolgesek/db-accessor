// Failures that a Lambda handles (503s, SQS partial failures) do not show up as Lambda errors, so they are
// counted with a CloudWatch embedded-metric log line. The alarm reads the same name. CDK-free.
export const OPERATIONAL_FAILURE_METRIC = 'OperationalFailures';

export function recordOperationalFailure(operation: string, namespace = process.env.METRICS_NAMESPACE): void {
  if (!namespace) {
    console.error(JSON.stringify({ operation, outcome: 'metric-skipped', reason: 'Missing METRICS_NAMESPACE' }));
    return;
  }

  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          { Namespace: namespace, Dimensions: [[]], Metrics: [{ Name: OPERATIONAL_FAILURE_METRIC, Unit: 'Count' }] },
        ],
      },
      operation,
      [OPERATIONAL_FAILURE_METRIC]: 1,
    }),
  );
}
