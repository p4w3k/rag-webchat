# rag-webchat

Embeddable webchat AI agent that answers visitors' questions about a company's products and services, grounded in the company's PDFs (retrieval-augmented generation) on AWS.

Architecture doc: https://claude.ai/artifact/YAPkxQYyVGgNt8rC95y8hs

## Status

| Phase | What | State |
| --- | --- | --- |
| 1 | PDF bucket, Bedrock Knowledge Base on S3 Vectors, auto re-sync, budget alert | this repo |
| 2 | Streaming chat API (Lambda) | next |
| 3 | Embeddable widget | planned |
| 4 | CloudFront + WAF, limits, alarms | planned |
| 5 | Evaluation set, launch | planned |

## Layout

```text
packages/
  shared/   chat API types and message schema (zod), shared by API and widget
  api/      Lambda handlers (ingest.ts: re-syncs the knowledge base when PDFs change)
infra/      AWS CDK app (TypeScript)
  lib/config.ts             all per-stage settings: region, models, chunking, budget
  lib/knowledge-base-stack.ts
  lib/cost-stack.ts
```

All configuration lives in this repo (`infra/lib/config.ts`). Secrets never do: keep them in AWS Secrets Manager or SSM Parameter Store and reference them by name.

## Prerequisites

- Node.js 22 (`nvm use`) and npm
- AWS CLI v2 signed in to your account (`aws sts get-caller-identity` works)
- In the Bedrock console for **eu-central-1**, confirm access to **Titan Text Embeddings V2** (`amazon.titan-embed-text-v2:0`)
- One-time CDK bootstrap of the account and region:

```bash
npx -w infra cdk bootstrap aws://<ACCOUNT_ID>/eu-central-1
```

## Deploy (dev)

1. Put your email in `budget.alertEmail` for `dev` in `infra/lib/config.ts` to get budget alerts (optional; the budget stack is skipped when it is empty).
2. Install and deploy:

```bash
npm install
npm run deploy:dev
```

The stack prints `DocsBucketName`, `KnowledgeBaseId` and `DataSourceId`.

## Add documents

Upload PDFs to the docs bucket. Each upload, replacement or deletion of a `.pdf` starts a knowledge base sync automatically:

```bash
aws s3 cp ./Katalog-2026.pdf s3://<DocsBucketName>/
```

Check sync status:

```bash
aws bedrock-agent list-ingestion-jobs --knowledge-base-id <KnowledgeBaseId> --data-source-id <DataSourceId> --region eu-central-1
```

## Test retrieval

Ask a question in Polish or English and see which passages come back:

```bash
aws bedrock-agent-runtime retrieve \
  --knowledge-base-id <KnowledgeBaseId> \
  --retrieval-query text="Ile kosztuje pakiet podstawowy?" \
  --region eu-central-1
```

You can also use **Test knowledge base** in the Bedrock console.

## Development

```bash
npm run typecheck   # all packages
npm test            # unit tests + CDK assertions
npm run synth       # render CloudFormation for the dev stage
```
