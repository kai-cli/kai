import type { WorkResponse, LibraryItem, GitHubItem, AgentViewSession } from '@/types'

const BASE = '/api'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`)
  }
  return res.json()
}

export const api = {
  getWork: () => request<WorkResponse>('/work'),
  getLibrary: () => request<LibraryItem[]>('/library'),
  getGitHub: () => request<GitHubItem[]>('/github'),
  getAgentViewSessions: () => request<AgentViewSession[]>('/sessions'),

  updatePhase: (slug: string, phase: string) =>
    request<{ ok: boolean }>(`/task/${encodeURIComponent(slug)}/phase`, {
      method: 'PATCH',
      body: JSON.stringify({ phase }),
    }),

  toggleCriterion: (slug: string, criterionId: string) =>
    request<{ ok: boolean }>(
      `/task/${encodeURIComponent(slug)}/criteria/${encodeURIComponent(criterionId)}`,
      { method: 'PATCH' },
    ),

  archive: (slug: string) =>
    request<{ ok: boolean }>(`/task/${encodeURIComponent(slug)}/archive`, {
      method: 'POST',
    }),

  unarchive: (slug: string) =>
    request<{ ok: boolean }>(`/task/${encodeURIComponent(slug)}/archive`, {
      method: 'DELETE',
    }),

  launch: (slug: string) =>
    request<{ ok: boolean }>(`/task/${encodeURIComponent(slug)}/launch`, {
      method: 'POST',
    }),

  startRalph: (slug: string, opts?: { budget?: number; model?: string }) =>
    request<{ ok: boolean }>(`/task/${encodeURIComponent(slug)}/ralph`, {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
    }),

  stopRalph: (slug: string) =>
    request<{ ok: boolean }>(`/task/${encodeURIComponent(slug)}/ralph`, {
      method: 'DELETE',
    }),

  reorder: (updates: { slug: string; phase: string; sort_order: number }[]) =>
    request<{ ok: boolean }>('/reorder', {
      method: 'POST',
      body: JSON.stringify({ updates }),
    }),

  updateMetadata: (
    slug: string,
    data: { priority?: string; tags?: string[] },
  ) =>
    request<{ ok: boolean }>(`/task/${encodeURIComponent(slug)}/metadata`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  createTask: (data: {
    title: string
    description?: string
    effort?: string
    mode?: string
  }) =>
    request<{ slug: string }>('/task', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}
