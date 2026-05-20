# GTCEu Modern Planner

A clean-room calculator and production-chain planner for GregTech Community Pack Modern.

Target baseline:

- Pack: GregTech Community Pack Modern
- Pack version: 1.14.5
- Minecraft: 1.20.1
- Loader: Forge

This repository uses the GTNH calculator only as a reference for product thinking. The code here is new, and the app is designed around a normalized pack data file rather than GTNH's NESQL export.

## Current State

This first milestone includes:

- a static browser app
- a normalized `data/sample-pack.json` contract
- a small recursive planner for selected products
- a first-pass KubeJS exporter for real GTCEu Modern pack data

The sample data is intentionally tiny. It exists to prove the UI and planner shape before we wire in the real pack export.

## Run Locally

If `node` is available:

```bash
node tools/serve.mjs
```

Then open the URL printed by the server.

In this Codex workspace, local `node` was not available from PATH, so I use the bundled runtime path when running checks.

## Project Layout

- `index.html` - app shell
- `styles.css` - UI styling
- `src/repository.js` - normalized pack data access
- `src/planner.js` - production-chain planning
- `src/main.js` - browser UI
- `data/sample-pack.json` - sample GTCEu-style pack data
- `exporters/kubejs/` - KubeJS script and install notes for exporting the real pack
- `docs/architecture.md` - system design
- `docs/data-contract.md` - export file schema
- `docs/exporter-plan.md` - how we will get real pack data

## Validate An Export

```bash
node tools/validate-export.mjs data/sample-pack.json
```

To open a different exported data file in the app, pass it as a query parameter:

```text
http://127.0.0.1:4173/?data=data/gtceu-modern-pack-1.14.5.json
```

## Data Pipeline Goal

The long-term shape is:

```text
GTCEu Modern Community Pack instance
  -> exporter script/mod
  -> normalized pack JSON
  -> planner repository
  -> browser UI and solver
```

That keeps the calculator independent from KubeJS internals, while still preserving pack-specific recipe changes.
