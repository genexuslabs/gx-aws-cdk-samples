import { CfnCacheCluster, CfnSubnetGroup } from "@aws-cdk/aws-elasticache";
import * as apigateway from "@aws-cdk/aws-apigateway";
import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import { Code, Function, Runtime } from "@aws-cdk/aws-lambda";
import * as s3 from "@aws-cdk/aws-s3";
import * as iam from "@aws-cdk/aws-iam";

export interface ServerlessAPIProps extends cdk.StackProps {
  apiName: string;
  stageName?: string;
  timeout?: cdk.Duration;
  memorySize?: number;
}

export class AwsServerlessAPIStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: ServerlessAPIProps) {
    super(scope, id, props);

    const apiName = props?.apiName || "";
    const stageName = props?.stageName || "test";

    if (apiName.length == 0) {
      throw new Error("API Name cannot be empty");
    }

    if (stageName.length == 0) {
      throw new Error("Stage Name cannot be empty");
    }

    const lambdaFunctionName = `${apiName}_${stageName}`;

    const user = new iam.User(this, `${apiName}-user`);

    new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          actions: ["sts:AssumeRole"],
          effect: iam.Effect.ALLOW,
        }),
      ],
    });

    user.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:*"],
        resources: ["arn:aws:s3:::gx-deploy/*", "arn:aws:s3:::gx-deploy*"],
      })
    );

    const lambdaRole = new iam.Role(this, `${apiName}-lambda-role`, {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal("apigateway.amazonaws.com"),
        new iam.ServicePrincipal("lambda.amazonaws.com")
      ),
      description: "GeneXus Serverless Lambda Role",
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaRole"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaVPCAccessExecutionRole"
        ),
      ],
    });

    const accessKey = new iam.CfnAccessKey(this, `${apiName}-accesskey`, {
      userName: user.userName,
    });

    const privateBucket = new s3.Bucket(this, `${apiName}-bucket`);
    privateBucket.grantReadWrite(user);
    privateBucket.grantPutAcl(user);

    const api = new apigateway.RestApi(this, `${apiName}-apigw`, {
      description: `Endpoint API for: ${apiName}`,
      restApiName: apiName,
      deployOptions: {
        stageName: stageName,
      },
      defaultCorsPreflightOptions: {
        allowHeaders: [
          "Content-Type",
          "X-Amz-Date",
          "Authorization",
          "X-Api-Key",
        ],
        allowMethods: ["OPTIONS", "GET", "POST", "PUT", "PATCH", "DELETE"],
        allowCredentials: true,
        allowOrigins: ["*"],
      },
    });

    const lambdaFunction = new Function(this, `${apiName}-function`, {
      functionName: lambdaFunctionName,
      runtime: Runtime.JAVA_11,
      handler: "com.genexus.cloud.serverless.aws.LambdaHandler::handleRequest",
      code: Code.fromAsset(__dirname + "/../bootstrap"),
      //vpc: targetVpc,
      //allowPublicSubnet: true,
      role: lambdaRole,
      timeout: props?.timeout || cdk.Duration.seconds(30),
      memorySize: props?.memorySize || 768,
    });

    lambdaFunction.grantInvoke(user);

    user.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:*"],
        resources: [
          `arn:aws:lambda:${this.region}:${this.account}:function:${apiName}_*`,
        ],
      })
    );

    user.addToPolicy(
      new iam.PolicyStatement({
        actions: ["apigateway:*"],
        resources: [
          `arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}*`,
        ],
      })
    );

    user.addToPolicy(
      new iam.PolicyStatement({
        actions: ["apigateway:*"],
        resources: [`arn:aws:apigateway:${this.region}::/restapis*`],
      })
    );

    user.addToPolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [lambdaRole.roleArn],
      })
    );

    new cdk.CfnOutput(this, "apiName", { value: apiName });
    new cdk.CfnOutput(this, "apiUrl", { value: api.url });
    new cdk.CfnOutput(this, "serverlessRoleARN", { value: lambdaRole.roleArn });
    new cdk.CfnOutput(this, "bucketName", { value: privateBucket.bucketName });
    new cdk.CfnOutput(this, "accessKeyId", { value: accessKey.ref });
    new cdk.CfnOutput(this, "secretAccessKey", {
      value: accessKey.attrSecretAccessKey,
    });
  }
}
