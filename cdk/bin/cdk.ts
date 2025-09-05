#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { DbAccessorStack } from "../lib/app-stack";

const app = new cdk.App();
new DbAccessorStack(app, "DbAccessorStack", {
  /* env: { account: '123456789012', region: 'eu-central-1' } */
});
