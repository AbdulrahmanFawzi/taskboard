import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { HubConnectionBuilder, LogLevel, type HubConnection } from '@microsoft/signalr'
import { useParams } from 'react-router-dom'
import { api, setConnectionId } from './api'
import { roleRank, type Role, type Task, type Workspace } from './types'

export const keys = {
  workspaces: ['workspaces'] as const,
  workspace: (id: string) => ['workspace', id] as const,
  tasks: (id: string) => ['tasks', id] as const,
  task: (id: string) => ['task', id] as const,
  dashboard: (id: string) => ['dashboard', id] as const,
  analytics: (id: string, range: number) => ['analytics', id, range] as const,
  invitations: (id: string) => ['invitations', id] as const,
}

export function useWorkspaceId() {
  const { workspaceId } = useParams()
  return workspaceId!
}

export function useWorkspace() {
  const id = useWorkspaceId()
  return useQuery({ queryKey: keys.workspace(id), queryFn: () => api.get<Workspace>(`/api/workspaces/${id}`) })
}

export function useTasks() {
  const id = useWorkspaceId()
  return useQuery({ queryKey: keys.tasks(id), queryFn: () => api.get<Task[]>(`/api/workspaces/${id}/tasks`) })
}

/** Members see only their own cards; the server enforces it, this only shapes the wording. */
export function useOwnCardsOnly() {
  const { data } = useWorkspace()
  return data?.myRole === 'Member'
}

export function useCan(min: Role) {
  const { data } = useWorkspace()
  return data ? roleRank[data.myRole] >= roleRank[min] : false
}

/** Writes the workspace accent into the root token; the whole UI picks it up from there. */
export function applyAccent(color: string) {
  document.documentElement.style.setProperty('--accent', color)
}

export type Theme = 'light' | 'dark'
export function getTheme(): Theme {
  try {
    const saved = localStorage.getItem('tb.theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* storage blocked */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t
  try { localStorage.setItem('tb.theme', t) } catch { /* storage blocked */ }
}

let connection: HubConnection | null = null
let starting: Promise<void> | null = null

function hub() {
  if (!connection) {
    connection = new HubConnectionBuilder()
      .withUrl('/hubs/board')
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build()
    connection.onreconnected(id => setConnectionId(id ?? null))
    connection.onclose(() => setConnectionId(null))
  }
  return connection
}

/**
 * Keeps this workspace live: when anyone changes something, the server pings the group and we
 * refetch the affected queries. Pings caused by this tab are skipped; its cache is already right.
 */
export function useRealtime(workspaceId: string) {
  const qc = useQueryClient()
  useEffect(() => {
    const conn = hub()
    let cancelled = false

    const onChanged = (e: { workspaceId: string; scope: string; taskId?: string; origin?: string }) => {
      if (e.workspaceId !== workspaceId) return
      if (e.origin && e.origin === conn.connectionId) return
      if (e.scope === 'tasks') {
        qc.invalidateQueries({ queryKey: keys.tasks(workspaceId) })
        if (e.taskId) qc.invalidateQueries({ queryKey: keys.task(e.taskId) })
      } else {
        qc.invalidateQueries({ queryKey: keys.workspace(workspaceId) })
      }
      qc.invalidateQueries({ queryKey: keys.dashboard(workspaceId) })
      qc.invalidateQueries({ queryKey: ['analytics', workspaceId] })
    }
    conn.on('changed', onChanged)

    const join = async () => {
      if (conn.state === 'Disconnected') {
        starting ??= conn.start().finally(() => { starting = null })
        await starting
      } else if (starting) await starting
      if (cancelled) return
      setConnectionId(conn.connectionId)
      await conn.invoke('Join', workspaceId)
    }
    join().catch(() => { /* realtime is a nicety; the app works without it */ })
    conn.onreconnected(() => { conn.invoke('Join', workspaceId).catch(() => {}) })

    return () => {
      cancelled = true
      conn.off('changed', onChanged)
      if (conn.state === 'Connected') conn.invoke('Leave', workspaceId).catch(() => {})
    }
  }, [workspaceId, qc])
}
