// Funciones puras, sin DOM ni red, para poder probarlas con vitest.

export function gananciasPotenciaConstante(x: number): { salida: number; entrada: number } {
  const t = Math.min(1, Math.max(0, x))
  return { salida: Math.cos((t * Math.PI) / 2), entrada: Math.sin((t * Math.PI) / 2) }
}

// Duración real del crossfade: si casi no queda tema, corte directo (0).
export function duracionCrossfade(configS: number, restanteS: number): number {
  if (restanteS <= 1) return 0
  return Math.max(1, Math.min(configS, restanteS - 1))
}

// "PT1H2M3S" -> 3723. Cualquier cosa inválida da 0.
export function parseDuracionISO(iso: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso.trim())
  if (!m) return 0
  const [, d, h, min, s] = m
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0)
}

const ENTIDADES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export function decodificarHtml(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entero, cuerpo: string) => {
    if (cuerpo[0] === '#') {
      const codigo =
        cuerpo[1] === 'x' || cuerpo[1] === 'X'
          ? parseInt(cuerpo.slice(2), 16)
          : parseInt(cuerpo.slice(1), 10)
      if (!Number.isFinite(codigo) || codigo > 0x10ffff) return entero
      return String.fromCodePoint(codigo)
    }
    return ENTIDADES[cuerpo.toLowerCase()] ?? entero
  })
}

export function formatoTiempo(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const total = Math.floor(s)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const seg = String(total % 60).padStart(2, '0')
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${seg}`
  return `${m}:${seg}`
}

// Solo se actualiza la app sola si no hay música ni nada preparado.
export function sePuedeActualizar(estados: string[], fase: string): boolean {
  return fase === 'idle' && estados.every((e) => e === 'libre')
}

// Mantiene la pantalla prendida si suena algo o si el último sonido fue hace poco.
export function debeMantenerPantalla(
  haySonido: boolean,
  msDesdeUltimoSonido: number,
  graciaMs: number,
): boolean {
  return haySonido || msDesdeUltimoSonido < graciaMs
}

export type ColorInsignia = 'verde' | 'ambar' | 'gris' | 'violeta' | 'rojo'

// Insignia de la tarjeta según el estado real del deck.
export function insigniaDeck(
  esActual: boolean,
  estado: string,
): { texto: string; color: ColorInsignia } {
  if (estado === 'error') return { texto: 'ERROR', color: 'rojo' }
  if (estado === 'libre') return { texto: 'LIBRE', color: 'gris' }
  if (esActual) {
    if (estado === 'pausado') return { texto: 'EN PAUSA', color: 'ambar' }
    if (estado === 'terminado') return { texto: 'TERMINADO', color: 'gris' }
    return { texto: 'SONANDO', color: 'verde' }
  }
  if (estado === 'sonando') return { texto: 'ENTRANDO', color: 'violeta' }
  return { texto: 'SIGUIENTE', color: 'violeta' }
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
