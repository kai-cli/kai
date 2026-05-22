import { GitPullRequest, GitBranch, ChatCircleDots } from '@phosphor-icons/react'
import { useGitHub } from '@/hooks/useGitHub'
import { useUiPreferences } from '@/stores/useUiPreferences'
import { CollapsibleSection } from '@/components/ui/CollapsibleSection'

export function GitHubPanel() {
  const { data: items } = useGitHub()
  const { sidebarSections, toggleSidebarSection } = useUiPreferences()

  if (!items || items.length === 0) return null

  return (
    <CollapsibleSection
      icon={<GitBranch size={14} weight="bold" />}
      label="GitHub"
      count={items.length}
      collapsed={sidebarSections.github}
      onToggle={() => toggleSidebarSection('github')}
    >
      <div className="px-1 pb-2">
        {items.map((item) => (
          <a
            key={`${item.repo}#${item.number}`}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent"
          >
            {item.type === 'pr' ? (
              <GitPullRequest
                size={13}
                weight="bold"
                className="mt-0.5 shrink-0 text-phase-done"
              />
            ) : item.state === 'commented' ? (
              <ChatCircleDots
                size={13}
                weight="bold"
                className="mt-0.5 shrink-0 text-phase-verify"
              />
            ) : (
              <GitBranch
                size={13}
                weight="bold"
                className="mt-0.5 shrink-0 text-phase-execute"
              />
            )}
            <div className="flex-1 overflow-hidden">
              <div className="truncate font-medium">{item.title}</div>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="truncate">{item.repo}</span>
                <span>#{item.number}</span>
              </div>
            </div>
            {item.labels.length > 0 && (
              <div className="flex shrink-0 gap-0.5">
                {item.labels.slice(0, 2).map((label) => (
                  <span
                    key={label}
                    className="rounded-full bg-accent px-1 py-0.5 text-[9px]"
                  >
                    {label}
                  </span>
                ))}
              </div>
            )}
          </a>
        ))}
      </div>
    </CollapsibleSection>
  )
}
