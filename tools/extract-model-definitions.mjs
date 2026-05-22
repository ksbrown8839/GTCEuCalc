import { inflateRawSync } from "node:zlib";
import { basename, join, resolve } from "node:path";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";

const DEFAULT_SOURCE_MANIFEST_FILE = "data/texture-manifest.local.json";
const DEFAULT_OUTPUT_FILE = "data/model-definitions.local.json";

const args = parseArgs(process.argv.slice(2));
const instanceRoot = args.instance ? resolve(args.instance) : null;
const sourceManifestFile = args.source ?? DEFAULT_SOURCE_MANIFEST_FILE;
const outputFile = args.out ?? DEFAULT_OUTPUT_FILE;

if (!instanceRoot) {
  console.error("Usage: node tools/extract-model-definitions.mjs --instance <modpack instance path>");
  console.error("Example: node tools/extract-model-definitions.mjs --instance \"C:\\\\Users\\\\you\\\\curseforge\\\\minecraft\\\\Instances\\\\GregTech Community Pack Modern\"");
  process.exit(1);
}

const sourceManifest = JSON.parse(await readFile(sourceManifestFile, "utf-8"));
const minecraftVersion = sourceManifest.minecraftVersion ?? "1.20.1";
const archives = await discoverArchives(instanceRoot, minecraftVersion);
const models = new Map();

for (const archivePath of archives) {
  const entries = readZipEntries(await readFile(archivePath));
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (!entry.name.startsWith("assets/")) continue;
    const normalizedName = entry.name.replaceAll("\\", "/");
    if (/^assets\/[^/]+\/models\/.+\.json$/.test(normalizedName)) {
      models.set(modelIdFromPath(normalizedName), JSON.parse(entry.data.toString("utf-8")));
    }
  }
}

await scanLooseAssetRoot(join(instanceRoot, "kubejs", "assets"), models);

const requestedModelIds = [...new Set(Object.values(sourceManifest.icons ?? {})
  .map((icon) => icon.model)
  .filter(Boolean))]
  .sort((a, b) => a.localeCompare(b));

const modelDefinitions = {};
const unresolved = [];

for (const modelId of requestedModelIds) {
  const definition = resolveModelDefinition(modelId, models);
  if (definition.elements.length) {
    modelDefinitions[modelId] = definition;
  } else {
    unresolved.push(modelId);
  }
}

const output = {
  schema: "gtceu-planner-model-definitions-v1",
  generatedAt: new Date().toISOString(),
  source: {
    instanceName: basename(instanceRoot),
    sourceManifest: sourceManifestFile,
    archivesScanned: archives.length,
    modelsScanned: models.size,
    modelsRequested: requestedModelIds.length,
    modelsResolved: Object.keys(modelDefinitions).length,
    modelsUnresolved: unresolved.length
  },
  unresolved,
  models: modelDefinitions
};

await mkdir("data", { recursive: true });
await writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Resolved ${Object.keys(modelDefinitions).length} of ${requestedModelIds.length} requested models.`);
console.log(`Wrote ${outputFile}.`);

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

async function scanLooseAssetRoot(root, models) {
  if (!await exists(root)) return;
  const files = await filesUnder(root);
  for (const filePath of files) {
    const webPath = filePath.split("\\").join("/");
    const marker = "/assets/";
    const index = webPath.indexOf(marker);
    if (index === -1) continue;
    const assetPath = `assets/${webPath.slice(index + marker.length)}`;
    if (/^assets\/[^/]+\/models\/.+\.json$/.test(assetPath)) {
      models.set(modelIdFromPath(assetPath), JSON.parse((await readFile(filePath)).toString("utf-8")));
    }
  }
}

async function filesUnder(folder) {
  if (!await exists(folder)) return [];
  const entries = await readdir(folder, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = join(folder, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(entryPath));
    if (entry.isFile()) files.push(entryPath);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function readZipEntries(buffer) {
  const entries = [];
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const end = offset + centralDirectorySize;

  while (offset < end) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid zip central directory.");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf-8", offset + 46, offset + 46 + fileNameLength);
    const data = readLocalZipData(buffer, localHeaderOffset, method, compressedSize, uncompressedSize);
    entries.push({ name, isDirectory: name.endsWith("/"), data });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Could not find zip end-of-central-directory record.");
}

function readLocalZipData(buffer, localHeaderOffset, method, compressedSize, uncompressedSize) {
  if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) throw new Error("Invalid zip local file header.");
  const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
  if (method === 0) return Buffer.from(compressed);
  if (method === 8) {
    const inflated = inflateRawSync(compressed);
    if (inflated.length !== uncompressedSize) throw new Error("Inflated zip entry size mismatch.");
    return inflated;
  }
  throw new Error(`Unsupported zip compression method ${method}.`);
}

function modelIdFromPath(assetPath) {
  const [, namespace, , ...modelParts] = assetPath.split("/");
  return `${namespace}:${modelParts.join("/").replace(/\.json$/, "")}`;
}

function resolveModelDefinition(modelId, models, seen = new Set()) {
  if (seen.has(modelId)) return emptyDefinition(modelId);
  seen.add(modelId);

  const model = models.get(modelId);
  if (!model) return emptyDefinition(modelId);

  const [namespace] = splitResource(modelId);
  const parentId = model.parent ? normalizeResource(model.parent, namespace) : null;
  const parent = parentId ? resolveModelDefinition(parentId, models, seen) : emptyDefinition(null);
  const textures = {
    ...(parent.textures ?? {}),
    ...(model.textures ?? {})
  };
  const sourceElements = Array.isArray(model.elements) ? model.elements : parent.elements;
  const elements = normalizeElements(sourceElements ?? [], textures);

  return {
    model: modelId,
    parent: parentId,
    textures,
    elements
  };
}

function emptyDefinition(modelId) {
  return {
    model: modelId,
    parent: null,
    textures: {},
    elements: []
  };
}

function normalizeElements(elements, textures) {
  return elements
    .map((element) => {
      const faces = {};
      for (const [faceName, face] of Object.entries(element.faces ?? {})) {
        const textureKey = textureKeyForFace(face.texture, textures);
        if (!textureKey) continue;
        faces[faceName] = {
          texture: textureKey,
          uv: face.uv ?? defaultUvForFace(faceName, element.from, element.to),
          rotation: face.rotation ?? 0
        };
      }

      return {
        from: element.from ?? [0, 0, 0],
        to: element.to ?? [16, 16, 16],
        rotation: element.rotation ?? null,
        shade: element.shade ?? true,
        faces
      };
    })
    .filter((element) => Object.keys(element.faces).length > 0);
}

function textureKeyForFace(value, textures, seen = new Set()) {
  if (!value) return null;
  if (!String(value).startsWith("#")) return "primary";
  const key = String(value).slice(1);
  if (seen.has(key)) return null;
  seen.add(key);
  const target = textures[key];
  if (!target) return key;
  if (String(target).startsWith("#")) return textureKeyForFace(target, textures, seen);
  return key;
}

function defaultUvForFace(faceName, from = [0, 0, 0], to = [16, 16, 16]) {
  const [x1, y1, z1] = from;
  const [x2, y2, z2] = to;
  switch (faceName) {
    case "up":
    case "down":
      return [x1, z1, x2, z2];
    case "north":
    case "south":
      return [x1, 16 - y2, x2, 16 - y1];
    case "east":
    case "west":
      return [z1, 16 - y2, z2, 16 - y1];
    default:
      return [0, 0, 16, 16];
  }
}

function normalizeResource(value, defaultNamespace) {
  return value.includes(":") ? value : `${defaultNamespace}:${value}`;
}

function splitResource(value) {
  const separator = value.indexOf(":");
  if (separator === -1) return [null, null];
  return [value.slice(0, separator), value.slice(separator + 1)];
}
