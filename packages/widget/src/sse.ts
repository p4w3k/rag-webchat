import type { ChatStreamEvent } from "@rag-webchat/shared";

/**
 * Incremental Server-Sent Events parser: feed it decoded text chunks as they
 * arrive and it returns the complete `data:` events found so far.
 */
export class SseParser {
  private buffer = "";

  push(chunk: string): ChatStreamEvent[] {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const events: ChatStreamEvent[] = [];
    let end: number;
    while ((end = this.buffer.indexOf("\n\n")) !== -1) {
      const raw = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const data = raw
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        events.push(JSON.parse(data) as ChatStreamEvent);
      } catch {
        // Ignore malformed events rather than breaking the conversation.
      }
    }
    return events;
  }
}
