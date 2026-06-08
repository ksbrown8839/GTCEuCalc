import { createPlan, requiredMachineCount } from "./planner.js?v=process-machine-tiers-2026-06-05";

const GRAPH_LIMIT = 96;
const MAX_VISUAL_MACHINE_NODES = 48;

export function buildProcessFlow(repository, target, options = {}) {
  const product = {
    goodsId: target.goodsId,
    amountPerMinute: Number(target.amountPerMinute) || 0
  };
  const externalGoods = new Set(options.externalGoods ?? []);
  externalGoods.delete(product.goodsId);
  const plan = createPlan(repository, [product], {
    preferredRecipeByOutput: options.preferredRecipeByOutput ?? {},
    machineTierByRecipeType: options.machineTierByRecipeType ?? {},
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
  const targetPowerEut = plan.totalAverageEut;
  const capacityPowerEut = targetPowerEut * lineFactor;
  const stageRows = buildStageRows(repository, plan, machineRows, lineFactor);

  return {
    product,
    plan,
    graph,
    stageRows,
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
    capacityPowerEut
  };
}

function buildStageRows(repository, plan, machineRows, lineFactor) {
  const machineRowByRecipeId = new Map();
  for (const machineRow of machineRows) {
    for (const recipeRow of machineRow.recipeRows) {
      machineRowByRecipeId.set(recipeRow.recipe.id, machineRow);
    }
  }

  return plan.recipeRows.map((row, index) => {
    const recipe = row.recipe;
    const machineRow = machineRowByRecipeId.get(recipe.id) ?? null;
    const targetRunsPerMinute = row.runsPerMinute;
    const actualRunsPerMinute = targetRunsPerMinute * lineFactor;
    const plannedOutputs = new Map(row.plannedOutputs ?? []);
    const allOutputs = recipe.outputs.map((output) => {
      const amount = output.amount * (output.chance ?? 1);
      return {
        goodsId: output.id,
        role: plannedOutputs.has(output.id) ? "planned" : "byproduct",
        requiredAmountPerMinute: amount * targetRunsPerMinute,
        actualAmountPerMinute: amount * actualRunsPerMinute
      };
    });
    const inputs = recipe.inputs
      .filter((input) => !input.notConsumed)
      .map((input) => {
        const resolved = repository.resolveIngredient(input);
        const goodsId = resolved.good ? resolved.id : input.id;
        return {
          goodsId,
          resolved: Boolean(resolved.good),
          label: resolved.good ? repository.getGoodName(goodsId) : repository.getIngredientName(input),
          requiredAmountPerMinute: input.amount * targetRunsPerMinute,
          actualAmountPerMinute: input.amount * actualRunsPerMinute
        };
      });
    const machineCapacityFactor = machineRow?.capacityFactor ?? Infinity;
    const requiredMachineCount = row.machineCount ?? 0;
    const builtMachineCount = machineRow?.builtCount ?? requiredMachineCount;
    const actualAverageEut = (row.averageEut ?? 0) * lineFactor;
    const status = machineCapacityFactor < 1
      ? "machine-shortfall"
      : actualRunsPerMinute < targetRunsPerMinute
        ? "limited-upstream"
        : "on-target";

    return {
      index,
      recipeId: recipe.id,
      recipe,
      recipeType: recipe.type,
      recipeTypeName: repository.getRecipeType(recipe.type).name,
      machine: row.machine,
      voltageTier: row.voltageTier,
      effectiveDurationTicks: row.effectiveDurationTicks,
      effectiveEut: row.effectiveEut,
      overclockSteps: row.overclockSteps ?? 0,
      targetRunsPerMinute,
      actualRunsPerMinute,
      machineLoad: row.machineLoad ?? 0,
      requiredMachineCount,
      builtMachineCount,
      machineCapacityFactor,
      machineGroupKey: machineRow?.machineKey ?? null,
      isMachineBottleneck: Boolean(machineRow?.weakestMachine),
      isLineBottleneck: Boolean(machineRow?.bottleneck),
      averageEut: row.averageEut ?? 0,
      actualAverageEut,
      inputs,
      outputs: allOutputs,
      plannedOutputs: [...plannedOutputs.entries()].map(([goodsId, amountPerMinute]) => ({
        goodsId,
        requiredAmountPerMinute: amountPerMinute,
        actualAmountPerMinute: amountPerMinute * lineFactor
      })),
      status
    };
  });
}

function buildMachineRows(plan, machineCounts) {
  const groups = new Map();

  for (const row of plan.recipeRows) {
    if (row.machineLoad <= 0 || !row.machine) continue;

    const machineKey = machineGroupKey(row.machine, row.voltageTier, row.recipe.type);
    const configKey = machineConfigKey(row.machine, row.recipe.type);
    const current = groups.get(machineKey);
    if (current) {
      current.runsPerMinute += row.runsPerMinute;
      current.idealLoad += row.machineLoad ?? 0;
      current.recipeRows.push(row);
      current.recipeTypes.add(row.recipe.type);
      current.minimumVoltageTier = higherVoltageTier(current.minimumVoltageTier, row.minimumVoltageTier);
    } else {
      groups.set(machineKey, {
        type: "machine",
        bottleneckKey: `machine:${machineKey}`,
        machineKey,
        configKey,
        machine: row.machine,
        voltageTier: row.voltageTier,
        minimumVoltageTier: row.minimumVoltageTier,
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
      const builtCount = Math.max(0, Number(machineCounts[row.configKey] ?? machineCounts[row.machineKey] ?? requiredCount));
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
  return `${machine?.id ?? fallback}:${voltageTier?.id ?? "untiered"}:${fallback}`;
}

function machineConfigKey(machine, recipeType) {
  return `${machine?.id ?? recipeType}:${recipeType}`;
}

function higherVoltageTier(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a.voltage >= b.voltage ? a : b;
}

function finiteSortValue(value) {
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function recipeNodeSize() {
  return {
    width: 132,
    height: 72
  };
}

function buildProcessGraph(repository, plan, machineRows = []) {
  const nodes = new Map();
  const edges = new Map();
  const traversed = new Set();
  const machineRowByRecipeId = new Map();
  const recipeNodesByRecipeId = new Map();

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

  function addRecipeNodes(treeNode, depth) {
    const machineRow = machineRowByRecipeId.get(treeNode.recipe.id);
    const builtCount = machineRow?.builtCount ?? treeNode.machineCount ?? 0;
    const builtMachineCount = Math.max(0, Math.floor(Number(builtCount) || 0));
    const loadMachineCount = Math.max(1, builtMachineCount);
    const visibleMachineCount = Math.max(1, Math.min(loadMachineCount, MAX_VISUAL_MACHINE_NODES));
    const overflowMachineCount = Math.max(0, loadMachineCount - visibleMachineCount);
    const current = recipeNodesByRecipeId.get(treeNode.recipe.id);
    if (current) {
      const perMachineRuns = treeNode.runsPerMinute / loadMachineCount;
      const perMachineAmount = treeNode.amountPerMinute / loadMachineCount;
      for (const node of current.nodes) {
        const machineShare = node.overflowMachineCount || 1;
        node.depth = Math.max(node.depth, depth);
        node.runsPerMinute += perMachineRuns * machineShare;
        node.amountPerMinute += perMachineAmount * machineShare;
        node.builtCount = Math.max(node.builtCount, builtCount);
      }
      return current.nodes;
    }

    const size = recipeNodeSize();
    const perMachineRuns = treeNode.runsPerMinute / loadMachineCount;
    const perMachineAmount = treeNode.amountPerMinute / loadMachineCount;
    const visualNodeCount = visibleMachineCount + (overflowMachineCount > 0 ? 1 : 0);
    const createdNodes = Array.from({ length: visualNodeCount }, (_, index) => {
      const isOverflowNode = overflowMachineCount > 0 && index === visualNodeCount - 1;
      const machineShare = isOverflowNode ? overflowMachineCount : 1;
      const id = index === 0
        ? `recipe:${treeNode.recipe.id}`
        : isOverflowNode
          ? `recipe:${treeNode.recipe.id}:machine:overflow`
          : `recipe:${treeNode.recipe.id}:machine:${index + 1}`;
      const node = {
        id,
        type: "recipe",
        recipe: treeNode.recipe,
        goodsId: treeNode.goodsId,
        label: repository.getRecipeType(treeNode.recipe.type).name,
        machine: treeNode.machine,
        voltageTier: treeNode.voltageTier,
        minimumVoltageTier: treeNode.minimumVoltageTier,
        overclockSteps: treeNode.overclockSteps ?? 0,
        effectiveDurationTicks: treeNode.effectiveDurationTicks ?? treeNode.recipe.durationTicks,
        effectiveEut: treeNode.effectiveEut ?? treeNode.recipe.eut,
        machineGroupKey: machineGroupKey(treeNode.machine, treeNode.voltageTier, treeNode.recipe.type),
        machineConfigKey: machineConfigKey(treeNode.machine, treeNode.recipe.type),
        depth,
        runsPerMinute: perMachineRuns * machineShare,
        totalRunsPerMinute: treeNode.runsPerMinute,
        amountPerMinute: perMachineAmount * machineShare,
        totalAmountPerMinute: treeNode.amountPerMinute,
        machineLoad: ((treeNode.machineLoad ?? 0) / loadMachineCount) * machineShare,
        totalMachineLoad: treeNode.machineLoad ?? 0,
        machineCount: treeNode.machineCount,
        builtCount,
        visibleMachineCount,
        overflowMachineCount: isOverflowNode ? overflowMachineCount : 0,
        machineIndex: isOverflowNode ? null : index + 1,
        ...size
      };
      nodes.set(id, node);
      return node;
    });
    recipeNodesByRecipeId.set(treeNode.recipe.id, { nodes: createdNodes });
    return createdNodes;
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

    const recipeNodes = addRecipeNodes(treeNode, depth * 2 + 1);
    const outputAmountPerMachine = treeNode.amountPerMinute / recipeNodes.length;
    for (const recipeNode of recipeNodes) {
      addEdge(recipeNode.id, outputNode.id, outputAmountPerMachine, "output");
    }

    for (const child of treeNode.children) {
      const inputNode = addGoodNode(child.goodsId, (depth + 1) * 2, child.amountPerMinute, child.reason);
      const inputAmountPerMachine = child.amountPerMinute / recipeNodes.length;
      for (const recipeNode of recipeNodes) {
        addEdge(inputNode.id, recipeNode.id, inputAmountPerMachine, "input");
      }
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

  const columnGap = 86;
  const rowGap = 34;
  const margin = 24;
  const columnHeights = new Map();
  const columnWidths = new Map();
  const columnX = new Map();

  for (const [depth, nodes] of levels) {
    columnWidths.set(depth, Math.max(...nodes.map((node) => nodeSize(node).width)));
  }

  let x = margin;
  for (let depth = maxDepth; depth >= 0; depth -= 1) {
    columnX.set(depth, x);
    x += (columnWidths.get(depth) ?? 0) + columnGap;
  }

  for (const [depth, nodes] of levels) {
    nodes.sort((a, b) => nodeSortLabel(a).localeCompare(nodeSortLabel(b)) || a.id.localeCompare(b.id));
    let y = margin;
    for (const node of nodes) {
      const size = nodeSize(node);
      node.x = columnX.get(depth) ?? margin;
      node.y = y;
      y += size.height + rowGap;
    }
    columnHeights.set(depth, Math.max(y - rowGap + margin, margin * 2));
  }

  return {
    ...graph,
    width: Math.max(980, x - columnGap + margin),
    height: Math.max(520, Math.max(...columnHeights.values(), margin * 2))
  };
}

function nodeSize(node) {
  if (node.type === "recipe") {
    return {
      width: node.width ?? 154,
      height: node.height ?? 72
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
