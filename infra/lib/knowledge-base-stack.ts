import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as s3vectors from "aws-cdk-lib/aws-s3vectors";
import type { Construct } from "constructs";
import type { StageConfig } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export interface KnowledgeBaseStackProps extends StackProps {
  config: StageConfig;
}

/**
 * Phase 1: where the company PDFs live and how they become searchable.
 * PDF bucket -> Bedrock Knowledge Base (embeddings) -> S3 Vectors index,
 * with a Lambda that re-syncs the knowledge base whenever a PDF changes.
 */
export class KnowledgeBaseStack extends Stack {
  readonly docsBucket: s3.Bucket;
  readonly knowledgeBase: bedrock.CfnKnowledgeBase;
  readonly dataSource: bedrock.CfnDataSource;

  constructor(scope: Construct, id: string, props: KnowledgeBaseStackProps) {
    super(scope, id, props);
    const { config } = props;
    const removalPolicy = config.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const prefix = `rag-webchat-${config.stage}`;

    // Source documents (PDFs). Private, encrypted, versioned so an overwritten file can be recovered.
    this.docsBucket = new s3.Bucket(this, "DocsBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(90) }],
      removalPolicy,
      autoDeleteObjects: !config.retainData,
    });

    // Vector store: S3 Vectors, pay per use with no idle cost.
    const vectorBucket = new s3vectors.CfnVectorBucket(this, "VectorBucket", {
      vectorBucketName: `${prefix}-vectors-${this.account}`,
    });
    vectorBucket.applyRemovalPolicy(removalPolicy);

    const vectorIndex = new s3vectors.CfnIndex(this, "VectorIndex", {
      vectorBucketArn: vectorBucket.attrVectorBucketArn,
      indexName: "docs",
      dataType: "float32",
      dimension: config.embeddingDimensions,
      distanceMetric: "cosine",
      // Bedrock stores the chunk text and its metadata under these keys. They must be
      // non-filterable, otherwise chunks exceed the filterable metadata size limit.
      metadataConfiguration: {
        nonFilterableMetadataKeys: ["AMAZON_BEDROCK_TEXT", "AMAZON_BEDROCK_METADATA"],
      },
    });
    vectorIndex.applyRemovalPolicy(removalPolicy);

    const embeddingModelArn = `arn:${this.partition}:bedrock:${this.region}::foundation-model/${config.embeddingModelId}`;

    // Role Bedrock assumes to read PDFs, call the embedding model and write vectors.
    const kbRole = new iam.Role(this, "KnowledgeBaseRole", {
      assumedBy: new iam.ServicePrincipal("bedrock.amazonaws.com", {
        conditions: {
          StringEquals: { "aws:SourceAccount": this.account },
          ArnLike: { "aws:SourceArn": `arn:${this.partition}:bedrock:${this.region}:${this.account}:knowledge-base/*` },
        },
      }),
    });
    this.docsBucket.grantRead(kbRole);
    kbRole.addToPolicy(new iam.PolicyStatement({ actions: ["bedrock:InvokeModel"], resources: [embeddingModelArn] }));
    kbRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "s3vectors:PutVectors",
          "s3vectors:GetVectors",
          "s3vectors:DeleteVectors",
          "s3vectors:QueryVectors",
          "s3vectors:GetIndex",
        ],
        resources: [vectorIndex.attrIndexArn],
      }),
    );

    this.knowledgeBase = new bedrock.CfnKnowledgeBase(this, "KnowledgeBase", {
      name: `${prefix}-kb`,
      description: "Company product and service documents for the webchat agent",
      roleArn: kbRole.roleArn,
      knowledgeBaseConfiguration: {
        type: "VECTOR",
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn,
          embeddingModelConfiguration: {
            bedrockEmbeddingModelConfiguration: {
              dimensions: config.embeddingDimensions,
              embeddingDataType: "FLOAT32",
            },
          },
        },
      },
      storageConfiguration: {
        type: "S3_VECTORS",
        s3VectorsConfiguration: { indexArn: vectorIndex.attrIndexArn },
      },
    });
    // Bedrock validates the role's permissions on create, so the policy must exist first.
    this.knowledgeBase.node.addDependency(kbRole);

    this.dataSource = new bedrock.CfnDataSource(this, "DocsDataSource", {
      knowledgeBaseId: this.knowledgeBase.attrKnowledgeBaseId,
      name: `${prefix}-docs`,
      dataDeletionPolicy: "DELETE",
      dataSourceConfiguration: {
        type: "S3",
        s3Configuration: { bucketArn: this.docsBucket.bucketArn },
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: "FIXED_SIZE",
          fixedSizeChunkingConfiguration: config.chunking,
        },
      },
    });

    // Re-sync the knowledge base whenever a PDF is added, replaced or deleted.
    const ingestFn = new NodejsFunction(this, "IngestFunction", {
      entry: path.join(here, "../../packages/api/src/ingest.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.seconds(30),
      memorySize: 256,
      retryAttempts: 2,
      environment: {
        KNOWLEDGE_BASE_ID: this.knowledgeBase.attrKnowledgeBaseId,
        DATA_SOURCE_ID: this.dataSource.attrDataSourceId,
      },
      logGroup: new logs.LogGroup(this, "IngestLogs", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      bundling: { format: OutputFormat.ESM, minify: true, sourceMap: true },
    });
    ingestFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:StartIngestionJob"],
        resources: [this.knowledgeBase.attrKnowledgeBaseArn],
      }),
    );
    const target = new s3n.LambdaDestination(ingestFn);
    this.docsBucket.addEventNotification(s3.EventType.OBJECT_CREATED, target, { suffix: ".pdf" });
    this.docsBucket.addEventNotification(s3.EventType.OBJECT_REMOVED, target, { suffix: ".pdf" });

    new CfnOutput(this, "DocsBucketName", { value: this.docsBucket.bucketName });
    new CfnOutput(this, "KnowledgeBaseId", { value: this.knowledgeBase.attrKnowledgeBaseId });
    new CfnOutput(this, "DataSourceId", { value: this.dataSource.attrDataSourceId });
  }
}
