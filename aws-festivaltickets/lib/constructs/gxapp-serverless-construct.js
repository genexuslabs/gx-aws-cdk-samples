"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeneXusServerlessAngularApp = void 0;
const apigateway = require("aws-cdk-lib/aws-apigateway");
const cdk = require("aws-cdk-lib");
const aws_events_1 = require("aws-cdk-lib/aws-events");
const aws_events_targets_1 = require("aws-cdk-lib/aws-events-targets");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const sqs = require("aws-cdk-lib/aws-sqs");
const lambda = require("aws-cdk-lib/aws-lambda");
const ec2 = require("aws-cdk-lib/aws-ec2");
const lambdaEventSources = require("aws-cdk-lib/aws-lambda-event-sources");
const s3 = require("aws-cdk-lib/aws-s3");
const iam = require("aws-cdk-lib/aws-iam");
const cloudfront = require("aws-cdk-lib/aws-cloudfront");
const origins = require("aws-cdk-lib/aws-cloudfront-origins");
const acm = require("aws-cdk-lib/aws-certificatemanager");
const logs = require("aws-cdk-lib/aws-logs");
const secretsmanager = require("aws-cdk-lib/aws-secretsmanager");
const constructs_1 = require("constructs");
// { Credentials, DatabaseInstance, DatabaseInstanceEngine, DatabaseSecret, MysqlEngineVersion }
const rds = require("aws-cdk-lib/aws-rds");
const aws_cloudfront_1 = require("aws-cdk-lib/aws-cloudfront");
const lambdaHandlerName = "com.genexus.cloud.serverless.aws.LambdaHandler::handleRequest";
const lambdaDefaultMemorySize = 1024;
const lambdaDefaultTimeout = cdk.Duration.seconds(30);
const defaultLambdaRuntime = lambda.Runtime.JAVA_11;
const rewriteEdgeLambdaHandlerName = "rewrite.handler";
class GeneXusServerlessAngularApp extends constructs_1.Construct {
    constructor(scope, id, props) {
        var _a, _b;
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
        // Generic Policies
        this.iamUser.addToPolicy(new iam.PolicyStatement({
            actions: ["s3:*"],
            resources: ["arn:aws:s3:::gx-deploy/*", "arn:aws:s3:::gx-deploy*"],
        }));
        // Grant access to all application lambda functions
        this.iamUser.addToPolicy(new iam.PolicyStatement({
            actions: ["lambda:*"],
            resources: [
                `arn:aws:lambda:${stack.region}:${stack.account}:function:${apiName}_*`,
            ],
        }));
        // Maximum policy size of 2048 bytes exceeded for user
        const festGroup = new iam.Group(this, 'festival-group-id', {
            groupName: `${apiName}_${stageName}_festgroup`
        });
        festGroup.addUser(this.iamUser);
        const accessKey = new iam.CfnAccessKey(this, `${apiName}-accesskey`, {
            userName: this.iamUser.userName,
        });
        this.DCache.grantReadWriteData(festGroup);
        this.DTicket.grantReadWriteData(festGroup);
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
        // Some queue permissions
        ticketQueue.grantConsumeMessages(queueLambdaFunction);
        ticketQueue.grantSendMessages(festGroup);
        // ------------------------------------------------------
        // Lambda CRON
        const cronLambdaFunction = new lambda.Function(this, `CronLambda`, {
            functionName: `${apiName}_${stageName}_Cron`,
            runtime: defaultLambdaRuntime,
            handler: "com.genexus.cloud.serverless.aws.handler.LambdaEventBridgeHandler::handleRequest",
            code: lambda.Code.fromAsset(__dirname + "/../../bootstrap"),
            vpc: this.vpc,
            //allowPublicSubnet: true,
            role: lambdaRole,
            timeout: (props === null || props === void 0 ? void 0 : props.timeout) || lambdaDefaultTimeout,
            memorySize: (props === null || props === void 0 ? void 0 : props.memorySize) || lambdaDefaultMemorySize,
            description: `'${(props === null || props === void 0 ? void 0 : props.apiDescription) || apiName}' Cron Process Lambda function`,
            logRetention: logs.RetentionDays.ONE_WEEK,
            securityGroups: [dbsecurityGroup]
        });
        //EventBridge rule which runs every five minutes
        const cronRule = new aws_events_1.Rule(this, 'CronRule', {
            schedule: aws_events_1.Schedule.expression('cron(0/10 * * * ? *)')
        });
        cronRule.addTarget(new aws_events_targets_1.LambdaFunction(cronLambdaFunction));
        // -------------------------------------------------------------
        // -------------------------------------------------------------
        // Angular App Host
        // Maximum policy size of 2048 bytes exceeded for user
        const appGroup = new iam.Group(this, 'app-group-id', {
            groupName: `${apiName}_${stageName}_appgroup`
        });
        appGroup.addUser(this.iamUser);
        const websitePublicBucket = new s3.Bucket(this, `${apiName}-bucket-web`, {
            websiteIndexDocument: "index.html",
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        websitePublicBucket.grantPublicAccess();
        websitePublicBucket.grantReadWrite(appGroup);
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
        storageBucket.grantPutAcl(appGroup);
        storageBucket.grantReadWrite(appGroup);
        storageBucket.grantPublicAccess();
        // -----------------------------
        // Backend services
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
            environment: {
                region: cdk.Stack.of(this).region,
                GX_FESTIVALTICKETS_QUEUEURL: ticketQueue.queueUrl,
            },
            functionName: lambdaFunctionName,
            runtime: defaultLambdaRuntime,
            handler: lambdaHandlerName,
            code: lambda.Code.fromAsset(__dirname + "/../../bootstrap"),
            vpc: this.vpc,
            //allowPublicSubnet: true,
            role: lambdaRole,
            timeout: (props === null || props === void 0 ? void 0 : props.timeout) || lambdaDefaultTimeout,
            memorySize: (props === null || props === void 0 ? void 0 : props.memorySize) || lambdaDefaultMemorySize,
            description: `'${(props === null || props === void 0 ? void 0 : props.apiDescription) || apiName}' Serverless Lambda function`,
            logRetention: logs.RetentionDays.ONE_WEEK,
        });
        this.DCache.grantReadWriteData(lambdaFunction);
        this.DTicket.grantReadWriteData(lambdaFunction);
        lambdaFunction.grantInvoke(appGroup);
        this.iamUser.addToPolicy(new iam.PolicyStatement({
            actions: ["apigateway:*"],
            resources: [
                `arn:aws:apigateway:${stack.region}::/restapis/${api.restApiId}*`,
            ],
        }));
        this.iamUser.addToPolicy(new iam.PolicyStatement({
            actions: ["apigateway:*"],
            resources: [`arn:aws:apigateway:${stack.region}::/restapis*`],
        }));
        this.iamUser.addToPolicy(new iam.PolicyStatement({
            actions: ["iam:PassRole"],
            resources: [lambdaRole.roleArn],
        }));
        const rewriteEdgeFunctionResponse = new cloudfront.experimental.EdgeFunction(this, `${apiName}EdgeLambda`, {
            functionName: `${apiName}-${stageName}-EdgeLambda`,
            runtime: lambda.Runtime.NODEJS_14_X,
            handler: rewriteEdgeLambdaHandlerName,
            code: lambda.Code.fromAsset("lambda"),
            description: `GeneXus Angular Rewrite Lambda for Cloudfront`,
            logRetention: logs.RetentionDays.FIVE_DAYS
        });
        rewriteEdgeFunctionResponse.grantInvoke(appGroup);
        rewriteEdgeFunctionResponse.addAlias("live", {});
        const originPolicy = new cloudfront.OriginRequestPolicy(this, `${apiName}HttpOriginPolicy`, {
            //originRequestPolicyName: "GX-HTTP-Origin-Policy",
            comment: `${apiName} Origin Http Policy`,
            headerBehavior: cloudfront.CacheHeaderBehavior.allowList("Accept", "Accept-Charset", "Accept-Language", "Content-Type", "GxTZOffset", "DeviceId", "DeviceType", "Referer"),
            queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
            cookieBehavior: cloudfront.CacheCookieBehavior.all(),
        });
        const certificate = (props === null || props === void 0 ? void 0 : props.certificateARN)
            ? acm.Certificate.fromCertificateArn(this, "Cloudfront Certificate", props === null || props === void 0 ? void 0 : props.certificateARN)
            : undefined;
        const webDistribution = new cloudfront.Distribution(this, `${apiName}-cdn`, {
            comment: `${apiName} Cloudfront Distribution`,
            domainNames: (props === null || props === void 0 ? void 0 : props.webDomainName) ? [props === null || props === void 0 ? void 0 : props.webDomainName] : undefined,
            certificate: certificate,
            defaultBehavior: {
                origin: new origins.S3Origin(websitePublicBucket),
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                edgeLambdas: [
                    {
                        functionVersion: rewriteEdgeFunctionResponse,
                        eventType: cloudfront.LambdaEdgeEventType.ORIGIN_RESPONSE,
                    }
                ],
            },
        });
        const apiDomainName = `${api.restApiId}.execute-api.${stack.region}.amazonaws.com`;
        const apiGatewayOrigin = new origins.HttpOrigin(apiDomainName, {
            protocolPolicy: aws_cloudfront_1.OriginProtocolPolicy.HTTPS_ONLY,
        });
        webDistribution.node.addDependency(api);
        webDistribution.addBehavior(`/${stageName}/*`, apiGatewayOrigin, {
            compress: true,
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.ALLOW_ALL,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
            originRequestPolicy: originPolicy,
        });
        new cdk.CfnOutput(this, "WebURL", {
            value: `https://${webDistribution.domainName}`,
            description: "Frontend Website URL",
        });
        new cdk.CfnOutput(this, "ApiURL", {
            value: `https://${webDistribution.domainName}/${stageName}/`,
            description: "Services API URL (Services URL)",
        });
        new cdk.CfnOutput(this, "WebsiteBucket", {
            value: websitePublicBucket.bucketName,
            description: "Bucket Name for Angular WebSite Deployment",
        });
        new cdk.CfnOutput(this, "StorageBucket", {
            value: storageBucket.bucketName,
            description: "Bucket for Storage Service",
        });
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
        new cdk.CfnOutput(this, "DBEndPoint", {
            value: this.dbServer.dbInstanceEndpointAddress,
            description: "RDS MySQL Endpoint",
        });
        new cdk.CfnOutput(this, 'DBSecretName', {
            value: (_a = this.dbServer.secret) === null || _a === void 0 ? void 0 : _a.secretName,
            description: "RDS MySQL Secret Name",
        });
        // Get access to the secret object
        const dbPasswordSecret = secretsmanager.Secret.fromSecretNameV2(this, 'db-pwd-id', (_b = this.dbServer.secret) === null || _b === void 0 ? void 0 : _b.secretName);
        // Dynamo
        new cdk.CfnOutput(this, 'DynamoDCacheTableName', { value: this.DCache.tableName });
        new cdk.CfnOutput(this, 'DynamoDTicketTableName', { value: this.DTicket.tableName });
        new cdk.CfnOutput(this, "IAMRoleARN", {
            value: lambdaRole.roleArn,
            description: "IAM Role ARN",
        });
        new cdk.CfnOutput(this, "AccessKey", {
            value: accessKey.ref,
            description: "Access Key",
        });
        new cdk.CfnOutput(this, "AccessSecretKey", {
            value: accessKey.attrSecretAccessKey,
            description: "Access Secret Key",
        });
        new cdk.CfnOutput(this, "SQSTicketUrl", {
            value: ticketQueue.queueUrl,
            description: "SQS Ticket Url",
        });
        new cdk.CfnOutput(this, "LambdaTicketProcess", {
            value: queueLambdaFunction.functionName,
            description: "Ticket Process Lambda Name",
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
            removalPolicy: cdk.RemovalPolicy.DESTROY
        });
        this.DTicket.addGlobalSecondaryIndex({
            indexName: 'TicketCodeIndex',
            partitionKey: { name: 'DTicketCode', type: dynamodb.AttributeType.STRING },
            readCapacity: 1,
            writeCapacity: 1,
            projectionType: dynamodb.ProjectionType.ALL,
        });
        this.DTicket.addGlobalSecondaryIndex({
            indexName: 'EmailIndex',
            partitionKey: { name: 'DEventId', type: dynamodb.AttributeType.NUMBER },
            sortKey: { name: 'DUserEmail', type: dynamodb.AttributeType.STRING },
            readCapacity: 1,
            writeCapacity: 1,
            projectionType: dynamodb.ProjectionType.ALL,
        });
    }
    createDB(props, sg) {
        const apiName = (props === null || props === void 0 ? void 0 : props.apiName) || "";
        const stageName = (props === null || props === void 0 ? void 0 : props.stageName) || "";
        const instanceIdentifier = `${apiName}-${stageName}-db`;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ3hhcHAtc2VydmVybGVzcy1jb25zdHJ1Y3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJneGFwcC1zZXJ2ZXJsZXNzLWNvbnN0cnVjdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSx5REFBeUQ7QUFDekQsbUNBQW1DO0FBQ25DLHVEQUFzRDtBQUN0RCx1RUFBOEQ7QUFDOUQscURBQXFEO0FBQ3JELDJDQUEyQztBQUMzQyxpREFBaUQ7QUFFakQsMkNBQTJDO0FBQzNDLDJFQUEyRTtBQUMzRSx5Q0FBeUM7QUFDekMsMkNBQTJDO0FBQzNDLHlEQUF5RDtBQUN6RCw4REFBOEQ7QUFDOUQsMERBQTBEO0FBQzFELDZDQUE2QztBQUM3QyxpRUFBZ0U7QUFDaEUsMkNBQXVDO0FBQ3ZDLGdHQUFnRztBQUNoRywyQ0FBMkM7QUFFM0MsK0RBQWtFO0FBYWxFLE1BQU0saUJBQWlCLEdBQ3JCLCtEQUErRCxDQUFDO0FBQ2xFLE1BQU0sdUJBQXVCLEdBQUcsSUFBSSxDQUFDO0FBQ3JDLE1BQU0sb0JBQW9CLEdBQUcsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUM7QUFDdEQsTUFBTSxvQkFBb0IsR0FBRyxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQztBQUNwRCxNQUFNLDRCQUE0QixHQUFHLGlCQUFpQixDQUFDO0FBRXZELE1BQWEsMkJBQTRCLFNBQVEsc0JBQVM7SUFReEQsWUFDRSxLQUFnQixFQUNoQixFQUFVLEVBQ1YsS0FBdUM7O1FBRXZDLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFabkIsYUFBUSxHQUFZLElBQUksQ0FBQztRQWN2QixNQUFNLEtBQUssR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUVqQyxNQUFNLE9BQU8sR0FBRyxDQUFBLEtBQUssYUFBTCxLQUFLLHVCQUFMLEtBQUssQ0FBRSxPQUFPLEtBQUksRUFBRSxDQUFD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U0FBaUI7UUFDbkQsT0FBTyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRTtZQUM5QixPQUFPLEVBQUUsR0FBRyxPQUFPLElBQUksU0FBUyxNQUFNO1lBQ3RDLG1CQUFtQixFQUFFO2dCQUNuQjtvQkFDRSxRQUFRLEVBQUUsRUFBRTtvQkFDWixJQUFJLEVBQUUsUUFBUTtvQkFDZCxVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxNQUFNO2lCQUNsQztnQkFDRDtvQkFDRSxRQUFRLEVBQUUsRUFBRTtvQkFDWixJQUFJLEVBQUUsa0JBQWtCO29CQUN4QixVQUFVLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxnQkFBZ0I7aUJBQzVDO2FBQ0Y7WUFDRCxNQUFNLEVBQUUsQ0FBQztTQUNWLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FFRjtBQTdmRCxrRUE2ZkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheVwiO1xyXG5pbXBvcnQgKiBhcyBjZGsgZnJvbSBcImF3cy1jZGstbGliXCI7XHJcbmltcG9ydCB7UnVsZSwgU2NoZWR1bGV9IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZXZlbnRzXCI7XHJcbmltcG9ydCB7TGFtYmRhRnVuY3Rpb259IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtZXZlbnRzLXRhcmdldHNcIjtcclxuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSBcImF3cy1jZGstbGliL2F3cy1keW5hbW9kYlwiO1xyXG5pbXBvcnQgKiBhcyBzcXMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1zcXNcIjtcclxuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbGFtYmRhXCI7XHJcbmltcG9ydCAqIGFzIGVjcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNzJztcclxuaW1wb3J0ICogYXMgZWMyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lYzInO1xyXG5pbXBvcnQgKiBhcyBsYW1iZGFFdmVudFNvdXJjZXMgZnJvbSBcImF3cy1jZGstbGliL2F3cy1sYW1iZGEtZXZlbnQtc291cmNlc1wiO1xyXG5pbXBvcnQgKiBhcyBzMyBmcm9tIFwiYXdzLWNkay1saWIvYXdzLXMzXCI7XHJcbmltcG9ydCAqIGFzIGlhbSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWlhbVwiO1xyXG5pbXBvcnQgKiBhcyBjbG91ZGZyb250IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udFwiO1xyXG5pbXBvcnQgKiBhcyBvcmlnaW5zIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udC1vcmlnaW5zXCI7XHJcbmltcG9ydCAqIGFzIGFjbSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWNlcnRpZmljYXRlbWFuYWdlclwiO1xyXG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtbG9nc1wiO1xyXG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInXHJcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xyXG4vLyB7IENyZWRlbnRpYWxzLCBEYXRhYmFzZUluc3RhbmNlLCBEYXRhYmFzZUluc3RhbmNlRW5naW5lLCBEYXRhYmFzZVNlY3JldCwgTXlzcWxFbmdpbmVWZXJzaW9uIH1cclxuaW1wb3J0ICogYXMgcmRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1yZHMnO1xyXG5cclxuaW1wb3J0IHsgT3JpZ2luUHJvdG9jb2xQb2xpY3kgfSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnRcIjtcclxuaW1wb3J0IHsgdGltZVN0YW1wIH0gZnJvbSBcImNvbnNvbGVcIjtcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgR2VuZVh1c1NlcnZlcmxlc3NBbmd1bGFyQXBwUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XHJcbiAgcmVhZG9ubHkgYXBpTmFtZTogc3RyaW5nO1xyXG4gIHJlYWRvbmx5IGFwaURlc2NyaXB0aW9uPzogc3RyaW5nO1xyXG4gIHJlYWRvbmx5IHdlYkRvbWFpbk5hbWU/OiBzdHJpbmc7XHJcbiAgcmVhZG9ubHkgc3RhZ2VOYW1lPzogc3RyaW5nO1xyXG4gIHJlYWRvbmx5IHRpbWVvdXQ/OiBjZGsuRHVyYXRpb247XHJcbiAgcmVhZG9ubHkgbWVtb3J5U2l6ZT86IG51bWJlcjtcclxuICByZWFkb25seSBjZXJ0aWZpY2F0ZUFSTj86IHN0cmluZyB8IG51bGw7XHJcbn1cclxuXHJcbmNvbnN0IGxhbWJkYUhhbmRsZXJOYW1lID1cclxuICBcImNvbS5nZW5leHVzLmNsb3VkLnNlcnZlcmxlc3MuYXdzLkxhbWJkYUhhbmRsZXI6OmhhbmRsZVJlcXVlc3RcIjtcclxuY29uc3QgbGFtYmRhRGVmYXVsdE1lbW9yeVNpemUgPSAxMDI0O1xyXG5jb25zdCBsYW1iZGFEZWZhdWx0VGltZW91dCA9IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKTtcclxuY29uc3QgZGVmYXVsdExhbWJkYVJ1bnRpbWUgPSBsYW1iZGEuUnVudGltZS5KQVZBXzExO1xyXG5jb25zdCByZXdyaXRlRWRnZUxhbWJkYUhhbmRsZXJOYW1lID0gXCJyZXdyaXRlLmhhbmRsZXJcIjtcclxuXHJcbmV4cG9ydCBjbGFzcyBHZW5lWHVzU2VydmVybGVzc0FuZ3VsYXJBcHAgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xyXG4gIGlzRGV2RW52OiBib29sZWFuID0gdHJ1ZTtcclxuICB2cGM6IGVjMi5WcGM7XHJcbiAgZGJTZXJ2ZXI6IHJkcy5EYXRhYmFzZUluc3RhbmNlO1xyXG4gIGlhbVVzZXI6IGlhbS5Vc2VyO1xyXG4gIERUaWNrZXQ6IGR5bmFtb2RiLlRhYmxlO1xyXG4gIERDYWNoZTogZHluYW1vZGIuVGFibGU7XHJcblxyXG4gIGNvbnN0cnVjdG9yKFxyXG4gICAgc2NvcGU6IENvbnN0cnVjdCxcclxuICAgIGlkOiBzdHJpbmcsXHJcbiAgICBwcm9wczogR2VuZVh1c1NlcnZlcmxlc3NBbmd1bGFyQXBwUHJvcHNcclxuICApIHtcclxuICAgIHN1cGVyKHNjb3BlLCBpZCk7XHJcblxyXG4gICAgY29uc3Qgc3RhY2sgPSBjZGsuU3RhY2sub2YodGhpcyk7XHJcblxyXG4gICAgY29uc3QgYXBpTmFtZSA9IHByb3BzPy5hcGlOYW1lIHx8IFwiXCI7XHJcbiAgICBjb25zdCBzdGFnZU5hbWUgPSBwcm9wcz8uc3RhZ2VOYW1lIHx8IFwiXCI7XHJcblxyXG4gICAgaWYgKGFwaU5hbWUubGVuZ3RoID09IDApIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQVBJIE5hbWUgY2Fubm90IGJlIGVtcHR5XCIpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChzdGFnZU5hbWUubGVuZ3RoID09IDApIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiU3RhZ2UgTmFtZSBjYW5ub3QgYmUgZW1wdHlcIik7XHJcbiAgICB9XHJcblxyXG4gICAgLy8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBWUENcclxuICAgIHRoaXMudnBjID0gdGhpcy5jcmVhdGVWUEMoIGFwaU5hbWUsIHN0YWdlTmFtZSk7IFxyXG4gICAgY29uc3QgRHluYW1vR2F0ZXdheUVuZHBvaW50ID0gdGhpcy52cGMuYWRkR2F0ZXdheUVuZHBvaW50KCdEeW5hbW8tZW5kcG9pbnQnLCB7XHJcbiAgICAgIHNlcnZpY2U6IGVjMi5HYXRld2F5VnBjRW5kcG9pbnRBd3NTZXJ2aWNlLkRZTkFNT0RCXHJcbiAgICB9KTtcclxuXHJcbiAgICAvL3RoaXMudnBjLmFkZEludGVyZmFjZUVuZHBvaW50KGBzc3ZwY2AsIHtcclxuICAgIC8vICBzZXJ2aWNlOiBlYzIuSW50ZXJmYWNlVnBjRW5kcG9pbnRBd3NTZXJ2aWNlLlNFQ1JFVFNfTUFOQUdFUlxyXG4gICAgLy99KTtcclxuICAgIC8vLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBSRFMgLSBNeVNRTCA4LjBcclxuICAgIGNvbnN0IGRic2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCBgcmRzLXNnYCwge1xyXG4gICAgICB2cGM6IHRoaXMudnBjLFxyXG4gICAgICBhbGxvd0FsbE91dGJvdW5kOiB0cnVlXHJcbiAgICB9KTtcclxuICAgIC8vIGRic2VjdXJpdHlHcm91cC5jb25uZWN0aW9ucy5hbGxvd0Zyb20oYXNnU0csIGVjMi5Qb3J0LnRjcCgzMzA2KSk7XHJcbiAgICBkYnNlY3VyaXR5R3JvdXAuY29ubmVjdGlvbnMuYWxsb3dGcm9tKGRic2VjdXJpdHlHcm91cCwgZWMyLlBvcnQudGNwKDMzMDYpKTtcclxuICAgIGlmICh0aGlzLmlzRGV2RW52KSB7XHJcbiAgICAgIC8vQWNjZXNzIGZyb20gTXlJUFxyXG4gICAgICBkYnNlY3VyaXR5R3JvdXAuY29ubmVjdGlvbnMuYWxsb3dGcm9tKCBlYzIuUGVlci5pcHY0KCcxMDAuMTAwLjEwMC4xMDAvMzInKSwgZWMyLlBvcnQudGNwUmFuZ2UoMSwgNjU1MzUpKTsgXHJcbiAgICB9XHJcbiAgICB0aGlzLmRiU2VydmVyID0gdGhpcy5jcmVhdGVEQihwcm9wcywgZGJzZWN1cml0eUdyb3VwKTtcclxuXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIER5bmFtb1xyXG4gICAgdGhpcy5jcmVhdGVEeW5hbW8ocHJvcHMpO1xyXG5cclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gU2VjdXJpdHlcclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbiAgICAvLyBVc2VyIHRvIG1hbmFnZSB0aGUgYXBpbmFtZVxyXG4gICAgLy8gUzMgZ3gtZGVwbG95IHdpbGwgYmUgdXNlZCB0byBkZXBsb3kgdGhlIGFwcCB0byBhd3NcclxuICAgIHRoaXMuaWFtVXNlciA9IG5ldyBpYW0uVXNlcih0aGlzLCBgJHthcGlOYW1lfS11c2VyYCk7XHJcblxyXG4gICAgLy8gR2VuZXJpYyBQb2xpY2llc1xyXG4gICAgdGhpcy5pYW1Vc2VyLmFkZFRvUG9saWN5KFxyXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgYWN0aW9uczogW1wiczM6KlwiXSxcclxuICAgICAgICByZXNvdXJjZXM6IFtcImFybjphd3M6czM6OjpneC1kZXBsb3kvKlwiLCBcImFybjphd3M6czM6OjpneC1kZXBsb3kqXCJdLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuICAgIC8vIEdyYW50IGFjY2VzcyB0byBhbGwgYXBwbGljYXRpb24gbGFtYmRhIGZ1bmN0aW9uc1xyXG4gICAgdGhpcy5pYW1Vc2VyLmFkZFRvUG9saWN5KFxyXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgYWN0aW9uczogW1wibGFtYmRhOipcIl0sXHJcbiAgICAgICAgcmVzb3VyY2VzOiBbXHJcbiAgICAgICAgICBgYXJuOmF3czpsYW1iZGE6JHtzdGFjay5yZWdpb259OiR7c3RhY2suYWNjb3VudH06ZnVuY3Rpb246JHthcGlOYW1lfV8qYCxcclxuICAgICAgICBdLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuXHJcbiAgICAvLyBNYXhpbXVtIHBvbGljeSBzaXplIG9mIDIwNDggYnl0ZXMgZXhjZWVkZWQgZm9yIHVzZXJcclxuICAgIGNvbnN0IGZlc3RHcm91cCA9IG5ldyBpYW0uR3JvdXAodGhpcywgJ2Zlc3RpdmFsLWdyb3VwLWlkJywge1xyXG4gICAgICBncm91cE5hbWU6IGAke2FwaU5hbWV9XyR7c3RhZ2VOYW1lfV9mZXN0Z3JvdXBgXHJcbiAgICB9KTtcclxuICAgIGZlc3RHcm91cC5hZGRVc2VyKHRoaXMuaWFtVXNlcik7XHJcblxyXG4gICAgY29uc3QgYWNjZXNzS2V5ID0gbmV3IGlhbS5DZm5BY2Nlc3NLZXkodGhpcywgYCR7YXBpTmFtZX0tYWNjZXNza2V5YCwge1xyXG4gICAgICB1c2VyTmFtZTogdGhpcy5pYW1Vc2VyLnVzZXJOYW1lLFxyXG4gICAgfSk7XHJcbiAgICB0aGlzLkRDYWNoZS5ncmFudFJlYWRXcml0ZURhdGEoIGZlc3RHcm91cCk7XHJcbiAgICB0aGlzLkRUaWNrZXQuZ3JhbnRSZWFkV3JpdGVEYXRhKCBmZXN0R3JvdXApO1xyXG5cclxuICAgIC8vIExhbWJkYSBGdW5jdGlvbnNcclxuICAgIGNvbnN0IGxhbWJkYVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgYGxhbWJkYS1yb2xlYCwge1xyXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uQ29tcG9zaXRlUHJpbmNpcGFsKFxyXG4gICAgICAgIG5ldyBpYW0uU2VydmljZVByaW5jaXBhbChcImFwaWdhdGV3YXkuYW1hem9uYXdzLmNvbVwiKSxcclxuICAgICAgICBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJsYW1iZGEuYW1hem9uYXdzLmNvbVwiKVxyXG4gICAgICApLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJHZW5lWHVzIFNlcnZlcmxlc3MgQXBwbGljYXRpb24gTGFtYmRhIFJvbGVcIixcclxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXHJcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKFxyXG4gICAgICAgICAgXCJzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlXCJcclxuICAgICAgICApLFxyXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZShcclxuICAgICAgICAgIFwic2VydmljZS1yb2xlL0FXU0xhbWJkYVJvbGVcIlxyXG4gICAgICAgICksXHJcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKFxyXG4gICAgICAgICAgXCJzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhVlBDQWNjZXNzRXhlY3V0aW9uUm9sZVwiXHJcbiAgICAgICAgKSxcclxuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoXHJcbiAgICAgICAgICBcInNlcnZpY2Utcm9sZS9BV1NMYW1iZGFTUVNRdWV1ZUV4ZWN1dGlvblJvbGVcIlxyXG4gICAgICAgICksXHJcbiAgICAgIF0sXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAgLy8gU1FTIFRpY2tldCBRdWV1ZVxyXG4gICAgY29uc3QgdGlja2V0UXVldWUgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsIGB0aWNrZXRxdWV1ZWAsIHtcclxuICAgICAgcXVldWVOYW1lOiBgJHthcGlOYW1lfV8ke3N0YWdlTmFtZX1fdGlja2V0cXVldWVgXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICAvLyBMYW1iZGEgZm9yIFNRU1xyXG4gICAgY29uc3QgcXVldWVMYW1iZGFGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgYFRpY2tldFByb2Nlc3NgLCB7XHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogYCR7YXBpTmFtZX1fJHtzdGFnZU5hbWV9X1RpY2tldFByb2Nlc3NgLFxyXG4gICAgICBydW50aW1lOiBkZWZhdWx0TGFtYmRhUnVudGltZSxcclxuICAgICAgaGFuZGxlcjogXCJjb20uZ2VuZXh1cy5jbG91ZC5zZXJ2ZXJsZXNzLmF3cy5oYW5kbGVyLkxhbWJkYVNRU0hhbmRsZXI6OmhhbmRsZVJlcXVlc3RcIixcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KF9fZGlybmFtZSArIFwiLy4uLy4uL2Jvb3RzdHJhcFwiKSwgLy9FbXB0eSBzYW1wbGUgcGFja2FnZVxyXG4gICAgICB2cGM6IHRoaXMudnBjLFxyXG4gICAgICAvL2FsbG93UHVibGljU3VibmV0OiB0cnVlLFxyXG4gICAgICByb2xlOiBsYW1iZGFSb2xlLFxyXG4gICAgICB0aW1lb3V0OiBwcm9wcz8udGltZW91dCB8fCBsYW1iZGFEZWZhdWx0VGltZW91dCxcclxuICAgICAgbWVtb3J5U2l6ZTogcHJvcHM/Lm1lbW9yeVNpemUgfHwgbGFtYmRhRGVmYXVsdE1lbW9yeVNpemUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBgJyR7XHJcbiAgICAgICAgcHJvcHM/LmFwaURlc2NyaXB0aW9uIHx8IGFwaU5hbWVcclxuICAgICAgfScgUXVldWUgVGlja2V0IFByb2Nlc3MgTGFtYmRhIGZ1bmN0aW9uYCxcclxuICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXHJcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbZGJzZWN1cml0eUdyb3VwXVxyXG4gICAgfSk7XHJcbiAgICAvLyBcclxuXHJcbiAgICAvLyBMYW1iZGEgcXVldWUgdHJpZ2dlclxyXG4gICAgY29uc3QgZXZlbnRTb3VyY2UgPSBuZXcgbGFtYmRhRXZlbnRTb3VyY2VzLlNxc0V2ZW50U291cmNlKHRpY2tldFF1ZXVlKTtcclxuICAgIHF1ZXVlTGFtYmRhRnVuY3Rpb24uYWRkRXZlbnRTb3VyY2UoZXZlbnRTb3VyY2UpO1xyXG5cclxuICAgIC8vIFNvbWUgcXVldWUgcGVybWlzc2lvbnNcclxuICAgIHRpY2tldFF1ZXVlLmdyYW50Q29uc3VtZU1lc3NhZ2VzKHF1ZXVlTGFtYmRhRnVuY3Rpb24pO1xyXG4gICAgdGlja2V0UXVldWUuZ3JhbnRTZW5kTWVzc2FnZXMoZmVzdEdyb3VwKTtcclxuXHJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIExhbWJkYSBDUk9OXHJcbiAgICBjb25zdCBjcm9uTGFtYmRhRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsIGBDcm9uTGFtYmRhYCwge1xyXG4gICAgICBmdW5jdGlvbk5hbWU6IGAke2FwaU5hbWV9XyR7c3RhZ2VOYW1lfV9Dcm9uYCxcclxuICAgICAgcnVudGltZTogZGVmYXVsdExhbWJkYVJ1bnRpbWUsXHJcbiAgICAgIGhhbmRsZXI6IFwiY29tLmdlbmV4dXMuY2xvdWQuc2VydmVybGVzcy5hd3MuaGFuZGxlci5MYW1iZGFFdmVudEJyaWRnZUhhbmRsZXI6OmhhbmRsZVJlcXVlc3RcIixcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KF9fZGlybmFtZSArIFwiLy4uLy4uL2Jvb3RzdHJhcFwiKSwgLy9FbXB0eSBzYW1wbGUgcGFja2FnZVxyXG4gICAgICB2cGM6IHRoaXMudnBjLFxyXG4gICAgICAvL2FsbG93UHVibGljU3VibmV0OiB0cnVlLFxyXG4gICAgICByb2xlOiBsYW1iZGFSb2xlLFxyXG4gICAgICB0aW1lb3V0OiBwcm9wcz8udGltZW91dCB8fCBsYW1iZGFEZWZhdWx0VGltZW91dCxcclxuICAgICAgbWVtb3J5U2l6ZTogcHJvcHM/Lm1lbW9yeVNpemUgfHwgbGFtYmRhRGVmYXVsdE1lbW9yeVNpemUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBgJyR7XHJcbiAgICAgICAgcHJvcHM/LmFwaURlc2NyaXB0aW9uIHx8IGFwaU5hbWVcclxuICAgICAgfScgQ3JvbiBQcm9jZXNzIExhbWJkYSBmdW5jdGlvbmAsXHJcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxyXG4gICAgICBzZWN1cml0eUdyb3VwczogW2Ric2VjdXJpdHlHcm91cF1cclxuICAgIH0pO1xyXG4gICAgLy9FdmVudEJyaWRnZSBydWxlIHdoaWNoIHJ1bnMgZXZlcnkgZml2ZSBtaW51dGVzXHJcbiAgICBjb25zdCBjcm9uUnVsZSA9IG5ldyBSdWxlKHRoaXMsICdDcm9uUnVsZScsIHtcclxuICAgICAgc2NoZWR1bGU6IFNjaGVkdWxlLmV4cHJlc3Npb24oJ2Nyb24oMC8xMCAqICogKiA/ICopJylcclxuICAgIH0pXHJcbiAgICBjcm9uUnVsZS5hZGRUYXJnZXQobmV3IExhbWJkYUZ1bmN0aW9uKGNyb25MYW1iZGFGdW5jdGlvbikpO1xyXG5cclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIEFuZ3VsYXIgQXBwIEhvc3RcclxuICAgIC8vIE1heGltdW0gcG9saWN5IHNpemUgb2YgMjA0OCBieXRlcyBleGNlZWRlZCBmb3IgdXNlclxyXG4gICAgY29uc3QgYXBwR3JvdXAgPSBuZXcgaWFtLkdyb3VwKHRoaXMsICdhcHAtZ3JvdXAtaWQnLCB7XHJcbiAgICAgIGdyb3VwTmFtZTogYCR7YXBpTmFtZX1fJHtzdGFnZU5hbWV9X2FwcGdyb3VwYFxyXG4gICAgfSk7XHJcbiAgICBhcHBHcm91cC5hZGRVc2VyKHRoaXMuaWFtVXNlcik7ICAgIFxyXG4gICAgXHJcbiAgICBjb25zdCB3ZWJzaXRlUHVibGljQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCBgJHthcGlOYW1lfS1idWNrZXQtd2ViYCwge1xyXG4gICAgICB3ZWJzaXRlSW5kZXhEb2N1bWVudDogXCJpbmRleC5odG1sXCIsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICB9KTtcclxuICAgIHdlYnNpdGVQdWJsaWNCdWNrZXQuZ3JhbnRQdWJsaWNBY2Nlc3MoKTtcclxuICAgIHdlYnNpdGVQdWJsaWNCdWNrZXQuZ3JhbnRSZWFkV3JpdGUoYXBwR3JvdXApO1xyXG4gICAgbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XHJcbiAgICAgIHN0YXRlbWVudHM6IFtcclxuICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgICBhY3Rpb25zOiBbXCJzdHM6QXNzdW1lUm9sZVwiXSxcclxuICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcclxuICAgICAgICB9KSxcclxuICAgICAgXSxcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBTdG9yYWdlXHJcbiAgICBjb25zdCBzdG9yYWdlQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCBgJHthcGlOYW1lfS1idWNrZXRgLCB7XHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICB9KTtcclxuICAgIHN0b3JhZ2VCdWNrZXQuZ3JhbnRQdXRBY2woYXBwR3JvdXApO1xyXG4gICAgc3RvcmFnZUJ1Y2tldC5ncmFudFJlYWRXcml0ZShhcHBHcm91cCk7XHJcbiAgICBzdG9yYWdlQnVja2V0LmdyYW50UHVibGljQWNjZXNzKCk7XHJcblxyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgIC8vIEJhY2tlbmQgc2VydmljZXNcclxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcGlnYXRld2F5LlJlc3RBcGkodGhpcywgYCR7YXBpTmFtZX0tYXBpZ3dgLCB7XHJcbiAgICAgIGRlc2NyaXB0aW9uOiBgJHthcGlOYW1lfSBBUElHYXRld2F5IEVuZHBvaW50YCxcclxuICAgICAgcmVzdEFwaU5hbWU6IGFwaU5hbWUsXHJcbiAgICAgIGRlcGxveU9wdGlvbnM6IHtcclxuICAgICAgICBzdGFnZU5hbWU6IHN0YWdlTmFtZSxcclxuICAgICAgfSxcclxuICAgICAgZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zOiB7XHJcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBbXHJcbiAgICAgICAgICBcIkNvbnRlbnQtVHlwZVwiLFxyXG4gICAgICAgICAgXCJYLUFtei1EYXRlXCIsXHJcbiAgICAgICAgICBcIkF1dGhvcml6YXRpb25cIixcclxuICAgICAgICAgIFwiWC1BcGktS2V5XCIsXHJcbiAgICAgICAgXSxcclxuICAgICAgICBhbGxvd01ldGhvZHM6IFtcIk9QVElPTlNcIiwgXCJHRVRcIiwgXCJQT1NUXCIsIFwiUFVUXCIsIFwiUEFUQ0hcIiwgXCJERUxFVEVcIl0sXHJcbiAgICAgICAgYWxsb3dDcmVkZW50aWFsczogdHJ1ZSxcclxuICAgICAgICBhbGxvd09yaWdpbnM6IFtcIipcIl0sXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBsYW1iZGFGdW5jdGlvbk5hbWUgPSBgJHthcGlOYW1lfV8ke3N0YWdlTmFtZX1gO1xyXG4gICAgY29uc3QgbGFtYmRhRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsIGAke2FwaU5hbWV9LWZ1bmN0aW9uYCwge1xyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIHJlZ2lvbjogY2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvbixcclxuICAgICAgICBHWF9GRVNUSVZBTFRJQ0tFVFNfUVVFVUVVUkw6IHRpY2tldFF1ZXVlLnF1ZXVlVXJsLFxyXG4gICAgICB9LFxyXG4gICAgICBmdW5jdGlvbk5hbWU6IGxhbWJkYUZ1bmN0aW9uTmFtZSxcclxuICAgICAgcnVudGltZTogZGVmYXVsdExhbWJkYVJ1bnRpbWUsXHJcbiAgICAgIGhhbmRsZXI6IGxhbWJkYUhhbmRsZXJOYW1lLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoX19kaXJuYW1lICsgXCIvLi4vLi4vYm9vdHN0cmFwXCIpLCAvL0VtcHR5IHNhbXBsZSBwYWNrYWdlXHJcbiAgICAgIHZwYzogdGhpcy52cGMsXHJcbiAgICAgIC8vYWxsb3dQdWJsaWNTdWJuZXQ6IHRydWUsXHJcbiAgICAgIHJvbGU6IGxhbWJkYVJvbGUsXHJcbiAgICAgIHRpbWVvdXQ6IHByb3BzPy50aW1lb3V0IHx8IGxhbWJkYURlZmF1bHRUaW1lb3V0LFxyXG4gICAgICBtZW1vcnlTaXplOiBwcm9wcz8ubWVtb3J5U2l6ZSB8fCBsYW1iZGFEZWZhdWx0TWVtb3J5U2l6ZSxcclxuICAgICAgZGVzY3JpcHRpb246IGAnJHtcclxuICAgICAgICBwcm9wcz8uYXBpRGVzY3JpcHRpb24gfHwgYXBpTmFtZVxyXG4gICAgICB9JyBTZXJ2ZXJsZXNzIExhbWJkYSBmdW5jdGlvbmAsXHJcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxyXG4gICAgfSk7XHJcbiAgICB0aGlzLkRDYWNoZS5ncmFudFJlYWRXcml0ZURhdGEobGFtYmRhRnVuY3Rpb24pO1xyXG4gICAgdGhpcy5EVGlja2V0LmdyYW50UmVhZFdyaXRlRGF0YShsYW1iZGFGdW5jdGlvbik7XHJcbiAgICBsYW1iZGFGdW5jdGlvbi5ncmFudEludm9rZShhcHBHcm91cCk7XHJcblxyXG4gICAgdGhpcy5pYW1Vc2VyLmFkZFRvUG9saWN5KFxyXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgYWN0aW9uczogW1wiYXBpZ2F0ZXdheToqXCJdLFxyXG4gICAgICAgIHJlc291cmNlczogW1xyXG4gICAgICAgICAgYGFybjphd3M6YXBpZ2F0ZXdheToke3N0YWNrLnJlZ2lvbn06Oi9yZXN0YXBpcy8ke2FwaS5yZXN0QXBpSWR9KmAsXHJcbiAgICAgICAgXSxcclxuICAgICAgfSlcclxuICAgICk7XHJcblxyXG4gICAgdGhpcy5pYW1Vc2VyLmFkZFRvUG9saWN5KFxyXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XHJcbiAgICAgICAgYWN0aW9uczogW1wiYXBpZ2F0ZXdheToqXCJdLFxyXG4gICAgICAgIHJlc291cmNlczogW2Bhcm46YXdzOmFwaWdhdGV3YXk6JHtzdGFjay5yZWdpb259OjovcmVzdGFwaXMqYF0sXHJcbiAgICAgIH0pXHJcbiAgICApO1xyXG5cclxuICAgIHRoaXMuaWFtVXNlci5hZGRUb1BvbGljeShcclxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xyXG4gICAgICAgIGFjdGlvbnM6IFtcImlhbTpQYXNzUm9sZVwiXSxcclxuICAgICAgICByZXNvdXJjZXM6IFtsYW1iZGFSb2xlLnJvbGVBcm5dLFxyXG4gICAgICB9KVxyXG4gICAgKTtcclxuXHJcbiAgICBjb25zdCByZXdyaXRlRWRnZUZ1bmN0aW9uUmVzcG9uc2UgPVxyXG4gICAgICBuZXcgY2xvdWRmcm9udC5leHBlcmltZW50YWwuRWRnZUZ1bmN0aW9uKHRoaXMsIGAke2FwaU5hbWV9RWRnZUxhbWJkYWAsIHtcclxuICAgICAgICBmdW5jdGlvbk5hbWU6IGAke2FwaU5hbWV9LSR7c3RhZ2VOYW1lfS1FZGdlTGFtYmRhYCxcclxuICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMTRfWCxcclxuICAgICAgICBoYW5kbGVyOiByZXdyaXRlRWRnZUxhbWJkYUhhbmRsZXJOYW1lLFxyXG4gICAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldChcImxhbWJkYVwiKSxcclxuICAgICAgICBkZXNjcmlwdGlvbjogYEdlbmVYdXMgQW5ndWxhciBSZXdyaXRlIExhbWJkYSBmb3IgQ2xvdWRmcm9udGAsXHJcbiAgICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuRklWRV9EQVlTICAgICAgICBcclxuICAgICAgfSk7XHJcblxyXG4gICAgcmV3cml0ZUVkZ2VGdW5jdGlvblJlc3BvbnNlLmdyYW50SW52b2tlKGFwcEdyb3VwKTtcclxuICAgIHJld3JpdGVFZGdlRnVuY3Rpb25SZXNwb25zZS5hZGRBbGlhcyhcImxpdmVcIiwge30pO1xyXG5cclxuICAgIGNvbnN0IG9yaWdpblBvbGljeSA9IG5ldyBjbG91ZGZyb250Lk9yaWdpblJlcXVlc3RQb2xpY3koXHJcbiAgICAgIHRoaXMsXHJcbiAgICAgIGAke2FwaU5hbWV9SHR0cE9yaWdpblBvbGljeWAsXHJcbiAgICAgIHtcclxuICAgICAgICAvL29yaWdpblJlcXVlc3RQb2xpY3lOYW1lOiBcIkdYLUhUVFAtT3JpZ2luLVBvbGljeVwiLFxyXG4gICAgICAgIGNvbW1lbnQ6IGAke2FwaU5hbWV9IE9yaWdpbiBIdHRwIFBvbGljeWAsXHJcbiAgICAgICAgaGVhZGVyQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVIZWFkZXJCZWhhdmlvci5hbGxvd0xpc3QoXHJcbiAgICAgICAgICBcIkFjY2VwdFwiLFxyXG4gICAgICAgICAgXCJBY2NlcHQtQ2hhcnNldFwiLFxyXG4gICAgICAgICAgXCJBY2NlcHQtTGFuZ3VhZ2VcIixcclxuICAgICAgICAgIFwiQ29udGVudC1UeXBlXCIsXHJcbiAgICAgICAgICBcIkd4VFpPZmZzZXRcIixcclxuICAgICAgICAgIFwiRGV2aWNlSWRcIixcclxuICAgICAgICAgIFwiRGV2aWNlVHlwZVwiLFxyXG4gICAgICAgICAgXCJSZWZlcmVyXCJcclxuICAgICAgICApLFxyXG4gICAgICAgIHF1ZXJ5U3RyaW5nQmVoYXZpb3I6IGNsb3VkZnJvbnQuQ2FjaGVRdWVyeVN0cmluZ0JlaGF2aW9yLmFsbCgpLFxyXG4gICAgICAgIGNvb2tpZUJlaGF2aW9yOiBjbG91ZGZyb250LkNhY2hlQ29va2llQmVoYXZpb3IuYWxsKCksXHJcbiAgICAgIH1cclxuICAgICk7XHJcblxyXG4gICAgY29uc3QgY2VydGlmaWNhdGUgPSBwcm9wcz8uY2VydGlmaWNhdGVBUk5cclxuICAgICAgPyBhY20uQ2VydGlmaWNhdGUuZnJvbUNlcnRpZmljYXRlQXJuKFxyXG4gICAgICAgICAgdGhpcyxcclxuICAgICAgICAgIFwiQ2xvdWRmcm9udCBDZXJ0aWZpY2F0ZVwiLFxyXG4gICAgICAgICAgcHJvcHM/LmNlcnRpZmljYXRlQVJOXHJcbiAgICAgICAgKVxyXG4gICAgICA6IHVuZGVmaW5lZDtcclxuXHJcbiAgICBjb25zdCB3ZWJEaXN0cmlidXRpb24gPSBuZXcgY2xvdWRmcm9udC5EaXN0cmlidXRpb24oXHJcbiAgICAgIHRoaXMsXHJcbiAgICAgIGAke2FwaU5hbWV9LWNkbmAsXHJcbiAgICAgIHtcclxuICAgICAgICBjb21tZW50OiBgJHthcGlOYW1lfSBDbG91ZGZyb250IERpc3RyaWJ1dGlvbmAsXHJcbiAgICAgICAgZG9tYWluTmFtZXM6IHByb3BzPy53ZWJEb21haW5OYW1lID8gW3Byb3BzPy53ZWJEb21haW5OYW1lXSA6IHVuZGVmaW5lZCxcclxuICAgICAgICBjZXJ0aWZpY2F0ZTogY2VydGlmaWNhdGUsXHJcbiAgICAgICAgZGVmYXVsdEJlaGF2aW9yOiB7XHJcbiAgICAgICAgICBvcmlnaW46IG5ldyBvcmlnaW5zLlMzT3JpZ2luKHdlYnNpdGVQdWJsaWNCdWNrZXQpLFxyXG4gICAgICAgICAgY2FjaGVQb2xpY3k6IGNsb3VkZnJvbnQuQ2FjaGVQb2xpY3kuQ0FDSElOR19PUFRJTUlaRUQsXHJcbiAgICAgICAgICBvcmlnaW5SZXF1ZXN0UG9saWN5OiBjbG91ZGZyb250Lk9yaWdpblJlcXVlc3RQb2xpY3kuQ09SU19TM19PUklHSU4sXHJcbiAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTpcclxuICAgICAgICAgICAgY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcclxuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0FMTCxcclxuICAgICAgICAgIGVkZ2VMYW1iZGFzOiBbXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICBmdW5jdGlvblZlcnNpb246IHJld3JpdGVFZGdlRnVuY3Rpb25SZXNwb25zZSxcclxuICAgICAgICAgICAgICBldmVudFR5cGU6IGNsb3VkZnJvbnQuTGFtYmRhRWRnZUV2ZW50VHlwZS5PUklHSU5fUkVTUE9OU0UsXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIF0sXHJcbiAgICAgICAgfSxcclxuICAgICAgfVxyXG4gICAgKTtcclxuXHJcbiAgICBjb25zdCBhcGlEb21haW5OYW1lID0gYCR7YXBpLnJlc3RBcGlJZH0uZXhlY3V0ZS1hcGkuJHtzdGFjay5yZWdpb259LmFtYXpvbmF3cy5jb21gO1xyXG5cclxuICAgIGNvbnN0IGFwaUdhdGV3YXlPcmlnaW4gPSBuZXcgb3JpZ2lucy5IdHRwT3JpZ2luKGFwaURvbWFpbk5hbWUsIHtcclxuICAgICAgcHJvdG9jb2xQb2xpY3k6IE9yaWdpblByb3RvY29sUG9saWN5LkhUVFBTX09OTFksXHJcbiAgICB9KTtcclxuXHJcbiAgICB3ZWJEaXN0cmlidXRpb24ubm9kZS5hZGREZXBlbmRlbmN5KGFwaSk7XHJcblxyXG4gICAgd2ViRGlzdHJpYnV0aW9uLmFkZEJlaGF2aW9yKGAvJHtzdGFnZU5hbWV9LypgLCBhcGlHYXRld2F5T3JpZ2luLCB7XHJcbiAgICAgIGNvbXByZXNzOiB0cnVlLFxyXG4gICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5BTExPV19BTEwsXHJcbiAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0FMTCxcclxuICAgICAgY2FjaGVQb2xpY3k6IGNsb3VkZnJvbnQuQ2FjaGVQb2xpY3kuQ0FDSElOR19ESVNBQkxFRCxcclxuICAgICAgb3JpZ2luUmVxdWVzdFBvbGljeTogb3JpZ2luUG9saWN5LFxyXG4gICAgfSk7XHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIldlYlVSTFwiLCB7XHJcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke3dlYkRpc3RyaWJ1dGlvbi5kb21haW5OYW1lfWAsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkZyb250ZW5kIFdlYnNpdGUgVVJMXCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkFwaVVSTFwiLCB7XHJcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke3dlYkRpc3RyaWJ1dGlvbi5kb21haW5OYW1lfS8ke3N0YWdlTmFtZX0vYCxcclxuICAgICAgZGVzY3JpcHRpb246IFwiU2VydmljZXMgQVBJIFVSTCAoU2VydmljZXMgVVJMKVwiLFxyXG4gICAgfSk7XHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIldlYnNpdGVCdWNrZXRcIiwge1xyXG4gICAgICB2YWx1ZTogd2Vic2l0ZVB1YmxpY0J1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJCdWNrZXQgTmFtZSBmb3IgQW5ndWxhciBXZWJTaXRlIERlcGxveW1lbnRcIixcclxuICAgIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJTdG9yYWdlQnVja2V0XCIsIHtcclxuICAgICAgdmFsdWU6IHN0b3JhZ2VCdWNrZXQuYnVja2V0TmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiQnVja2V0IGZvciBTdG9yYWdlIFNlcnZpY2VcIixcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBHZW5lcmljXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIkFwaU5hbWVcIiwge1xyXG4gICAgICB2YWx1ZTogYXBpTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiQXBwbGljYXRpb24gTmFtZSAoQVBJIE5hbWUpXCIsXHJcbiAgICB9KTtcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiU3RhZ2VOYW1lXCIsIHtcclxuICAgICAgdmFsdWU6IHN0YWdlTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiU3RhZ2UgTmFtZVwiLFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vIFJEUyBNeVNRTFxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJEQkVuZFBvaW50XCIsIHtcclxuICAgICAgdmFsdWU6IHRoaXMuZGJTZXJ2ZXIuZGJJbnN0YW5jZUVuZHBvaW50QWRkcmVzcyxcclxuICAgICAgZGVzY3JpcHRpb246IFwiUkRTIE15U1FMIEVuZHBvaW50XCIsXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0RCU2VjcmV0TmFtZScsIHtcclxuICAgICAgdmFsdWU6IHRoaXMuZGJTZXJ2ZXIuc2VjcmV0Py5zZWNyZXROYW1lISxcclxuICAgICAgZGVzY3JpcHRpb246IFwiUkRTIE15U1FMIFNlY3JldCBOYW1lXCIsXHJcbiAgICB9KTtcclxuICAgIC8vIEdldCBhY2Nlc3MgdG8gdGhlIHNlY3JldCBvYmplY3RcclxuICAgIGNvbnN0IGRiUGFzc3dvcmRTZWNyZXQgPSBzZWNyZXRzbWFuYWdlci5TZWNyZXQuZnJvbVNlY3JldE5hbWVWMihcclxuICAgICAgdGhpcyxcclxuICAgICAgJ2RiLXB3ZC1pZCcsXHJcbiAgICAgIHRoaXMuZGJTZXJ2ZXIuc2VjcmV0Py5zZWNyZXROYW1lISxcclxuICAgICk7XHJcblxyXG4gICAgLy8gRHluYW1vXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRHluYW1vRENhY2hlVGFibGVOYW1lJywgeyB2YWx1ZTogdGhpcy5EQ2FjaGUudGFibGVOYW1lIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0R5bmFtb0RUaWNrZXRUYWJsZU5hbWUnLCB7IHZhbHVlOiB0aGlzLkRUaWNrZXQudGFibGVOYW1lIH0pO1xyXG4gICAgXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIklBTVJvbGVBUk5cIiwge1xyXG4gICAgICB2YWx1ZTogbGFtYmRhUm9sZS5yb2xlQXJuLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJJQU0gUm9sZSBBUk5cIixcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiQWNjZXNzS2V5XCIsIHtcclxuICAgICAgdmFsdWU6IGFjY2Vzc0tleS5yZWYsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkFjY2VzcyBLZXlcIixcclxuICAgIH0pO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgXCJBY2Nlc3NTZWNyZXRLZXlcIiwge1xyXG4gICAgICB2YWx1ZTogYWNjZXNzS2V5LmF0dHJTZWNyZXRBY2Nlc3NLZXksXHJcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkFjY2VzcyBTZWNyZXQgS2V5XCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCBcIlNRU1RpY2tldFVybFwiLCB7XHJcbiAgICAgIHZhbHVlOiB0aWNrZXRRdWV1ZS5xdWV1ZVVybCxcclxuICAgICAgZGVzY3JpcHRpb246IFwiU1FTIFRpY2tldCBVcmxcIixcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsIFwiTGFtYmRhVGlja2V0UHJvY2Vzc1wiLCB7XHJcbiAgICAgIHZhbHVlOiBxdWV1ZUxhbWJkYUZ1bmN0aW9uLmZ1bmN0aW9uTmFtZSxcclxuICAgICAgZGVzY3JpcHRpb246IFwiVGlja2V0IFByb2Nlc3MgTGFtYmRhIE5hbWVcIixcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjcmVhdGVEeW5hbW8ocHJvcHM6IEdlbmVYdXNTZXJ2ZXJsZXNzQW5ndWxhckFwcFByb3BzKXtcclxuICAgIGNvbnN0IGFwaU5hbWUgPSBwcm9wcz8uYXBpTmFtZSB8fCBcIlwiO1xyXG4gICAgY29uc3Qgc3RhZ2VOYW1lID0gcHJvcHM/LnN0YWdlTmFtZSB8fCBcIlwiO1xyXG5cclxuICAgIC8vIFRPRE86IFZlciBzaSBlbiBhbGfDum4gbW9tZW50byBHeCBpbXBsZW1lbnRhIGVsIGNhbWJpbyBkZSBub21icmUgZW4gdGFibGFzIGVuIGRhdGF2aWV3c1xyXG4gICAgdGhpcy5EQ2FjaGUgPSBuZXcgZHluYW1vZGIuVGFibGUoIHRoaXMsIGBEQ2FjaGVgLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogYERDYWNoZWAsXHJcbiAgICAgIHBhcnRpdGlvbktleTogeyBuYW1lOiAnRENhY2hlSWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZXHJcbiAgICB9KTtcclxuICAgIHRoaXMuRFRpY2tldCA9IG5ldyBkeW5hbW9kYi5UYWJsZSggdGhpcywgYERUaWNrZXRgLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogYERUaWNrZXRgLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ0RUaWNrZXRJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1lcclxuICAgIH0pO1xyXG4gICAgdGhpcy5EVGlja2V0LmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnVGlja2V0Q29kZUluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7bmFtZTogJ0RUaWNrZXRDb2RlJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkd9LFxyXG4gICAgICByZWFkQ2FwYWNpdHk6IDEsXHJcbiAgICAgIHdyaXRlQ2FwYWNpdHk6IDEsXHJcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5BTEwsXHJcbiAgICB9KTtcclxuICAgIHRoaXMuRFRpY2tldC5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0VtYWlsSW5kZXgnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHtuYW1lOiAnREV2ZW50SWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLk5VTUJFUn0sXHJcbiAgICAgIHNvcnRLZXk6IHtuYW1lOiAnRFVzZXJFbWFpbCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HfSxcclxuICAgICAgcmVhZENhcGFjaXR5OiAxLFxyXG4gICAgICB3cml0ZUNhcGFjaXR5OiAxLFxyXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNyZWF0ZURCKHByb3BzOiBHZW5lWHVzU2VydmVybGVzc0FuZ3VsYXJBcHBQcm9wcywgc2c6IGVjMi5TZWN1cml0eUdyb3VwKTogcmRzLkRhdGFiYXNlSW5zdGFuY2V7XHJcbiAgICBjb25zdCBhcGlOYW1lID0gcHJvcHM/LmFwaU5hbWUgfHwgXCJcIjtcclxuICAgIGNvbnN0IHN0YWdlTmFtZSA9IHByb3BzPy5zdGFnZU5hbWUgfHwgXCJcIjtcclxuXHJcbiAgICBjb25zdCBpbnN0YW5jZUlkZW50aWZpZXIgPSBgJHthcGlOYW1lfS0ke3N0YWdlTmFtZX0tZGJgO1xyXG5cclxuICAgIHJldHVybiBuZXcgcmRzLkRhdGFiYXNlSW5zdGFuY2UodGhpcywgYCR7YXBpTmFtZX0tZGJgLCB7XHJcbiAgICAgIHB1YmxpY2x5QWNjZXNzaWJsZTogdGhpcy5pc0RldkVudixcclxuICAgICAgdnBjU3VibmV0czoge1xyXG4gICAgICAgIG9uZVBlckF6OiB0cnVlLFxyXG4gICAgICAgIHN1Ym5ldFR5cGU6IHRoaXMuaXNEZXZFbnYgPyBlYzIuU3VibmV0VHlwZS5QVUJMSUMgOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfTkFUXHJcbiAgICAgIH0sXHJcbiAgICAgIGNyZWRlbnRpYWxzOiByZHMuQ3JlZGVudGlhbHMuZnJvbUdlbmVyYXRlZFNlY3JldCgnZGJhZG1pbicpLFxyXG4gICAgICB2cGM6IHRoaXMudnBjLFxyXG4gICAgICBwb3J0OiAzMzA2LFxyXG4gICAgICBkYXRhYmFzZU5hbWU6ICdmZXN0aXZhbHRpY2tldHMnLFxyXG4gICAgICBhbGxvY2F0ZWRTdG9yYWdlOiAyMCxcclxuICAgICAgaW5zdGFuY2VJZGVudGlmaWVyLFxyXG4gICAgICBlbmdpbmU6IHJkcy5EYXRhYmFzZUluc3RhbmNlRW5naW5lLm15c3FsKHtcclxuICAgICAgICB2ZXJzaW9uOiByZHMuTXlzcWxFbmdpbmVWZXJzaW9uLlZFUl84XzBcclxuICAgICAgfSksXHJcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbc2ddLFxyXG4gICAgICBpbnN0YW5jZVR5cGU6IGVjMi5JbnN0YW5jZVR5cGUub2YoZWMyLkluc3RhbmNlQ2xhc3MuVDRHLCBlYzIuSW5zdGFuY2VTaXplLk1JQ1JPKSxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogdGhpcy5pc0RldkVudiA/IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1kgOiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU5cclxuICAgIH0pXHJcbiAgICBcclxuICAgIC8vIHBvdGVudGlhbGx5IGFsbG93IGNvbm5lY3Rpb25zIHRvIHRoZSBSRFMgaW5zdGFuY2UuLi5cclxuICAgIC8vIGRiU2VydmVyLmNvbm5lY3Rpb25zLmFsbG93RnJvbSAuLi5cclxuICB9XHJcbiAgcHJpdmF0ZSBjcmVhdGVWUEMoIGFwaU5hbWU6IHN0cmluZywgc3RhZ2VOYW1lOiBzdHJpbmcpOiBlYzIuVnBjIHtcclxuICAgIHJldHVybiBuZXcgZWMyLlZwYyh0aGlzLCBgdnBjYCwge1xyXG4gICAgICB2cGNOYW1lOiBgJHthcGlOYW1lfS0ke3N0YWdlTmFtZX0tdnBjYCxcclxuICAgICAgc3VibmV0Q29uZmlndXJhdGlvbjogW1xyXG4gICAgICAgIHtcclxuICAgICAgICAgIGNpZHJNYXNrOiAyNCxcclxuICAgICAgICAgIG5hbWU6ICdwdWJsaWMnLFxyXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFVCTElDLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgY2lkck1hc2s6IDI0LFxyXG4gICAgICAgICAgbmFtZTogJ3ByaXZhdGVfaXNvbGF0ZWQnLFxyXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX05BVCxcclxuICAgICAgICB9XHJcbiAgICAgIF0sXHJcbiAgICAgIG1heEF6czogMlxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxufVxyXG4iXX0=