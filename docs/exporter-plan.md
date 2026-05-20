# Exporter Plan

## What We Need To Export

For GregTech Community Pack Modern 1.14.5, we need the final recipe graph after Forge, GTCEu Modern, and KubeJS have all loaded.

The minimum useful export is:

- item ids and display names
- fluid ids and display names
- tags and tag entries
- recipe types
- recipes with inputs, outputs, duration, EU/t, chances, and non-consumed ingredients
- machine definitions where possible
- voltage tier constants

Icons can come later. The planner works without them.

## Current Extraction Path

### Option A: KubeJS Export Script

This is now started under `exporters/kubejs/server_scripts/gtceu_planner_export.js`.

The script runs in KubeJS `ServerEvents.afterRecipes`, walks the final loaded recipe list, exports GTCEu recipe internals where available, and writes:

```text
kubejs/exported/gtceu-planner-pack.json
```

That file should match `docs/data-contract.md` and can be checked with:

```bash
node tools/validate-export.mjs data/gtceu-modern-pack-1.14.5.json
```

Pros:

- easy for a player to drop into the pack
- no Java build setup
- can see pack-specific KubeJS changes

Cons:

- may need a debug pass against the real pack runtime
- NBT-aware ingredients and icons are limited in this first version
- icon export is limited

### Option B: Tiny Forge Helper Mod

A small server-side/client-side mod can inspect Minecraft registries and GTCEu recipe objects directly, then write JSON.

Pros:

- most accurate
- better access to recipe internals and icons
- easier to make repeatable

Cons:

- requires a Java/Gradle mod project
- more setup for the user

## What I Will Need From You Next

To export real data, I will need you to run the target pack once with the exporter installed.

Flow:

1. Back up or duplicate your pack instance.
2. Copy `exporters/kubejs/server_scripts/gtceu_planner_export.js` into the instance at `kubejs/server_scripts/`.
3. Make sure the instance has a `kubejs/exported` folder.
4. Launch the pack and load a world or run `/reload`.
5. Place the generated JSON in this workspace under `data/`.
6. Open the planner with `?data=data/<your-export-file>.json`.

The script is deliberately small enough that if KubeJS exposes one method differently in your installed pack, the error should point us to the exact adapter function to adjust.
