# ifwehadtrains

Map-based React application built with Vite, TypeScript, Tailwind CSS, and Mapbox GL.

## Requirements

- Node `24.14.0` (see `.nvmrc`)
- npm `10+`

```bash
nvm use
```

## Install

```bash
npm install
```

## Run

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Lint

```bash
npm run lint
```

## Upgrade Notes

- The project is now on current major versions of React, Vite, TypeScript, ESLint (flat config), and Tailwind CSS v4.
- Tailwind is configured through `@tailwindcss/postcss` and `src/index.css` now imports `tailwindcss` directly.
- `mapbox-gl` ships its own TypeScript types, so `@types/mapbox-gl` is no longer installed.

## Verification Checklist After Dependency Updates

Run the following and confirm all pass:

```bash
npm run lint
npm run build
npm run dev
```

Manual checks while dev server is running:

1. App loads without runtime errors.
2. Map renders and map interactions still work.
3. Dev endpoints `/__dev/append-tracks` and `/__dev/update-track` still function.
4. Styling looks correct after Tailwind upgrades.
