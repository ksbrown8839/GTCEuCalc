import { readFile, writeFile } from "node:fs/promises";

const DEFAULT_DATA_FILE = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_COLORS_FILE = "data/fluid-colors.local.json";
const DEFAULT_OVERRIDES_FILE = "data/fluid-color-overrides.local.json";
const DEFAULT_OUTPUT_FILE = "data/gtceu-modern-pack-1.14.5.fluid-colors.local.json";

const args = parseArgs(process.argv.slice(2));
const dataFile = args.data ?? DEFAULT_DATA_FILE;
const colorsFile = args.colors ?? DEFAULT_COLORS_FILE;
const overridesFile = args.overrides ?? DEFAULT_OVERRIDES_FILE;
const outputFile = args.out ?? DEFAULT_OUTPUT_FILE;

const packData = JSON.parse(await readFile(dataFile, "utf-8"));
const fluidColorManifest = JSON.parse(await readFile(colorsFile, "utf-8"));
const fluidColorOverrides = await loadFluidColorOverrides(overridesFile);

if (fluidColorManifest.schema !== "gtceu-fluid-colors-v1") {
  throw new Error(`Unsupported fluid color manifest schema: ${fluidColorManifest.schema}`);
}

const fluidColors = fluidColorManifest.fluids ?? {};
const colorById = buildFluidColorLookup(fluidColors);
const overrideColorById = buildOverrideColorLookup(fluidColorOverrides);
let fluidGoods = 0;
let coloredFluidGoods = 0;
let overrideFluidGoods = 0;
let missingFluidGoods = 0;

const updatedGoods = (packData.goods ?? []).map((good) => {
  if (good.kind !== "fluid") return good;

  fluidGoods += 1;
  const overrideColor = colorForGood(good, overrideColorById);
  const color = overrideColor ?? colorForGood(good, colorById);
  if (!color) {
    missingFluidGoods += 1;
    return good;
  }

  coloredFluidGoods += 1;
  if (overrideColor) overrideFluidGoods += 1;
  return {
    ...good,
    color
  };
});

const updatedPackData = {
  ...packData,
  metadata: {
    ...(packData.metadata ?? {}),
    fluidColors: {
      source: colorsFile,
      overrides: overridesFile,
      generatedAt: new Date().toISOString(),
      fluidGoods,
      coloredFluidGoods,
      overrideFluidGoods,
      missingFluidGoods
    }
  },
  goods: updatedGoods
};

await writeFile(outputFile, `${JSON.stringify(updatedPackData, null, 2)}\n`);
console.log(`Wrote ${outputFile}`);
console.log(`Fluid goods: ${fluidGoods}`);
console.log(`Colored fluid goods: ${coloredFluidGoods}`);
console.log(`Override fluid goods: ${overrideFluidGoods}`);
console.log(`Missing fluid colors: ${missingFluidGoods}`);

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

async function loadFluidColorOverrides(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8"));
    if (parsed.schema === "gtceu-fluid-color-overrides-v1") {
      return parsed.fluids ?? {};
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
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

function buildOverrideColorLookup(overrides) {
  const lookup = new Map();

  for (const [fluidId, color] of Object.entries(overrides)) {
    const rgb = normalizeRgb(color?.rgb ?? color?.argb ?? color);
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
  const parts = String(value).split(":");
  if (parts.length !== 2) return [null, null];
  return parts;
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
