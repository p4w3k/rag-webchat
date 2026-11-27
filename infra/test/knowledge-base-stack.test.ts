import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { getConfig } from "../lib/config.js";
import { KnowledgeBaseStack } from "../lib/knowledge-base-stack.js";

const synth = (stage: "dev" | "prod") => {
  const app = new App();
  const stack = new KnowledgeBaseStack(app, "Test", { config: getConfig(stage), env: { account: "123456789012", region: "eu-central-1" } });
  return Template.fromStack(stack);
};

describe("KnowledgeBaseStack", () => {
  const template = synth("dev");

  it("creates a 1024-dim cosine S3 Vectors index with Bedrock text keys non-filterable", () => {
    template.hasResourceProperties("AWS::S3Vectors::Index", {
      Dimension: 1024,
      DistanceMetric: "cosine",
      DataType: "float32",
      MetadataConfiguration: { NonFilterableMetadataKeys: ["AMAZON_BEDROCK_TEXT", "AMAZON_BEDROCK_METADATA"] },
    });
  });

  it("creates a vector knowledge base backed by S3 Vectors with Titan v2 embeddings", () => {
    template.hasResourceProperties("AWS::Bedrock::KnowledgeBase", {
      KnowledgeBaseConfiguration: {
        Type: "VECTOR",
      },
      StorageConfiguration: { Type: "S3_VECTORS" },
    });
    const kb = Object.values(template.findResources("AWS::Bedrock::KnowledgeBase"))[0];
    expect(JSON.stringify(kb)).toContain("foundation-model/amazon.titan-embed-text-v2:0");
  });

  it("creates the knowledge base only after its role policy exists", () => {
    const kb = Object.values(template.findResources("AWS::Bedrock::KnowledgeBase"))[0];
    expect(kb?.DependsOn).toEqual(expect.arrayContaining([expect.stringMatching(/^KnowledgeBaseRoleDefaultPolicy/)]));
  });

  it("keeps the docs bucket private", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    });
  });

  it("retains data in prod", () => {
    const prod = synth("prod");
    prod.hasResource("AWS::S3Vectors::Index", { DeletionPolicy: "Retain" });
    prod.hasResource("AWS::S3::Bucket", { DeletionPolicy: "Retain" });
  });
});
