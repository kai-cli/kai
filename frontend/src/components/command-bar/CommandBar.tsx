import { useEffect, useState, useMemo } from 'react'
import { Command } from 'cmdk'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  MagnifyingGlass,
  Play,
  Archive,
  ArrowRight,
  Robot,
  Terminal,
  Folder,
  GitPullRequest,
} from '@phosphor-icons/react'
import { useWorkItems } from '@/hooks/useWorkItems'
import { useGitHub } from '@/hooks/useGitHub'
import { useLibrary } from '@/hooks/useLibrary'
import { useMutations } from '@/hooks/useMutations'
import { useUiPreferences } from '@/stores/useUiPreferences'
import { PHASE_LABELS, type Phase } from '@/types'

export function CommandBar() {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const { data: workData } = useWorkItems()
  const { data: github } = useGitHub()
  const { data: library } = useLibrary()
  const { launch, startRalph, archive, updatePhase } = useMutations()
  const { setFocusedSlug } = useUiPreferences()

  useHotkeys('meta+k, ctrl+k', (e) => {
    e.preventDefault()
    setOpen(true)
  }, { scopes: ['global'] })

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  const items = workData?.items ?? []
  const sessions = workData?.sessions ?? []

  const allItems = useMemo(() => {
    const result: {
      id: string
      label: string
      group: string
      icon: typeof Play
      action: () => void
    }[] = []

    // Work items
    for (const item of items) {
      result.push({
        id: `task-${item.slug}`,
        label: item.task,
        group: 'Tasks',
        icon: ArrowRight,
        action: () => setFocusedSlug(item.slug),
      })
    }

    // Sessions
    for (const session of sessions.filter((s) => s.isActive)) {
      result.push({
        id: `session-${session.slug}`,
        label: session.task,
        group: 'Active Sessions',
        icon: Terminal,
        action: () => {
          if (session.taskSlug) setFocusedSlug(session.taskSlug)
        },
      })
    }

    // GitHub
    for (const gh of github ?? []) {
      result.push({
        id: `gh-${gh.repo}-${gh.number}`,
        label: `${gh.title} (${gh.repo}#${gh.number})`,
        group: 'GitHub',
        icon: GitPullRequest,
        action: () => window.open(gh.url, '_blank'),
      })
    }

    // Library
    for (const lib of library ?? []) {
      result.push({
        id: `lib-${lib.path}`,
        label: lib.name,
        group: 'Library',
        icon: Folder,
        action: () => {},
      })
    }

    return result
  }, [items, sessions, github, library, setFocusedSlug])

  // Group items
  const groups = useMemo(() => {
    const map = new Map<string, typeof allItems>()
    for (const item of allItems) {
      const existing = map.get(item.group) ?? []
      existing.push(item)
      map.set(item.group, existing)
    }
    return map
  }, [allItems])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      <div
        className="fixed inset-0 bg-background/80 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      <Command
        className="relative w-full max-w-lg overflow-hidden rounded-xl border bg-card shadow-2xl"
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
      >
        <div className="flex items-center border-b px-3">
          <MagnifyingGlass size={16} className="mr-2 text-muted-foreground" />
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder="Search tasks, sessions, projects..."
            className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <Command.List className="max-h-80 overflow-y-auto p-2">
          <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
            No results found.
          </Command.Empty>

          {/* Actions (always show when no search) */}
          {!search && items.length > 0 && (
            <Command.Group heading="Quick Actions" className="mb-2">
              <ActionItem
                icon={Play}
                label="Launch Claude session"
                shortcut="l"
                onSelect={() => {
                  const focused = useUiPreferences.getState().focusedSlug
                  if (focused) {
                    launch.mutate(focused)
                    setOpen(false)
                  }
                }}
              />
              <ActionItem
                icon={Robot}
                label="Start Ralph Loop"
                shortcut="r"
                onSelect={() => {
                  const focused = useUiPreferences.getState().focusedSlug
                  if (focused) {
                    startRalph.mutate({ slug: focused })
                    setOpen(false)
                  }
                }}
              />
              <ActionItem
                icon={Archive}
                label="Archive focused task"
                shortcut="d"
                onSelect={() => {
                  const focused = useUiPreferences.getState().focusedSlug
                  if (focused) {
                    archive.mutate(focused)
                    setOpen(false)
                  }
                }}
              />
              {(['plan', 'execute', 'verify', 'done'] as Phase[]).map(
                (phase) => (
                  <ActionItem
                    key={phase}
                    icon={ArrowRight}
                    label={`Move to ${PHASE_LABELS[phase]}`}
                    onSelect={() => {
                      const focused = useUiPreferences.getState().focusedSlug
                      if (focused) {
                        updatePhase.mutate({ slug: focused, phase })
                        setOpen(false)
                      }
                    }}
                  />
                ),
              )}
            </Command.Group>
          )}

          {/* Dynamic groups */}
          {[...groups.entries()].map(([group, groupItems]) => (
            <Command.Group key={group} heading={group} className="mb-2">
              {groupItems.map((item) => {
                const Icon = item.icon
                return (
                  <Command.Item
                    key={item.id}
                    value={item.label}
                    onSelect={() => {
                      item.action()
                      setOpen(false)
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent"
                  >
                    <Icon size={14} className="text-muted-foreground" />
                    <span className="flex-1 truncate">{item.label}</span>
                  </Command.Item>
                )
              })}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </div>
  )
}

function ActionItem({
  icon: Icon,
  label,
  shortcut,
  onSelect,
}: {
  icon: typeof Play
  label: string
  shortcut?: string
  onSelect: () => void
}) {
  return (
    <Command.Item
      value={label}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent"
    >
      <Icon size={14} className="text-muted-foreground" />
      <span className="flex-1">{label}</span>
      {shortcut && (
        <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {shortcut}
        </kbd>
      )}
    </Command.Item>
  )
}
