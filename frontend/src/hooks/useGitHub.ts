import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { GitHubItem } from '@/types'

export function useGitHub() {
  return useQuery<GitHubItem[]>({
    queryKey: ['github'],
    queryFn: api.getGitHub,
    refetchInterval: 5 * 60_000,
  })
}
