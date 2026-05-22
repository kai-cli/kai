import { type ReactNode, createContext, useContext } from 'react'
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd'
import { cn } from '@/lib/cn'

interface KanbanContextValue {
  onDragEnd: (result: DropResult) => void
}

const KanbanContext = createContext<KanbanContextValue | null>(null)

export function useKanbanContext() {
  const ctx = useContext(KanbanContext)
  if (!ctx) throw new Error('useKanbanContext must be inside KanbanProvider')
  return ctx
}

// --- Provider ---
export function KanbanProvider({
  children,
  onDragEnd,
  className,
}: {
  children: ReactNode
  onDragEnd: (result: DropResult) => void
  className?: string
}) {
  return (
    <KanbanContext.Provider value={{ onDragEnd }}>
      <DragDropContext onDragEnd={onDragEnd}>
        <div className={cn('flex h-full gap-3 overflow-x-auto px-4 py-3', className)}>
          {children}
        </div>
      </DragDropContext>
    </KanbanContext.Provider>
  )
}

// --- Column (Droppable) ---
export function KanbanColumn({
  id,
  children,
  className,
}: {
  id: string
  children: ReactNode
  className?: string
}) {
  return (
    <Droppable droppableId={id}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          className={cn(
            'flex min-h-[200px] flex-1 flex-col gap-2 rounded-lg p-2 transition-colors',
            snapshot.isDraggingOver && 'bg-accent/50',
            className,
          )}
        >
          {children}
          {provided.placeholder}
        </div>
      )}
    </Droppable>
  )
}

// --- Card (Draggable) ---
export function KanbanCard({
  id,
  index,
  children,
  className,
  onClick,
  isFocused,
  isSelected,
}: {
  id: string
  index: number
  children: ReactNode
  className?: string
  onClick?: (e: React.MouseEvent) => void
  isFocused?: boolean
  isSelected?: boolean
}) {
  return (
    <Draggable draggableId={id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={onClick}
          className={cn(
            'rounded-lg border bg-card p-3 shadow-sm transition-all',
            snapshot.isDragging && 'rotate-2 shadow-lg',
            isFocused && 'ring-2 ring-ring',
            isSelected && 'border-primary bg-primary/5',
            'hover:shadow-md',
            className,
          )}
        >
          {children}
        </div>
      )}
    </Draggable>
  )
}

// --- Column Header ---
export function KanbanHeader({
  name,
  color,
  count,
  onAddTask,
}: {
  name: string
  color: string
  count: number
  onAddTask?: () => void
}) {
  return (
    <div className="mb-2 flex items-center justify-between px-1">
      <div className="flex items-center gap-2">
        <div className={cn('h-3 w-3 rounded-full', color)} />
        <span className="text-sm font-medium">{name}</span>
        <span className="text-xs text-muted-foreground">{count}</span>
      </div>
      {onAddTask && (
        <button
          onClick={onAddTask}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  )
}
