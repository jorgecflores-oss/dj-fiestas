import { describe, expect, it } from 'vitest'
import {
  decodificarHtml,
  duracionCrossfade,
  extraerIdVideo,
  formatoTiempo,
  gananciasPotenciaConstante,
  insigniaDeck,
  parseDuracionISO,
  sePuedeActualizar,
} from './utilidades.ts'

describe('gananciasPotenciaConstante', () => {
  it('da los extremos y el punto medio', () => {
    expect(gananciasPotenciaConstante(0)).toEqual({ salida: 1, entrada: 0 })
    const medio = gananciasPotenciaConstante(0.5)
    expect(medio.salida).toBeCloseTo(Math.SQRT1_2)
    expect(medio.entrada).toBeCloseTo(Math.SQRT1_2)
    const fin = gananciasPotenciaConstante(1)
    expect(fin.salida).toBeCloseTo(0)
    expect(fin.entrada).toBeCloseTo(1)
  })

  it('mantiene salida² + entrada² = 1', () => {
    for (const x of [0, 0.1, 0.25, 0.5, 0.77, 1]) {
      const g = gananciasPotenciaConstante(x)
      expect(g.salida ** 2 + g.entrada ** 2).toBeCloseTo(1)
    }
  })

  it('limita x a 0..1', () => {
    expect(gananciasPotenciaConstante(-3).entrada).toBe(0)
    expect(gananciasPotenciaConstante(7).salida).toBeCloseTo(0)
  })
})

describe('duracionCrossfade', () => {
  it('calcula la duración según lo que queda', () => {
    expect(duracionCrossfade(12, 60)).toBe(12)
    expect(duracionCrossfade(12, 8)).toBe(7)
    expect(duracionCrossfade(12, 1.5)).toBe(1)
    expect(duracionCrossfade(12, 1)).toBe(0)
    expect(duracionCrossfade(12, 0)).toBe(0)
  })
})

describe('parseDuracionISO', () => {
  it('interpreta duraciones ISO 8601', () => {
    expect(parseDuracionISO('PT1H2M3S')).toBe(3723)
    expect(parseDuracionISO('PT4M')).toBe(240)
    expect(parseDuracionISO('PT45S')).toBe(45)
  })

  it('devuelve 0 si es inválida', () => {
    expect(parseDuracionISO('P0D')).toBe(0)
    expect(parseDuracionISO('basura')).toBe(0)
  })
})

describe('decodificarHtml', () => {
  it('decodifica entidades nombradas', () => {
    expect(decodificarHtml('Rock &amp; Roll &lt;3 &gt; &quot;hola&quot;')).toBe(
      'Rock & Roll <3 > "hola"',
    )
  })

  it('decodifica entidades numéricas', () => {
    expect(decodificarHtml('It&#39;s It&#x27;s &#65; &#x41;')).toBe("It's It's A A")
  })

  it('no decodifica dos veces ni toca lo desconocido', () => {
    expect(decodificarHtml('&amp;lt;')).toBe('&lt;')
    expect(decodificarHtml('&inventada; y &#99999999;')).toBe('&inventada; y &#99999999;')
  })
})

describe('extraerIdVideo', () => {
  const id = 'dQw4w9WgXcQ'
  it('acepta los formatos de link', () => {
    expect(extraerIdVideo(`https://www.youtube.com/watch?v=${id}&t=10`)).toBe(id)
    expect(extraerIdVideo(`https://youtu.be/${id}?si=abc`)).toBe(id)
    expect(extraerIdVideo(`https://www.youtube.com/shorts/${id}`)).toBe(id)
    expect(extraerIdVideo(`https://www.youtube.com/embed/${id}`)).toBe(id)
  })

  it('acepta un ID suelto', () => {
    expect(extraerIdVideo(id)).toBe(id)
    expect(extraerIdVideo(`  ${id}  `)).toBe(id)
  })

  it('rechaza texto inválido', () => {
    expect(extraerIdVideo('hola mundo')).toBeNull()
    expect(extraerIdVideo('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(extraerIdVideo('https://www.youtube.com/watch?v=corto')).toBeNull()
    expect(extraerIdVideo('')).toBeNull()
  })
})

describe('formatoTiempo', () => {
  it('formatea m:ss y h:mm:ss', () => {
    expect(formatoTiempo(0)).toBe('0:00')
    expect(formatoTiempo(65.9)).toBe('1:05')
    expect(formatoTiempo(3599)).toBe('59:59')
    expect(formatoTiempo(3600)).toBe('1:00:00')
    expect(formatoTiempo(3723)).toBe('1:02:03')
  })

  it('tolera valores inválidos', () => {
    expect(formatoTiempo(NaN)).toBe('0:00')
    expect(formatoTiempo(-5)).toBe('0:00')
  })
})

describe('sePuedeActualizar', () => {
  it('permite actualizar con todo libre y sin mezcla', () => {
    expect(sePuedeActualizar(['libre', 'libre'], 'idle')).toBe(true)
  })

  it('no permite con un deck preparado o sonando', () => {
    expect(sePuedeActualizar(['libre', 'listo'], 'idle')).toBe(false)
    expect(sePuedeActualizar(['sonando', 'libre'], 'idle')).toBe(false)
  })

  it('no permite durante una mezcla', () => {
    expect(sePuedeActualizar(['libre', 'libre'], 'rampa')).toBe(false)
  })
})

describe('insigniaDeck', () => {
  it('aplica las reglas en orden', () => {
    expect(insigniaDeck(true, 'error')).toEqual({ texto: 'ERROR', color: 'rojo' })
    expect(insigniaDeck(false, 'libre')).toEqual({ texto: 'LIBRE', color: 'gris' })
    expect(insigniaDeck(true, 'sonando')).toEqual({ texto: 'SONANDO', color: 'verde' })
    expect(insigniaDeck(true, 'pausado')).toEqual({ texto: 'EN PAUSA', color: 'ambar' })
    expect(insigniaDeck(true, 'terminado')).toEqual({ texto: 'TERMINADO', color: 'gris' })
    expect(insigniaDeck(true, 'listo')).toEqual({ texto: 'SONANDO', color: 'verde' })
    expect(insigniaDeck(false, 'sonando')).toEqual({ texto: 'ENTRANDO', color: 'violeta' })
    expect(insigniaDeck(false, 'listo')).toEqual({ texto: 'SIGUIENTE', color: 'violeta' })
  })

  it('el error y libre ganan sobre esActual', () => {
    expect(insigniaDeck(false, 'error').texto).toBe('ERROR')
    expect(insigniaDeck(true, 'libre').texto).toBe('LIBRE')
  })
})
