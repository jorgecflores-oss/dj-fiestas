import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { borrar, obtenerLineas, registrar, suscribir, textoCompleto } from './registro.ts'
import { cargarApiYouTube, extraerIdVideo, nombreEstado } from './youtube.ts'
import type { Reproductor } from './youtube.ts'

type IdDeck = 'A' | 'B'

// Lo que cada deck le expone al mezclador.
interface ControlDeck {
  reproduciendo(): boolean
  reproducir(): void
  pausar(): void
  resumen(): string
}

function formatoTiempo(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

const claseBoton =
  'min-h-11 px-4 rounded-lg bg-neutral-800 active:bg-neutral-700 text-white font-medium select-none'

interface PropsDeck {
  id: IdDeck
  volumenDeck: number
  volumenReal: number
  onVolumen: (v: number) => void
  registrarControl: (id: IdDeck, c: ControlDeck | null) => void
}

function Deck({ id, volumenDeck, volumenReal, onVolumen, registrarControl }: PropsDeck) {
  const contenedor = useRef<HTMLDivElement>(null)
  const reproductor = useRef<Reproductor | null>(null)
  const pendiente = useRef<string | null>(null)
  const [listo, setListo] = useState(false)
  const [texto, setTexto] = useState('')
  const [error, setError] = useState('')
  const [estado, setEstado] = useState(-1)
  const [velocidad, setVelocidad] = useState(1)
  const [tiempo, setTiempo] = useState({ actual: 0, total: 0 })

  // Aplica el volumen real (deck x crossfader) cada vez que cambia.
  useEffect(() => {
    if (listo) reproductor.current?.setVolume(Math.round(volumenReal))
  }, [volumenReal, listo])

  useEffect(() => {
    let cancelado = false
    // YouTube reemplaza este div por el iframe; así React no pierde su propio nodo.
    const el = document.createElement('div')
    contenedor.current?.appendChild(el)

    void cargarApiYouTube().then(() => {
      if (cancelado || !window.YT) return
      reproductor.current = new window.YT.Player(el, {
        playerVars: { playsinline: 1, rel: 0, origin: window.location.origin },
        events: {
          onReady: () => {
            if (cancelado) return
            registrar(`Deck ${id}: onReady`)
            setListo(true)
            if (pendiente.current) {
              reproductor.current?.cueVideoById(pendiente.current)
              pendiente.current = null
            }
          },
          onStateChange: (e) => {
            registrar(`Deck ${id}: estado ${e.data} (${nombreEstado(e.data)})`)
            setEstado(e.data)
          },
          onError: (e) => registrar(`Deck ${id}: ERROR código ${e.data}`),
          onPlaybackRateChange: (e) => {
            registrar(`Deck ${id}: velocidad ${e.data}x`)
            setVelocidad(e.data)
          },
        },
      })
    })

    registrarControl(id, {
      reproduciendo: () => reproductor.current?.getPlayerState() === 1,
      reproducir: () => reproductor.current?.playVideo(),
      pausar: () => reproductor.current?.pauseVideo(),
      resumen: () => {
        const p = reproductor.current
        if (!p) return `Deck ${id}: sin reproductor`
        return `Deck ${id}: ${nombreEstado(p.getPlayerState())}, ${formatoTiempo(p.getCurrentTime())}/${formatoTiempo(p.getDuration())}, vol real ${p.getVolume()}, ${p.getPlaybackRate()}x, ${document.visibilityState}`
      },
    })

    const sondeo = window.setInterval(() => {
      const p = reproductor.current
      if (!p) return
      setTiempo({ actual: p.getCurrentTime(), total: p.getDuration() })
    }, 500)

    return () => {
      cancelado = true
      window.clearInterval(sondeo)
      registrarControl(id, null)
      reproductor.current?.destroy()
      reproductor.current = null
      el.remove()
      setListo(false)
    }
  }, [id, registrarControl])

  const cargar = () => {
    const idVideo = extraerIdVideo(texto)
    if (!idVideo) {
      setError('Link o ID de YouTube inválido')
      registrar(`Deck ${id}: link inválido "${texto}"`)
      return
    }
    setError('')
    registrar(`Deck ${id}: cargando ${idVideo}`)
    if (reproductor.current && listo) reproductor.current.cueVideoById(idVideo)
    else pendiente.current = idVideo
  }

  const alternar = () => {
    const p = reproductor.current
    if (!p) return
    if (p.getPlayerState() === 1) p.pauseVideo()
    else p.playVideo()
  }

  const cambiarVelocidad = (paso: number) => {
    const p = reproductor.current
    if (!p) return
    const tasas = p.getAvailablePlaybackRates()
    if (tasas.length === 0) return
    let i = tasas.indexOf(p.getPlaybackRate())
    if (i < 0) i = Math.max(0, tasas.indexOf(1))
    p.setPlaybackRate(tasas[Math.min(tasas.length - 1, Math.max(0, i + paso))])
  }

  return (
    <section className="rounded-xl bg-neutral-900 p-3 flex flex-col gap-3">
      <h2 className="text-lg font-bold text-violet-400">Deck {id}</h2>
      <div className="flex gap-2">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Link o ID de YouTube"
          className="min-h-11 flex-1 min-w-0 rounded-lg bg-neutral-800 px-3 text-white"
        />
        <button className={`${claseBoton} bg-violet-600 active:bg-violet-500`} onClick={cargar}>
          Cargar
        </button>
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <div
        ref={contenedor}
        className="w-full aspect-video min-h-[200px] bg-black [&_iframe]:w-full [&_iframe]:h-full"
      />
      <div className="flex flex-wrap gap-2">
        <button className={claseBoton} onClick={alternar}>
          {estado === 1 ? 'Pausa' : 'Play'}
        </button>
        <button className={claseBoton} onClick={() => cambiarVelocidad(-1)}>
          -
        </button>
        <button className={claseBoton} onClick={() => cambiarVelocidad(1)}>
          +
        </button>
        <button className={claseBoton} onClick={() => reproductor.current?.setPlaybackRate(1)}>
          1x
        </button>
        <button className={claseBoton} onClick={() => registrar(`ANUNCIO visto en deck ${id}`)}>
          Anuncio
        </button>
      </div>
      <label className="flex items-center gap-3 text-sm text-neutral-300">
        Volumen
        <input
          type="range"
          min={0}
          max={100}
          value={volumenDeck}
          onChange={(e) => onVolumen(Number(e.target.value))}
          className="flex-1 h-11"
        />
        <span className="w-8 text-right">{volumenDeck}</span>
      </label>
      <p className="text-sm text-neutral-400">
        {nombreEstado(estado)} · {velocidad}x · {formatoTiempo(tiempo.actual)} /{' '}
        {formatoTiempo(tiempo.total)} · vol real {Math.round(volumenReal)}
      </p>
    </section>
  )
}

interface NodosSirena {
  osc: OscillatorNode
  lfo: OscillatorNode
  ganancia: GainNode
}

function copiaAlternativa(texto: string): Promise<void> {
  const area = document.createElement('textarea')
  area.value = texto
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand('copy')
  area.remove()
  return ok ? Promise.resolve() : Promise.reject(new Error('execCommand falló'))
}

function copiarTexto(texto: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(texto).catch(() => copiaAlternativa(texto))
  }
  return copiaAlternativa(texto)
}

export default function Prueba() {
  const lineas = useSyncExternalStore(suscribir, obtenerLineas)
  const [brave, setBrave] = useState(() =>
    (navigator as Navigator & { brave?: unknown }).brave
      ? 'Verificando Brave...'
      : 'Brave NO detectado',
  )
  const [visibilidad, setVisibilidad] = useState<string>(document.visibilityState)
  const [volA, setVolA] = useState(100)
  const [volB, setVolB] = useState(100)
  const [cruce, setCruce] = useState(0)
  const [duracion, setDuracion] = useState(8)
  const [mezclando, setMezclando] = useState(false)
  const [wakeLockActivo, setWakeLockActivo] = useState(false)
  const [wakeLockSoportado] = useState(() => 'wakeLock' in navigator)
  const [sirenaActiva, setSirenaActiva] = useState(false)
  const [copiado, setCopiado] = useState(false)

  const controles = useRef<Record<IdDeck, ControlDeck | null>>({ A: null, B: null })
  const animacion = useRef<number | null>(null)
  const audioCtx = useRef<AudioContext | null>(null)
  const sirena = useRef<NodosSirena | null>(null)
  const sentinel = useRef<WakeLockSentinel | null>(null)
  const wakeLockQuerido = useRef(false)

  const registrarControl = useCallback((id: IdDeck, c: ControlDeck | null) => {
    controles.current[id] = c
  }, [])

  // Curva de potencia constante.
  const x = cruce / 100
  const volRealA = Math.round(volA * Math.cos((x * Math.PI) / 2))
  const volRealB = Math.round(volB * Math.sin((x * Math.PI) / 2))

  // Datos iniciales de diagnóstico.
  useEffect(() => {
    registrar(`User agent: ${navigator.userAgent}`)
    registrar(`Soporte wakeLock: ${'wakeLock' in navigator ? 'SI' : 'NO'}`)
    registrar(`devicePixelRatio: ${window.devicePixelRatio}`)
    const nav = navigator as Navigator & { brave?: { isBrave: () => Promise<boolean> } }
    if (nav.brave?.isBrave) {
      nav.brave.isBrave().then(
        (es) => {
          setBrave(es ? 'Brave detectado' : 'Brave NO detectado')
          registrar(`Brave: ${es ? 'detectado' : 'NO detectado'}`)
        },
        () => {
          setBrave('Brave NO detectado')
          registrar('Brave: error al consultar isBrave()')
        },
      )
    } else {
      registrar('Brave: NO detectado (no existe navigator.brave)')
    }
  }, [])

  const pedirWakeLock = useCallback(async () => {
    if (!('wakeLock' in navigator)) {
      registrar('Wake lock: no soportado')
      return
    }
    try {
      const s = await navigator.wakeLock.request('screen')
      sentinel.current = s
      s.addEventListener('release', () => registrar('Wake lock liberado'))
      registrar('Wake lock concedido')
    } catch (err) {
      registrar(`Wake lock falló: ${String(err)}`)
    }
  }, [])

  // Eventos de ciclo de vida de la página.
  useEffect(() => {
    const onVisibilidad = () => {
      setVisibilidad(document.visibilityState)
      registrar(`visibilitychange: ${document.visibilityState}`)
      if (document.visibilityState === 'visible' && wakeLockQuerido.current) {
        void pedirWakeLock()
      }
    }
    const onPageHide = () => registrar('pagehide')
    const onPageShow = () => registrar('pageshow')
    document.addEventListener('visibilitychange', onVisibilidad)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilidad)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [pedirWakeLock])

  // Latido cada 5 s mientras algún deck esté reproduciendo.
  useEffect(() => {
    const t = window.setInterval(() => {
      const { A, B } = controles.current
      if (!A?.reproduciendo() && !B?.reproduciendo()) return
      if (A) registrar(`Latido ${A.resumen()}`)
      if (B) registrar(`Latido ${B.resumen()}`)
    }, 5000)
    return () => window.clearInterval(t)
  }, [])

  const cancelarAnimacion = useCallback(() => {
    if (animacion.current !== null) {
      window.clearInterval(animacion.current)
      animacion.current = null
      setMezclando(false)
    }
  }, [])

  const moverCruce = (v: number) => {
    if (animacion.current !== null) registrar('Crossfade cancelado a mano')
    cancelarAnimacion()
    setCruce(v)
  }

  const mezclar = (hacia: IdDeck) => {
    cancelarAnimacion()
    const saliente: IdDeck = hacia === 'A' ? 'B' : 'A'
    const destino = controles.current[hacia]
    if (destino && !destino.reproduciendo()) destino.reproducir()
    const objetivo = hacia === 'B' ? 100 : 0
    const inicio = cruce
    const total = duracion * 1000
    const t0 = performance.now()
    registrar(`Crossfade ${saliente} -> ${hacia} (${duracion} s)`)
    setMezclando(true)
    animacion.current = window.setInterval(() => {
      const f = Math.min(1, (performance.now() - t0) / total)
      setCruce(inicio + (objetivo - inicio) * f)
      if (f >= 1) {
        cancelarAnimacion()
        controles.current[saliente]?.pausar()
        registrar(`Crossfade terminado, deck ${saliente} en pausa`)
      }
    }, 100)
  }

  const iniciarSirena = () => {
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
    setSirenaActiva(true)
    registrar('Sirena: inicio')
  }

  const pararSirena = useCallback(() => {
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
    setSirenaActiva(false)
    registrar('Sirena: fin')
  }, [])

  const alternarWakeLock = async () => {
    if (!wakeLockSoportado) {
      registrar('Wake lock: no soportado')
      return
    }
    if (wakeLockActivo) {
      wakeLockQuerido.current = false
      setWakeLockActivo(false)
      await sentinel.current?.release()
      sentinel.current = null
    } else {
      wakeLockQuerido.current = true
      setWakeLockActivo(true)
      await pedirWakeLock()
    }
  }

  // Limpieza general al desmontar.
  useEffect(() => {
    return () => {
      cancelarAnimacion()
      pararSirena()
      void audioCtx.current?.close()
      audioCtx.current = null
      wakeLockQuerido.current = false
      void sentinel.current?.release()
      sentinel.current = null
    }
  }, [cancelarAnimacion, pararSirena])

  const copiar = () => {
    copiarTexto(textoCompleto()).then(
      () => {
        setCopiado(true)
        window.setTimeout(() => setCopiado(false), 2000)
      },
      (err) => registrar(`No se pudo copiar el registro: ${String(err)}`),
    )
  }

  const ultimas = [...lineas].reverse().slice(0, 200)

  return (
    <main className="min-h-screen bg-neutral-950 text-white p-3 flex flex-col gap-4 max-w-xl mx-auto">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-violet-400">Prueba de concepto</h1>
        <p className="text-xs text-neutral-400 break-words">{navigator.userAgent.slice(0, 90)}</p>
        <p className="text-sm">
          {brave} · página: {visibilidad}
        </p>
      </header>

      <Deck
        id="A"
        volumenDeck={volA}
        volumenReal={volRealA}
        onVolumen={setVolA}
        registrarControl={registrarControl}
      />
      <Deck
        id="B"
        volumenDeck={volB}
        volumenReal={volRealB}
        onVolumen={setVolB}
        registrarControl={registrarControl}
      />

      <section className="rounded-xl bg-neutral-900 p-3 flex flex-col gap-3">
        <h2 className="text-lg font-bold text-violet-400">Mezclador</h2>
        <label className="flex items-center gap-3 text-sm text-neutral-300">
          A
          <input
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={cruce}
            onChange={(e) => moverCruce(Number(e.target.value))}
            className="flex-1 h-11"
          />
          B
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button className={claseBoton} onClick={() => mezclar('B')}>
            A -&gt; B
          </button>
          <button className={claseBoton} onClick={() => mezclar('A')}>
            B -&gt; A
          </button>
          <select
            value={duracion}
            onChange={(e) => setDuracion(Number(e.target.value))}
            className="min-h-11 rounded-lg bg-neutral-800 px-3"
          >
            <option value={4}>4 s</option>
            <option value={8}>8 s</option>
            <option value={12}>12 s</option>
          </select>
          {mezclando && <span className="text-sm text-violet-300">Mezclando...</span>}
        </div>
      </section>

      <button
        onPointerDown={iniciarSirena}
        onPointerUp={pararSirena}
        onPointerLeave={pararSirena}
        onPointerCancel={pararSirena}
        onContextMenu={(e) => e.preventDefault()}
        className={`min-h-20 rounded-xl text-2xl font-bold select-none touch-none ${
          sirenaActiva ? 'bg-red-500' : 'bg-red-700'
        }`}
      >
        SIRENA
      </button>

      <button className={claseBoton} onClick={() => void alternarWakeLock()}>
        Pantalla siempre encendida:{' '}
        {!wakeLockSoportado ? 'No soportado' : wakeLockActivo ? 'SI' : 'NO'}
      </button>

      <section className="rounded-xl bg-neutral-900 p-3 flex flex-col gap-2">
        <h2 className="text-lg font-bold text-violet-400">Registro</h2>
        <div className="flex gap-2">
          <button className={claseBoton} onClick={copiar}>
            {copiado ? 'Copiado' : 'Copiar registro'}
          </button>
          <button className={claseBoton} onClick={borrar}>
            Borrar
          </button>
        </div>
        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-tight text-neutral-300">
          {ultimas.join('\n')}
        </pre>
      </section>
    </main>
  )
}
