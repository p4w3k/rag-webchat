import { describe, expect, it } from "vitest";
import { checkRequest } from "../src/chat/request.js";

const settings = { siteKey: "site-123", allowedOrigins: ["https://example.com"] };
const body = JSON.stringify({ siteKey: "site-123", sessionId: "1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b", message: "Hej" });
const base = { method: "POST", origin: "https://example.com", body, isBase64Encoded: false };

describe("checkRequest", () => {
  it("accepts a valid request from an allowed origin", () => {
    const res = checkRequest(base, settings);
    expect(res.ok && res.request.message).toBe("Hej");
  });

  it("rejects other origins, wrong site keys, bad JSON and other methods", () => {
    expect(checkRequest({ ...base, origin: "https://evil.example" }, settings)).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest({ ...base, body: body.replace("site-123", "nope") }, settings)).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest({ ...base, body: "{" }, settings)).toMatchObject({ ok: false, status: 400 });
    expect(checkRequest({ ...base, method: "GET" }, settings)).toMatchObject({ ok: false, status: 405 });
  });

  it("rejects messages over the length limit", () => {
    const long = JSON.stringify({ ...JSON.parse(body), message: "x".repeat(1001) });
    expect(checkRequest({ ...base, body: long }, settings)).toMatchObject({ ok: false, status: 400 });
  });

  it("decodes base64 bodies", () => {
    const res = checkRequest({ ...base, body: Buffer.from(body).toString("base64"), isBase64Encoded: true }, settings);
    expect(res.ok).toBe(true);
  });
});
