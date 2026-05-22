import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { WorkResponse } from '@/types'

export function useWorkItems() {
  return useQuery<WorkResponse>({
    queryKey: ['work'],
    queryFn: api.getWork,
    refetchInterval: 60_000,
  })
}
