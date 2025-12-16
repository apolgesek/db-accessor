#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as cdk from 'aws-cdk-lib';
import { DbAccessorStack } from '../lib/stack';

const app = new cdk.App();
new DbAccessorStack(app, 'DbAccessorStack', {
  env: {
    account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION,
  },
  stage: process.env.STAGE as 'dev' | 'prod',
  targetRoleArn: process.env.TARGET_ROLE_ARN!,
  projectName: 'db-accessor',
  githubOrg: 'apolgesek',
  githubRepo: 'db-accessor',
});
