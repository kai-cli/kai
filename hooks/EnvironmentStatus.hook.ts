import { join } from "path";
import { checkEnvironment, formatStatus } from "./lib/env-check";

const PAI_DIR = process.env.PAI_DIR ?? join(process.env.HOME!, ".claude");
const status = checkEnvironment(PAI_DIR);

if (status.critical) {
  console.log(JSON.stringify({
    additionalContext: `⚠️ ${status.critical}\n${formatStatus(status)}`
  }));
} else {
  // Normal status — no output needed (silent pass for healthy state)
  process.exit(0);
}
