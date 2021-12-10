import * as apigateway from "@aws-cdk/aws-apigateway";
import * as cdk from "@aws-cdk/core";
import * as lambda from "@aws-cdk/aws-lambda";
import * as s3 from "@aws-cdk/aws-s3";
import * as iam from "@aws-cdk/aws-iam";
import * as cloudfront from "@aws-cdk/aws-cloudfront";
import * as origins from "@aws-cdk/aws-cloudfront-origins";
import * as acm from "@aws-cdk/aws-certificatemanager";
import * as logs from "@aws-cdk/aws-logs";

import { OriginProtocolPolicy } from "@aws-cdk/aws-cloudfront";

export interface GeneXusServerlessAngularAppProps extends cdk.StackProps {
  readonly apiName: string;
  readonly apiDescription?: string;
  readonly webDomainName?: string;
  readonly stageName?: string;
  readonly timeout?: cdk.Duration;
  readonly memorySize?: number;
  readonly certificateARN?: string | null;
}

const lambdaHandlerName =
  "com.genexus.cloud.serverless.aws.LambdaHandler::handleRequest";
const lambdaDefaultMemorySize = 1024;
const lambdaDefaultTimeout = cdk.Duration.seconds(30);
const defaultLambdaRuntime = lambda.Runtime.JAVA_11;
const rewriteEdgeLambdaHandlerName = "rewrite.handler";

export class GeneXusServerlessAngularApp extends cdk.Construct {
  constructor(
    scope: cdk.Construct,
    id: string,
    props: GeneXusServerlessAngularAppProps
  ) {
    super(scope, id);

    const stack = cdk.Stack.of(this);
    
    const apiName = props?.apiName || "";
    const stageName = props?.stageName || "";

    if (apiName.length == 0) {
      throw new Error("API Name cannot be empty");
    }

    if (stageName.length == 0) {
      throw new Error("Stage Name cannot be empty");
    }
    
    //Angular App
    const websitePublicBucket = new s3.Bucket(this, `${apiName}-bucket-web`, {
      websiteIndexDocument: "index.html",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    //Serverless API
    const lambdaFunctionName = `${apiName}_${stageName}`;

    const user = new iam.User(this, `${apiName}-user`);

    websitePublicBucket.grantPublicAccess();
    websitePublicBucket.grantReadWrite(user);

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
      description: "GeneXus Serverless Application Lambda Role",
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

    const storageBucket = new s3.Bucket(this, `${apiName}-bucket`, {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    storageBucket.grantPutAcl(user);
    storageBucket.grantReadWrite(user);
    storageBucket.grantPublicAccess();

    const api = new apigateway.RestApi(this, `${apiName}-apigw`, {
      description: `${apiName} APIGateway Endpoint`,
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

    const lambdaFunction = new lambda.Function(this, `${apiName}-function`, {
      functionName: lambdaFunctionName,
      runtime: defaultLambdaRuntime,
      handler: lambdaHandlerName,
      code: lambda.Code.fromAsset(__dirname + "/../../bootstrap"), //Empty sample package
      //vpc: targetVpc,
      //allowPublicSubnet: true,
      role: lambdaRole,
      timeout: props?.timeout || lambdaDefaultTimeout,
      memorySize: props?.memorySize || lambdaDefaultMemorySize,
      description: `'${
        props?.apiDescription || apiName
      }' Serverless Lambda function`,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    lambdaFunction.grantInvoke(user);

    user.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:*"],
        resources: [
          `arn:aws:lambda:${stack.region}:${stack.account}:function:${apiName}_*`,
        ],
      })
    );

    user.addToPolicy(
      new iam.PolicyStatement({
        actions: ["apigateway:*"],
        resources: [
          `arn:aws:apigateway:${stack.region}::/restapis/${api.restApiId}*`,
        ],
      })
    );

    user.addToPolicy(
      new iam.PolicyStatement({
        actions: ["apigateway:*"],
        resources: [`arn:aws:apigateway:${stack.region}::/restapis*`],
      })
    );

    user.addToPolicy(
      new iam.PolicyStatement({
        actions: ["iam:PassRole"],
        resources: [lambdaRole.roleArn],
      })
    );

    const rewriteEdgeFunctionResponse =
      new cloudfront.experimental.EdgeFunction(this, `${apiName}EdgeLambda`, {
        runtime: lambda.Runtime.NODEJS_14_X,
        handler: rewriteEdgeLambdaHandlerName,
        code: lambda.Code.fromAsset("lambda"),
        description: `GeneXus Angular Rewrite Lambda for Cloudfront`,
        logRetention: logs.RetentionDays.FIVE_DAYS,
      });

    rewriteEdgeFunctionResponse.grantInvoke(user);
    rewriteEdgeFunctionResponse.addAlias("live", {});

    const rewriteConsumerUrlEdgeFunction =
      new cloudfront.experimental.EdgeFunction(
        this,
        `${apiName}RewriteEdgeLambda`,
        {
          runtime: lambda.Runtime.NODEJS_14_X,
          handler: "redirect.handler",
          code: lambda.Code.fromAsset("lambda"),
          description: `GeneXus Angular Rewrite Lambda for Cloudfront`,
          logRetention: logs.RetentionDays.FIVE_DAYS,
        }
      );

    rewriteConsumerUrlEdgeFunction.grantInvoke(user);
    rewriteConsumerUrlEdgeFunction.addAlias("prod", {});

    const originPolicy = new cloudfront.OriginRequestPolicy(
      this,
      `${apiName}HttpOriginPolicy`,
      {
        //originRequestPolicyName: "GX-HTTP-Origin-Policy",
        comment: `${apiName} Origin Http Policy`,
        headerBehavior: cloudfront.CacheHeaderBehavior.allowList(
          "Accept",
          "Accept-Charset",
          "Accept-Language",
          "Content-Type",
          "GxTZOffset",
          "DeviceId",
          "DeviceType",
          "Referer"
        ),
        queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
        cookieBehavior: cloudfront.CacheCookieBehavior.all(),
      }
    );

    const certificate = props?.certificateARN
      ? acm.Certificate.fromCertificateArn(
          this,
          "Cloudfront Certificate",
          props?.certificateARN
        )
      : undefined;

    const webDistribution = new cloudfront.Distribution(
      this,
      `${apiName}-cdn`,
      {
        comment: `${apiName} Cloudfront Distribution`,
        domainNames: props?.webDomainName ? [props?.webDomainName] : undefined,
        certificate: certificate,
        defaultBehavior: {
          origin: new origins.S3Origin(websitePublicBucket),
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          edgeLambdas: [
            {
              functionVersion: rewriteEdgeFunctionResponse,
              eventType: cloudfront.LambdaEdgeEventType.ORIGIN_RESPONSE,
            },
            {
              functionVersion: rewriteConsumerUrlEdgeFunction,
              eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
            },
          ],
        },
      }
    );

    const apiDomainName = `${api.restApiId}.execute-api.${stack.region}.amazonaws.com`;

    const apiGatewayOrigin = new origins.HttpOrigin(apiDomainName, {
      protocolPolicy: OriginProtocolPolicy.HTTPS_ONLY,
    });

    webDistribution.node.addDependency(api);

    webDistribution.addBehavior(`/${stageName}/*`, apiGatewayOrigin, {
      compress: true,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.ALLOW_ALL,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: originPolicy,
    });

    new cdk.CfnOutput(this, "ApiName", { value: apiName });
    new cdk.CfnOutput(this, "ApiUrl", { value: api.url });
    new cdk.CfnOutput(this, "IAMRoleARN", { value: lambdaRole.roleArn });
    new cdk.CfnOutput(this, "WebsiteBucket", {
      value: websitePublicBucket.bucketName,
    });
    new cdk.CfnOutput(this, "StorageBucket", {
      value: storageBucket.bucketName,
    });
    new cdk.CfnOutput(this, "AccessKey", { value: accessKey.ref });
    new cdk.CfnOutput(this, "SecretKey", {
      value: accessKey.attrSecretAccessKey,
    });
  }
}
