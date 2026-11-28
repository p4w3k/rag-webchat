# rag-webchat

Embeddable webchat AI agent that answers visitors' questions about a company's products and services, grounded in the company's PDFs (retrieval-augmented generation) on AWS.

Architecture doc: https://claude.ai/artifact/YAPkxQYyVGgNt8rC95y8hs

## Status

| Phase | What | State |
| --- | --- | --- |
| 1 | PDF bucket, Bedrock Knowledge Base on S3 Vectors, auto re-sync, budget alert | done |
| 2 | Streaming chat API (Lambda Function URL, SSE) | done |
| 3 | Embeddable widget, on the demo page | done |
| 4 | CloudFront + WAF, limits, alarms | planned (demo page on CloudFront done) |
| 5 | Evaluation set, launch | planned |

## Layout

```text
packages/
  shared/   chat API types and message schema (zod), shared by API and widget
  widget/   embeddable chat widget: one script, a <rag-webchat> element in Shadow DOM (no framework)
  api/      Lambda handlers
    src/ingest.ts       re-syncs the knowledge base when PDFs change
    src/chat/           chat API: request checks, RAG pipeline, prompts, DynamoDB store, voice (Transcribe URL, Polly)
site/       static demo webpage (Ciepłolux, a fictional company) where the widget gets embedded
infra/      AWS CDK app (TypeScript)
  lib/config.ts             all per-stage settings: region, models, chunking, budget, chat
  lib/knowledge-base-stack.ts
  lib/chat-stack.ts         chat API: streaming Lambda Function URL + DynamoDB
  lib/site-stack.ts         demo page: private S3 bucket + CloudFront (OAC, HTTPS), plus widget.js and its config
  lib/cost-stack.ts
```

All configuration lives in this repo (`infra/lib/config.ts`). Secrets never do: keep them in AWS Secrets Manager or SSM Parameter Store and reference them by name.

## Prerequisites

- Node.js 22 (`nvm use`) and npm
- AWS CLI v2 signed in to your account (`aws sts get-caller-identity` works)
- Bedrock model access in **eu-central-1** for **Titan Text Embeddings V2** (`amazon.titan-embed-text-v2:0`) and **Claude Haiku 5.5**. Check it with:

  ```bash
  aws bedrock get-foundation-model-availability --model-id amazon.titan-embed-text-v2:0 --region eu-central-1
  ```

  `authorizationStatus` must be `AUTHORIZED`. New AWS accounts may need a payment method on file or an AWS Support case before Bedrock models can be used.
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

The stacks print `DocsBucketName`, `KnowledgeBaseId`, `DataSourceId`, `ChatUrl` and `SiteUrl`.

## Automatic deploys (GitHub Actions)

Every push to `main` (a merged PR) runs the checks in `.github/workflows/ci.yml` and then deploys all dev stacks, the same as `npm run deploy:dev`. GitHub signs in to AWS through OpenID Connect, so no AWS keys are stored in GitHub. The role it uses (`infra/github/deploy-role.yaml`) only trusts this repository's `main` branch and can only use the CDK bootstrap roles, so it can deploy CDK stacks and do nothing else.

One-time setup, after the CDK bootstrap above:

1. Create the role (from the repo root, signed in to AWS as an admin). It prints the role ARN:

   ```bash
   npm run setup:github-deploy
   ```

   If it fails because the `token.actions.githubusercontent.com` identity provider already exists in the account, run the `aws cloudformation deploy` part of that script again with `--parameter-overrides CreateOidcProvider=false`.

2. Save the ARN as a repository variable named `AWS_DEPLOY_ROLE_ARN`, either in GitHub under **Settings → Secrets and variables → Actions → Variables → New repository variable**, or with the GitHub CLI:

   ```bash
   gh variable set AWS_DEPLOY_ROLE_ARN --repo p4w3k/rag-webchat --body "arn:aws:iam::<ACCOUNT_ID>:role/rag-webchat-github-deploy"
   ```

Until the variable is set, the deploy job is skipped. To deploy without a new commit, open **Actions → CI → Run workflow** on `main`. Prod is not deployed automatically; run `npm run deploy:prod` yourself.

## Demo webpage

`site/` holds a static page for a fictional company, served from a private S3 bucket through CloudFront over HTTPS. To deploy only the page:

```bash
npm run deploy:site:dev
```

It prints `SiteUrl` (`https://<id>.cloudfront.net`). Edit files in `site/` and run the same command again: the bucket is synced and the CloudFront cache cleared. A new distribution takes a few minutes to come online after the first deploy.

The page embeds the chat widget. Each deploy bundles `packages/widget` into `/widget.js` and writes `/widget-config.json` with the chat API URL and site key, so the Site stack now depends on the Chat stack (deploying the page also deploys the chat API if it changed).

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

## Chat API

`npm run deploy:dev` also deploys `RagWebchat-dev-Chat`, which prints `ChatUrl`. Send a question and watch the answer stream back as Server-Sent Events:

```bash
curl -N -X POST "<ChatUrl>" -H "content-type: application/json" \
  -d '{"siteKey":"dev-local","sessionId":"'"$(uuidgen | tr A-Z a-z)"'","message":"Ile kosztuje pompa Komfort 9?"}'
```

Events: `token` (a piece of the answer), `citations` (source PDFs and pages actually cited), `done`, or `error`. Reuse the same `sessionId` for follow-up questions.

Settings live in `chat` in `infra/lib/config.ts`: model (`eu.anthropic.claude-haiku-4-5-20251001-v1:0` by default, `eu.anthropic.claude-haiku-5-5` once the AWS account has Claude 5.x access; Claude runs through the EU cross-region inference profiles), company name, site key, allowed website origins, retrieval and history sizes, and rate limits (per IP per hour, per session per day). Dev allows any origin; set the real website origin for prod.

## Chat widget

One script tag adds a chat bubble in the bottom-right corner. It opens a panel (full screen on phones) that streams answers, lists the cited PDFs and pages, keeps the conversation while the visitor moves between pages, and speaks Polish or English based on the page's `lang`.

```html
<script src="https://<host>/widget.js" data-api-url="<ChatUrl>" data-site-key="<siteKey>" defer></script>
```

Options: `data-lang="pl|en"`, `data-title`, `data-color="#0b5d3b"`, or `data-config-url` to read `apiUrl` and `siteKey` from a JSON file (the demo page uses `/widget-config.json`). The website's origin must be in `chat.allowedOrigins` in `infra/lib/config.ts`.

Demo mode gives canned answers without calling the API, so the widget can be tried before Bedrock is enabled: add `?chatdemo=1` to the page URL, or `data-demo="true"` to the script tag (voice is off in demo mode). Build the bundle alone with `npm run build:widget` (output: `packages/widget/dist/widget.js`, about 11 KB gzipped).

## Voice

Visitors can talk to the assistant in Polish or English. The knowledge base and chat logic are the same as for typed questions; voice is a layer around them.

1. The visitor taps the microphone button. The widget asks the chat API (`POST <ChatUrl>voice/session`) for a presigned Amazon Transcribe streaming URL, valid for one minute and signed with the chat Lambda's role. The browser never gets AWS credentials.
2. Audio streams from the microphone straight to Transcribe (16 kHz PCM over WebSocket), which identifies Polish (`pl-PL`) or English (`en-US`) and returns text live; the text appears in the input box.
3. Recording stops when the visitor taps again, about 1.5 seconds after they stop talking, or at the time limit. The text is sent as a normal chat message, with `voice: true` so the answer is short and plain.
4. While the answer streams, the widget cuts it into sentences and asks `POST <ChatUrl>voice/speech` to read each one with an Amazon Polly neural voice (Ola for Polish, Joanna for English). The first sentence plays while the rest is still being written.

The speaker button in the header turns reading answers aloud on or off (remembered in the browser). It turns on by itself the first time the visitor uses the microphone, unless they switched it off before. Tapping the microphone also stops the voice.

Settings are in `chat.voice` in `infra/lib/config.ts`: `enabled`, the Polly voices, the recording limit (30 s), and caps on recordings and characters read aloud per session per day and per IP per hour. Set `enabled: false` to remove the microphone and the voice endpoints.

Embedding on another site: add `data-voice="true"` to the script tag (the demo page gets it from `widget-config.json`). The page must be served over HTTPS, and if it has a Content-Security-Policy, allow `connect-src wss://transcribestreaming.eu-central-1.amazonaws.com:8443` and the chat URL.

Cost: Transcribe streaming is about $0.024 per minute of speech and Polly neural about $16 per million characters, so a few spoken conversations a day cost cents per month. The per-session and per-IP caps bound the worst case.

## Development

```bash
npm run typecheck   # all packages
npm test            # unit tests + CDK assertions
npm run synth       # render CloudFormation for the dev stage
```
