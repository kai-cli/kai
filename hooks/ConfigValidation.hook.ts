import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { validateSettings } from "../scripts/settings-validate";

const PAI_DIR = process.env.PAI_DIR ?? join(process.env.HOME!, ".claude");
const settingsPath = join(PAI_DIR, "settings.json");
const schemaPath = join(PAI_DIR, "settings-schema.json");

if (!existsSync(schemaPath) || !existsSync(settingsPath)) {
  process.exit(0);
}

let settings: unknown;
try {
  settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
} catch (e) {
  const msg = e instanceof SyntaxError ? e.message : "unknown parse error";
  console.log(JSON.stringify({
    additionalContext: `❌ settings.json is malformed JSON: ${msg}. Run \`bun ~/.claude/hooks/handlers/BuildSettings.ts\` to rebuild from config files.`
  }));
  process.exit(0);
}

const result = validateSettings(settings);
if (!result.valid) {
  const summary = result.errors.slice(0, 3).join("; ");
  const more = result.errors.length > 3 ? ` (+${result.errors.length - 3} more)` : "";
  console.log(JSON.stringify({
    additionalContext: `⚠️ Config validation: ${result.errors.length} issue(s) in settings.json: ${summary}${more}. Run \`bun ~/.claude/scripts/settings-validate.ts\` for details.`
  }));
}
