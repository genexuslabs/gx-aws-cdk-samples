import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as cdk from "aws-cdk-lib";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import * as rds from 'aws-cdk-lib/aws-rds';
import * as apprunner from '@aws-cdk/aws-apprunner-alpha';

export interface AwsApprunnerStackProps extends cdk.StackProps {
  readonly appName: string;
  readonly stageName?: string;
}

export class AwsApprunnerStack extends Stack {
  appName: string;
  stageName: string;
  isDevEnv: boolean = true;
  vpc: ec2.Vpc;
  dbServer: rds.DatabaseInstance;
  iamUser: iam.User;
  securityGroup: ec2.SecurityGroup;
  accessKey: iam.CfnAccessKey;
  envVars: any = {};
  serviceRole: iam.Role;
  
  constructor(scope: Construct, id: string, props?: AwsApprunnerStackProps) {
    super(scope, id, props);

    const stack = cdk.Stack.of(this);

    this.appName = props?.appName || "";
    this.stageName = props?.stageName || "";

    if (this.appName.length == 0) {
      throw new Error("API Name cannot be empty");
    }

    if (this.stageName.length == 0) {
      throw new Error("Stage Name cannot be empty");
    }

    /*
    this.appName = (new cdk.CfnParameter(this, 'appname', {
      type: 'String',
      description: 'The name of the app',
    })).valueAsString;
    

    this.stageName = (new cdk.CfnParameter(this, 'appstage', {
      type: 'String',
      description: 'The stage of the app',
    })).valueAsString;
    */

    // -------------------------------
    // IAM User
    this.iamUserCreate();

    //----------------------------------
    // VPC
    this.createVPC();
    const DynamoGatewayEndpoint = this.vpc.addGatewayEndpoint('S3-endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3
    });
    //---------------------------------
    // RDS - MySQL 8.0
    this.securityGroup = new ec2.SecurityGroup(this, `rds-sg`, {
      vpc: this.vpc,
      allowAllOutbound: true
    });
    this.securityGroup.connections.allowFrom( this.securityGroup, ec2.Port.tcp(3306));
    if (this.isDevEnv) {
      //Access from MyIP
      this.securityGroup.connections.allowFrom( ec2.Peer.ipv4('100.100.100.100/32'), ec2.Port.tcpRange(1, 65535)); 
    }
    this.createDB();

    // --------------------------------------
    // User groups to split policies
    // Note: Maximum policy size of 2048 bytes exceeded for user
    const userGroup = new iam.Group(this, 'user-group-id', {
      groupName: `${this.appName}_${this.stageName}_festgroup`
    });
    userGroup.addUser(this.iamUser);

    // -------------------------------
    // Environment variables
    // this.envVars[`REGION`] = cdk.Stack.of(this).region;
    // this.envVars[`GX_FESTIVALTICKETS_QUEUEURL`] = ticketQueue.queueUrl;
    // this.envVars[`GX_DEFAULT_DB_URL`] = `jdbc:mysql://${this.dbServer.dbInstanceEndpointAddress}/festivaltickets?useSSL=false`;
    // this.envVars[`GX_DEFAULT_USER_ID`] = this.dbServer.secret?.secretValueFromJson('username');
    // this.envVars[`GX_DEFAULT_USER_PASSWORD`] = this.dbServer.secret?.secretValueFromJson('password');
    // this.envVars[`GX_DYNAMODBDS_USER_ID`] = this.accessKey.ref;
    // this.envVars[`GX_DYNAMODBDS_USER_PASSWORD`] = this.accessKey.attrSecretAccessKey;

    // -------------------------------------------------------------
    // Angular App Host
    // Maximum policy size of 2048 bytes exceeded for user
    const appGroup = new iam.Group(this, 'app-group-id', {
      groupName: `${this.appName}_${this.stageName}_appgroup`
    });
    appGroup.addUser(this.iamUser);    
    
    // ---------------------------------
    // Storage
    const storageBucket = new s3.Bucket(this, `${this.appName}-bucket`, {
      bucketName: `${this.appName}-${this.stageName}-bucket`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL
    });
    storageBucket.grantPutAcl(appGroup);
    storageBucket.grantReadWrite(appGroup);
    // Private access only
    // storageBucket.grantPublicAccess();

    // --------------------------------
    // AppRunner
    this.apprunnerRoleCreate();

    const vpc = this.vpc;
    const vpcConnector = new apprunner.VpcConnector(this, 'VpcConnector', {
      vpc,
      vpcSubnets: this.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }),
      vpcConnectorName: `${this.appName}_${this.stageName}_VpcConnector`,
      securityGroups: [this.securityGroup]
    });
    
    // const repositoryf = new ecr.Repository(this, 'Frontend-Repository',{
    //   repositoryName: `${this.appName}_${this.stageName}_frontend`,
    // });
    // repositoryf.grantPullPush(this.iamUser);
    // repositoryf.grantPullPush(this.serviceRole);

    // const imageAsset = new assets.DockerImageAsset(this, 'ImageAssets', {
    //   directory: path.join(__dirname, './docker.assets'),
    // });

    const appRunnerf = new apprunner.Service(this, 'Frontend-Apprunner', {
      serviceName: `${this.appName}_${this.stageName}_frontend`,
      source: apprunner.Source.fromEcr({
        imageConfiguration: { port: 8080 },
        repository: ecr.Repository.fromRepositoryName(this, 'frontend-repo', `${this.appName}_${this.stageName}_frontend`),
        tagOrDigest: 'latest',
      }),
      vpcConnector,
      accessRole: this.serviceRole
    });

    // const repositoryb = new ecr.Repository(this, 'Backend-Repository',{
    //   repositoryName: `${this.appName}_${this.stageName}_backend`,
    // });
    // repositoryb.grantPullPush(this.iamUser);
    // repositoryb.grantPullPush(this.serviceRole);

    const appRunnerb = new apprunner.Service(this, 'Backend-Apprunner', {
      serviceName: `${this.appName}_${this.stageName}_backend`,
      source: apprunner.Source.fromEcr({
        imageConfiguration: { port: 8080 },
        repository: ecr.Repository.fromRepositoryName(this, 'backend-repo', `${this.appName}_${this.stageName}_backend`),
        tagOrDigest: 'latest',
      }),
      vpcConnector,
      accessRole: this.serviceRole
    });

    // Generic
    new cdk.CfnOutput(this, "ApiName", {
      value: this.appName,
      description: "Application Name (API Name)",
    });
    new cdk.CfnOutput(this, "StageName", {
      value: this.stageName,
      description: "Stage Name",
    });
    
    new cdk.CfnOutput(this, "AccessKey", {
      value: this.accessKey.ref,
      description: "Access Key",
    });
    new cdk.CfnOutput(this, "AccessSecretKey", {
      value: this.accessKey.attrSecretAccessKey,
      description: "Access Secret Key",
    });

    new cdk.CfnOutput(this, 'frontend-apprunner-url', {
      value: 'https://' + appRunnerf.serviceUrl,
    });
    new cdk.CfnOutput(this, 'backend-apprunner-url', {
      value: 'https://' + appRunnerb.serviceUrl,
    });

    new cdk.CfnOutput(this, "StorageBucket", {
      value: storageBucket.bucketName,
      description: "Bucket for Storage Service",
    });
    
    // RDS MySQL
    new cdk.CfnOutput(this, "DBEndPoint", {
      value: this.dbServer.dbInstanceEndpointAddress,
      description: "RDS MySQL Endpoint",
    });
    
    new cdk.CfnOutput(this, 'DBSecretName', {
      value: this.dbServer.secret?.secretName!,
      description: "RDS MySQL Secret Name",
    });
    
    // Get access to the secret object
    const dbPasswordSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'db-pwd-id',
      this.dbServer.secret?.secretName!,
    );
  }

  private iamUserCreate(){
    const stack = cdk.Stack.of(this);

    this.iamUser = new iam.User(this, `app-user`);

    // Generic Policies
    // S3 gx-deploy will be used to deploy the app to aws
    
    this.iamUser.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:*"],
        resources: [`arn:aws:s3:::${this.appName}-${this.stageName}-bucket`, `arn:aws:s3:::${this.appName}-${this.stageName}-bucket*`],
      })
    );
    `arn:aws:s3:::${this.appName}-${this.stageName}-bucket`
    // Grant access to all application lambda functions
    this.iamUser.addToPolicy(
      new iam.PolicyStatement({
        actions: ["lambda:*"],
        resources: [
          `arn:aws:lambda:${stack.region}:${stack.account}:function:${this.appName}_*`,
        ],
      })
    );

    this.iamUser.addToPolicy(
      new iam.PolicyStatement({
        actions: ["apigateway:*"],
        resources: [`arn:aws:apigateway:${stack.region}::/restapis*`],
      })
    );

    this.accessKey = new iam.CfnAccessKey(this, `${this.appName}-accesskey`, {
      userName: this.iamUser.userName,
    });
  }

  private apprunnerRoleCreate(){
    this.serviceRole = new iam.Role(this, `apprunner-role`, {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal("build.apprunner.amazonaws.com"),
      ),
      description: "GeneXus Apprunner Application Service Role",
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSAppRunnerServicePolicyForECRAccess"
        ),
      ],
    });
  }

  private createDB(){
    const instanceIdentifier = `${this.appName}-${this.stageName}-db`;

    this.dbServer = new rds.DatabaseInstance(this, `app-db`, {
      publiclyAccessible: this.isDevEnv,
      vpcSubnets: {
        onePerAz: true,
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED
      },
      credentials: rds.Credentials.fromGeneratedSecret('dbadmin'),
      vpc: this.vpc,
      port: 3306,
      databaseName: this.appName,
      allocatedStorage: 30,
      maxAllocatedStorage: 200,
      instanceIdentifier,
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0
      }),
      securityGroups: [this.securityGroup],
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
      removalPolicy: this.isDevEnv ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN
    })
  }

  private createVPC(){
    this.vpc = new ec2.Vpc(this, `vpc`, {
      vpcName: `${this.appName}-${this.stageName}-vpc`,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'private_isolated',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        }
      ],
      maxAzs: 2
    });
  }
}