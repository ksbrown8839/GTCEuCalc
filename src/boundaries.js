const BASE_MATERIAL_TAG_PREFIXES = [
  "forge:ores/",
  "forge:raw_materials/",
  "forge:ingots/",
  "forge:nuggets/",
  "forge:gems/",
  "forge:dusts/",
  "forge:crushed_ores/",
  "forge:purified_ores/",
  "forge:pure_dusts/",
  "forge:impure_dusts/"
];

const STOCK_PART_TAG_PREFIXES = [
  "forge:plates/",
  "forge:dense_plates/",
  "forge:double_plates/",
  "forge:rods/",
  "forge:long_rods/",
  "forge:bolts/",
  "forge:screws/",
  "forge:rings/",
  "forge:springs/",
  "forge:gears/",
  "forge:small_gears/",
  "forge:foils/",
  "forge:fine_wires/"
];

function hasTagPrefix(good, prefixes) {
  return good.tags?.some((tag) => prefixes.some((prefix) => tag.startsWith(prefix))) ?? false;
}

function isGtceuWireOrCable(good) {
  return good.mod === "gtceu" && /_(single|double|quadruple|octal|hex)_(cable|wire)$/.test(good.id);
}

function isGtceuPipe(good) {
  return good.mod === "gtceu" && /_(tiny|small|normal|large|huge|quadruple|nonuple)_fluid_pipe$/.test(good.id);
}

export const BOUNDARY_PRESETS = [
  {
    id: "fluids",
    label: "Fluids",
    match: (good) => good.kind === "fluid"
  },
  {
    id: "base-materials",
    label: "Base materials",
    match: (good) => hasTagPrefix(good, BASE_MATERIAL_TAG_PREFIXES)
  },
  {
    id: "stock-parts",
    label: "Stock parts",
    match: (good) => hasTagPrefix(good, STOCK_PART_TAG_PREFIXES) || isGtceuWireOrCable(good) || isGtceuPipe(good)
  },
  {
    id: "circuits",
    label: "Circuits",
    match: (good) => good.tags?.some((tag) => tag.startsWith("gtceu:circuits/")) ?? false
  }
];

export function getBoundaryPresetGoods(repository, activePresetIds) {
  const activePresets = BOUNDARY_PRESETS.filter((preset) => activePresetIds.has(preset.id));
  const goodsIds = new Set();

  for (const good of repository.goods.values()) {
    if (activePresets.some((preset) => preset.match(good))) {
      goodsIds.add(good.id);
    }
  }

  return goodsIds;
}

export function countBoundaryPresetGoods(repository, preset) {
  let count = 0;

  for (const good of repository.goods.values()) {
    if (preset.match(good)) count += 1;
  }

  return count;
}

export function getBoundaryPresetForGood(good) {
  return BOUNDARY_PRESETS.find((preset) => preset.match(good)) ?? null;
}
