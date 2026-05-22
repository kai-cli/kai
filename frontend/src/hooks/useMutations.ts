import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'

export function useMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['work'] })

  const updatePhase = useMutation({
    mutationFn: ({ slug, phase }: { slug: string; phase: string }) =>
      api.updatePhase(slug, phase),
    onSuccess: invalidate,
  })

  const toggleCriterion = useMutation({
    mutationFn: ({
      slug,
      criterionId,
    }: {
      slug: string
      criterionId: string
    }) => api.toggleCriterion(slug, criterionId),
    onSuccess: invalidate,
  })

  const archive = useMutation({
    mutationFn: (slug: string) => api.archive(slug),
    onSuccess: invalidate,
  })

  const unarchive = useMutation({
    mutationFn: (slug: string) => api.unarchive(slug),
    onSuccess: invalidate,
  })

  const launch = useMutation({
    mutationFn: (slug: string) => api.launch(slug),
    onSuccess: invalidate,
  })

  const startRalph = useMutation({
    mutationFn: ({
      slug,
      budget,
      model,
    }: {
      slug: string
      budget?: number
      model?: string
    }) => api.startRalph(slug, { budget, model }),
    onSuccess: invalidate,
  })

  const stopRalph = useMutation({
    mutationFn: (slug: string) => api.stopRalph(slug),
    onSuccess: invalidate,
  })

  const reorder = useMutation({
    mutationFn: (
      updates: { slug: string; phase: string; sort_order: number }[],
    ) => api.reorder(updates),
    onSuccess: invalidate,
  })

  const updateMetadata = useMutation({
    mutationFn: ({
      slug,
      data,
    }: {
      slug: string
      data: { priority?: string; tags?: string[] }
    }) => api.updateMetadata(slug, data),
    onSuccess: invalidate,
  })

  const createTask = useMutation({
    mutationFn: (data: {
      title: string
      description?: string
      effort?: string
      mode?: string
    }) => api.createTask(data),
    onSuccess: invalidate,
  })

  return {
    updatePhase,
    toggleCriterion,
    archive,
    unarchive,
    launch,
    startRalph,
    stopRalph,
    reorder,
    updateMetadata,
    createTask,
  }
}
