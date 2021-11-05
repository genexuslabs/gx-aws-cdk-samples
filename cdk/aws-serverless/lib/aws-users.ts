import { CfnCacheCluster, CfnSubnetGroup } from "@aws-cdk/aws-elasticache";
import * as apigateway from "@aws-cdk/aws-apigateway";

import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import { Code, Function, Runtime } from "@aws-cdk/aws-lambda";
import * as s3 from "@aws-cdk/aws-s3";
import * as iam from "@aws-cdk/aws-iam";
import { userInfo } from "os";
import { SecretValue } from "@aws-cdk/core";

export interface User {
  userName: string;
  password: string;
}

const users: User[] = [
  {
    userName: "apanizza",
    password: "W_RdL.Ha_dKspg5~",
  },
  {
    userName: "gechague",
    password: "jVkV8agv7VGNFAYhHV88",
  },
];

export class GeneXusSandboxStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 👇 Create group
    const group = new iam.Group(this, "GeneXusUserGroup", {
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess"),
      ],
    });

    for (let index = 0; index < users.length; index++) {
      const user = users[index];

      const iamUser = new iam.User(this, user.userName, {
        userName: user.userName,
        groups: [group],
        password: SecretValue.plainText(user.password),
        passwordResetRequired: true
      });

      const accessKey = new iam.CfnAccessKey(
        this,
        "AccessKey_" + user.userName,
        {
          userName: iamUser.userName,
        }
      );

     
      new cdk.CfnOutput(this, "user_" + user.userName, {
        value: user.userName,
      });
      new cdk.CfnOutput(this, "password_" + user.userName, {
        value: user.password,
      });
      new cdk.CfnOutput(this, "accessKeyId_" + user.userName, {
        value: accessKey.ref,
      });
      new cdk.CfnOutput(this, "secretAccessKey_" + user.userName, {
        value: accessKey.attrSecretAccessKey,
      });
    }
  }
}
