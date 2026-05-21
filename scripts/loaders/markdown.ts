/**
 * MarkdownLoader — reads/writes PRD.md files with YAML frontmatter.
 * Extracted from board.ts (lines 148–197, 477–577).
 */

import { readdir, readFile, writeFile, stat } from "fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, basename, dirname } from "path";
import type { WorkItem, WorkLoader } from "./work";

export class MarkdownLoader implements WorkLoader {
  constructor(
    private readonly scanDirs: string[],
    private readonly workRoot: string,
    private readonly archived: Set<string>,
    private readonly onUpdate: () => void,
  ) {}

  private parseFrontmatter(content: string): Record<string, string> | null {
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

  private parseCriteria(content: string): { id: string; text: string; passed: boolean }[] {
    const criteria: { id: string; text: string; passed: boolean }[] = [];
    for (const line of content.split("\n")) {
      const match = line.match(/^- \[([ x])\] (ISC-\S+):\s*(.+?)(?:\s*\[[EIR]\])?$/);
      if (match) {
        criteria.push({ id: match[2], text: match[3].trim(), passed: match[1] === "x" });
      }
    }
    return criteria;
  }

  async loadTasks(): Promise<WorkItem[]> {
    const items: WorkItem[] = [];
    const seen = new Set<string>();
    for (const scanDir of this.scanDirs) {
      try {
        const dirs = await readdir(scanDir);
        for (const dir of dirs) {
          if (dir === "decisions" || dir.startsWith(".")) continue;
          const prdPath = join(scanDir, dir, "PRD.md");
          try {
            const content = await readFile(prdPath, "utf-8");
            const fm = this.parseFrontmatter(content);
            if (!fm) continue;
            const slug = fm.slug || dir;
            if (seen.has(slug)) continue;
            seen.add(slug);
            const criteria = this.parseCriteria(content);
            const progressMatch = fm.progress?.match(/(\d+)\/(\d+)/);
            const passed = progressMatch ? parseInt(progressMatch[1]) : 0;
            const updatedStr = fm.updated || fm.started || "";
            const updatedTime = updatedStr ? new Date(updatedStr).getTime() : 0;
            const isStale = passed === 0 && updatedTime > 0 && (Date.now() - updatedTime) > 14 * 86_400_000;
            items.push({
              slug,
              task: fm.task || dir,
              effort: fm.effort || "standard",
              phase: fm.phase || "observe",
              passed,
              total: progressMatch ? parseInt(progressMatch[2]) : 0,
              mode: fm.mode || "interactive",
              started: fm.started || "",
              updated: fm.updated || "",
              criteria,
              prdPath,
              source: basename(dirname(scanDir)),
              stale: isStale,
            });
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
    items.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
    return items;
  }

  async findPrd(slug: string): Promise<string | null> {
    for (const scanDir of this.scanDirs) {
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

  async updatePhase(slug: string, newPhase: string): Promise<boolean> {
    const prdPath = await this.findPrd(slug);
    if (!prdPath) return false;
    const content = await readFile(prdPath, "utf-8");
    const updated = content
      .replace(/^phase: .+$/m, `phase: ${newPhase}`)
      .replace(/^updated: .+$/m, `updated: ${new Date().toISOString()}`);
    await writeFile(prdPath, updated);
    this.onUpdate();
    return true;
  }

  async toggleCriterion(slug: string, criterionId: string): Promise<boolean> {
    const prdPath = await this.findPrd(slug);
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
    const criteria = this.parseCriteria(content);
    const passed = criteria.filter((c) => c.passed).length;
    content = content
      .replace(/^progress: .+$/m, `progress: ${passed}/${criteria.length}`)
      .replace(/^updated: .+$/m, `updated: ${new Date().toISOString()}`);
    await writeFile(prdPath, content);
    this.onUpdate();
    return true;
  }

  async createTask(title: string, description: string, effort: string, mode: string): Promise<string> {
    const now = new Date();
    const ts = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const kebab = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const slug = `${ts}_${kebab}`;
    const workDir = join(this.workRoot, slug);
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
    this.onUpdate();
    return slug;
  }

  archiveTask(_slug: string): void { /* managed externally via config */ }
  unarchiveTask(_slug: string): void { /* managed externally via config */ }
}
