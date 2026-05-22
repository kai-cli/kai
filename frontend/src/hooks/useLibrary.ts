import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { LibraryItem } from '@/types'

export function useLibrary() {
  return useQuery<LibraryItem[]>({
    queryKey: ['library'],
    queryFn: api.getLibrary,
    refetchInterval: 60_000,
  })
}
