import path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface CreateLambdaOptions {
  projectName: string;
  fnName: string;
  environment?: Record<string, string>;
  timeout?: cdk.Duration;
  createLogGroup?: boolean;
  logGroupRemovalPolicy?: cdk.RemovalPolicy;
  logRetention?: logs.RetentionDays;
  role?: iam.IRole;
}

export function createLambda(scope: Construct, options: CreateLambdaOptions) {
  const node22 = (lambda.Runtime as any).NODEJS_22_X ?? new lambda.Runtime('nodejs22.x', lambda.RuntimeFamily.NODEJS);

  const functionName = `${options.projectName}-${options.fnName}`;
  const entry = path.join(__dirname, '..', '..', 'src', 'functions', options.fnName.replaceAll('-', '_'), 'main.ts');

  const fn = new nodejs.NodejsFunction(scope, functionName, {
    functionName,
    entry,
    handler: 'lambdaHandler',
    runtime: node22,
    architecture: lambda.Architecture.X86_64,
    environment: options.environment,
    timeout: options.timeout,
    role: options.role,
    bundling: { minify: true, sourceMap: true, target: 'es2020' },
  });

  if (options.createLogGroup === false) {
    fn.node.tryRemoveChild('LogGroup');
  } else {
    const logGroup = fn.node.tryFindChild('LogGroup') as logs.LogGroup | undefined;
    if (logGroup && options.logRetention) {
      const logGroupResource = logGroup.node.defaultChild as logs.CfnLogGroup | undefined;
      if (logGroupResource) {
        logGroupResource.retentionInDays = options.logRetention;
      }
    }
    logGroup?.applyRemovalPolicy(options.logGroupRemovalPolicy ?? cdk.RemovalPolicy.RETAIN);
  }

  new cdk.CfnOutput(scope, `${functionName}-execution-role`, {
    value: fn.role?.roleArn ?? '',
  });

  return fn;
}
