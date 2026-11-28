import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import type { StageConfig } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export interface ChatStackProps extends StackProps {
  config: StageConfig;
  knowledgeBaseId: string;
  knowledgeBaseArn: string;
}

/**
 * Phase 2: the streaming chat API. A Lambda behind a Function URL (response
 * streaming) runs the RAG loop: history from DynamoDB, passages from the
 * knowledge base, answer from Claude in Amazon Bedrock, streamed as SSE.
 * With voice on, the same function presigns Amazon Transcribe streaming URLs
 * for the microphone (/voice/session) and reads answers aloud with Amazon Polly (/voice/speech).
 */
export class ChatStack extends Stack {
  readonly chatUrl: lambda.FunctionUrl;

  constructor(scope: Construct, id: string, props: ChatStackProps) {
    super(scope, id, props);
    const { config } = props;
    const chat = config.chat;

    const table = new dynamodb.Table(this, "ChatTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: config.retainData },
      removalPolicy: config.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    const fn = new NodejsFunction(this, "ChatFunction", {
      entry: path.join(here, "../../packages/api/src/chat/handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(60),
      environment: {
        TABLE_NAME: table.tableName,
        KNOWLEDGE_BASE_ID: props.knowledgeBaseId,
        MODEL_ID: chat.modelId,
        COMPANY_NAME: chat.companyName,
        SITE_KEY: chat.siteKey,
        ALLOWED_ORIGINS: chat.allowedOrigins.join(","),
        RETRIEVAL_RESULTS: String(chat.retrievalResults),
        HISTORY_MESSAGES: String(chat.historyMessages),
        MAX_OUTPUT_TOKENS: String(chat.maxOutputTokens),
        MAX_REQUESTS_PER_IP_PER_HOUR: String(chat.maxRequestsPerIpPerHour),
        MAX_MESSAGES_PER_SESSION_PER_DAY: String(chat.maxMessagesPerSessionPerDay),
        ...(chat.voice.enabled
          ? {
              VOICE_ENABLED: "true",
              POLLY_VOICE_PL: chat.voice.pollyVoicePl,
              POLLY_VOICE_EN: chat.voice.pollyVoiceEn,
              VOICE_MAX_RECORDING_SECONDS: String(chat.voice.maxRecordingSeconds),
              VOICE_MAX_RECORDINGS_PER_SESSION_PER_DAY: String(chat.voice.maxRecordingsPerSessionPerDay),
              VOICE_MAX_RECORDINGS_PER_IP_PER_HOUR: String(chat.voice.maxRecordingsPerIpPerHour),
              VOICE_MAX_SPEECH_CHARS_PER_SESSION_PER_DAY: String(chat.voice.maxSpeechCharsPerSessionPerDay),
              VOICE_MAX_SPEECH_CHARS_PER_IP_PER_HOUR: String(chat.voice.maxSpeechCharsPerIpPerHour),
            }
          : {}),
      },
      logGroup: new logs.LogGroup(this, "ChatLogs", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      bundling: {
        format: OutputFormat.ESM,
        minify: true,
        sourceMap: true,
        // Some bundled CommonJS dependencies call require(); give the ESM bundle one.
        banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
      },
    });

    table.grantReadWriteData(fn);
    fn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ["bedrock:Retrieve"], resources: [props.knowledgeBaseArn] }),
    );
    // The EU inference profile routes each request to one of the EU regions, so the
    // role needs the profile itself plus the underlying model in every region.
    const baseModelId = chat.modelId.replace(/^(eu|us|apac|jp|au|ca|global)\./, "");
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: [
          `arn:${this.partition}:bedrock:${this.region}:${this.account}:inference-profile/${chat.modelId}`,
          `arn:${this.partition}:bedrock:*::foundation-model/${baseModelId}`,
        ],
      }),
    );

    if (chat.voice.enabled) {
      // The Lambda presigns Transcribe streaming URLs for the browser with its own role, and calls Polly.
      // Neither action supports resource-level permissions, so the resource is "*".
      fn.addToRolePolicy(
        new iam.PolicyStatement({ actions: ["transcribe:StartStreamTranscriptionWebSocket", "polly:SynthesizeSpeech"], resources: ["*"] }),
      );
    }

    this.chatUrl = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
      cors: {
        allowedOrigins: chat.allowedOrigins,
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ["content-type"],
        maxAge: Duration.hours(1),
      },
    });

    new CfnOutput(this, "ChatUrl", { value: this.chatUrl.url });
    new CfnOutput(this, "SiteKey", { value: chat.siteKey });
  }
}
