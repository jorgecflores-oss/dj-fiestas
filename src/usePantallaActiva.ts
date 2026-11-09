import { useEffect, useRef, useState } from 'react'
import { debeMantenerPantalla } from './utilidades.ts'

// Dice si hay que mantener la pantalla encendida: mientras suena algo y durante
// un rato de gracia después del último sonido.
export function usePantallaActiva(haySonido: boolean, graciaMs = 10 * 60 * 1000): boolean {
  const [activa, setActiva] = useState(haySonido)
  const [haySonidoPrevio, setHaySonidoPrevio] = useState(haySonido)
  const haySonidoRef = useRef(haySonido)
  const ultimoSonido = useRef(0)

  // Cuando empieza a sonar, el resultado es true de inmediato.
  if (haySonido !== haySonidoPrevio) {
    setHaySonidoPrevio(haySonido)
    if (haySonido) setActiva(true)
  }

  useEffect(() => {
    haySonidoRef.current = haySonido
    if (haySonido) ultimoSonido.current = Date.now()
  }, [haySonido])

  useEffect(() => {
    const t = window.setInterval(() => {
      if (haySonidoRef.current) ultimoSonido.current = Date.now()
      setActiva(
        debeMantenerPantalla(haySonidoRef.current, Date.now() - ultimoSonido.current, graciaMs),
      )
    }, 30000)
    return () => window.clearInterval(t)
  }, [graciaMs])

  return activa
}
