import {
  Lightning,
  ArrowUp,
  Minus,
  ArrowDown,
  Circle,
  Timer,
  Robot,
} from '@phosphor-icons/react'
import { cn } from '@/lib/cn'
import type { WorkItem, Priority, ProcessInfo } from '@/types'

interface KanbanCardContentProps {
  item: WorkItem
  process?: ProcessInfo
  sessionActive?: boolean
}

const PRIORITY_CONFIG: Record<
  Priority,
  { icon: typeof Lightning; color: string; label: string }
> = {
  urgent: { icon: Lightning, color: 'text-priority-urgent', label: 'Urgent' },
  high: { icon: ArrowUp, color: 'text-priority-high', label: 'High' },
  medium: { icon: Minus, color: 'text-priority-medium', label: 'Medium' },
  low: { icon: ArrowDown, color: 'text-priority-low', label: 'Low' },
}

export function KanbanCardContent({
  item,
  process,
  sessionActive,
}: KanbanCardContentProps) {
  const priorityCfg = item.priority ? PRIORITY_CONFIG[item.priority] : null
  const PriorityIcon = priorityCfg?.icon

  return (
    <div className="flex flex-col gap-1.5">
      {/* Title row */}
      <div className="flex items-start gap-1.5">
        {PriorityIcon && (
          <PriorityIcon
            size={14}
            weight="bold"
            className={cn('mt-0.5 shrink-0', priorityCfg.color)}
          />
        )}
        <span className="text-sm font-medium leading-tight line-clamp-2">
          {item.task}
        </span>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-2">
        {/* Effort badge */}
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {item.effort}
        </span>

        {/* ISC progress */}
        {item.total > 0 && (
          <div className="flex items-center gap-1">
            <div className="h-1 w-12 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-phase-done transition-all"
                style={{
                  width: `${(item.passed / item.total) * 100}%`,
                }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">
              {item.passed}/{item.total}
            </span>
          </div>
        )}

        {/* Staleness */}
        {item.stale && (
          <Timer size={12} className="text-priority-medium" weight="bold" />
        )}

        {/* Active process indicator */}
        {process && (
          <Robot size={12} className="animate-pulse text-phase-execute" />
        )}

        {/* Active session indicator */}
        {sessionActive && (
          <Circle size={8} weight="fill" className="text-phase-done animate-pulse" />
        )}
      </div>

      {/* Tags */}
      {item.tags && item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] text-accent-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
