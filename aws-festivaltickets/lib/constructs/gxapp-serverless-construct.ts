import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import { Construct } from 'constructs';
// { Credentials, DatabaseInstance, DatabaseInstanceEngine, DatabaseSecret, MysqlEngineVersion }
import * as rds from 'aws-cdk-lib/aws-rds';

import { OriginProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { timeStamp } from "console";

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

export class GeneXusServerlessAngularApp extends Construct {
  isDevEnv: boolean = true;
  vpc: ec2.Vpc;
  dbServer: rds.DatabaseInstance;
  iamUser: iam.User;
  DTicket: dynamodb.Table;
  DCache: dynamodb.Table;

  constructor(
    scope: Construct,
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

    //----------------------------------
    // VPC
    this.vpc = this.createVPC( apiName, stageName); 
    const DynamoGatewayEndpoint = this.vpc.addGatewayEndpoint('Dynamo-endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB
    });

    //this.vpc.addInterfaceEndpoint(`ssvpc`, {
    //  service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER
    //});
    //---------------------------------
    // RDS - MySQL 8.0
    const dbsecurityGroup = new ec2.SecurityGroup(this, `rds-sg`, {
      vpc: this.vpc,
      allowAllOutbound: true
    });
    // dbsecurityGroup.connections.allowFrom(asgSG, ec2.Port.tcp(3306));
    dbsecurityGroup.connections.allowFrom(dbsecurityGroup, ec2.Port.tcp(3306));
    if (this.isDevEnv) {
      //Access from MyIP
      dbsecurityGroup.connections.allowFrom( ec2.Peer.ipv4('100.100.100.100/32'), ec2.Port.tcpRange(1, 65535)); 
    }
    this.dbServer = this.createDB(props, dbsecurityGroup);

    // ---------------------------------
    // Dynamo
    this.createDynamo(props);

    // ---------------------------------
    // Security
    // -------------------------------

    // User to manage the apiname
    // S3 gx-deploy will be used to deploy the app to aws
    this.iamUser = new iam.User(this, `${apiName}-user`);
    this.iamUser.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:*"],
        resources: ["arn:aws:s3:::gx-deploy/*", "arn:aws:s3:::gx-deploy*"],
      })
    );
    // Grant access to all application lambda functions
    this.iamUser.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:*"],
        resources: [
          `arn:aws:lambda:${stack.region}:${stack.account}:function:${apiName}_*`,
        ],
      })
    );
    const accessKey = new iam.CfnAccessKey(this, `${apiName}-accesskey`, {
      userName: this.iamUser.userName,
    });
    this.DCache.grantReadWriteData(this.iamUser);
    this.DTicket.grantReadWriteData( this.iamUser);

    // Lambda Functions
    const lambdaRole = new iam.Role(this, `lambda-role`, {
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
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaSQSQueueExecutionRole"
        ),
      ],
    });
    
    // -------------------------------
    // SQS Ticket Queue
    const ticketQueue = new sqs.Queue(this, `ticketqueue`, {
      queueName: `${apiName}_${stageName}_ticketqueue`
    });

    // ----------------------------
    // Lambda for SQS
    const queueLambdaFunction = new lambda.Function(this, `TicketProcess`, {
      functionName: `${apiName}_${stageName}_TicketProcess`,
      runtime: defaultLambdaRuntime,
      handler: "com.genexus.cloud.serverless.aws.handler.LambdaSQSHandler::handleRequest",
      code: lambda.Code.fromAsset(__dirname + "/../../bootstrap"), //Empty sample package
      vpc: this.vpc,
      //allowPublicSubnet: true,
      role: lambdaRole,
      timeout: props?.timeout || lambdaDefaultTimeout,
      memorySize: props?.memorySize || lambdaDefaultMemorySize,
      description: `'${
        props?.apiDescription || apiName
      }' Queue Ticket Process Lambda function`,
      logRetention: logs.RetentionDays.ONE_WEEK,
      securityGroups: [dbsecurityGroup]
    });
    // 

    // Lambda queue trigger
    const eventSource = new lambdaEventSources.SqsEventSource(ticketQueue);
    queueLambdaFunction.addEventSource(eventSource);

    // Some queue permissions
    ticketQueue.grantConsumeMessages(queueLambdaFunction);
    ticketQueue.grantSendMessages(this.iamUser);
    // -------------------------------
    // Lambda CRON

    // -------------------------------
    // Angular App Host
    /*
    const websitePublicBucket = new s3.Bucket(this, `${apiName}-bucket-web`, {
      websiteIndexDocument: "index.html",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
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
    
    // Storage
    const storageBucket = new s3.Bucket(this, `${apiName}-bucket`, {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    storageBucket.grantPutAcl(user);
    storageBucket.grantReadWrite(user);
    storageBucket.grantPublicAccess();
    */

    // -----------------------------
    // Backend services
    /*
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

    const lambdaFunctionName = `${apiName}_${stageName}`;
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
    this.DCache.grantReadWriteData(lambdaFunction);
    this.DTicket.grantReadWriteData(lambdaFunction);
    lambdaFunction.grantInvoke(user);

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
        functionName: `${apiName}-${stageName}-EdgeLambda`,
        runtime: lambda.Runtime.NODEJS_14_X,
        handler: rewriteEdgeLambdaHandlerName,
        code: lambda.Code.fromAsset("lambda"),
        description: `GeneXus Angular Rewrite Lambda for Cloudfront`,
        logRetention: logs.RetentionDays.FIVE_DAYS        
      });

    rewriteEdgeFunctionResponse.grantInvoke(user);
    rewriteEdgeFunctionResponse.addAlias("live", {});

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
            }
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
    */
    
    // Generic
    new cdk.CfnOutput(this, "ApiName", {
      value: apiName,
      description: "Application Name (API Name)",
    });
    new cdk.CfnOutput(this, "StageName", {
      value: stageName,
      description: "Stage Name",
    });
    
    // RDS MySQL
    new cdk.CfnOutput(this, "DB EndPoint", {
      value: this.dbServer.dbInstanceEndpointAddress,
      description: "RDS MySQL Endpoint",
    });
    
    new cdk.CfnOutput(this, 'DB SecretName', {
      value: this.dbServer.secret?.secretName!,
    });

    // Dynamo
    new cdk.CfnOutput(this, 'Dynamo DCache TableName', { value: this.DCache.tableName });
    new cdk.CfnOutput(this, 'Dynamo DTicket TableName', { value: this.DTicket.tableName });

    /*
    new cdk.CfnOutput(this, "WebURL", {
      value: `https://${webDistribution.domainName}`,
      description: "Frontend Website URL",
    });

    new cdk.CfnOutput(this, "ApiURL", {
      value: `https://${webDistribution.domainName}/${stageName}/`,
      description: "Services API URL (Services URL)",
    });
    */
    
    new cdk.CfnOutput(this, "IAMRoleARN", {
      value: lambdaRole.roleArn,
      description: "IAM Role ARN",
    });
    /*
    new cdk.CfnOutput(this, "WebsiteBucket", {
      value: websitePublicBucket.bucketName,
      description: "Bucket Name for Angular WebSite Deployment",
    });
    new cdk.CfnOutput(this, "StorageBucket", {
      value: storageBucket.bucketName,
      description: "Bucket for Storage Service",
    });
    */

    new cdk.CfnOutput(this, "AccessKey", {
      value: accessKey.ref,
      description: "Access Key",
    });
    new cdk.CfnOutput(this, "AccessSecretKey", {
      value: accessKey.attrSecretAccessKey,
      description: "Access Secret Key",
    });

    new cdk.CfnOutput(this, "SQS Ticket Url", {
      value: ticketQueue.queueUrl,
      description: "SQS Ticket Url",
    });

    new cdk.CfnOutput(this, "LambdaTicketProcess", {
      value: queueLambdaFunction.functionName,
      description: "Ticket Process Lambda Name",
    });
  }
  private createDynamo(props: GeneXusServerlessAngularAppProps){
    const apiName = props?.apiName || "";
    const stageName = props?.stageName || "";

    // TODO: Ver si en algún momento Gx implementa el cambio de nombre en tablas en dataviews
    this.DCache = new dynamodb.Table( this, `DCache`, {
      tableName: `DCache`,
      partitionKey: { name: 'DCacheId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    this.DTicket = new dynamodb.Table( this, `DTicket`, {
      tableName: `DTicket`,
      partitionKey: { name: 'DTicketId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'DTicketCode', type: dynamodb.AttributeType.NUMBER},
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
  }

  private createDB(props: GeneXusServerlessAngularAppProps, sg: ec2.SecurityGroup): rds.DatabaseInstance{
    const apiName = props?.apiName || "";
    const stageName = props?.stageName || "";

    const instanceIdentifier = `${apiName}-${stageName}-db`;

    //Allow from CodeBuild
    // dbsecurityGroup.connections.allowFrom(Peer.ipv4('34.228.4.208/28'), ec2.Port.tcp(3306)); //Access from GeneXus

    return new rds.DatabaseInstance(this, `${apiName}-db`, {
      publiclyAccessible: this.isDevEnv,
      vpcSubnets: {
        onePerAz: true,
        subnetType: this.isDevEnv ? ec2.SubnetType.PUBLIC : ec2.SubnetType.PRIVATE_WITH_NAT
      },
      credentials: rds.Credentials.fromGeneratedSecret('dbadmin'),
      vpc: this.vpc,
      port: 3306,
      databaseName: 'festivaltickets',
      allocatedStorage: 20,
      instanceIdentifier,
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0
      }),
      securityGroups: [sg],
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      removalPolicy: this.isDevEnv ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN
    })
    
    // potentially allow connections to the RDS instance...
    // dbServer.connections.allowFrom ...
  }
  private createVPC( apiName: string, stageName: string): ec2.Vpc {
    /*
        new Vpc(this, `${apiName}-vpc`, {
      vpcName: `${apiName}-${stageName}-vpc`,
      subnetConfiguration: [{
        cidrMask: 24,
        name: 'private',
        subnetType: SubnetType.PRIVATE_WITH_NAT,
      },
      {
        cidrMask: 28,
        name: 'rds',
        subnetType: SubnetType.PRIVATE_ISOLATED,
      },
      {
        cidrMask: 24,
        name: 'public',
        subnetType: SubnetType.PUBLIC,
      }
      ]
    })
    */

/*
        
*/

    return new ec2.Vpc(this, `vpc`, {
      vpcName: `${apiName}-${stageName}-vpc`,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'private_isolated',
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
        }
      ],
      maxAzs: 2
    });
  }

}
