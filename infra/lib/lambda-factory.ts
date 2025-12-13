import path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

export function createLambda(
  scope: Construct,
  projectName: string,
  fnName: string,
  type: 'iam' | 'sso',
  environment: Record<string, string>,
) {
  const node22 = (lambda.Runtime as any).NODEJS_22_X ?? new lambda.Runtime('nodejs22.x', lambda.RuntimeFamily.NODEJS);

  const functionName = `${projectName}-${type}-${fnName}`;
  const entry = path.join(__dirname, '..', '..', 'src', 'functions', fnName.replaceAll('-', '_'), type, 'main.ts');

  return new nodejs.NodejsFunction(scope, functionName, {
    functionName,
    entry,
    handler: 'lambdaHandler',
    runtime: node22,
    architecture: lambda.Architecture.X86_64,
    environment,
    bundling: { minify: true, sourceMap: true, target: 'es2020' },
  });
}
