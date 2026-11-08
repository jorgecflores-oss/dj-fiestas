// Acceso a localStorage siempre dentro de try/catch (puede estar bloqueado).
export function leerTexto(clave: string): string | null {
  try {
    return localStorage.getItem(clave)
  } catch {
    return null
  }
}

export function guardarTexto(clave: string, valor: string): void {
  try {
    localStorage.setItem(clave, valor)
  } catch {
    // Sin almacenamiento: la app sigue funcionando sin recordar nada.
  }
}

export function borrarTexto(clave: string): void {
  try {
    localStorage.removeItem(clave)
  } catch {
    // Ídem.
  }
}
