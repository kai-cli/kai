/**
 * WorkLoader interface — abstracts task CRUD from board.ts.
 * Default implementation: markdown.ts (reads PRD.md files with YAML frontmatter).
 */

export interface WorkItem {
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
  stale: boolean;
  priority?: string;
  tags?: string[];
  sort_order?: number;
  depends_on?: string[];
}

export interface WorkLoader {
  loadTasks(): Promise<WorkItem[]>;
  updatePhase(slug: string, phase: string): Promise<boolean>;
  toggleCriterion(slug: string, criterionId: string): Promise<boolean>;
  createTask(title: string, description: string, effort: string, mode: string): Promise<string>;
  findPrd(slug: string): Promise<string | null>;
  archiveTask(slug: string): void;
  unarchiveTask(slug: string): void;
  updateSortOrder(slug: string, sort_order: number): Promise<boolean>;
  updateMetadata(slug: string, data: { priority?: string; tags?: string[] }): Promise<boolean>;
}
