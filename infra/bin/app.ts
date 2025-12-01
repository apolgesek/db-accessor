#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DbAccessorStack } from '../lib/stack';

const app = new cdk.App();
new DbAccessorStack(app, 'DbAccessorStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'eu-central-1',
  },

  projectName: 'db-accessor',
  existingGitHubOidcProviderArn: 'arn:aws:iam::058264309711:oidc-provider/token.actions.githubusercontent.com',
  githubOrg: 'apolgesek',
  githubRepo: 'db-accessor',
});
