import { useMemo } from 'react'
import { MagnifyingGlass, Funnel, X, Kanban, List } from '@phosphor-icons/react'
import { useUiPreferences } from '@/stores/useUiPreferences'
import type { WorkItem, Priority } from '@/types'
import { cn } from '@/lib/cn'

const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low']
const EFFORTS = ['quick', 'standard', 'deep']

interface KanbanFilterBarProps {
  items: WorkItem[]
}

export function KanbanFilterBar({ items }: KanbanFilterBarProps) {
  const { filters, setFilters, clearFilters, viewMode, setViewMode } = useUiPreferences()

  // Derive available tags from items
  const availableTags = useMemo(() => {
    const tags = new Set<string>()
    for (const item of items) {
      item.tags?.forEach((t) => tags.add(t))
    }
    return [...tags].sort()
  }, [items])

  // Derive available sources
  const availableSources = useMemo(() => {
    const sources = new Set<string>()
    for (const item of items) {
      if (item.source) sources.add(item.source)
    }
    return [...sources].sort()
  }, [items])

  const hasActiveFilters =
    filters.searchQuery ||
    filters.priorities.length > 0 ||
    filters.tags.length > 0 ||
    filters.efforts.length > 0 ||
    filters.sources.length > 0 ||
    filters.hideStale

  return (
    <div className="flex items-center gap-3 border-b px-4 py-2">
      {/* Search */}
      <div className="relative flex-1 max-w-xs">
        <MagnifyingGlass
          size={14}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="text"
          placeholder="Search tasks..."
          value={filters.searchQuery}
          onChange={(e) => setFilters({ searchQuery: e.target.value })}
          className="h-7 w-full rounded-md border bg-transparent pl-7 pr-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Priority filter */}
      <FilterChipGroup
        label="Priority"
        options={PRIORITIES}
        selected={filters.priorities}
        onToggle={(p) => {
          const next = filters.priorities.includes(p as Priority)
            ? filters.priorities.filter((x) => x !== p)
            : [...filters.priorities, p as Priority]
          setFilters({ priorities: next })
        }}
      />

      {/* Effort filter */}
      <FilterChipGroup
        label="Effort"
        options={EFFORTS}
        selected={filters.efforts}
        onToggle={(e) => {
          const next = filters.efforts.includes(e)
            ? filters.efforts.filter((x) => x !== e)
            : [...filters.efforts, e]
          setFilters({ efforts: next })
        }}
      />

      {/* Tags filter */}
      {availableTags.length > 0 && (
        <FilterChipGroup
          label="Tags"
          options={availableTags}
          selected={filters.tags}
          onToggle={(t) => {
            const next = filters.tags.includes(t)
              ? filters.tags.filter((x) => x !== t)
              : [...filters.tags, t]
            setFilters({ tags: next })
          }}
        />
      )}

      {/* Source filter */}
      {availableSources.length > 1 && (
        <FilterChipGroup
          label="Source"
          options={availableSources}
          selected={filters.sources}
          onToggle={(s) => {
            const next = filters.sources.includes(s)
              ? filters.sources.filter((x) => x !== s)
              : [...filters.sources, s]
            setFilters({ sources: next })
          }}
        />
      )}

      {/* Hide stale toggle */}
      <button
        onClick={() => setFilters({ hideStale: !filters.hideStale })}
        className={cn(
          'rounded-md px-2 py-1 text-[11px] transition-colors',
          filters.hideStale
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent',
        )}
      >
        Hide stale
      </button>

      {/* Clear filters */}
      {hasActiveFilters && (
        <button
          onClick={clearFilters}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10"
        >
          <X size={12} />
          Clear
        </button>
      )}

      <div className="ml-auto flex items-center rounded-md border">
        <button
          onClick={() => setViewMode('kanban')}
          className={cn(
            'rounded-l-md p-1.5',
            viewMode === 'kanban' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Kanban size={14} />
        </button>
        <button
          onClick={() => setViewMode('list')}
          className={cn(
            'rounded-r-md p-1.5',
            viewMode === 'list' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <List size={14} />
        </button>
      </div>
    </div>
  )
}

// --- Reusable filter chip dropdown ---
function FilterChipGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string
  options: string[]
  selected: string[]
  onToggle: (value: string) => void
}) {
  const isActive = selected.length > 0

  return (
    <div className="group relative">
      <button
        className={cn(
          'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors',
          isActive
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent',
        )}
      >
        <Funnel size={11} />
        {label}
        {isActive && (
          <span className="ml-0.5 text-[10px] opacity-75">
            ({selected.length})
          </span>
        )}
      </button>
      <div className="invisible absolute left-0 top-full z-50 mt-1 min-w-[120px] rounded-md border bg-card p-1 shadow-lg group-hover:visible">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onToggle(opt)}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-xs',
              selected.includes(opt)
                ? 'bg-accent font-medium'
                : 'hover:bg-accent/50',
            )}
          >
            <span
              className={cn(
                'h-3 w-3 rounded-sm border',
                selected.includes(opt) && 'bg-primary border-primary',
              )}
            />
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}
