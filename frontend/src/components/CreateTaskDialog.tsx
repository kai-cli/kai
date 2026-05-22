import { useState, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from '@phosphor-icons/react'
import { useMutations } from '@/hooks/useMutations'
import type { Phase, Priority, Effort } from '@/types'
import { PHASES, PHASE_LABELS } from '@/types'

interface CreateTaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultPhase?: Phase
}

export function CreateTaskDialog({ open, onOpenChange, defaultPhase = 'backlog' }: CreateTaskDialogProps) {
  const { createTask } = useMutations()
  const [title, setTitle] = useState('')
  const [effort, setEffort] = useState<Effort>('standard')
  const [phase, setPhase] = useState<Phase>(defaultPhase)
  const [priority, setPriority] = useState<Priority | ''>('')
  const [mode, setMode] = useState('interactive')

  const reset = useCallback(() => {
    setTitle('')
    setEffort('standard')
    setPhase(defaultPhase)
    setPriority('')
    setMode('interactive')
  }, [defaultPhase])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    createTask.mutate(
      { title: title.trim(), effort, mode },
      {
        onSuccess: () => {
          reset()
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">Create Task</Dialog.Title>
            <Dialog.Close className="rounded-md p-1 hover:bg-accent">
              <X size={18} />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Task Name
              </label>
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs to be done?"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Phase
                </label>
                <select
                  value={phase}
                  onChange={(e) => setPhase(e.target.value as Phase)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
                >
                  {PHASES.map((p) => (
                    <option key={p} value={p}>{PHASE_LABELS[p]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Effort
                </label>
                <select
                  value={effort}
                  onChange={(e) => setEffort(e.target.value as Effort)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
                >
                  <option value="quick">Quick</option>
                  <option value="standard">Standard</option>
                  <option value="deep">Deep</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority | '')}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
                >
                  <option value="">None</option>
                  <option value="urgent">Urgent</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Mode
                </label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-ring focus:ring-2"
                >
                  <option value="interactive">Interactive</option>
                  <option value="autonomous">Autonomous</option>
                  <option value="manual">Manual</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!title.trim() || createTask.isPending}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {createTask.isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
