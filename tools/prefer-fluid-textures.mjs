import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

const DEFAULT_DATA_FILE = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_MANIFEST_FILE = "data/texture-manifest.local.json";
const DEFAULT_OUTPUT_FILE = DEFAULT_MANIFEST_FILE;
const DEFAULT_TEXTURE_ROOT = "assets/textures";

const args = parseArgs(process.argv.slice(2));
const dataFile = args.data ?? DEFAULT_DATA_FILE;
const manifestFile = args.manifest ?? DEFAULT_MANIFEST_FILE;
const outputFile = args.out ?? DEFAULT_OUTPUT_FILE;
const textureRoot = args.textures ?? DEFAULT_TEXTURE_ROOT;

const packData = JSON.parse(await readFile(dataFile, "utf-8"));
const manifest = JSON.parse(await readFile(manifestFile, "utf-8"));
const fluidTextureIndex = await buildFluidTextureIndex(textureRoot);

if (manifest.schema !== "gtceu-planner-texture-manifest-v1") {
  throw new Error(`Unsupported texture manifest schema: ${manifest.schema}`);
}

let fluidGoods = 0;
let preferredFluidTextures = 0;
let missingFluidTextures = 0;

manifest.textures ??= {};
manifest.icons ??= {};
manifest.source ??= {};

for (const good of packData.goods ?? []) {
  if (good.kind !== "fluid") continue;

  fluidGoods += 1;
  const preferred = findPreferredFluidTexture(good.id, fluidTextureIndex);
  if (!preferred) {
    missingFluidTextures += 1;
    continue;
  }

  preferredFluidTextures += 1;
  manifest.textures[good.id] = preferred;
  manifest.icons[good.id] = {
    kind: "fluid",
    primary: preferred,
    textures: {
      primary: preferred,
      layer0: preferred
    }
  };
}

manifest.generatedAt = new Date().toISOString();
manifest.source.fluidTexturePreference = {
  textureRoot,
  fluidDirectoryTexturesIndexed: fluidTextureIndex.entries.length,
  fluidGoods,
  preferredFluidTextures,
  missingFluidTextures
};

await writeFile(outputFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${outputFile}`);
console.log(`Fluid directory textures indexed: ${fluidTextureIndex.entries.length}`);
console.log(`Fluid goods scanned: ${fluidGoods}`);
console.log(`Preferred fluid textures: ${preferredFluidTextures}`);
console.log(`Missing preferred fluid textures: ${missingFluidTextures}`);

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

async function buildFluidTextureIndex(textureRoot) {
  const entries = [];
  const byExactPath = new Map();
  const byNormalizedName = new Map();

  if (!await exists(textureRoot)) {
    return { entries, byExactPath, byNormalizedName };
  }

  const files = await filesUnder(textureRoot);
  for (const filePath of files) {
    const webPath = toWebPath(relative(".", filePath));
    if (!/\/block\/fluids?\//.test(webPath)) continue;
    if (!webPath.toLowerCase().endsWith(".png")) continue;

    const normalizedName = normalizeFluidName(basename(webPath, ".png"));
    const entry = { webPath, normalizedName };
    entries.push(entry);

    addIndexValue(byNormalizedName, normalizedName, entry);
    addIndexValue(byExactPath, webPath, entry);
  }

  entries.sort((a, b) => a.webPath.localeCompare(b.webPath));
  return { entries, byExactPath, byNormalizedName };
}

function findPreferredFluidTexture(goodId, index) {
  const [namespace, path] = splitResource(goodId);
  if (!namespace || !path) return null;

  const exactCandidates = fluidTextureCandidates(namespace, path).map(textureRefToWebPath);
  for (const candidate of exactCandidates) {
    const entry = index.byExactPath.get(candidate)?.[0];
    if (entry) return entry.webPath;
  }

  const normalizedCandidates = fluidNameCandidates(path).map(normalizeFluidName);
  for (const candidate of normalizedCandidates) {
    const entry = firstNamespaceMatch(index.byNormalizedName.get(candidate), namespace);
    if (entry) return entry.webPath;
  }

  const loose = index.entries.find((entry) => {
    if (!entry.webPath.includes(`/${namespace}/`)) return false;
    return normalizedCandidates.some((candidate) => entry.normalizedName.includes(candidate));
  });

  return loose?.webPath ?? null;
}

function firstNamespaceMatch(entries, namespace) {
  if (!entries?.length) return null;
  return entries.find((entry) => entry.webPath.includes(`/${namespace}/`)) ?? entries[0];
}

function fluidTextureCandidates(namespace, path) {
  const candidates = [
    `${namespace}:block/fluids/fluid.${path}`,
    `${namespace}:block/fluids/fluid.${path.replaceAll("_", ".")}`,
    `${namespace}:block/fluids/${path}`,
    `${namespace}:block/fluids/${path.replaceAll("_", ".")}`,
    `${namespace}:block/fluid/${path}`,
    `${namespace}:block/${path}_still`,
    `${namespace}:block/${path}`
  ];

  if (path.endsWith("_plasma")) {
    candidates.unshift(`${namespace}:block/fluids/fluid.${path.replace(/_plasma$/, ".plasma")}`);
  }

  return [...new Set(candidates)];
}

function fluidNameCandidates(path) {
  return [
    path,
    path.replaceAll("_", "."),
    `fluid.${path}`,
    `fluid.${path.replaceAll("_", ".")}`,
    `${path}.still`,
    `${path}_still`,
    `fluid.${path}.still`,
    `fluid.${path.replaceAll("_", ".")}.still`
  ];
}

function normalizeFluidName(name) {
  return String(name)
    .toLowerCase()
    .replace(/\.png$/, "")
    .replace(/^fluid[._-]/, "")
    .replace(/[._-]still$/, "")
    .replace(/[._-]flowing$/, "")
    .replace(/[._-]flow$/, "")
    .replace(/[._-]/g, "");
}

function textureRefToWebPath(textureRef) {
  const [namespace, texturePath] = splitResource(textureRef);
  return `${textureRoot}/${namespace}/${texturePath}.png`;
}

function splitResource(value) {
  const separator = String(value).indexOf(":");
  if (separator === -1) return [null, null];
  return [String(value).slice(0, separator), String(value).slice(separator + 1)];
}

function addIndexValue(map, key, value) {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

async function filesUnder(folder) {
  if (!await exists(folder)) return [];

  const entries = await readdir(folder, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(folder, entry.name);
    if (entry.isDirectory()) {
      files.push(...await filesUnder(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function toWebPath(path) {
  return path.split(sep).join("/");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
