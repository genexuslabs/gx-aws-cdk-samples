"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeneXusServerlessAngularApp = void 0;
const cdk = require("aws-cdk-lib");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const sqs = require("aws-cdk-lib/aws-sqs");
const lambda = require("aws-cdk-lib/aws-lambda");
const ec2 = require("aws-cdk-lib/aws-ec2");
const lambdaEventSources = require("aws-cdk-lib/aws-lambda-event-sources");
const iam = require("aws-cdk-lib/aws-iam");
const logs = require("aws-cdk-lib/aws-logs");
const constructs_1 = require("constructs");
// { Credentials, DatabaseInstance, DatabaseInstanceEngine, DatabaseSecret, MysqlEngineVersion }
const rds = require("aws-cdk-lib/aws-rds");
const lambdaHandlerName = "com.genexus.cloud.serverless.aws.LambdaHandler::handleRequest";
const lambdaDefaultMemorySize = 1024;
const lambdaDefaultTimeout = cdk.Duration.seconds(30);
const defaultLambdaRuntime = lambda.Runtime.JAVA_11;
const rewriteEdgeLambdaHandlerName = "rewrite.handler";
class GeneXusServerlessAngularApp extends constructs_1.Construct {
    constructor(scope, id, props) {
        var _a;
        super(scope, id);
        this.isDevEnv = true;
        const stack = cdk.Stack.of(this);
        const apiName = (props === null || props === void 0 ? void 0 : props.apiName) || "";
        const stageName = (props === null || props === void 0 ? void 0 : props.stageName) || "";
        if (apiName.length == 0) {
            throw new Error("API Name cannot be empty");
        }
        if (stageName.length == 0) {
            throw new Error("Stage Name cannot be empty");
        }
        //----------------------------------
        // VPC
        this.vpc = this.createVPC(apiName, stageName);
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
            dbsecurityGroup.connections.allowFrom(ec2.Peer.ipv4('100.100.100.100/32'), ec2.Port.tcpRange(1, 65535));
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
        this.iamUser.addToPolicy(new iam.PolicyStatement({
            actions: ["s3:*"],
            resources: ["arn:aws:s3:::gx-deploy/*", "arn:aws:s3:::gx-deploy*"],
        }));
        const accessKey = new iam.CfnAccessKey(this, `${apiName}-accesskey`, {
            userName: this.iamUser.userName,
        });
        this.DCache.grantReadWriteData(this.iamUser);
        this.DTicket.grantReadWriteData(this.iamUser);
        // Lambda Functions
        const lambdaRole = new iam.Role(this, `lambda-role`, {
            assumedBy: new iam.CompositePrincipal(new iam.ServicePrincipal("apigateway.amazonaws.com"), new iam.ServicePrincipal("lambda.amazonaws.com")),
            description: "GeneXus Serverless Application Lambda Role",
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
                iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaRole"),
                iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole"),
                iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaSQSQueueExecutionRole"),
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
            code: lambda.Code.fromAsset(__dirname + "/../../bootstrap"),
            vpc: this.vpc,
            //allowPublicSubnet: true,
            role: lambdaRole,
            timeout: (props === null || props === void 0 ? void 0 : props.timeout) || lambdaDefaultTimeout,
            memorySize: (props === null || props === void 0 ? void 0 : props.memorySize) || lambdaDefaultMemorySize,
            description: `'${(props === null || props === void 0 ? void 0 : props.apiDescription) || apiName}' Queue Ticket Process Lambda function`,
            logRetention: logs.RetentionDays.ONE_WEEK,
            securityGroups: [dbsecurityGroup]
        });
        // 
        // Lambda queue trigger
        const eventSource = new lambdaEventSources.SqsEventSource(ticketQueue);
        queueLambdaFunction.addEventSource(eventSource);
        ticketQueue.grantConsumeMessages(queueLambdaFunction);
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
            value: (_a = this.dbServer.secret) === null || _a === void 0 ? void 0 : _a.secretName,
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
    }
    createDynamo(props) {
        const apiName = (props === null || props === void 0 ? void 0 : props.apiName) || "";
        const stageName = (props === null || props === void 0 ? void 0 : props.stageName) || "";
        // TODO: Ver si en algún momento Gx implementa el cambio de nombre en tablas en dataviews
        this.DCache = new dynamodb.Table(this, `DCache`, {
            tableName: `DCache`,
            partitionKey: { name: 'DCacheId', type: dynamodb.AttributeType.STRING },
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });
        this.DTicket = new dynamodb.Table(this, `DTicket`, {
            tableName: `DTicket`,
            partitionKey: { name: 'DTicketId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'DTicketCode', type: dynamodb.AttributeType.NUMBER },
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });
    }
    createDB(props, sg) {
        const apiName = (props === null || props === void 0 ? void 0 : props.apiName) || "";
        const stageName = (props === null || props === void 0 ? void 0 : props.stageName) || "";
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
        });
        // potentially allow connections to the RDS instance...
        // dbServer.connections.allowFrom ...
    }
    createVPC(apiName, stageName) {
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
exports.GeneXusServerlessAngularApp = GeneXusServerlessAngularApp;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ3hhcHAtc2VydmVybGVzcy1jb25zdHJ1Y3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJneGFwcC1zZXJ2ZXJsZXNzLWNvbnN0cnVjdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSxtQ0FBbUM7QUFDbkMscURBQXFEO0FBQ3JELDJDQUEyQztBQUMzQyxpREFBaUQ7QUFFakQsMkNBQTJDO0FBQzNDLDJFQUEyRTtBQUUzRSwyQ0FBMkM7QUFJM0MsNkNBQTZDO0FBRTdDLDJDQUF1QztBQUN2QyxnR0FBZ0c7QUFDaEcsMkNBQTJDO0FBZTNDLE1BQU0saUJBQWlCLEdBQ3JCLCtEQUErRCxDQUFDO0FBQ2xFLE1BQU0sdUJBQXVCLEdBQUcsSUFBSSxDQUFDO0FBQ3JDLE1BQU0sb0JBQW9CLEdBQUcsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUM7QUFDdEQsTUFBTSxvQkFBb0IsR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQztBQUNwRCxNQUFNLDRCQUE0QixHQUFHLGlCQUFpQixDQUFDO0FBRXZELE1BQWEsMkJBQTRCLFNBQVEsc0JBQVM7SUFReEQsWUFDRSxLQUFnQixFQUNoQixFQUFVLEVBQ1YsS0FBdUM7O1FBRXZDLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFabkIsYUFBUSxHQUFZLElBQUksQ0FBQztRQWN2QixNQUFNLEtBQUssR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUVqQyxNQUFNLE9BQU8sR0FBRyxDQUFBLEtBQUssYUFBTCxLQUFLLHVCQUFMLEtBQUssQ0FBRSxPQUFPLEtBQUksRUFBRSxDQUFDO1FBQ3JDLE1BQU0sU0FBUyxHQUFHLENBQUEsS0FBSyxhQUFMLEtBQUssdUJBQUwsS0FBSyxDQUFFLFNBQVMsS0FBSSxFQUFFLENBQUM7UUFFekMsSUFBSSxPQUFPLENBQUMsTUFBTSxJQUFJLENBQUMsRUFB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dkQscUNBQXFDO0lBQ3ZDLENBQUM7SUFDTyxTQUFTLENBQUUsT0FBZSxFQUFFLFNBQWlCO1FBQ25EOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztVQW9CRTtRQUVOOztVQUVFO1FBRUUsT0FBTyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRTtZQUM5QixPQUFPLEVBQUUsR0FBRyxPQUFPLElBQUksU0FBUyxNQUFNO1lBQ3RDLG1CQUFtQixFQUFFO2dCQUNuQjtvQkFDRSxRQUFRLEVBQUUsRUFBRTtvQkFDWixJQUFJLEVBQUUsUUFBUTtvQkFDZCxVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxNQUFNO2lCQUNsQztnQkFDRDtvQkFDRSxRQUFRLEVBQUUsRUFBRTtvQkFDWixJQUFJLEVBQUUsa0JBQWtCO29CQUN4QixVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxnQkFBZ0I7aUJBQzVDO2FBQ0Y7WUFDRCxNQUFNLEVBQUUsQ0FBQztTQUNWLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FFRjtBQTFkRCxrRUEwZEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheVwiO1xyXG5pbXBvcnQgKiBhcyBjZGsgZnJvbSBcImF3cy1jZGstbGliXCI7XHJcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGJcIjtcclxuaW1wb3J0ICogYXMgc3FzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtc3FzXCI7XHJcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxhbWJkYVwiO1xyXG5pbXBvcnQgKiBhcyBlY3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcyc7XHJcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcclxuaW1wb3J0ICogYXMgbGFtYmRhRXZlbnRTb3VyY2VzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLWV2ZW50LXNvdXJjZXNcIjtcclxuaW1wb3J0ICogYXMgczMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1zM1wiO1xyXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1pYW1cIjtcclxuaW1wb3J0ICogYXMgY2xvdWRmcm9udCBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnRcIjtcclxuaW1wb3J0ICogYXMgb3JpZ2lucyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnQtb3JpZ2luc1wiO1xyXG5pbXBvcnQgKiBhcyBhY20gZnJvbSBcImF3cy1jZGstbGliL2F3cy1jZXJ0aWZpY2F0ZW1hbmFnZXJcIjtcclxuaW1wb3J0ICogYXMgbG9ncyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWxvZ3NcIjtcclxuaW1wb3J0ICogYXMgc2VjcmV0c21hbmFnZXIgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNlY3JldHNtYW5hZ2VyJ1xyXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcclxuLy8geyBDcmVkZW50aWFscywgRGF0YWJhc2VJbnN0YW5jZSwgRGF0YWJhc2VJbnN0YW5jZUVuZ2luZSwgRGF0YWJhc2VTZWNyZXQsIE15c3FsRW5naW5lVmVyc2lvbiB9XHJcbmltcG9ydCAqIGFzIHJkcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtcmRzJztcclxuXHJcbmltcG9ydCB7IE9yaWdpblByb3RvY29sUG9saWN5IH0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1jbG91ZGZyb250XCI7XHJcbmltcG9ydCB7IHRpbWVTdGFtcCB9IGZyb20gXCJjb25zb2xlXCI7XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIEdlbmVYdXNTZXJ2ZXJsZXNzQW5ndWxhckFwcFByb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xyXG4gIHJlYWRvbmx5IGFwaU5hbWU6IHN0cmluZztcclxuICByZWFkb25seSBhcGlEZXNjcmlwdGlvbj86IHN0cmluZztcclxuICByZWFkb25seSB3ZWJEb21haW5OYW1lPzogc3RyaW5nO1xyXG4gIHJlYWRvbmx5IHN0YWdlTmFtZT86IHN0cmluZztcclxuICByZWFkb25seSB0aW1lb3V0PzogY2RrLkR1cmF0aW9uO1xyXG4gIHJlYWRvbmx5IG1lbW9yeVNpemU/OiBudW1iZXI7XHJcbiAgcmVhZG9ubHkgY2VydGlmaWNhdGVBUk4/OiBzdHJpbmcgfCBudWxsO1xyXG59XHJcblxyXG5jb25zdCBsYW1iZGFIYW5kbGVyTmFtZSA9XHJcbiAgXCJjb20uZ2VuZXh1cy5jbG91ZC5zZXJ2ZXJsZXNzLmF3cy5MYW1iZGFIYW5kbGVyOjpoYW5kbGVSZXF1ZXN0XCI7XHJcbmNvbnN0IGxhbWJkYURlZmF1bHRNZW1vcnlTaXplID0gMTAyNDtcclxuY29uc3QgbGFtYmRhRGVmYXVsdFRpbWVvdXQgPSBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCk7XHJcbmNvbnN0IGRlZmF1bHRMYW1iZGFSdW50aW1lID0gbGFtYmRhLlJ1bnRpbWUuSkFWQV8xMTtcclxuY29uc3QgcmV3cml0ZUVkZ2VMYW1iZGFIYW5kbGVyTmFtZSA9IFwicmV3cml0ZS5oYW5kbGVyXCI7XHJcblxyXG5leHBvcnQgY2xhc3MgR2VuZVh1c1NlcnZlcmxlc3NBbmd1bGFyQXBwIGV4dGVuZHMgQ29uc3RydWN0IHtcclxuICBpc0RldkVudjogYm9vbGVhbiA9IHRydWU7XHJcbiAgdnBjOiBlYzIuVnBjO1xyXG4gIGRiU2VydmVyOiByZHMuRGF0YWJhc2VJbnN0YW5jZTtcclxuICBpYW1Vc2VyOiBpYW0uVXNlcjtcclxuICBEVGlja2V0OiBkeW5hbW9kYi5UYWJsZTtcclxuICBEQ2FjaGU6IGR5bmFtb2RiLlRhYmxlO1xyXG5cclxuICBjb25zdHJ1Y3RvcihcclxuICAgIHNjb3BlOiBDb25zdHJ1Y3QsXHJcbiAgICBpZDogc3RyaW5nLFxyXG4gICAgcHJvcHM6IEdlbmVYdXNTZXJ2ZXJsZXNzQW5ndWxhckFwcFByb3BzXHJcbiAgKSB7XHJcbiAgICBzdXBlcihzY29wZSwgaWQpO1xyXG5cclxuICAgIGNvbnN0IHN0YWNrID0gY2RrLlN0YWNrLm9mKHRoaXMpO1xyXG5cclxuICAgIGNvbnN0IGFwaU5hbWUgPSBwcm9wcz8uYXBpTmFtZSB8fCBcIlwiO1xyXG4gICAgY29uc3Qgc3RhZ2VOYW1lID0gcHJvcHM/LnN0YWdlTmFtZSB8fCBcIlwiO1xyXG5cclxuICAgIGlmIChhcGlOYW1lLmxlbmd0aCA9PSAwKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkFQSSBOYW1lIGNhbm5vdCBiZSBlbXB0eVwiKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoc3RhZ2VOYW1lLmxlbmd0aCA9PSAwKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlN0YWdlIE5hbWUgY2Fubm90IGJlIGVtcHR5XCIpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gVlBDXHJcbiAgICB0aGlzLnZwYyA9IHRoaXMuY3JlYXRlVlBDKCBhcGlOYW1lLCBzdGFnZU5hbWUpOyBcclxuICAgIGNvbnN0IER5bmFtb0dhdGV3YXlFbmRwb2ludCA9IHRoaXMudnBjLmFkZEdhdGV3YXlFbmRwb2ludCgnRHluYW1vLWVuZHBvaW50Jywge1xyXG4gICAgICBzZXJ2aWNlOiBlYzIuR2F0ZXdheVZwY0VuZHBvaW50QXdzU2VydmljZS5EWU5BTU9EQlxyXG4gICAgfSk7XHJcblxyXG4gICAgLy90aGlzLnZwYy5hZGRJbnRlcmZhY2VFbmRwb2ludChgc3N2cGNgLCB7XHJcbiAgICAvLyAgc2VydmljZTogZWMyLkludGVyZmFjZVZwY0VuZHBvaW50QXdzU2VydmljZS5TRUNSRVRTX01BTkFHRVJcclxuICAgIC8vfSk7XHJcbiAgICAvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gUkRTIC0gTXlTUUwgOC4wXHJcbiAgICBjb25zdCBkYnNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgYHJkcy1zZ2AsIHtcclxuICAgICAgdnBjOiB0aGlzLnZwYyxcclxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZVxyXG4gICAgfSk7XHJcbiAgICAvLyBkYnNlY3VyaXR5R3JvdXAuY29ubmVjdGlvbnMuYWxsb3dGcm9tKGFzZ1NHLCBlYzIuUG9ydC50Y3AoMzMwNikpO1xyXG4gICAgZGJzZWN1cml0eUdyb3VwLmNvbm5lY3Rpb25zLmFsbG93RnJvbShkYnNlY3VyaXR5R3JvdXAsIGVjMi5Qb3J0LnRjcCgzMzA2KSk7XHJcbiAgICBpZiAodGhpcy5pc0RldkVudikge1xyXG4gICAgICAvL0FjY2VzcyBmcm9tIE15SVBcclxuICAgICAgZGJzZWN1cml0eUdyb3VwLmNvbm5lY3Rpb25zLmFsbG93RnJvbSggZWMyLlBlZXIuaXB2NCgnMTAwLjEwMC4xMDAuMTAwLzMyJyksIGVjMi5Qb3J0LnRjcFJhbmdlKDEsIDY1NTM1KSk7IFxyXG4gICAgfVxyXG4gICAgdGhpcy5kYlNlcnZlciA9IHRoaXMuY3JlYXRlREIocHJvcHMsIGRic2VjdXJpdHlHcm91cCk7XHJcblxyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBEeW5hbW9cclxuICAgIHRoaXMuY3JlYXRlRHluYW1vKHByb3BzKTtcclxuXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIFNlY3VyaXR5XHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG4gICAgLy8gVXNlciB0byBtYW5hZ2UgdGhlIGFwaW5hbWVcclxuICAgIC8vIFMzIGd4LWRlcGxveSB3aWxsIGJlIHVzZWQgdG8gZGVwbG95IHRoZSBhcHAgdG8gYXdzXHJcbiAgICB0aGlzLmlhbVVzZXIgPSBuZXcgaWFtLlVzZXIodGhpcywgYCR7YXBpTmFtZX0tdXNlcmApO1xyXG4gICAgdGhpcy5pYW1Vc2VyLmFkZFRvUG9saWN5KFxyXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgYWN0aW9uczogW1wiczM6KlwiXSxcclxuICAgICAgICByZXNvdXJjZXM6IFtcImFybjphd3M6czM6OjpneC1kZXBsb3kvKlwiLCBcImFybjphd3M6czM6OjpneC1kZXBsb3kqXCJdLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuICAgIGNvbnN0IGFjY2Vzc0tleSA9IG5ldyBpYW0uQ2ZuQWNjZXNzS2V5KHRoaXMsIGAke2FwaU5hbWV9LWFjY2Vzc2tleWAsIHtcclxuICAgICAgdXNlck5hbWU6IHRoaXMuaWFtVXNlci51c2VyTmFtZSxcclxuICAgIH0pO1xyXG4gICAgdGhpcy5EQ2FjaGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHRoaXMuaWFtVXNlcik7XHJcbiAgICB0aGlzLkRUaWNrZXQuZ3JhbnRSZWFkV3JpdGVEYXRhKCB0aGlzLmlhbVVzZXIpO1xyXG5cclxuICAgIC8vIExhbWJkYSBGdW5jdGlvbnNcclxuICAgIGNvbnN0IGxhbWJkYVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgYGxhbWJkYS1yb2xlYCwge1xyXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uQ29tcG9zaXRlUHJpbmNpcGFsKFxyXG4gICAgICAgIG5ldyBpYW0uU2VydmljZVByaW5jaXBhbChcImFwaWdhdGV3YXkuYW1hem9uYXdzLmNvbVwiKSxcclxuICAgICAgICBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJsYW1iZGEuYW1hem9uYXdzLmNvbVwiKVxyXG4gICAgICApLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJHZW5lWHVzIFNlcnZlcmxlc3MgQXBwbGljYXRpb24gTGFtYmRhIFJvbGVcIixcclxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXHJcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKFxyXG4gICAgICAgICAgXCJzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlXCJcclxuICAgICAgICApLFxyXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZShcclxuICAgICAgICAgIFwic2VydmljZS1yb2xlL0FXU0xhbWJkYVJvbGVcIlxyXG4gICAgICAgICksXHJcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKFxyXG4gICAgICAgICAgXCJzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhVlBDQWNjZXNzRXhlY3V0aW9uUm9sZVwiXHJcbiAgICAgICAgKSxcclxuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoXHJcbiAgICAgICAgICBcInNlcnZpY2Utcm9sZS9BV1NMYW1iZGFTUVNRdWV1ZUV4ZWN1dGlvblJvbGVcIlxyXG4gICAgICAgICksXHJcbiAgICAgIF0sXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gU1FTIFRpY2tldCBRdWV1ZVxyXG4gICAgY29uc3QgdGlja2V0UXVldWUgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsIGB0aWNrZXRxdWV1ZWAsIHtcclxuICAgICAgcXVldWVOYW1lOiBgJHthcGlOYW1lfV8ke3N0YWdlTmFtZX1fdGlja2V0cXVldWVgXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBMYW1iZGEgZm9yIFNRU1xyXG4gICAgY29uc3QgcXVldWVMYW1iZGFGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgYFRpY2tldFByb2Nlc3NgLCB7XHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogYCR7YXBpTmFtZX1fJHtzdGFnZU5hbWV9X1RpY2tldFByb2Nlc3NgLFxyXG4gICAgICBydW50aW1lOiBkZWZhdWx0TGFtYmRhUnVudGltZSxcclxuICAgICAgaGFuZGxlcjogXCJjb20uZ2VuZXh1cy5jbG91ZC5zZXJ2ZXJsZXNzLmF3cy5oYW5kbGVyLkxhbWJkYVNRU0hhbmRsZXI6OmhhbmRsZVJlcXVlc3RcIixcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KF9fZGlybmFtZSArIFwiLy4uLy4uL2Jvb3RzdHJhcFwiKSwgLy9FbXB0eSBzYW1wbGUgcGFja2FnZVxyXG4gICAgICB2cGM6IHRoaXMudnBjLFxyXG4gICAgICAvL2FsbG93UHVibGljU3VibmV0OiB0cnVlLFxyXG4gICAgICByb2xlOiBsYW1iZGFSb2xlLFxyXG4gICAgICB0aW1lb3V0OiBwcm9wcz8udGltZW91dCB8fCBsYW1iZGFEZWZhdWx0VGltZW91dCxcclxuICAgICAgbWVtb3J5U2l6ZTogcHJvcHM/Lm1lbW9yeVNpemUgfHwgbGFtYmRhRGVmYXVsdE1lbW9yeVNpemUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBgJyR7XHJcbiAgICAgICAgcHJvcHM/LmFwaURlc2NyaXB0aW9uIHx8IGFwaU5hbWVcclxuICAgICAgfScgUXVldWUgVGlja2V0IFByb2Nlc3MgTGFtYmRhIGZ1bmN0aW9uYCxcclxuICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXHJcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbZGJzZWN1cml0eUdyb3VwXVxyXG4gICAgfSk7XHJcbiAgICAvLyBcclxuXHJcbiAgICAvLyBMYW1iZGEgcXVldWUgdHJpZ2dlclxyXG4gICAgY29uc3QgZXZlbnRTb3VyY2UgPSBuZXcgbGFtYmRhRXZlbnRTb3VyY2VzLlNxc0V2ZW50U291cmNlKHRpY2tldFF1ZXVlKTtcclxuICAgIHF1ZXVlTGFtYmRhRnVuY3Rpb24uYWRkRXZlbnRTb3VyY2UoZXZlbnRTb3VyY2UpO1xyXG4gICAgdGlja2V0UXVldWUuZ3JhbnRDb25zdW1lTWVzc2FnZXMocXVldWVMYW1iZGFGdW5jdGlvbik7XHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBMYW1iZGEgQ1JPTlxyXG5cclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIEFuZ3VsYXIgQXBwIEhvc3RcclxuICAgIC8qXHJcbiAgICBjb25zdCB3ZWJzaXRlUHVibGljQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCBgJHthcGlOYW1lfS1idWNrZXQtd2ViYCwge1xyXG4gICAgICB3ZWJzaXRlSW5kZXhEb2N1bWVudDogXCJpbmRleC5odG1sXCIsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICB9KTtcclxuICAgIHdlYnNpdGVQdWJsaWNCdWNrZXQuZ3JhbnRQdWJsaWNBY2Nlc3MoKTtcclxuICAgIHdlYnNpdGVQdWJsaWNCdWNrZXQuZ3JhbnRSZWFkV3JpdGUodXNlcik7XHJcbiAgICBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcclxuICAgICAgc3RhdGVtZW50czogW1xyXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICAgIGFjdGlvbnM6IFtcInN0czpBc3N1bWVSb2xlXCJdLFxyXG4gICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICBdLFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vIFN0b3JhZ2VcclxuICAgIGNvbnN0IHN0b3JhZ2VCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsIGAke2FwaU5hbWV9LWJ1Y2tldGAsIHtcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgIH0pO1xyXG4gICAgc3RvcmFnZUJ1Y2tldC5ncmFudFB1dEFjbCh1c2VyKTtcclxuICAgIHN0b3JhZ2VCdWNrZXQuZ3JhbnRSZWFkV3JpdGUodXNlcik7XHJcbiAgICBzdG9yYWdlQnVja2V0LmdyYW50UHVibGljQWNjZXNzKCk7XHJcbiAgICAqL1xyXG5cclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBCYWNrZW5kIHNlcnZpY2VzXHJcbiAgICAvKlxyXG4gICAgY29uc3QgYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCBgJHthcGlOYW1lfS1hcGlnd2AsIHtcclxuICAgICAgZGVzY3JpcHRpb246IGAke2FwaU5hbWV9IEFQSUdhdGV3YXkgRW5kcG9pbnRgLFxyXG4gICAgICByZXN0QXBpTmFtZTogYXBpTmFtZSxcclxuICAgICAgZGVwbG95T3B0aW9uczoge1xyXG4gICAgICAgIHN0YWdlTmFtZTogc3RhZ2VOYW1lLFxyXG4gICAgICB9LFxyXG4gICAgICBkZWZhdWx0Q29yc1ByZWZsaWdodE9wdGlvbnM6IHtcclxuICAgICAgICBhbGxvd0hlYWRlcnM6IFtcclxuICAgICAgICAgIFwiQ29udGVudC1UeXBlXCIsXHJcbiAgICAgICAgICBcIlgtQW16LURhdGVcIixcclxuICAgICAgICAgIFwiQXV0aG9yaXphdGlvblwiLFxyXG4gICAgICAgICAgXCJYLUFwaS1LZXlcIixcclxuICAgICAgICBdLFxyXG4gICAgICAgIGFsbG93TWV0aG9kczogW1wiT1BUSU9OU1wiLCBcIkdFVFwiLCBcIlBPU1RcIiwgXCJQVVRcIiwgXCJQQVRDSFwiLCBcIkRFTEVURVwiXSxcclxuICAgICAgICBhbGxvd0NyZWRlbnRpYWxzOiB0cnVlLFxyXG4gICAgICAgIGFsbG93T3JpZ2luczogW1wiKlwiXSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGxhbWJkYUZ1bmN0aW9uTmFtZSA9IGAke2FwaU5hbWV9XyR7c3RhZ2VOYW1lfWA7XHJcbiAgICBjb25zdCBsYW1iZGFGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgYCR7YXBpTmFtZX0tZnVuY3Rpb25gLCB7XHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogbGFtYmRhRnVuY3Rpb25OYW1lLFxyXG4gICAgICBydW50aW1lOiBkZWZhdWx0TGFtYmRhUnVudGltZSxcclxuICAgICAgaGFuZGxlcjogbGFtYmRhSGFuZGxlck5hbWUsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChfX2Rpcm5hbWUgKyBcIi8uLi8uLi9ib290c3RyYXBcIiksIC8vRW1wdHkgc2FtcGxlIHBhY2thZ2VcclxuICAgICAgLy92cGM6IHRhcmdldFZwYyxcclxuICAgICAgLy9hbGxvd1B1YmxpY1N1Ym5ldDogdHJ1ZSxcclxuICAgICAgcm9sZTogbGFtYmRhUm9sZSxcclxuICAgICAgdGltZW91dDogcHJvcHM/LnRpbWVvdXQgfHwgbGFtYmRhRGVmYXVsdFRpbWVvdXQsXHJcbiAgICAgIG1lbW9yeVNpemU6IHByb3BzPy5tZW1vcnlTaXplIHx8IGxhbWJkYURlZmF1bHRNZW1vcnlTaXplLFxyXG4gICAgICBkZXNjcmlwdGlvbjogYCcke1xyXG4gICAgICAgIHByb3BzPy5hcGlEZXNjcmlwdGlvbiB8fCBhcGlOYW1lXHJcbiAgICAgIH0nIFNlcnZlcmxlc3MgTGFtYmRhIGZ1bmN0aW9uYCxcclxuICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXHJcbiAgICB9KTtcclxuICAgIHRoaXMuRENhY2hlLmdyYW50UmVhZFdyaXRlRGF0YShsYW1iZGFGdW5jdGlvbik7XHJcbiAgICB0aGlzLkRUaWNrZXQuZ3JhbnRSZWFkV3JpdGVEYXRhKGxhbWJkYUZ1bmN0aW9uKTtcclxuICAgIGxhbWJkYUZ1bmN0aW9uLmdyYW50SW52b2tlKHVzZXIpO1xyXG5cclxuICAgIHVzZXIuYWRkVG9Qb2xpY3koXHJcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICBhY3Rpb25zOiBbXCJsYW1iZGE6KlwiXSxcclxuICAgICAgICByZXNvdXJjZXM6IFtcclxuICAgICAgICAgIGBhcm46YXdzOmxhbWJkYToke3N0YWNrLnJlZ2lvbn06JHtzdGFjay5hY2NvdW50fTpmdW5jdGlvbjoke2FwaU5hbWV9XypgLFxyXG4gICAgICAgIF0sXHJcbiAgICAgIH0pXHJcbiAgICApO1xyXG5cclxuICAgIHVzZXIuYWRkVG9Qb2xpY3koXHJcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICBhY3Rpb25zOiBbXCJhcGlnYXRld2F5OipcIl0sXHJcbiAgICAgICAgcmVzb3VyY2VzOiBbXHJcbiAgICAgICAgICBgYXJuOmF3czphcGlnYXRld2F5OiR7c3RhY2sucmVnaW9ufTo6L3Jlc3RhcGlzLyR7YXBpLnJlc3RBcGlJZH0qYCxcclxuICAgICAgICBdLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuXHJcbiAgICB1c2VyLmFkZFRvUG9saWN5KFxyXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgYWN0aW9uczogW1wiYXBpZ2F0ZXdheToqXCJdLFxyXG4gICAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmFwaWdhdGV3YXk6JHtzdGFjay5yZWdpb259OjovcmVzdGFwaXMqYF0sXHJcbiAgICAgIH0pXHJcbiAgICApO1xyXG5cclxuICAgIHVzZXIuYWRkVG9Qb2xpY3koXHJcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgICBhY3Rpb25zOiBbXCJpYW06UGFzc1JvbGVcIl0sXHJcbiAgICAgICAgcmVzb3VyY2VzOiBbbGFtYmRhUm9sZS5yb2xlQXJuXSxcclxuICAgICAgfSlcclxuICAgICk7XHJcblxyXG4gICAgY29uc3QgcmV3cml0ZUVkZ2VGdW5jdGlvblJlc3BvbnNlID1cclxuICAgICAgbmV3IGNsb3VkZnJvbnQuZXhwZXJpbWVudGFsLkVkZ2VGdW5jdGlvbih0aGlzLCBgJHthcGlOYW1lfUVkZ2VMYW1iZGFgLCB7XHJcbiAgICAgICAgZnVuY3Rpb25OYW1lOiBgJHthcGlOYW1lfS0ke3N0YWdlTmFtZX0tRWRnZUxhbWJkYWAsXHJcbiAgICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE0X1gsXHJcbiAgICAgICAgaGFuZGxlcjogcmV3cml0ZUVkZ2VMYW1iZGFIYW5kbGVyTmFtZSxcclxuICAgICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoXCJsYW1iZGFcIiksXHJcbiAgICAgICAgZGVzY3JpcHRpb246IGBHZW5lWHVzIEFuZ3VsYXIgUmV3cml0ZSBMYW1iZGEgZm9yIENsb3VkZnJvbnRgLFxyXG4gICAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLkZJVkVfREFZUyAgICAgICAgXHJcbiAgICAgIH0pO1xyXG5cclxuICAgIHJld3JpdGVFZGdlRnVuY3Rpb25SZXNwb25zZS5ncmFudEludm9rZSh1c2VyKTtcclxuICAgIHJld3JpdGVFZGdlRnVuY3Rpb25SZXNwb25zZS5hZGRBbGlhcyhcImxpdmVcIiwge30pO1xyXG5cclxuICAgIGNvbnN0IG9yaWdpblBvbGljeSA9IG5ldyBjbG91ZGZyb250Lk9yaWdpblJlcXVlc3RQb2xpY3koXHJcbiAgICAgIHRoaXMsXHJcbiAgICAgIGAke2FwaU5hbWV9SHR0cE9yaWdpblBvbGljeWAsXHJcbiAgICAgIHtcclxuICAgICAgICAvL29yaWdpblJlcXVlc3RQb2xpY3lOYW1lOiBcIkdYLUhUVFAtT3JpZ2luLVBvbGljeVwiLFxyXG4gICAgICAgIGNvbW1lbnQ6IGAke2FwaU5hbWV9IE9yaWdpbiBIdHRwIFBvbGljeWAsXHJcbiAgICAgICAgaGVhZGVyQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVIZWFkZXJCZWhhdmlvci5hbGxvd0xpc3QoXHJcbiAgICAgICAgICBcIkFjY2VwdFwiLFxyXG4gICAgICAgICAgXCJBY2NlcHQtQ2hhcnNldFwiLFxyXG4gICAgICAgICAgXCJBY2NlcHQtTGFuZ3VhZ2VcIixcclxuICAgICAgICAgIFwiQ29udGVudC1UeXBlXCIsXHJcbiAgICAgICAgICBcIkd4VFpPZmZzZXRcIixcclxuICAgICAgICAgIFwiRGV2aWNlSWRcIixcclxuICAgICAgICAgIFwiRGV2aWNlVHlwZVwiLFxyXG4gICAgICAgICAgXCJSZWZlcmVyXCJcclxuICAgICAgICApLFxyXG4gICAgICAgIHF1ZXJ5U3RyaW5nQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVRdWVyeVN0cmluZ0JlaGF2aW9yLmFsbCgpLFxyXG4gICAgICAgIGNvb2tpZUJlaGF2aW9yOiBjbG91ZGZyb250LkNhY2hlQ29va2llQmVoYXZpb3IuYWxsKCksXHJcbiAgICAgIH1cclxuICAgICk7XHJcblxyXG4gICAgY29uc3QgY2VydGlmaWNhdGUgPSBwcm9wcz8uY2VydGlmaWNhdGVBUk5cclxuICAgICAgPyBhY20uQ2VydGlmaWNhdGUuZnJvbUNlcnRpZmljYXRlQXJuKFxyXG4gICAgICAgICAgdGhpcyxcclxuICAgICAgICAgIFwiQ2xvdWRmcm9udCBDZXJ0aWZpY2F0ZVwiLFxyXG4gICAgICAgICAgcHJvcHM/LmNlcnRpZmljYXRlQVJOXHJcbiAgICAgICAgKVxyXG4gICAgICA6IHVuZGVmaW5lZDtcclxuXHJcbiAgICBjb25zdCB3ZWJEaXN0cmlidXRpb24gPSBuZXcgY2xvdWRmcm9udC5EaXN0cmlidXRpb24oXHJcbiAgICAgIHRoaXMsXHJcbiAgICAgIGAke2FwaU5hbWV9LWNkbmAsXHJcbiAgICAgIHtcclxuICAgICAgICBjb21tZW50OiBgJHthcGlOYW1lfSBDbG91ZGZyb250IERpc3RyaWJ1dGlvbmAsXHJcbiAgICAgICAgZG9tYWluTmFtZXM6IHByb3BzPy53ZWJEb21haW5OYW1lID8gW3Byb3BzPy53ZWJEb21haW5OYW1lXSA6IHVuZGVmaW5lZCxcclxuICAgICAgICBjZXJ0aWZpY2F0ZTogY2VydGlmaWNhdGUsXHJcbiAgICAgICAgZGVmYXVsdEJlaGF2aW9yOiB7XHJcbiAgICAgICAgICBvcmlnaW46IG5ldyBvcmlnaW5zLlMzT3JpZ2luKHdlYnNpdGVQdWJsaWNCdWNrZXQpLFxyXG4gICAgICAgICAgY2FjaGVQb2xpY3k6IGNsb3VkZnJvbnQuQ2FjaGVQb2xpY3kuQ0FDSElOR19PUFRJTUlaRUQsXHJcbiAgICAgICAgICBvcmlnaW5SZXF1ZXN0UG9saWN5OiBjbG91ZGZyb250Lk9yaWdpblJlcXVlc3RQb2xpY3kuQ09SU19TM19PUklHSU4sXHJcbiAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTpcclxuICAgICAgICAgICAgY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcclxuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0FMTCxcclxuICAgICAgICAgIGVkZ2VMYW1iZGFzOiBbXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICBmdW5jdGlvblZlcnNpb246IHJld3JpdGVFZGdlRnVuY3Rpb25SZXNwb25zZSxcclxuICAgICAgICAgICAgICBldmVudFR5cGU6IGNsb3VkZnJvbnQuTGFtYmRhRWRnZUV2ZW50VHlwZS5PUklHSU5fUkVTUE9OU0UsXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIF0sXHJcbiAgICAgICAgfSxcclxuICAgICAgfVxyXG4gICAgKTtcclxuXHJcbiAgICBjb25zdCBhcGlEb21haW5OYW1lID0gYCR7YXBpLnJlc3RBcGlJZH0uZXhlY3V0ZS1hcGkuJHtzdGFjay5yZWdpb259LmFtYXpvbmF3cy5jb21gO1xyXG5cclxuICAgIGNvbnN0IGFwaUdhdGV3YXlPcmlnaW4gPSBuZXcgb3JpZ2lucy5IdHRwT3JpZ2luKGFwaURvbWFpbk5hbWUsIHtcclxuICAgICAgcHJvdG9jb2xQb2xpY3k6IE9yaWdpblByb3RvY29sUG9saWN5LkhUVFBTX09OTFksXHJcbiAgICB9KTtcclxuXHJcbiAgICB3ZWJEaXN0cmlidXRpb24ubm9kZS5hZGREZXBlbmRlbmN5KGFwaSk7XHJcblxyXG4gICAgd2ViRGlzdHJpYnV0aW9uLmFkZEJlaGF2aW9yKGAvJHtzdGFnZU5hbWV9LypgLCBhcGlHYXRld2F5T3JpZ2luLCB7XHJcbiAgICAgIGNvbXByZXNzOiB0cnVlLFxyXG4gICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5BTExPV19BTEwsXHJcbiAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0FMTCxcclxuICAgICAgY2FjaGVQb2xpY3k6IGNsb3VkZnJvbnQuQ2FjaGVQb2xpY3kuQ0FDSElOR19ESVNBQkxFRCxcclxuICAgICAgb3JpZ2luUmVxdWVzdFBvbGljeTogb3JpZ2luUG9saWN5LFxyXG4gICAgfSk7XHJcbiAgICAqL1xyXG4gICAgXHJcbiAgICAvLyBHZW5lcmljXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkFwaU5hbWVcIiwge1xyXG4gICAgICB2YWx1ZTogYXBpTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiQXBwbGljYXRpb24gTmFtZSAoQVBJIE5hbWUpXCIsXHJcbiAgICB9KTtcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiU3RhZ2VOYW1lXCIsIHtcclxuICAgICAgdmFsdWU6IHN0YWdlTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiU3RhZ2UgTmFtZVwiLFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vIFJEUyBNeVNRTFxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJEQiBFbmRQb2ludFwiLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLmRiU2VydmVyLmRiSW5zdGFuY2VFbmRwb2ludEFkZHJlc3MsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIlJEUyBNeVNRTCBFbmRwb2ludFwiLFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEQiBTZWNyZXROYW1lJywge1xyXG4gICAgICB2YWx1ZTogdGhpcy5kYlNlcnZlci5zZWNyZXQ/LnNlY3JldE5hbWUhLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gRHluYW1vXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRHluYW1vIERDYWNoZSBUYWJsZU5hbWUnLCB7IHZhbHVlOiB0aGlzLkRDYWNoZS50YWJsZU5hbWUgfSk7XHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRHluYW1vIERUaWNrZXQgVGFibGVOYW1lJywgeyB2YWx1ZTogdGhpcy5EVGlja2V0LnRhYmxlTmFtZSB9KTtcclxuXHJcbiAgICAvKlxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJXZWJVUkxcIiwge1xyXG4gICAgICB2YWx1ZTogYGh0dHBzOi8vJHt3ZWJEaXN0cmlidXRpb24uZG9tYWluTmFtZX1gLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJGcm9udGVuZCBXZWJzaXRlIFVSTFwiLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJBcGlVUkxcIiwge1xyXG4gICAgICB2YWx1ZTogYGh0dHBzOi8vJHt3ZWJEaXN0cmlidXRpb24uZG9tYWluTmFtZX0vJHtzdGFnZU5hbWV9L2AsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIlNlcnZpY2VzIEFQSSBVUkwgKFNlcnZpY2VzIFVSTClcIixcclxuICAgIH0pO1xyXG4gICAgKi9cclxuICAgIFxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJJQU1Sb2xlQVJOXCIsIHtcclxuICAgICAgdmFsdWU6IGxhbWJkYVJvbGUucm9sZUFybixcclxuICAgICAgZGVzY3JpcHRpb246IFwiSUFNIFJvbGUgQVJOXCIsXHJcbiAgICB9KTtcclxuICAgIC8qXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIldlYnNpdGVCdWNrZXRcIiwge1xyXG4gICAgICB2YWx1ZTogd2Vic2l0ZVB1YmxpY0J1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJCdWNrZXQgTmFtZSBmb3IgQW5ndWxhciBXZWJTaXRlIERlcGxveW1lbnRcIixcclxuICAgIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJTdG9yYWdlQnVja2V0XCIsIHtcclxuICAgICAgdmFsdWU6IHN0b3JhZ2VCdWNrZXQuYnVja2V0TmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiQnVja2V0IGZvciBTdG9yYWdlIFNlcnZpY2VcIixcclxuICAgIH0pO1xyXG4gICAgKi9cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiQWNjZXNzS2V5XCIsIHtcclxuICAgICAgdmFsdWU6IGFjY2Vzc0tleS5yZWYsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkFjY2VzcyBLZXlcIixcclxuICAgIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJBY2Nlc3NTZWNyZXRLZXlcIiwge1xyXG4gICAgICB2YWx1ZTogYWNjZXNzS2V5LmF0dHJTZWNyZXRBY2Nlc3NLZXksXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkFjY2VzcyBTZWNyZXQgS2V5XCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIlNRUyBUaWNrZXQgVXJsXCIsIHtcclxuICAgICAgdmFsdWU6IHRpY2tldFF1ZXVlLnF1ZXVlVXJsLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJTUVMgVGlja2V0IFVybFwiLFxyXG4gICAgfSk7XHJcbiAgfVxyXG4gIHByaXZhdGUgY3JlYXRlRHluYW1vKHByb3BzOiBHZW5lWHVzU2VydmVybGVzc0FuZ3VsYXJBcHBQcm9wcyl7XHJcbiAgICBjb25zdCBhcGlOYW1lID0gcHJvcHM/LmFwaU5hbWUgfHwgXCJcIjtcclxuICAgIGNvbnN0IHN0YWdlTmFtZSA9IHByb3BzPy5zdGFnZU5hbWUgfHwgXCJcIjtcclxuXHJcbiAgICAvLyBUT0RPOiBWZXIgc2kgZW4gYWxnw7puIG1vbWVudG8gR3ggaW1wbGVtZW50YSBlbCBjYW1iaW8gZGUgbm9tYnJlIGVuIHRhYmxhcyBlbiBkYXRhdmlld3NcclxuICAgIHRoaXMuRENhY2hlID0gbmV3IGR5bmFtb2RiLlRhYmxlKCB0aGlzLCBgRENhY2hlYCwge1xyXG4gICAgICB0YWJsZU5hbWU6IGBEQ2FjaGVgLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ0RDYWNoZUlkJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWVxyXG4gICAgfSk7XHJcbiAgICB0aGlzLkRUaWNrZXQgPSBuZXcgZHluYW1vZGIuVGFibGUoIHRoaXMsIGBEVGlja2V0YCwge1xyXG4gICAgICB0YWJsZU5hbWU6IGBEVGlja2V0YCxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdEVGlja2V0SWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICdEVGlja2V0Q29kZScsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuTlVNQkVSfSxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWVxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNyZWF0ZURCKHByb3BzOiBHZW5lWHVzU2VydmVybGVzc0FuZ3VsYXJBcHBQcm9wcywgc2c6IGVjMi5TZWN1cml0eUdyb3VwKTogcmRzLkRhdGFiYXNlSW5zdGFuY2V7XHJcbiAgICBjb25zdCBhcGlOYW1lID0gcHJvcHM/LmFwaU5hbWUgfHwgXCJcIjtcclxuICAgIGNvbnN0IHN0YWdlTmFtZSA9IHByb3BzPy5zdGFnZU5hbWUgfHwgXCJcIjtcclxuXHJcbiAgICBjb25zdCBpbnN0YW5jZUlkZW50aWZpZXIgPSBgJHthcGlOYW1lfS0ke3N0YWdlTmFtZX0tZGJgO1xyXG5cclxuICAgIC8vQWxsb3cgZnJvbSBDb2RlQnVpbGRcclxuICAgIC8vIGRic2VjdXJpdHlHcm91cC5jb25uZWN0aW9ucy5hbGxvd0Zyb20oUGVlci5pcHY0KCczNC4yMjguNC4yMDgvMjgnKSwgZWMyLlBvcnQudGNwKDMzMDYpKTsgLy9BY2Nlc3MgZnJvbSBHZW5lWHVzXHJcblxyXG4gICAgcmV0dXJuIG5ldyByZHMuRGF0YWJhc2VJbnN0YW5jZSh0aGlzLCBgJHthcGlOYW1lfS1kYmAsIHtcclxuICAgICAgcHVibGljbHlBY2Nlc3NpYmxlOiB0aGlzLmlzRGV2RW52LFxyXG4gICAgICB2cGNTdWJuZXRzOiB7XHJcbiAgICAgICAgb25lUGVyQXo6IHRydWUsXHJcbiAgICAgICAgc3VibmV0VHlwZTogdGhpcy5pc0RldkVudiA/IGVjMi5TdWJuZXRUeXBlLlBVQkxJQyA6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9OQVRcclxuICAgICAgfSxcclxuICAgICAgY3JlZGVudGlhbHM6IHJkcy5DcmVkZW50aWFscy5mcm9tR2VuZXJhdGVkU2VjcmV0KCdkYmFkbWluJyksXHJcbiAgICAgIHZwYzogdGhpcy52cGMsXHJcbiAgICAgIHBvcnQ6IDMzMDYsXHJcbiAgICAgIGRhdGFiYXNlTmFtZTogJ2Zlc3RpdmFsdGlja2V0cycsXHJcbiAgICAgIGFsbG9jYXRlZFN0b3JhZ2U6IDIwLFxyXG4gICAgICBpbnN0YW5jZUlkZW50aWZpZXIsXHJcbiAgICAgIGVuZ2luZTogcmRzLkRhdGFiYXNlSW5zdGFuY2VFbmdpbmUubXlzcWwoe1xyXG4gICAgICAgIHZlcnNpb246IHJkcy5NeXNxbEVuZ2luZVZlcnNpb24uVkVSXzhfMFxyXG4gICAgICB9KSxcclxuICAgICAgc2VjdXJpdHlHcm91cHM6IFtzZ10sXHJcbiAgICAgIGluc3RhbmNlVHlwZTogZWMyLkluc3RhbmNlVHlwZS5vZihlYzIuSW5zdGFuY2VDbGFzcy5UNEcsIGVjMi5JbnN0YW5jZVNpemUuTUlDUk8pLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiB0aGlzLmlzRGV2RW52ID8gY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSA6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTlxyXG4gICAgfSlcclxuICAgIFxyXG4gICAgLy8gcG90ZW50aWFsbHkgYWxsb3cgY29ubmVjdGlvbnMgdG8gdGhlIFJEUyBpbnN0YW5jZS4uLlxyXG4gICAgLy8gZGJTZXJ2ZXIuY29ubmVjdGlvbnMuYWxsb3dGcm9tIC4uLlxyXG4gIH1cclxuICBwcml2YXRlIGNyZWF0ZVZQQyggYXBpTmFtZTogc3RyaW5nLCBzdGFnZU5hbWU6IHN0cmluZyk6IGVjMi5WcGMge1xyXG4gICAgLypcclxuICAgICAgICBuZXcgVnBjKHRoaXMsIGAke2FwaU5hbWV9LXZwY2AsIHtcclxuICAgICAgdnBjTmFtZTogYCR7YXBpTmFtZX0tJHtzdGFnZU5hbWV9LXZwY2AsXHJcbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246IFt7XHJcbiAgICAgICAgY2lkck1hc2s6IDI0LFxyXG4gICAgICAgIG5hbWU6ICdwcml2YXRlJyxcclxuICAgICAgICBzdWJuZXRUeXBlOiBTdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9OQVQsXHJcbiAgICAgIH0sXHJcbiAgICAgIHtcclxuICAgICAgICBjaWRyTWFzazogMjgsXHJcbiAgICAgICAgbmFtZTogJ3JkcycsXHJcbiAgICAgICAgc3VibmV0VHlwZTogU3VibmV0VHlwZS5QUklWQVRFX0lTT0xBVEVELFxyXG4gICAgICB9LFxyXG4gICAgICB7XHJcbiAgICAgICAgY2lkck1hc2s6IDI0LFxyXG4gICAgICAgIG5hbWU6ICdwdWJsaWMnLFxyXG4gICAgICAgIHN1Ym5ldFR5cGU6IFN1Ym5ldFR5cGUuUFVCTElDLFxyXG4gICAgICB9XHJcbiAgICAgIF1cclxuICAgIH0pXHJcbiAgICAqL1xyXG5cclxuLypcclxuICAgICAgICBcclxuKi9cclxuXHJcbiAgICByZXR1cm4gbmV3IGVjMi5WcGModGhpcywgYHZwY2AsIHtcclxuICAgICAgdnBjTmFtZTogYCR7YXBpTmFtZX0tJHtzdGFnZU5hbWV9LXZwY2AsXHJcbiAgICAgIHN1Ym5ldENvbmZpZ3VyYXRpb246IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICBjaWRyTWFzazogMjQsXHJcbiAgICAgICAgICBuYW1lOiAncHVibGljJyxcclxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBVQkxJQyxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcclxuICAgICAgICAgIG5hbWU6ICdwcml2YXRlX2lzb2xhdGVkJyxcclxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9OQVQsXHJcbiAgICAgICAgfVxyXG4gICAgICBdLFxyXG4gICAgICBtYXhBenM6IDJcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbn1cclxuIl19