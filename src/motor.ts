// Motor del DJ: dos decks de YouTube, precarga en silencio y crossfade.
import { useEffect, useRef, useState } from 'react'
import { guardarTexto, leerTexto } from './almacen.ts'
import { registrar } from './registro.ts'
import { cargarApiYouTube } from './youtube.ts'
import type { Reproductor } from './youtube.ts'
import {
  duracionCrossfade,
  formatoTiempo,
  gananciasPotenciaConstante,
  nombreEstado,
} from './utilidades.ts'

export type IdDeck = 'A' | 'B'

export type EstadoDeck =
  | 'libre'
  | 'precargando'
  | 'listo'
  | 'sonando'
  | 'pausado'
  | 'terminado'
  | 'error'

// idle: sin mezcla. arrancando: esperando que suene el entrante.
// anuncio: posible anuncio en el entrante. rampa: crossfade en curso.
export type FaseMezcla = 'idle' | 'arrancando' | 'anuncio' | 'rampa'

export interface DatosDeck {
  estado: EstadoDeck
  videoId: string | null
  titulo: string
  canal: string
  duracionEsperadaS: number | null
  entradaS: number
  mensaje: string
}

export interface Tema {
  videoId: string
  titulo: string
  canal: string
  duracionS: number | null
}

const VACIO: DatosDeck = {
  estado: 'libre',
  videoId: null,
  titulo: '',
  canal: '',
  duracionEsperadaS: null,
  entradaS: 0,
  mensaje: '',
}

const CLAVE_ENTRADAS = 'dj_entradas'
const TIMEOUT_PRECARGA_MS = 30000
const TIMEOUT_ARRANQUE_MS = 15000
const MAX_ANUNCIO_MS = 90000
const LIBERAR_ERROR_MS = 4000

const MENSAJES_ERROR: Record<number, string> = {
  2: 'Error del reproductor',
  5: 'Error del reproductor',
  100: 'Video no disponible',
  101: 'No permite reproducirse fuera de YouTube',
  150: 'No permite reproducirse fuera de YouTube',
}

// Reloj monotónico (aparte para no mezclarlo con el render).
function ahora(): number {
  return performance.now()
}

function otro(id: IdDeck): IdDeck {
  return id === 'A' ? 'B' : 'A'
}

function leerEntradas(): Record<string, number> {
  const crudo = leerTexto(CLAVE_ENTRADAS)
  if (!crudo) return {}
  try {
    const dato: unknown = JSON.parse(crudo)
    return dato && typeof dato === 'object' ? (dato as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function guardarEntrada(videoId: string, entradaS: number): void {
  const todas = leerEntradas()
  if (entradaS > 0) todas[videoId] = entradaS
  else delete todas[videoId]
  guardarTexto(CLAVE_ENTRADAS, JSON.stringify(todas))
}

interface Espera {
  id: IdDeck
  estado: number
  timer: number
  resolver: (ok: boolean) => void
}

export function useMotorDj(duracionConfigS: number) {
  const [decks, setDecks] = useState<Record<IdDeck, DatosDeck>>({ A: VACIO, B: VACIO })
  const [actual, setActualEstado] = useState<IdDeck | null>(null)
  const [fase, setFaseEstado] = useState<FaseMezcla>('idle')
  const [progresoMezcla, setProgresoMezcla] = useState(0)
  const [volumenMaster, setVolumenMasterEstado] = useState(100)
  const [tiempos, setTiempos] = useState<Record<IdDeck, { actual: number; total: number }>>({
    A: { actual: 0, total: 0 },
    B: { actual: 0, total: 0 },
  })
  const [aviso, setAviso] = useState('')

  // Espejos en refs: el código asíncrono siempre lee el valor más nuevo.
  const decksRef = useRef<Record<IdDeck, DatosDeck>>({ A: VACIO, B: VACIO })
  const actualRef = useRef<IdDeck | null>(null)
  const faseRef = useRef<FaseMezcla>('idle')
  const masterRef = useRef(100)
  const duracionConfigRef = useRef(duracionConfigS)
  const cancelarRef = useRef(false)

  const contA = useRef<HTMLDivElement>(null)
  const contB = useRef<HTMLDivElement>(null)
  const reproductores = useRef<Record<IdDeck, Reproductor | null>>({ A: null, B: null })
  const listos = useRef<Record<IdDeck, boolean>>({ A: false, B: false })
  // Cada operación larga sobre un deck guarda su "generación"; si cambia, se aborta.
  const generacion = useRef<Record<IdDeck, number>>({ A: 0, B: 0 })
  const esperas = useRef(new Set<Espera>())
  const intervalos = useRef(new Set<number>())
  const timeouts = useRef(new Set<number>())

  useEffect(() => {
    duracionConfigRef.current = duracionConfigS
  }, [duracionConfigS])

  function actualizarDeck(id: IdDeck, parche: Partial<DatosDeck>) {
    decksRef.current = { ...decksRef.current, [id]: { ...decksRef.current[id], ...parche } }
    setDecks(decksRef.current)
  }

  function estadoDe(id: IdDeck): EstadoDeck {
    return decksRef.current[id].estado
  }

  function setActual(id: IdDeck | null) {
    actualRef.current = id
    setActualEstado(id)
  }

  function setFase(f: FaseMezcla) {
    faseRef.current = f
    setFaseEstado(f)
  }

  function crearIntervalo(fn: () => void, ms: number): number {
    const t = window.setInterval(fn, ms)
    intervalos.current.add(t)
    return t
  }

  function borrarIntervalo(t: number) {
    window.clearInterval(t)
    intervalos.current.delete(t)
  }

  function crearTimeout(fn: () => void, ms: number): number {
    const t = window.setTimeout(() => {
      timeouts.current.delete(t)
      fn()
    }, ms)
    timeouts.current.add(t)
    return t
  }

  function esperarListo(id: IdDeck): Promise<boolean> {
    if (listos.current[id]) return Promise.resolve(true)
    return new Promise((resolve) => {
      let intentos = 0
      const t = crearIntervalo(() => {
        intentos += 1
        if (listos.current[id] || intentos > 300) {
          borrarIntervalo(t)
          resolve(listos.current[id])
        }
      }, 100)
    })
  }

  function esperarEstado(
    id: IdDeck,
    estado: number,
    ms: number,
    inmediato: boolean,
  ): Promise<boolean> {
    if (inmediato && reproductores.current[id]?.getPlayerState() === estado) {
      return Promise.resolve(true)
    }
    return new Promise((resolve) => {
      const espera: Espera = {
        id,
        estado,
        timer: 0,
        resolver: (ok) => {
          window.clearTimeout(espera.timer)
          esperas.current.delete(espera)
          resolve(ok)
        },
      }
      espera.timer = window.setTimeout(() => espera.resolver(false), ms)
      esperas.current.add(espera)
    })
  }

  function resolverEsperas(id: IdDeck, ok: boolean) {
    for (const e of [...esperas.current]) if (e.id === id) e.resolver(ok)
  }

  function liberar(id: IdDeck) {
    generacion.current[id] += 1
    resolverEsperas(id, false)
    const p = reproductores.current[id]
    try {
      p?.pauseVideo()
      p?.stopVideo()
    } catch {
      // El reproductor puede estar a medio destruir.
    }
    actualizarDeck(id, VACIO)
  }

  // ---- Eventos de YouTube ----

  function manejarEstado(id: IdDeck, n: number) {
    registrar(`Deck ${id}: estado ${n} (${nombreEstado(n)})`)
    for (const e of [...esperas.current]) if (e.id === id && e.estado === n) e.resolver(true)
    const est = decksRef.current[id].estado
    if (est === 'sonando' || est === 'pausado' || est === 'terminado') {
      if (n === 1) actualizarDeck(id, { estado: 'sonando' })
      else if (n === 2) actualizarDeck(id, { estado: 'pausado' })
      else if (n === 0) actualizarDeck(id, { estado: 'terminado' })
    }
  }

  // Aviso persistente (cuadro rojo de arriba) para un deck que no es el actual.
  function avisarFalloSiguiente(id: IdDeck, titulo: string, mensaje: string) {
    const tema = titulo ? ` "${titulo}"` : ''
    setAviso(`Deck ${id}${tema}: ${mensaje}. Elegí otro tema.`)
  }

  function manejarError(id: IdDeck, codigo: number) {
    const mensaje = MENSAJES_ERROR[codigo] ?? `Error del reproductor (${codigo})`
    registrar(`Deck ${id}: ERROR código ${codigo} (${mensaje})`)
    generacion.current[id] += 1
    resolverEsperas(id, false)
    actualizarDeck(id, { estado: 'error', mensaje })
    const eraActual = actualRef.current === id
    if (eraActual) {
      setActual(null)
      setAviso(`El tema actual falló: ${mensaje}`)
    } else {
      avisarFalloSiguiente(id, decksRef.current[id].titulo, mensaje)
    }
    crearTimeout(() => {
      if (decksRef.current[id].estado === 'error') liberar(id)
    }, LIBERAR_ERROR_MS)
    // Si el actual falló y el otro ya está listo, arranca solo.
    const sig = otro(id)
    if (eraActual && faseRef.current === 'idle' && decksRef.current[sig].estado === 'listo') {
      void iniciarPrimeroRef.current(sig, generacion.current[sig])
    }
  }

  const iniciarPrimeroRef = useRef<(id: IdDeck, miGen: number) => Promise<void>>(async () => {})
  const manejarEstadoRef = useRef(manejarEstado)
  const manejarErrorRef = useRef(manejarError)
  useEffect(() => {
    manejarEstadoRef.current = manejarEstado
    manejarErrorRef.current = manejarError
  })

  // ---- Creación de los reproductores ----

  useEffect(() => {
    let cancelado = false
    const elementos: HTMLDivElement[] = []
    const montajes: [IdDeck, HTMLDivElement | null][] = [
      ['A', contA.current],
      ['B', contB.current],
    ]
    const nodos = montajes.map(([id, cont]) => {
      // YouTube reemplaza este div por el iframe, así React no pierde su nodo.
      const el = document.createElement('div')
      cont?.appendChild(el)
      elementos.push(el)
      return [id, el] as const
    })

    void cargarApiYouTube().then(() => {
      if (cancelado || !window.YT) return
      for (const [id, el] of nodos) {
        reproductores.current[id] = new window.YT.Player(el, {
          playerVars: {
            playsinline: 1,
            rel: 0,
            controls: 1,
            fs: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (cancelado) return
              listos.current[id] = true
              registrar(`Deck ${id}: onReady`)
            },
            onStateChange: (e) => manejarEstadoRef.current(id, e.data),
            onError: (e) => manejarErrorRef.current(id, e.data),
          },
        })
      }
    })

    const reps = reproductores.current
    const listas = listos.current
    const esperasActuales = esperas.current
    const intervalosActuales = intervalos.current
    const timeoutsActuales = timeouts.current
    return () => {
      cancelado = true
      for (const e of [...esperasActuales]) e.resolver(false)
      intervalosActuales.forEach((t) => window.clearInterval(t))
      intervalosActuales.clear()
      timeoutsActuales.forEach((t) => window.clearTimeout(t))
      timeoutsActuales.clear()
      for (const id of ['A', 'B'] as const) {
        try {
          reps[id]?.destroy()
        } catch {
          // Ya estaba destruido.
        }
        reps[id] = null
        listas[id] = false
      }
      elementos.forEach((el) => el.remove())
    }
  }, [])

  // Tiempos para las barras de progreso.
  useEffect(() => {
    const t = window.setInterval(() => {
      const leer = (id: IdDeck) => {
        const p = reproductores.current[id]
        if (!p || !listos.current[id] || decksRef.current[id].estado === 'libre') {
          return { actual: 0, total: 0 }
        }
        return { actual: p.getCurrentTime(), total: p.getDuration() }
      }
      setTiempos({ A: leer('A'), B: leer('B') })
    }, 500)
    return () => window.clearInterval(t)
  }, [])

  // Latido de diagnóstico mientras algo suene.
  useEffect(() => {
    const t = window.setInterval(() => {
      if (decksRef.current.A.estado !== 'sonando' && decksRef.current.B.estado !== 'sonando') return
      for (const id of ['A', 'B'] as const) {
        const p = reproductores.current[id]
        if (!p || decksRef.current[id].estado === 'libre') continue
        registrar(
          `Latido deck ${id} [${decksRef.current[id].estado}]: ${nombreEstado(p.getPlayerState())}, ${formatoTiempo(p.getCurrentTime())}/${formatoTiempo(p.getDuration())}, vol real ${p.getVolume()}, ${document.visibilityState}`,
        )
      }
    }, 5000)
    return () => window.clearInterval(t)
  }, [])

  // Eventos de ciclo de vida de la página.
  useEffect(() => {
    const vis = () => registrar(`visibilitychange: ${document.visibilityState}`)
    const ocultar = () => registrar('pagehide')
    const mostrar = () => registrar('pageshow')
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('pagehide', ocultar)
    window.addEventListener('pageshow', mostrar)
    return () => {
      document.removeEventListener('visibilitychange', vis)
      window.removeEventListener('pagehide', ocultar)
      window.removeEventListener('pageshow', mostrar)
    }
  }, [])

  // ---- Operaciones ----

  async function precargar(id: IdDeck, tema: Tema) {
    generacion.current[id] += 1
    const miGen = generacion.current[id]
    resolverEsperas(id, false)
    const entradaS = leerEntradas()[tema.videoId] ?? 0
    actualizarDeck(id, {
      estado: 'precargando',
      videoId: tema.videoId,
      titulo: tema.titulo,
      canal: tema.canal,
      duracionEsperadaS: tema.duracionS,
      entradaS,
      mensaje: '',
    })
    if (!(await esperarListo(id)) || generacion.current[id] !== miGen) {
      if (generacion.current[id] === miGen) {
        actualizarDeck(id, { estado: 'error', mensaje: 'El reproductor no cargó' })
        avisarFalloSiguiente(id, tema.titulo, 'El reproductor no cargó')
        crearTimeout(() => liberar(id), LIBERAR_ERROR_MS)
      }
      return
    }
    const p = reproductores.current[id]
    if (!p) return
    const t0 = ahora()
    p.pauseVideo()
    p.mute()
    p.loadVideoById(tema.videoId, entradaS)
    const ok = await esperarEstado(id, 1, TIMEOUT_PRECARGA_MS, false)
    if (generacion.current[id] !== miGen) return
    if (!ok) {
      registrar(`Deck ${id}: precarga falló o venció (${Math.round(ahora() - t0)} ms)`)
      actualizarDeck(id, { estado: 'error', mensaje: 'No se pudo precargar el tema' })
      avisarFalloSiguiente(id, tema.titulo, 'No se pudo precargar el tema')
      crearTimeout(() => {
        if (decksRef.current[id].estado === 'error') liberar(id)
      }, LIBERAR_ERROR_MS)
      return
    }
    p.pauseVideo()
    p.seekTo(entradaS, true)
    const datos = p.getVideoData()
    registrar(
      `Deck ${id}: precarga lista en ${Math.round(ahora() - t0)} ms, video_id ${datos.video_id}, duración ${p.getDuration()} s, esperada ${tema.duracionS ?? 'desconocida'}`,
    )
    actualizarDeck(id, {
      estado: 'listo',
      titulo: tema.titulo || datos.title || tema.videoId,
      canal: tema.canal || datos.author || '',
    })
    if (!actualRef.current && faseRef.current === 'idle') {
      await iniciarPrimero(id, miGen)
    }
  }

  // Primer tema: arranca solo, sin silenciar, a volumen master.
  async function iniciarPrimero(id: IdDeck, miGen: number) {
    const p = reproductores.current[id]
    if (!p || generacion.current[id] !== miGen) return
    p.setVolume(masterRef.current)
    p.unMute()
    p.playVideo()
    const t0 = ahora()
    const ok = await esperarEstado(id, 1, TIMEOUT_ARRANQUE_MS, true)
    if (generacion.current[id] !== miGen) return
    registrar(`Deck ${id}: primer tema ${ok ? 'sonó' : 'NO arrancó'} en ${Math.round(ahora() - t0)} ms`)
    setActual(id)
    if (ok) {
      actualizarDeck(id, { estado: 'sonando' })
    } else {
      actualizarDeck(id, { estado: 'pausado', mensaje: 'No arrancó, tocá Play' })
    }
  }

  useEffect(() => {
    iniciarPrimeroRef.current = iniciarPrimero
  })

  function elegirTema(tema: Tema) {
    if (faseRef.current !== 'idle') return
    setAviso('')
    const act = actualRef.current
    const destino: IdDeck = act ? otro(act) : decksRef.current.A.estado === 'libre' ? 'A' : 'B'
    registrar(`Elegido para deck ${destino}: ${tema.videoId} "${tema.titulo}"`)
    void precargar(destino, tema)
  }

  function ajustarEntrada(id: IdDeck, deltaS: number) {
    const d = decksRef.current[id]
    if (d.estado !== 'listo' || !d.videoId) return
    const entradaS = deltaS === 0 ? 0 : Math.max(0, d.entradaS + deltaS)
    actualizarDeck(id, { entradaS })
    guardarEntrada(d.videoId, entradaS)
    reproductores.current[id]?.seekTo(entradaS, true)
    registrar(`Deck ${id}: entrada en ${entradaS} s`)
  }

  function descartar(id: IdDeck) {
    if (faseRef.current !== 'idle' || actualRef.current === id) return
    registrar(`Deck ${id}: descartado`)
    liberar(id)
  }

  function alternarPlayPausa() {
    const id = actualRef.current
    const p = id ? reproductores.current[id] : null
    if (!p) return
    if (p.getPlayerState() === 1) p.pauseVideo()
    else p.playVideo()
  }

  function setVolumenMaster(v: number) {
    masterRef.current = v
    setVolumenMasterEstado(v)
    const id = actualRef.current
    if (id && faseRef.current !== 'rampa') reproductores.current[id]?.setVolume(v)
  }

  function cancelarMezcla() {
    if (faseRef.current !== 'arrancando' && faseRef.current !== 'anuncio') return
    cancelarRef.current = true
    const act = actualRef.current
    if (act) resolverEsperas(otro(act), false)
  }

  function abortarEntrante(entrante: IdDeck, mensaje: string) {
    const p = reproductores.current[entrante]
    p?.pauseVideo()
    p?.seekTo(decksRef.current[entrante].entradaS, true)
    actualizarDeck(entrante, { estado: 'listo', mensaje })
    setFase('idle')
    setProgresoMezcla(0)
  }

  async function hacerCrossfade() {
    const saliente = actualRef.current
    if (!saliente || faseRef.current !== 'idle') return
    const entrante = otro(saliente)
    if (decksRef.current[entrante].estado !== 'listo') return
    const pS = reproductores.current[saliente]
    const pE = reproductores.current[entrante]
    if (!pS || !pE) return

    setAviso('')
    cancelarRef.current = false
    setFase('arrancando')
    const sonando = decksRef.current[saliente].estado === 'sonando'
    const restante = sonando ? Math.max(0, pS.getDuration() - pS.getCurrentTime()) : 0
    const dur = duracionCrossfade(duracionConfigRef.current, restante)
    registrar(
      `Crossfade ${saliente} -> ${entrante}: restante ${restante.toFixed(1)} s, duración ${dur} s${dur === 0 ? ' (corte directo)' : ''}`,
    )

    // 2. Arrancar el entrante en silencio y esperar que de verdad suene.
    const t0 = ahora()
    pE.setVolume(0)
    pE.unMute()
    pE.playVideo()
    const ok = await esperarEstado(entrante, 1, TIMEOUT_ARRANQUE_MS, true)
    if (estadoDe(entrante) === 'error') {
      setFase('idle')
      return
    }
    if (!ok || cancelarRef.current) {
      registrar(`Crossfade ${cancelarRef.current ? 'cancelado' : 'no arrancó'} tras ${Math.round(ahora() - t0)} ms`)
      abortarEntrante(entrante, cancelarRef.current ? '' : 'No arrancó, reintentá')
      return
    }
    registrar(`Entrante ${entrante} sonando tras ${Math.round(ahora() - t0)} ms`)

    // 3. Chequeo de anuncio (experimental): la duración vista no coincide con la esperada.
    const esperada = decksRef.current[entrante].duracionEsperadaS
    const hayAnuncio = () => esperada !== null && Math.abs(pE.getDuration() - esperada) > 3
    registrar(`Duración vista ${pE.getDuration()} s, esperada ${esperada ?? 'desconocida'}`)
    if (hayAnuncio()) {
      setFase('anuncio')
      registrar('Posible anuncio en el entrante, esperando que termine')
      const inicio = ahora()
      const sigue = await new Promise<boolean>((resolve) => {
        const t = crearIntervalo(() => {
          const fin = () => {
            borrarIntervalo(t)
            resolve(false)
          }
          if (cancelarRef.current || estadoDe(entrante) === 'error') return fin()
          if (ahora() - inicio > MAX_ANUNCIO_MS) return fin()
          if (!hayAnuncio() && pE.getPlayerState() === 1) {
            borrarIntervalo(t)
            resolve(true)
          }
        }, 500)
      })
      if (!sigue) {
        if (estadoDe(entrante) === 'error') {
          setFase('idle')
          return
        }
        registrar(`Crossfade ${cancelarRef.current ? 'cancelado' : 'abortado: el anuncio no terminó'}`)
        abortarEntrante(entrante, cancelarRef.current ? '' : 'El anuncio no terminó, reintentá')
        return
      }
      registrar(`Anuncio terminado, duración vista ${pE.getDuration()} s`)
    }

    // 4. Rampa.
    setFase('rampa')
    actualizarDeck(entrante, { estado: 'sonando', mensaje: '' })

    const terminar = () => {
      registrar(`Crossfade terminado: ${entrante} es el actual`)
      actualizarDeck(saliente, VACIO)
      generacion.current[saliente] += 1
      try {
        pS.pauseVideo()
        pS.stopVideo()
      } catch {
        // El saliente pudo haberse destruido.
      }
      pE.setVolume(masterRef.current)
      setActual(entrante)
      setFase('idle')
      setProgresoMezcla(0)
    }

    if (dur === 0) {
      pE.setVolume(masterRef.current)
      terminar()
      return
    }
    const tr = ahora()
    const t = crearIntervalo(() => {
      const x = (ahora() - tr) / (dur * 1000)
      const g = gananciasPotenciaConstante(x)
      pS.setVolume(Math.round(masterRef.current * g.salida))
      pE.setVolume(Math.round(masterRef.current * g.entrada))
      setProgresoMezcla(Math.min(1, x))
      if (x >= 1 || pS.getPlayerState() === 0) {
        borrarIntervalo(t)
        terminar()
      }
    }, 100)
  }

  return {
    decks,
    actual,
    fase,
    progresoMezcla,
    volumenMaster,
    tiempos,
    aviso,
    contenedores: { A: contA, B: contB },
    elegirTema,
    ajustarEntrada,
    descartar,
    alternarPlayPausa,
    setVolumenMaster,
    hacerCrossfade,
    cancelarMezcla,
  }
}
