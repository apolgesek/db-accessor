import { beforeAll, describe, expect, test } from '@jest/globals';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as logs from 'aws-cdk-lib/aws-logs';
import { createCognitoResources } from '../lib/cognito';
import { createDynamoDbTables } from '../lib/dynamodb-tables';
import { createSessionLambdas } from '../lib/lambda-functions';
import { createOperationalFailureAlarm } from '../lib/operational-alarms';

// Skips Lambda bundling so the template synthesizes without esbuild.
const newStack = () => new cdk.Stack(new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } }), 'Test');

describe('session infrastructure', () => {
  let template: Template;
  let tableLogicalId: string;

  beforeAll(() => {
    const stack = newStack();
    const tables = createDynamoDbTables(stack, {
      projectName: 'db-accessor-dev',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    createSessionLambdas(stack, {
      projectName: 'db-accessor-dev',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      lambdaLogRetention: logs.RetentionDays.ONE_WEEK,
      sharedEnvironment: { COGNITO_CLIENT_ID: 'web-client', USERNAME_PREFIX: '' },
      sessionsTable: tables.sessionsTable,
    });
    template = Template.fromStack(stack);
    tableLogicalId = stack.getLogicalId(tables.sessionsTable.node.defaultChild as cdk.CfnElement);
  });

  test('keeps sessions in an on-demand table keyed by session ID with TTL cleanup', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'db-accessor-dev-sessions',
      KeySchema: [{ AttributeName: 'sessionId', KeyType: 'HASH' }],
      BillingMode: 'PAY_PER_REQUEST',
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
      GlobalSecondaryIndexes: Match.absent(),
    });
  });

  test('gives each session Lambda only the table actions it needs', () => {
    const tableArn = { 'Fn::GetAtt': [tableLogicalId, 'Arn'] };
    const sessionTableActions = (functionName: string) => {
      const policies = template.findResources('AWS::IAM::Policy');
      const role = Object.values(template.findResources('AWS::Lambda::Function')).find(
        (fn) => fn.Properties.FunctionName === functionName,
      )!.Properties.Role['Fn::GetAtt'][0];

      return Object.values(policies)
        .filter((policy) => JSON.stringify(policy.Properties.Roles).includes(role))
        .flatMap((policy) => policy.Properties.PolicyDocument.Statement)
        .filter((statement) => JSON.stringify(statement.Resource) === JSON.stringify(tableArn))
        .flatMap((statement) => [statement.Action].flat())
        .sort();
    };

    expect(sessionTableActions('db-accessor-dev-create-session')).toEqual(['dynamodb:GetItem', 'dynamodb:PutItem']);
    expect(sessionTableActions('db-accessor-dev-get-session')).toEqual(['dynamodb:GetItem']);
    expect(sessionTableActions('db-accessor-dev-record-session-activity')).toEqual([
      'dynamodb:GetItem',
      'dynamodb:UpdateItem',
    ]);
  });

  test('configures the session Lambdas with the table and the metrics namespace', () => {
    for (const functionName of [
      'db-accessor-dev-create-session',
      'db-accessor-dev-get-session',
      'db-accessor-dev-record-session-activity',
    ]) {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: functionName,
        Environment: {
          Variables: Match.objectLike({
            SESSIONS_TABLE_NAME: { Ref: tableLogicalId },
            METRICS_NAMESPACE: 'db-accessor-dev',
            COGNITO_CLIENT_ID: 'web-client',
          }),
        },
      });
    }
  });

  test('alarms on any operational failure within five minutes', () => {
    const stack = newStack();
    createOperationalFailureAlarm(stack, 'db-accessor-dev');

    Template.fromStack(stack).hasResourceProperties('AWS::CloudWatch::Alarm', {
      Namespace: 'db-accessor-dev',
      MetricName: 'OperationalFailures',
      Statistic: 'Sum',
      Period: 300,
      Threshold: 1,
      EvaluationPeriods: 1,
      ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      TreatMissingData: 'notBreaching',
    });
  });
});

describe('Cognito web client', () => {
  test('declares 15-minute access and ID tokens, 12-hour refresh tokens, revocation on, and rotation off', () => {
    const stack = newStack();
    createCognitoResources(stack, {
      projectName: 'db-accessor-dev',
      stage: 'dev',
      domain: 'example.com',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      lambdaLogRetention: logs.RetentionDays.ONE_WEEK,
    });

    Template.fromStack(stack).hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'db-accessor-dev-web',
      AccessTokenValidity: 15,
      IdTokenValidity: 15,
      RefreshTokenValidity: 720,
      TokenValidityUnits: { AccessToken: 'minutes', IdToken: 'minutes', RefreshToken: 'minutes' },
      EnableTokenRevocation: true,
      RefreshTokenRotation: { Feature: 'DISABLED' },
    });
  });
});
