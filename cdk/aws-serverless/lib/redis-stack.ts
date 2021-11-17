import { CfnCacheCluster, CfnSubnetGroup } from "@aws-cdk/aws-elasticache";
import * as apigateway from "@aws-cdk/aws-apigateway";
import * as cdk from "@aws-cdk/core";
import * as ec2 from "@aws-cdk/aws-ec2";
import { Code, Function, Runtime } from "@aws-cdk/aws-lambda";
import * as s3 from "@aws-cdk/aws-s3";
import * as iam from "@aws-cdk/aws-iam";

export interface ServerlessAPIProps {
  apiName: string;
  stageName: string;
}

export class AwsServerlessAPIStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const apiName = "FullGX-ServerlessAPI";
    const stageName = "testing";
    const lambdaFunctionName = `${apiName}_${stageName}`;
    const includeRedis = false;

    const user = new iam.User(this, "DeployServerlessUser");

    const lambdaAssumePolicy = new iam.PolicyDocument({
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

    const lambdaRole = new iam.Role(this, "lambda-role", {
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

    const accessKey = new iam.CfnAccessKey(this, "AccessKey", {
      userName: user.userName,
    });

    const privateBucket = new s3.Bucket(this, "AppPrivateBucket");
    privateBucket.grantReadWrite(user);

    const targetVpc = ec2.Vpc.fromLookup(this, "default", { isDefault: true });

    // The security group that defines network level access to the cluster
    const securityGroupEveryWhere = new ec2.SecurityGroup(
      this,
      `${id}-from-everywhere`,
      { vpc: targetVpc, securityGroupName: "FromEverywhere" }
    );
    securityGroupEveryWhere.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(6379),
      "REDIS from anywhere"
    );

    const subnets = targetVpc.publicSubnets.map((subnet) => subnet.subnetId);

    if (subnets.length === 0)
      throw new Error("Subnets cannot be empty for vpc:" + targetVpc.vpcId);

    const subnetGroup = new CfnSubnetGroup(
      this,
      "RedisClusterPrivateSubnetGroup",
      {
        cacheSubnetGroupName: "private",
        subnetIds: subnets,
        description: `List of subnets used for redis cache ${id}`,
      }
    );

    // The security group that defines network level access to the cluster
    const securityGroup = new ec2.SecurityGroup(this, `${id}-security-group`, {
      vpc: targetVpc,
    });

    const redis = new CfnCacheCluster(this, `RedisCluster`, {
      engine: "redis",
      cacheNodeType: "cache.t2.micro",
      numCacheNodes: 1,
      clusterName: `redis-cache-${id}`,
      vpcSecurityGroupIds: [
        securityGroup.securityGroupId,
        securityGroupEveryWhere.securityGroupId,
      ],
      cacheSubnetGroupName: subnetGroup.cacheSubnetGroupName,
    });
    redis.addDependsOn(subnetGroup);

    const api = new apigateway.RestApi(this, "api", {
      description: "Endpoint API",
      restApiName: apiName,
      deployOptions: {
        stageName: stageName,
      },
      // 👇 enable CORS
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

    const lambdaFunction = new Function(this, "MyFunction", {
      functionName: lambdaFunctionName,
      runtime: Runtime.JAVA_11,
      handler: "com.genexus.cloud.serverless.aws.LambdaHandler::handleRequest",
      code: Code.fromAsset(__dirname + "/../bootstrap"),
      //vpc: targetVpc,
      //allowPublicSubnet: true,
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 768,
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

    new cdk.CfnOutput(this, "redisEndpoint", {
      value: redis.attrRedisEndpointAddress,
    });

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
