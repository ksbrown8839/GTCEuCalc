import { readFile } from "node:fs/promises";

const filePath = process.argv[2] ?? "data/sample-pack.json";
const data = JSON.parse(await readFile(filePath, "utf-8"));

const errors = [];
const warnings = [];

function error(message) {
  errors.push(message);
}

function warn(message) {
  warnings.push(message);
}

function requireArray(name) {
  if (!Array.isArray(data[name])) {
    error(`${name} must be an array.`);
    return [];
  }
  return data[name];
}

function isString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

if (data.schema !== "gtceu-planner-pack-v1") {
  error(`schema must be gtceu-planner-pack-v1, got ${JSON.stringify(data.schema)}.`);
}

for (const field of ["packId", "packName", "packVersion", "minecraftVersion", "loader", "exportedAt"]) {
  if (!isString(data.metadata?.[field])) {
    error(`metadata.${field} is required.`);
  }
}

const goods = requireArray("goods");
const tags = requireArray("tags");
const recipeTypes = requireArray("recipeTypes");
const machines = requireArray("machines");
const voltageTiers = requireArray("voltageTiers");
const recipes = requireArray("recipes");

const goodIds = new Set();
const tagIds = new Set();
const recipeTypeIds = new Set();

for (const good of goods) {
  if (!isString(good.id)) error("Every good needs an id.");
  if (!["item", "fluid"].includes(good.kind)) error(`${good.id} has unsupported kind ${good.kind}.`);
  if (!isString(good.name)) warn(`${good.id} is missing a display name.`);
  if (goodIds.has(good.id)) error(`Duplicate good id ${good.id}.`);
  goodIds.add(good.id);
}

for (const tag of tags) {
  if (!isString(tag.id)) error("Every tag needs an id.");
  if (!Array.isArray(tag.entries)) error(`${tag.id} entries must be an array.`);
  if (tagIds.has(tag.id)) error(`Duplicate tag id ${tag.id}.`);
  tagIds.add(tag.id);

  for (const entry of tag.entries ?? []) {
    if (!goodIds.has(entry)) warn(`${tag.id} entry ${entry} is not present in goods.`);
  }

  if (tag.preferred && !tag.entries?.includes(tag.preferred)) {
    warn(`${tag.id} preferred entry ${tag.preferred} is not listed in entries.`);
  }
}

for (const type of recipeTypes) {
  if (!isString(type.id)) error("Every recipe type needs an id.");
  if (recipeTypeIds.has(type.id)) error(`Duplicate recipe type id ${type.id}.`);
  recipeTypeIds.add(type.id);
}

for (const tier of voltageTiers) {
  if (!isString(tier.id)) error("Every voltage tier needs an id.");
  if (!isNumber(tier.voltage)) error(`${tier.id} voltage must be numeric.`);
}

for (const machine of machines) {
  if (machine.recipeType && !recipeTypeIds.has(machine.recipeType)) {
    warn(`${machine.id} refers to unknown recipe type ${machine.recipeType}.`);
  }
}

for (const recipe of recipes) {
  if (!isString(recipe.id)) error("Every recipe needs an id.");
  if (!recipeTypeIds.has(recipe.type)) warn(`${recipe.id} uses unknown recipe type ${recipe.type}.`);
  if (!isNumber(recipe.durationTicks)) error(`${recipe.id} durationTicks must be numeric.`);
  if (!isNumber(recipe.eut)) error(`${recipe.id} eut must be numeric.`);
  if (!Array.isArray(recipe.inputs)) error(`${recipe.id} inputs must be an array.`);
  if (!Array.isArray(recipe.outputs)) error(`${recipe.id} outputs must be an array.`);
  if (Array.isArray(recipe.outputs) && recipe.outputs.length === 0) warn(`${recipe.id} has no outputs.`);

  for (const ingredient of [...(recipe.inputs ?? []), ...(recipe.outputs ?? [])]) {
    if (!["item", "fluid", "tag"].includes(ingredient.kind)) {
      error(`${recipe.id} has unsupported ingredient kind ${ingredient.kind}.`);
    }
    if (!isString(ingredient.id)) error(`${recipe.id} has an ingredient without an id.`);
    if (!isNumber(ingredient.amount) || ingredient.amount <= 0) {
      error(`${recipe.id} ingredient ${ingredient.id} needs a positive numeric amount.`);
    }
    if ((ingredient.kind === "item" || ingredient.kind === "fluid") && !goodIds.has(ingredient.id)) {
      warn(`${recipe.id} references ${ingredient.id}, but it is not present in goods.`);
    }
    if (ingredient.kind === "tag" && !tagIds.has(ingredient.id)) {
      warn(`${recipe.id} references tag ${ingredient.id}, but it is not present in tags.`);
    }
    if (ingredient.chance !== undefined && (!isNumber(ingredient.chance) || ingredient.chance < 0 || ingredient.chance > 1)) {
      error(`${recipe.id} ingredient ${ingredient.id} has an invalid chance.`);
    }
  }
}

if (warnings.length > 0) {
  for (const warning of warnings.slice(0, 20)) {
    console.warn(`Warning: ${warning}`);
  }
  if (warnings.length > 20) {
    console.warn(`Warning: ${warnings.length - 20} additional warnings omitted.`);
  }
}

if (errors.length > 0) {
  for (const validationError of errors.slice(0, 50)) {
    console.error(`Error: ${validationError}`);
  }
  if (errors.length > 50) {
    console.error(`Error: ${errors.length - 50} additional errors omitted.`);
  }
  process.exit(1);
}

console.log(
  `Validated ${filePath}: ${recipes.length} recipes, ${goods.length} goods, ${tags.length} tags, ${warnings.length} warnings.`
);
