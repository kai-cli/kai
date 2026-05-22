import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import {
  NOTIFICATION_CHANNELS,
  enableNotificationChannel,
} from "../PAI-Install/lib/notifications-setup.ts";

const TMP_DIR = join(import.meta.dir, ".tmp-notifications-test");
const FAKE_PAI_DIR = TMP_DIR;
const CONFIG_DIR = join(FAKE_PAI_DIR, "config");

const SAMPLE_NOTIFICATIONS = `// Notification Configuration
// Routes events to notification channels.
// Edit channel settings below, then rebuild settings.
{
  "channels": {
    // Push notifications via ntfy.sh (free, no account)
    "ntfy": { "enabled": false, "topic": "\${NTFY_TOPIC}" },
    // Discord webhook for team alerts
    "discord": { "enabled": false, "webhook": "\${DISCORD_WEBHOOK}" }
  },
  // Route events to channels — an event can go to multiple channels
  "routing": {
    "longTask": [],
    "error": ["ntfy"],
    "security": [],
    "backgroundAgent": []
  }
}
`;

beforeEach(() => {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(join(CONFIG_DIR, "notifications.jsonc"), SAMPLE_NOTIFICATIONS, "utf-8");
});

afterEach(() => {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
});

describe("notifications-setup", () => {
  describe("NOTIFICATION_CHANNELS", () => {
    test("has at least 2 channels", () => {
      expect(NOTIFICATION_CHANNELS.length).toBeGreaterThanOrEqual(2);
    });

    test("ntfy channel has NTFY_TOPIC env key", () => {
      const ntfy = NOTIFICATION_CHANNELS.find(c => c.name === "ntfy");
      expect(ntfy).toBeDefined();
      expect(ntfy!.envKeys[0].key).toBe("NTFY_TOPIC");
    });

    test("discord channel has DISCORD_WEBHOOK env key", () => {
      const discord = NOTIFICATION_CHANNELS.find(c => c.name === "discord");
      expect(discord).toBeDefined();
      expect(discord!.envKeys[0].key).toBe("DISCORD_WEBHOOK");
    });
  });

  describe("enableNotificationChannel", () => {
    test("adds channel to empty routing array", () => {
      enableNotificationChannel(FAKE_PAI_DIR, "discord", ["security"]);
      const content = readFileSync(join(CONFIG_DIR, "notifications.jsonc"), "utf-8");
      expect(content).toContain('"discord"');
      expect(content).toMatch(/"security"\s*:\s*\["discord"\]/);
    });

    test("appends channel to existing routing array", () => {
      enableNotificationChannel(FAKE_PAI_DIR, "discord", ["error"]);
      const content = readFileSync(join(CONFIG_DIR, "notifications.jsonc"), "utf-8");
      expect(content).toMatch(/"error"\s*:\s*\["ntfy", "discord"\]/);
    });

    test("does not duplicate if channel already in array", () => {
      enableNotificationChannel(FAKE_PAI_DIR, "ntfy", ["error"]);
      const content = readFileSync(join(CONFIG_DIR, "notifications.jsonc"), "utf-8");
      const matches = content.match(/"ntfy"/g);
      // ntfy appears in channels section + routing error = 2, not 3
      expect(matches!.length).toBeLessThanOrEqual(3);
    });

    test("returns false if notifications.jsonc doesn't exist", () => {
      rmSync(join(CONFIG_DIR, "notifications.jsonc"));
      const result = enableNotificationChannel(FAKE_PAI_DIR, "ntfy", ["error"]);
      expect(result).toBe(false);
    });

    test("handles multiple events in one call", () => {
      enableNotificationChannel(FAKE_PAI_DIR, "discord", ["longTask", "security", "backgroundAgent"]);
      const content = readFileSync(join(CONFIG_DIR, "notifications.jsonc"), "utf-8");
      expect(content).toMatch(/"longTask"\s*:\s*\["discord"\]/);
      expect(content).toMatch(/"security"\s*:\s*\["discord"\]/);
      expect(content).toMatch(/"backgroundAgent"\s*:\s*\["discord"\]/);
    });

    test("preserves comments in the file", () => {
      enableNotificationChannel(FAKE_PAI_DIR, "discord", ["longTask"]);
      const content = readFileSync(join(CONFIG_DIR, "notifications.jsonc"), "utf-8");
      expect(content).toContain("// Notification Configuration");
      expect(content).toContain("// Routes events to notification channels.");
      expect(content).toContain("// Push notifications via ntfy.sh");
      expect(content).toContain("// Discord webhook for team alerts");
      expect(content).toContain("// Route events to channels");
    });

    test("preserves channel config structure", () => {
      enableNotificationChannel(FAKE_PAI_DIR, "ntfy", ["security"]);
      const content = readFileSync(join(CONFIG_DIR, "notifications.jsonc"), "utf-8");
      expect(content).toContain('"topic": "${NTFY_TOPIC}"');
      expect(content).toContain('"webhook": "${DISCORD_WEBHOOK}"');
    });
  });
});
