import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { AgentViewSession } from '@/types'

export function useAgentViewSessions() {
  return useQuery<AgentViewSession[]>({
    queryKey: ['agent-view-sessions'],
    queryFn: api.getAgentViewSessions,
    refetchInterval: 10_000,
  })
}
