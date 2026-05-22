import { inflateRawSync } from "node:zlib";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";

const DEFAULT_DATA_FILE = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_OUTPUT_DIR = "assets/textures";
const DEFAULT_MANIFEST_FILE = "data/texture-manifest.local.json";

const GTCEU_MATERIAL_SETS = [
  "dull",
  "metallic",
  "shiny",
  "bright",
  "magnetic",
  "fine",
  "rough",
  "gem_horizontal",
  "gem_vertical",
  "diamond",
  "emerald",
  "lapis",
  "lignite",
  "quartz",
  "radioactive",
  "certus",
  "flint",
  "opal",
  "paper",
  "powder",
  "wood",
  "glass",
  "netherstar"
];

const GTCEU_GEM_MATERIAL_SETS = [
  "gem_horizontal",
  "gem_vertical",
  "dull",
  "diamond",
  "emerald",
  "lapis",
  "lignite",
  "quartz",
  "certus",
  "flint",
  "opal"
];

const GTCEU_MATERIAL_ITEM_FORMS = [
  "tool_head_wire_cutter",
  "tool_head_screwdriver",
  "tool_head_chainsaw",
  "tool_head_buzz_saw",
  "tool_head_pickaxe",
  "tool_head_hammer",
  "tool_head_wrench",
  "tool_head_shovel",
  "tool_head_mallet",
  "tool_head_scythe",
  "tool_head_sword",
  "tool_head_drill",
  "tool_head_file",
  "tool_head_axe",
  "tool_head_saw",
  "tool_head_hoe",
  "crushed_purified",
  "crushed_refined",
  "gem_exquisite",
  "gem_flawless",
  "gem_chipped",
  "gem_flawed",
  "ingot_double",
  "plate_double",
  "plate_dense",
  "dust_impure",
  "dust_small",
  "dust_tiny",
  "dust_pure",
  "ingot_hot",
  "gear_small",
  "rod_long",
  "spring_small",
  "turbine_blade",
  "wire_fine",
  "raw_ore",
  "crushed",
  "nugget",
  "ingot",
  "plate",
  "dust",
  "foil",
  "gear",
  "gem",
  "lens",
  "ring",
  "rotor",
  "round",
  "screw",
  "spring",
  "bolt",
  "rod"
];

const GTCEU_TOOL_SUFFIXES = [
  "butchery_knife",
  "mining_hammer",
  "wire_cutter",
  "screwdriver",
  "pickaxe",
  "chainsaw",
  "buzzsaw",
  "crowbar",
  "hammer",
  "mallet",
  "mortar",
  "plunger",
  "scythe",
  "shovel",
  "spade",
  "sword",
  "knife",
  "drill",
  "file",
  "axe",
  "hoe",
  "saw",
  "wrench"
];

const GTCEU_TOOL_HEAD_SUFFIXES = [
  ["buzz_saw_blade", "tool_head_buzz_saw"],
  ["chainsaw_head", "tool_head_chainsaw"],
  ["wire_cutter_head", "tool_head_wire_cutter"],
  ["screwdriver_tip", "tool_head_screwdriver"],
  ["wrench_tip", "tool_head_wrench"],
  ["drill_head", "tool_head_drill"]
];

const GTCEU_SPECIAL_TEXTURES = {
  construction_core: "gtceu:block/multiblock/implosion_compressor/overlay_front",
  facade_cover: "minecraft:block/stone",
  greenhouse: "gtceu:block/multiblock/implosion_compressor/overlay_front"
};

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

const kubejsAssetsSummary = await scanLooseAssetRoot(join(instanceRoot, "kubejs", "assets"), modelFiles, textureFiles);
if (kubejsAssetsSummary) archiveSummaries.push(kubejsAssetsSummary);

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await mkdir(dirname(manifestFile), { recursive: true });

const textures = {};
let extractedCount = 0;

for (const good of goods) {
  const textureRef = findTextureForGood(good, modelFiles, textureFiles);
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

async function scanLooseAssetRoot(root, modelFiles, textureFiles) {
  if (!await exists(root)) return null;

  const files = await filesUnder(root);
  let modelCount = 0;
  let textureCount = 0;

  for (const filePath of files) {
    const relativePath = toWebPath(relative(root, filePath));
    const assetPath = `assets/${relativePath}`;
    const data = await readFile(filePath);

    if (/^assets\/[^/]+\/models\/.+\.json$/.test(assetPath)) {
      modelFiles.set(modelIdFromPath(assetPath), {
        archivePath: root,
        entry: { name: assetPath, data },
        json: JSON.parse(data.toString("utf-8"))
      });
      modelCount += 1;
    } else if (/^assets\/[^/]+\/textures\/.+\.png$/.test(assetPath)) {
      textureFiles.set(textureRefFromPath(assetPath), {
        archivePath: root,
        entry: { name: assetPath, data }
      });
      textureCount += 1;
    }
  }

  return {
    name: "kubejs/assets",
    models: modelCount,
    textures: textureCount
  };
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

function findTextureForGood(good, models, texturesByRef) {
  const goodsId = good.id;
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

  const blockModelTexture = firstTextureFromModels([
    `${namespace}:block/${path}`,
    `${namespace}:block/machine/${path}`
  ], models, texturesByRef);
  if (blockModelTexture) return blockModelTexture;

  if (good.kind === "fluid") {
    const fluidTexture = findFluidTexture(namespace, path, texturesByRef);
    if (fluidTexture) return fluidTexture;
  }

  if (namespace === "gtceu") {
    const generatedTexture = findGtceuGeneratedTexture(path, good.kind, models, texturesByRef);
    if (generatedTexture) return generatedTexture;
  }

  return null;
}

function findFluidTexture(namespace, path, texturesByRef) {
  const candidates = [
    `${namespace}:block/fluids/fluid.${path}`,
    `${namespace}:block/fluids/${path}`,
    `${namespace}:block/${path}_still`,
    `${namespace}:block/${path}_flow`,
    `${namespace}:block/${path}`,
    `${namespace}:item/${path}`
  ];

  if (path.endsWith("_plasma")) {
    candidates.unshift(`${namespace}:block/fluids/fluid.${path.replace(/_plasma$/, ".plasma")}`);
  }

  return firstExistingTexture(candidates, texturesByRef);
}

function findGtceuGeneratedTexture(path, kind, models, texturesByRef) {
  const specialTexture = GTCEU_SPECIAL_TEXTURES[path];
  if (specialTexture && texturesByRef.has(specialTexture)) return specialTexture;

  if (kind === "fluid") {
    return firstExistingTexture([
      "gtceu:block/material_sets/fluid/liquid",
      "gtceu:block/material_sets/dull/liquid",
      "gtceu:block/material_sets/dull/gas",
      "gtceu:block/material_sets/dull/molten",
      "gtceu:block/material_sets/dull/plasma"
    ], texturesByRef);
  }

  const materialForm = findMaterialForm(path);
  if (materialForm) {
    const texture = textureFromMaterialForm(materialForm, models, texturesByRef);
    if (texture) return texture;
  }

  const toolHeadForm = findToolHeadForm(path);
  if (toolHeadForm) {
    const texture = textureFromMaterialForm(toolHeadForm, models, texturesByRef);
    if (texture) return texture;
  }

  const armorTexture = findArmorTexture(path, models, texturesByRef);
  if (armorTexture) return armorTexture;

  const toolTexture = findToolTexture(path, models, texturesByRef);
  if (toolTexture) return toolTexture;

  const blockTexture = findGtceuBlockLikeTexture(path, models, texturesByRef);
  if (blockTexture) return blockTexture;

  const conduitTexture = findGtceuConduitTexture(path, texturesByRef);
  if (conduitTexture) return conduitTexture;

  return null;
}

function findMaterialForm(path) {
  if (path.startsWith("raw_")) return "raw_ore";
  if (path.startsWith("fine_") && path.endsWith("_wire")) return "wire_fine";
  return GTCEU_MATERIAL_ITEM_FORMS.find((form) => path === form || path.endsWith(`_${form}`)) ?? null;
}

function findToolHeadForm(path) {
  const match = GTCEU_TOOL_HEAD_SUFFIXES.find(([suffix]) => path.endsWith(`_${suffix}`));
  return match?.[1] ?? null;
}

function findArmorTexture(path, models, texturesByRef) {
  const match = path.match(/_(boots|chestplate|helmet|leggings)$/);
  if (!match) return null;
  const modelId = `gtceu:item/armor/${match[1]}`;
  return firstTextureFromModels([modelId], models, texturesByRef)
    ?? firstExistingTexture([modelId], texturesByRef);
}

function textureFromMaterialForm(form, models, texturesByRef) {
  const materialSets = form.startsWith("gem") || form === "lens"
    ? GTCEU_GEM_MATERIAL_SETS
    : GTCEU_MATERIAL_SETS;
  const modelIds = materialSets.map((set) => `gtceu:item/material_sets/${set}/${form}`);
  return firstTextureFromModels(modelIds, models, texturesByRef);
}

function findToolTexture(path, models, texturesByRef) {
  const suffix = GTCEU_TOOL_SUFFIXES.find((candidate) => path.endsWith(`_${candidate}`));
  if (!suffix) return null;

  return firstTextureFromModels([`gtceu:item/tools/${suffix}`], models, texturesByRef)
    ?? firstExistingTexture([`gtceu:item/tools/${suffix}`], texturesByRef);
}

function findGtceuBlockLikeTexture(path, models, texturesByRef) {
  const candidates = [];

  if (path.endsWith("_indicator")) {
    candidates.push("gtceu:block/stones/surface_rock_stone");
  }

  if (path.endsWith("_raw_ore_block")) {
    candidates.push(...GTCEU_MATERIAL_SETS.map((set) => `gtceu:block/material_sets/${set}/raw_ore_block`));
  }

  if (path.endsWith("_block")) {
    candidates.push(...GTCEU_MATERIAL_SETS.map((set) => `gtceu:block/material_sets/${set}/block`));
  }

  if (path.endsWith("_frame")) {
    candidates.push(...GTCEU_MATERIAL_SETS.map((set) => `gtceu:block/material_sets/${set}/frame_gt`));
  }

  if (path.endsWith("_ore")) {
    candidates.push(...GTCEU_MATERIAL_SETS.map((set) => `gtceu:block/material_sets/${set}/ore`));
  }

  const direct = firstExistingTexture(candidates, texturesByRef);
  if (direct) return direct;

  return firstTextureFromModels(candidates, models, texturesByRef);
}

function findGtceuConduitTexture(path, texturesByRef) {
  const candidates = [];

  if (/_(single|double|quadruple|octal|hex)_wire$/.test(path)) {
    candidates.push("gtceu:block/cable/insulation_0");
  }

  if (/_(single|double|quadruple|octal|hex)_cable$/.test(path)) {
    candidates.push("gtceu:block/cable/insulation_1");
  }

  const fluidPipeMatch = path.match(/_(tiny|small|normal|large|huge|quadruple|nonuple)_fluid_pipe$/);
  if (fluidPipeMatch) {
    candidates.push(`gtceu:block/pipe/pipe_${fluidPipeMatch[1]}_in`);
    candidates.push("gtceu:block/pipe/pipe_side");
  }

  const itemPipeMatch = path.match(/_(small|normal|large|huge)_(restrictive_)?item_pipe$/);
  if (itemPipeMatch) {
    candidates.push(`gtceu:block/pipe/pipe_${itemPipeMatch[1]}_in`);
    candidates.push(itemPipeMatch[2] ? "gtceu:block/pipe/pipe_restrictive" : "gtceu:block/pipe/pipe_side");
  }

  return firstExistingTexture(candidates, texturesByRef);
}

function firstTextureFromModels(modelIds, models, texturesByRef) {
  for (const modelId of modelIds) {
    const resolvedModel = resolveModelTextures(modelId, models);
    const fromModel = pickTextureRef(resolvedModel, "gtceu");
    if (fromModel && texturesByRef.has(fromModel)) return fromModel;
  }

  return null;
}

function firstExistingTexture(candidates, texturesByRef) {
  return candidates.find((candidate) => texturesByRef.has(candidate)) ?? null;
}

function resolveModelTextures(modelId, models, seen = new Set()) {
  if (seen.has(modelId)) return {};
  seen.add(modelId);

  const model = models.get(modelId)?.json;
  if (!model) return {};

  const [namespace] = splitResource(modelId);
  return resolveInlineModelTextures(model, namespace, models, seen);
}

function resolveInlineModelTextures(model, defaultNamespace, models, seen) {
  const parentId = model.parent ? normalizeResource(model.parent, defaultNamespace) : null;
  const parentTextures = parentId ? resolveModelTextures(parentId, models, seen) : {};
  const variantTextures = collectVariantTextures(model, defaultNamespace, models, seen);
  const multipartTextures = collectMultipartTextures(model, defaultNamespace, models, seen);
  const childTextures = collectChildTextures(model, defaultNamespace, models, seen);

  return {
    ...parentTextures,
    ...variantTextures,
    ...multipartTextures,
    ...childTextures,
    ...(model.textures ?? {})
  };
}

function collectVariantTextures(model, defaultNamespace, models, seen) {
  const variants = model.variants ? Object.values(model.variants) : [];
  return variants.reduce((textures, variant) => {
    const variantModel = variant?.model;
    if (!variantModel) return textures;
    if (typeof variantModel === "string") {
      return {
        ...textures,
        ...resolveModelTextures(normalizeResource(variantModel, defaultNamespace), models, new Set(seen))
      };
    }
    return {
      ...textures,
      ...resolveInlineModelTextures(variantModel, defaultNamespace, models, new Set(seen))
    };
  }, {});
}

function collectMultipartTextures(model, defaultNamespace, models, seen) {
  const parts = Array.isArray(model.multipart) ? model.multipart : [];
  return parts.reduce((textures, part) => {
    const applied = part?.apply;
    const appliedModel = applied?.model;
    if (!appliedModel) return textures;
    if (typeof appliedModel === "string") {
      return {
        ...textures,
        ...resolveModelTextures(normalizeResource(appliedModel, defaultNamespace), models, new Set(seen))
      };
    }
    return {
      ...textures,
      ...resolveInlineModelTextures(appliedModel, defaultNamespace, models, new Set(seen))
    };
  }, {});
}

function collectChildTextures(model, defaultNamespace, models, seen) {
  const children = model.children ? Object.values(model.children) : [];
  return children.reduce((textures, child) => {
    if (!child) return textures;
    if (typeof child === "string") {
      return {
        ...textures,
        ...resolveModelTextures(normalizeResource(child, defaultNamespace), models, new Set(seen))
      };
    }
    if (typeof child.model === "string") {
      return {
        ...textures,
        ...resolveModelTextures(normalizeResource(child.model, defaultNamespace), models, new Set(seen))
      };
    }
    return {
      ...textures,
      ...resolveInlineModelTextures(child, defaultNamespace, models, new Set(seen))
    };
  }, {});
}

function pickTextureRef(textures, defaultNamespace) {
  const keys = ["layer0", "overlay_front", "front", "all", "particle", "side", "top", "bottom", "end", "overlay_side", "overlay_top"];
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
