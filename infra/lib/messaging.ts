import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface MessagingResources {
  issueTrackingAuditQueue: sqs.Queue;
  requestStatusTopic: sns.Topic;
  requestStatusEmailQueue: sqs.Queue;
  requestStatusNotificationQueue: sqs.Queue;
  piiScanQueue: sqs.Queue;
  piiScanDlq: sqs.Queue;
}

export function createMessagingResources(scope: Construct, projectName: string): MessagingResources {
  const issueTrackingAuditDlq = new sqs.Queue(scope, `${projectName}-issue-tracking-audit-dlq`, {
    queueName: `${projectName}-issue-tracking-audit-dlq`,
    retentionPeriod: cdk.Duration.days(14),
  });

  const issueTrackingAuditQueue = new sqs.Queue(scope, `${projectName}-issue-tracking-audit-queue`, {
    queueName: `${projectName}-issue-tracking-audit-queue`,
    retentionPeriod: cdk.Duration.days(4),
    visibilityTimeout: cdk.Duration.seconds(60),
    deadLetterQueue: {
      queue: issueTrackingAuditDlq,
      maxReceiveCount: 3,
    },
  });

  const requestStatusTopic = new sns.Topic(scope, `${projectName}-request-status-topic`, {
    topicName: `${projectName}-request-status`,
  });

  const requestStatusEmailDlq = new sqs.Queue(scope, `${projectName}-request-status-email-dlq`, {
    queueName: `${projectName}-request-status-email-dlq`,
    retentionPeriod: cdk.Duration.days(14),
  });

  const requestStatusEmailQueue = new sqs.Queue(scope, `${projectName}-request-status-email-queue`, {
    queueName: `${projectName}-request-status-email-queue`,
    retentionPeriod: cdk.Duration.days(4),
    visibilityTimeout: cdk.Duration.seconds(60),
    deadLetterQueue: {
      queue: requestStatusEmailDlq,
      maxReceiveCount: 3,
    },
  });

  const requestStatusNotificationDlq = new sqs.Queue(scope, `${projectName}-request-status-notification-dlq`, {
    queueName: `${projectName}-request-status-notification-dlq`,
    retentionPeriod: cdk.Duration.days(14),
  });

  const requestStatusNotificationQueue = new sqs.Queue(scope, `${projectName}-request-status-notification-queue`, {
    queueName: `${projectName}-request-status-notification-queue`,
    retentionPeriod: cdk.Duration.days(4),
    visibilityTimeout: cdk.Duration.seconds(60),
    deadLetterQueue: {
      queue: requestStatusNotificationDlq,
      maxReceiveCount: 3,
    },
  });

  requestStatusTopic.addSubscription(
    new snsSubscriptions.SqsSubscription(requestStatusEmailQueue, {
      rawMessageDelivery: true,
    }),
  );

  const piiScanDlq = new sqs.Queue(scope, `${projectName}-pii-scan-dlq`, {
    queueName: `${projectName}-pii-scan-dlq.fifo`,
    fifo: true,
    retentionPeriod: cdk.Duration.days(14),
  });
  const piiScanQueue = new sqs.Queue(scope, `${projectName}-pii-scan-queue`, {
    queueName: `${projectName}-pii-scan-queue.fifo`,
    fifo: true,
    contentBasedDeduplication: false,
    retentionPeriod: cdk.Duration.days(4),
    visibilityTimeout: cdk.Duration.minutes(90),
    deadLetterQueue: { queue: piiScanDlq, maxReceiveCount: 3 },
  });
  requestStatusTopic.addSubscription(
    new snsSubscriptions.SqsSubscription(requestStatusNotificationQueue, {
      rawMessageDelivery: true,
    }),
  );

  return {
    issueTrackingAuditQueue,
    requestStatusTopic,
    requestStatusEmailQueue,
    requestStatusNotificationQueue,
    piiScanQueue,
    piiScanDlq,
  };
}
