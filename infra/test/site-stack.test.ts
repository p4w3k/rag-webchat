import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { getConfig } from "../lib/config.js";
import { SiteStack } from "../lib/site-stack.js";

describe("SiteStack", () => {
  const app = new App();
  const stack = new SiteStack(app, "Test", { config: getConfig("dev"), env: { account: "123456789012", region: "eu-central-1" } });
  const template = Template.fromStack(stack);

  it("keeps the bucket private", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    });
  });

  it("serves the bucket through CloudFront with OAC over HTTPS", () => {
    template.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: "index.html",
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: "redirect-to-https" }),
        Origins: [Match.objectLike({ OriginAccessControlId: Match.anyValue() })],
      }),
    });
  });

  it("only lets CloudFront read the bucket", () => {
    const policy = JSON.stringify(template.findResources("AWS::S3::BucketPolicy"));
    expect(policy).toContain("cloudfront.amazonaws.com");
    expect(policy).toContain("AWS:SourceArn");
  });

  it("uploads the site files and outputs the URL", () => {
    template.resourceCountIs("Custom::CDKBucketDeployment", 1);
    template.hasOutput("SiteUrl", {});
  });

  it("publishes the widget and its config when a chat URL is given", () => {
    const withChat = new SiteStack(new App(), "TestWithChat", {
      config: getConfig("dev"),
      chatUrl: "https://abc.lambda-url.eu-central-1.on.aws/",
      env: { account: "123456789012", region: "eu-central-1" },
    });
    const t = Template.fromStack(withChat);
    t.resourceCountIs("Custom::CDKBucketDeployment", 1);
    const deployment = Object.values(t.findResources("Custom::CDKBucketDeployment"))[0] as { Properties: { SourceObjectKeys: unknown[] } };
    // Page files, widget.js and widget-config.json, all in the one pruning deployment.
    expect(deployment.Properties.SourceObjectKeys).toHaveLength(3);
  });
});
