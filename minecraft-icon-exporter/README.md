# Minecraft Icon Exporter

This folder is the planned Minecraft-side exporter for exact GTCEuCalc icons.

The browser renderer can approximate Minecraft models, but exact visuals require Minecraft's own client renderer. The exporter should run inside the GTCEu Modern modpack, render each `ItemStack` through the real client `ItemRenderer`, and write PNG files plus a manifest that the web atlas builder can consume.

## Target output

The exporter should write files into the web project like this:

```text
rendered-icons/items/<namespace>/<path>.png
data/rendered-icons.local.json
```

Manifest shape:

```json
{
  "schema": "gtceu-rendered-icons-v1",
  "generatedAt": "2026-05-22T00:00:00.000Z",
  "iconSize": 64,
  "icons": {
    "gtceu:ev_machine_hull": "rendered-icons/items/gtceu/ev_machine_hull.png"
  }
}
```

## Web-side integration already added

Once the Minecraft exporter exists and produces `data/rendered-icons.local.json`, run this from the web project root:

```bash
node tools/merge-rendered-icons.mjs
node tools/build-texture-atlas.mjs --source data/texture-manifest.rendered.local.json --tileSize 64
```

That makes the existing website atlas prefer real Minecraft-rendered PNGs while keeping the current texture/model renderer as a fallback.

## Recommended implementation approach

Build this as a small client-only Forge 1.20.1 helper mod and place it in the GTCEu Modern instance while developing.

The exporter needs to:

1. wait until the Minecraft client and resources are loaded
2. iterate item registry entries
3. render each item as an `ItemStack` using the normal GUI item renderer
4. capture the rendered image from a framebuffer or native image
5. write each PNG to `rendered-icons/items/<namespace>/<path>.png`
6. write `data/rendered-icons.local.json`

## Why this is separate

This repository is a static website/tooling project. The exact exporter must run inside Minecraft because Forge/GTCEu can provide custom baked models, item color handlers, fluid tinting, dynamic renderers, and GUI transforms that are not fully recoverable from model JSON alone.
