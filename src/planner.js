const MAX_DEPTH = 32;

export function createPlan(repository, products, options = {}) {
  const recipeRates = new Map();
  const externalInputs = new Map();
  const tagChoices = new Map();
  const warnings = [];
  const warningKeys = new Set();
  let suppressedWarningCount = 0;
  const byproducts = new Map();
  const maxWarnings = options.maxWarnings ?? 80;

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

  function recordRecipe(recipe, runsPerMinute) {
    const current = recipeRates.get(recipe.id);
    if (current) {
      current.runsPerMinute += runsPerMinute;
    } else {
      recipeRates.set(recipe.id, { recipe, runsPerMinute });
    }
  }

  function planGood(goodsId, amountPerMinute, stack) {
    if (amountPerMinute <= 0) return;
    if (stack.length > MAX_DEPTH) {
      add(externalInputs, goodsId, amountPerMinute);
      addWarning(`Stopped at ${repository.getGoodName(goodsId)} because the chain is too deep.`);
      return;
    }
    if (stack.includes(goodsId)) {
      add(externalInputs, goodsId, amountPerMinute);
      addWarning(`Cycle detected around ${repository.getGoodName(goodsId)}.`);
      return;
    }

    const recipe = repository.chooseRecipeForOutput(goodsId, options.preferredRecipeByOutput ?? {});
    if (!recipe) {
      add(externalInputs, goodsId, amountPerMinute);
      return;
    }

    const matchingOutputAmount = recipe.outputs
      .filter((output) => output.id === goodsId)
      .reduce((sum, output) => sum + output.amount * (output.chance ?? 1), 0);

    if (matchingOutputAmount <= 0) {
      add(externalInputs, goodsId, amountPerMinute);
      addWarning(`Recipe ${recipe.id} has no usable output for ${repository.getGoodName(goodsId)}.`);
      return;
    }

    const runsPerMinute = amountPerMinute / matchingOutputAmount;
    recordRecipe(recipe, runsPerMinute);

    for (const output of recipe.outputs) {
      if (output.id !== goodsId) {
        add(byproducts, output.id, output.amount * (output.chance ?? 1) * runsPerMinute);
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
        add(externalInputs, input.id, input.amount * runsPerMinute);
      } else {
        planGood(resolved.id, input.amount * runsPerMinute, [...stack, goodsId]);
      }
    }
  }

  for (const product of products) {
    planGood(product.goodsId, product.amountPerMinute, []);
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
