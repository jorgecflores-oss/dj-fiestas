// Tipos mínimos propios de la IFrame Player API de YouTube.
export interface Reproductor {
  playVideo(): void
  pauseVideo(): void
  cueVideoById(idVideo: string): void
  loadVideoById(idVideo: string, inicioS?: number): void
  mute(): void
  unMute(): void
  stopVideo(): void
  seekTo(segundos: number, permitirBuscar: boolean): void
  getVideoData(): { video_id: string; title: string; author: string }
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
