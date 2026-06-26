import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let tmpPai = "";
const originalPaiDir = process.env.PAI_DIR;
const originalBedrock = process.env.CLAUDE_CODE_USE_BEDROCK;
const originalAwsProfile = process.env.AWS_PROFILE;
const originalAwsRegion = process.env.AWS_REGION;

async function mod() {
  return await import(`../hooks/lib/inference-telemetry.ts?cache=${Date.now()}`);
}

beforeEach(() => {
  tmpPai = mkdtempSync(join(tmpdir(), "pai-inference-telemetry-"));
  process.env.PAI_DIR = tmpPai;
  delete process.env.CLAUDE_CODE_USE_BEDROCK;
  delete process.env.AWS_PROFILE;
  delete process.env.AWS_REGION;
});

afterEach(() => {
  process.env.PAI_DIR = originalPaiDir;
  if (originalBedrock === undefined) delete process.env.CLAUDE_CODE_USE_BEDROCK;
  else process.env.CLAUDE_CODE_USE_BEDROCK = originalBedrock;
  if (originalAwsProfile === undefined) delete process.env.AWS_PROFILE;
  else process.env.AWS_PROFILE = originalAwsProfile;
  if (originalAwsRegion === undefined) delete process.env.AWS_REGION;
  else process.env.AWS_REGION = originalAwsRegion;
  rmSync(tmpPai, { recursive: true, force: true });
});

describe("inference telemetry", () => {
  test("classifies common error classes without storing prompts", async () => {
    const { classifyInferenceError } = await mod();
    expect(classifyInferenceError("Timeout after 12000ms")).toBe("timeout");
    expect(classifyInferenceError("AccessDeniedException")).toBe("auth");
    expect(classifyInferenceError("ECONNRESET")).toBe("network");
    expect(classifyInferenceError("rate limit exceeded")).toBe("rate_limit");
    expect(classifyInferenceError("Failed to parse JSON response")).toBe("parse");
  });

  test("detects Bedrock-backed Claude CLI from environment", async () => {
    const { inferProviderFromEnv } = await mod();
    expect(inferProviderFromEnv()).toBe("claude-cli");
    process.env.AWS_PROFILE = "dev";
    process.env.AWS_REGION = "us-west-2";
    expect(inferProviderFromEnv()).toBe("claude-cli");
    process.env.CLAUDE_CODE_USE_BEDROCK = "1";
    expect(inferProviderFromEnv()).toBe("bedrock-via-claude-cli");
  });

  test("emits and reads metadata-only latency events", async () => {
    const { emitInferenceTelemetry, readInferenceTelemetry } = await mod();
    expect(emitInferenceTelemetry({
      caller: "tests/example.ts",
      provider: "bedrock-via-claude-cli",
      model: "haiku",
      level: "fast",
      success: false,
      latency_ms: 12000,
      timeout_ms: 12000,
      error_class: "timeout",
    })).toBe(true);

    const events = readInferenceTelemetry();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("inference.latency");
    expect(events[0].caller).toBe("tests/example.ts");
    expect(JSON.stringify(events[0])).not.toContain("prompt");
    expect(JSON.stringify(events[0])).not.toContain("output");
  });
});
