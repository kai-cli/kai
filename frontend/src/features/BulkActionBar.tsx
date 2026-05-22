import { Archive, X } from '@phosphor-icons/react'
import { useUiPreferences } from '@/stores/useUiPreferences'
import { useMutations } from '@/hooks/useMutations'
import { PHASES, PHASE_LABELS } from '@/types'
import type { Phase } from '@/types'

export function BulkActionBar() {
  const { selectedSlugs, clearSelection } = useUiPreferences()
  const { updatePhase, archive } = useMutations()

  const count = selectedSlugs.size
  if (count === 0) return null

  const handleBulkPhase = (phase: Phase) => {
    for (const slug of selectedSlugs) {
      updatePhase.mutate({ slug, phase })
    }
    clearSelection()
  }

  const handleBulkArchive = () => {
    for (const slug of selectedSlugs) {
      archive.mutate(slug)
    }
    clearSelection()
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border bg-card px-4 py-2 shadow-xl">
      <span className="text-xs font-medium">{count} selected</span>

      <div className="h-4 w-px bg-border" />

      <div className="flex items-center gap-1">
        <span className="text-[10px] text-muted-foreground">Move to:</span>
        {PHASES.filter((p) => p !== 'complete').map((phase) => (
          <button
            key={phase}
            onClick={() => handleBulkPhase(phase)}
            className="rounded px-1.5 py-0.5 text-[11px] hover:bg-accent"
          >
            {PHASE_LABELS[phase]}
          </button>
        ))}
      </div>

      <div className="h-4 w-px bg-border" />

      <button
        onClick={handleBulkArchive}
        className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-destructive hover:bg-destructive/10"
      >
        <Archive size={12} />
        Archive
      </button>

      <button
        onClick={clearSelection}
        className="rounded p-1 text-muted-foreground hover:bg-accent"
      >
        <X size={12} />
      </button>
    </div>
  )
}
