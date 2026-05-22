export const SCOPES = {
  GLOBAL: 'global',
  KANBAN: 'kanban',
  DIALOG: 'dialog',
} as const

export interface ShortcutDef {
  key: string
  description: string
  scope: string
}

export const SHORTCUTS: Record<string, ShortcutDef> = {
  NAV_DOWN: { key: 'j', description: 'Move focus down', scope: SCOPES.KANBAN },
  NAV_UP: { key: 'k', description: 'Move focus up', scope: SCOPES.KANBAN },
  NAV_LEFT: { key: 'h', description: 'Move focus left', scope: SCOPES.KANBAN },
  NAV_RIGHT: { key: 'l', description: 'Move focus right', scope: SCOPES.KANBAN },
  CREATE: { key: 'c', description: 'Create new task', scope: SCOPES.KANBAN },
  ARCHIVE: { key: 'd', description: 'Archive focused task', scope: SCOPES.KANBAN },
  PHASE_FORWARD: { key: 'p', description: 'Cycle phase forward', scope: SCOPES.KANBAN },
  PHASE_BACKWARD: { key: 'shift+p', description: 'Cycle phase backward', scope: SCOPES.KANBAN },
  LAUNCH: { key: 'l', description: 'Launch Claude session', scope: SCOPES.KANBAN },
  RALPH: { key: 'r', description: 'Start Ralph Loop', scope: SCOPES.KANBAN },
  SEARCH: { key: '/', description: 'Focus search', scope: SCOPES.KANBAN },
  COMMAND: { key: 'meta+k', description: 'Open command palette', scope: SCOPES.GLOBAL },
  ESCAPE: { key: 'escape', description: 'Close / clear', scope: SCOPES.GLOBAL },
  SELECT: { key: 'x', description: 'Toggle selection', scope: SCOPES.KANBAN },
  SELECT_DOWN: { key: 'shift+j', description: 'Extend selection down', scope: SCOPES.KANBAN },
  SELECT_UP: { key: 'shift+k', description: 'Extend selection up', scope: SCOPES.KANBAN },
  COL_1: { key: '1', description: 'Jump to Observe', scope: SCOPES.KANBAN },
  COL_2: { key: '2', description: 'Jump to Plan', scope: SCOPES.KANBAN },
  COL_3: { key: '3', description: 'Jump to Execute', scope: SCOPES.KANBAN },
  COL_4: { key: '4', description: 'Jump to Verify', scope: SCOPES.KANBAN },
}
