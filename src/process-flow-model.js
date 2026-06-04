import { createPlan, requiredMachineCount } from "./planner.js?v=process-lines-2026-06-04";

const GRAPH_LIMIT = 96;

export function buildProcessFlow(repository, target, options = {}) {
  const product = {
    goodsId: target.goodsId,
    amountPerMinute: Number(target.amountPerMinute) || 0
  };
  const externalGoods = new Set(options.externalGoods ?? []);
  externalGoods.delete(product.goodsId);
  const plan = createPlan(repository, [product], {
    preferredRecipeByOutput: options.preferredRecipeByOutput ?? {},
    externalGoods,
    maxWarnings: options.maxWarnings ?? 60
  });
  const graph = buildProcessGraph(repository, plan);
  const machineRows = buildMachineRows(plan, options.machineCounts ?? {});
  const bottleneck = machineRows
    .filter((row) => Number.isFinite(row.capacityFactor))
    .sort((a, b) => a.capacityFactor - b.capacityFactor)[0] ?? null;
  const lineFactor = bottleneck?.capacityFactor ?? 1;
  const generatorEuT = Math.max(1, Number(options.generatorEuT) || 32);
  const targetPowerEut = plan.totalAverageEut;
  const capacityPowerEut = targetPowerEut * lineFactor;

  return {
    product,
    plan,
    graph,
    machineRows,
    bottleneck,
    lineFactor,
    idealOutputPerMinute: product.amountPerMinute,
    capacityOutputPerMinute: product.amountPerMinute * lineFactor,
    targetPowerEut,
    capacityPowerEut,
    targetGeneratorCount: requiredMachineCount(targetPowerEut / generatorEuT),
    capacityGeneratorCount: requiredMachineCount(capacityPowerEut / generatorEuT),
    generatorEuT
  };
}

function buildMachineRows(plan, machineCounts) {
  return plan.recipeRows
    .map((row) => {
      const idealLoad = row.machineLoad ?? 0;
      const requiredCount = requiredMachineCount(idealLoad);
      const builtCount = Math.max(0, Number(machineCounts[row.recipe.id] ?? requiredCount));
      const capacityFactor = idealLoad > 0 ? builtCount / idealLoad : Infinity;

      return {
        ...row,
        idealLoad,
        requiredCount,
        builtCount,
        capacityFactor,
        bottleneck: false
      };
    })
    .sort((a, b) => {
      const capacitySort = finiteSortValue(a.capacityFactor) - finiteSortValue(b.capacityFactor);
      return capacitySort || b.idealLoad - a.idealLoad || a.recipe.id.localeCompare(b.recipe.id);
    })
    .map((row, index) => ({
      ...row,
      bottleneck: index === 0 && Number.isFinite(row.capacityFactor),
      underbuilt: index === 0 && Number.isFinite(row.capacityFactor) && row.capacityFactor < 1
    }));
}

function finiteSortValue(value) {
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function buildProcessGraph(repository, plan) {
  const nodes = new Map();
  const edges = new Map();
  const traversed = new Set();

  function addGoodNode(goodsId, depth, amountPerMinute, reason = "") {
    const key = `good:${goodsId}`;
    const good = repository.getGood(goodsId);
    const current = nodes.get(key);
    if (current) {
      current.depth = Math.max(current.depth, depth);
      current.amountPerMinute += amountPerMinute;
      current.reason = current.reason || reason;
      return current;
    }

    const node = {
      id: key,
      type: "good",
      goodsId,
      label: good?.name ?? goodsId,
      kind: good?.kind ?? "item",
      depth,
      amountPerMinute,
      reason
    };
    nodes.set(key, node);
    return node;
  }

  function addRecipeNode(treeNode, depth) {
    const key = `recipe:${treeNode.recipe.id}`;
    const current = nodes.get(key);
    if (current) {
      current.depth = Math.max(current.depth, depth);
      current.runsPerMinute += treeNode.runsPerMinute;
      current.amountPerMinute += treeNode.amountPerMinute;
      return current;
    }

    const node = {
      id: key,
      type: "recipe",
      recipe: treeNode.recipe,
      goodsId: treeNode.goodsId,
      label: repository.getRecipeType(treeNode.recipe.type).name,
      machine: treeNode.machine,
      voltageTier: treeNode.voltageTier,
      depth,
      runsPerMinute: treeNode.runsPerMinute,
      amountPerMinute: treeNode.amountPerMinute,
      machineLoad: treeNode.machineLoad,
      machineCount: treeNode.machineCount
    };
    nodes.set(key, node);
    return node;
  }

  function addEdge(from, to, amountPerMinute, kind) {
    const key = `${from}->${to}`;
    const current = edges.get(key);
    if (current) {
      current.amountPerMinute += amountPerMinute;
    } else {
      edges.set(key, { id: key, from, to, amountPerMinute, kind });
    }
  }

  function visit(treeNode, depth) {
    if (nodes.size > GRAPH_LIMIT) return;
    const outputNode = addGoodNode(treeNode.goodsId, depth * 2, treeNode.amountPerMinute, treeNode.reason);
    if (!treeNode.recipe) return;

    const visitKey = `${treeNode.goodsId}:${treeNode.recipe.id}:${depth}`;
    if (traversed.has(visitKey)) return;
    traversed.add(visitKey);

    const recipeNode = addRecipeNode(treeNode, depth * 2 + 1);
    addEdge(recipeNode.id, outputNode.id, treeNode.amountPerMinute, "output");

    for (const child of treeNode.children) {
      const inputNode = addGoodNode(child.goodsId, (depth + 1) * 2, child.amountPerMinute, child.reason);
      addEdge(inputNode.id, recipeNode.id, child.amountPerMinute, "input");
      visit(child, depth + 1);
    }
  }

  for (const tree of plan.planTrees) {
    visit(tree, 0);
  }

  return layoutGraph({
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    truncated: nodes.size > GRAPH_LIMIT
  });
}

function layoutGraph(graph) {
  const maxDepth = graph.nodes.reduce((max, node) => Math.max(max, node.depth), 0);
  const levels = new Map();

  for (const node of graph.nodes) {
    const nodes = levels.get(node.depth) ?? [];
    nodes.push(node);
    levels.set(node.depth, nodes);
  }

  const columnGap = 174;
  const rowGap = 96;
  const margin = 24;
  let maxRows = 1;

  for (const [depth, nodes] of levels) {
    nodes.sort((a, b) => nodeSortLabel(a).localeCompare(nodeSortLabel(b)) || a.id.localeCompare(b.id));
    maxRows = Math.max(maxRows, nodes.length);
    nodes.forEach((node, index) => {
      node.x = margin + (maxDepth - depth) * columnGap;
      node.y = margin + index * rowGap;
    });
  }

  return {
    ...graph,
    width: Math.max(980, margin * 2 + (maxDepth + 1) * columnGap),
    height: Math.max(520, margin * 2 + maxRows * rowGap)
  };
}

function nodeSortLabel(node) {
  return node.type === "recipe" ? `zz-${node.label}` : node.label;
}
