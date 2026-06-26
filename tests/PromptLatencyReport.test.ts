import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { analyzeTranscriptFile } from "../scripts/prompt-latency-report";

function writeJsonl(rows: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "pai-prompt-latency-"));
  const file = join(dir, "session.jsonl");
  writeFileSync(file, rows.map(r => JSON.stringify(r)).join("\n") + "\n");
  return file;
}

describe("prompt-latency-report", () => {
  test("separates pre-response, queue, hook, and tool latency", () => {
    const file = writeJsonl([
      { type: "user", timestamp: "2026-06-24T20:00:00.000Z", message: { content: "review PR" } },
      { type: "queue-operation", operation: "enqueue", timestamp: "2026-06-24T20:00:01.000Z" },
      { type: "queue-operation", operation: "dequeue", timestamp: "2026-06-24T20:00:04.000Z" },
      { type: "hook", hook_name: "UserPromptSubmit:MemRecall", durationMs: 250, timestamp: "2026-06-24T20:00:05.000Z" },
      { type: "tool-result", durationMs: 1000, timestamp: "2026-06-24T20:00:08.000Z" },
      {
        type: "assistant",
        timestamp: "2026-06-24T20:00:10.000Z",
        message: {
          model: "claude-opus-4-8",
          content: [{ type: "thinking" }, { type: "tool_use" }],
          stop_reason: "tool_use",
          usage: {
            input_tokens: 2,
            cache_creation_input_tokens: 1896,
            cache_read_input_tokens: 407372,
            output_tokens: 4390,
            service_tier: "standard",
            speed: "standard",
          },
        },
        turn_duration: 12000,
      },
    ]);
    try {
      const [turn] = analyzeTranscriptFile(file);
      expect(turn.prompt_preview).toBe("review PR");
      expect(turn.pre_response_ms).toBe(10_000);
      expect(turn.queue_wait_ms).toBe(3_000);
      expect(turn.pre_response_hook_duration_ms).toBe(250);
      expect(turn.pre_response_hook_count).toBe(1);
      expect(turn.after_last_pre_response_hook_ms).toBe(5_000);
      expect(turn.hook_duration_ms).toBe(250);
      expect(turn.tool_duration_ms).toBe(1000);
      expect(turn.turn_duration_ms).toBe(12000);
      expect(turn.slowest_hook?.name).toBe("UserPromptSubmit:MemRecall");
      expect(turn.pre_response_slowest_hook?.name).toBe("UserPromptSubmit:MemRecall");
      expect(turn.first_assistant).toEqual({
        model: "claude-opus-4-8",
        stop_reason: "tool_use",
        content_types: ["thinking", "tool_use"],
        input_tokens: 2,
        cache_read_input_tokens: 407372,
        cache_creation_input_tokens: 1896,
        output_tokens: 4390,
        service_tier: "standard",
        speed: "standard",
      });
    } finally {
      rmSync(dirname(file), { recursive: true, force: true });
    }
  });

  test("does not merge events across the next user turn", () => {
    const file = writeJsonl([
      { type: "user", timestamp: 1000, message: { content: "first" } },
      { type: "assistant", timestamp: 2000, message: { content: "one" } },
      { type: "user", timestamp: 3000, message: { content: "second" } },
      { type: "hook", timestamp: 3500, hookName: "UserPromptSubmit:SecretScanner", duration_ms: 50 },
      { type: "assistant", timestamp: 5000, message: { content: "two" } },
    ]);
    try {
      const turns = analyzeTranscriptFile(file);
      expect(turns).toHaveLength(2);
      expect(turns[0].prompt_preview).toBe("first");
      expect(turns[0].hook_count).toBe(0);
      expect(turns[1].prompt_preview).toBe("second");
      expect(turns[1].hook_count).toBe(1);
    } finally {
      rmSync(dirname(file), { recursive: true, force: true });
    }
  });

  test("separates pre-response hooks from hooks later in the same turn", () => {
    const file = writeJsonl([
      { type: "user", timestamp: "2026-06-24T20:00:00.000Z", message: { content: "implement it" } },
      { type: "hook", hook_name: "UserPromptSubmit:MemRecall", durationMs: 200, timestamp: "2026-06-24T20:00:01.000Z" },
      { type: "assistant", timestamp: "2026-06-24T20:00:40.000Z", message: { content: "I will edit." } },
      { type: "hook", hook_name: "PreToolUse:Edit", durationMs: 95, timestamp: "2026-06-24T20:00:45.000Z" },
    ]);
    try {
      const [turn] = analyzeTranscriptFile(file);
      expect(turn.pre_response_ms).toBe(40_000);
      expect(turn.pre_response_hook_duration_ms).toBe(200);
      expect(turn.pre_response_hook_count).toBe(1);
      expect(turn.after_last_pre_response_hook_ms).toBe(39_000);
      expect(turn.hook_duration_ms).toBe(295);
      expect(turn.hook_count).toBe(2);
      expect(turn.pre_response_slowest_hook?.name).toBe("UserPromptSubmit:MemRecall");
      expect(turn.slowest_hook?.name).toBe("UserPromptSubmit:MemRecall");
    } finally {
      rmSync(dirname(file), { recursive: true, force: true });
    }
  });

  test("does not treat async hook response attachments as current blocking hooks", () => {
    const file = writeJsonl([
      { type: "user", timestamp: "2026-06-24T20:00:00.000Z", message: { content: "slow prompt" } },
      {
        type: "attachment",
        timestamp: "2026-06-24T20:00:00.000Z",
        attachment: {
          type: "async_hook_response",
          hookName: "PostToolUse:Bash",
          hookEvent: "PostToolUse",
        },
      },
      { type: "assistant", timestamp: "2026-06-24T20:00:40.000Z", message: { content: "Done." } },
    ]);
    try {
      const [turn] = analyzeTranscriptFile(file);
      expect(turn.pre_response_ms).toBe(40_000);
      expect(turn.pre_response_hook_duration_ms).toBe(0);
      expect(turn.pre_response_hook_count).toBe(0);
      expect(turn.hook_duration_ms).toBe(0);
      expect(turn.hook_count).toBe(0);
    } finally {
      rmSync(dirname(file), { recursive: true, force: true });
    }
  });

  test("does not count task notifications as human prompt turns", () => {
    const file = writeJsonl([
      {
        type: "attachment",
        timestamp: "2026-06-24T20:00:00.000Z",
        promptSource: "system",
        attachment: {
          type: "queued_command",
          prompt: "<task-notification><status>completed</status></task-notification>",
        },
      },
      { type: "assistant", timestamp: "2026-06-24T20:00:10.000Z", message: { role: "assistant", content: "internal reply" } },
      { type: "user", timestamp: "2026-06-24T20:01:00.000Z", message: { role: "user", content: "real question" } },
      { type: "assistant", timestamp: "2026-06-24T20:01:05.000Z", message: { role: "assistant", content: "real answer" } },
    ]);
    try {
      const turns = analyzeTranscriptFile(file);
      expect(turns).toHaveLength(1);
      expect(turns[0].prompt_preview).toBe("real question");
      expect(turns[0].pre_response_ms).toBe(5_000);
    } finally {
      rmSync(dirname(file), { recursive: true, force: true });
    }
  });

  test("does not count local command transcript artifacts as human prompt turns", () => {
    const file = writeJsonl([
      {
        type: "user",
        timestamp: "2026-06-24T20:00:00.000Z",
        message: { role: "user", content: "<command-name>/exit</command-name>" },
      },
      {
        type: "user",
        timestamp: "2026-06-24T20:00:01.000Z",
        message: { role: "user", content: "<local-command-stdout>Goodbye!</local-command-stdout>" },
      },
      {
        type: "user",
        timestamp: "2026-06-24T20:00:02.000Z",
        message: { role: "user", content: "<command-message>End</command-message> <command-name>/End</command-name>" },
      },
      {
        type: "user",
        timestamp: "2026-06-24T20:00:03.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Base directory for this skill: /Users/example/.claude/skills/End\n\n## Checklist" }],
        },
      },
      {
        type: "user",
        timestamp: "2026-06-24T20:00:04.000Z",
        message: { role: "user", content: "# Update Config Skill\nModify Claude Code configuration by updating settings.json files." },
      },
      { type: "user", timestamp: "2026-06-24T20:01:00.000Z", message: { role: "user", content: "real question" } },
      { type: "assistant", timestamp: "2026-06-24T20:01:05.000Z", message: { role: "assistant", content: "real answer" } },
    ]);
    try {
      const turns = analyzeTranscriptFile(file);
      expect(turns).toHaveLength(1);
      expect(turns[0].prompt_preview).toBe("real question");
    } finally {
      rmSync(dirname(file), { recursive: true, force: true });
    }
  });

  test("marks queued human prompts as transcript-visible without guaranteed hook telemetry", () => {
    const file = writeJsonl([
      {
        type: "attachment",
        timestamp: "2026-06-24T20:00:00.000Z",
        attachment: {
          type: "queued_command",
          commandMode: "prompt",
          origin: { kind: "human" },
          prompt: "queued while the model was busy",
        },
      },
      { type: "assistant", timestamp: "2026-06-24T20:00:02.000Z", message: { role: "assistant", content: "answer" } },
    ]);
    try {
      const [turn] = analyzeTranscriptFile(file);
      expect(turn.prompt_source).toBe("queued_command");
      expect(turn.hook_telemetry_expected).toBe(false);
      expect(turn.hook_telemetry_note).toContain("UserPromptSubmit");
      expect(turn.prompt_preview).toBe("queued while the model was busy");
      expect(turn.pre_response_ms).toBe(2_000);
    } finally {
      rmSync(dirname(file), { recursive: true, force: true });
    }
  });

  test("does not count unmarked queued commands with text as human prompts", () => {
    const file = writeJsonl([
      {
        type: "attachment",
        timestamp: "2026-06-24T20:00:00.000Z",
        attachment: {
          type: "queued_command",
          prompt: "system-origin queued text without human markers",
        },
      },
      { type: "user", timestamp: "2026-06-24T20:01:00.000Z", message: { role: "user", content: "real question" } },
      { type: "assistant", timestamp: "2026-06-24T20:01:02.000Z", message: { role: "assistant", content: "real answer" } },
    ]);
    try {
      const turns = analyzeTranscriptFile(file);
      expect(turns).toHaveLength(1);
      expect(turns[0].prompt_preview).toBe("real question");
    } finally {
      rmSync(dirname(file), { recursive: true, force: true });
    }
  });

  test("correlates agent return pressure before the next user prompt", () => {
    const file = writeJsonl([
      { type: "user", session_id: "s1", timestamp: "2026-06-24T20:00:00.000Z", message: { role: "user", content: "delegate review" } },
      { type: "assistant", session_id: "s1", timestamp: "2026-06-24T20:00:01.000Z", message: { role: "assistant", content: "using agent" } },
      { type: "user", session_id: "s1", timestamp: "2026-06-24T20:05:00.000Z", message: { role: "user", content: "continue" } },
      { type: "assistant", session_id: "s1", timestamp: "2026-06-24T20:05:06.000Z", message: { role: "assistant", content: "next answer" } },
    ]);
    try {
      const turns = analyzeTranscriptFile(file, [
        {
          ts: "2026-06-24T20:03:00.000Z",
          type: "agent.return",
          session_id: "s1",
          agent_type: "general-purpose",
          description: "review returned a long finding",
          result_chars: 12000,
        },
        {
          ts: "2026-06-24T20:03:01.000Z",
          type: "agent.checkpoint",
          session_id: "s1",
          agent_type: "general-purpose",
        },
      ]);
      expect(turns[0].agent_returns_since_last_prompt.count).toBe(0);
      expect(turns[1].agent_returns_since_last_prompt.count).toBe(1);
      expect(turns[1].agent_returns_since_last_prompt.checkpoints).toBe(1);
      expect(turns[1].agent_returns_since_last_prompt.total_chars).toBe(12000);
      expect(turns[1].agent_returns_since_last_prompt.max_chars).toBe(12000);
      expect(turns[1].agent_returns_since_last_prompt.largest?.description).toBe("review returned a long finding");
      expect(turns[1].transcript_chars_before_first_assistant).toBeGreaterThan(0);
    } finally {
      rmSync(dirname(file), { recursive: true, force: true });
    }
  });

  test("first prompt agent-return window starts at transcript start, not epoch", () => {
    const file = writeJsonl([
      { type: "system", session_id: "s1", timestamp: "2026-06-24T20:00:00.000Z", message: { content: "session begins" } },
      { type: "user", session_id: "s1", timestamp: "2026-06-24T20:01:00.000Z", message: { role: "user", content: "first real prompt" } },
      { type: "assistant", session_id: "s1", timestamp: "2026-06-24T20:01:01.000Z", message: { role: "assistant", content: "answer" } },
    ]);
    try {
      const [turn] = analyzeTranscriptFile(file, [
        {
          ts: "2026-06-24T19:00:00.000Z",
          type: "agent.return",
          project: "unknown",
          result_chars: 99999,
        },
        {
          ts: "2026-06-24T20:00:30.000Z",
          type: "agent.return",
          session_id: "s1",
          result_chars: 1234,
        },
      ]);
      expect(turn.agent_returns_since_last_prompt.count).toBe(1);
      expect(turn.agent_returns_since_last_prompt.total_chars).toBe(1234);
    } finally {
      rmSync(dirname(file), { recursive: true, force: true });
    }
  });
});
