import { inflateRawSync } from "node:zlib";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";

const DEFAULT_DATA_FILE = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_OUTPUT_DIR = "assets/textures";
const DEFAULT_MANIFEST_FILE = "data/texture-manifest.local.json";

const args = parseArgs(process.argv.slice(2));
const instanceRoot = args.instance ? resolve(args.instance) : null;
const dataFile = args.data ?? DEFAULT_DATA_FILE;
const outputDir = args.out ?? DEFAULT_OUTPUT_DIR;
const manifestFile = args.manifest ?? DEFAULT_MANIFEST_FILE;

if (!instanceRoot) {
  console.error("Usage: node tools/extract-textures.mjs --instance <modpack instance path>");
  console.error("Example: node tools/extract-textures.mjs --instance \"C:\\\\Users\\\\you\\\\curseforge\\\\minecraft\\\\Instances\\\\GregTech Community Pack Modern\"");
  process.exit(1);
}

const packData = JSON.parse(await readFile(dataFile, "utf-8"));
const goods = packData.goods ?? [];
const minecraftVersion = packData.metadata?.minecraftVersion ?? "1.20.1";
const archives = await discoverArchives(instanceRoot, minecraftVersion);

if (!archives.length) {
  throw new Error(`No jars or resource-pack archives found under ${instanceRoot}`);
}

const modelFiles = new Map();
const textureFiles = new Map();
const archiveSummaries = [];

for (const archivePath of archives) {
  const entries = readZipEntries(await readFile(archivePath));
  let modelCount = 0;
  let textureCount = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (!entry.name.startsWith("assets/")) continue;

    const normalizedName = entry.name.replaceAll("\\", "/");
    if (/^assets\/[^/]+\/models\/.+\.json$/.test(normalizedName)) {
      modelFiles.set(modelIdFromPath(normalizedName), {
        archivePath,
        entry,
        json: JSON.parse(entry.data.toString("utf-8"))
      });
      modelCount += 1;
    } else if (/^assets\/[^/]+\/textures\/.+\.png$/.test(normalizedName)) {
      textureFiles.set(textureRefFromPath(normalizedName), {
        archivePath,
        entry
      });
      textureCount += 1;
    }
  }

  archiveSummaries.push({
    name: basename(archivePath),
    models: modelCount,
    textures: textureCount
  });
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await mkdir(dirname(manifestFile), { recursive: true });

const textures = {};
let extractedCount = 0;

for (const good of goods) {
  const textureRef = findTextureForGood(good.id, modelFiles, textureFiles);
  if (!textureRef) continue;

  const source = textureFiles.get(textureRef);
  if (!source) continue;

  const outputPath = join(outputDir, textureRefToOutputPath(textureRef));
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, source.entry.data);
  textures[good.id] = toWebPath(relative(".", outputPath));
  extractedCount += 1;
}

const manifest = {
  schema: "gtceu-planner-texture-manifest-v1",
  generatedAt: new Date().toISOString(),
  minecraftVersion,
  source: {
    instanceName: basename(instanceRoot),
    archivesScanned: archives.length,
    archiveSummaries,
    goodsScanned: goods.length,
    goodsMatched: Object.keys(textures).length,
    texturesExtracted: extractedCount
  },
  textures
};

await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Scanned ${archives.length} archives.`);
console.log(`Matched ${Object.keys(textures).length} of ${goods.length} goods.`);
console.log(`Wrote ${manifestFile} and ${outputDir}/`);

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

function modelIdFromPath(assetPath) {
  const [, namespace, , ...modelParts] = assetPath.split("/");
  return `${namespace}:${modelParts.join("/").replace(/\.json$/, "")}`;
}

function textureRefFromPath(assetPath) {
  const [, namespace, , ...textureParts] = assetPath.split("/");
  return `${namespace}:${textureParts.join("/").replace(/\.png$/, "")}`;
}

function textureRefToOutputPath(textureRef) {
  const [namespace, texturePath] = splitResource(textureRef);
  return join(namespace, `${texturePath}.png`);
}

function findTextureForGood(goodsId, models, texturesByRef) {
  const [namespace, path] = splitResource(goodsId);
  if (!namespace || !path) return null;

  const itemModel = `${namespace}:item/${path}`;
  const resolvedModel = resolveModelTextures(itemModel, models);
  const fromModel = pickTextureRef(resolvedModel, namespace);
  if (fromModel && texturesByRef.has(fromModel)) return fromModel;

  const directItem = `${namespace}:item/${path}`;
  if (texturesByRef.has(directItem)) return directItem;

  const directBlock = `${namespace}:block/${path}`;
  if (texturesByRef.has(directBlock)) return directBlock;

  return null;
}

function resolveModelTextures(modelId, models, seen = new Set()) {
  if (seen.has(modelId)) return {};
  seen.add(modelId);

  const model = models.get(modelId)?.json;
  if (!model) return {};

  const [namespace] = splitResource(modelId);
  const parentId = model.parent ? normalizeResource(model.parent, namespace) : null;
  const parentTextures = parentId ? resolveModelTextures(parentId, models, seen) : {};
  return {
    ...parentTextures,
    ...(model.textures ?? {})
  };
}

function pickTextureRef(textures, defaultNamespace) {
  const keys = ["layer0", "all", "particle", "front", "side", "top", "bottom", "end"];
  for (const key of keys) {
    const value = resolveTextureVariable(textures[key], textures);
    if (value) return normalizeTextureRef(value, defaultNamespace);
  }

  for (const value of Object.values(textures)) {
    const resolved = resolveTextureVariable(value, textures);
    if (resolved) return normalizeTextureRef(resolved, defaultNamespace);
  }

  return null;
}

function resolveTextureVariable(value, textures, seen = new Set()) {
  if (!value) return null;
  if (!String(value).startsWith("#")) return value;
  const key = String(value).slice(1);
  if (seen.has(key)) return null;
  seen.add(key);
  return resolveTextureVariable(textures[key], textures, seen);
}

function normalizeTextureRef(value, defaultNamespace) {
  return normalizeResource(String(value).replace(/^textures\//, "").replace(/\.png$/, ""), defaultNamespace);
}

function normalizeResource(value, defaultNamespace) {
  return value.includes(":") ? value : `${defaultNamespace}:${value}`;
}

function splitResource(value) {
  const separator = value.indexOf(":");
  if (separator === -1) return [null, null];
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function toWebPath(path) {
  return path.split(sep).join("/");
}
