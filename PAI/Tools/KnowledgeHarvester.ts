#!/usr/bin/env bun
// KnowledgeHarvester.ts - Automated cross-project knowledge distillation
//
// Scans project memory files, extracts key facts, deduplicates across projects,
// and generates distilled knowledge summaries in MEMORY/KNOWLEDGE/ via fast LLM.
//
// Usage: bun KnowledgeHarvester.ts [--scan | --dry-run | --skip-llm | --domain X]

import { parseArgs } from "util";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { getPaiDir, paiPath } from "../../hooks/lib/paths";
import { inference } from "./Inference";
import { loadDomainKeywords, loadDomainDescriptions } from "../../hooks/lib/config-loader";
import { parseKnowledgeFile, writeKnowledgeFile, type KnowledgeFile } from "../../hooks/lib/knowledge-schema";

// ============================================================================
// Types
// ============================================================================

interface MemoryFile {
  project: string;
  filename: string;
  path: string;
  title: string;
  content: string;
  lastModified: Date;
}

interface ExtractedFact {
  source: MemoryFile;
  heading: string;
  facts: string[];
}

interface KnowledgeDomain {
  name: string;
  description: string;
  keywords: string[];
  facts: ExtractedFact[];
  projects: Set<string>;
}

interface HarvestReport {
  projectsScanned: number;
  memoryFilesRead: number;
  factsExtracted: number;
  domainsGenerated: number;
  duplicatesFound: number;
  staleFiles: string[];
  errors: string[];
}

// ============================================================================
// Configuration
// ============================================================================

const CLAUDE_DIR = getPaiDir();
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
const KNOWLEDGE_DIR = paiPath("MEMORY", "KNOWLEDGE");
const STALE_THRESHOLD_DAYS = 30;

// Domain classification — loaded from config/domains.jsonc via config-loader.
function loadDomainDefinitions(): Array<{ name: string; description: string; keywords: string[] }> {
  const keywords = loadDomainKeywords();
  const descriptions = loadDomainDescriptions();
  return Object.entries(keywords).map(([name, kws]) => ({
    name,
    description: descriptions[name] ?? name,
    keywords: kws,
  }));
}

const DOMAIN_DEFINITIONS = loadDomainDefinitions();

// ============================================================================
// Scanning
// ============================================================================

/**
 * Scan all project memory directories and build an inventory.
 */
function scanProjectMemories(): MemoryFile[] {
  const files: MemoryFile[] = [];

  if (!existsSync(PROJECTS_DIR)) {
    console.error("❌ Projects directory not found:", PROJECTS_DIR);
    return files;
  }

  const projectDirs = readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const projDir of projectDirs) {
    const memoryDir = join(PROJECTS_DIR, projDir, "memory");
    if (!existsSync(memoryDir)) continue;

    const memFiles = readdirSync(memoryDir).filter(f => f.endsWith(".md") && f !== "MEMORY.md");

    for (const memFile of memFiles) {
      const filePath = join(memoryDir, memFile);
      try {
        const stat = Bun.file(filePath);
        const content = readFileSync(filePath, "utf-8");

        // Extract title from first heading or filename
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch?.[1] || memFile.replace(".md", "").replace(/_/g, " ");

        // Derive friendly project name
        const projectName = projDir
          .replace(/^-Users-[^-]+-Projects-/, "")
          .replace(/^-Users-[^-]+-/, "")
          .replace(/-/g, "/");

        files.push({
          project: projectName,
          filename: memFile,
          path: filePath,
          title,
          content,
          lastModified: new Date(stat.lastModified),
        });
      } catch (err) {
        console.error(`⚠️ Failed to read ${filePath}: ${err}`);
      }
    }
  }

  return files;
}

// ============================================================================
// Extraction
// ============================================================================

/**
 * Extract key facts from a memory file.
 * Pulls: headings, bold text, table rows, bullet points with key info.
 */
function extractFacts(file: MemoryFile): ExtractedFact[] {
  const results: ExtractedFact[] = [];
  const lines = file.content.split("\n");

  let currentHeading = file.title;
  let currentFacts: string[] = [];

  for (const line of lines) {
    // Track headings
    const headingMatch = line.match(/^#{1,4}\s+(.+)$/);
    if (headingMatch) {
      // Save previous section if it has facts
      if (currentFacts.length > 0) {
        results.push({ source: file, heading: currentHeading, facts: [...currentFacts] });
        currentFacts = [];
      }
      currentHeading = headingMatch[1];
      continue;
    }

    // Extract bold statements (often key facts)
    const boldMatches = line.matchAll(/\*\*(.+?)\*\*/g);
    for (const match of boldMatches) {
      if (match[1].length > 10 && match[1].length < 200) {
        currentFacts.push(match[1]);
      }
    }

    // Extract meaningful bullet points
    const bulletMatch = line.match(/^[-*]\s+(.{15,200})$/);
    if (bulletMatch) {
      currentFacts.push(bulletMatch[1].replace(/\*\*/g, ""));
    }

    // Extract table data rows (not header/separator)
    const tableMatch = line.match(/^\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/);
    if (tableMatch && !line.includes("---") && !line.includes("Topic") && !line.includes("Path")) {
      const key = tableMatch[1].trim().replace(/\*\*/g, "");
      const val = tableMatch[2].trim().replace(/\*\*/g, "");
      if (key.length > 3 && val.length > 3) {
        currentFacts.push(`${key}: ${val}`);
      }
    }
  }

  // Don't forget the last section
  if (currentFacts.length > 0) {
    results.push({ source: file, heading: currentHeading, facts: currentFacts });
  }

  return results;
}

// ============================================================================
// Clustering
// ============================================================================

/**
 * Classify extracted facts into knowledge domains based on keyword matching.
 */
function clusterByDomain(allFacts: ExtractedFact[]): Map<string, KnowledgeDomain> {
  const domains = new Map<string, KnowledgeDomain>();

  // Initialize domains
  for (const def of DOMAIN_DEFINITIONS) {
    domains.set(def.name, {
      ...def,
      facts: [],
      projects: new Set(),
    });
  }

  for (const factGroup of allFacts) {
    const text = (factGroup.heading + " " + factGroup.facts.join(" ")).toLowerCase();

    // Score each domain by keyword hits
    let bestDomain = "";
    let bestScore = 0;

    for (const def of DOMAIN_DEFINITIONS) {
      const score = def.keywords.reduce((acc, kw) => {
        const regex = new RegExp(kw, "gi");
        const matches = text.match(regex);
        return acc + (matches ? matches.length : 0);
      }, 0);

      if (score > bestScore) {
        bestScore = score;
        bestDomain = def.name;
      }
    }

    // Require at least 2 keyword hits to classify
    if (bestScore >= 2 && domains.has(bestDomain)) {
      const domain = domains.get(bestDomain)!;
      domain.facts.push(factGroup);
      domain.projects.add(factGroup.source.project);
    }
  }

  return domains;
}

// ============================================================================
// Deduplication
// ============================================================================

/**
 * Simple Jaccard similarity on word sets.
 */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  return intersection / (wordsA.size + wordsB.size - intersection);
}

/**
 * Remove duplicate facts within a domain (>0.5 Jaccard similarity).
 * Returns deduplicated facts and count of duplicates removed.
 */
function deduplicateFacts(domain: KnowledgeDomain): { deduplicated: string[]; duplicatesRemoved: number } {
  // Flatten all facts
  const allFacts = domain.facts.flatMap(fg => fg.facts);
  const unique: string[] = [];
  let duplicatesRemoved = 0;

  for (const fact of allFacts) {
    const isDupe = unique.some(existing => jaccardSimilarity(fact, existing) > 0.5);
    if (!isDupe) {
      unique.push(fact);
    } else {
      duplicatesRemoved++;
    }
  }

  return { deduplicated: unique, duplicatesRemoved };
}

// ============================================================================
// Distillation (LLM)
// ============================================================================

/**
 * Use fast LLM inference to distill a list of facts into a coherent summary.
 */
async function distillDomain(domain: KnowledgeDomain, facts: string[]): Promise<string> {
  // Cap facts to prevent timeout - take the longest/most detailed ones (more signal)
  const MAX_FACTS = 50;
  const cappedFacts = facts.length > MAX_FACTS
    ? facts.sort((a, b) => b.length - a.length).slice(0, MAX_FACTS)
    : facts;

  const systemPrompt = `You are a technical knowledge distiller. Given a list of extracted facts about "${domain.description}", produce a concise reference document (~200-300 words). Format as markdown with 2-3 sections. Include only facts that would be useful for an engineering manager working with this technology daily. No introductions, no conclusions - just the distilled knowledge. Preserve specific details: names, versions, numbers, URLs.`;

  const userPrompt = `Domain: ${domain.name}\nDescription: ${domain.description}\nSource projects: ${Array.from(domain.projects).join(", ")}\n\nExtracted facts (${cappedFacts.length} of ${facts.length} total, most detailed selected):\n${cappedFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;

  console.error(`🤖 Distilling ${domain.name} (${cappedFacts.length}/${facts.length} facts)...`);

  const result = await inference({
    systemPrompt,
    userPrompt,
    level: "fast",
    timeout: 45000,
  });

  if (!result.success) {
    console.error(`⚠️ LLM distillation failed for ${domain.name}: ${result.error}`);
    // Fallback: rule-based summary
    return formatFactsAsMarkdown(domain, facts);
  }

  return result.output.trim();
}

/**
 * Fallback: format facts as markdown without LLM.
 */
function formatFactsAsMarkdown(domain: KnowledgeDomain, facts: string[]): string {
  const lines: string[] = [];
  lines.push(`# ${domain.name}`);
  lines.push(`> ${domain.description}`);
  lines.push(`> Sources: ${Array.from(domain.projects).join(", ")}`);
  lines.push("");

  // Group by rough topic (first 3 words)
  const grouped = new Map<string, string[]>();
  for (const fact of facts) {
    const key = fact.split(/\s+/).slice(0, 3).join(" ");
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(fact);
  }

  for (const [, groupFacts] of grouped) {
    for (const fact of groupFacts) {
      lines.push(`- ${fact}`);
    }
  }

  return lines.join("\n");
}

// ============================================================================
// Output
// ============================================================================

/**
 * Write the knowledge index and domain files.
 */
function writeKnowledgeFiles(
  domains: Map<string, { content: string; factCount: number; projects: Set<string> }>,
  dryRun: boolean
): void {
  if (!dryRun) {
    mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  }

  // Build INDEX.md
  const indexLines: string[] = [
    "# Cross-Project Knowledge Index",
    "",
    `> Auto-generated by KnowledgeHarvester.ts on ${new Date().toISOString().split("T")[0]}`,
    `> Re-run: \`bun run PAI/Tools/KnowledgeHarvester.ts\``,
    "",
    "## Domains",
    "",
    "| Domain | Facts | Source Projects | File |",
    "|--------|-------|----------------|------|",
  ];

  for (const [name, data] of domains) {
    const projects = Array.from(data.projects).join(", ");
    indexLines.push(`| ${name} | ${data.factCount} | ${projects} | [${name}.md](${name}.md) |`);
  }

  indexLines.push("");
  indexLines.push("## Usage");
  indexLines.push("");
  indexLines.push("These files are read by `LoadContext.hook.ts` at session start to inject relevant domain knowledge.");
  indexLines.push("Each file is ~200-300 words (~150-250 tokens). Only domains relevant to the current project are injected.");
  indexLines.push("");
  indexLines.push("## Staleness");
  indexLines.push("");
  indexLines.push("Run `bun KnowledgeHarvester.ts --scan` to check for stale source files.");
  indexLines.push("Run `bun KnowledgeHarvester.ts` to regenerate all domains from current memory files.");

  const indexContent = indexLines.join("\n") + "\n";

  if (dryRun) {
    console.log("\n📄 INDEX.md would contain:");
    console.log(indexContent);
  } else {
    writeFileSync(join(KNOWLEDGE_DIR, "INDEX.md"), indexContent);
    console.error(`✅ Wrote INDEX.md`);
  }

  // Write domain files (with frontmatter)
  const today = new Date().toISOString().split('T')[0];
  for (const [name, data] of domains) {
    const filePath = join(KNOWLEDGE_DIR, `${name}.md`);
    if (dryRun) {
      console.log(`\n📄 ${name}.md would contain (${data.content.length} chars):`);
      console.log(data.content.substring(0, 500) + (data.content.length > 500 ? "\n..." : ""));
    } else {
      const existing = parseKnowledgeFile(filePath);
      const meta = existing?.meta ?? { domain: name, updated: today, tags: [], related: [] };
      meta.updated = today;
      const kf: KnowledgeFile = { meta, body: data.content + "\n", path: filePath, slug: name };
      writeKnowledgeFile(kf);
      console.error(`✅ Wrote ${name}.md (${data.factCount} facts, ${data.content.length} chars)`);
    }
  }
}

// ============================================================================
// Reporting
// ============================================================================

function printReport(report: HarvestReport): void {
  console.log("\n" + "═".repeat(60));
  console.log("  KNOWLEDGE HARVEST REPORT");
  console.log("═".repeat(60));
  console.log(`  Projects scanned:    ${report.projectsScanned}`);
  console.log(`  Memory files read:   ${report.memoryFilesRead}`);
  console.log(`  Facts extracted:     ${report.factsExtracted}`);
  console.log(`  Duplicates removed:  ${report.duplicatesFound}`);
  console.log(`  Domains generated:   ${report.domainsGenerated}`);

  if (report.staleFiles.length > 0) {
    console.log(`\n  ⚠️ Stale files (>${STALE_THRESHOLD_DAYS} days):`);
    for (const f of report.staleFiles) {
      console.log(`    - ${f}`);
    }
  }

  if (report.errors.length > 0) {
    console.log(`\n  ❌ Errors:`);
    for (const e of report.errors) {
      console.log(`    - ${e}`);
    }
  }

  console.log("═".repeat(60) + "\n");
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      scan: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "skip-llm": { type: "boolean", default: false },
      domain: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`
KnowledgeHarvester - Cross-project knowledge distillation

USAGE:
  bun KnowledgeHarvester.ts              Full harvest with LLM distillation
  bun KnowledgeHarvester.ts --scan       Scan only - inventory + staleness
  bun KnowledgeHarvester.ts --dry-run    Show what would be generated
  bun KnowledgeHarvester.ts --skip-llm   Rule-based only, no LLM calls
  bun KnowledgeHarvester.ts --domain X   Distill only domain X
`);
    process.exit(0);
  }

  const report: HarvestReport = {
    projectsScanned: 0,
    memoryFilesRead: 0,
    factsExtracted: 0,
    domainsGenerated: 0,
    duplicatesFound: 0,
    staleFiles: [],
    errors: [],
  };

  // Step 1: Scan
  console.error("🔍 Scanning project memory files...");
  const memoryFiles = scanProjectMemories();
  const projectNames = new Set(memoryFiles.map(f => f.project));
  report.projectsScanned = projectNames.size;
  report.memoryFilesRead = memoryFiles.length;

  console.error(`   Found ${memoryFiles.length} memory files across ${projectNames.size} projects`);

  // Check staleness
  const now = Date.now();
  for (const file of memoryFiles) {
    const ageDays = (now - file.lastModified.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > STALE_THRESHOLD_DAYS) {
      report.staleFiles.push(`${file.project}/${file.filename} (${Math.round(ageDays)}d old)`);
    }
  }

  // Scan-only mode: print inventory and exit
  if (values.scan) {
    console.log("\n📋 MEMORY FILE INVENTORY\n");
    let currentProject = "";
    for (const file of memoryFiles.sort((a, b) => a.project.localeCompare(b.project))) {
      if (file.project !== currentProject) {
        currentProject = file.project;
        console.log(`\n  📁 ${currentProject}`);
      }
      const ageDays = Math.round((now - file.lastModified.getTime()) / (1000 * 60 * 60 * 24));
      const staleTag = ageDays > STALE_THRESHOLD_DAYS ? " ⚠️ STALE" : "";
      console.log(`     ${file.filename} - "${file.title}" (${ageDays}d ago)${staleTag}`);
    }
    printReport(report);
    process.exit(0);
  }

  // Step 2: Extract
  console.error("📝 Extracting facts...");
  const allFacts: ExtractedFact[] = [];
  for (const file of memoryFiles) {
    const facts = extractFacts(file);
    allFacts.push(...facts);
  }
  report.factsExtracted = allFacts.reduce((acc, fg) => acc + fg.facts.length, 0);
  console.error(`   Extracted ${report.factsExtracted} facts from ${allFacts.length} sections`);

  // Step 3: Cluster
  console.error("🏷️ Clustering into domains...");
  const domains = clusterByDomain(allFacts);

  // Filter to requested domain if specified
  if (values.domain) {
    for (const key of domains.keys()) {
      if (key !== values.domain) domains.delete(key);
    }
    if (domains.size === 0) {
      console.error(`❌ Unknown domain: ${values.domain}`);
      console.error(`   Available: ${DOMAIN_DEFINITIONS.map(d => d.name).join(", ")}`);
      process.exit(1);
    }
  }

  // Step 4: Deduplicate + Step 5: Distill
  const outputDomains = new Map<string, { content: string; factCount: number; projects: Set<string> }>();

  for (const [name, domain] of domains) {
    if (domain.facts.length === 0) {
      console.error(`   ⏭️ ${name}: no facts classified - skipping`);
      continue;
    }

    const { deduplicated, duplicatesRemoved } = deduplicateFacts(domain);
    report.duplicatesFound += duplicatesRemoved;
    console.error(`   ${name}: ${deduplicated.length} unique facts (${duplicatesRemoved} dupes removed)`);

    if (deduplicated.length < 3) {
      console.error(`   ⏭️ ${name}: too few facts (${deduplicated.length}) - skipping`);
      continue;
    }

    // Distill
    let content: string;
    if (values["skip-llm"]) {
      content = formatFactsAsMarkdown(domain, deduplicated);
    } else {
      content = await distillDomain(domain, deduplicated);
    }

    outputDomains.set(name, {
      content,
      factCount: deduplicated.length,
      projects: domain.projects,
    });
    report.domainsGenerated++;
  }

  // Step 6: Write
  if (outputDomains.size > 0) {
    writeKnowledgeFiles(outputDomains, values["dry-run"] ?? false);
  } else {
    console.error("⚠️ No domains generated - nothing to write");
  }

  printReport(report);
}

main().catch(err => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
