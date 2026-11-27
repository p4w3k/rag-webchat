// Globals the Node.js Lambda runtime provides for response streaming.
// https://docs.aws.amazon.com/lambda/latest/dg/response-streaming-tutorial.html
import type { Writable } from "node:stream";

declare global {
  namespace awslambda {
    interface HttpResponseMetadata {
      statusCode?: number;
      headers?: Record<string, string>;
    }
    type StreamingHandler<TEvent> = (event: TEvent, responseStream: Writable, context: unknown) => Promise<void>;
    function streamifyResponse<TEvent>(handler: StreamingHandler<TEvent>): StreamingHandler<TEvent>;
    const HttpResponseStream: {
      from(stream: Writable, metadata: HttpResponseMetadata): Writable;
    };
  }
}

export {};
