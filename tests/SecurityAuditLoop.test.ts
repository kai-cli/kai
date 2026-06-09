import { describe, expect, test } from "bun:test";
import { normalize, type NormalizedEvent } from "../PAI/Tools/SecurityAuditLoop";

describe("SecurityAuditLoop — normalize (W7)", () => {
  test("SecurityValidator shape: block with reason+command", () => {
    const e = normalize({ timestamp: "2026-06-05T00:00:00Z", event_type: "block", reason: "rm -rf sensitive", command: "rm -rf /x", session_id: "abc" });
    expect(e).not.toBeNull();
    expect(e!.kind).toBe("block");
    expect(e!.reason).toBe("rm -rf sensitive");
    expect(e!.session).toBe("abc");
  });

  test("WebFetchGuard shape: level+reason+url", () => {
    const e = normalize({ timestamp: "2026-06-05T00:00:00Z", level: "block", reason: "internal network", url: "http://10.0.0.1" });
    expect(e!.kind).toBe("block");
    expect(e!.reason).toBe("internal network");
  });

  test("SecretOutputDetector shape: alert+pattern (no reason field)", () => {
    const e = normalize({ timestamp: "2026-06-05T00:00:00Z", level: "alert", pattern: "github_pat", hook: "SecretOutputDetector" });
    expect(e!.kind).toBe("alert");
    expect(e!.reason).toBe("github_pat"); // falls back to pattern
  });

  test("'allow' events are dropped (denials only)", () => {
    expect(normalize({ timestamp: "2026-06-05T00:00:00Z", event_type: "allow", reason: "safe" })).toBeNull();
  });

  test("missing/zero timestamp → null", () => {
    expect(normalize({ event_type: "block", reason: "x" })).toBeNull();
  });

  test("falls back to truncated command when no reason/pattern", () => {
    const e = normalize({ timestamp: "2026-06-05T00:00:00Z", event_type: "block", command: "a".repeat(100) });
    expect(e!.reason.startsWith("command: ")).toBe(true);
    expect(e!.reason.length).toBeLessThan(80); // truncated to 60 + prefix
  });

  test("captures session_id for test-noise filtering", () => {
    const e = normalize({ timestamp: "2026-06-05T00:00:00Z", event_type: "block", reason: "x", session_id: "test-session" });
    expect(e!.session).toBe("test-session"); // loadEvents filters these out by default
  });
});
