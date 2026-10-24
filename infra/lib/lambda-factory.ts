import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { repoRoot } from './paths';

export interface CreateLambdaOptions {
  projectName: string;
  fnName: string;
  environment?: Record<string, string>;
  timeout?: cdk.Duration;
  createLogGroup?: boolean;
  logGroupRemovalPolicy?: cdk.RemovalPolicy;
  logRetention?: logs.RetentionDays;
  role?: iam.IRole;
  memorySize?: number;
  reservedConcurrentExecutions?: number;
}

export function createLambda(scope: Construct, options: CreateLambdaOptions) {
  const functionName = `${options.projectName}-${options.fnName}`;
  const entry = path.join(repoRoot, 'src', 'functions', options.fnName.replaceAll('-', '_'), 'main.ts');

  const fn = new nodejs.NodejsFunction(scope, functionName, {
    functionName,
    entry,
    projectRoot: repoRoot,
    depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
    handler: 'lambdaHandler',
    runtime: lambda.Runtime.NODEJS_22_X,
    architecture: lambda.Architecture.X86_64,
    environment: options.environment,
    timeout: options.timeout,
    role: options.role,
    memorySize: options.memorySize,
    reservedConcurrentExecutions: options.reservedConcurrentExecutions,
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
