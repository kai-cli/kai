import { useMemo } from 'react'
import type { WorkItem } from '@/types'
import type { FilterState } from '@/stores/useUiPreferences'

interface UseKanbanFiltersProps {
  items: WorkItem[]
  filters: FilterState
  sortField: string
  sortDirection: 'asc' | 'desc'
}

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export function useKanbanFilters({
  items,
  filters,
  sortField,
  sortDirection,
}: UseKanbanFiltersProps): WorkItem[] {
  return useMemo(() => {
    let filtered = items

    // Text search
    if (filters.searchQuery) {
      const q = filters.searchQuery.toLowerCase()
      filtered = filtered.filter(
        (item) =>
          item.task.toLowerCase().includes(q) ||
          item.slug.toLowerCase().includes(q),
      )
    }

    // Priority filter
    if (filters.priorities.length > 0) {
      filtered = filtered.filter(
        (item) => item.priority && filters.priorities.includes(item.priority),
      )
    }

    // Tags filter (OR — item matches if it has any of the selected tags)
    if (filters.tags.length > 0) {
      filtered = filtered.filter(
        (item) =>
          item.tags && item.tags.some((t) => filters.tags.includes(t)),
      )
    }

    // Effort filter
    if (filters.efforts.length > 0) {
      filtered = filtered.filter((item) =>
        filters.efforts.includes(item.effort),
      )
    }

    // Source filter
    if (filters.sources.length > 0) {
      filtered = filtered.filter((item) =>
        filters.sources.includes(item.source),
      )
    }

    // Hide stale
    if (filters.hideStale) {
      filtered = filtered.filter((item) => !item.stale)
    }

    // Sort
    const dir = sortDirection === 'asc' ? 1 : -1
    filtered = [...filtered].sort((a, b) => {
      switch (sortField) {
        case 'sort_order':
          return ((a.sort_order ?? 999) - (b.sort_order ?? 999)) * dir
        case 'updated':
          return (a.updated || '').localeCompare(b.updated || '') * dir
        case 'started':
          return (a.started || '').localeCompare(b.started || '') * dir
        case 'priority': {
          const pa = PRIORITY_ORDER[a.priority ?? ''] ?? 4
          const pb = PRIORITY_ORDER[b.priority ?? ''] ?? 4
          return (pa - pb) * dir
        }
        case 'task':
          return a.task.localeCompare(b.task) * dir
        default:
          return 0
      }
    })

    return filtered
  }, [items, filters, sortField, sortDirection])
}
