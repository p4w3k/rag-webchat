import { ChatRequest } from "@rag-webchat/shared";
import type { z } from "zod";
import type { ChatSettings } from "./settings.js";

export type RequestCheck<T = ChatRequest> =
  | { ok: true; request: T }
  | { ok: false; status: number; code: "invalid_request" | "forbidden"; message: string };

interface IncomingRequest {
  method: string;
  origin: string | undefined;
  body: string | undefined;
  isBase64Encoded: boolean;
}

/** Any request body the API accepts: all carry the public site key. */
type SiteRequest = z.ZodType<{ siteKey: string }>;

/** Validates method, origin, site key and body before any model or database call. */
export function checkRequest<S extends SiteRequest = typeof ChatRequest>(
  input: IncomingRequest,
  settings: Pick<ChatSettings, "siteKey" | "allowedOrigins">,
  schema?: S,
): RequestCheck<z.infer<S>> {
  if (input.method !== "POST") return { ok: false, status: 405, code: "invalid_request", message: "Use POST" };
  if (!isAllowedOrigin(input.origin, settings.allowedOrigins)) {
    return { ok: false, status: 403, code: "forbidden", message: "Origin not allowed" };
  }
  if (!input.body || input.body.length > 8_000) return { ok: false, status: 400, code: "invalid_request", message: "Missing or oversized body" };

  let json: unknown;
  try {
    json = JSON.parse(input.isBase64Encoded ? Buffer.from(input.body, "base64").toString("utf8") : input.body);
  } catch {
    return { ok: false, status: 400, code: "invalid_request", message: "Body is not valid JSON" };
  }
  const parsed = (schema ?? ChatRequest).safeParse(json);
  if (!parsed.success) return { ok: false, status: 400, code: "invalid_request", message: "Invalid request" };
  const request = parsed.data as z.infer<S>;
  if (request.siteKey !== settings.siteKey) return { ok: false, status: 403, code: "forbidden", message: "Unknown site key" };
  return { ok: true, request };
}

export function isAllowedOrigin(origin: string | undefined, allowed: string[]): boolean {
  if (allowed.includes("*")) return true;
  return origin !== undefined && allowed.includes(origin);
}
