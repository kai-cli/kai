import { useMemo } from 'react'
import {
  Lightning,
  ArrowUp,
  ArrowDown,
} from '@phosphor-icons/react'
import { useWorkItems } from '@/hooks/useWorkItems'
import { useKanbanFilters } from '@/hooks/useKanbanFilters'
import { useUiPreferences } from '@/stores/useUiPreferences'
import { PHASE_LABELS } from '@/types'
import type { WorkItem } from '@/types'
import { cn } from '@/lib/cn'

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-priority-urgent',
  high: 'text-priority-high',
  medium: 'text-priority-medium',
  low: 'text-priority-low',
}

export function ListView() {
  const { data, isLoading } = useWorkItems()
  const { filters, sortField, sortDirection, setSortField, setSortDirection, focusedSlug, setFocusedSlug, selectedSlugs, toggleSelection } = useUiPreferences()

  const items = data?.items ?? []
  const sessions = data?.sessions ?? []

  const activeSessionSlugs = useMemo(
    () => new Set(sessions.filter((s) => s.isActive).map((s) => s.taskSlug).filter(Boolean)),
    [sessions],
  )

  const filteredItems = useKanbanFilters({ items, filters, sortField, sortDirection })

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading...
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b text-left text-muted-foreground">
              <th className="w-8 px-2 py-2">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={selectedSlugs.size === filteredItems.length && filteredItems.length > 0}
                  onChange={() => {
                    if (selectedSlugs.size === filteredItems.length) {
                      useUiPreferences.getState().clearSelection()
                    } else {
                      useUiPreferences.getState().selectRange(filteredItems.map((i) => i.slug))
                    }
                  }}
                />
              </th>
              <SortHeader field="task" label="Task" current={sortField} direction={sortDirection} onSort={handleSort} />
              <th className="px-2 py-2 font-medium">Phase</th>
              <SortHeader field="priority" label="Priority" current={sortField} direction={sortDirection} onSort={handleSort} />
              <th className="px-2 py-2 font-medium">Effort</th>
              <th className="px-2 py-2 font-medium">Progress</th>
              <SortHeader field="updated" label="Updated" current={sortField} direction={sortDirection} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => (
              <ListRow
                key={item.slug}
                item={item}
                isFocused={focusedSlug === item.slug}
                isSelected={selectedSlugs.has(item.slug)}
                isActive={activeSessionSlugs.has(item.slug)}
                onFocus={() => setFocusedSlug(item.slug)}
                onSelect={() => toggleSelection(item.slug)}
              />
            ))}
          </tbody>
        </table>
        {filteredItems.length === 0 && (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No items match filters
          </div>
        )}
      </div>
    </div>
  )
}

function ListRow({
  item,
  isFocused,
  isSelected,
  isActive,
  onFocus,
  onSelect,
}: {
  item: WorkItem
  isFocused: boolean
  isSelected: boolean
  isActive: boolean
  onFocus: () => void
  onSelect: () => void
}) {
  const progress = item.total > 0 ? Math.round((item.passed / item.total) * 100) : 0

  return (
    <tr
      onClick={onFocus}
      className={cn(
        'border-b transition-colors hover:bg-accent/50 cursor-pointer',
        isFocused && 'bg-accent',
        isSelected && 'bg-primary/5',
      )}
    >
      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className="rounded"
          checked={isSelected}
          onChange={onSelect}
        />
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-2">
          {isActive && <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />}
          <span className="font-medium">{item.task}</span>
        </div>
      </td>
      <td className="px-2 py-2">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
          {PHASE_LABELS[item.phase] || item.phase}
        </span>
      </td>
      <td className="px-2 py-2">
        {item.priority && (
          <span className={cn('flex items-center gap-1', PRIORITY_COLORS[item.priority])}>
            <Lightning size={10} weight="fill" />
            {item.priority}
          </span>
        )}
      </td>
      <td className="px-2 py-2 text-muted-foreground">{item.effort}</td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-phase-done"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-muted-foreground">{item.passed}/{item.total}</span>
        </div>
      </td>
      <td className="px-2 py-2 text-muted-foreground">{item.updated}</td>
    </tr>
  )
}

function SortHeader({
  field,
  label,
  current,
  direction,
  onSort,
}: {
  field: string
  label: string
  current: string
  direction: 'asc' | 'desc'
  onSort: (field: any) => void
}) {
  const isActive = current === field
  return (
    <th
      className="cursor-pointer select-none px-2 py-2 font-medium hover:text-foreground"
      onClick={() => onSort(field)}
    >
      <span className="flex items-center gap-1">
        {label}
        {isActive && (direction === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
      </span>
    </th>
  )
}
