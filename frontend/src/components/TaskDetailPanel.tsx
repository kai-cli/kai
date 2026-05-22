import {
  X,
  Play,
  ArrowsClockwise,
  Archive,
  CheckCircle,
  Circle,
  Lightning,
  Clock,
  Tag,
} from '@phosphor-icons/react'
import { useMutations } from '@/hooks/useMutations'
import { useUiPreferences } from '@/stores/useUiPreferences'
import type { WorkItem, ProcessInfo } from '@/types'
import { PHASES, PHASE_LABELS, PHASE_COLORS } from '@/types'
import { cn } from '@/lib/cn'

interface TaskDetailPanelProps {
  item: WorkItem
  process?: ProcessInfo
  sessionActive?: boolean
  onClose: () => void
}

export function TaskDetailPanel({ item, process, sessionActive, onClose }: TaskDetailPanelProps) {
  const { updatePhase, toggleCriterion, archive, launch, startRalph } = useMutations()
  const { setFocusedSlug } = useUiPreferences()

  const handleClose = () => {
    setFocusedSlug(null)
    onClose()
  }

  const progress = item.total > 0 ? Math.round((item.passed / item.total) * 100) : 0

  return (
    <div className="flex h-full w-[380px] shrink-0 flex-col border-l bg-card">
      {/* Header */}
      <div className="flex items-start justify-between border-b p-4">
        <div className="flex-1 pr-2">
          <h2 className="text-sm font-semibold leading-tight">{item.task}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{item.slug}</p>
        </div>
        <button onClick={handleClose} className="rounded-md p-1 hover:bg-accent">
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Phase + metadata */}
        <div className="mb-4 flex flex-wrap gap-2">
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white', PHASE_COLORS[item.phase])}>
            {PHASE_LABELS[item.phase]}
          </span>
          {item.priority && (
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
              <Lightning size={10} weight="fill" className={
                item.priority === 'urgent' ? 'text-priority-urgent' :
                item.priority === 'high' ? 'text-priority-high' :
                item.priority === 'medium' ? 'text-priority-medium' : 'text-priority-low'
              } />
              {item.priority}
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
            <Clock size={10} />
            {item.effort}
          </span>
        </div>

        {/* Tags */}
        {item.tags && item.tags.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1">
            {item.tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded border bg-accent/50 px-1.5 py-0.5 text-xs">
                <Tag size={10} />
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Status indicators */}
        {(sessionActive || process) && (
          <div className="mb-4 flex flex-col gap-1">
            {sessionActive && (
              <div className="flex items-center gap-2 rounded-md bg-green-500/10 px-2 py-1 text-xs text-green-600 dark:text-green-400">
                <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                Claude session active
              </div>
            )}
            {process && (
              <div className="flex items-center gap-2 rounded-md bg-blue-500/10 px-2 py-1 text-xs text-blue-600 dark:text-blue-400">
                <ArrowsClockwise size={12} className="animate-spin" />
                {process.type === 'ralph' ? 'Ralph Loop' : 'Docker'} running
                {process.model && ` (${process.model})`}
              </div>
            )}
          </div>
        )}

        {/* Phase selector */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Phase</label>
          <div className="flex flex-wrap gap-1">
            {PHASES.map((p) => (
              <button
                key={p}
                onClick={() => updatePhase.mutate({ slug: item.slug, phase: p })}
                className={cn(
                  'rounded px-2 py-0.5 text-xs transition-colors',
                  item.phase === p
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-accent hover:bg-accent/80',
                )}
              >
                {PHASE_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {/* ISC Progress */}
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">
              ISC Progress
            </label>
            <span className="text-xs text-muted-foreground">
              {item.passed}/{item.total} ({progress}%)
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-phase-done transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Criteria checklist */}
        {item.criteria.length > 0 && (
          <div className="mb-4">
            <label className="mb-2 block text-xs font-medium text-muted-foreground">
              Criteria ({item.passed}/{item.total})
            </label>
            <div className="flex flex-col gap-1">
              {item.criteria.map((c) => (
                <button
                  key={c.id}
                  onClick={() => toggleCriterion.mutate({ slug: item.slug, criterionId: c.id })}
                  className="flex items-start gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent"
                >
                  {c.passed ? (
                    <CheckCircle size={14} weight="fill" className="mt-0.5 shrink-0 text-phase-done" />
                  ) : (
                    <Circle size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className={c.passed ? 'text-muted-foreground line-through' : ''}>
                    {c.text}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Timestamps */}
        <div className="border-t pt-3">
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            {item.started && <span>Started: {item.started}</span>}
            {item.updated && <span>Updated: {item.updated}</span>}
            {item.source && <span>Source: {item.source}</span>}
          </div>
        </div>
      </div>

      {/* Actions footer */}
      <div className="flex gap-2 border-t p-3">
        <button
          onClick={() => launch.mutate(item.slug)}
          className="flex flex-1 items-center justify-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Play size={12} weight="fill" />
          Launch
        </button>
        <button
          onClick={() => startRalph.mutate({ slug: item.slug })}
          className="flex flex-1 items-center justify-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
        >
          <ArrowsClockwise size={12} />
          Ralph
        </button>
        <button
          onClick={() => { archive.mutate(item.slug); handleClose() }}
          className="flex items-center justify-center gap-1 rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:border-destructive hover:text-destructive"
        >
          <Archive size={12} />
        </button>
      </div>
    </div>
  )
}
