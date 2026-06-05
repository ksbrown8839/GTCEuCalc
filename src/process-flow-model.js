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
  const machineRows = buildMachineRows(plan, options.machineCounts ?? {});
  const graph = buildProcessGraph(repository, plan, machineRows);
  const supplyRows = buildSupplyRows(plan, options.supplyRates ?? {}, new Set(options.unlimitedSupplyGoods ?? []));
  const machineBottleneck = bottleneckFor(machineRows);
  const supplyBottleneck = bottleneckFor(supplyRows);
  const bottleneck = bottleneckFor([...machineRows, ...supplyRows]);
  const machineLineFactor = machineBottleneck?.capacityFactor ?? 1;
  const supplyLineFactor = supplyBottleneck?.capacityFactor ?? 1;
  const lineFactor = bottleneck?.capacityFactor ?? 1;
  markBottlenecks(machineRows, bottleneck, machineBottleneck);
  markBottlenecks(supplyRows, bottleneck, supplyBottleneck);
  applyActualRates(supplyRows, lineFactor, product.amountPerMinute);
  const generatorEuT = Math.max(1, Number(options.generatorEuT) || 32);
  const targetPowerEut = plan.totalAverageEut;
  const capacityPowerEut = targetPowerEut * lineFactor;

  return {
    product,
    plan,
    graph,
    machineRows,
    supplyRows,
    bottleneck,
    machineBottleneck,
    supplyBottleneck,
    lineFactor,
    machineLineFactor,
    supplyLineFactor,
    idealOutputPerMinute: product.amountPerMinute,
    machineCapacityOutputPerMinute: product.amountPerMinute * machineLineFactor,
    capacityOutputPerMinute: product.amountPerMinute * lineFactor,
    targetPowerEut,
    capacityPowerEut,
    targetGeneratorCount: requiredMachineCount(targetPowerEut / generatorEuT),
    capacityGeneratorCount: requiredMachineCount(capacityPowerEut / generatorEuT),
    generatorEuT
  };
}

function buildMachineRows(plan, machineCounts) {
  const groups = new Map();

  for (const row of plan.recipeRows) {
    if (row.machineLoad <= 0 || !row.machine) continue;

    const machineKey = machineGroupKey(row.machine, row.voltageTier, row.recipe.type);
    const current = groups.get(machineKey);
    if (current) {
      current.runsPerMinute += row.runsPerMinute;
      current.idealLoad += row.machineLoad ?? 0;
      current.recipeRows.push(row);
      current.recipeTypes.add(row.recipe.type);
    } else {
      groups.set(machineKey, {
        type: "machine",
        bottleneckKey: `machine:${machineKey}`,
        machineKey,
        machine: row.machine,
        voltageTier: row.voltageTier,
        recipeTypes: new Set([row.recipe.type]),
        recipeRows: [row],
        runsPerMinute: row.runsPerMinute,
        idealLoad: row.machineLoad ?? 0,
        bottleneck: false,
        weakestMachine: false,
        underbuilt: false
      });
    }
  }

  return [...groups.values()]
    .map((row) => {
      const idealLoad = row.idealLoad;
      const requiredCount = requiredMachineCount(idealLoad);
      const builtCount = Math.max(0, Number(machineCounts[row.machineKey] ?? requiredCount));
      const capacityFactor = idealLoad > 0 ? builtCount / idealLoad : Infinity;

      return {
        ...row,
        recipeTypes: [...row.recipeTypes],
        recipeCount: row.recipeRows.length,
        requiredCount,
        builtCount,
        capacityFactor,
        bottleneck: false,
        weakestMachine: false,
        underbuilt: false
      };
    })
    .sort((a, b) => {
      const capacitySort = finiteSortValue(a.capacityFactor) - finiteSortValue(b.capacityFactor);
      return capacitySort || b.idealLoad - a.idealLoad || a.machineKey.localeCompare(b.machineKey);
    });
}

function buildSupplyRows(plan, supplyRates, unlimitedSupplyGoods) {
  return plan.externalRows
    .map((row) => {
      const requiredAmountPerMinute = row.amountPerMinute;
      const configured = Number(supplyRates[row.goodsId]);
      const unlimited = unlimitedSupplyGoods.has(row.goodsId);
      const availableAmountPerMinute = unlimited ? Infinity : (
        Number.isFinite(configured) ? Math.max(0, configured) : requiredAmountPerMinute
      );
      const capacityFactor = unlimited || requiredAmountPerMinute <= 0
        ? Infinity
        : availableAmountPerMinute / requiredAmountPerMinute;

      return {
        type: "supply",
        bottleneckKey: `supply:${row.goodsId}`,
        goodsId: row.goodsId,
        unlimited,
        requiredAmountPerMinute,
        availableAmountPerMinute,
        actualUsedAmountPerMinute: 0,
        maxOutputPerMinute: 0,
        capacityFactor,
        bottleneck: false,
        weakestSupply: false,
        underbuilt: false
      };
    })
    .sort((a, b) => {
      const capacitySort = finiteSortValue(a.capacityFactor) - finiteSortValue(b.capacityFactor);
      return capacitySort || b.requiredAmountPerMinute - a.requiredAmountPerMinute || a.goodsId.localeCompare(b.goodsId);
    });
}

function bottleneckFor(rows) {
  return rows
    .filter((row) => Number.isFinite(row.capacityFactor))
    .sort((a, b) => {
      const capacitySort = a.capacityFactor - b.capacityFactor;
      return capacitySort || bottleneckLabel(a).localeCompare(bottleneckLabel(b));
    })[0] ?? null;
}

function markBottlenecks(rows, globalBottleneck, localBottleneck) {
  for (const row of rows) {
    row.bottleneck = Boolean(globalBottleneck && row.bottleneckKey === globalBottleneck.bottleneckKey);
    row.weakestMachine = Boolean(localBottleneck && row.type === "machine" && row.bottleneckKey === localBottleneck.bottleneckKey);
    row.weakestSupply = Boolean(localBottleneck && row.type === "supply" && row.bottleneckKey === localBottleneck.bottleneckKey);
    row.underbuilt = row.bottleneck && Number.isFinite(row.capacityFactor) && row.capacityFactor < 1;
  }
}

function applyActualRates(supplyRows, lineFactor, targetAmountPerMinute) {
  for (const row of supplyRows) {
    row.actualUsedAmountPerMinute = row.requiredAmountPerMinute * lineFactor;
    row.maxOutputPerMinute = row.requiredAmountPerMinute > 0
      ? targetAmountPerMinute * row.capacityFactor
      : Infinity;
  }
}

function bottleneckLabel(row) {
  if (row.type === "machine") return row.machineKey;
  return row.goodsId;
}

function machineGroupKey(machine, voltageTier, fallback) {
  return `${machine?.id ?? fallback}:${voltageTier?.id ?? "untiered"}`;
}

function finiteSortValue(value) {
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function recipeNodeSize(builtCount) {
  const visibleCount = Math.min(Math.max(Math.floor(Number(builtCount) || 0), 1), 8);
  const columns = Math.min(4, visibleCount);
  const rows = Math.ceil(visibleCount / columns);

  return {
    width: Math.max(154, 46 + columns * 31),
    height: 72 + rows * 32
  };
}

function buildProcessGraph(repository, plan, machineRows = []) {
  const nodes = new Map();
  const edges = new Map();
  const traversed = new Set();
  const machineRowByRecipeId = new Map();

  for (const row of machineRows) {
    for (const recipeRow of row.recipeRows) {
      machineRowByRecipeId.set(recipeRow.recipe.id, row);
    }
  }

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
    const machineRow = machineRowByRecipeId.get(treeNode.recipe.id);
    const builtCount = machineRow?.builtCount ?? treeNode.machineCount ?? 0;
    const size = recipeNodeSize(builtCount);
    const current = nodes.get(key);
    if (current) {
      current.depth = Math.max(current.depth, depth);
      current.runsPerMinute += treeNode.runsPerMinute;
      current.amountPerMinute += treeNode.amountPerMinute;
      current.builtCount = Math.max(current.builtCount, builtCount);
      Object.assign(current, recipeNodeSize(current.builtCount));
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
      machineGroupKey: machineGroupKey(treeNode.machine, treeNode.voltageTier, treeNode.recipe.type),
      depth,
      runsPerMinute: treeNode.runsPerMinute,
      amountPerMinute: treeNode.amountPerMinute,
      machineLoad: treeNode.machineLoad,
      machineCount: treeNode.machineCount,
      builtCount,
      ...size
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

  const columnGap = 220;
  const rowGap = 34;
  const margin = 24;
  const columnHeights = new Map();

  for (const [depth, nodes] of levels) {
    nodes.sort((a, b) => nodeSortLabel(a).localeCompare(nodeSortLabel(b)) || a.id.localeCompare(b.id));
    let y = margin;
    for (const node of nodes) {
      const size = nodeSize(node);
      node.x = margin + (maxDepth - depth) * columnGap;
      node.y = y;
      y += size.height + rowGap;
    }
    columnHeights.set(depth, Math.max(y - rowGap + margin, margin * 2));
  }

  return {
    ...graph,
    width: Math.max(980, margin * 2 + maxDepth * columnGap + 180),
    height: Math.max(520, Math.max(...columnHeights.values(), margin * 2))
  };
}

function nodeSize(node) {
  if (node.type === "recipe") {
    return {
      width: node.width ?? 154,
      height: node.height ?? 104
    };
  }

  return {
    width: 98,
    height: 72
  };
}

function nodeSortLabel(node) {
  return node.type === "recipe" ? `zz-${node.label}` : node.label;
}
