import { useHotkeys } from 'react-hotkeys-hook'
import { useWorkItems } from '@/hooks/useWorkItems'
import { useKanbanFilters } from '@/hooks/useKanbanFilters'
import { useMutations } from '@/hooks/useMutations'
import { useUiPreferences } from '@/stores/useUiPreferences'
import { PHASES, type Phase } from '@/types'

export function useKeyboardShortcuts() {
  const { data } = useWorkItems()
  const { focusedSlug, setFocusedSlug, filters, setFilters, sortField, sortDirection, toggleSelection } = useUiPreferences()
  const { updatePhase, archive, launch, startRalph } = useMutations()

  const items = data?.items ?? []

  const orderedItems = useKanbanFilters({ items, filters, sortField, sortDirection })
  const currentIndex = orderedItems.findIndex((i) => i.slug === focusedSlug)

  // j — next item
  useHotkeys('j', () => {
    if (orderedItems.length === 0) return
    const next = currentIndex < orderedItems.length - 1 ? currentIndex + 1 : 0
    setFocusedSlug(orderedItems[next]?.slug ?? null)
  }, { scopes: ['kanban'] })

  // k — previous item
  useHotkeys('k', () => {
    if (orderedItems.length === 0) return
    const prev = currentIndex > 0 ? currentIndex - 1 : orderedItems.length - 1
    setFocusedSlug(orderedItems[prev]?.slug ?? null)
  }, { scopes: ['kanban'] })

  // x — toggle selection on focused item
  useHotkeys('x', () => {
    if (focusedSlug) toggleSelection(focusedSlug)
  }, { scopes: ['kanban'] })

  // shift+j — select and move down
  useHotkeys('shift+j', () => {
    if (orderedItems.length === 0) return
    if (focusedSlug) toggleSelection(focusedSlug)
    const next = currentIndex < orderedItems.length - 1 ? currentIndex + 1 : 0
    setFocusedSlug(orderedItems[next]?.slug ?? null)
  }, { scopes: ['kanban'] })

  // shift+k — select and move up
  useHotkeys('shift+k', () => {
    if (orderedItems.length === 0) return
    if (focusedSlug) toggleSelection(focusedSlug)
    const prev = currentIndex > 0 ? currentIndex - 1 : orderedItems.length - 1
    setFocusedSlug(orderedItems[prev]?.slug ?? null)
  }, { scopes: ['kanban'] })

  // p — cycle phase forward
  useHotkeys('p', () => {
    if (!focusedSlug) return
    const item = items.find((i) => i.slug === focusedSlug)
    if (!item) return
    const idx = PHASES.indexOf(item.phase as Phase)
    const nextPhase = PHASES[(idx + 1) % PHASES.length]
    if (nextPhase) updatePhase.mutate({ slug: focusedSlug, phase: nextPhase })
  }, { scopes: ['kanban'] })

  // shift+p — cycle phase backward
  useHotkeys('shift+p', () => {
    if (!focusedSlug) return
    const item = items.find((i) => i.slug === focusedSlug)
    if (!item) return
    const idx = PHASES.indexOf(item.phase as Phase)
    const prevPhase = PHASES[(idx - 1 + PHASES.length) % PHASES.length]
    if (prevPhase) updatePhase.mutate({ slug: focusedSlug, phase: prevPhase })
  }, { scopes: ['kanban'] })

  // d — archive
  useHotkeys('d', () => {
    if (focusedSlug) archive.mutate(focusedSlug)
  }, { scopes: ['kanban'] })

  // Enter — launch session
  useHotkeys('enter', () => {
    if (focusedSlug) launch.mutate(focusedSlug)
  }, { scopes: ['kanban'] })

  // r — start ralph
  useHotkeys('r', () => {
    if (focusedSlug) startRalph.mutate({ slug: focusedSlug })
  }, { scopes: ['kanban'] })

  // / — focus search
  useHotkeys('/', (e) => {
    e.preventDefault()
    const input = document.querySelector<HTMLInputElement>('input[placeholder*="Search"]')
    input?.focus()
  }, { scopes: ['kanban'] })

  // Escape — clear focus and search
  useHotkeys('escape', () => {
    setFocusedSlug(null)
    setFilters({ searchQuery: '' })
    useUiPreferences.getState().clearSelection()
    const input = document.querySelector<HTMLInputElement>('input[placeholder*="Search"]')
    input?.blur()
  }, { scopes: ['global'] })
}
