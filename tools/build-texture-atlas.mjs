import { readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";

const DEFAULT_DATA_FILE = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_TEXTURE_MANIFEST_FILE = "data/texture-manifest.local.json";
const DEFAULT_ATLAS_FILE = "data/texture-atlas.png";
const DEFAULT_ATLAS_MANIFEST_FILE = "data/texture-atlas.json";
const DEFAULT_TILE_SIZE = 32;
const DEFAULT_COLUMNS = 128;

const args = parseArgs(process.argv.slice(2));
const dataFile = args.data ?? DEFAULT_DATA_FILE;
const sourceManifestFile = args.source ?? DEFAULT_TEXTURE_MANIFEST_FILE;
const atlasFile = args.atlas ?? DEFAULT_ATLAS_FILE;
const atlasManifestFile = args.manifest ?? DEFAULT_ATLAS_MANIFEST_FILE;
const tileSize = Number(args.tileSize ?? DEFAULT_TILE_SIZE);
const columns = Number(args.columns ?? DEFAULT_COLUMNS);

const packData = JSON.parse(await readFile(dataFile, "utf-8"));
const sourceManifest = JSON.parse(await readFile(sourceManifestFile, "utf-8"));

if (sourceManifest.schema !== "gtceu-planner-texture-manifest-v1") {
  throw new Error(`Unsupported texture source manifest schema: ${sourceManifest.schema}`);
}

const iconByTexturePath = new Map();
const icons = {};
const entries = [];

for (const good of packData.goods ?? []) {
  const texturePath = sourceManifest.textures?.[good.id];
  if (!texturePath || !await exists(texturePath)) continue;

  let iconId = iconByTexturePath.get(texturePath);
  if (iconId === undefined) {
    iconId = entries.length;
    iconByTexturePath.set(texturePath, iconId);
    entries.push({
      iconId,
      texturePath
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
    const image = decodePng(await readFile(entry.texturePath));
    drawImageToAtlas(image, atlas, atlasWidth, entry.iconId, tileSize, columns);
  } catch (error) {
    skipped.push({ iconId: entry.iconId, texturePath: entry.texturePath, reason: error.message });
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
    uniqueTextures: entries.length,
    goodsScanned: packData.goods?.length ?? 0,
    skippedIcons: skipped.length
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

async function exists(path) {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

function drawImageToAtlas(image, atlas, atlasWidth, iconId, tileSize, columns) {
  const column = iconId % columns;
  const row = Math.floor(iconId / columns);
  const targetX = column * tileSize;
  const targetY = row * tileSize;
  const scale = Math.min(tileSize / image.width, tileSize / image.height);
  const drawWidth = Math.max(1, Math.floor(image.width * scale));
  const drawHeight = Math.max(1, Math.floor(image.height * scale));
  const offsetX = targetX + Math.floor((tileSize - drawWidth) / 2);
  const offsetY = targetY + Math.floor((tileSize - drawHeight) / 2);

  for (let y = 0; y < drawHeight; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor(y / scale));
    for (let x = 0; x < drawWidth; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor(x / scale));
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      const targetOffset = ((offsetY + y) * atlasWidth + offsetX + x) * 4;
      atlas[targetOffset] = image.pixels[sourceOffset];
      atlas[targetOffset + 1] = image.pixels[sourceOffset + 1];
      atlas[targetOffset + 2] = image.pixels[sourceOffset + 2];
      atlas[targetOffset + 3] = image.pixels[sourceOffset + 3];
    }
  }
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

var crcTable = null;

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
