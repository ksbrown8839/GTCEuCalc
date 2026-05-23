import { inflateRawSync } from "node:zlib";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";

const DEFAULT_DATA_FILE = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_OUTPUT_DIR = "assets/gui";
const DEFAULT_FONT_OUTPUT_DIR = "assets/fonts";

const GUI_TEXTURES = [
  {
    id: "minecraft:crafting_table",
    source: "assets/minecraft/textures/gui/container/crafting_table.png",
    output: "minecraft/crafting_table.png"
  },
  {
    id: "minecraft:widgets",
    source: "assets/minecraft/textures/gui/widgets.png",
    output: "minecraft/widgets.png"
  },
  {
    id: "minecraft:checkbox",
    source: "assets/minecraft/textures/gui/checkbox.png",
    output: "minecraft/checkbox.png"
  },
  {
    id: "minecraft:slider",
    source: "assets/minecraft/textures/gui/slider.png",
    output: "minecraft/slider.png"
  },
  {
    id: "minecraft:options_background",
    source: "assets/minecraft/textures/gui/options_background.png",
    output: "minecraft/options_background.png"
  },
  {
    id: "minecraft:light_dirt_background",
    source: "assets/minecraft/textures/gui/light_dirt_background.png",
    output: "minecraft/light_dirt_background.png"
  },
  {
    id: "minecraft:generic_54",
    source: "assets/minecraft/textures/gui/container/generic_54.png",
    output: "minecraft/generic_54.png"
  },
  {
    id: "minecraft:inventory",
    source: "assets/minecraft/textures/gui/container/inventory.png",
    output: "minecraft/inventory.png"
  },
  {
    id: "minecraft:furnace",
    source: "assets/minecraft/textures/gui/container/furnace.png",
    output: "minecraft/furnace.png"
  }
];

const FONT_ASSETS = [
  {
    id: "minecraft:font/default",
    source: "assets/minecraft/font/default.json",
    output: "minecraft/default.json"
  },
  {
    id: "minecraft:font/include/default",
    source: "assets/minecraft/font/include/default.json",
    output: "minecraft/include-default.json"
  },
  {
    id: "minecraft:font/ascii",
    source: "assets/minecraft/textures/font/ascii.png",
    output: "minecraft/ascii.png"
  }
];

const args = parseArgs(process.argv.slice(2));
const instanceRoot = args.instance ? resolve(args.instance) : null;
const dataFile = args.data ?? DEFAULT_DATA_FILE;
const outputDir = args.out ?? DEFAULT_OUTPUT_DIR;
const fontOutputDir = args["font-out"] ?? DEFAULT_FONT_OUTPUT_DIR;

if (!instanceRoot) {
  console.error("Usage: node tools/extract-gui-textures.mjs --instance <modpack instance path>");
  process.exit(1);
}

const packData = JSON.parse(await readFile(dataFile, "utf-8"));
const minecraftVersion = packData.metadata?.minecraftVersion ?? "1.20.1";
const archives = await discoverArchives(instanceRoot, minecraftVersion);
let extracted = 0;

for (const texture of GUI_TEXTURES) {
  extracted += await extractAsset(archives, texture, outputDir, "GUI texture");
}

let extractedFonts = 0;

for (const asset of FONT_ASSETS) {
  extractedFonts += await extractAsset(archives, asset, fontOutputDir, "font asset");
}

console.log(`Extracted ${extracted} GUI texture${extracted === 1 ? "" : "s"} and ${extractedFonts} font asset${extractedFonts === 1 ? "" : "s"}.`);

async function extractAsset(archives, asset, outputRoot, label) {
  const entry = await findZipEntry(archives, asset.source);
  if (!entry) {
    console.warn(`Missing ${label}: ${asset.source}`);
    return 0;
  }

  const outputPath = join(outputRoot, asset.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, entry.data);
  console.log(`${asset.id} -> ${toWebPath(relative(".", outputPath))}`);
  return 1;
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

async function discoverArchives(root, minecraftVersion) {
  const archives = [];
  const vanillaJar = resolve(root, "..", "..", "Install", "versions", minecraftVersion, `${minecraftVersion}.jar`);
  if (await exists(vanillaJar)) archives.push(vanillaJar);
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

async function findZipEntry(archives, wantedName) {
  for (const archivePath of archives) {
    const entries = readZipEntries(await readFile(archivePath));
    const match = entries.find((entry) => entry.name === wantedName);
    if (match) return match;
  }
  return null;
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
      data: name.endsWith("/") ? null : readLocalZipData(buffer, localHeaderOffset, method, compressedSize, uncompressedSize)
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
    if (inflated.length !== uncompressedSize) throw new Error("Inflated zip entry size mismatch.");
    return inflated;
  }

  throw new Error(`Unsupported zip compression method ${method}.`);
}

function toWebPath(path) {
  return path.split(sep).join("/");
}
