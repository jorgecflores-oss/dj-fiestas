# DJ Fiestas

Webapp (PWA) de DJ para fiestas en el teléfono.

## Idea

- Elegir música desde YouTube.
- Enganches y mezclas automáticas al elegir el próximo tema.
- Acelerar o ralentizar tempos y sincronizarlos.
- Botones de efectos: sirenas y otros de consolas de DJ.
- Modo autónomo: se elige un género (disco 80, 90, rock clásico, rock nacional, cumbia, fiesta, brasilera, house, etc.) y la app pasa música sola.

## Stack

Vite + React + TypeScript + Tailwind + vite-plugin-pwa. Mismo patrón que `ceramientas-calc`.

## Desarrollo

```
npm install
npm run dev
npm run build
```

## Deploy

GitHub Pages por GitHub Actions. Cada push a `main` publica en
`https://jorgecflores-oss.github.io/dj-fiestas/`.
