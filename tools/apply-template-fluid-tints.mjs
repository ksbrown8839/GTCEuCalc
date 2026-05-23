import { readFile, stat, writeFile } from "node:fs/promises";

const DEFAULT_DATA_FILE = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_SOURCE_MANIFEST_FILE = "data/texture-manifest.rendered.local.json";
const FALLBACK_SOURCE_MANIFEST_FILE = "data/texture-manifest.local.json";
const DEFAULT_COLORS_FILE = "data/fluid-colors.local.json";
const DEFAULT_OUTPUT_FILE = "data/gtceu-modern-pack-1.14.5.fluid-tints.local.json";

const args = parseArgs(process.argv.slice(2));
const dataFile = args.data ?? DEFAULT_DATA_FILE;
const sourceManifestFile = args.source ?? (await exists(DEFAULT_SOURCE_MANIFEST_FILE) ? DEFAULT_SOURCE_MANIFEST_FILE : FALLBACK_SOURCE_MANIFEST_FILE);
const colorsFile = args.colors ?? DEFAULT_COLORS_FILE;
const outputFile = args.out ?? DEFAULT_OUTPUT_FILE;

const packData = JSON.parse(await readFile(dataFile, "utf-8"));
const sourceManifest = JSON.parse(await readFile(sourceManifestFile, "utf-8"));
const fluidColorManifest = JSON.parse(await readFile(colorsFile, "utf-8"));

if (sourceManifest.schema !== "gtceu-planner-texture-manifest-v1") {
  throw new Error(`Unsupported texture source manifest schema: ${sourceManifest.schema}`);
}

if (fluidColorManifest.schema !== "gtceu-fluid-colors-v1") {
  throw new Error(`Unsupported fluid color manifest schema: ${fluidColorManifest.schema}`);
}

const colorById = buildFluidColorLookup(fluidColorManifest.fluids ?? {});
let fluidGoods = 0;
let bakedTextureFluidGoods = 0;
let templateTextureFluidGoods = 0;
let tintedTemplateFluidGoods = 0;
let missingTemplateTints = 0;
let whiteTemplateTints = 0;

const updatedGoods = (packData.goods ?? []).map((good) => {
  if (good.kind !== "fluid") return good;

  fluidGoods += 1;
  const primaryTexture = primaryTextureForGood(good, sourceManifest);
  const withoutColor = removeFluidColor(good);

  if (!requiresFluidTint(primaryTexture)) {
    bakedTextureFluidGoods += 1;
    return withoutColor;
  }

  templateTextureFluidGoods += 1;
  const color = colorForGood(good, colorById);
  if (!color) {
    missingTemplateTints += 1;
    return withoutColor;
  }

  if (color === "#FFFFFF") {
    whiteTemplateTints += 1;
    return withoutColor;
  }

  tintedTemplateFluidGoods += 1;
  return {
    ...withoutColor,
    color
  };
});

const updatedPackData = {
  ...packData,
  metadata: {
    ...(packData.metadata ?? {}),
    templateFluidTints: {
      sourceManifest: sourceManifestFile,
      fluidColors: colorsFile,
      generatedAt: new Date().toISOString(),
      fluidGoods,
      bakedTextureFluidGoods,
      templateTextureFluidGoods,
      tintedTemplateFluidGoods,
      missingTemplateTints,
      whiteTemplateTints
    }
  },
  goods: updatedGoods
};

await writeFile(outputFile, `${JSON.stringify(updatedPackData, null, 2)}\n`);
console.log(`Wrote ${outputFile}`);
console.log(`Fluid goods: ${fluidGoods}`);
console.log(`Baked/dedicated texture fluids: ${bakedTextureFluidGoods}`);
console.log(`Template texture fluids: ${templateTextureFluidGoods}`);
console.log(`Tinted template fluids: ${tintedTemplateFluidGoods}`);
console.log(`Missing template tints: ${missingTemplateTints}`);
console.log(`White/no-op template tints: ${whiteTemplateTints}`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

async function exists(path) {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

function primaryTextureForGood(good, manifest) {
  const manifestIcon = manifest.icons?.[good.id];
  return manifestIcon?.primary ?? manifest.textures?.[good.id] ?? null;
}

function requiresFluidTint(texturePath) {
  if (typeof texturePath !== "string") return false;
  const normalized = texturePath.replaceAll("\\\\", "/");

  if (normalized.includes("/block/fluids/") || normalized.includes("/block/fluid/")) {
    return false;
  }

  return normalized.includes("/block/material_sets/")
    && /\/(liquid|gas|molten|plasma)\.png$/i.test(normalized);
}

function removeFluidColor(good) {
  if (!Object.prototype.hasOwnProperty.call(good, "color")) return good;
  const { color: _color, ...withoutColor } = good;
  return withoutColor;
}

function buildFluidColorLookup(fluids) {
  const lookup = new Map();

  for (const [fluidId, entry] of Object.entries(fluids)) {
    const rgb = normalizeRgb(entry?.rgb ?? entry?.argb);
    if (!rgb) continue;

    addCandidate(lookup, fluidId, rgb);
    const [namespace, path] = splitResource(fluidId);
    if (!namespace || !path) continue;

    addCandidate(lookup, `${namespace}:${stripFluidVariantPrefix(path)}`, rgb);
    addCandidate(lookup, `${namespace}:${stripFluidVariantSuffix(path)}`, rgb);

    if (path.startsWith("fluid.")) {
      addCandidate(lookup, `${namespace}:${path.slice("fluid.".length).replaceAll(".", "_")}`, rgb);
    }
  }

  return lookup;
}

function colorForGood(good, colorById) {
  const candidates = goodIdCandidates(good.id);
  for (const candidate of candidates) {
    const color = colorById.get(candidate);
    if (color) return color;
  }
  return null;
}

function goodIdCandidates(goodId) {
  const candidates = new Set([goodId]);
  const [namespace, path] = splitResource(goodId);
  if (!namespace || !path) return [...candidates];

  candidates.add(`${namespace}:${stripFluidVariantPrefix(path)}`);
  candidates.add(`${namespace}:${stripFluidVariantSuffix(path)}`);
  candidates.add(`${namespace}:fluid.${path.replaceAll("_", ".")}`);
  candidates.add(`${namespace}:fluid.${path}`);

  if (namespace === "gtceu") {
    candidates.add(`gtceu:${path.replaceAll(".", "_")}`);
  }

  return [...candidates];
}

function splitResource(value) {
  const separator = String(value).indexOf(":");
  if (separator === -1) return [null, null];
  return [String(value).slice(0, separator), String(value).slice(separator + 1)];
}

function stripFluidVariantPrefix(path) {
  return path
    .replace(/^flowing_/, "")
    .replace(/^flow_/, "")
    .replace(/^still_/, "");
}

function stripFluidVariantSuffix(path) {
  return path
    .replace(/_flowing$/, "")
    .replace(/_flow$/, "")
    .replace(/_still$/, "");
}

function addCandidate(lookup, id, color) {
  if (!id || lookup.has(id)) return;
  lookup.set(id, color);
}

function normalizeRgb(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!match) return null;
  const hex = match[1].length === 8 ? match[1].slice(2) : match[1];
  return `#${hex.toUpperCase()}`;
}
