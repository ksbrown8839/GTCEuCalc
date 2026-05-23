import { inflateRawSync } from "node:zlib";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";

const DEFAULT_DATA_FILE = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_SOURCE_MANIFEST_FILE = "data/texture-manifest.rendered.local.json";
const FALLBACK_SOURCE_MANIFEST_FILE = "data/texture-manifest.local.json";
const DEFAULT_COLORS_FILE = "data/fluid-colors.local.json";
const DEFAULT_OUTPUT_FILE = "data/texture-manifest.fluid-base.local.json";
const DEFAULT_TEXTURE_ROOT = "assets/textures";

const args = parseArgs(process.argv.slice(2));
const instanceRoot = args.instance ? resolve(args.instance) : null;
const dataFile = args.data ?? DEFAULT_DATA_FILE;
const sourceManifestFile = args.source ?? (await exists(DEFAULT_SOURCE_MANIFEST_FILE) ? DEFAULT_SOURCE_MANIFEST_FILE : FALLBACK_SOURCE_MANIFEST_FILE);
const colorsFile = args.colors ?? DEFAULT_COLORS_FILE;
const outputFile = args.out ?? DEFAULT_OUTPUT_FILE;
const textureRoot = args.textures ?? DEFAULT_TEXTURE_ROOT;

if (!instanceRoot) {
  console.error("Usage: node tools/apply-fluid-base-textures.mjs --instance <modpack instance path>");
  process.exit(1);
}

const packData = JSON.parse(await readFile(dataFile, "utf-8"));
const sourceManifest = JSON.parse(await readFile(sourceManifestFile, "utf-8"));
const fluidColorManifest = JSON.parse(await readFile(colorsFile, "utf-8"));
const minecraftVersion = packData.metadata?.minecraftVersion ?? "1.20.1";

if (sourceManifest.schema !== "gtceu-planner-texture-manifest-v1") {
  throw new Error(`Unsupported texture source manifest schema: ${sourceManifest.schema}`);
}

if (fluidColorManifest.schema !== "gtceu-fluid-colors-v1") {
  throw new Error(`Unsupported fluid color manifest schema: ${fluidColorManifest.schema}`);
}

const archives = await discoverArchives(instanceRoot, minecraftVersion);
const textureFiles = new Map();
const archiveSummaries = [];

for (const archivePath of archives) {
  const entries = readZipEntries(await readFile(archivePath));
  let textureCount = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const normalizedName = entry.name.replaceAll("\\", "/");
    if (/^assets\/[^/]+\/textures\/.+\.png$/.test(normalizedName)) {
      textureFiles.set(textureRefFromPath(normalizedName), { archivePath, entry });
      textureCount += 1;
    }
  }

  archiveSummaries.push({ name: basename(archivePath), textures: textureCount });
}

const looseSummary = await scanLooseAssetRoot(join(instanceRoot, "kubejs", "assets"), textureFiles);
if (looseSummary) archiveSummaries.push(looseSummary);

const fluidInfoById = buildFluidInfoLookup(fluidColorManifest.fluids ?? {});
const manifest = structuredClone(sourceManifest);
manifest.textures ??= {};
manifest.icons ??= {};
manifest.source ??= {};

const extractedTextureRefs = new Map();
let fluidGoods = 0;
let dedicatedTextureFluids = 0;
let baseTextureFluids = 0;
let baseTextureChanged = 0;
let missingBaseTexture = 0;

for (const good of packData.goods ?? []) {
  if (good.kind !== "fluid") continue;
  fluidGoods += 1;

  const currentTexture = primaryTextureForGood(good, manifest);
  if (isDedicatedFluidTexture(currentTexture)) {
    dedicatedTextureFluids += 1;
    continue;
  }

  const fluidInfo = fluidInfoForGood(good.id, fluidInfoById);
  const baseTextureRef = firstExistingTexture(baseTextureCandidates(fluidInfo), textureFiles);
  if (!baseTextureRef) {
    missingBaseTexture += 1;
    continue;
  }

  const baseTexturePath = await extractTextureRef(baseTextureRef, textureFiles, textureRoot, extractedTextureRefs);
  if (!baseTexturePath) {
    missingBaseTexture += 1;
    continue;
  }

  baseTextureFluids += 1;
  if (baseTexturePath !== currentTexture) baseTextureChanged += 1;

  manifest.textures[good.id] = baseTexturePath;
  manifest.icons[good.id] = {
    kind: "fluid",
    primary: baseTexturePath,
    textures: {
      primary: baseTexturePath,
      layer0: baseTexturePath
    }
  };
}

manifest.generatedAt = new Date().toISOString();
manifest.source.fluidBaseTexturePreference = {
  sourceManifest: sourceManifestFile,
  fluidColors: colorsFile,
  textureRoot,
  archivesScanned: archives.length,
  archiveSummaries,
  fluidGoods,
  dedicatedTextureFluids,
  baseTextureFluids,
  baseTextureChanged,
  missingBaseTexture,
  texturesExtracted: extractedTextureRefs.size
};

await mkdir(dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Wrote ${outputFile}`);
console.log(`Fluid goods: ${fluidGoods}`);
console.log(`Dedicated/baked fluid textures kept: ${dedicatedTextureFluids}`);
console.log(`Template/base fluid textures assigned: ${baseTextureFluids}`);
console.log(`Template/base fluid textures changed: ${baseTextureChanged}`);
console.log(`Missing exported base textures: ${missingBaseTexture}`);
console.log(`Base textures extracted: ${extractedTextureRefs.size}`);

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

async function discoverArchives(root, minecraftVersion) {
  const archives = [];
  const vanillaJar = resolve(root, "..", "..", "Install", "versions", minecraftVersion, `${minecraftVersion}.jar`);
  if (await exists(vanillaJar)) archives.push(vanillaJar);

  archives.push(...await filesIn(join(root, "mods"), [".jar"]));
  archives.push(...await filesIn(join(root, "resourcepacks"), [".zip"]));

  return archives;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function filesIn(folder, extensions) {
  if (!await exists(folder)) return [];
  const entries = await readdir(folder, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && extensions.some((extension) => entry.name.toLowerCase().endsWith(extension)))
    .map((entry) => join(folder, entry.name))
    .sort((a, b) => basename(a).localeCompare(basename(b)));
}

async function scanLooseAssetRoot(root, textureFiles) {
  if (!await exists(root)) return null;

  const files = await filesUnder(root);
  let textureCount = 0;

  for (const filePath of files) {
    const relativePath = toWebPath(relative(root, filePath));
    const assetPath = `assets/${relativePath}`;
    const data = await readFile(filePath);

    if (/^assets\/[^/]+\/textures\/.+\.png$/.test(assetPath)) {
      textureFiles.set(textureRefFromPath(assetPath), {
        archivePath: root,
        entry: { name: assetPath, data }
      });
      textureCount += 1;
    }
  }

  return { name: "kubejs/assets", textures: textureCount };
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

async function extractTextureRef(textureRef, textureFiles, outputDir, extractedTextureRefs) {
  if (!textureRef || !textureFiles.has(textureRef)) return null;
  const cached = extractedTextureRefs.get(textureRef);
  if (cached) return cached;

  const source = textureFiles.get(textureRef);
  const outputPath = join(outputDir, textureRefToOutputPath(textureRef));
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, source.entry.data);

  const webPath = toWebPath(relative(".", outputPath));
  extractedTextureRefs.set(textureRef, webPath);
  return webPath;
}

function primaryTextureForGood(good, manifest) {
  const manifestIcon = manifest.icons?.[good.id];
  return manifestIcon?.primary ?? manifest.textures?.[good.id] ?? null;
}

function isDedicatedFluidTexture(texturePath) {
  if (typeof texturePath !== "string") return false;
  const normalized = texturePath.replaceAll("\\", "/");
  return normalized.includes("/block/fluids/") || normalized.includes("/block/fluid/");
}

function baseTextureCandidates(fluidInfo) {
  if (!fluidInfo) return [];
  return [fluidInfo.stillTexture, fluidInfo.flowingTexture]
    .map(normalizeTextureRef)
    .filter(Boolean);
}

function buildFluidInfoLookup(fluids) {
  const lookup = new Map();

  for (const [fluidId, entry] of Object.entries(fluids)) {
    const info = {
      stillTexture: entry?.stillTexture ?? null,
      flowingTexture: entry?.flowingTexture ?? null
    };

    for (const candidate of fluidIdCandidates(fluidId)) {
      addLookupValue(lookup, candidate, info);
    }
  }

  return lookup;
}

function fluidInfoForGood(goodId, lookup) {
  for (const candidate of fluidIdCandidates(goodId)) {
    const info = lookup.get(candidate);
    if (info) return info;
  }
  return null;
}

function fluidIdCandidates(fluidId) {
  const candidates = new Set([fluidId]);
  const [namespace, path] = splitResource(fluidId);
  if (!namespace || !path) return [...candidates];

  candidates.add(`${namespace}:${stripFluidVariantPrefix(path)}`);
  candidates.add(`${namespace}:${stripFluidVariantSuffix(path)}`);
  candidates.add(`${namespace}:fluid.${path.replaceAll("_", ".")}`);
  candidates.add(`${namespace}:fluid.${path}`);

  if (path.startsWith("fluid.")) {
    candidates.add(`${namespace}:${path.slice("fluid.".length).replaceAll(".", "_")}`);
  }

  if (namespace === "gtceu") {
    candidates.add(`gtceu:${path.replaceAll(".", "_")}`);
  }

  return [...candidates];
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

function addLookupValue(lookup, id, value) {
  if (!id || lookup.has(id)) return;
  lookup.set(id, value);
}

function firstExistingTexture(candidates, textureFiles) {
  return candidates.find((candidate) => textureFiles.has(candidate)) ?? null;
}

function normalizeTextureRef(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim()
    .replaceAll("\\", "/")
    .replace(/^assets\/([^/]+)\/textures\//, "$1:")
    .replace(/\.png$/i, "");

  if (!normalized.includes(":")) return null;
  return normalized;
}

function textureRefFromPath(assetPath) {
  const [, namespace, , ...textureParts] = assetPath.split("/");
  return `${namespace}:${textureParts.join("/").replace(/\.png$/, "")}`;
}

function textureRefToOutputPath(textureRef) {
  const [namespace, texturePath] = splitResource(textureRef);
  return join(namespace, `${texturePath}.png`);
}

function splitResource(value) {
  const separator = String(value).indexOf(":");
  if (separator === -1) return [null, null];
  return [String(value).slice(0, separator), String(value).slice(separator + 1)];
}

function readZipEntries(buffer) {
  const entries = [];
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const end = offset + centralDirectorySize;

  while (offset < end) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Invalid zip central directory.");
    }

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf-8", offset + 46, offset + 46 + fileNameLength);
    const data = readLocalZipData(buffer, localHeaderOffset, method, compressedSize, uncompressedSize);

    entries.push({
      name,
      isDirectory: name.endsWith("/"),
      data
    });

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("Could not find zip end-of-central-directory record.");
}

function readLocalZipData(buffer, localHeaderOffset, method, compressedSize, uncompressedSize) {
  if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
    throw new Error("Invalid zip local file header.");
  }

  const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

  if (method === 0) return Buffer.from(compressed);
  if (method === 8) {
    const inflated = inflateRawSync(compressed);
    if (inflated.length !== uncompressedSize) {
      throw new Error("Inflated zip entry size mismatch.");
    }
    return inflated;
  }

  throw new Error(`Unsupported zip compression method ${method}.`);
}

function toWebPath(path) {
  return path.split(sep).join("/");
}
