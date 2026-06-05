import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  parseTranscript,
  extractVoiceCompletion,
  extractCompletionPlain,
  type ParsedTranscript,
} from "../hooks/lib/transcript-parser";
// W13: both old paths must re-export the canonical module.
import { parseTranscript as parseViaPaiTools } from "../PAI/Tools/TranscriptParser";
import { parseTranscript as parseViaSkills } from "../skills/PAI/Tools/TranscriptParser";

const TEST_DIR = join(import.meta.dir, ".test-transcript-parser");

function jsonl(...entries: object[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n");
}

function writeTranscript(name: string, content: string): string {
  const p = join(TEST_DIR, name);
  writeFileSync(p, content);
  return p;
}

describe("TranscriptParser — W13 canonical + shims", () => {
  beforeAll(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  describe("canonical field name", () => {
    test("ParsedTranscript exposes completionSummary, not voiceCompletion", () => {
      const path = writeTranscript(
        "basic.jsonl",
        jsonl(
          { type: "user", message: { content: "do the thing" } },
          { type: "assistant", message: { content: "🎯 COMPLETED: did the thing" } }
        )
      );
      const parsed: ParsedTranscript = parseTranscript(path);
      expect(parsed).toHaveProperty("completionSummary");
      expect((parsed as any).voiceCompletion).toBeUndefined();
    });

    test("completionSummary is populated from the COMPLETED line", () => {
      const path = writeTranscript(
        "completed.jsonl",
        jsonl(
          { type: "user", message: { content: "go" } },
          { type: "assistant", message: { content: "work\n🎯 COMPLETED: all done here" } }
        )
      );
      const parsed = parseTranscript(path);
      expect(parsed.completionSummary).toContain("all done here");
    });

    test("plainCompletion field remains intact and separate", () => {
      const path = writeTranscript(
        "plain.jsonl",
        jsonl(
          { type: "user", message: { content: "go" } },
          { type: "assistant", message: { content: "🎯 COMPLETED: **fancy** result" } }
        )
      );
      const parsed = parseTranscript(path);
      expect(parsed).toHaveProperty("plainCompletion");
      // plain strips markdown emphasis
      expect(parsed.plainCompletion).not.toContain("**");
    });
  });

  describe("extraction functions still exported and working", () => {
    test("extractVoiceCompletion function name preserved (A2)", () => {
      expect(typeof extractVoiceCompletion).toBe("function");
      expect(extractVoiceCompletion("🎯 COMPLETED: hello")).toContain("hello");
    });

    test("extractCompletionPlain still exported", () => {
      expect(typeof extractCompletionPlain).toBe("function");
    });
  });

  describe("re-export shims resolve to the canonical module", () => {
    test("PAI/Tools shim parseTranscript === canonical parseTranscript", () => {
      expect(parseViaPaiTools).toBe(parseTranscript);
    });

    test("skills/PAI/Tools shim parseTranscript === canonical parseTranscript", () => {
      expect(parseViaSkills).toBe(parseTranscript);
    });

    test("both shims produce completionSummary-shaped output", () => {
      const path = writeTranscript(
        "shim.jsonl",
        jsonl(
          { type: "user", message: { content: "go" } },
          { type: "assistant", message: { content: "🎯 COMPLETED: via shim" } }
        )
      );
      expect(parseViaPaiTools(path)).toHaveProperty("completionSummary");
      expect(parseViaSkills(path)).toHaveProperty("completionSummary");
    });
  });

  describe("error handling unchanged", () => {
    test("missing file returns empty ParsedTranscript with completionSummary", () => {
      const parsed = parseTranscript(join(TEST_DIR, "nope.jsonl"));
      expect(parsed.completionSummary).toBe("");
      expect(parsed.responseState).toBe("completed");
    });
  });
});
