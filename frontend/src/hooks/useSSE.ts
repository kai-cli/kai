import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export function useSSE() {
  const queryClient = useQueryClient()
  const retryDelay = useRef(1000)

  useEffect(() => {
    let es: EventSource | null = null
    let retryTimeout: ReturnType<typeof setTimeout>
    let unmounted = false

    function connect() {
      if (unmounted) return
      es = new EventSource('/api/events')

      es.onopen = () => {
        retryDelay.current = 1000
      }

      es.onmessage = (event) => {
        if (event.data === 'update') {
          queryClient.invalidateQueries({ queryKey: ['work'] })
          queryClient.invalidateQueries({ queryKey: ['github'] })
          queryClient.invalidateQueries({ queryKey: ['library'] })
          queryClient.invalidateQueries({ queryKey: ['agent-view-sessions'] })
        }
      }

      es.onerror = () => {
        es?.close()
        if (unmounted) return
        retryTimeout = setTimeout(connect, retryDelay.current)
        retryDelay.current = Math.min(retryDelay.current * 2, 30000)
      }
    }

    connect()

    return () => {
      unmounted = true
      es?.close()
      clearTimeout(retryTimeout)
    }
  }, [queryClient])
}
