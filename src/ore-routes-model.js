const ROUTE_STAGE_DEFINITIONS = [
  { id: "ore", label: "Ore", order: 0 },
  { id: "raw_material", label: "Raw Material", order: 1 },
  { id: "crushed_ore", label: "Crushed Ore", order: 2 },
  { id: "purified_ore", label: "Purified Ore", order: 3 },
  { id: "refined_ore", label: "Refined Ore", order: 4 },
  { id: "impure_dust", label: "Impure Dust", order: 5 },
  { id: "pure_dust", label: "Pure Dust", order: 6 },
  { id: "dust", label: "Dust", order: 7 },
  { id: "gem", label: "Gem", order: 8 },
  { id: "ingot", label: "Ingot", order: 9 }
];

const ROUTE_STAGES = new Map(ROUTE_STAGE_DEFINITIONS.map((stage) => [stage.id, stage]));

const ROUTE_GROUPS = [
  { id: "ore", label: "Ore Sources", note: "Direct smelting, hammers, and macerators" },
  { id: "raw_material", label: "Raw Material", note: "Raw ore conversion routes" },
  { id: "crushed_ore", label: "Crushed Ore Branches", note: "Washing, chemical bathing, thermal centrifuging, and dust routes" },
  { id: "purified_ore", label: "Purified Ore Branches", note: "Pure-dust, refined-ore, and specialist routes" },
  { id: "refined_ore", label: "Refined Ore", note: "Final refined-ore processing" },
  { id: "impure_dust", label: "Impure Dust Cleanup", note: "Centrifuge and washer cleanup choices" },
  { id: "pure_dust", label: "Pure Dust Cleanup", note: "Centrifuge and washer cleanup choices" },
  { id: "dust", label: "Dust Finishing", note: "Smelting and other final material routes" },
  { id: "gem", label: "Gem Finishing", note: "Gem conversion routes" }
];

export function getOreRouteMaterials(repository) {
  const materials = new Set();

  for (const tagId of repository.tags.keys()) {
    const match = tagId.match(/^[^:]+:(?:crushed_ores|purified_ores|refined_ores)\/(.+)$/);
    if (match) materials.add(match[1]);
  }

  return [...materials]
    .map((id) => ({ id, name: formatMaterialName(id) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function buildOreRoute(repository, material) {
  const steps = [];

  for (const recipe of repository.recipes) {
    const inputs = recipe.inputs
      .filter((ingredient) => !ingredient.notConsumed)
      .map((ingredient) => classifyOreRouteIngredient(repository, ingredient, material))
      .filter(Boolean);
    const outputs = recipe.outputs
      .map((ingredient) => classifyOreRouteIngredient(repository, ingredient, material))
      .filter(Boolean);

    if (!inputs.length || !outputs.length) continue;

    const inputStage = inputs.reduce(maximumStage, inputs[0]);
    const outputStage = primaryOutputStage(inputStage, outputs);
    if (outputStage.order <= inputStage.order) continue;

    steps.push({
      recipe,
      inputStage: inputStage.form,
      outputStage: outputStage.form
    });
  }

  steps.sort((a, b) => {
    return stageOrder(a.inputStage) - stageOrder(b.inputStage)
      || stageOrder(a.outputStage) - stageOrder(b.outputStage)
      || a.recipe.type.localeCompare(b.recipe.type)
      || a.recipe.id.localeCompare(b.recipe.id);
  });

  const groups = ROUTE_GROUPS
    .map((group) => ({
      ...group,
      steps: steps.filter((step) => step.inputStage === group.id)
    }))
    .filter((group) => group.steps.length);

  const stages = ROUTE_STAGE_DEFINITIONS
    .map((stage) => ({
      ...stage,
      examples: stageExamples(repository, steps, stage.id, material)
    }))
    .filter((stage) => stage.examples.length);

  return {
    material,
    name: formatMaterialName(material),
    groups,
    stages,
    steps
  };
}

export function buildOreFlowGraph(repository, material, options = {}) {
  const route = buildOreRoute(repository, material);
  const terminalStage = routeTerminalStage(route.steps);
  const groupedSteps = new Map();

  for (const step of route.steps) {
    if (!options.showHammerRoutes && isHammerRoute(step.recipe)) continue;
    if (!options.showQuickSmelts && isQuickSmeltShortcut(step, terminalStage)) continue;

    const key = `${step.inputStage}->${step.outputStage}|${step.recipe.type}`;
    const variants = groupedSteps.get(key) ?? [];
    variants.push(step);
    groupedSteps.set(key, variants);
  }

  const operations = [...groupedSteps.entries()]
    .map(([key, variants]) => {
      const representative = [...variants].sort((a, b) => {
        return representativeRecipeScore(a.recipe, material) - representativeRecipeScore(b.recipe, material)
          || a.recipe.id.localeCompare(b.recipe.id);
      })[0];

      return {
        id: operationId(key),
        key,
        inputStage: representative.inputStage,
        outputStage: representative.outputStage,
        recipeType: representative.recipe.type,
        recipe: representative.recipe,
        variants,
        isQuickSmelt: isQuickSmeltShortcut(representative, terminalStage),
        isFallbackRoute: isHammerRoute(representative.recipe)
      };
    })
    .sort((a, b) => {
      return stageOrder(a.inputStage) - stageOrder(b.inputStage)
        || stageOrder(a.outputStage) - stageOrder(b.outputStage)
        || a.recipeType.localeCompare(b.recipeType);
    });

  const usedStages = new Set(operations.flatMap((operation) => [operation.inputStage, operation.outputStage]));
  const stages = route.stages.filter((stage) => usedStages.has(stage.id));
  const routeStrategy = options.routeStrategy === "fast" ? "fast" : "yield";
  const recommendedPath = findRecommendedPath(repository, material, operations, routeStrategy, terminalStage);
  const recommendedOperationIds = recommendedPath.map((operation) => operation.id);
  const recommendedIds = new Set(recommendedOperationIds);
  const recommendedStageIds = [...new Set(recommendedPath.flatMap((operation) => [operation.inputStage, operation.outputStage]))];
  const processingOperations = operations.filter((operation) => !operation.isQuickSmelt && !operation.isFallbackRoute);

  return {
    ...route,
    stages,
    operations: operations.map((operation) => ({
      ...operation,
      recommended: recommendedIds.has(operation.id)
    })),
    recommendedOperationIds,
    recommendedStageIds,
    recommendedByproducts: aggregateByproducts(repository, material, recommendedPath),
    possibleByproducts: aggregatePossibleByproducts(repository, material, processingOperations),
    terminalStage,
    routeStrategy
  };
}

export function classifyOreRouteIngredient(repository, ingredient, material) {
  const knownForm = knownMaterialFormForId(ingredient.id, material)
    ?? knownMaterialFormFromGoodTags(repository, ingredient.id, material);
  if (!knownForm) return null;

  const stage = ROUTE_STAGES.get(knownForm);
  if (!stage) return null;

  return {
    ingredient,
    form: knownForm,
    order: stage.order
  };
}

function knownMaterialFormForId(id, material) {
  const escapedMaterial = escapeRegExp(material);
  const patterns = [
    [new RegExp(`^[^:]+:raw_materials/${escapedMaterial}$`), "raw_material"],
    [new RegExp(`^[^:]+:crushed_ores/${escapedMaterial}$`), "crushed_ore"],
    [new RegExp(`^[^:]+:purified_ores/${escapedMaterial}$`), "purified_ore"],
    [new RegExp(`^[^:]+:refined_ores/${escapedMaterial}$`), "refined_ore"],
    [new RegExp(`^[^:]+:impure_dusts/${escapedMaterial}$`), "impure_dust"],
    [new RegExp(`^[^:]+:pure_dusts/${escapedMaterial}$`), "pure_dust"],
    [new RegExp(`^[^:]+:dusts/${escapedMaterial}$`), "dust"],
    [new RegExp(`^[^:]+:gems/${escapedMaterial}$`), "gem"],
    [new RegExp(`^[^:]+:ingots/${escapedMaterial}$`), "ingot"],
    [new RegExp(`^[^:]+:raw_${escapedMaterial}$`), "raw_material"],
    [new RegExp(`^[^:]+:crushed_${escapedMaterial}_ore$`), "crushed_ore"],
    [new RegExp(`^[^:]+:purified_${escapedMaterial}_ore$`), "purified_ore"],
    [new RegExp(`^[^:]+:refined_${escapedMaterial}_ore$`), "refined_ore"],
    [new RegExp(`^[^:]+:impure_${escapedMaterial}_dust$`), "impure_dust"],
    [new RegExp(`^[^:]+:pure_${escapedMaterial}_dust$`), "pure_dust"],
    [new RegExp(`^[^:]+:${escapedMaterial}_dust$`), "dust"],
    [new RegExp(`^[^:]+:${escapedMaterial}_gem$`), "gem"],
    [new RegExp(`^[^:]+:${escapedMaterial}_ingot$`), "ingot"],
    [new RegExp(`^[^:]+:(?:[a-z0-9_]+_)?${escapedMaterial}_ore$`), "ore"]
  ];

  for (const [pattern, form] of patterns) {
    if (pattern.test(id)) return form;
  }

  return null;
}

function knownMaterialFormFromGoodTags(repository, goodsId, material) {
  const good = repository.getGood(goodsId);
  for (const tagId of good?.tags ?? []) {
    const form = knownMaterialFormForId(tagId, material);
    if (form) return form;
  }
  return null;
}

function stageExamples(repository, steps, form, material) {
  const ids = [];

  for (const step of steps) {
    for (const ingredient of [...step.recipe.inputs, ...step.recipe.outputs]) {
      const classified = classifyOreRouteIngredient(repository, ingredient, material);
      if (classified?.form !== form) continue;
      const resolved = repository.resolveIngredient(ingredient);
      if (!resolved.good || ids.includes(resolved.id)) continue;
      ids.push(resolved.id);
    }
  }

  return ids
    .sort((a, b) => stageExampleScore(a, material) - stageExampleScore(b, material) || a.localeCompare(b))
    .slice(0, 3);
}

function maximumStage(a, b) {
  return a.order >= b.order ? a : b;
}

function primaryOutputStage(inputStage, outputs) {
  const advancingOutputs = outputs.filter((output) => output.order > inputStage.order);
  if (!advancingOutputs.length) return outputs.reduce(maximumStage, outputs[0]);

  return [...advancingOutputs].sort((a, b) => primaryOutputScore(inputStage, a) - primaryOutputScore(inputStage, b))[0];
}

function primaryOutputScore(inputStage, output) {
  const chance = output.ingredient.chance ?? 1;
  const chancePenalty = chance >= 1 ? 0 : 100;
  return chancePenalty + output.order - inputStage.order;
}

function stageOrder(id) {
  return ROUTE_STAGES.get(id)?.order ?? Number.MAX_SAFE_INTEGER;
}

function isHammerRoute(recipe) {
  return recipe.type === "gtceu:forge_hammer" || recipe.type.includes("crafting");
}

function isQuickSmeltShortcut(step, terminalStage) {
  if (step.outputStage !== terminalStage) return false;
  if (step.recipe.type === "gtceu:sifter") return false;
  if (terminalStage === "dust") {
    if (["minecraft:smelting", "minecraft:blasting"].includes(step.recipe.type)) return step.inputStage !== terminalStage;
    return ["ore", "raw_material", "crushed_ore"].includes(step.inputStage);
  }
  return ["ingot", "gem"].includes(terminalStage) && step.inputStage !== "dust";
}

function findRecommendedPath(repository, material, operations, strategy, terminalStage) {
  const allowedOperations = operations.filter((operation) => {
    if (isHammerRoute(operation.recipe)) return false;
    return strategy === "fast" || !operation.isQuickSmelt;
  });
  const sourceStage = recommendedSourceStage(allowedOperations);
  const operationsByInput = new Map();

  for (const operation of allowedOperations) {
    const candidates = operationsByInput.get(operation.inputStage) ?? [];
    candidates.push(operation);
    operationsByInput.set(operation.inputStage, candidates);
  }

  const memo = new Map();
  const bestFrom = (stage) => {
    if (stage === terminalStage) return { score: 0, operations: [] };
    if (memo.has(stage)) return memo.get(stage);

    let best = null;
    for (const operation of operationsByInput.get(stage) ?? []) {
      const tail = bestFrom(operation.outputStage);
      if (!tail) continue;
      const score = recommendationScore(repository, material, operation, strategy) + tail.score;
      if (!best || score > best.score) {
        best = { score, operations: [operation, ...tail.operations] };
      }
    }

    memo.set(stage, best);
    return best;
  };

  return bestFrom(sourceStage)?.operations ?? [];
}

function recommendedSourceStage(operations) {
  if (operations.some((operation) => operation.inputStage === "ore")) return "ore";
  if (operations.some((operation) => operation.inputStage === "raw_material")) return "raw_material";
  return operations
    .map((operation) => operation.inputStage)
    .sort((a, b) => stageOrder(a) - stageOrder(b))[0] ?? "ore";
}

function routeTerminalStage(steps) {
  if (steps.some((step) => step.outputStage === "ingot")) return "ingot";
  if (steps.some((step) => step.outputStage === "gem")) return "gem";
  if (steps.some((step) => step.outputStage === "dust")) return "dust";
  return steps
    .map((step) => step.outputStage)
    .sort((a, b) => stageOrder(b) - stageOrder(a))[0] ?? "dust";
}

function recommendationScore(repository, material, operation, strategy) {
  if (strategy === "fast") {
    const duration = Number(operation.recipe.durationTicks) || 1;
    return -duration - 20;
  }

  const byproducts = secondaryOutputsForOperation(repository, material, operation);
  const byproductAmount = byproducts.reduce((total, output) => {
    return total + (Number(output.amount) || 1) * (output.chance ?? 1);
  }, 0);
  const machineBonus = {
    "gtceu:chemical_bath": 12,
    "gtceu:thermal_centrifuge": 10,
    "gtceu:sifter": 9,
    "gtceu:centrifuge": 7,
    "gtceu:macerator": 6,
    "gtceu:ore_washer": 4
  }[operation.recipe.type] ?? 0;

  return byproducts.length * 20
    + Math.min(byproductAmount, 10) * 2
    + machineBonus
    + stageOrder(operation.outputStage) - stageOrder(operation.inputStage);
}

function aggregateByproducts(repository, material, operations) {
  const totals = new Map();
  let materialAmount = 1;

  for (const operation of operations) {
    const inputAmount = materialInputAmount(repository, material, operation);
    const runs = materialAmount / inputAmount;
    for (const output of secondaryOutputsForOperation(repository, material, operation)) {
      const existing = totals.get(output.id) ?? { ...output, amount: 0, expected: true };
      existing.amount += runs * (Number(output.amount) || 1) * (output.chance ?? 1);
      totals.set(output.id, existing);
    }
    materialAmount = materialOutputAmount(repository, material, operation) * runs;
  }

  return [...totals.values()].sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
}

function aggregatePossibleByproducts(repository, material, operations) {
  const totals = new Map();

  for (const operation of operations) {
    for (const output of secondaryOutputsForOperation(repository, material, operation)) {
      const expectedAmount = (Number(output.amount) || 1) * (output.chance ?? 1);
      const existing = totals.get(output.id) ?? {
        ...output,
        amount: 0,
        possible: true,
        routeCount: 0,
        maxChance: 0,
        recipeTypes: new Set()
      };
      existing.amount = Math.max(existing.amount, expectedAmount);
      existing.routeCount += 1;
      existing.maxChance = Math.max(existing.maxChance, output.chance ?? 1);
      existing.recipeTypes.add(operation.recipeType);
      totals.set(output.id, existing);
    }
  }

  return [...totals.values()]
    .map((output) => ({
      ...output,
      recipeTypes: [...output.recipeTypes].sort()
    }))
    .sort((a, b) => b.routeCount - a.routeCount || b.amount - a.amount || a.id.localeCompare(b.id));
}

function materialInputAmount(repository, material, operation) {
  const input = operation.recipe.inputs.find((ingredient) => {
    if (ingredient.notConsumed) return false;
    return classifyOreRouteIngredient(repository, ingredient, material)?.form === operation.inputStage;
  });
  return Number(input?.amount) || 1;
}

function materialOutputAmount(repository, material, operation) {
  return operation.recipe.outputs.reduce((total, output) => {
    if (classifyOreRouteIngredient(repository, output, material)?.form !== operation.outputStage) return total;
    return total + (Number(output.amount) || 1) * (output.chance ?? 1);
  }, 0) || 1;
}

function secondaryOutputsForOperation(repository, material, operation) {
  let skippedPrimary = false;
  return operation.recipe.outputs.filter((output) => {
    const classified = classifyOreRouteIngredient(repository, output, material);
    if (!skippedPrimary && classified?.form === operation.outputStage) {
      skippedPrimary = true;
      return false;
    }
    return true;
  });
}

function representativeRecipeScore(recipe, material) {
  let score = recipe.id.length;
  const escapedMaterial = escapeRegExp(material);

  if (recipe.inputs.some((ingredient) => ingredient.id === `gtceu:${material}_ore` || ingredient.id === `minecraft:${material}_ore`)) {
    score -= 1_000;
  }
  if (new RegExp(`/(?:macerate|hammer|smelt)_${escapedMaterial}_`).test(recipe.id)) score -= 300;
  if (recipe.id.includes("_distilled")) score += 100;
  if (recipe.id.includes("_fast")) score += 200;
  return score;
}

function stageExampleScore(id, material) {
  if (id === `gtceu:${material}_ore` || id === `minecraft:${material}_ore`) return -1_000;
  if (id === `gtceu:${material}_dust` || id === `minecraft:${material}` || id === `minecraft:${material}_ingot`) return -900;
  if (id === `gtceu:${material}_ingot`) return -800;
  return id.length;
}

function operationId(key) {
  return key.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function formatMaterialName(material) {
  return material
    .split("_")
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : "")
    .join(" ");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
