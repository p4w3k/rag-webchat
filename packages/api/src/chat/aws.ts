import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import { BedrockAgentRuntimeClient, RetrieveCommand, type KnowledgeBaseRetrievalResult } from "@aws-sdk/client-bedrock-agent-runtime";
import type { ModelResult } from "./rag.js";
import type { Passage, PromptMessage } from "./prompt.js";

/**
 * Claude on Amazon Bedrock through the bedrock-runtime endpoint (InvokeModel).
 * In eu-central-1 Claude Haiku 5.5 is served only there, through the EU
 * cross-region inference profile (eu.anthropic.*); bedrock-mantle doesn't offer it.
 */
export class ClaudeModel {
  private readonly client: AnthropicBedrock;

  constructor(
    region: string,
    private readonly modelId: string,
  ) {
    this.client = new AnthropicBedrock({ awsRegion: region, maxRetries: 2, timeout: 25_000 });
  }

  async complete(system: string, messages: PromptMessage[], maxTokens: number): Promise<ModelResult> {
    const msg = await this.client.messages.create({
      model: this.modelId,
      max_tokens: maxTokens,
      system,
      messages,
      output_config: { effort: "low" },
    });
    return { text: textOf(msg.content), stopReason: msg.stop_reason };
  }

  async stream(system: string, messages: PromptMessage[], maxTokens: number, onText: (text: string) => void): Promise<ModelResult> {
    const stream = this.client.messages.stream({
      model: this.modelId,
      max_tokens: maxTokens,
      // The system prompt is identical on every request, so cache it.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages,
      output_config: { effort: "low" },
    });
    stream.on("text", (text) => onText(text));
    const msg = await stream.finalMessage();
    return { text: textOf(msg.content), stopReason: msg.stop_reason };
  }
}

function textOf(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

export class KnowledgeBase {
  private readonly client: BedrockAgentRuntimeClient;

  constructor(
    region: string,
    private readonly knowledgeBaseId: string,
    private readonly numberOfResults: number,
  ) {
    this.client = new BedrockAgentRuntimeClient({ region });
  }

  async retrieve(query: string): Promise<Passage[]> {
    const res = await this.client.send(
      new RetrieveCommand({
        knowledgeBaseId: this.knowledgeBaseId,
        retrievalQuery: { text: query.slice(0, 1000) },
        retrievalConfiguration: { vectorSearchConfiguration: { numberOfResults: this.numberOfResults } },
      }),
    );
    return (res.retrievalResults ?? []).flatMap(toPassage);
  }
}

export function toPassage(r: KnowledgeBaseRetrievalResult): Passage[] {
  const text = r.content?.text;
  if (!text) return [];
  const uri = r.location?.s3Location?.uri;
  const page = Number(r.metadata?.["x-amz-bedrock-kb-document-page-number"]);
  return [
    {
      text,
      title: uri ? decodeURIComponent(uri.split("/").pop() ?? uri) : "document",
      ...(uri ? { uri } : {}),
      ...(Number.isInteger(page) && page > 0 ? { page } : {}),
      ...(r.score !== undefined ? { score: r.score } : {}),
    },
  ];
}
