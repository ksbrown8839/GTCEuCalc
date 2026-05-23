import { access, readFile, writeFile } from "node:fs/promises";

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
  const preferred = await findPreferredFluidTexture(good.id, textureRoot);
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
  fluidGoods,
  preferredFluidTextures,
  missingFluidTextures
};

await writeFile(outputFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${outputFile}`);
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

async function findPreferredFluidTexture(goodId, textureRoot) {
  const [namespace, path] = splitResource(goodId);
  if (!namespace || !path) return null;

  const candidates = fluidTextureCandidates(namespace, path).map((textureRef) => ({
    textureRef,
    webPath: textureRefToWebPath(textureRef, textureRoot)
  }));

  for (const candidate of candidates) {
    if (await exists(candidate.webPath)) return candidate.webPath;
  }

  return null;
}

function fluidTextureCandidates(namespace, path) {
  const candidates = [
    `${namespace}:block/fluids/fluid.${path}`,
    `${namespace}:block/fluids/${path}`,
    `${namespace}:block/fluid/${path}`,
    `${namespace}:block/${path}_still`,
    `${namespace}:block/${path}`
  ];

  if (path.endsWith("_plasma")) {
    candidates.unshift(`${namespace}:block/fluids/fluid.${path.replace(/_plasma$/, ".plasma")}`);
  }

  return [...new Set(candidates)];
}

function textureRefToWebPath(textureRef, textureRoot) {
  const [namespace, texturePath] = splitResource(textureRef);
  return `${textureRoot}/${namespace}/${texturePath}.png`;
}

function splitResource(value) {
  const separator = String(value).indexOf(":");
  if (separator === -1) return [null, null];
  return [String(value).slice(0, separator), String(value).slice(separator + 1)];
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
