import { readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { canRenderModelDefinition, drawModelIcon } from "./model-renderer.mjs";

var crcTable = null;

const DEFAULT_DATA_FILE = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_TEXTURE_MANIFEST_FILE = "data/texture-manifest.local.json";
const DEFAULT_MODEL_DEFINITIONS_FILE = "data/model-definitions.local.json";
const DEFAULT_ATLAS_FILE = "data/texture-atlas.png";
const DEFAULT_ATLAS_MANIFEST_FILE = "data/texture-atlas.json";
const DEFAULT_TILE_SIZE = 32;
const DEFAULT_COLUMNS = 128;

const args = parseArgs(process.argv.slice(2));
const dataFile = args.data ?? DEFAULT_DATA_FILE;
const sourceManifestFile = args.source ?? DEFAULT_TEXTURE_MANIFEST_FILE;
const modelDefinitionsFile = args.models ?? DEFAULT_MODEL_DEFINITIONS_FILE;
const atlasFile = args.atlas ?? DEFAULT_ATLAS_FILE;
const atlasManifestFile = args.manifest ?? DEFAULT_ATLAS_MANIFEST_FILE;
const tileSize = Number(args.tileSize ?? DEFAULT_TILE_SIZE);
const columns = Number(args.columns ?? DEFAULT_COLUMNS);

const packData = JSON.parse(await readFile(dataFile, "utf-8"));
const sourceManifest = JSON.parse(await readFile(sourceManifestFile, "utf-8"));
const modelDefinitions = await loadModelDefinitions(modelDefinitionsFile);

if (sourceManifest.schema !== "gtceu-planner-texture-manifest-v1") {
  throw new Error(`Unsupported texture source manifest schema: ${sourceManifest.schema}`);
}

const iconByRenderKey = new Map();
const decodedImageByPath = new Map();
const icons = {};
const entries = [];

for (const good of packData.goods ?? []) {
  const descriptor = iconDescriptorForGood(good, sourceManifest, modelDefinitions);
  if (!descriptor.primary || !await exists(descriptor.primary)) continue;

  const renderMode = iconRenderMode(good, descriptor);
  const tintColor = fluidTintColor(good);
  const renderKey = renderKeyForDescriptor(renderMode, descriptor, tintColor);
  let iconId = iconByRenderKey.get(renderKey);
  if (iconId === undefined) {
    iconId = entries.length;
    iconByRenderKey.set(renderKey, iconId);
    entries.push({
      iconId,
      primaryPath: descriptor.primary,
      renderMode,
      tintColor,
      model: descriptor.model,
      modelDefinition: descriptor.modelDefinition,
      textures: descriptor.textures
    });
  }

  icons[good.id] = iconId;
}

const rows = Math.max(1, Math.ceil(entries.length / columns));
const atlasWidth = columns * tileSize;
const atlasHeight = rows * tileSize;
const atlas = new Uint8Array(atlasWidth * atlasHeight * 4);
const skipped = [];

for (const entry of entries) {
  if (entry.iconId % 250 === 0) {
    console.log(`Drawing icon ${entry.iconId + 1} / ${entries.length}`);
  }

  try {
    const images = await readIconImages(entry);
    drawIconToAtlas(entry, images, atlas, atlasWidth, tileSize, columns);
  } catch (error) {
    skipped.push({ iconId: entry.iconId, texturePath: entry.primaryPath, reason: error.message });
  }
}

const atlasPng = encodePng(atlasWidth, atlasHeight, atlas);
const atlasVersion = createHash("sha256").update(atlasPng).digest("hex").slice(0, 12);
await writeFile(atlasFile, atlasPng);

const atlasManifest = {
  schema: "gtceu-planner-texture-atlas-v1",
  generatedAt: new Date().toISOString(),
  image: `${atlasFile.replaceAll("\\", "/")}?v=${atlasVersion}`,
  tileSize,
  columns,
  rows,
  iconCount: entries.length,
  goodsWithIcons: Object.keys(icons).length,
  source: {
    packName: packData.metadata?.packName ?? null,
    packVersion: packData.metadata?.packVersion ?? null,
    minecraftVersion: packData.metadata?.minecraftVersion ?? null,
    sourceManifest: sourceManifestFile,
    modelDefinitions: modelDefinitions ? modelDefinitionsFile : null,
    uniqueTextures: entries.length,
    goodsScanned: packData.goods?.length ?? 0,
    skippedIcons: skipped.length,
    renderModes: countRenderModes(entries)
  },
  skipped,
  icons
};

await writeFile(atlasManifestFile, `${JSON.stringify(atlasManifest, null, 2)}\n`);
console.log(`Wrote ${atlasFile} (${atlasWidth}x${atlasHeight})`);
console.log(`Wrote ${atlasManifestFile} with ${entries.length} atlas icons for ${Object.keys(icons).length} goods`);
if (skipped.length) {
  console.warn(`Skipped ${skipped.length} unusual PNGs. First skipped: ${skipped[0].texturePath} (${skipped[0].reason})`);
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

async function loadModelDefinitions(path) {
  if (!await exists(path)) return null;
  const definitions = JSON.parse(await readFile(path, "utf-8"));
  if (definitions.schema !== "gtceu-planner-model-definitions-v1") {
    console.warn(`Ignoring unsupported model definition schema: ${definitions.schema}`);
    return null;
  }
  return definitions;
}

async function exists(path) {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

function iconDescriptorForGood(good, manifest, definitions) {
  const manifestIcon = manifest.icons?.[good.id];
  const primary = manifestIcon?.primary ?? manifest.textures?.[good.id] ?? null;
  const textures = {
    ...(manifestIcon?.textures ?? {})
  };

  if (primary) textures.primary ??= primary;

  return {
    kind: manifestIcon?.kind ?? "texture",
    model: manifestIcon?.model ?? null,
    modelDefinition: manifestIcon?.model ? definitions?.models?.[manifestIcon.model] ?? null : null,
    primary,
    textures
  };
}

function renderKeyForDescriptor(renderMode, descriptor, tintColor) {
  return JSON.stringify({
    renderMode,
    tintColor,
    model: renderMode === "model-json" ? descriptor.model : null,
    textures: Object.entries(descriptor.textures ?? {}).sort(([a], [b]) => a.localeCompare(b))
  });
}

async function readIconImages(entry) {
  const images = {};
  for (const [role, texturePath] of Object.entries(entry.textures ?? {})) {
    if (!texturePath || images[role] || !await exists(texturePath)) continue;
    images[role] = await readDecodedImage(texturePath);
  }
  return images;
}

async function readDecodedImage(texturePath) {
  const cached = decodedImageByPath.get(texturePath);
  if (cached) return cached;

  const image = decodePng(await readFile(texturePath));
  decodedImageByPath.set(texturePath, image);
  return image;
}

function iconRenderMode(good, descriptor) {
  const idPath = good.id.includes(":") ? good.id.split(":")[1] : good.id;
  if (descriptor.kind === "rendered") return "rendered";
  if (good.kind === "fluid") return "flat";
  if (canRenderModelDefinition(descriptor.modelDefinition) && isBlockLikeGood(idPath, descriptor.primary)) return "model-json";
  if (hasCubeModelTextures(descriptor.textures) && isBlockLikeGood(idPath, descriptor.primary)) return "model-cube";
  return "flat";
}

function fluidTintColor(good) {
  if (good.kind !== "fluid" || typeof good.color !== "string") return null;
  const match = good.color.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;

  const hex = match[1].length === 3
    ? match[1].split("").map((digit) => digit + digit).join("")
    : match[1];

  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16)
  ];
}

function isBlockLikeGood(idPath, texturePath) {
  if (texturePath?.includes("/block/")) return true;
  return /_(block|casing|frame|ore|crate|drum|hatch|bus|boiler|tank|valve|machine_hull)$/.test(idPath)
    || /_(alloy_smelter|assembler|macerator|wiremill|centrifuge|compressor|extractor|furnace|bender)$/.test(idPath);
}

function hasCubeModelTextures(textures = {}) {
  return Boolean(textures.all || textures.top || textures.side || textures.front || textures.overlay_front || textures.overlay_side || textures.overlay_top);
}

function countRenderModes(entries) {
  return entries.reduce((counts, entry) => {
    counts[entry.renderMode] = (counts[entry.renderMode] ?? 0) + 1;
    return counts;
  }, {});
}

function drawIconToAtlas(entry, images, atlas, atlasWidth, tileSize, columns) {
  const primaryImage = firstImage(images, ["primary", "layer0", "all", "side", "top"]);
  if (!primaryImage) throw new Error("No readable icon texture.");

  if (entry.renderMode === "model-json") {
    const rendered = drawModelIcon(entry.modelDefinition, images, atlas, atlasWidth, entry.iconId, tileSize, columns);
    if (rendered) return;
  }

  if (entry.renderMode === "model-cube" || entry.renderMode === "model-json") {
    drawCubeIcon(images, atlas, atlasWidth, entry.iconId, tileSize, columns);
    return;
  }

  drawImageToAtlas(primaryImage, atlas, atlasWidth, entry.iconId, tileSize, columns, { tintColor: entry.tintColor });
}

function drawImageToAtlas(image, atlas, atlasWidth, iconId, tileSize, columns, options = {}) {
  const frame = firstFrameForImage(image);
  const column = iconId % columns;
  const row = Math.floor(iconId / columns);
  const targetX = column * tileSize;
  const targetY = row * tileSize;
  const scale = Math.min(tileSize / frame.width, tileSize / frame.height);
  const drawWidth = Math.max(1, Math.floor(frame.width * scale));
  const drawHeight = Math.max(1, Math.floor(frame.height * scale));
  const offsetX = targetX + Math.floor((tileSize - drawWidth) / 2);
  const offsetY = targetY + Math.floor((tileSize - drawHeight) / 2);

  for (let y = 0; y < drawHeight; y += 1) {
    const sourceY = frame.y + Math.min(frame.height - 1, Math.floor(y / scale));
    for (let x = 0; x < drawWidth; x += 1) {
      const sourceX = frame.x + Math.min(frame.width - 1, Math.floor(x / scale));
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      const targetOffset = ((offsetY + y) * atlasWidth + offsetX + x) * 4;
      const red = image.pixels[sourceOffset];
      const green = image.pixels[sourceOffset + 1];
      const blue = image.pixels[sourceOffset + 2];
      const alpha = image.pixels[sourceOffset + 3];
      const tinted = options.tintColor ? tintPixel(red, green, blue, options.tintColor) : [red, green, blue];
      atlas[targetOffset] = tinted[0];
      atlas[targetOffset + 1] = tinted[1];
      atlas[targetOffset + 2] = tinted[2];
      atlas[targetOffset + 3] = alpha;
    }
  }
}

function firstFrameForImage(image) {
  if (image.width > 0 && image.height > image.width && image.height % image.width === 0) {
    return { x: 0, y: 0, width: image.width, height: image.width };
  }
  return { x: 0, y: 0, width: image.width, height: image.height };
}

function tintPixel(red, green, blue, tintColor) {
  const shade = Math.max(0, Math.min(1, ((red + green + blue) / 3) / 255));
  return [
    Math.round(tintColor[0] * shade),
    Math.round(tintColor[1] * shade),
    Math.round(tintColor[2] * shade)
  ];
}

function drawCubeIcon(images, atlas, atlasWidth, iconId, tileSize, columns) {
  const { targetX, targetY } = iconTarget(iconId, tileSize, columns);
  const topImage = firstImage(images, ["top", "all", "end", "side", "primary"]);
  const sideImage = firstImage(images, ["side", "all", "particle", "primary"]);
  const frontImage = firstImage(images, ["front", "side", "all", "particle", "primary"]);
  const frontOverlay = firstImage(images, ["overlay_front"]);
  const frontEmissive = firstImage(images, ["overlay_front_emissive"]);
  const sideOverlay = firstImage(images, ["overlay_side"]);
  const topOverlay = firstImage(images, ["overlay_top"]);
  const top = parallelogram([16, 3], [-11, 6], [11, 6]);
  const left = parallelogram([5, 9], [11, 6], [0, 13]);
  const right = parallelogram([16, 15], [11, -6], [0, 13]);

  drawTexturedParallelogram(sideImage, atlas, atlasWidth, targetX, targetY, left, 0.78, { minimumAlpha: 170 });
  if (sideOverlay) drawTexturedParallelogram(sideOverlay, atlas, atlasWidth, targetX, targetY, left, 0.86);
  drawTexturedParallelogram(frontImage, atlas, atlasWidth, targetX, targetY, right, 0.72, { minimumAlpha: 170 });
  if (frontOverlay) drawTexturedParallelogram(frontOverlay, atlas, atlasWidth, targetX, targetY, right, 0.96);
  if (frontEmissive) drawTexturedParallelogram(frontEmissive, atlas, atlasWidth, targetX, targetY, right, 1.18);
  drawTexturedParallelogram(topImage, atlas, atlasWidth, targetX, targetY, top, 1.08, { minimumAlpha: 170 });
  if (topOverlay) drawTexturedParallelogram(topOverlay, atlas, atlasWidth, targetX, targetY, top, 1.12);

  drawLine(atlas, atlasWidth, targetX + 16, targetY + 3, targetX + 5, targetY + 9, [45, 48, 45, 105]);
  drawLine(atlas, atlasWidth, targetX + 16, targetY + 3, targetX + 27, targetY + 9, [45, 48, 45, 105]);
  drawLine(atlas, atlasWidth, targetX + 5, targetY + 9, targetX + 5, targetY + 22, [45, 48, 45, 88]);
  drawLine(atlas, atlasWidth, targetX + 27, targetY + 9, targetX + 27, targetY + 22, [45, 48, 45, 88]);
  drawLine(atlas, atlasWidth, targetX + 5, targetY + 22, targetX + 16, targetY + 28, [45, 48, 45, 80]);
  drawLine(atlas, atlasWidth, targetX + 16, targetY + 28, targetX + 27, targetY + 22, [45, 48, 45, 80]);
}

function firstImage(images, roles) {
  for (const role of roles) {
    if (images[role]) return images[role];
  }
  return Object.values(images)[0] ?? null;
}

function iconTarget(iconId, tileSize, columns) {
  return {
    targetX: (iconId % columns) * tileSize,
    targetY: Math.floor(iconId / columns) * tileSize
  };
}

function parallelogram(origin, uVector, vVector) {
  return {
    origin,
    uVector,
    vVector,
    points: [
      origin,
      [origin[0] + uVector[0], origin[1] + uVector[1]],
      [origin[0] + uVector[0] + vVector[0], origin[1] + uVector[1] + vVector[1]],
      [origin[0] + vVector[0], origin[1] + vVector[1]]
    ]
  };
}

function drawTexturedParallelogram(image, atlas, atlasWidth, targetX, targetY, shape, shade, options = {}) {
  const [minX, minY, maxX, maxY] = polygonBounds(shape.points);
  const [originX, originY] = shape.origin;
  const [ux, uy] = shape.uVector;
  const [vx, vy] = shape.vVector;
  const determinant = ux * vy - uy * vx;

  if (!determinant) return;

  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y += 1) {
    for (let x = Math.floor(minX); x <= Math.ceil(maxX); x += 1) {
      const qx = x + 0.5 - originX;
      const qy = y + 0.5 - originY;
      const u = (qx * vy - qy * vx) / determinant;
      const v = (ux * qy - uy * qx) / determinant;

      if (u < 0 || u > 1 || v < 0 || v > 1) continue;

      const sourceX = Math.min(image.width - 1, Math.max(0, Math.floor(u * image.width)));
      const sourceY = Math.min(image.height - 1, Math.max(0, Math.floor(v * image.height)));
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      const color = [
        Math.min(255, Math.round(image.pixels[sourceOffset] * shade)),
        Math.min(255, Math.round(image.pixels[sourceOffset + 1] * shade)),
        Math.min(255, Math.round(image.pixels[sourceOffset + 2] * shade)),
        options.minimumAlpha && image.pixels[sourceOffset + 3] > 0
          ? Math.max(options.minimumAlpha, image.pixels[sourceOffset + 3])
          : image.pixels[sourceOffset + 3]
      ];
      blendPixel(atlas, atlasWidth, targetX + x, targetY + y, color);
    }
  }
}

function polygonBounds(points) {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function drawLine(atlas, atlasWidth, x0, y0, x1, y1, color) {
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let x = x0;
  let y = y0;

  while (true) {
    blendPixel(atlas, atlasWidth, x, y, color);
    if (x === x1 && y === y1) break;
    const doubleError = 2 * error;
    if (doubleError >= dy) {
      error += dy;
      x += sx;
    }
    if (doubleError <= dx) {
      error += dx;
      y += sy;
    }
  }
}

function blendPixel(atlas, atlasWidth, x, y, color) {
  if (x < 0 || y < 0 || x >= atlasWidth) return;
  const offset = (y * atlasWidth + x) * 4;
  if (offset < 0 || offset + 3 >= atlas.length) return;
  const alpha = color[3] / 255;
  const inverse = 1 - alpha;
  atlas[offset] = Math.round(color[0] * alpha + atlas[offset] * inverse);
  atlas[offset + 1] = Math.round(color[1] * alpha + atlas[offset + 1] * inverse);
  atlas[offset + 2] = Math.round(color[2] * alpha + atlas[offset + 2] * inverse);
  atlas[offset + 3] = Math.round(255 * (alpha + (atlas[offset + 3] / 255) * inverse));
}

function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("Invalid PNG signature.");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlaceMethod = 0;
  let palette = null;
  let transparency = null;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlaceMethod = data[12];
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "tRNS") {
      transparency = data;
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  const inflated = inflateSync(Buffer.concat(idatChunks));
  if (interlaceMethod !== 0) {
    throw new Error(`Unsupported PNG interlace method ${interlaceMethod}`);
  }
  const channels = channelsForColorType(colorType);
  const bytesPerPixel = Math.max(1, Math.ceil((channels * bitDepth) / 8));
  const bitsPerPixel = channels * bitDepth;
  const scanlineLength = Math.ceil((width * bitsPerPixel) / 8);
  const raw = new Uint8Array(height * scanlineLength);
  let readOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[readOffset];
    readOffset += 1;
    const row = inflated.subarray(readOffset, readOffset + scanlineLength);
    readOffset += scanlineLength;
    const previousRow = y === 0 ? null : raw.subarray((y - 1) * scanlineLength, y * scanlineLength);
    const outputRow = raw.subarray(y * scanlineLength, (y + 1) * scanlineLength);
    unfilterRow(filter, row, previousRow, outputRow, bytesPerPixel);
  }

  return {
    width,
    height,
    pixels: expandPixels(raw, width, height, bitDepth, colorType, palette, transparency)
  };
}

function channelsForColorType(colorType) {
  switch (colorType) {
    case 0:
      return 1;
    case 2:
      return 3;
    case 3:
      return 1;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      throw new Error(`Unsupported PNG color type ${colorType}.`);
  }
}

function unfilterRow(filter, input, previousRow, output, bytesPerPixel) {
  for (let index = 0; index < input.length; index += 1) {
    const left = index >= bytesPerPixel ? output[index - bytesPerPixel] : 0;
    const up = previousRow ? previousRow[index] : 0;
    const upperLeft = previousRow && index >= bytesPerPixel ? previousRow[index - bytesPerPixel] : 0;
    let value;

    if (filter === 0) {
      value = input[index];
    } else if (filter === 1) {
      value = input[index] + left;
    } else if (filter === 2) {
      value = input[index] + up;
    } else if (filter === 3) {
      value = input[index] + Math.floor((left + up) / 2);
    } else if (filter === 4) {
      value = input[index] + paeth(left, up, upperLeft);
    } else {
      throw new Error(`Unsupported PNG filter ${filter}.`);
    }

    output[index] = value & 0xff;
  }
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function expandPixels(raw, width, height, bitDepth, colorType, palette, transparency) {
  const pixels = new Uint8Array(width * height * 4);
  let outputOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * Math.ceil((width * channelsForColorType(colorType) * bitDepth) / 8);

    for (let x = 0; x < width; x += 1) {
      if (colorType === 0) {
        const gray = readSample(raw, rowStart, x, bitDepth);
        pixels[outputOffset++] = gray;
        pixels[outputOffset++] = gray;
        pixels[outputOffset++] = gray;
        pixels[outputOffset++] = 255;
      } else if (colorType === 2) {
        const offset = rowStart + x * 3;
        const red = raw[offset];
        const green = raw[offset + 1];
        const blue = raw[offset + 2];
        pixels[outputOffset++] = red;
        pixels[outputOffset++] = green;
        pixels[outputOffset++] = blue;
        pixels[outputOffset++] = matchesTransparency(red, green, blue, transparency) ? 0 : 255;
      } else if (colorType === 3) {
        const paletteIndex = readPackedIndex(raw, rowStart, x, bitDepth);
        const paletteOffset = paletteIndex * 3;
        pixels[outputOffset++] = palette?.[paletteOffset] ?? 0;
        pixels[outputOffset++] = palette?.[paletteOffset + 1] ?? 0;
        pixels[outputOffset++] = palette?.[paletteOffset + 2] ?? 0;
        pixels[outputOffset++] = transparency?.[paletteIndex] ?? 255;
      } else if (colorType === 4) {
        const offset = rowStart + x * 2;
        const gray = raw[offset];
        pixels[outputOffset++] = gray;
        pixels[outputOffset++] = gray;
        pixels[outputOffset++] = gray;
        pixels[outputOffset++] = raw[offset + 1];
      } else if (colorType === 6) {
        const offset = rowStart + x * 4;
        pixels[outputOffset++] = raw[offset];
        pixels[outputOffset++] = raw[offset + 1];
        pixels[outputOffset++] = raw[offset + 2];
        pixels[outputOffset++] = raw[offset + 3];
      }
    }
  }

  return pixels;
}

function readSample(raw, rowStart, x, bitDepth) {
  if (bitDepth === 8) return raw[rowStart + x];
  return Math.round((readPackedIndex(raw, rowStart, x, bitDepth) / ((1 << bitDepth) - 1)) * 255);
}

function readPackedIndex(raw, rowStart, x, bitDepth) {
  if (bitDepth === 8) return raw[rowStart + x];
  const bitIndex = x * bitDepth;
  const byte = raw[rowStart + Math.floor(bitIndex / 8)];
  const shift = 8 - bitDepth - (bitIndex % 8);
  return (byte >> shift) & ((1 << bitDepth) - 1);
}

function matchesTransparency(red, green, blue, transparency) {
  if (!transparency || transparency.length < 6) return false;
  const transparentRed = transparency.readUInt16BE(0) >> 8;
  const transparentGreen = transparency.readUInt16BE(2) >> 8;
  const transparentBlue = transparency.readUInt16BE(4) >> 8;
  return red === transparentRed && green === transparentGreen && blue === transparentBlue;
}

function encodePng(width, height, pixels) {
  const scanlineLength = width * 4;
  const raw = Buffer.alloc((scanlineLength + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (scanlineLength + 1);
    raw[rowOffset] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * scanlineLength, scanlineLength).copy(raw, rowOffset + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256).map((_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });
  return crcTable;
}

function crc32(buffer) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
