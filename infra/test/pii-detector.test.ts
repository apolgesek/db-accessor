import { describe, test } from '@jest/globals';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as logs from 'aws-cdk-lib/aws-logs';
import { createPiiDetectorLambda } from '../lib/lambda-functions';

describe('PII detector infrastructure', () => {
  test('creates a private Lambda with a ten-second timeout and no service permissions', () => {
    const stack = new cdk.Stack();
    createPiiDetectorLambda(stack, {
      projectName: 'db-accessor-test',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      lambdaLogRetention: logs.RetentionDays.THREE_MONTHS,
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'db-accessor-test-pii-detector',
      Handler: 'index.lambdaHandler',
      Timeout: 10,
      Environment: Match.absent(),
    });
    template.resourceCountIs('AWS::IAM::Policy', 0);
    template.resourceCountIs('AWS::ApiGateway::Method', 0);
    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 0);
  });
});
