import { type ReactNode } from 'react'
import { CaretDown, CaretRight } from '@phosphor-icons/react'
import { cn } from '@/lib/cn'

interface CollapsibleSectionProps {
  icon: ReactNode
  label: string
  count?: number
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
  className?: string
}

export function CollapsibleSection({
  icon,
  label,
  count,
  collapsed,
  onToggle,
  children,
  className,
}: CollapsibleSectionProps) {
  return (
    <div className={cn('border-b', className)}>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 hover:bg-accent/50"
      >
        {collapsed ? <CaretRight size={10} /> : <CaretDown size={10} />}
        <span className="flex items-center gap-1.5">
          {icon}
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
        </span>
        {count !== undefined && (
          <span className="text-[10px] text-muted-foreground">({count})</span>
        )}
      </button>
      {!collapsed && children}
    </div>
  )
}
