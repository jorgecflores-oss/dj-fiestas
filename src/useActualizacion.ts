import { useCallback } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

const CADA_MS = 30 * 60 * 1000

// Detecta versiones nuevas de la app. No recarga sola: eso lo decide App.tsx
// para no cortar la música.
export function useActualizacion() {
  const {
    needRefresh: [hayVersionNueva],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return
      // Busca una versión nueva cada 30 minutos y cada vez que la página vuelve a verse.
      window.setInterval(() => void reg.update(), CADA_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update()
      })
    },
  })

  const actualizar = useCallback(() => void updateServiceWorker(true), [updateServiceWorker])

  return { hayVersionNueva, actualizar }
}
