import { createHash } from "node:crypto";
import { dirname, join, relative, sep } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";

var crcTable = null;

const DEFAULT_DATA_FILE = "data/gtceu-modern-pack-1.14.5.fluid-tints.local.json";
const FALLBACK_DATA_FILE = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_SOURCE_MANIFEST_FILE = "data/texture-manifest.fluid-base.local.json";
const FALLBACK_SOURCE_MANIFEST_FILE = "data/texture-manifest.rendered.local.json";
const DEFAULT_ATLAS_MANIFEST_FILE = "data/texture-atlas.json";
const DEFAULT_OUTPUT_DIR = "assets/animated-icons";

const args = parseArgs(process.argv.slice(2));
const dataFile = args.data ?? (await exists(DEFAULT_DATA_FILE) ? DEFAULT_DATA_FILE : FALLBACK_DATA_FILE);
const sourceManifestFile = args.source ?? (await exists(DEFAULT_SOURCE_MANIFEST_FILE) ? DEFAULT_SOURCE_MANIFEST_FILE : FALLBACK_SOURCE_MANIFEST_FILE);
const atlasManifestFile = args.atlasManifest ?? DEFAULT_ATLAS_MANIFEST_FILE;
const outputDir = args.outDir ?? DEFAULT_OUTPUT_DIR;
const frameMs = Number(args.frameMs ?? 80);

const packData = JSON.parse(await readFile(dataFile, "utf-8"));
const sourceManifest = JSON.parse(await readFile(sourceManifestFile, "utf-8"));
const atlasManifest = JSON.parse(await readFile(atlasManifestFile, "utf-8"));

if (sourceManifest.schema !== "gtceu-planner-texture-manifest-v1") {
  throw new Error(`Unsupported texture source manifest schema: ${sourceManifest.schema}`);
}

if (atlasManifest.schema !== "gtceu-planner-texture-atlas-v1") {
  throw new Error(`Unsupported atlas manifest schema: ${atlasManifest.schema}`);
}

const animations = {};
let scannedIcons = 0;
let animatedIcons = 0;
let tintedAnimatedIcons = 0;

for (const good of packData.goods ?? []) {
  if (atlasManifest.icons?.[good.id] === undefined) continue;

  const texturePath = primaryTextureForGood(good, sourceManifest);
  if (!texturePath || !await exists(texturePath)) continue;

  scannedIcons += 1;
  const image = decodePng(await readFile(texturePath));
  const animation = animationInfoForImage(image);
  if (!animation) continue;

  const tintColor = tintColorForGood(good);
  const outputPath = tintColor
    ? await writeTintedAnimation(good.id, image, tintColor, outputDir)
    : texturePath;

  animatedIcons += 1;
  if (tintColor) tintedAnimatedIcons += 1;

  animations[good.id] = {
    image: versionedPath(outputPath),
    frameSize: animation.frameSize,
    frames: animation.frames,
    durationMs: Math.max(frameMs, animation.frames * frameMs),
    tinted: Boolean(tintColor),
    source: texturePath
  };
}

atlasManifest.animations = animations;
atlasManifest.source ??= {};
atlasManifest.source.animations = {
  data: dataFile,
  sourceManifest: sourceManifestFile,
  outputDir,
  frameMs,
  scannedIcons,
  animatedIcons,
  tintedAnimatedIcons
};

await writeFile(atlasManifestFile, `${JSON.stringify(atlasManifest, null, 2)}\n`);
console.log(`Updated ${atlasManifestFile}`);
console.log(`Animated icons: ${animatedIcons}`);
console.log(`Tinted animated icons: ${tintedAnimatedIcons}`);

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

function primaryTextureForGood(good, manifest) {
  const manifestIcon = manifest.icons?.[good.id];
  return manifestIcon?.primary ?? manifest.textures?.[good.id] ?? null;
}

function animationInfoForImage(image) {
  if (image.width <= 0 || image.height <= image.width || image.height % image.width !== 0) return null;
  const frames = image.height / image.width;
  if (frames < 2) return null;
  return { frameSize: image.width, frames };
}

function tintColorForGood(good) {
  if (typeof good.color !== "string") return null;
  const match = good.color.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;

  const hex = match[1].length === 3
    ? match[1].split("").map((digit) => digit + digit).join("")
    : match[1];

  if (hex.toUpperCase() === "FFFFFF") return null;

  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16)
  ];
}

async function writeTintedAnimation(goodsId, image, tintColor, outputDir) {
  const tinted = new Uint8Array(image.pixels.length);

  for (let offset = 0; offset < image.pixels.length; offset += 4) {
    const [red, green, blue] = tintPixel(
      image.pixels[offset],
      image.pixels[offset + 1],
      image.pixels[offset + 2],
      tintColor
    );

    tinted[offset] = red;
    tinted[offset + 1] = green;
    tinted[offset + 2] = blue;
    tinted[offset + 3] = image.pixels[offset + 3];
  }

  const outputPath = join(outputDir, `${goodsId.replace(/[^a-z0-9_.-]+/gi, "_")}.png`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, encodePng(image.width, image.height, tinted));
  return toWebPath(relative(".", outputPath));
}

function tintPixel(red, green, blue, tintColor) {
  const shade = Math.max(0, Math.min(1, ((red + green + blue) / 3) / 255));
  return [
    Math.round(tintColor[0] * shade),
    Math.round(tintColor[1] * shade),
    Math.round(tintColor[2] * shade)
  ];
}

function versionedPath(path) {
  return `${path}?v=${createHash("sha256").update(path).digest("hex").slice(0, 12)}`;
}

function toWebPath(path) {
  return path.split(sep).join("/");
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

  if (interlaceMethod !== 0) {
    throw new Error(`Unsupported PNG interlace method ${interlaceMethod}`);
  }

  const inflated = inflateSync(Buffer.concat(idatChunks));
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
    case 0: return 1;
    case 2: return 3;
    case 3: return 1;
    case 4: return 2;
    case 6: return 4;
    default: throw new Error(`Unsupported PNG color type ${colorType}.`);
  }
}

function unfilterRow(filter, input, previousRow, output, bytesPerPixel) {
  for (let index = 0; index < input.length; index += 1) {
    const left = index >= bytesPerPixel ? output[index - bytesPerPixel] : 0;
    const up = previousRow ? previousRow[index] : 0;
    const upperLeft = previousRow && index >= bytesPerPixel ? previousRow[index - bytesPerPixel] : 0;
    let value;

    if (filter === 0) value = input[index];
    else if (filter === 1) value = input[index] + left;
    else if (filter === 2) value = input[index] + up;
    else if (filter === 3) value = input[index] + Math.floor((left + up) / 2);
    else if (filter === 4) value = input[index] + paeth(left, up, upperLeft);
    else throw new Error(`Unsupported PNG filter ${filter}.`);

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
