/**
 * Simple-Point Lite on AWS (synthesised and tested, never deployed in this demo).
 *
 *   browser ──► CloudFront ──► S3 tiles bucket (immutable octree nodes, cached at the edge)
 *      │                └───► ALB ──► ECS Fargate "api" (FastAPI, ARM64)
 *      │ presigned PUT
 *      ▼
 *   S3 raw bucket ──ObjectCreated──► Lambda (validate LAS/LAZ/E57 header) ──► SQS ingest queue (+DLQ)
 *                                                                              │
 *                                       ECS Fargate SPOT "worker" (0..N, scales on queue depth) ◄─┘
 *                                       reads raw, writes tiles, updates RDS PostgreSQL
 *
 * Cost controls: Fargate Spot + scale-to-zero workers, Graviton (ARM64), no NAT gateways
 * (public subnets with security groups; S3 via a free gateway endpoint), S3 lifecycle
 * (raw -> Infrequent Access -> Glacier IR), CloudFront in front of S3, 14-day log retention,
 * single-AZ t4g.micro database, and an AWS Budgets alarm.
 */
import * as cdk from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

export interface SimplePointProps extends cdk.StackProps {
  imageTag?: string;
  monthlyBudgetUsd?: number;
  budgetEmail?: string;
}

export class SimplePointStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SimplePointProps = {}) {
    super(scope, id, props);
    const imageTag = props.imageTag ?? "latest";

    // ---------------------------------------------------------------- storage
    const raw = new s3.Bucket(this, "RawUploads", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      cors: [{ allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST], allowedOrigins: ["*"], allowedHeaders: ["*"] }],
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: cdk.Duration.days(2) },
        {
          transitions: [
            { storageClass: s3.StorageClass.INFREQUENT_ACCESS, transitionAfter: cdk.Duration.days(30) },
            { storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL, transitionAfter: cdk.Duration.days(120) },
          ],
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const tiles = new s3.Bucket(this, "Tiles", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ---------------------------------------------------------------- async ingest queue
    const dlq = new sqs.Queue(this, "IngestDLQ", { retentionPeriod: cdk.Duration.days(14), enforceSSL: true });
    const queue = new sqs.Queue(this, "IngestQueue", {
      visibilityTimeout: cdk.Duration.minutes(30), // octree builds of tens of GB take a while
      deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
      enforceSSL: true,
    });

    const notifier = new lambda.Function(this, "UploadNotifier", {
      runtime: lambda.Runtime.PYTHON_3_13,
      architecture: lambda.Architecture.ARM_64,
      handler: "index.handler",
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logRetention: logs.RetentionDays.TWO_WEEKS,
      environment: { QUEUE_URL: queue.queueUrl },
      code: lambda.Code.fromInline(`
import json, os, boto3
s3 = boto3.client("s3"); sqs = boto3.client("sqs")
MAGIC = {b"LASF": "las", b"ASTM": "e57", b"ply\\n": "ply"}
def handler(event, _ctx):
    for rec in event["Records"]:
        b, k = rec["s3"]["bucket"]["name"], rec["s3"]["object"]["key"]
        head = s3.get_object(Bucket=b, Key=k, Range="bytes=0-3")["Body"].read()
        fmt = MAGIC.get(head) or (k.rsplit(".", 1)[-1].lower() if k.lower().endswith((".pts", ".xyz")) else None)
        if fmt is None:
            print(json.dumps({"rejected": k, "magic": head.hex()})); continue
        sqs.send_message(QueueUrl=os.environ["QUEUE_URL"], MessageBody=json.dumps({"bucket": b, "key": k, "format": fmt}))
`),
    });
    raw.grantRead(notifier);
    queue.grantSendMessages(notifier);
    raw.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(notifier), { prefix: "uploads/" });

    // ---------------------------------------------------------------- network (no NAT gateways)
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC },
        { name: "db", subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
      gatewayEndpoints: { S3: { service: ec2.GatewayVpcEndpointAwsService.S3 } },
    });

    // ---------------------------------------------------------------- database
    const db = new rds.DatabaseInstance(this, "Db", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      multiAz: false,
      allocatedStorage: 20,
      storageEncrypted: true,
      backupRetention: cdk.Duration.days(7),
      credentials: rds.Credentials.fromGeneratedSecret("spl"),
      databaseName: "spl",
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    });

    // ---------------------------------------------------------------- compute
    const repo = new ecr.Repository(this, "BackendRepo", {
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 10 }],
    });
    const image = ecs.ContainerImage.fromEcrRepository(repo, imageTag);
    const cluster = new ecs.Cluster(this, "Cluster", { vpc, enableFargateCapacityProviders: true, containerInsightsV2: ecs.ContainerInsights.DISABLED });
    const runtimePlatform = { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX };
    const env = {
      SPL_STORAGE: "s3",
      SPL_RAW_BUCKET: raw.bucketName,
      SPL_TILES_BUCKET: tiles.bucketName,
      SPL_QUEUE_URL: queue.queueUrl,
      SPL_DEV_AUTH: "0",
      SPL_SEED: "0",
    };
    const secrets = {
      SPL_DB_HOST: ecs.Secret.fromSecretsManager(db.secret!, "host"),
      SPL_DB_PASSWORD: ecs.Secret.fromSecretsManager(db.secret!, "password"),
    };

    const api = new ecsPatterns.ApplicationLoadBalancedFargateService(this, "Api", {
      cluster,
      cpu: 512,
      memoryLimitMiB: 1024,
      desiredCount: 1,
      minHealthyPercent: 100, // keep serving during deployments
      circuitBreaker: { rollback: true },
      runtimePlatform,
      assignPublicIp: true, // public subnets instead of NAT gateways (~$32/month each saved)
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      taskImageOptions: {
        image,
        containerPort: 8000,
        environment: env,
        secrets,
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: "api", logRetention: logs.RetentionDays.TWO_WEEKS }),
      },
      publicLoadBalancer: true,
    });
    api.targetGroup.configureHealthCheck({ path: "/api/health" });
    const apiScaling = api.service.autoScaleTaskCount({ minCapacity: 1, maxCapacity: 4 });
    apiScaling.scaleOnCpuUtilization("Cpu", { targetUtilizationPercent: 70 });

    const worker = new ecsPatterns.QueueProcessingFargateService(this, "Worker", {
      cluster,
      queue,
      image,
      command: ["python", "-m", "app.worker"],
      cpu: 4096,
      memoryLimitMiB: 16384, // octree builds of large clouds are memory-bound
      runtimePlatform,
      assignPublicIp: true,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      minScalingCapacity: 0, // scale to zero when the queue is empty
      minHealthyPercent: 0,
      circuitBreaker: { rollback: true },
      maxScalingCapacity: 8,
      scalingSteps: [
        { upper: 0, change: -1 },
        { lower: 1, change: +1 },
        { lower: 20, change: +3 },
      ],
      capacityProviderStrategies: [
        { capacityProvider: "FARGATE_SPOT", weight: 4 },
        { capacityProvider: "FARGATE", weight: 1 },
      ],
      environment: env,
      secrets,
      logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: "worker", logRetention: logs.RetentionDays.TWO_WEEKS }),
    });

    // ---------------------------------------------------------------- least-privilege IAM
    const apiRole = api.taskDefinition.taskRole;
    raw.grantPut(apiRole, "uploads/*"); // presigned upload URLs only
    tiles.grantRead(apiRole);
    queue.grantSendMessages(apiRole);
    const workerRole = worker.taskDefinition.taskRole;
    raw.grantRead(workerRole);
    tiles.grantReadWrite(workerRole);
    for (const svc of [api.service, worker.service]) db.connections.allowDefaultPortFrom(svc);
    workerRole.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ["cloudwatch:PutMetricData"], resources: ["*"], conditions: { StringEquals: { "cloudwatch:namespace": "SimplePoint" } } }));

    // ---------------------------------------------------------------- CDN
    const cdn = new cloudfront.Distribution(this, "Cdn", {
      defaultBehavior: {
        origin: new origins.LoadBalancerV2Origin(api.loadBalancer, { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY }),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        "/tiles/*": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(tiles),
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED, // nodes are immutable per dataset version
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200, // includes Japan, excludes the most expensive edges
    });

    // ---------------------------------------------------------------- cost guard-rail
    new budgets.CfnBudget(this, "MonthlyBudget", {
      budget: {
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: props.monthlyBudgetUsd ?? 150, unit: "USD" },
        costFilters: { TagKeyValue: ["user:app$simple-point-lite"] },
      },
      notificationsWithSubscribers: [
        {
          notification: { comparisonOperator: "GREATER_THAN", notificationType: "FORECASTED", threshold: 80, thresholdType: "PERCENTAGE" },
          subscribers: [{ subscriptionType: "EMAIL", address: props.budgetEmail ?? "ops@example.com" }],
        },
      ],
    });
    cdk.Tags.of(this).add("app", "simple-point-lite");

    new cdk.CfnOutput(this, "Url", { value: `https://${cdn.distributionDomainName}` });
    new cdk.CfnOutput(this, "RawBucket", { value: raw.bucketName });
    new cdk.CfnOutput(this, "EcrRepo", { value: repo.repositoryUri });
  }
}
