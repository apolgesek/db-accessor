import path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

export interface CreateLambdaOptions {
  projectName: string;
  fnName: string;
  environment?: Record<string, string>;
  timeout?: cdk.Duration;
  createLogGroup?: boolean;
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
    bundling: { minify: true, sourceMap: true, target: 'es2020' },
  });

  if (options.createLogGroup === false) {
    fn.node.tryRemoveChild('LogGroup');
  }

  new cdk.CfnOutput(scope, `${functionName}-execution-role`, {
    value: fn.role?.roleArn ?? '',
  });

  return fn;
}
