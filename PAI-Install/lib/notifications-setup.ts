/**
 * Notification channel configuration for installer and kai-setup.
 * Enables channels in config/notifications.jsonc routing.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export interface NotificationChannel {
  name: string;
  envKeys: { key: string; prompt: string; hint?: string }[];
  description: string;
  defaultEvents: string[];
}

export const NOTIFICATION_CHANNELS: NotificationChannel[] = [
  {
    name: "ntfy",
    envKeys: [
      { key: "NTFY_TOPIC", prompt: "ntfy.sh topic name", hint: "Free push notifications — get the app at ntfy.sh" },
    ],
    description: "Push notifications via ntfy.sh (free, no account needed)",
    defaultEvents: ["longTask", "error", "backgroundAgent"],
  },
  {
    name: "discord",
    envKeys: [
      { key: "DISCORD_WEBHOOK", prompt: "Discord webhook URL", hint: "Server Settings → Integrations → Webhooks" },
    ],
    description: "Discord channel notifications via webhook",
    defaultEvents: ["error", "security"],
  },
];

/**
 * Enable a notification channel in config/notifications.jsonc routing.
 * Uses targeted line-level replacement to preserve comments.
 */
export function enableNotificationChannel(
  paiDir: string,
  channelName: string,
  events: string[]
): boolean {
  const notifPath = join(paiDir, "config", "notifications.jsonc");
  if (!existsSync(notifPath)) return false;

  let content = readFileSync(notifPath, "utf-8");
  let modified = false;

  for (const event of events) {
    // Match routing lines like: "eventType": ["channel1", "channel2"]
    // or "eventType": []
    const pattern = new RegExp(
      `("${event}"\\s*:\\s*\\[)([^\\]]*)\\]`
    );
    const match = content.match(pattern);
    if (!match) continue;

    const existing = match[2].trim();
    if (existing.includes(`"${channelName}"`)) continue;

    const newList = existing
      ? `${existing}, "${channelName}"`
      : `"${channelName}"`;
    content = content.replace(pattern, `$1${newList}]`);
    modified = true;
  }

  if (modified) {
    writeFileSync(notifPath, content, "utf-8");
  }
  return modified;
}
