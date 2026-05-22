import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import {
  AVAILABLE_SERVERS,
  readLocalMcpServers,
  writeMcpServers,
  buildServerConfig,
} from "../PAI-Install/lib/mcp-setup.ts";

const TMP_DIR = join(import.meta.dir, ".tmp-mcp-setup-test");
const FAKE_PAI_DIR = TMP_DIR;
const CONFIG_DIR = join(FAKE_PAI_DIR, "config");

beforeEach(() => {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  mkdirSync(CONFIG_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
});

describe("mcp-setup", () => {
  describe("AVAILABLE_SERVERS", () => {
    test("has at least 3 servers defined", () => {
      expect(AVAILABLE_SERVERS.length).toBeGreaterThanOrEqual(3);
    });

    test("Cloudflare is remote type with URL", () => {
      const cf = AVAILABLE_SERVERS.find(s => s.name === "Cloudflare");
      expect(cf).toBeDefined();
      expect(cf!.type).toBe("remote");
      expect(cf!.url).toBeDefined();
    });

    test("Playwright is stdio type with command", () => {
      const pw = AVAILABLE_SERVERS.find(s => s.name === "Playwright");
      expect(pw).toBeDefined();
      expect(pw!.type).toBe("stdio");
      expect(pw!.command).toBe("npx");
    });
  });

  describe("readLocalMcpServers", () => {
    test("returns empty object if file doesn't exist", () => {
      const result = readLocalMcpServers(FAKE_PAI_DIR);
      expect(result).toEqual({});
    });

    test("reads servers from valid JSONC", () => {
      writeFileSync(
        join(CONFIG_DIR, "preferences.local.jsonc"),
        `// comment\n{\n  "mcpServers": {\n    "test-server": { "url": "http://localhost:3000" }\n  }\n}`,
        "utf-8"
      );
      const result = readLocalMcpServers(FAKE_PAI_DIR);
      expect(result["test-server"]).toBeDefined();
      expect(result["test-server"].url).toBe("http://localhost:3000");
    });

    test("returns empty on malformed JSON", () => {
      writeFileSync(
        join(CONFIG_DIR, "preferences.local.jsonc"),
        "not valid json {{{",
        "utf-8"
      );
      const result = readLocalMcpServers(FAKE_PAI_DIR);
      expect(result).toEqual({});
    });
  });

  describe("writeMcpServers", () => {
    test("writes servers to new file", () => {
      writeMcpServers(FAKE_PAI_DIR, {
        "my-server": { url: "http://localhost:8080/mcp" },
      });
      const path = join(CONFIG_DIR, "preferences.local.jsonc");
      expect(existsSync(path)).toBe(true);
      const content = readFileSync(path, "utf-8");
      expect(content).toContain("my-server");
      expect(content).toContain("http://localhost:8080/mcp");
    });

    test("merges with existing servers", () => {
      writeFileSync(
        join(CONFIG_DIR, "preferences.local.jsonc"),
        `{\n  "mcpServers": { "existing": { "url": "http://existing" } }\n}`,
        "utf-8"
      );
      writeMcpServers(FAKE_PAI_DIR, {
        "new-server": { command: "npx", args: ["@test/server"] },
      });
      const content = readFileSync(join(CONFIG_DIR, "preferences.local.jsonc"), "utf-8");
      expect(content).toContain("existing");
      expect(content).toContain("new-server");
    });

    test("preserves non-mcp config keys", () => {
      writeFileSync(
        join(CONFIG_DIR, "preferences.local.jsonc"),
        `{\n  "env": { "MY_VAR": "val" },\n  "mcpServers": {}\n}`,
        "utf-8"
      );
      writeMcpServers(FAKE_PAI_DIR, {
        "s1": { url: "http://s1" },
      });
      const content = readFileSync(join(CONFIG_DIR, "preferences.local.jsonc"), "utf-8");
      expect(content).toContain("MY_VAR");
      expect(content).toContain("s1");
    });
  });

  describe("buildServerConfig", () => {
    test("builds remote config from URL def", () => {
      const config = buildServerConfig({
        name: "Test",
        type: "remote",
        url: "https://example.com/mcp",
        description: "test",
      });
      expect(config).toEqual({ url: "https://example.com/mcp" });
    });

    test("builds stdio config from command def", () => {
      const config = buildServerConfig({
        name: "Test",
        type: "stdio",
        command: "npx",
        args: ["-y", "@test/server"],
        description: "test",
      });
      expect(config).toEqual({ command: "npx", args: ["-y", "@test/server"] });
    });
  });
});
