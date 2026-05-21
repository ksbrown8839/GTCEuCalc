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

  function planGood(goodsId, amountPerMinute, stack) {
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

    const recipe = repository.chooseRecipeForOutput(goodsId, options.preferredRecipeByOutput ?? {});
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
  const externalRows = [...externalInputs.entries()]
    .map(([goodsId, amountPerMinute]) => ({ goodsId, amountPerMinute }))
    .sort((a, b) => b.amountPerMinute - a.amountPerMinute);
  const byproductRows = [...byproducts.entries()]
    .map(([goodsId, amountPerMinute]) => ({ goodsId, amountPerMinute }))
    .sort((a, b) => b.amountPerMinute - a.amountPerMinute);

  const totalAverageEut = recipeRows.reduce((sum, row) => {
    return sum + averageEut(row.recipe, row.runsPerMinute);
  }, 0);

  return {
    products,
    planTrees,
    recipeRows,
    externalRows,
    byproductRows,
    warnings,
    suppressedWarningCount,
    totalAverageEut
  };
}

export function averageEut(recipe, runsPerMinute) {
  if (!recipe.eut || !recipe.durationTicks) return 0;
  return (recipe.eut * recipe.durationTicks * runsPerMinute) / 1200;
}
