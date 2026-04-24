#!/usr/bin/env bun
/**
 * KAI Board v2 — Personal project dashboard
 *
 * Features:
 *   - Multi-directory PRD scanning with auto-refresh (SSE)
 *   - Auto-discovery of ~/Projects/ as library items
 *   - Write capability: create tasks, change phases, toggle criteria
 *   - Ralph Loop trigger + process management
 *   - Docker "yolo mode" for isolated execution
 *   - Archive for done items
 *   - Persistent config (board-config.json)
 *
 * Usage:
 *   bun run board.ts              # Start with defaults from board-config.json
 *   bun run board.ts --port 8080  # Override port
 */

import { watch, existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { readdir, readFile, writeFile, stat } from "fs/promises";
import { join, resolve, basename, dirname } from "path";
import { spawn, type Subprocess } from "bun";

const HOME = process.env.HOME!;
const SCRIPTS_DIR = dirname(new URL(import.meta.url).pathname);
const CONFIG_PATH = join(SCRIPTS_DIR, "board-config.json");

// --- Config ---
interface BoardConfig {
  port: number;
  scanDirs: string[];
  projectsDir: string;
  autoDiscover: boolean;
  ignored: string[];
  library: LibraryItem[];
  archived: string[];
  ralphLoop: { defaultBudget: number; defaultMaxIterations: number; defaultModel: string };
  docker: { enabled: boolean; image: string; memoryLimit: string; cpuLimit: string; timeout: number };
}

interface LibraryItem {
  name: string;
  path: string;
  description: string;
  tags: string[];
  pinned?: boolean;
  discovered?: boolean;
}

function expandPath(p: string): string {
  return p.replace(/^~/, HOME);
}

function loadConfig(): BoardConfig {
  const defaults: BoardConfig = {
    port: 3333,
    scanDirs: ["~/.claude/MEMORY/WORK"],
    projectsDir: "~/Projects",
    autoDiscover: true,
    ignored: ["node_modules", ".git", "__pycache__", ".venv", "Personal"],
    library: [],
    archived: [],
    ralphLoop: { defaultBudget: 5, defaultMaxIterations: 5, defaultModel: "opus" },
    docker: { enabled: true, image: "oven/bun:latest", memoryLimit: "2g", cpuLimit: "2.0", timeout: 1800 },
  };
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

function saveConfig(config: BoardConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

let config = loadConfig();

// CLI overrides
const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const PORT = portIdx >= 0 ? parseInt(args[portIdx + 1]) : config.port;

// Resolve scan dirs
const SCAN_DIRS = config.scanDirs.map(expandPath);
const PROJECTS_DIR = expandPath(config.projectsDir);
const STATE_DIR = join(HOME, ".claude", "MEMORY", "STATE");

// --- Types ---
interface WorkItem {
  slug: string;
  task: string;
  effort: string;
  phase: string;
  passed: number;
  total: number;
  mode: string;
  started: string;
  updated: string;
  criteria: { id: string; text: string; passed: boolean }[];
  prdPath: string;
  source: string;
}

// --- Process Manager ---
interface RunningProcess {
  proc: Subprocess;
  slug: string;
  type: "ralph" | "docker";
  startTime: number;
  logPath: string;
  prdPath: string;
  budget?: number;
  model?: string;
}

const runningProcesses = new Map<string, RunningProcess>();

// --- PRD Parser ---
function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      fm[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
    }
  }
  return fm;
}

function parseCriteria(content: string): { id: string; text: string; passed: boolean }[] {
  const criteria: { id: string; text: string; passed: boolean }[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^- \[([ x])\] (ISC-\S+):\s*(.+?)(?:\s*\[[EIR]\])?$/);
    if (match) {
      criteria.push({ id: match[2], text: match[3].trim(), passed: match[1] === "x" });
    }
  }
  return criteria;
}

// --- Work Items Loader ---
async function scanDirectory(scanDir: string, items: WorkItem[]): Promise<void> {
  try {
    const dirs = await readdir(scanDir);
    for (const dir of dirs) {
      if (dir === "decisions" || dir.startsWith(".")) continue;
      const prdPath = join(scanDir, dir, "PRD.md");
      try {
        const content = await readFile(prdPath, "utf-8");
        const fm = parseFrontmatter(content);
        if (!fm) continue;
        const criteria = parseCriteria(content);
        const progressMatch = fm.progress?.match(/(\d+)\/(\d+)/);
        items.push({
          slug: fm.slug || dir,
          task: fm.task || dir,
          effort: fm.effort || "standard",
          phase: fm.phase || "observe",
          passed: progressMatch ? parseInt(progressMatch[1]) : 0,
          total: progressMatch ? parseInt(progressMatch[2]) : 0,
          mode: fm.mode || "interactive",
          started: fm.started || "",
          updated: fm.updated || "",
          criteria,
          prdPath,
          source: basename(dirname(scanDir)),
        });
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
}

async function loadWorkItems(): Promise<WorkItem[]> {
  const items: WorkItem[] = [];
  const seen = new Set<string>();
  for (const scanDir of SCAN_DIRS) {
    await scanDirectory(scanDir, items);
  }
  const unique = items.filter((i) => {
    if (seen.has(i.slug)) return false;
    seen.add(i.slug);
    return true;
  });
  unique.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
  return unique;
}

// --- Session Tracking ---
interface SessionItem {
  slug: string;
  task: string;
  phase: string;
  sessionUUID?: string;
  startedAt?: string;
  isActive: boolean;
}

async function loadSessions(): Promise<SessionItem[]> {
  const sessions: SessionItem[] = [];
  try {
    const raw = await readFile(join(STATE_DIR, "work.json"), "utf-8");
    const data = JSON.parse(raw);
    const sessionsMap = data.sessions || {};

    // Get active Claude PIDs to detect running sessions
    const activeSessions = new Set<string>();
    try {
      const algDir = join(STATE_DIR, "algorithms");
      const algFiles = await readdir(algDir);
      for (const f of algFiles) {
        activeSessions.add(f.replace(".json", ""));
      }
    } catch {}

    // Only show sessions from last 48 hours (active sessions always shown)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 2);
    const cutoffStr = cutoff.toISOString().replace(/[-:T]/g, "").slice(0, 8);

    for (const [slug, sess] of Object.entries(sessionsMap) as [string, any][]) {
      // Skip old sessions
      const datePrefix = slug.slice(0, 8);
      if (datePrefix < cutoffStr) continue;

      // Skip sessions that already have PRDs (they're shown in work items)
      const hasPrd = await findPrdPath(slug).then(p => !!p).catch(() => false);
      if (hasPrd) continue;

      // Skip noise: test sessions, very short names, Ralph Loop autonomous prompts
      const task = sess.task || slug;
      if (task.length < 10) continue;
      if (task.startsWith("You are resuming autonomous work")) continue;
      if (task.startsWith("to retrieve the result")) continue;
      if (task.startsWith("Full transcript available")) continue;
      if (task.startsWith("Full Transcript Available")) continue;
      if (/^test\b/i.test(task)) continue;

      const isActive = activeSessions.has(sess.sessionUUID || "");

      sessions.push({
        slug,
        task: task.slice(0, 80),
        phase: sess.phase || "native",
        sessionUUID: sess.sessionUUID,
        startedAt: slug.slice(0, 4) + "-" + slug.slice(4, 6) + "-" + slug.slice(6, 8) + "T" + slug.slice(9, 11) + ":" + slug.slice(11, 13) + ":00",
        isActive,
      });
    }

    sessions.sort((a, b) => (b.slug || "").localeCompare(a.slug || ""));
  } catch {}
  return sessions;
}

// --- Auto-Discovery ---
async function discoverProjects(): Promise<LibraryItem[]> {
  if (!config.autoDiscover) return [];
  const discovered: LibraryItem[] = [];
  try {
    const dirs = await readdir(PROJECTS_DIR);
    for (const dir of dirs) {
      if (config.ignored.some((ig) => dir.includes(ig))) continue;
      if (dir.startsWith(".")) continue;
      const fullPath = join(PROJECTS_DIR, dir);
      try {
        const s = await stat(fullPath);
        if (!s.isDirectory()) continue;
      } catch { continue; }

      // Check for CLAUDE.md, README.md, or PRD.md
      let description = "";
      let hasClaude = false;
      try { await stat(join(fullPath, "CLAUDE.md")); hasClaude = true; } catch {}
      let hasReadme = false;
      try { await stat(join(fullPath, "README.md")); hasReadme = true; } catch {}

      if (!hasClaude && !hasReadme) continue;

      // Try to extract description from README first line
      try {
        const readme = await readFile(join(fullPath, hasReadme ? "README.md" : "CLAUDE.md"), "utf-8");
        const firstLine = readme.split("\n").find((l) => l.trim() && !l.startsWith("#"));
        description = firstLine?.trim().slice(0, 120) || dir;
      } catch {
        description = dir;
      }

      // Skip if already in manual library
      if (config.library.some((l) => expandPath(l.path).replace(/\/$/, "") === fullPath)) continue;

      discovered.push({
        name: dir.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        path: `~/Projects/${dir}/`,
        description,
        tags: hasClaude ? ["pai-project"] : ["project"],
        discovered: true,
      });
    }
  } catch { /* Projects dir doesn't exist */ }
  return discovered;
}

async function getLibraryItems(): Promise<LibraryItem[]> {
  const manual = config.library.map((l) => ({ ...l, pinned: l.pinned ?? true, discovered: false }));
  const discovered = await discoverProjects();
  return [...manual, ...discovered];
}

// --- Task Operations ---
async function createTask(title: string, description: string, effort: string, mode: string): Promise<string> {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const kebab = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const slug = `${ts}_${kebab}`;
  const workDir = join(HOME, ".claude", "MEMORY", "WORK", slug);
  mkdirSync(workDir, { recursive: true });

  const prdContent = `---
task: ${title}
slug: ${slug}
effort: ${effort}
phase: observe
progress: 0/0
mode: ${mode}
started: ${now.toISOString()}
updated: ${now.toISOString()}
---

## Context

${description}

## Criteria

## Decisions

## Verification
`;
  await writeFile(join(workDir, "PRD.md"), prdContent);
  broadcastUpdate();
  return slug;
}

async function updatePhase(slug: string, newPhase: string): Promise<boolean> {
  const prdPath = await findPrdPath(slug);
  if (!prdPath) return false;
  const content = await readFile(prdPath, "utf-8");
  const updated = content
    .replace(/^phase: .+$/m, `phase: ${newPhase}`)
    .replace(/^updated: .+$/m, `updated: ${new Date().toISOString()}`);
  await writeFile(prdPath, updated);
  broadcastUpdate();
  return true;
}

async function toggleCriterion(slug: string, criterionId: string): Promise<boolean> {
  const prdPath = await findPrdPath(slug);
  if (!prdPath) return false;
  let content = await readFile(prdPath, "utf-8");

  const checkedPattern = new RegExp(`^- \\[x\\] ${criterionId}:`, "m");
  const uncheckedPattern = new RegExp(`^- \\[ \\] ${criterionId}:`, "m");

  if (checkedPattern.test(content)) {
    content = content.replace(checkedPattern, `- [ ] ${criterionId}:`);
  } else if (uncheckedPattern.test(content)) {
    content = content.replace(uncheckedPattern, `- [x] ${criterionId}:`);
  } else {
    return false;
  }

  // Recalculate progress
  const criteria = parseCriteria(content);
  const passed = criteria.filter((c) => c.passed).length;
  content = content
    .replace(/^progress: .+$/m, `progress: ${passed}/${criteria.length}`)
    .replace(/^updated: .+$/m, `updated: ${new Date().toISOString()}`);

  await writeFile(prdPath, content);
  broadcastUpdate();
  return true;
}

async function findPrdPath(slug: string): Promise<string | null> {
  for (const scanDir of SCAN_DIRS) {
    try {
      const dirs = await readdir(scanDir);
      const dir = dirs.find((d) => d.includes(slug));
      if (dir) {
        const p = join(scanDir, dir, "PRD.md");
        try { await stat(p); return p; } catch {}
      }
    } catch {}
  }
  return null;
}

function archiveItem(slug: string): void {
  if (!config.archived.includes(slug)) {
    config.archived.push(slug);
    saveConfig(config);
    broadcastUpdate();
  }
}

function unarchiveItem(slug: string): void {
  config.archived = config.archived.filter((s) => s !== slug);
  saveConfig(config);
  broadcastUpdate();
}

// --- Ralph Loop Manager ---
function startRalphLoop(slug: string, prdPath: string, budget?: number, maxIter?: number, model?: string): boolean {
  if (runningProcesses.has(slug)) return false;

  const b = budget ?? config.ralphLoop.defaultBudget;
  const m = maxIter ?? config.ralphLoop.defaultMaxIterations;
  const mdl = model ?? config.ralphLoop.defaultModel;
  const logPath = prdPath.replace("PRD.md", `ralph-loop-${Date.now()}.log`);

  const ralphScript = join(HOME, ".claude", "scripts", "ralph-loop.ts");
  const proc = spawn({
    cmd: ["bun", "run", ralphScript, prdPath, "--budget", String(b), "--max-iterations", String(m), "--verbose"],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PATH: process.env.PATH },
  });

  // Stream output to log file
  const logStream = Bun.file(logPath).writer();
  (async () => {
    const reader = proc.stdout.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      logStream.write(value);
    }
    logStream.end();
  })();

  runningProcesses.set(slug, { proc, slug, type: "ralph", startTime: Date.now(), logPath, prdPath, budget: b, model: mdl });

  // Clean up on exit
  proc.exited.then(() => {
    runningProcesses.delete(slug);
    broadcastUpdate();
  });

  broadcastUpdate();
  return true;
}

function stopProcess(slug: string): boolean {
  const rp = runningProcesses.get(slug);
  if (!rp) return false;
  rp.proc.kill();
  runningProcesses.delete(slug);
  broadcastUpdate();
  return true;
}

// --- Docker Manager ---
function startDocker(slug: string, prdPath: string, budget?: number): boolean {
  if (runningProcesses.has(slug)) return false;
  if (!config.docker.enabled) return false;

  const workDir = dirname(prdPath);
  const scriptsDir = join(HOME, ".claude", "scripts");
  const containerName = `pai-${slug.slice(0, 30)}`;
  const b = budget ?? config.ralphLoop.defaultBudget;
  const logPath = prdPath.replace("PRD.md", `docker-${Date.now()}.log`);

  const proc = spawn({
    cmd: [
      "docker", "run", "--rm",
      "--name", containerName,
      "-v", `${workDir}:/workspace`,
      "-v", `${scriptsDir}:/scripts:ro`,
      "-e", `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY || ""}`,
      "--memory", config.docker.memoryLimit,
      "--cpus", config.docker.cpuLimit,
      config.docker.image,
      "bun", "run", "/scripts/ralph-loop.ts", "/workspace/PRD.md",
      "--budget", String(b), "--max-iterations", String(config.ralphLoop.defaultMaxIterations), "--verbose",
    ],
    stdout: "pipe",
    stderr: "pipe",
  });

  const logStream = Bun.file(logPath).writer();
  (async () => {
    const reader = proc.stdout.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      logStream.write(value);
    }
    logStream.end();
  })();

  runningProcesses.set(slug, { proc, slug, type: "docker", startTime: Date.now(), logPath, prdPath, budget: b });

  proc.exited.then(() => {
    runningProcesses.delete(slug);
    broadcastUpdate();
  });

  broadcastUpdate();
  return true;
}

// --- SSE ---
const sseClients = new Set<ReadableStreamDefaultController>();

function broadcastUpdate() {
  for (const controller of sseClients) {
    try {
      controller.enqueue("data: update\n\n");
    } catch {
      sseClients.delete(controller);
    }
  }
}

// Watch all scan directories
try { watch(join(STATE_DIR, "work.json"), () => broadcastUpdate()); } catch {}
for (const scanDir of SCAN_DIRS) {
  try {
    if (existsSync(scanDir)) watch(scanDir, { recursive: true }, () => broadcastUpdate());
  } catch {}
}

// --- HTML ---
let cachedHtml: string | null = null;
const HTML_PATH = join(SCRIPTS_DIR, "board.html");

function getHtml(): string {
  // Always re-read in dev; could cache in production
  try {
    return readFileSync(HTML_PATH, "utf-8");
  } catch {
    return "<html><body><h1>board.html not found</h1><p>Expected at: " + HTML_PATH + "</p></body></html>";
  }
}

// --- Server ---
Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const method = req.method;

    // --- Static ---
    if (url.pathname === "/" || url.pathname === "/board") {
      return new Response(getHtml(), { headers: { "Content-Type": "text/html" } });
    }

    // --- API: Work Items ---
    if (url.pathname === "/api/work" && method === "GET") {
      const items = await loadWorkItems();
      const sessions = await loadSessions();
      const archived = new Set(config.archived);
      return Response.json({
        items: items.filter((i) => !archived.has(i.slug)),
        archived: items.filter((i) => archived.has(i.slug)),
        sessions,
        processes: Object.fromEntries(
          [...runningProcesses.entries()].map(([k, v]) => [
            k,
            { type: v.type, startTime: v.startTime, logPath: v.logPath, budget: v.budget, model: v.model },
          ])
        ),
      });
    }

    // --- API: Library ---
    if (url.pathname === "/api/library" && method === "GET") {
      const items = await getLibraryItems();
      return Response.json(items);
    }

    // --- API: PRD Detail ---
    if (url.pathname.startsWith("/api/prd/") && method === "GET") {
      const slug = decodeURIComponent(url.pathname.slice("/api/prd/".length));
      const prdPath = await findPrdPath(slug);
      if (!prdPath) return Response.json({ error: "Not found" }, { status: 404 });
      const content = await readFile(prdPath, "utf-8");
      const fm = parseFrontmatter(content);
      const criteria = parseCriteria(content);
      return Response.json({ frontmatter: fm, criteria, raw: content, path: prdPath });
    }

    // --- API: Create Task ---
    if (url.pathname === "/api/task" && method === "POST") {
      const body = await req.json() as { title: string; description: string; effort: string; mode: string };
      const slug = await createTask(body.title, body.description || "", body.effort || "standard", body.mode || "interactive");
      return Response.json({ slug });
    }

    // --- API: Update Phase ---
    if (url.pathname.match(/^\/api\/task\/[^/]+\/phase$/) && method === "PATCH") {
      const slug = decodeURIComponent(url.pathname.split("/")[3]);
      const body = await req.json() as { phase: string };
      const ok = await updatePhase(slug, body.phase);
      return ok ? Response.json({ ok: true }) : Response.json({ error: "Not found" }, { status: 404 });
    }

    // --- API: Toggle Criterion ---
    if (url.pathname.match(/^\/api\/task\/[^/]+\/criteria\/[^/]+$/) && method === "PATCH") {
      const parts = url.pathname.split("/");
      const slug = decodeURIComponent(parts[3]);
      const criterionId = decodeURIComponent(parts[5]);
      const ok = await toggleCriterion(slug, criterionId);
      return ok ? Response.json({ ok: true }) : Response.json({ error: "Not found" }, { status: 404 });
    }

    // --- API: Archive ---
    if (url.pathname.match(/^\/api\/task\/[^/]+\/archive$/) && method === "POST") {
      const slug = decodeURIComponent(url.pathname.split("/")[3]);
      archiveItem(slug);
      return Response.json({ ok: true });
    }
    if (url.pathname.match(/^\/api\/task\/[^/]+\/archive$/) && method === "DELETE") {
      const slug = decodeURIComponent(url.pathname.split("/")[3]);
      unarchiveItem(slug);
      return Response.json({ ok: true });
    }

    // --- API: Ralph Loop ---
    if (url.pathname.match(/^\/api\/task\/[^/]+\/ralph$/) && method === "POST") {
      const slug = decodeURIComponent(url.pathname.split("/")[3]);
      const prdPath = await findPrdPath(slug);
      if (!prdPath) return Response.json({ error: "PRD not found" }, { status: 404 });
      const body = (await req.json().catch(() => ({}))) as { budget?: number; maxIterations?: number; model?: string };
      const ok = startRalphLoop(slug, prdPath, body.budget, body.maxIterations, body.model);
      return ok ? Response.json({ ok: true }) : Response.json({ error: "Already running" }, { status: 409 });
    }
    if (url.pathname.match(/^\/api\/task\/[^/]+\/ralph$/) && method === "DELETE") {
      const slug = decodeURIComponent(url.pathname.split("/")[3]);
      const ok = stopProcess(slug);
      return ok ? Response.json({ ok: true }) : Response.json({ error: "Not running" }, { status: 404 });
    }

    // --- API: Docker ---
    if (url.pathname.match(/^\/api\/task\/[^/]+\/docker$/) && method === "POST") {
      const slug = decodeURIComponent(url.pathname.split("/")[3]);
      const prdPath = await findPrdPath(slug);
      if (!prdPath) return Response.json({ error: "PRD not found" }, { status: 404 });
      const body = (await req.json().catch(() => ({}))) as { budget?: number };
      const ok = startDocker(slug, prdPath, body.budget);
      return ok ? Response.json({ ok: true }) : Response.json({ error: "Already running or Docker disabled" }, { status: 409 });
    }
    if (url.pathname.match(/^\/api\/task\/[^/]+\/docker$/) && method === "DELETE") {
      const slug = decodeURIComponent(url.pathname.split("/")[3]);
      const ok = stopProcess(slug);
      return ok ? Response.json({ ok: true }) : Response.json({ error: "Not running" }, { status: 404 });
    }

    // --- API: Log Streaming ---
    if (url.pathname.match(/^\/api\/task\/[^/]+\/log$/) && method === "GET") {
      const slug = decodeURIComponent(url.pathname.split("/")[3]);
      const rp = runningProcesses.get(slug);
      if (!rp) return Response.json({ error: "No running process" }, { status: 404 });
      try {
        const log = readFileSync(rp.logPath, "utf-8");
        return new Response(log, { headers: { "Content-Type": "text/plain" } });
      } catch {
        return new Response("", { headers: { "Content-Type": "text/plain" } });
      }
    }

    // --- API: Config ---
    if (url.pathname === "/api/config" && method === "GET") {
      return Response.json(config);
    }
    if (url.pathname === "/api/config" && method === "PUT") {
      const body = await req.json();
      config = { ...config, ...body };
      saveConfig(config);
      return Response.json({ ok: true });
    }

    // --- API: Processes ---
    if (url.pathname === "/api/processes" && method === "GET") {
      const procs = [...runningProcesses.entries()].map(([k, v]) => ({
        slug: k,
        type: v.type,
        startTime: v.startTime,
        elapsed: Date.now() - v.startTime,
        logPath: v.logPath,
        budget: v.budget,
        model: v.model,
      }));
      return Response.json(procs);
    }

    // --- API: SSE ---
    if (url.pathname === "/api/events") {
      const stream = new ReadableStream({
        start(controller) {
          sseClients.add(controller);
          controller.enqueue("data: connected\n\n");
        },
        cancel(controller) {
          sseClients.delete(controller);
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`KAI Board v2 running at http://localhost:${PORT}`);
console.log(`Scanning ${SCAN_DIRS.length} directories:`);
for (const dir of SCAN_DIRS) console.log(`  → ${dir}`);
console.log(`Auto-discovery: ${config.autoDiscover ? PROJECTS_DIR : "disabled"}`);
