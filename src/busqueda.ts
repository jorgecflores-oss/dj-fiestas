// Cliente mínimo de la Data API de YouTube, con caché en localStorage.
import { borrarTexto, guardarTexto, leerTexto } from './almacen.ts'
import { registrar } from './registro.ts'
import { decodificarHtml, parseDuracionISO } from './utilidades.ts'

const CLAVE_API = 'dj_yt_api_key'
const CLAVE_CACHE = 'dj_cache_busqueda'
const VIGENCIA_MS = 24 * 60 * 60 * 1000
const MAX_ENTRADAS = 30
const BASE = 'https://www.googleapis.com/youtube/v3'

export interface ResultadoVideo {
  videoId: string
  titulo: string
  canal: string
  miniaturaUrl: string
  duracionS: number
}

export type ErrorBusqueda =
  | { tipo: 'sin-clave' }
  | { tipo: 'cuota' }
  | { tipo: 'clave-invalida'; razon: string }
  | { tipo: 'red' }

export type RespuestaBusqueda =
  | { ok: true; resultados: ResultadoVideo[]; deCache: boolean }
  | { ok: false; error: ErrorBusqueda }

export type RespuestaDetalle =
  | { ok: true; detalle: ResultadoVideo }
  | { ok: false; error: ErrorBusqueda }

export function leerClave(): string {
  return leerTexto(CLAVE_API) ?? ''
}

export function guardarClave(clave: string): void {
  const limpia = clave.trim()
  if (limpia) guardarTexto(CLAVE_API, limpia)
  else borrarTexto(CLAVE_API)
}

export function mensajeError(error: ErrorBusqueda): string {
  switch (error.tipo) {
    case 'sin-clave':
      return 'Falta la clave de la API. Pegala en Ajustes, o pegá un link de YouTube directamente.'
    case 'cuota':
      return 'Se agotó la cuota diaria de la API de YouTube. Probá mañana o pegá links directamente.'
    case 'clave-invalida':
      return `La clave de la API no sirve (${error.razon}). Revisala en Ajustes.`
    case 'red':
      return 'No se pudo conectar con YouTube. Revisá tu conexión e intentá de nuevo.'
  }
}

// Nunca dejamos pasar la clave a un mensaje de registro.
function sinClave(texto: string): string {
  return texto.replace(/([?&]?key=)[^&\s"']+/gi, '$1…')
}

function normalizar(consulta: string): string {
  return consulta.toLowerCase().replace(/\s+/g, ' ').trim()
}

interface CuerpoError {
  error?: { code?: number; status?: string; errors?: { reason?: string }[] }
}

type Pedido<T> = { ok: true; datos: T } | { ok: false; error: ErrorBusqueda }

async function pedir<T>(
  ruta: string,
  params: Record<string, string>,
  clave: string,
): Promise<Pedido<T>> {
  const url = new URL(`${BASE}/${ruta}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const urlLog = url.toString()
  url.searchParams.set('key', clave)
  try {
    const res = await fetch(url)
    if (!res.ok) {
      const cuerpo = (await res.json().catch(() => null)) as CuerpoError | null
      const razon = cuerpo?.error?.errors?.[0]?.reason ?? cuerpo?.error?.status ?? `http${res.status}`
      registrar(`Búsqueda: HTTP ${res.status} (${razon}) en ${sinClave(urlLog)}`)
      if (res.status === 403 && (razon === 'quotaExceeded' || razon === 'dailyLimitExceeded')) {
        return { ok: false, error: { tipo: 'cuota' } }
      }
      if (
        res.status === 400 ||
        (res.status === 403 &&
          (razon === 'keyInvalid' || razon === 'accessNotConfigured' || razon === 'ipRefererBlocked'))
      ) {
        return { ok: false, error: { tipo: 'clave-invalida', razon } }
      }
      return { ok: false, error: { tipo: 'red' } }
    }
    return { ok: true, datos: (await res.json()) as T }
  } catch (err) {
    registrar(`Búsqueda: falla de red en ${sinClave(urlLog)}: ${sinClave(String(err))}`)
    return { ok: false, error: { tipo: 'red' } }
  }
}

interface Miniatura {
  url?: string
}
interface ItemBusqueda {
  id?: { videoId?: string }
  snippet?: {
    title?: string
    channelTitle?: string
    thumbnails?: { medium?: Miniatura; default?: Miniatura }
  }
}
interface ItemVideo {
  id?: string
  snippet?: ItemBusqueda['snippet']
  contentDetails?: { duration?: string }
  status?: { embeddable?: boolean }
}

interface EntradaCache {
  t: number
  resultados: ResultadoVideo[]
}

function leerCache(): Record<string, EntradaCache> {
  const crudo = leerTexto(CLAVE_CACHE)
  if (!crudo) return {}
  try {
    const dato: unknown = JSON.parse(crudo)
    return dato && typeof dato === 'object' ? (dato as Record<string, EntradaCache>) : {}
  } catch {
    return {}
  }
}

function guardarCache(cache: Record<string, EntradaCache>): void {
  const mantener = Object.entries(cache)
    .sort((a, b) => b[1].t - a[1].t)
    .slice(0, MAX_ENTRADAS)
  guardarTexto(CLAVE_CACHE, JSON.stringify(Object.fromEntries(mantener)))
}

export async function buscarVideos(
  consulta: string,
  opciones: { soloMusica: boolean },
): Promise<RespuestaBusqueda> {
  const clave = leerClave()
  if (!clave) {
    registrar(`Búsqueda "${consulta}": sin clave`)
    return { ok: false, error: { tipo: 'sin-clave' } }
  }

  const llave = `${normalizar(consulta)}|${opciones.soloMusica ? 1 : 0}`
  const cache = leerCache()
  const guardada = cache[llave]
  if (guardada && Date.now() - guardada.t < VIGENCIA_MS) {
    registrar(`Búsqueda "${consulta}": ${guardada.resultados.length} resultados (de caché)`)
    return { ok: true, resultados: guardada.resultados, deCache: true }
  }

  const params: Record<string, string> = {
    part: 'snippet',
    type: 'video',
    maxResults: '10',
    videoEmbeddable: 'true',
    q: consulta,
  }
  if (opciones.soloMusica) params.videoCategoryId = '10'
  const busqueda = await pedir<{ items?: ItemBusqueda[] }>('search', params, clave)
  if (!busqueda.ok) return busqueda

  const ids = (busqueda.datos.items ?? [])
    .map((i) => i.id?.videoId)
    .filter((i): i is string => Boolean(i))
  if (ids.length === 0) {
    registrar(`Búsqueda "${consulta}": 0 resultados`)
    return { ok: true, resultados: [], deCache: false }
  }

  const videos = await pedir<{ items?: ItemVideo[] }>(
    'videos',
    { part: 'contentDetails,status', id: ids.join(',') },
    clave,
  )
  if (!videos.ok) return videos

  const porId = new Map((videos.datos.items ?? []).map((v) => [v.id, v]))
  const resultados: ResultadoVideo[] = []
  for (const item of busqueda.datos.items ?? []) {
    const id = item.id?.videoId
    const video = id ? porId.get(id) : undefined
    if (!id || !video || video.status?.embeddable !== true) continue
    resultados.push({
      videoId: id,
      titulo: decodificarHtml(item.snippet?.title ?? ''),
      canal: decodificarHtml(item.snippet?.channelTitle ?? ''),
      miniaturaUrl:
        item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? '',
      duracionS: parseDuracionISO(video.contentDetails?.duration ?? ''),
    })
  }

  cache[llave] = { t: Date.now(), resultados }
  guardarCache(cache)
  registrar(`Búsqueda "${consulta}": ${resultados.length} resultados (de red)`)
  return { ok: true, resultados, deCache: false }
}

// Cuesta 1 unidad de cuota. Se usa al agregar un tema por link teniendo clave.
export async function detallesVideo(videoId: string): Promise<RespuestaDetalle> {
  const clave = leerClave()
  if (!clave) return { ok: false, error: { tipo: 'sin-clave' } }
  const r = await pedir<{ items?: ItemVideo[] }>(
    'videos',
    { part: 'snippet,contentDetails', id: videoId },
    clave,
  )
  if (!r.ok) return r
  const v = r.datos.items?.[0]
  if (!v) {
    registrar(`Detalles de ${videoId}: no encontrado`)
    return { ok: false, error: { tipo: 'red' } }
  }
  registrar(`Detalles de ${videoId}: ok`)
  return {
    ok: true,
    detalle: {
      videoId,
      titulo: decodificarHtml(v.snippet?.title ?? ''),
      canal: decodificarHtml(v.snippet?.channelTitle ?? ''),
      miniaturaUrl: v.snippet?.thumbnails?.medium?.url ?? v.snippet?.thumbnails?.default?.url ?? '',
      duracionS: parseDuracionISO(v.contentDetails?.duration ?? ''),
    },
  }
}
