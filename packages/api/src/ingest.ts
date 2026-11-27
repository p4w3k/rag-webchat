import { BedrockAgentClient, ConflictException, StartIngestionJobCommand } from "@aws-sdk/client-bedrock-agent";
import type { S3Event } from "aws-lambda";

const client = new BedrockAgentClient({});

export interface IngestDeps {
  send: (command: StartIngestionJobCommand) => Promise<{ ingestionJob?: { ingestionJobId?: string } }>;
  knowledgeBaseId: string;
  dataSourceId: string;
}

/**
 * Starts a Knowledge Base sync when PDFs are added, replaced or deleted in the
 * docs bucket. Bedrock runs one ingestion job per data source at a time: if one
 * is already running we rethrow, so Lambda's async retries (about 1 and 3 minutes
 * later) start a fresh sync that picks up this change too.
 */
export async function startSync(event: S3Event, deps: IngestDeps): Promise<string | undefined> {
  const keys = event.Records.map((r) => decodeURIComponent(r.s3.object.key.replace(/\+/g, " ")));
  console.log(JSON.stringify({ msg: "docs changed", keys }));

  try {
    const res = await deps.send(
      new StartIngestionJobCommand({
        knowledgeBaseId: deps.knowledgeBaseId,
        dataSourceId: deps.dataSourceId,
        description: `S3 change: ${keys.slice(0, 5).join(", ")}`.slice(0, 200),
      }),
    );
    const jobId = res.ingestionJob?.ingestionJobId;
    console.log(JSON.stringify({ msg: "ingestion job started", jobId }));
    return jobId;
  } catch (err) {
    if (err instanceof ConflictException) {
      console.warn(JSON.stringify({ msg: "ingestion job already running, will retry" }));
    }
    throw err;
  }
}

export const handler = async (event: S3Event): Promise<void> => {
  await startSync(event, {
    send: (command) => client.send(command),
    knowledgeBaseId: requiredEnv("KNOWLEDGE_BASE_ID"),
    dataSourceId: requiredEnv("DATA_SOURCE_ID"),
  });
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}
