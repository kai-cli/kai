import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { writeKeyToProfile, writeKeyToEnv, detectSetKeys, maskKey, API_KEYS } from "../PAI-Install/lib/api-keys.ts";

const TMP_DIR = join(import.meta.dir, ".tmp-api-keys-test");
const FAKE_HOME = TMP_DIR;
const FAKE_PROFILE = join(FAKE_HOME, ".zshrc");
const FAKE_PAI_DIR = join(TMP_DIR, "pai");

beforeEach(() => {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  mkdirSync(FAKE_PAI_DIR, { recursive: true });
  process.env.HOME = FAKE_HOME;
  process.env.SHELL = "/bin/zsh";
});

afterEach(() => {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
});

describe("api-keys", () => {
  describe("writeKeyToProfile", () => {
    test("appends key to empty profile", () => {
      writeFileSync(FAKE_PROFILE, "", "utf-8");
      writeKeyToProfile("MY_KEY", "my-value");
      const content = readFileSync(FAKE_PROFILE, "utf-8");
      expect(content).toContain('export MY_KEY="my-value"');
    });

    test("creates profile if it doesn't exist", () => {
      writeKeyToProfile("MY_KEY", "val");
      expect(existsSync(FAKE_PROFILE)).toBe(true);
      const content = readFileSync(FAKE_PROFILE, "utf-8");
      expect(content).toContain('export MY_KEY="val"');
    });

    test("replaces existing key (dedup)", () => {
      writeFileSync(FAKE_PROFILE, 'export MY_KEY="old-value"\nexport OTHER="keep"\n', "utf-8");
      writeKeyToProfile("MY_KEY", "new-value");
      const content = readFileSync(FAKE_PROFILE, "utf-8");
      expect(content).toContain('export MY_KEY="new-value"');
      expect(content).not.toContain("old-value");
      expect(content).toContain('export OTHER="keep"');
    });

    test("does not duplicate on repeated writes", () => {
      writeFileSync(FAKE_PROFILE, "", "utf-8");
      writeKeyToProfile("MY_KEY", "val1");
      writeKeyToProfile("MY_KEY", "val2");
      const content = readFileSync(FAKE_PROFILE, "utf-8");
      const matches = content.match(/export MY_KEY=/g);
      expect(matches?.length).toBe(1);
      expect(content).toContain('export MY_KEY="val2"');
    });
  });

  describe("writeKeyToEnv", () => {
    test("appends key to empty .env", () => {
      writeFileSync(join(FAKE_PAI_DIR, ".env"), "", "utf-8");
      writeKeyToEnv(FAKE_PAI_DIR, "TEST_KEY", "test-val");
      const content = readFileSync(join(FAKE_PAI_DIR, ".env"), "utf-8");
      expect(content).toContain("TEST_KEY=test-val");
    });

    test("replaces existing key in .env", () => {
      writeFileSync(join(FAKE_PAI_DIR, ".env"), "TEST_KEY=old\nOTHER=keep\n", "utf-8");
      writeKeyToEnv(FAKE_PAI_DIR, "TEST_KEY", "new");
      const content = readFileSync(join(FAKE_PAI_DIR, ".env"), "utf-8");
      expect(content).toContain("TEST_KEY=new");
      expect(content).not.toContain("TEST_KEY=old");
      expect(content).toContain("OTHER=keep");
    });

    test("creates .env if missing", () => {
      writeKeyToEnv(FAKE_PAI_DIR, "NEW_KEY", "val");
      expect(existsSync(join(FAKE_PAI_DIR, ".env"))).toBe(true);
    });
  });

  describe("maskKey", () => {
    test("masks long keys showing last 4", () => {
      expect(maskKey("sk-ant-abcdef1234")).toBe("...1234");
    });

    test("masks short keys completely", () => {
      expect(maskKey("short")).toBe("****");
    });
  });

  describe("writeKeyToProfile edge cases", () => {
    test("handles key with special characters in value", () => {
      writeFileSync(FAKE_PROFILE, "", "utf-8");
      writeKeyToProfile("MY_KEY", "val-with$pecial&chars");
      const content = readFileSync(FAKE_PROFILE, "utf-8");
      expect(content).toContain('export MY_KEY="val-with$pecial&chars"');
    });

    test("preserves surrounding content on dedup replace", () => {
      const existing = `# Some comment\nexport PATH="/usr/bin"\nexport MY_KEY="old"\nexport OTHER="after"\n# Trailing\n`;
      writeFileSync(FAKE_PROFILE, existing, "utf-8");
      writeKeyToProfile("MY_KEY", "new");
      const content = readFileSync(FAKE_PROFILE, "utf-8");
      expect(content).toContain("# Some comment");
      expect(content).toContain('export PATH="/usr/bin"');
      expect(content).toContain('export MY_KEY="new"');
      expect(content).toContain('export OTHER="after"');
      expect(content).toContain("# Trailing");
    });

    test("handles profile with only comments", () => {
      writeFileSync(FAKE_PROFILE, "# just comments\n# more comments\n", "utf-8");
      writeKeyToProfile("KEY", "val");
      const content = readFileSync(FAKE_PROFILE, "utf-8");
      expect(content).toContain("# just comments");
      expect(content).toContain('export KEY="val"');
    });

    test("idempotent on same value", () => {
      writeFileSync(FAKE_PROFILE, "", "utf-8");
      writeKeyToProfile("KEY", "same");
      writeKeyToProfile("KEY", "same");
      writeKeyToProfile("KEY", "same");
      const content = readFileSync(FAKE_PROFILE, "utf-8");
      const matches = content.match(/export KEY=/g);
      expect(matches?.length).toBe(1);
    });
  });

  describe("writeKeyToEnv edge cases", () => {
    test("handles .env with comments", () => {
      writeFileSync(join(FAKE_PAI_DIR, ".env"), "# comment\nEXISTING=val\n", "utf-8");
      writeKeyToEnv(FAKE_PAI_DIR, "NEW", "x");
      const content = readFileSync(join(FAKE_PAI_DIR, ".env"), "utf-8");
      expect(content).toContain("# comment");
      expect(content).toContain("EXISTING=val");
      expect(content).toContain("NEW=x");
    });

    test("handles key that is substring of another key", () => {
      writeFileSync(join(FAKE_PAI_DIR, ".env"), "MY_KEY_LONG=keep\nMY_KEY=replace\n", "utf-8");
      writeKeyToEnv(FAKE_PAI_DIR, "MY_KEY", "new");
      const content = readFileSync(join(FAKE_PAI_DIR, ".env"), "utf-8");
      expect(content).toContain("MY_KEY_LONG=keep");
      expect(content).toContain("MY_KEY=new");
      expect(content).not.toContain("MY_KEY=replace");
    });
  });

  describe("API_KEYS registry", () => {
    test("has ANTHROPIC_API_KEY as required", () => {
      const anthropic = API_KEYS.find(k => k.key === "ANTHROPIC_API_KEY");
      expect(anthropic).toBeDefined();
      expect(anthropic!.required).toBe(true);
    });

    test("all optional keys have required=false", () => {
      const optional = API_KEYS.filter(k => k.key !== "ANTHROPIC_API_KEY");
      for (const k of optional) {
        expect(k.required).toBe(false);
      }
    });

    test("has at least 8 keys defined", () => {
      expect(API_KEYS.length).toBeGreaterThanOrEqual(8);
    });

    test("all keys have unique names", () => {
      const keys = API_KEYS.map(k => k.key);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });
});
