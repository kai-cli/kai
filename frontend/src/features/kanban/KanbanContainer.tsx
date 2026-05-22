import { useMemo, useCallback } from 'react'
import type { DropResult } from '@hello-pangea/dnd'
import {
  KanbanProvider,
  KanbanColumn,
  KanbanCard,
  KanbanHeader,
} from '@/components/kanban/KanbanBoard'
import { KanbanCardContent } from '@/components/kanban/KanbanCardContent'
import { useWorkItems } from '@/hooks/useWorkItems'
import { useKanbanFilters } from '@/hooks/useKanbanFilters'
import { useMutations } from '@/hooks/useMutations'
import { useUiPreferences } from '@/stores/useUiPreferences'
import type { WorkItem, Phase } from '@/types'
import { PHASES } from '@/types'

type VisualColumn = 'planning' | 'active' | 'done'

const VISUAL_COLUMNS: { id: VisualColumn; label: string; color: string; phases: Phase[] }[] = [
  { id: 'planning', label: 'Planning', color: 'bg-phase-plan', phases: ['backlog', 'observe', 'plan'] },
  { id: 'active', label: 'Active', color: 'bg-phase-execute', phases: ['execute', 'verify'] },
  { id: 'done', label: 'Done', color: 'bg-phase-done', phases: ['done', 'complete'] },
]

const PHASE_TO_COLUMN: Record<Phase, VisualColumn> = {
  backlog: 'planning',
  observe: 'planning',
  plan: 'planning',
  execute: 'active',
  verify: 'active',
  done: 'done',
  complete: 'done',
}

// Default phase when dragging into a visual column
const COLUMN_DEFAULT_PHASE: Record<VisualColumn, Phase> = {
  planning: 'backlog',
  active: 'execute',
  done: 'done',
}

export function KanbanContainer() {
  const { data, isLoading } = useWorkItems()
  const { filters, sortField, sortDirection, focusedSlug, setFocusedSlug } =
    useUiPreferences()
  const { updatePhase, reorder } = useMutations()

  const items = data?.items ?? []
  const processes = data?.processes ?? {}
  const sessions = data?.sessions ?? []

  // Active session slugs for indicators
  const activeSessionSlugs = useMemo(
    () => new Set(sessions.filter((s) => s.isActive).map((s) => s.taskSlug).filter(Boolean)),
    [sessions],
  )

  // Apply filters + sorting
  const filteredItems = useKanbanFilters({
    items,
    filters,
    sortField,
    sortDirection,
  })

  // Group by visual column
  const columns = useMemo(() => {
    const grouped: Record<VisualColumn, WorkItem[]> = {
      planning: [],
      active: [],
      done: [],
    }
    for (const item of filteredItems) {
      const phase = PHASES.includes(item.phase as Phase)
        ? (item.phase as Phase)
        : 'backlog'
      grouped[PHASE_TO_COLUMN[phase]].push(item)
    }
    return grouped
  }, [filteredItems])

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { source, destination, draggableId } = result
      if (!destination) return
      if (
        source.droppableId === destination.droppableId &&
        source.index === destination.index
      )
        return

      const destCol = destination.droppableId as VisualColumn
      const destColumn = [...columns[destCol]]

      const movedItem = items.find((i) => i.slug === draggableId)
      if (!movedItem) return

      // If moving between columns, update phase to column default
      if (source.droppableId !== destination.droppableId) {
        const newPhase = COLUMN_DEFAULT_PHASE[destCol]
        updatePhase.mutate({ slug: draggableId, phase: newPhase })
      }

      // Remove from source if same column
      if (source.droppableId === destination.droppableId) {
        destColumn.splice(source.index, 1)
      }
      destColumn.splice(destination.index, 0, movedItem)

      const targetPhase = source.droppableId !== destination.droppableId
        ? COLUMN_DEFAULT_PHASE[destCol]
        : movedItem.phase

      const updates = destColumn.map((item, idx) => ({
        slug: item.slug,
        phase: item.slug === draggableId ? targetPhase : item.phase,
        sort_order: idx,
      }))

      reorder.mutate(updates)
    },
    [columns, items, updatePhase, reorder],
  )

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading...
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <KanbanProvider onDragEnd={handleDragEnd} className="flex-1">
        {VISUAL_COLUMNS.map((col) => {
          const colItems = columns[col.id]
          const count = colItems.length

          return (
            <div key={col.id} className="flex flex-1 flex-col">
              <KanbanHeader
                name={col.label}
                color={col.color}
                count={count}
              />
              <KanbanColumn id={col.id} className="overflow-y-auto">
                {count === 0 ? (
                  <div className="flex h-32 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
                    Drop here
                  </div>
                ) : (
                  colItems.map((item, index) => (
                    <KanbanCard
                      key={item.slug}
                      id={item.slug}
                      index={index}
                      isFocused={focusedSlug === item.slug}
                      onClick={() => setFocusedSlug(item.slug)}
                    >
                      <KanbanCardContent
                        item={item}
                        process={processes[item.slug]}
                        sessionActive={activeSessionSlugs.has(item.slug)}
                      />
                    </KanbanCard>
                  ))
                )}
              </KanbanColumn>
            </div>
          )
        })}
      </KanbanProvider>
    </div>
  )
}
