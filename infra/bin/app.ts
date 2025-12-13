#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DbAccessorStack } from '../lib/stack';

const app = new cdk.App();
new DbAccessorStack(app, 'DbAccessorStack', {
  env: {
    account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION,
  },
  stage: process.env.STAGE as 'dev' | 'prod',
  projectName: 'db-accessor',
  githubOrg: 'apolgesek',
  githubRepo: 'db-accessor',
  identityCenterRoleArn: 'arn:aws:iam::058264309711:role/IdentityCenterAutomationRole',
  ssoInstanceArn: 'arn:aws:sso:::instance/ssoins-698754f79f02e2e0',
});
