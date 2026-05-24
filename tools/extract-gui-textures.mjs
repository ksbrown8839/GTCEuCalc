import { inflateRawSync } from "node:zlib";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";

const DEFAULT_DATA_FILE = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_OUTPUT_DIR = "assets/gui";
const DEFAULT_FONT_OUTPUT_DIR = "assets/fonts";
const DEFAULT_MANIFEST_FILE = "data/gui-assets.local.json";
const DEFAULT_NAMESPACES = ["gtceu", "ldlib"];

const VANILLA_GUI_TEXTURES = [
  { id: "minecraft:crafting_table", source: "assets/minecraft/textures/gui/container/crafting_table.png", output: "minecraft/crafting_table.png" },
  { id: "minecraft:widgets", source: "assets/minecraft/textures/gui/widgets.png", output: "minecraft/widgets.png" },
  { id: "minecraft:checkbox", source: "assets/minecraft/textures/gui/checkbox.png", output: "minecraft/checkbox.png" },
  { id: "minecraft:slider", source: "assets/minecraft/textures/gui/slider.png", output: "minecraft/slider.png" },
  { id: "minecraft:options_background", source: "assets/minecraft/textures/gui/options_background.png", output: "minecraft/options_background.png" },
  { id: "minecraft:light_dirt_background", source: "assets/minecraft/textures/gui/light_dirt_background.png", output: "minecraft/light_dirt_background.png" },
  { id: "minecraft:generic_54", source: "assets/minecraft/textures/gui/container/generic_54.png", output: "minecraft/generic_54.png" },
  { id: "minecraft:inventory", source: "assets/minecraft/textures/gui/container/inventory.png", output: "minecraft/inventory.png" },
  { id: "minecraft:furnace", source: "assets/minecraft/textures/gui/container/furnace.png", output: "minecraft/furnace.png" }
];

const FONT_ASSETS = [
  { id: "minecraft:font/default", source: "assets/minecraft/font/default.json", output: "minecraft/default.json" },
  { id: "minecraft:font/include/default", source: "assets/minecraft/font/include/default.json", output: "minecraft/include-default.json" },
  { id: "minecraft:font/ascii", source: "assets/minecraft/textures/font/ascii.png", output: "minecraft/ascii.png" }
];

const args = parseArgs(process.argv.slice(2));
const instanceRoot = args.instance ? resolve(args.instance) : null;
const dataFile = args.data ?? DEFAULT_DATA_FILE;
const outputDir = args.out ?? DEFAULT_OUTPUT_DIR;
const fontOutputDir = args["font-out"] ?? DEFAULT_FONT_OUTPUT_DIR;
const manifestFile = args.manifest ?? DEFAULT_MANIFEST_FILE;
const namespaceFilter = parseNamespaceFilter(args.namespaces ?? DEFAULT_NAMESPACES.join(","));
const includeVanilla = args.vanilla !== false && args.vanilla !== "false";
const includeModGui = args.modGui !== false && args["mod-gui"] !== false && args.modGui !== "false" && args["mod-gui"] !== "false";

if (!instanceRoot) {
  console.error("Usage: node tools/extract-gui-textures.mjs --instance <modpack instance path> [--namespaces gtceu,ldlib|all]");
  process.exit(1);
}

const packData = JSON.parse(await readFile(dataFile, "utf-8"));
const minecraftVersion = packData.metadata?.minecraftVersion ?? "1.20.1";
const archives = await discoverArchives(instanceRoot, minecraftVersion);
const archiveIndexes = [];

for (const archivePath of archives) {
  try {
    archiveIndexes.push(await indexArchive(archivePath));
  } catch (error) {
    console.warn(`Skipping unreadable archive ${archivePath}: ${error.message}`);
  }
}

const manifestAssets = [];
let extractedVanilla = 0;
let extractedFonts = 0;
let extractedModGui = 0;

if (includeVanilla) {
  for (const texture of VANILLA_GUI_TEXTURES) {
    extractedVanilla += await extractNamedAsset(archiveIndexes, texture, outputDir, "GUI texture", manifestAssets);
  }

  for (const asset of FONT_ASSETS) {
    extractedFonts += await extractNamedAsset(archiveIndexes, asset, fontOutputDir, "font asset", null);
  }
}

if (includeModGui) {
  extractedModGui = await extractModGuiAssets(archiveIndexes, namespaceFilter, outputDir, manifestAssets);
}

const manifest = {
  schema: "gtceu-gui-assets-v1",
  generatedAt: new Date().toISOString(),
  packName: packData.metadata?.packName ?? null,
  packVersion: packData.metadata?.packVersion ?? null,
  minecraftVersion,
  instanceRoot,
  outputDir,
  namespaceFilter: namespaceFilter.all ? "all" : [...namespaceFilter.namespaces].sort(),
  counts: {
    vanillaGuiTextures: extractedVanilla,
    fontAssets: extractedFonts,
    modGuiAssets: extractedModGui,
    manifestAssets: manifestAssets.length
  },
  assets: manifestAssets.sort((a, b) => a.id.localeCompare(b.id) || a.output.localeCompare(b.output))
};

await mkdir(dirname(manifestFile), { recursive: true });
await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Extracted ${extractedVanilla} vanilla GUI texture${extractedVanilla === 1 ? "" : "s"}.`);
console.log(`Extracted ${extractedFonts} font asset${extractedFonts === 1 ? "" : "s"}.`);
console.log(`Extracted ${extractedModGui} mod GUI asset${extractedModGui === 1 ? "" : "s"}.`);
console.log(`Wrote ${manifestFile}.`);

async function extractNamedAsset(archiveIndexes, asset, outputRoot, label, manifestAssets) {
  const match = latestEntryForPath(archiveIndexes, asset.source);
  if (!match) {
    console.warn(`Missing ${label}: ${asset.source}`);
    return 0;
  }

  const data = readEntryData(match.archive.buffer, match.entry);
  const outputPath = join(outputRoot, asset.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, data);
  console.log(`${asset.id} -> ${toWebPath(relative(".", outputPath))}`);

  if (manifestAssets && asset.source.endsWith(".png")) {
    manifestAssets.push(assetManifestEntry({
      id: asset.id,
      sourcePath: asset.source,
      outputPath,
      namespace: asset.id.split(":")[0],
      archivePath: match.archive.path,
      data
    }));
  }

  return 1;
}

async function extractModGuiAssets(archiveIndexes, namespaceFilter, outputRoot, manifestAssets) {
  const candidatesByOutput = new Map();

  for (const archive of archiveIndexes) {
    for (const entry of archive.entries) {
      if (entry.isDirectory) continue;

      const match = entry.name.match(/^assets\/([^/]+)\/textures\/gui\/(.+\.(?:png|png\.mcmeta))$/i);
      if (!match) continue;

      const namespace = match[1];
      const relativeGuiPath = match[2];
      if (!namespaceFilter.all && !namespaceFilter.namespaces.has(namespace)) continue;

      const output = join(outputRoot, namespace, relativeGuiPath);
      candidatesByOutput.set(toWebPath(output), { archive, entry, namespace, relativeGuiPath, output });
    }
  }

  let extracted = 0;
  for (const candidate of [...candidatesByOutput.values()].sort((a, b) => toWebPath(a.output).localeCompare(toWebPath(b.output)))) {
    const data = readEntryData(candidate.archive.buffer, candidate.entry);
    await mkdir(dirname(candidate.output), { recursive: true });
    await writeFile(candidate.output, data);
    extracted += 1;

    if (candidate.relativeGuiPath.endsWith(".png")) {
      manifestAssets.push(assetManifestEntry({
        id: `${candidate.namespace}:gui/${candidate.relativeGuiPath.replace(/\.png$/i, "")}`,
        sourcePath: candidate.entry.name,
        outputPath: candidate.output,
        namespace: candidate.namespace,
        archivePath: candidate.archive.path,
        data
      }));
    }
  }

  return extracted;
}

function assetManifestEntry({ id, sourcePath, outputPath, namespace, archivePath, data }) {
  const dimensions = pngDimensions(data);
  return {
    id,
    namespace,
    sourcePath,
    output: toWebPath(relative(".", outputPath)),
    archive: basename(archivePath),
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null
  };
}

function latestEntryForPath(archiveIndexes, sourcePath) {
  let latest = null;
  for (const archive of archiveIndexes) {
    const entry = archive.entryByName.get(sourcePath);
    if (entry) latest = { archive, entry };
  }
  return latest;
}

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

function parseNamespaceFilter(value) {
  if (value === true || String(value).trim().toLowerCase() === "all") return { all: true, namespaces: new Set() };
  return {
    all: false,
    namespaces: new Set(String(value).split(",").map((entry) => entry.trim()).filter(Boolean))
  };
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
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

async function filesIn(folder, extensions) {
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && extensions.some((extension) => entry.name.toLowerCase().endsWith(extension)))
      .map((entry) => join(folder, entry.name))
      .sort((a, b) => basename(a).localeCompare(basename(b)));
  } catch {
    return [];
  }
}

async function indexArchive(archivePath) {
  const buffer = await readFile(archivePath);
  const entries = readZipEntries(buffer);
  const entryByName = new Map(entries.map((entry) => [entry.name, entry]));
  return { path: archivePath, buffer, entries, entryByName };
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

    entries.push({
      name,
      isDirectory: name.endsWith("/"),
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });

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

function readEntryData(buffer, entry) {
  if (buffer.readUInt32LE(entry.localHeaderOffset) !== 0x04034b50) {
    throw new Error("Invalid zip local file header.");
  }

  const fileNameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) return Buffer.from(compressed);
  if (entry.method === 8) {
    const inflated = inflateRawSync(compressed);
    if (inflated.length !== entry.uncompressedSize) throw new Error("Inflated zip entry size mismatch.");
    return inflated;
  }

  throw new Error(`Unsupported zip compression method ${entry.method}.`);
}

function pngDimensions(data) {
  if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20)
  };
}

function toWebPath(path) {
  return path.split(sep).join("/");
}
