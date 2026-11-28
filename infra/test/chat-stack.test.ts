import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { ChatStack } from "../lib/chat-stack.js";
import { getConfig } from "../lib/config.js";

const env = { account: "123456789012", region: "eu-central-1" };
const template = Template.fromStack(
  new ChatStack(new App(), "ChatTest", {
    env,
    config: getConfig("dev"),
    knowledgeBaseId: "KB123",
    knowledgeBaseArn: "arn:aws:bedrock:eu-central-1:123456789012:knowledge-base/KB123",
  }),
);

describe("ChatStack", () => {
  it("exposes the chat Lambda through a streaming Function URL limited to POST", () => {
    template.hasResourceProperties("AWS::Lambda::Url", {
      InvokeMode: "RESPONSE_STREAM",
      AuthType: "NONE",
      Cors: Match.objectLike({ AllowMethods: ["POST"] }),
    });
  });

  it("lets the Lambda retrieve from the knowledge base and call Claude, nothing broader", () => {
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: "bedrock:Retrieve", Resource: "arn:aws:bedrock:eu-central-1:123456789012:knowledge-base/KB123" }),
          Match.objectLike({ Action: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"] }),
        ]),
      },
    });
  });

  it("scopes model calls to the EU inference profile and its underlying model", () => {
    const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
    expect(policies).toContain(":inference-profile/eu.anthropic.claude-haiku-4-5-20251001-v1:0");
    expect(policies).toContain(":bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0");
  });

  it("lets the Lambda presign Transcribe streams and call Polly when voice is on", () => {
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: ["transcribe:StartStreamTranscriptionWebSocket", "polly:SynthesizeSpeech"], Resource: "*" }),
        ]),
      },
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: Match.objectLike({ VOICE_ENABLED: "true", POLLY_VOICE_PL: "Ola", VOICE_MAX_RECORDING_SECONDS: "30" }) },
    });
  });

  it("stores conversations in an on-demand table with TTL", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
      TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
    });
  });

  it("passes the model and limits from config", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: Match.objectLike({ MODEL_ID: "eu.anthropic.claude-haiku-4-5-20251001-v1:0", KNOWLEDGE_BASE_ID: "KB123", SITE_KEY: "dev-local" }) },
    });
  });
});
