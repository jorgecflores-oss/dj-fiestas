// Tipos mínimos propios de la IFrame Player API de YouTube.
export interface Reproductor {
  playVideo(): void
  pauseVideo(): void
  cueVideoById(idVideo: string): void
  loadVideoById(idVideo: string): void
  setVolume(volumen: number): void
  getVolume(): number
  setPlaybackRate(velocidad: number): void
  getPlaybackRate(): number
  getAvailablePlaybackRates(): number[]
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  destroy(): void
}

export interface EventoYT {
  data: number
}

export interface OpcionesReproductor {
  playerVars?: Record<string, string | number>
  events?: {
    onReady?: () => void
    onStateChange?: (e: EventoYT) => void
    onError?: (e: EventoYT) => void
    onPlaybackRateChange?: (e: EventoYT) => void
  }
}

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement, opciones: OpcionesReproductor) => Reproductor
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

let promesaApi: Promise<void> | null = null

export function cargarApiYouTube(): Promise<void> {
  if (window.YT && window.YT.Player) return Promise.resolve()
  if (promesaApi) return promesaApi
  promesaApi = new Promise<void>((resolve) => {
    const anterior = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      anterior?.()
      resolve()
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    document.head.appendChild(script)
  })
  return promesaApi
}

export function extraerIdVideo(texto: string): string | null {
  const t = texto.trim()
  if (/^[\w-]{11}$/.test(t)) return t
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\.|^m\./, '')
  let candidato: string | null = null
  if (host === 'youtu.be') {
    candidato = url.pathname.split('/')[1] ?? null
  } else if (host === 'youtube.com' || host === 'music.youtube.com') {
    const partes = url.pathname.split('/')
    if (url.pathname === '/watch') candidato = url.searchParams.get('v')
    else if (partes[1] === 'shorts' || partes[1] === 'embed') candidato = partes[2] ?? null
  }
  return candidato && /^[\w-]{11}$/.test(candidato) ? candidato : null
}

export function nombreEstado(n: number): string {
  switch (n) {
    case -1:
      return 'sin iniciar'
    case 0:
      return 'terminado'
    case 1:
      return 'reproduciendo'
    case 2:
      return 'en pausa'
    case 3:
      return 'cargando'
    case 5:
      return 'en cola'
    default:
      return `desconocido (${n})`
  }
}
