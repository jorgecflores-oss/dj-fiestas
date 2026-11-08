import { useEffect, useRef, useState } from 'react'
import { registrar } from './registro.ts'

interface NodosSirena {
  osc: OscillatorNode
  lfo: OscillatorNode
  ganancia: GainNode
}

// Botón de sirena: suena mientras se mantiene apretado.
export default function Sirena() {
  const [activa, setActiva] = useState(false)
  const audioCtx = useRef<AudioContext | null>(null)
  const sirena = useRef<NodosSirena | null>(null)

  const iniciar = () => {
    if (sirena.current) return
    if (!audioCtx.current) audioCtx.current = new AudioContext()
    const ctx = audioCtx.current
    void ctx.resume()
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = 900
    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = 2
    const profundidad = ctx.createGain()
    profundidad.gain.value = 450
    lfo.connect(profundidad)
    profundidad.connect(osc.frequency)
    const ganancia = ctx.createGain()
    const ahora = ctx.currentTime
    ganancia.gain.setValueAtTime(0, ahora)
    ganancia.gain.linearRampToValueAtTime(0.25, ahora + 0.03)
    osc.connect(ganancia)
    ganancia.connect(ctx.destination)
    osc.start()
    lfo.start()
    sirena.current = { osc, lfo, ganancia }
    setActiva(true)
    registrar('Sirena: inicio')
  }

  const parar = () => {
    const s = sirena.current
    const ctx = audioCtx.current
    if (!s || !ctx) return
    sirena.current = null
    const ahora = ctx.currentTime
    s.ganancia.gain.cancelScheduledValues(ahora)
    s.ganancia.gain.setValueAtTime(s.ganancia.gain.value, ahora)
    s.ganancia.gain.linearRampToValueAtTime(0, ahora + 0.03)
    s.osc.stop(ahora + 0.05)
    s.lfo.stop(ahora + 0.05)
    setActiva(false)
    registrar('Sirena: fin')
  }

  useEffect(() => {
    return () => {
      const s = sirena.current
      sirena.current = null
      if (s) {
        s.osc.stop()
        s.lfo.stop()
      }
      void audioCtx.current?.close()
      audioCtx.current = null
    }
  }, [])

  return (
    <button
      onPointerDown={iniciar}
      onPointerUp={parar}
      onPointerLeave={parar}
      onPointerCancel={parar}
      onContextMenu={(e) => e.preventDefault()}
      className={`w-full min-h-20 rounded-xl text-2xl font-bold select-none touch-none ${
        activa ? 'bg-red-500' : 'bg-red-700'
      }`}
    >
      SIRENA
    </button>
  )
}
