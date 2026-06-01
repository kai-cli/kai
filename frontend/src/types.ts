export type Phase = 'backlog' | 'observe' | 'plan' | 'execute' | 'verify' | 'done' | 'complete'
export type Priority = 'urgent' | 'high' | 'medium' | 'low'
export type Effort = 'quick' | 'standard' | 'deep'
export type ViewMode = 'kanban' | 'list'

export interface Criterion {
  id: string
  text: string
  passed: boolean
}

export interface WorkItem {
  slug: string
  task: string
  effort: string
  phase: Phase
  passed: number
  total: number
  mode: string
  started: string
  updated: string
  criteria: Criterion[]
  prdPath: string
  source: string
  stale: boolean
  priority?: Priority
  tags?: string[]
  sort_order?: number
  depends_on?: string[]
}

export interface SessionItem {
  slug: string
  task: string
  phase: string
  sessionUUID?: string
  startedAt?: string
  isActive: boolean
  sessionName?: string
  taskSlug?: string
  lifecycle?: {
    startedAt?: string
    endedAt?: string
    durationMs?: number
    exitStatus?: string
    exitReason?: string
    commitAtStart?: string
  }
  events?: {
    type: string
    at: string
    from?: string
    to?: string
    detail?: string
  }[]
}

export interface GitHubItem {
  repo: string
  number: number
  title: string
  type: 'pr' | 'issue'
  state: string
  url: string
  updatedAt: string
  labels: string[]
}

export interface AgentViewSession {
  id: string
  state: 'working' | 'needs-input' | 'idle' | 'completed' | 'failed' | 'stopped'
  cwd: string
  agent?: string
  startedAt?: string
  label?: string
  projectName?: string
}

export interface LibraryItem {
  name: string
  path: string
  description: string
  tags: string[]
  pinned?: boolean
  discovered?: boolean
}

export interface ProcessInfo {
  type: 'ralph' | 'docker'
  startTime: number
  logPath: string
  budget?: number
  model?: string
}

export interface WorkResponse {
  items: WorkItem[]
  archived: WorkItem[]
  sessions: SessionItem[]
  processes: Record<string, ProcessInfo>
}

export const PHASES: Phase[] = ['backlog', 'observe', 'plan', 'execute', 'verify', 'done', 'complete']

export const PHASE_LABELS: Record<Phase, string> = {
  backlog: 'Backlog',
  observe: 'Observe',
  plan: 'Plan',
  execute: 'Execute',
  verify: 'Verify',
  done: 'Done',
  complete: 'Complete',
}

export const PHASE_COLORS: Record<Phase, string> = {
  backlog: 'bg-phase-backlog',
  observe: 'bg-phase-observe',
  plan: 'bg-phase-plan',
  execute: 'bg-phase-execute',
  verify: 'bg-phase-verify',
  done: 'bg-phase-done',
  complete: 'bg-phase-complete',
}
