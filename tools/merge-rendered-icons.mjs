import { readFile, writeFile } from "node:fs/promises";

const DEFAULT_SOURCE_MANIFEST_FILE = "data/texture-manifest.local.json";
const DEFAULT_RENDERED_MANIFEST_FILE = "data/rendered-icons.local.json";
const DEFAULT_OUTPUT_FILE = "data/texture-manifest.rendered.local.json";

const args = parseArgs(process.argv.slice(2));
const sourceFile = args.source ?? DEFAULT_SOURCE_MANIFEST_FILE;
const renderedFile = args.rendered ?? DEFAULT_RENDERED_MANIFEST_FILE;
const outputFile = args.out ?? DEFAULT_OUTPUT_FILE;

const sourceManifest = JSON.parse(await readFile(sourceFile, "utf-8"));
const renderedManifest = JSON.parse(await readFile(renderedFile, "utf-8"));

if (sourceManifest.schema !== "gtceu-planner-texture-manifest-v1") {
  throw new Error(`Unsupported texture manifest schema: ${sourceManifest.schema}`);
}

if (renderedManifest.schema !== "gtceu-rendered-icons-v1") {
  throw new Error(`Unsupported rendered icon manifest schema: ${renderedManifest.schema}`);
}

const merged = {
  ...sourceManifest,
  generatedAt: new Date().toISOString(),
  source: {
    ...(sourceManifest.source ?? {}),
    renderedIcons: renderedFile
  },
  textures: {
    ...(sourceManifest.textures ?? {})
  },
  icons: {
    ...(sourceManifest.icons ?? {})
  }
};

let replaced = 0;
let added = 0;

for (const [goodsId, iconPath] of Object.entries(renderedManifest.icons ?? {})) {
  const existed = Boolean(merged.icons[goodsId] || merged.textures[goodsId]);
  merged.textures[goodsId] = iconPath;
  merged.icons[goodsId] = {
    kind: "rendered",
    model: null,
    primary: iconPath,
    textures: {
      primary: iconPath
    }
  };
  if (existed) replaced += 1;
  else added += 1;
}

await writeFile(outputFile, `${JSON.stringify(merged, null, 2)}\n`);
console.log(`Merged ${replaced + added} rendered icons into ${outputFile}.`);
console.log(`Replaced ${replaced}; added ${added}.`);

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
