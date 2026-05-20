import { readFile } from "node:fs/promises";

const filePath = process.argv[2] ?? "data/sample-pack.json";
const data = JSON.parse(await readFile(filePath, "utf-8"));

function countBy(values, keyFn) {
  const map = new Map();
  for (const value of values) {
    const key = keyFn(value);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function addToMapList(map, key, value) {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function topEntries(map, limit = 20) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function printSection(title) {
  console.log(`\n${title}`);
  console.log("=".repeat(title.length));
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

const goods = data.goods ?? [];
const tags = data.tags ?? [];
const recipeTypes = data.recipeTypes ?? [];
const machines = data.machines ?? [];
const voltageTiers = data.voltageTiers ?? [];
const recipes = data.recipes ?? [];

const goodsById = new Map(goods.map((good) => [good.id, good]));
const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
const recipeTypesById = new Map(recipeTypes.map((type) => [type.id, type]));
const recipesByOutput = new Map();
const recipesByInput = new Map();
const referencedGoods = new Set();
const referencedTags = new Set();
const unknownGoods = new Map();
const unknownTags = new Map();
const outputsWithNoGood = new Map();
const recipesWithoutOutputs = [];
const recipesWithoutInputs = [];
const recipesWithChanceOutputs = [];
const recipesWithNotConsumedInputs = [];
const recipesWithTags = [];
const recipesWithFluidIo = [];

for (const recipe of recipes) {
  if (!Array.isArray(recipe.outputs) || recipe.outputs.length === 0) {
    recipesWithoutOutputs.push(recipe);
  }
  if (!Array.isArray(recipe.inputs) || recipe.inputs.length === 0) {
    recipesWithoutInputs.push(recipe);
  }

  let hasChanceOutput = false;
  let hasNotConsumed = false;
  let hasTag = false;
  let hasFluid = false;

  for (const output of recipe.outputs ?? []) {
    addToMapList(recipesByOutput, output.id, recipe);
    if (output.kind === "item" || output.kind === "fluid") {
      referencedGoods.add(output.id);
      if (!goodsById.has(output.id)) {
        addToMapList(outputsWithNoGood, output.id, recipe.id);
      }
    }
    if (output.kind === "tag") {
      referencedTags.add(output.id);
    }
    if (output.chance !== undefined) hasChanceOutput = true;
    if (output.kind === "fluid") hasFluid = true;
  }

  for (const input of recipe.inputs ?? []) {
    addToMapList(recipesByInput, input.id, recipe);
    if (input.kind === "item" || input.kind === "fluid") {
      referencedGoods.add(input.id);
      if (!goodsById.has(input.id)) {
        addToMapList(unknownGoods, input.id, recipe.id);
      }
    }
    if (input.kind === "tag") {
      referencedTags.add(input.id);
      hasTag = true;
      if (!tagsById.has(input.id)) {
        addToMapList(unknownTags, input.id, recipe.id);
      }
    }
    if (input.notConsumed) hasNotConsumed = true;
    if (input.kind === "fluid") hasFluid = true;
  }

  if (hasChanceOutput) recipesWithChanceOutputs.push(recipe);
  if (hasNotConsumed) recipesWithNotConsumedInputs.push(recipe);
  if (hasTag) recipesWithTags.push(recipe);
  if (hasFluid) recipesWithFluidIo.push(recipe);
}

const goodsByKind = countBy(goods, (good) => good.kind ?? "unknown");
const recipesByType = countBy(recipes, (recipe) => recipe.type ?? "unknown");
const goodsByMod = countBy(goods, (good) => good.mod ?? good.id?.split(":")[0] ?? "unknown");
const outputRecipeCounts = new Map([...recipesByOutput.entries()].map(([id, list]) => [id, list.length]));
const inputRecipeCounts = new Map([...recipesByInput.entries()].map(([id, list]) => [id, list.length]));
const unproducibleReferencedGoods = [...referencedGoods].filter((id) => !recipesByOutput.has(id));
const unusedGoods = goods.filter((good) => !recipesByInput.has(good.id) && !recipesByOutput.has(good.id));
const unknownRecipeTypes = [...new Set(recipes.map((recipe) => recipe.type).filter((type) => !recipeTypesById.has(type)))];

printSection("Pack Metadata");
console.log(`File: ${filePath}`);
console.log(`Schema: ${data.schema ?? "missing"}`);
console.log(`Pack: ${data.metadata?.packName ?? "unknown"}`);
console.log(`Version: ${data.metadata?.packVersion ?? "unknown"}`);
console.log(`Minecraft: ${data.metadata?.minecraftVersion ?? "unknown"}`);
console.log(`Loader: ${data.metadata?.loader ?? "unknown"}`);
console.log(`Exported at: ${data.metadata?.exportedAt ?? "unknown"}`);

printSection("Top-Level Counts");
console.log(`Goods: ${formatNumber(goods.length)}`);
console.log(`Tags: ${formatNumber(tags.length)}`);
console.log(`Recipe types: ${formatNumber(recipeTypes.length)}`);
console.log(`Machines: ${formatNumber(machines.length)}`);
console.log(`Voltage tiers: ${formatNumber(voltageTiers.length)}`);
console.log(`Recipes: ${formatNumber(recipes.length)}`);

printSection("Goods By Kind");
for (const [kind, count] of topEntries(goodsByKind, 10)) {
  console.log(`${kind}: ${formatNumber(count)}`);
}

printSection("Top Goods Mods");
for (const [mod, count] of topEntries(goodsByMod, 20)) {
  console.log(`${mod}: ${formatNumber(count)}`);
}

printSection("Top Recipe Types");
for (const [type, count] of topEntries(recipesByType, 30)) {
  const name = recipeTypesById.get(type)?.name ?? type;
  console.log(`${name} (${type}): ${formatNumber(count)}`);
}

printSection("Planning-Relevant Features");
console.log(`Recipes using tags: ${formatNumber(recipesWithTags.length)}`);
console.log(`Recipes with fluid inputs/outputs: ${formatNumber(recipesWithFluidIo.length)}`);
console.log(`Recipes with chance outputs: ${formatNumber(recipesWithChanceOutputs.length)}`);
console.log(`Recipes with not-consumed inputs: ${formatNumber(recipesWithNotConsumedInputs.length)}`);
console.log(`Referenced goods with no producing recipe: ${formatNumber(unproducibleReferencedGoods.length)}`);
console.log(`Goods present but unused by any exported recipe: ${formatNumber(unusedGoods.length)}`);

printSection("Most Ambiguous Outputs");
for (const [id, count] of topEntries(outputRecipeCounts, 30).filter(([, count]) => count > 1)) {
  const good = goodsById.get(id);
  console.log(`${good?.name ?? id} (${id}): ${formatNumber(count)} recipes`);
}

printSection("Most Used Inputs");
for (const [id, count] of topEntries(inputRecipeCounts, 30)) {
  const good = goodsById.get(id);
  const tag = tagsById.get(id);
  const label = good?.name ?? (tag ? `#${tag.name}` : id);
  console.log(`${label} (${id}): used by ${formatNumber(count)} recipes`);
}

printSection("Potential Data Issues");
console.log(`Recipes without outputs: ${formatNumber(recipesWithoutOutputs.length)}`);
console.log(`Recipes without inputs: ${formatNumber(recipesWithoutInputs.length)}`);
console.log(`Unknown recipe types: ${formatNumber(unknownRecipeTypes.length)}`);
console.log(`Input goods missing from goods table: ${formatNumber(unknownGoods.size)}`);
console.log(`Output goods missing from goods table: ${formatNumber(outputsWithNoGood.size)}`);
console.log(`Referenced tags missing from tags table: ${formatNumber(unknownTags.size)}`);

if (unknownRecipeTypes.length > 0) {
  console.log("\nUnknown recipe type examples:");
  for (const type of unknownRecipeTypes.slice(0, 20)) {
    console.log(`- ${type}`);
  }
}

if (unknownGoods.size > 0) {
  console.log("\nMissing input good examples:");
  for (const [id, recipeIds] of [...unknownGoods.entries()].slice(0, 20)) {
    console.log(`- ${id}: ${recipeIds.slice(0, 3).join(", ")}${recipeIds.length > 3 ? " ..." : ""}`);
  }
}

if (outputsWithNoGood.size > 0) {
  console.log("\nMissing output good examples:");
  for (const [id, recipeIds] of [...outputsWithNoGood.entries()].slice(0, 20)) {
    console.log(`- ${id}: ${recipeIds.slice(0, 3).join(", ")}${recipeIds.length > 3 ? " ..." : ""}`);
  }
}

if (unknownTags.size > 0) {
  console.log("\nMissing tag examples:");
  for (const [id, recipeIds] of [...unknownTags.entries()].slice(0, 20)) {
    console.log(`- ${id}: ${recipeIds.slice(0, 3).join(", ")}${recipeIds.length > 3 ? " ..." : ""}`);
  }
}

printSection("Recommended Next Checks");
console.log("1. Validate this file with tools/validate-export.mjs.");
console.log("2. Open it in the browser with ?data=data/<file>.json.");
console.log("3. Search for common targets: LV Electric Motor, Basic Electronic Circuit, Steel Plate, Polyethylene.");
console.log("4. Check the ambiguous-output list first; those are where recipe-choice UI matters most.");
console.log("5. Check unproducible referenced goods; those become external inputs in the planner.");
