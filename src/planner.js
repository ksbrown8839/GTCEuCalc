const MAX_DEPTH = 32;

export function createPlan(repository, products, options = {}) {
  const recipeRates = new Map();
  const externalInputs = new Map();
  const tagChoices = new Map();
  const warnings = [];
  const warningKeys = new Set();
  let suppressedWarningCount = 0;
  const byproducts = new Map();
  const planTrees = [];
  const maxWarnings = options.maxWarnings ?? 80;
  const externalGoods = new Set(options.externalGoods ?? []);
  const expandedGoods = options.expandedGoods ? new Set(options.expandedGoods) : null;
  const structureTargets = new Set(options.structureTargets ?? []);
  const structuresByController = options.structuresByController ?? new Map();

  function add(map, id, amount) {
    map.set(id, (map.get(id) ?? 0) + amount);
  }

  function addWarning(message) {
    if (warningKeys.has(message)) return;
    warningKeys.add(message);

    if (warnings.length < maxWarnings) {
      warnings.push(message);
    } else {
      suppressedWarningCount += 1;
    }
  }

  function recordRecipe(recipe, runsPerMinute, goodsId, amountPerMinute) {
    const current = recipeRates.get(recipe.id);
    if (current) {
      current.runsPerMinute += runsPerMinute;
      add(current.plannedOutputs, goodsId, amountPerMinute);
    } else {
      const plannedOutputs = new Map();
      add(plannedOutputs, goodsId, amountPerMinute);
      recipeRates.set(recipe.id, { recipe, runsPerMinute, plannedOutputs });
    }
  }

  function structureForGood(goodsId) {
    if (typeof structuresByController.get === "function") {
      return structuresByController.get(goodsId) ?? null;
    }
    return structuresByController[goodsId] ?? null;
  }

  function hasProducingPlan(goodsId) {
    return repository.findRecipesProducing(goodsId).length > 0
      || (structureTargets.has(goodsId) && Boolean(structureForGood(goodsId)));
  }

  function structureRecipe(goodsId, structure) {
    return {
      id: structure.id,
      type: "gtceu:multiblock_structure",
      durationTicks: 0,
      eut: 0,
      synthetic: true,
      structure,
      inputs: (structure.requirements ?? []).map((requirement) => ({
        kind: "item",
        id: requirement.id,
        amount: requirement.amount ?? 1,
        structureRole: requirement.role ?? ""
      })),
      outputs: [{ id: goodsId, amount: 1 }]
    };
  }

  function planGood(goodsId, amountPerMinute, stack, context = {}) {
    const node = {
      goodsId,
      amountPerMinute,
      recipe: null,
      runsPerMinute: 0,
      children: [],
      reason: null
    };

    if (amountPerMinute <= 0) return;
    if (externalGoods.has(goodsId)) {
      add(externalInputs, goodsId, amountPerMinute);
      node.reason = "external";
      return node;
    }
    if (stack.length > MAX_DEPTH) {
      add(externalInputs, goodsId, amountPerMinute);
      addWarning(`Stopped at ${repository.getGoodName(goodsId)} because the chain is too deep.`);
      node.reason = "depth";
      return node;
    }
    if (stack.includes(goodsId)) {
      add(externalInputs, goodsId, amountPerMinute);
      addWarning(`Cycle detected around ${repository.getGoodName(goodsId)}.`);
      node.reason = "cycle";
      return node;
    }
    if (expandedGoods && !expandedGoods.has(goodsId)) {
      add(externalInputs, goodsId, amountPerMinute);
      node.reason = hasProducingPlan(goodsId) ? "collapsed" : "external";
      return node;
    }

    const structure = !context.skipStructure && structureTargets.has(goodsId)
      ? structureForGood(goodsId)
      : null;
    if (structure) {
      const recipe = structureRecipe(goodsId, structure);
      node.recipe = recipe;
      node.runsPerMinute = amountPerMinute;
      node.reason = "structure";
      node.structure = structure;
      recordRecipe(recipe, amountPerMinute, goodsId, amountPerMinute);

      const childDemands = new Map();
      for (const input of recipe.inputs) {
        const key = `good:${input.id}`;
        const current = childDemands.get(key);
        if (current) {
          current.amountPerMinute += input.amount * amountPerMinute;
        } else {
          childDemands.set(key, {
            goodsId: input.id,
            amountPerMinute: input.amount * amountPerMinute
          });
        }
      }

      const nextStack = [...stack, structure.id ?? `${goodsId}:structure`];
      for (const demand of childDemands.values()) {
        const child = planGood(demand.goodsId, demand.amountPerMinute, nextStack, {
          skipStructure: demand.goodsId === goodsId
        });
        if (child) node.children.push(child);
      }

      return node;
    }

    const recipe = repository.chooseRecipeForOutput(goodsId, options.preferredRecipeByOutput ?? {}, {
      avoidGoods: stack
    });
    if (!recipe) {
      add(externalInputs, goodsId, amountPerMinute);
      node.reason = "missing";
      return node;
    }

    const matchingOutputAmount = recipe.outputs
      .filter((output) => output.id === goodsId)
      .reduce((sum, output) => sum + output.amount * (output.chance ?? 1), 0);

    if (matchingOutputAmount <= 0) {
      add(externalInputs, goodsId, amountPerMinute);
      addWarning(`Recipe ${recipe.id} has no usable output for ${repository.getGoodName(goodsId)}.`);
      node.reason = "invalid";
      return node;
    }

    const runsPerMinute = amountPerMinute / matchingOutputAmount;
    node.recipe = recipe;
    node.runsPerMinute = runsPerMinute;
    const assignment = repository.chooseMachineForRecipe(recipe, options);
    const overclockSteps = overclockStepsFor(repository, recipe, assignment.voltageTier);
    node.machine = assignment.machine;
    node.voltageTier = assignment.voltageTier;
    node.minimumVoltageTier = assignment.minimumVoltageTier;
    node.overclockSteps = overclockSteps;
    node.effectiveDurationTicks = effectiveDurationTicks(recipe, overclockSteps);
    node.effectiveEut = effectiveEut(recipe, overclockSteps);
    node.machineLoad = machineLoad(recipe, runsPerMinute, assignment.machine?.parallel ?? 1, overclockSteps);
    node.machineCount = requiredMachineCount(node.machineLoad);
    recordRecipe(recipe, runsPerMinute, goodsId, amountPerMinute);

    for (const output of recipe.outputs) {
      if (output.id !== goodsId) {
        add(byproducts, output.id, output.amount * (output.chance ?? 1) * runsPerMinute);
      }
    }

    const childDemands = new Map();

    function addChildDemand(key, demandedGoodsId, demandedAmountPerMinute, resolved) {
      const current = childDemands.get(key);
      if (current) {
        current.amountPerMinute += demandedAmountPerMinute;
      } else {
        childDemands.set(key, {
          goodsId: demandedGoodsId,
          amountPerMinute: demandedAmountPerMinute,
          resolved
        });
      }
    }

    for (const input of recipe.inputs) {
      if (input.notConsumed) continue;

      const resolved = repository.resolveIngredient(input);
      if (resolved.warning && !tagChoices.has(input.id)) {
        tagChoices.set(input.id, resolved.id);
        addWarning(resolved.warning);
      }

      if (!resolved.good) {
        addChildDemand(`unresolved:${input.id}`, input.id, input.amount * runsPerMinute, false);
      } else {
        addChildDemand(`good:${resolved.id}`, resolved.id, input.amount * runsPerMinute, true);
      }
    }

    for (const demand of childDemands.values()) {
      if (!demand.resolved) {
        add(externalInputs, demand.goodsId, demand.amountPerMinute);
        node.children.push({
          goodsId: demand.goodsId,
          amountPerMinute: demand.amountPerMinute,
          recipe: null,
          runsPerMinute: 0,
          children: [],
          reason: "unresolved"
        });
      } else {
        const child = planGood(demand.goodsId, demand.amountPerMinute, [...stack, goodsId]);
        if (child) node.children.push(child);
      }
    }

    return node;
  }

  for (const product of products) {
    const tree = planGood(product.goodsId, product.amountPerMinute, []);
    if (tree) planTrees.push(tree);
  }

  const recipeRows = [...recipeRates.values()].sort((a, b) => b.runsPerMinute - a.runsPerMinute);
  const machineRates = new Map();

  for (const row of recipeRows) {
    const assignment = repository.chooseMachineForRecipe(row.recipe, options);
    const parallel = assignment.machine?.parallel ?? 1;
    const overclockSteps = overclockStepsFor(repository, row.recipe, assignment.voltageTier);
    row.machine = assignment.machine;
    row.voltageTier = assignment.voltageTier;
    row.minimumVoltageTier = assignment.minimumVoltageTier;
    row.overclockSteps = overclockSteps;
    row.effectiveDurationTicks = effectiveDurationTicks(row.recipe, overclockSteps);
    row.effectiveEut = effectiveEut(row.recipe, overclockSteps);
    row.averageEut = averageEut(row.recipe, row.runsPerMinute, overclockSteps);
    row.machineLoad = machineLoad(row.recipe, row.runsPerMinute, parallel, overclockSteps);
    row.machineCount = requiredMachineCount(row.machineLoad);

    if (row.machineLoad <= 0 || !row.machine) continue;

    const key = `${row.machine.id}:${row.voltageTier?.id ?? "untiered"}`;
    const current = machineRates.get(key);
    if (current) {
      current.machineLoad += row.machineLoad;
      current.recipeCount += 1;
    } else {
      machineRates.set(key, {
        machine: row.machine,
        voltageTier: row.voltageTier,
        machineLoad: row.machineLoad,
        recipeCount: 1
      });
    }
  }

  const externalRows = [...externalInputs.entries()]
    .map(([goodsId, amountPerMinute]) => ({ goodsId, amountPerMinute }))
    .sort((a, b) => b.amountPerMinute - a.amountPerMinute);
  const byproductRows = [...byproducts.entries()]
    .map(([goodsId, amountPerMinute]) => ({ goodsId, amountPerMinute }))
    .sort((a, b) => b.amountPerMinute - a.amountPerMinute);
  const machineRows = [...machineRates.values()]
    .map((row) => ({
      ...row,
      machineCount: requiredMachineCount(row.machineLoad)
    }))
    .sort((a, b) => b.machineCount - a.machineCount || b.machineLoad - a.machineLoad);

  const totalAverageEut = recipeRows.reduce((sum, row) => sum + (row.averageEut ?? 0), 0);

  return {
    products,
    planTrees,
    recipeRows,
    machineRows,
    externalRows,
    byproductRows,
    warnings,
    suppressedWarningCount,
    totalAverageEut
  };
}

export function averageEut(recipe, runsPerMinute, overclockSteps = 0) {
  if (!recipe.eut || !recipe.durationTicks) return 0;
  return (effectiveEut(recipe, overclockSteps) * effectiveDurationTicks(recipe, overclockSteps) * runsPerMinute) / 1200;
}

export function machineLoad(recipe, runsPerMinute, parallel = 1, overclockSteps = 0) {
  if (!recipe.durationTicks || !runsPerMinute || parallel <= 0) return 0;
  return (effectiveDurationTicks(recipe, overclockSteps) * runsPerMinute) / (1200 * parallel);
}

export function requiredMachineCount(load) {
  return load > 0 ? Math.ceil(load) : 0;
}

export function machineCount(recipe, runsPerMinute, parallel = 1, overclockSteps = 0) {
  return requiredMachineCount(machineLoad(recipe, runsPerMinute, parallel, overclockSteps));
}

export function effectiveDurationTicks(recipe, overclockSteps = 0) {
  if (!recipe.durationTicks) return 0;
  return Math.max(1, recipe.durationTicks / (2 ** Math.max(0, overclockSteps)));
}

export function effectiveEut(recipe, overclockSteps = 0) {
  if (!recipe.eut) return 0;
  return recipe.eut * (4 ** Math.max(0, overclockSteps));
}

function overclockStepsFor(repository, recipe, voltageTier) {
  const minimumTier = repository.getVoltageTierForEut(recipe.eut);
  return repository.getVoltageTierDistance(minimumTier, voltageTier);
}
