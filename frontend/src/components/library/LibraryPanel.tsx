import { Folder, PushPin, Robot } from '@phosphor-icons/react'
import { useLibrary } from '@/hooks/useLibrary'
import { useUiPreferences } from '@/stores/useUiPreferences'
import { CollapsibleSection } from '@/components/ui/CollapsibleSection'

export function LibraryPanel() {
  const { data: items } = useLibrary()
  const { sidebarSections, toggleSidebarSection } = useUiPreferences()

  if (!items || items.length === 0) return null

  const pinned = items.filter((i) => i.pinned)
  const discovered = items.filter((i) => !i.pinned)

  return (
    <CollapsibleSection
      icon={<Folder size={14} weight="bold" />}
      label="Library"
      count={items.length}
      collapsed={sidebarSections.library}
      onToggle={() => toggleSidebarSection('library')}
    >
      <div className="px-1 pb-2">
        {pinned.map((item) => (
          <LibraryRow key={item.path} item={item} />
        ))}
        {discovered.length > 0 && pinned.length > 0 && (
          <div className="my-1 border-t" />
        )}
        {discovered.map((item) => (
          <LibraryRow key={item.path} item={item} />
        ))}
      </div>
    </CollapsibleSection>
  )
}

function LibraryRow({
  item,
}: {
  item: { name: string; path: string; description: string; tags: string[]; pinned?: boolean }
}) {
  const isPai = item.tags.includes('pai-project')

  return (
    <div className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent">
      <div className="mt-0.5 shrink-0">
        {item.pinned ? (
          <PushPin size={12} weight="fill" className="text-phase-execute" />
        ) : isPai ? (
          <Robot size={12} className="text-phase-plan" />
        ) : (
          <Folder size={12} className="text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="truncate font-medium">{item.name}</div>
        <div className="truncate text-[10px] text-muted-foreground">
          {item.description}
        </div>
      </div>
    </div>
  )
}
