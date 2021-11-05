#!/usr/bin/env node
import * as cdk from "@aws-cdk/core";
import { AwsServerlessStack } from "../lib/aws-serverless-stack";
import { GeneXusSandboxStack } from "../lib/aws-users";

const profileAccountId = process.env.CDK_DEFAULT_ACCOUNT;
const profileRegion = process.env.CDK_DEFAULT_REGION;

const envSandbox = {
  account: profileAccountId,
  region: profileRegion,
};

const app = new cdk.App();
new AwsServerlessStack(app, "AwsServerlessStack", {
  env: envSandbox,
});

new GeneXusSandboxStack(app, "GeneXusStack", {
  env: envSandbox,
});
