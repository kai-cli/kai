#!/usr/bin/env bun
/**
 * LocalContextFirst.hook.ts — Inject local Knowledge base pointers for work topics
 *
 * TRIGGER: UserPromptSubmit (runs with other UserPromptSubmit hooks)
 *
 * PURPOSE: When the user's prompt touches Your Company/firmware/product topics,
 * inject a reminder to check local Knowledge index and CONTEXT_ROUTING.md
 * BEFORE launching web research agents. Prevents the 7-minute web search
 * problem when 90% of the answer is in local repos.
 *
 * DESIGN: Deterministic regex matching (<5ms, no API calls).
 * Only injects when topic matches — silent otherwise.
 */

import { readHookInput } from './lib/hook-io';

// Topic patterns that indicate local context should be checked first
const DOMAIN_PATTERNS = [
  // Product / hardware
  /\b(pinnacle|m60|m61|m62|mx\d{3,4}|velop|your-company|spnm\d{2})\b/i,
  // Firmware / build
  /\b(firmware|openwrt|qsdk|ipq\d{4}|chipset|soc|nss|qualcomm|broadcom|mediatek)\b/i,
  // Speedtest
  /\b(ookla|speedtest|speed\s*test|nss.?udp|obudpst|user1|tr.?143|tr.?471)\b/i,
  // Standards
  /\b(tr.?069|tr.?369|tr.?181|cwmp|usp|obuspa|icwmp|bbfdm|data\s*model)\b/i,
  // Partners / customers
  /\b(du\s+(telecom|eitc)|community\s*fibre|toob|samknows)\b/i,
  // Build / release
  /\b(rc\d{1,2}|release\s*candidate|build\s*config|feed_\w+|preconfig)\b/i,
];

function matchesWorkTopic(prompt: string): string[] {
  const matches: string[] = [];
  for (const pattern of DOMAIN_PATTERNS) {
    const match = prompt.match(pattern);
    if (match) {
      matches.push(match[0]);
    }
  }
  return matches;
}

async function main() {
  const input = await readHookInput();
  if (!input) process.exit(0);

  const prompt = ((input as any).prompt || '').trim();
  if (!prompt || prompt.length < 10) process.exit(0);

  // Skip ratings
  if (/^([1-9]|10)$/.test(prompt.trim())) process.exit(0);

  const matches = matchesWorkTopic(prompt);

  if (matches.length > 0) {
    const context = `<local-context-hint>
Topic matches local Knowledge base: [${matches.join(', ')}]

BEFORE web research, check these local sources:
1. CONTEXT_ROUTING.md → "Your Company / Firmware" section for indexed paths
2. ~/Projects/Knowledge/INDEX.md — master keyword index (speedtest, firmware, standards, etc.)
3. ~/Projects/Knowledge/firmware/INDEX.md — firmware-specific index
4. gh issue list/view on your-company/Your CompanyWRT and your-company/FWDEV for bugs and vendor docs
5. your-company/FWDEV docs/3rd party/ for vendor-specific documentation (Ookla, SamKnows, etc.)
6. ~/Projects/Learning_Your Company_Repo/targets/ for build configs and customer overlays

Local context is faster and more accurate than web research for these topics.
</local-context-hint>`;

    console.log(JSON.stringify({
      additionalContext: context
    }));
    console.error(`[LocalContextFirst] Matched work topics: ${matches.join(', ')}`);
  } else {
    console.error(`[LocalContextFirst] No work topic match — skipped`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[LocalContextFirst] Error:', err);
  process.exit(0);
});
