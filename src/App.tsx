import { useState, useSyncExternalStore } from 'react'
import type { RefObject } from 'react'
import { guardarTexto, leerTexto } from './almacen.ts'
import { buscarVideos, detallesVideo, guardarClave, leerClave, mensajeError } from './busqueda.ts'
import type { ResultadoVideo } from './busqueda.ts'
import { useMotorDj } from './motor.ts'
import type { DatosDeck, EstadoDeck, IdDeck } from './motor.ts'
import { borrar, obtenerLineas, registrar, suscribir, textoCompleto } from './registro.ts'
import Sirena from './Sirena.tsx'
import { extraerIdVideo, formatoTiempo } from './utilidades.ts'
import { useWakeLock } from './useWakeLock.ts'

const CLAVE_SOLO_MUSICA = 'dj_solo_musica'
const CLAVE_CROSSFADE = 'dj_crossfade_s'
const CLAVE_WAKELOCK = 'dj_wakelock'

const claseBoton =
  'min-h-11 px-4 rounded-lg bg-neutral-800 active:bg-neutral-700 text-white font-medium select-none disabled:opacity-40'

const ETIQUETA_ESTADO: Record<EstadoDeck, string> = {
  libre: 'Libre',
  precargando: 'Cargando...',
  listo: 'LISTO',
  sonando: 'Sonando',
  pausado: 'En pausa',
  terminado: 'Terminado',
  error: 'Error',
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

interface PropsTarjeta {
  id: IdDeck
  datos: DatosDeck
  esActual: boolean
  tiempo: { actual: number; total: number }
  contenedor: RefObject<HTMLDivElement | null>
  orden: string
  onPlayPausa: () => void
  onEntrada: (delta: number) => void
  onDescartar: () => void
}

function TarjetaDeck({
  id,
  datos,
  esActual,
  tiempo,
  contenedor,
  orden,
  onPlayPausa,
  onEntrada,
  onDescartar,
}: PropsTarjeta) {
  const insignia = esActual ? 'SONANDO' : datos.estado === 'libre' ? 'LIBRE' : 'SIGUIENTE'
  const colorInsignia = esActual
    ? 'bg-green-600'
    : datos.estado === 'libre'
      ? 'bg-neutral-700'
      : 'bg-violet-600'
  const progreso = tiempo.total > 0 ? Math.min(100, (tiempo.actual / tiempo.total) * 100) : 0

  return (
    <section className={`${orden} rounded-xl bg-neutral-900 p-3 flex flex-col gap-2`}>
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-neutral-300">Deck {id}</h2>
        <span className={`${colorInsignia} rounded px-2 py-1 text-xs font-bold`}>{insignia}</span>
      </div>
      {/* Siempre visible y de 200 px de alto como mínimo: lo exige YouTube. */}
      <div
        ref={contenedor}
        className="w-full h-[200px] bg-black [&_iframe]:w-full [&_iframe]:h-full"
      />
      <div className="min-h-10">
        <p className="font-medium leading-tight truncate">{datos.titulo || 'Sin tema'}</p>
        <p className="text-sm text-neutral-400 truncate">{datos.canal}</p>
      </div>
      <p className="text-sm text-neutral-300">
        {ETIQUETA_ESTADO[datos.estado]}
        {datos.mensaje && <span className="text-amber-400"> · {datos.mensaje}</span>}
      </p>
      <div>
        <div className="h-2 rounded bg-neutral-800 overflow-hidden">
          <div className="h-full bg-violet-500" style={{ width: `${progreso}%` }} />
        </div>
        <p className="text-xs text-neutral-400 mt-1">
          {formatoTiempo(tiempo.actual)} / {formatoTiempo(tiempo.total)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {esActual && (
          <button className={claseBoton} onClick={onPlayPausa}>
            {datos.estado === 'sonando' ? 'Pausa' : 'Play'}
          </button>
        )}
        {!esActual && datos.estado === 'listo' && (
          <>
            <button className={claseBoton} onClick={() => onEntrada(-5)}>
              -5 s
            </button>
            <button className={claseBoton} onClick={() => onEntrada(5)}>
              +5 s
            </button>
            <button className={claseBoton} onClick={() => onEntrada(0)}>
              0
            </button>
            <span className="self-center text-sm text-neutral-400">Entra en {datos.entradaS} s</span>
          </>
        )}
        {!esActual && datos.estado !== 'libre' && (
          <button className={claseBoton} onClick={onDescartar}>
            Descartar
          </button>
        )}
        <button className={claseBoton} onClick={() => registrar(`ANUNCIO visto en deck ${id}`)}>
          Anuncio
        </button>
      </div>
    </section>
  )
}

export default function App() {
  const lineas = useSyncExternalStore(suscribir, obtenerLineas)

  const [duracionConfigS, setDuracionConfigS] = useState(() => {
    const n = Number(leerTexto(CLAVE_CROSSFADE))
    return n >= 2 && n <= 30 ? n : 12
  })
  const [soloMusica, setSoloMusica] = useState(() => leerTexto(CLAVE_SOLO_MUSICA) !== '0')
  const [wakeHab, setWakeHab] = useState(() => leerTexto(CLAVE_WAKELOCK) !== '0')

  const motor = useMotorDj(duracionConfigS)
  const wake = useWakeLock(wakeHab && motor.actual !== null)

  const [consulta, setConsulta] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [errorBusqueda, setErrorBusqueda] = useState('')
  const [resultados, setResultados] = useState<ResultadoVideo[]>([])
  const [colapsado, setColapsado] = useState(false)

  const [ajustesAbiertos, setAjustesAbiertos] = useState(false)
  const [diagAbierto, setDiagAbierto] = useState(false)
  const [claveInput, setClaveInput] = useState('')
  const [claveGuardada, setClaveGuardada] = useState(() => leerClave() !== '')
  const [copiado, setCopiado] = useState(false)

  const mezclaOcupada = motor.fase !== 'idle'

  const agregarPorLink = async (idVideo: string) => {
    setBuscando(true)
    setErrorBusqueda('')
    let tema = { videoId: idVideo, titulo: '', canal: '', duracionS: null as number | null }
    if (leerClave()) {
      const r = await detallesVideo(idVideo)
      if (r.ok) {
        tema = {
          videoId: idVideo,
          titulo: r.detalle.titulo,
          canal: r.detalle.canal,
          duracionS: r.detalle.duracionS || null,
        }
      } else {
        registrar(`Link ${idVideo}: sin detalles (${r.error.tipo}), se agrega igual`)
      }
    }
    setBuscando(false)
    motor.elegirTema(tema)
    setResultados([])
    setConsulta('')
  }

  const buscar = async () => {
    const q = consulta.trim()
    if (!q || buscando) return
    const idVideo = extraerIdVideo(q)
    if (idVideo) {
      await agregarPorLink(idVideo)
      return
    }
    setBuscando(true)
    setErrorBusqueda('')
    const r = await buscarVideos(q, { soloMusica })
    setBuscando(false)
    if (!r.ok) {
      setResultados([])
      setErrorBusqueda(mensajeError(r.error))
      return
    }
    setResultados(r.resultados)
    setColapsado(false)
    if (r.resultados.length === 0) setErrorBusqueda('No hay resultados que se puedan reproducir acá.')
  }

  const elegir = (r: ResultadoVideo) => {
    motor.elegirTema({
      videoId: r.videoId,
      titulo: r.titulo,
      canal: r.canal,
      duracionS: r.duracionS || null,
    })
    setColapsado(true)
  }

  const guardarClaveApi = () => {
    guardarClave(claveInput)
    setClaveInput('')
    setClaveGuardada(leerClave() !== '')
    registrar(`Clave de API ${leerClave() ? 'guardada' : 'borrada'}`)
  }

  const copiar = () => {
    copiarTexto(textoCompleto()).then(
      () => {
        setCopiado(true)
        window.setTimeout(() => setCopiado(false), 2000)
      },
      (err) => registrar(`No se pudo copiar el registro: ${String(err)}`),
    )
  }

  const { actual, decks } = motor
  const sig: IdDeck | null = actual ? (actual === 'A' ? 'B' : 'A') : null
  const puedeCrossfade = actual !== null && sig !== null && decks[sig].estado === 'listo' && !mezclaOcupada
  const ordenDe = (id: IdDeck) => {
    const esPrimero = actual ? actual === id : id === 'A'
    return esPrimero ? 'order-1' : 'order-3'
  }
  const terminoActual = actual !== null && sig !== null && decks[actual].estado === 'terminado' && decks[sig].estado === 'listo'
  const ultimas = [...lineas].reverse().slice(0, 200)

  return (
    <main className="min-h-screen bg-neutral-950 text-white p-3 flex flex-col gap-4 max-w-xl mx-auto">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-violet-400">DJ Fiestas</h1>
        <button className={claseBoton} onClick={() => setAjustesAbiertos((v) => !v)}>
          Ajustes
        </button>
      </header>

      {ajustesAbiertos && (
        <section className="rounded-xl bg-neutral-900 p-3 flex flex-col gap-3">
          <h2 className="font-bold text-violet-400">Ajustes</h2>
          <div className="flex flex-col gap-2">
            <label className="text-sm text-neutral-300" htmlFor="clave">
              Clave de la API de YouTube
            </label>
            <div className="flex gap-2">
              <input
                id="clave"
                type="password"
                value={claveInput}
                onChange={(e) => setClaveInput(e.target.value)}
                autoComplete="off"
                placeholder="Pegá la clave acá"
                className="min-h-11 flex-1 min-w-0 rounded-lg bg-neutral-800 px-3"
              />
              <button className={claseBoton} onClick={guardarClaveApi}>
                Guardar
              </button>
            </div>
            <p className="text-sm text-neutral-400">Clave guardada: {claveGuardada ? 'sí' : 'no'}</p>
          </div>
          <label className="flex items-center gap-3 text-sm text-neutral-300">
            Crossfade
            <input
              type="range"
              min={2}
              max={30}
              value={duracionConfigS}
              onChange={(e) => {
                const n = Number(e.target.value)
                setDuracionConfigS(n)
                guardarTexto(CLAVE_CROSSFADE, String(n))
              }}
              className="flex-1 h-11"
            />
            <span className="w-10 text-right">{duracionConfigS} s</span>
          </label>
          <label className="flex items-center justify-between gap-3 min-h-11 text-sm text-neutral-300">
            <span>
              Pantalla siempre encendida
              <span className="block text-xs text-neutral-500">
                {!wake.soportado ? 'No soportado' : wake.concedido ? 'Activa ahora' : 'Inactiva'}
              </span>
            </span>
            <input
              type="checkbox"
              checked={wakeHab}
              onChange={(e) => {
                setWakeHab(e.target.checked)
                guardarTexto(CLAVE_WAKELOCK, e.target.checked ? '1' : '0')
              }}
              className="size-6"
            />
          </label>
        </section>
      )}

      <section className="rounded-xl bg-neutral-900 p-3 flex flex-col gap-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void buscar()
          }}
        >
          <input
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="Buscá un tema o pegá un link"
            enterKeyHint="search"
            className="min-h-11 flex-1 min-w-0 rounded-lg bg-neutral-800 px-3"
          />
          <button
            type="submit"
            disabled={buscando}
            className={`${claseBoton} bg-violet-600 active:bg-violet-500`}
          >
            {buscando ? '...' : 'Buscar'}
          </button>
        </form>
        <label className="flex items-center justify-between min-h-11 text-sm text-neutral-300">
          Solo música
          <input
            type="checkbox"
            checked={soloMusica}
            onChange={(e) => {
              setSoloMusica(e.target.checked)
              guardarTexto(CLAVE_SOLO_MUSICA, e.target.checked ? '1' : '0')
            }}
            className="size-6"
          />
        </label>
        {errorBusqueda && <p className="text-amber-400 text-sm">{errorBusqueda}</p>}
        {resultados.length > 0 && colapsado && (
          <button className={claseBoton} onClick={() => setColapsado(false)}>
            Ver resultados ({resultados.length})
          </button>
        )}
        {resultados.length > 0 && !colapsado && (
          <ul className="flex flex-col gap-2">
            {resultados.map((r) => (
              <li key={r.videoId}>
                <button
                  disabled={mezclaOcupada}
                  onClick={() => elegir(r)}
                  className="w-full min-h-11 flex gap-3 items-center rounded-lg bg-neutral-800 active:bg-neutral-700 p-2 text-left disabled:opacity-40"
                >
                  {r.miniaturaUrl && (
                    <img src={r.miniaturaUrl} alt="" className="w-24 h-14 object-cover rounded shrink-0" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-medium leading-tight line-clamp-2">
                      {r.titulo}
                    </span>
                    <span className="block text-xs text-neutral-400 truncate">
                      {r.canal} · {formatoTiempo(r.duracionS)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {motor.aviso && (
        <p className="rounded-lg bg-red-900/60 p-3 text-sm">{motor.aviso}</p>
      )}
      {terminoActual && (
        <p className="rounded-lg bg-amber-900/60 p-3 text-sm">
          Terminó el tema. Tocá CROSSFADE para pasar al siguiente.
        </p>
      )}

      {/* Solo se reordena con CSS: mover los iframes en el DOM los recargaría. */}
      <div className="flex flex-col gap-4">
        {(['A', 'B'] as const).map((id) => (
          <TarjetaDeck
            key={id}
            id={id}
            datos={decks[id]}
            esActual={actual === id}
            tiempo={motor.tiempos[id]}
            contenedor={motor.contenedores[id]}
            orden={ordenDe(id)}
            onPlayPausa={motor.alternarPlayPausa}
            onEntrada={(d) => motor.ajustarEntrada(id, d)}
            onDescartar={() => motor.descartar(id)}
          />
        ))}
        <div className="order-2 flex flex-col gap-2">
          <button
            disabled={!puedeCrossfade}
            onClick={() => void motor.hacerCrossfade()}
            className="min-h-16 rounded-xl bg-violet-600 active:bg-violet-500 text-xl font-bold disabled:opacity-40"
          >
            CROSSFADE
          </button>
          {motor.fase === 'arrancando' && (
            <div className="flex items-center justify-between gap-2 text-sm text-neutral-300">
              <span>Arrancando el siguiente...</span>
              <button className={claseBoton} onClick={motor.cancelarMezcla}>
                Cancelar
              </button>
            </div>
          )}
          {motor.fase === 'anuncio' && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-900/60 p-3 text-sm">
              <span>Posible anuncio en el siguiente: saltalo en su reproductor</span>
              <button className={claseBoton} onClick={motor.cancelarMezcla}>
                Cancelar
              </button>
            </div>
          )}
          {motor.fase === 'rampa' && (
            <div className="h-3 rounded bg-neutral-800 overflow-hidden">
              <div
                className="h-full bg-violet-400"
                style={{ width: `${Math.round(motor.progresoMezcla * 100)}%` }}
              />
            </div>
          )}
        </div>
      </div>

      <label className="flex items-center gap-3 text-sm text-neutral-300">
        Volumen
        <input
          type="range"
          min={0}
          max={100}
          value={motor.volumenMaster}
          onChange={(e) => motor.setVolumenMaster(Number(e.target.value))}
          className="flex-1 h-11"
        />
        <span className="w-8 text-right">{motor.volumenMaster}</span>
      </label>

      <section className="rounded-xl bg-neutral-900 p-3 flex flex-col gap-3">
        <h2 className="font-bold text-violet-400">Efectos (en construcción)</h2>
        <Sirena />
      </section>

      <section className="rounded-xl bg-neutral-900 p-3 flex flex-col gap-2">
        <button className={claseBoton} onClick={() => setDiagAbierto((v) => !v)}>
          Diagnóstico {diagAbierto ? '▲' : '▼'}
        </button>
        {diagAbierto && (
          <>
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
          </>
        )}
      </section>
    </main>
  )
}
