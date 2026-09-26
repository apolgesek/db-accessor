import { describe, test } from '@jest/globals';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { createDynamoDbTables } from '../lib/dynamodb-tables';
import { createMessagingResources } from '../lib/messaging';

describe('PII scan pipeline infrastructure', () => {
  test('creates the bounded asynchronous scan pipeline', () => {
    const stack = new cdk.Stack();
    createDynamoDbTables(stack, {
      projectName: 'db-accessor-dev',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    createMessagingResources(stack, 'db-accessor-dev');
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'db-accessor-dev-pii-scan-queue.fifo',
      FifoQueue: true,
      VisibilityTimeout: 5400,
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 3 }),
    });
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'db-accessor-dev-pii-suggestions',
    });
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'db-accessor-dev-configured-tables',
      GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({ IndexName: 'gsiPiiDetection' })]),
    });
  });
});
