/** Infrastructure assertions: security, async pipeline, and the cost controls claimed in the docs. */
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { SimplePointStack } from "../lib/stack.js";

const app = new cdk.App();
const stack = new SimplePointStack(app, "Test", { env: { account: "123456789012", region: "ap-northeast-1" } });
const t = Template.fromStack(stack);

describe("security", () => {
  it("buckets are private, encrypted and TLS-only", () => {
    t.resourceCountIs("AWS::S3::Bucket", 2);
    t.allResourcesProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
      BucketEncryption: Match.objectLike({}),
    });
    t.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Effect: "Deny", Condition: { Bool: { "aws:SecureTransport": "false" } } })]) },
    });
  });

  it("database is encrypted, private and uses a generated secret", () => {
    t.hasResourceProperties("AWS::RDS::DBInstance", { StorageEncrypted: true, PubliclyAccessible: false, MultiAZ: false });
    t.resourceCountIs("AWS::SecretsManager::Secret", 1);
  });

  it("dev login is disabled in the cloud", () => {
    const defs = t.findResources("AWS::ECS::TaskDefinition");
    for (const d of Object.values(defs)) {
      const env = (d as any).Properties.ContainerDefinitions[0].Environment as { Name: string; Value: string }[];
      expect(env.find((e) => e.Name === "SPL_DEV_AUTH")?.Value).toBe("0");
    }
  });
});

describe("async processing", () => {
  it("S3 upload -> Lambda -> SQS with a dead-letter queue", () => {
    t.hasResourceProperties("AWS::SQS::Queue", { RedrivePolicy: Match.objectLike({ maxReceiveCount: 3 }) });
    t.hasResourceProperties("AWS::Lambda::Function", { Runtime: "python3.13", Architectures: ["arm64"] });
    t.hasResourceProperties("Custom::S3BucketNotifications", {
      NotificationConfiguration: Match.objectLike({ LambdaFunctionConfigurations: Match.arrayWith([Match.objectLike({ Events: ["s3:ObjectCreated:*"] })]) }),
    });
  });
});

describe("cost controls", () => {
  it("no NAT gateways", () => {
    t.resourceCountIs("AWS::EC2::NatGateway", 0);
  });
  it("workers on Fargate Spot, ARM64, scale to zero", () => {
    t.hasResourceProperties("AWS::ECS::Service", {
      CapacityProviderStrategy: Match.arrayWith([Match.objectLike({ CapacityProvider: "FARGATE_SPOT", Weight: 4 })]),
    });
    t.hasResourceProperties("AWS::ApplicationAutoScaling::ScalableTarget", { MinCapacity: 0, MaxCapacity: 8 });
    const defs = Object.values(t.findResources("AWS::ECS::TaskDefinition")) as any[];
    expect(defs.every((d) => d.Properties.RuntimePlatform.CpuArchitecture === "ARM64")).toBe(true);
  });
  it("raw uploads age into cheaper storage classes", () => {
    t.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([Match.objectLike({ Transitions: Match.arrayWith([Match.objectLike({ StorageClass: "STANDARD_IA", TransitionInDays: 30 })]) })]),
      },
    });
  });
  it("tiles are cached by CloudFront; logs expire; a budget alarm exists", () => {
    t.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({ CacheBehaviors: Match.arrayWith([Match.objectLike({ PathPattern: "/tiles/*" })]) }),
    });
    t.resourceCountIs("AWS::Logs::LogGroup", 3);
    t.allResourcesProperties("AWS::Logs::LogGroup", { RetentionInDays: 14 });
    t.hasResourceProperties("AWS::Budgets::Budget", { Budget: Match.objectLike({ BudgetLimit: { Amount: 150, Unit: "USD" } }) });
  });
});

describe("least privilege", () => {
  it("only the worker can write tiles", () => {
    // per statement: an s3:PutObject action whose resource is the Tiles bucket
    const policies = Object.values(t.findResources("AWS::IAM::Policy")) as any[];
    const writesTiles = policies.filter((p) =>
      (p.Properties.PolicyDocument.Statement as any[]).some((st) => {
        const actions = ([] as string[]).concat(st.Action);
        return actions.some((a) => a.startsWith("s3:PutObject")) && JSON.stringify(st.Resource).includes("Tiles");
      }),
    );
    expect(writesTiles.length).toBe(1);
    expect(JSON.stringify(writesTiles[0].Properties.Roles)).toContain("WorkerQueueProcessingTaskDef");
    // and the API may only put into the raw bucket's uploads/ prefix
    const apiPut = policies.flatMap((p) => p.Properties.PolicyDocument.Statement as any[])
      .filter((st) => ([] as string[]).concat(st.Action).some((a) => a.startsWith("s3:PutObject")) && JSON.stringify(st.Resource).includes("RawUploads"));
    expect(apiPut.length).toBe(1);
    expect(JSON.stringify(apiPut[0].Resource)).toContain("/uploads/*");
  });
});

it("template snapshot", () => {
  expect(Object.keys(t.toJSON().Resources).length).toBeGreaterThan(40);
  expect(t.toJSON()).toMatchSnapshot();
});
