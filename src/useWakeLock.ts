import { useEffect, useRef, useState } from 'react'
import { registrar } from './registro.ts'

// Mantiene la pantalla encendida mientras `quiere` sea true. Se vuelve a pedir
// cuando la pestaña vuelve a ser visible (el sistema lo suelta al ocultarla).
export function useWakeLock(quiere: boolean) {
  const soportado = 'wakeLock' in navigator
  const [concedido, setConcedido] = useState(false)
  const sentinel = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (!quiere) return
    if (!soportado) {
      registrar('Wake lock: no soportado')
      return
    }
    let activo = true

    const pedir = async () => {
      if (sentinel.current && !sentinel.current.released) return
      try {
        const s = await navigator.wakeLock.request('screen')
        if (!activo) {
          void s.release()
          return
        }
        sentinel.current = s
        s.addEventListener('release', () => {
          registrar('Wake lock liberado')
          setConcedido(false)
        })
        setConcedido(true)
        registrar('Wake lock concedido')
      } catch (err) {
        registrar(`Wake lock falló: ${String(err)}`)
      }
    }

    const alVolver = () => {
      if (document.visibilityState === 'visible') void pedir()
    }

    void pedir()
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      activo = false
      document.removeEventListener('visibilitychange', alVolver)
      const s = sentinel.current
      sentinel.current = null
      if (s) void s.release()
    }
  }, [quiere, soportado])

  return { soportado, concedido }
}
