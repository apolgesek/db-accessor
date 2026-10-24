import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import { OPERATIONAL_FAILURE_METRIC } from '../../src/shared/operational-metrics';

// Alarms on any operational failure the Lambdas record in the project's metric namespace.
export function createOperationalFailureAlarm(scope: Construct, projectName: string): cloudwatch.Alarm {
  return new cloudwatch.Alarm(scope, `${projectName}-operational-failures-alarm`, {
    alarmName: `${projectName}-operational-failures`,
    metric: new cloudwatch.Metric({
      namespace: projectName,
      metricName: OPERATIONAL_FAILURE_METRIC,
      statistic: cloudwatch.Stats.SUM,
      period: cdk.Duration.minutes(5),
    }),
    threshold: 1,
    evaluationPeriods: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  });
}
