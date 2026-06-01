import { useEffect, useState } from 'react'
import { HotkeysProvider } from 'react-hotkeys-hook'
import { KanbanContainer } from './features/kanban/KanbanContainer'
import { KanbanFilterBar } from './features/kanban/KanbanFilterBar'
import { ListView } from './features/list/ListView'
import { BulkActionBar } from './features/BulkActionBar'
import { SessionsList } from './components/sessions/SessionsList'
import { AgentViewPanel } from './components/sessions/AgentViewPanel'
import { GitHubPanel } from './components/github/GitHubPanel'
import { LibraryPanel } from './components/library/LibraryPanel'
import { CommandBar } from './components/command-bar/CommandBar'
import { CreateTaskDialog } from './components/CreateTaskDialog'
import { TaskDetailPanel } from './components/TaskDetailPanel'
import { useSSE } from './hooks/useSSE'
import { useWorkItems } from './hooks/useWorkItems'
import { useKeyboardShortcuts } from './keyboard/useKeyboardShortcuts'
import { useUiPreferences } from './stores/useUiPreferences'
import { Moon, Sun, Kanban, Plus } from '@phosphor-icons/react'

export function App() {
  useSSE()
  useKeyboardShortcuts()
  const { darkMode, toggleDarkMode, focusedSlug, sidebarCollapsed, viewMode } = useUiPreferences()
  const { data } = useWorkItems()
  const [createOpen, setCreateOpen] = useState(false)

  const items = data?.items ?? []
  const processes = data?.processes ?? {}
  const sessions = data?.sessions ?? []

  const focusedItem = focusedSlug ? items.find((i) => i.slug === focusedSlug) : null
  const activeSessionSlugs = new Set(sessions.filter((s) => s.isActive).map((s) => s.taskSlug).filter(Boolean))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
  }, [darkMode])

  // c shortcut to create
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        e.preventDefault()
        setCreateOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <HotkeysProvider initiallyActiveScopes={['global', 'kanban']}>
      <div className="flex h-screen flex-col">
        {/* Header */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <Kanban size={20} weight="bold" className="text-primary" />
            <h1 className="text-sm font-semibold">KAI Board</h1>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus size={14} />
              <span>New</span>
            </button>
            <button
              onClick={toggleDarkMode}
              className="rounded-md p-1.5 hover:bg-accent"
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>

        {/* Main layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left sidebar */}
          {!sidebarCollapsed && (
            <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-r bg-muted/30">
              <AgentViewPanel />
              <SessionsList />
              <GitHubPanel />
              <LibraryPanel />
            </aside>
          )}

          {/* Main content */}
          <main className="flex flex-1 flex-col overflow-hidden">
            <KanbanFilterBar items={items} />
            <div className="flex-1 overflow-hidden">
              {viewMode === 'kanban' ? <KanbanContainer /> : <ListView />}
            </div>
          </main>

          {/* Task detail panel */}
          {focusedItem && (
            <TaskDetailPanel
              item={focusedItem}
              process={processes[focusedItem.slug]}
              sessionActive={activeSessionSlugs.has(focusedItem.slug)}
              onClose={() => useUiPreferences.getState().setFocusedSlug(null)}
            />
          )}
        </div>

        {/* Command palette */}
        <CommandBar />
        <CreateTaskDialog open={createOpen} onOpenChange={setCreateOpen} />
        <BulkActionBar />
      </div>
    </HotkeysProvider>
  )
}
