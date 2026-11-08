// Registro de diagnóstico en memoria, compatible con useSyncExternalStore.
const MAXIMO = 500

let lineas: readonly string[] = []
const oyentes = new Set<() => void>()

function dos(n: number): string {
  return String(n).padStart(2, '0')
}

function horaLocal(): string {
  const d = new Date()
  return `${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

function avisar() {
  oyentes.forEach((cb) => cb())
}

export function registrar(mensaje: string): void {
  const nuevas = [...lineas, `${horaLocal()} ${mensaje}`]
  lineas = nuevas.length > MAXIMO ? nuevas.slice(nuevas.length - MAXIMO) : nuevas
  avisar()
}

// Devuelve siempre la misma referencia hasta que haya un cambio.
export function obtenerLineas(): readonly string[] {
  return lineas
}

export function suscribir(callback: () => void): () => void {
  oyentes.add(callback)
  return () => {
    oyentes.delete(callback)
  }
}

export function borrar(): void {
  lineas = []
  avisar()
}

export function textoCompleto(): string {
  return lineas.join('\n')
}
