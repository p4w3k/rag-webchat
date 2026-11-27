import { ConflictException, StartIngestionJobCommand } from "@aws-sdk/client-bedrock-agent";
import type { S3Event } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import { startSync } from "../src/ingest.js";

const event = (key: string) => ({ Records: [{ s3: { object: { key } } }] }) as unknown as S3Event;

describe("startSync", () => {
  it("starts an ingestion job for the configured knowledge base", async () => {
    const send = vi.fn().mockResolvedValue({ ingestionJob: { ingestionJobId: "job-1" } });
    const jobId = await startSync(event("Cennik+2026.pdf"), { send, knowledgeBaseId: "KB1", dataSourceId: "DS1" });

    expect(jobId).toBe("job-1");
    const command = send.mock.calls[0]?.[0] as StartIngestionJobCommand;
    expect(command.input).toMatchObject({ knowledgeBaseId: "KB1", dataSourceId: "DS1" });
    expect(command.input.description).toContain("Cennik 2026.pdf");
  });

  it("rethrows when a job is already running so Lambda retries later", async () => {
    const conflict = new ConflictException({ message: "busy", $metadata: {} });
    const send = vi.fn().mockRejectedValue(conflict);
    await expect(startSync(event("a.pdf"), { send, knowledgeBaseId: "KB1", dataSourceId: "DS1" })).rejects.toBe(conflict);
  });
});
