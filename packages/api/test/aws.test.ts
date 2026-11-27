import { describe, expect, it } from "vitest";
import { needsLegacyApiVersion, supportsEffort } from "../src/chat/aws.js";

describe("Bedrock model quirks", () => {
  it("uses the original Bedrock API version only for models before Claude 4.7", () => {
    expect(needsLegacyApiVersion("eu.anthropic.claude-haiku-4-5-20251001-v1:0")).toBe(true);
    expect(needsLegacyApiVersion("eu.anthropic.claude-sonnet-4-6")).toBe(true);
    expect(needsLegacyApiVersion("eu.anthropic.claude-opus-4-6-v1")).toBe(true);
    expect(needsLegacyApiVersion("eu.anthropic.claude-opus-4-7")).toBe(false);
    expect(needsLegacyApiVersion("eu.anthropic.claude-haiku-5-5")).toBe(false);
  });

  it("sends effort only to models that accept it", () => {
    expect(supportsEffort("eu.anthropic.claude-haiku-4-5-20251001-v1:0")).toBe(false);
    expect(supportsEffort("eu.anthropic.claude-sonnet-4-6")).toBe(true);
    expect(supportsEffort("eu.anthropic.claude-haiku-5-5")).toBe(true);
  });
});
