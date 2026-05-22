# Icon Rendering Notes

The first texture atlas was built from one PNG per good. That gives good coverage, but it cannot faithfully draw Minecraft block items because most blocks are not a single texture. A machine may have separate top, side, front, overlay, and emissive textures, and Minecraft bakes those through the item's model before drawing the inventory icon.

GTNH-style accuracy needs one of two paths:

1. Export already-baked item icons from a running modded client, similar in spirit to NEI/NESQL workflows. This is the most accurate option because Forge, GTCEu, tint handlers, model loaders, item overrides, and custom renderers all participate.
2. Approximate simple models in the site tooling. This works for common cube models and many GTCEu machines, but it will always lag behind Minecraft for custom renderers, cables, pipes, animated textures, and special item properties.

The local extractor now stores model texture roles in `data/texture-manifest.local.json` when it can resolve them. The atlas builder can use those roles to render simple model cubes from top, side, front, and overlay textures instead of projecting one texture onto every face.

Next target: add a small Forge-side icon exporter that renders each good's actual `ItemStack` to a 32x32 image atlas and writes a manifest keyed by item id. Once that exists, the web app can consume exact in-game icons and use the JavaScript renderer only as a fallback.
