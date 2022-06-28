#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { GXServerlessStack } from "../lib/gx-angular-app";

const profileAccountId = process.env.CDK_DEFAULT_ACCOUNT;
const profileRegion = process.env.CDK_DEFAULT_REGION;

const env = {
  account: profileAccountId,
  region: profileRegion,
};

const app = new cdk.App();

const apiName = app.node.tryGetContext('appname');
const stageName = app.node.tryGetContext('stage');
const domainName = app.node.tryGetContext('domain');
const certificateARN = app.node.tryGetContext('certificateARN');
const memorySize = app.node.tryGetContext('memory');

if (!apiName) {
  throw new Error('"name" parameter must be specified for API Name');
}
if (!stageName) {
  throw new Error('"stageName" parameter must be specified for Stage Name');
}

new GXServerlessStack(app, `${apiName}-${stageName}-Stack`, {
  env: env,
  apiName: apiName,
  webDomainName: domainName,
  certificateARN: certificateARN,
  stageName: stageName,
  memorySize: memorySize
});
