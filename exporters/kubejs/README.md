# KubeJS Exporter

This folder contains the first-pass data exporter for GregTech Community Pack Modern.

## Install

1. Duplicate or back up your pack instance.
2. Copy `server_scripts/gtceu_planner_export.js` into the instance at:

```text
kubejs/server_scripts/gtceu_planner_export.js
```

3. Make sure this folder exists in the instance:

```text
kubejs/exported
```

4. Launch the pack, then create/open a world or run `/reload`.
5. Look for the exported file:

```text
kubejs/exported/gtceu-planner-pack.json
```

6. Place that JSON under this project's `data/` folder, for example:

```text
data/gtceu-modern-pack-1.14.5.json
```

7. Open the planner with a data query parameter:

```text
http://127.0.0.1:4173/?data=data/gtceu-modern-pack-1.14.5.json
```

## What It Exports

- GTCEu machine recipes from the final KubeJS recipe set
- vanilla crafting/smelting-style recipes where a normal output stack is available
- item and fluid goods that appear in exported recipes
- tag ingredients and any entries that Minecraft can resolve during export
- GTCEu recipe type IO sizes
- voltage tiers from GTCEu constants

## Notes

This script runs in `ServerEvents.afterRecipes`, so it sees the pack after normal recipe loading and KubeJS changes have been applied.

The first version prioritizes recipe math over polish. Machine blocks, icons, localized names, and exact NBT-aware ingredient identity can come later.
