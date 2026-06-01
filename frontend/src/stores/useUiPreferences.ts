import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Priority, ViewMode } from '@/types'

export interface FilterState {
  searchQuery: string
  priorities: Priority[]
  tags: string[]
  efforts: string[]
  sources: string[]
  hideStale: boolean
}

interface SidebarSections {
  sessions: boolean
  agentView: boolean
  github: boolean
  library: boolean
}

interface UiPreferencesState {
  darkMode: boolean
  viewMode: ViewMode
  sortField: 'sort_order' | 'updated' | 'started' | 'priority' | 'task'
  sortDirection: 'asc' | 'desc'
  filters: FilterState
  sidebarCollapsed: boolean
  sidebarSections: SidebarSections
  focusedSlug: string | null
  selectedSlugs: Set<string>

  toggleDarkMode: () => void
  setViewMode: (mode: ViewMode) => void
  setSortField: (field: UiPreferencesState['sortField']) => void
  setSortDirection: (dir: 'asc' | 'desc') => void
  setFilters: (filters: Partial<FilterState>) => void
  clearFilters: () => void
  toggleSidebar: () => void
  toggleSidebarSection: (section: keyof SidebarSections) => void
  setFocusedSlug: (slug: string | null) => void
  toggleSelection: (slug: string) => void
  selectRange: (slugs: string[]) => void
  clearSelection: () => void
}

const defaultFilters: FilterState = {
  searchQuery: '',
  priorities: [],
  tags: [],
  efforts: [],
  sources: [],
  hideStale: false,
}

export const useUiPreferences = create<UiPreferencesState>()(
  persist(
    (set) => ({
      darkMode: window.matchMedia('(prefers-color-scheme: dark)').matches,
      viewMode: 'kanban',
      sortField: 'sort_order',
      sortDirection: 'asc',
      filters: defaultFilters,
      sidebarCollapsed: false,
      sidebarSections: { sessions: false, agentView: false, github: false, library: false },
      focusedSlug: null,
      selectedSlugs: new Set(),

      toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
      setViewMode: (viewMode) => set({ viewMode }),
      setSortField: (sortField) => set({ sortField }),
      setSortDirection: (sortDirection) => set({ sortDirection }),
      setFilters: (partial) =>
        set((s) => ({ filters: { ...s.filters, ...partial } })),
      clearFilters: () => set({ filters: defaultFilters }),
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleSidebarSection: (section) =>
        set((s) => ({
          sidebarSections: { ...s.sidebarSections, [section]: !s.sidebarSections[section] },
        })),
      setFocusedSlug: (focusedSlug) => set({ focusedSlug }),
      toggleSelection: (slug) =>
        set((s) => {
          const next = new Set(s.selectedSlugs)
          if (next.has(slug)) next.delete(slug)
          else next.add(slug)
          return { selectedSlugs: next }
        }),
      selectRange: (slugs) => set({ selectedSlugs: new Set(slugs) }),
      clearSelection: () => set({ selectedSlugs: new Set() }),
    }),
    {
      name: 'pai-board-preferences',
      partialize: (state) => ({
        darkMode: state.darkMode,
        viewMode: state.viewMode,
        sortField: state.sortField,
        sortDirection: state.sortDirection,
        filters: state.filters,
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarSections: state.sidebarSections,
      }),
    },
  ),
)
