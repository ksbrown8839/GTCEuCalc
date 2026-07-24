const PROCESS_COMPLEXITY_PENALTIES = new Map([
  ["gtceu:large_chemical_reactor", 2_500],
  ["gtceu:distillation_tower", 2_500],
  ["gtceu:fusion_reactor", 10_000]
]);

export class Repository {
  constructor(data) {
    if (data.schema !== "gtceu-planner-pack-v1") {
      throw new Error(`Unsupported data schema: ${data.schema}`);
    }

    this.data = data;
    this.metadata = data.metadata;
    this.goods = new Map(data.goods.map((good) => [good.id, normalizeGood(good)]));
    this.tags = new Map(data.tags.map((tag) => [tag.id, tag]));
    this.recipeTypes = new Map(data.recipeTypes.map((type) => [type.id, type]));
    this.voltageTiers = new Map(data.voltageTiers.map((tier) => [tier.id, tier]));
    this.voltageTierList = [...data.voltageTiers].sort((a, b) => a.voltage - b.voltage);
    this.machines = new Map();
    this.machinesByRecipeType = new Map();
    this.recipes = data.recipes;
    this.recipesByOutput = new Map();
    this.recipesByInput = new Map();

    for (const machine of data.machines ?? []) {
      const recipeTypes = machine.recipeTypes ?? (machine.recipeType ? [machine.recipeType] : []);
      const normalized = { ...machine, recipeTypes };
      this.machines.set(normalized.id, normalized);
      for (const recipeType of recipeTypes) {
        this.addToIndex(this.machinesByRecipeType, recipeType, normalized);
      }
    }

    for (const recipe of this.recipes) {
      for (const output of recipe.outputs) {
        this.addToIndex(this.recipesByOutput, output.id, recipe);
      }
      for (const input of recipe.inputs) {
        this.addToIndex(this.recipesByInput, input.id, recipe);
      }
    }
  }

  addToIndex(index, id, recipe) {
    const list = index.get(id) ?? [];
    list.push(recipe);
    index.set(id, list);
  }

  getGood(id) {
    return this.goods.get(id) ?? null;
  }

  getRecipeType(id) {
    if (id === "gtceu:multiblock_structure") {
      return { id, name: "Multiblock Structure", category: "structure" };
    }
    return this.recipeTypes.get(id) ?? { id, name: id, category: "unknown" };
  }

  getVoltageTier(id) {
    return this.voltageTiers.get(id) ?? null;
  }

  getVoltageTierForEut(eut) {
    const requiredVoltage = Math.abs(eut ?? 0);
    if (!requiredVoltage) return null;
    return [...this.voltageTiers.values()].find((tier) => tier.voltage >= requiredVoltage) ?? null;
  }

  getMachinesForRecipeType(recipeType) {
    return this.machinesByRecipeType.get(recipeType) ?? [];
  }

  getVoltageTierDistance(fromTier, toTier) {
    if (!fromTier || !toTier) return 0;
    const fromIndex = this.voltageTierList.findIndex((tier) => tier.id === fromTier.id);
    const toIndex = this.voltageTierList.findIndex((tier) => tier.id === toTier.id);
    if (fromIndex < 0 || toIndex < 0) return 0;
    return Math.max(0, toIndex - fromIndex);
  }

  chooseMachineForRecipe(recipe, preferences = {}) {
    const requiredVoltageTier = this.getVoltageTierForEut(recipe.eut);
    const preferredTier = this.getVoltageTier(preferences.machineTierByRecipeType?.[recipe.type]);
    const requestedVoltageTier = preferredTier
      && (!requiredVoltageTier || preferredTier.voltage >= requiredVoltageTier.voltage)
      ? preferredTier
      : requiredVoltageTier;
    const candidates = this.getMachinesForRecipeType(recipe.type);
    const tiered = candidates
      .filter((machine) => {
        const tier = this.getVoltageTier(machine.voltageTier);
        return tier && (!requestedVoltageTier || tier.voltage >= requestedVoltageTier.voltage);
      })
      .sort((a, b) => this.getVoltageTier(a.voltageTier).voltage - this.getVoltageTier(b.voltageTier).voltage);
    const machine = tiered.find((candidate) => candidate.voltageTier === requestedVoltageTier?.id)
      ?? tiered[0]
      ?? candidates.find((candidate) => !candidate.voltageTier)
      ?? candidates[0]
      ?? null;

    return {
      machine,
      voltageTier: machine?.voltageTier ? this.getVoltageTier(machine.voltageTier) : requestedVoltageTier,
      minimumVoltageTier: requiredVoltageTier
    };
  }

  getTag(id) {
    return this.tags.get(id) ?? null;
  }

  getGoodName(id) {
    return this.getGood(id)?.name ?? virtualGoodName(id) ?? id;
  }

  getIngredientName(ingredient) {
    if (ingredient.kind === "tag") {
      const tag = this.getTag(ingredient.id);
      const fallback = virtualGoodName(ingredient.id);
      return tag ? `#${tag.name}` : (fallback ?? `#${ingredient.id}`);
    }
    return this.getGoodName(ingredient.id);
  }

  getIngredientColor(ingredient) {
    if (ingredient.kind === "tag") {
      const resolved = this.resolveIngredient(ingredient);
      return resolved.good?.color ?? "#7d8790";
    }
    return this.getGood(ingredient.id)?.color ?? "#7d8790";
  }

  resolveIngredient(ingredient) {
    if (ingredient.kind !== "tag") {
      return {
        ingredient,
        id: ingredient.id,
        good: this.getGood(ingredient.id),
        warning: null
      };
    }

    const tag = this.getTag(ingredient.id);
    const selected = tag?.preferred ?? tag?.entries?.[0];
    return {
      ingredient,
      id: selected ?? ingredient.id,
      good: selected ? this.getGood(selected) : null,
      warning: selected
        ? `Used ${this.getGoodName(selected)} for #${ingredient.id}`
        : `No item available for #${ingredient.id}`
    };
  }

  findRecipesProducing(goodsId) {
    return this.recipesByOutput.get(goodsId) ?? [];
  }

  findRecipesUsing(goodsId) {
    return this.recipesByInput.get(goodsId) ?? [];
  }

  findRecipesUsingGood(goodsId) {
    const good = this.getGood(goodsId);
    const inputIds = new Set([goodsId, ...(good?.tags ?? [])]);
    const recipes = new Map();
    for (const inputId of inputIds) {
      for (const recipe of this.findRecipesUsing(inputId)) {
        recipes.set(recipe.id, recipe);
      }
    }
    return [...recipes.values()];
  }

  ingredientMatchesGood(ingredient, goodsId) {
    if (ingredient.id === goodsId) return true;
    if (ingredient.kind !== "tag") return false;
    const good = this.getGood(goodsId);
    return Boolean(good?.tags?.includes(ingredient.id));
  }

  chooseRecipeForOutput(goodsId, preferences = {}, options = {}) {
    const preferredRecipe = preferences[goodsId];
    const recipes = this.findRecipesProducing(goodsId);
    if (preferredRecipe) {
      const match = recipes.find((recipe) => recipe.id === preferredRecipe);
      if (match) return match;
    }
    return this.rankRecipesForOutput(goodsId, options)[0] ?? null;
  }

  rankRecipesForOutput(goodsId, options = {}) {
    const avoidGoods = new Set(options.avoidGoods ?? []);

    return this.findRecipesProducing(goodsId)
      .map((recipe, index) => ({
        recipe,
        index,
        score: scoreRecipeForOutput(this, goodsId, recipe, avoidGoods)
      }))
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .map((candidate) => candidate.recipe);
  }

  searchGoods(query, limit = 80) {
    const normalized = query.trim().toLowerCase();
    const goods = [...this.goods.values()];
    if (!normalized) return goods.slice(0, limit);

    return goods
      .map((good) => {
        return {
          good,
          score: scoreGoodSearchMatch(good, normalized)
        };
      })
      .filter((match) => match.score !== null)
      .sort((a, b) => a.score - b.score || a.good.name.localeCompare(b.good.name) || a.good.id.localeCompare(b.good.id))
      .slice(0, limit)
      .map((match) => match.good);
  }

  searchRecipes(query) {
    const normalized = query.trim().toLowerCase();
    const recipes = this.recipes;
    if (!normalized) return recipes.slice(0, 80);

    return recipes
      .filter((recipe) => {
        const type = this.getRecipeType(recipe.type).name.toLowerCase();
        const outputs = recipe.outputs.map((output) => this.getGoodName(output.id).toLowerCase()).join(" ");
        const inputs = recipe.inputs.map((input) => this.getIngredientName(input).toLowerCase()).join(" ");
        return recipe.id.toLowerCase().includes(normalized) || type.includes(normalized) || outputs.includes(normalized) || inputs.includes(normalized);
      })
      .slice(0, 80);
  }
}

function normalizeGood(good) {
  return {
    ...good,
    name: stripMinecraftFormatting(good.name)
  };
}

function stripMinecraftFormatting(value) {
  return String(value).replace(/§[0-9a-fk-or]/gi, "");
}

function virtualGoodName(id) {
  const tool = /^gtceu:tools\/crafting_(.+)$/.exec(id);
  if (!tool) return null;

  const toolNames = {
    hammers: "Crafting Hammer",
    wrenches: "Crafting Wrench",
    files: "Crafting File",
    screwdrivers: "Crafting Screwdriver",
    mallets: "Crafting Mallet",
    saws: "Crafting Saw",
    wire_cutters: "Wire Cutter",
    knives: "Crafting Knife",
    crowbars: "Crowbar"
  };

  return toolNames[tool[1]] ?? titleFromVirtualId(tool[1]);
}

function titleFromVirtualId(value) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(" ");
}

function scoreGoodSearchMatch(good, query) {
  const name = good.name.toLowerCase();
  const id = good.id.toLowerCase();
  const mod = good.mod.toLowerCase();
  const tags = good.tags ?? [];

  if (name === query || id === query) return 0;
  if (name.startsWith(query)) return 1;
  if (id.startsWith(query)) return 2;
  if (name.includes(query)) return 3;
  if (id.includes(query)) return 4;
  if (tags.some((tag) => tag.toLowerCase().includes(query))) return 5;
  if (mod.includes(query)) return 6;
  return null;
}

function scoreRecipeForOutput(repository, goodsId, recipe, avoidGoods) {
  const outputIndex = recipe.outputs.findIndex((output) => output.id === goodsId);
  const outputForm = materialFormForId(goodsId);
  const inputs = recipe.inputs.filter((input) => !input.notConsumed);
  const inputForms = inputs.map((input) => materialFormForIngredient(repository, input));
  const directMaterialMaceration = isDirectMaterialMaceration(repository, outputForm, recipe, inputs, outputIndex);
  let score = outputIndex > 0 ? 20_000 + outputIndex * 1_000 : 0;

  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    const resolved = repository.resolveIngredient(input);
    const inputForm = inputForms[index];

    if (avoidGoods.has(resolved.id)) score += 50_000;
    if (isReverseMaterialConversion(outputForm, inputForm)) score += 10_000;
    if (isTransformedMaterial(input.id)) score += 100;
  }

  if (recipe.type === "gtceu:arc_furnace") score += 4_000;
  if (recipe.type === "gtceu:extractor") score += 3_000;
  if (recipe.type === "gtceu:macerator" && !inputs.some(isOreProcessingIngredient) && !directMaterialMaceration) score += 3_000;
  if (directMaterialMaceration) score -= 1_200;
  if (/disassembl|recycl/i.test(recipe.id)) score += 3_000;
  score += processComplexityPenalty(recipe.type);

  score += forwardProductionBonus(outputForm, recipe, inputForms);
  return score;
}

function processComplexityPenalty(recipeType) {
  return PROCESS_COMPLEXITY_PENALTIES.get(recipeType) ?? 0;
}

function forwardProductionBonus(outputForm, recipe, inputForms) {
  if (!outputForm) return 0;

  const identityMatchesMaterial = recipe.id.includes(outputForm.material);
  const hasSameMaterialCleanDust = inputForms.some((input) => {
    return sameMaterial(outputForm, input) && input.form === "dust";
  });
  const hasSameMaterialDust = inputForms.some((input) => {
    return sameMaterial(outputForm, input) && ["dust", "impure_dust", "pure_dust"].includes(input.form);
  });
  const hasSameMaterialPackingInput = inputForms.some((input) => {
    return sameMaterial(outputForm, input) && ["nugget", "block", "fluid"].includes(input.form);
  });
  const hasSameMaterialOreProcessingInput = inputForms.some((input) => {
    return sameMaterial(outputForm, input) && ["impure_dust", "pure_dust", "refined_ore"].includes(input.form);
  });

  if (outputForm.form === "ingot") {
    if (recipe.type === "gtceu:alloy_smelter" && identityMatchesMaterial && recipe.inputs.filter((input) => !input.notConsumed).length > 1 && !hasSameMaterialPackingInput) return -1_400;
    if (recipe.type === "gtceu:primitive_blast_furnace" && identityMatchesMaterial && !hasSameMaterialPackingInput) return -1_300;
    if (recipe.type === "gtceu:electric_blast_furnace" && identityMatchesMaterial && !hasSameMaterialDust && !hasSameMaterialPackingInput) return -1_200;
    if (hasSameMaterialCleanDust) return -1_100;
    if (hasSameMaterialDust) return -1_000;
    if (recipe.type === "minecraft:smelting" && recipe.inputs.some(isOreProcessingIngredient)) return -300;
  }

  if (outputForm.form === "dust") {
    if (recipe.type === "gtceu:mixer") return -1_400;
    if (hasSameMaterialOreProcessingInput) return -1_100;
  }

  if (outputForm.form === "nugget" && inputForms.some((input) => sameMaterial(outputForm, input) && input.form === "ingot")) {
    return -300;
  }

  return 0;
}

function isDirectMaterialMaceration(repository, outputForm, recipe, inputs, outputIndex) {
  if (recipe.type !== "gtceu:macerator" || outputIndex !== 0 || outputForm?.form !== "dust") return false;
  return inputs.some((input) => {
    const resolved = repository.resolveIngredient(input);
    return [recipe.id, input.id, resolved.id].some((id) => includesMaterialToken(id, outputForm.material));
  });
}

function includesMaterialToken(id, material) {
  const value = normalizeMaterialToken(id);
  const token = normalizeMaterialToken(material);
  if (!value || !token) return false;
  return new RegExp(`(^|_)${escapeRegExp(token)}($|_)`).test(value);
}

function normalizeMaterialToken(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isReverseMaterialConversion(output, input) {
  if (!sameMaterial(output, input)) return false;

  if (output.form === "ingot") return ["nugget", "block", "fluid"].includes(input.form);
  if (output.form === "dust") return ["ingot", "nugget", "block"].includes(input.form);
  return false;
}

function sameMaterial(a, b) {
  return Boolean(a && b && a.material === b.material);
}

function isTransformedMaterial(id) {
  return /(?:^|[/:_])(annealed|magnetic)_/.test(id);
}

function isOreProcessingIngredient(ingredient) {
  return /(?:^|[/:_])(raw_materials|crushed_ores|purified_ores|refined_ores|impure_dusts|pure_dusts)(?:[/:_]|$)|_ore$/.test(ingredient.id);
}

function materialFormForIngredient(repository, ingredient) {
  const materialForm = materialFormForId(ingredient.id);
  if (materialForm) return materialForm;

  const tag = ingredient.kind === "tag" ? repository.getTag(ingredient.id) : null;
  const fluidMatch = tag?.kind === "fluid" ? ingredient.id.match(/^[^:]+:([^/]+)$/) : null;
  return fluidMatch ? { material: fluidMatch[1], form: "fluid" } : null;
}

function materialFormForId(id) {
  const patterns = [
    [/^[^:]+:tiny_dusts\/(.+)$/, "tiny_dust"],
    [/^[^:]+:small_dusts\/(.+)$/, "small_dust"],
    [/^[^:]+:impure_dusts\/(.+)$/, "impure_dust"],
    [/^[^:]+:pure_dusts\/(.+)$/, "pure_dust"],
    [/^[^:]+:dusts\/(.+)$/, "dust"],
    [/^[^:]+:nuggets\/(.+)$/, "nugget"],
    [/^[^:]+:ingots\/(.+)$/, "ingot"],
    [/^[^:]+:storage_blocks\/(.+)$/, "block"],
    [/^[^:]+:raw_materials\/(.+)$/, "raw_material"],
    [/^[^:]+:crushed_ores\/(.+)$/, "crushed_ore"],
    [/^[^:]+:purified_ores\/(.+)$/, "purified_ore"],
    [/^[^:]+:refined_ores\/(.+)$/, "refined_ore"],
    [/^[^:]+:impure_(.+)_dust$/, "impure_dust"],
    [/^[^:]+:pure_(.+)_dust$/, "pure_dust"],
    [/^[^:]+:tiny_(.+)_dust$/, "tiny_dust"],
    [/^[^:]+:small_(.+)_dust$/, "small_dust"],
    [/^[^:]+:crushed_(.+)_ore$/, "crushed_ore"],
    [/^[^:]+:purified_(.+)_ore$/, "purified_ore"],
    [/^[^:]+:refined_(.+)_ore$/, "refined_ore"],
    [/^[^:]+:(.+)_nugget$/, "nugget"],
    [/^[^:]+:(.+)_ingot$/, "ingot"],
    [/^[^:]+:(.+)_dust$/, "dust"],
    [/^[^:]+:(.+)_block$/, "block"]
  ];

  for (const [pattern, form] of patterns) {
    const match = id.match(pattern);
    if (match) return { material: match[1], form };
  }

  return null;
}

export async function loadRepository(url = "data/sample-pack.json") {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load pack data: ${response.status}`);
  }
  const data = await response.json();
  return new Repository(data);
}
