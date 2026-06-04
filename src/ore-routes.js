import { loadRepository } from "./repository.js?v=default-recipe-ranking-2026-05-31";
import { buildOreFlowGraph, classifyOreRouteIngredient, getOreRouteMaterials } from "./ore-routes-model.js?v=ore-yield-map-2026-06-03";
import { escapeHtml, formatAmount, formatDuration } from "./format.js?v=machine-build-counts-2026-05-31";

const DEFAULT_DATA_URL = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_TEXTURE_ATLAS_URL = "data/texture-atlas.json";
const FLOW_MAP_WIDTH = 1780;
const FLOW_MAP_HEIGHT = 720;
const STAGE_WIDTH = 92;
const STAGE_HEIGHT = 74;
const OPERATION_WIDTH = 116;
const OPERATION_HEIGHT = 58;

const STAGE_LAYOUT = {
  ore: { x: 24, y: 118 },
  raw_material: { x: 24, y: 402 },
  crushed_ore: { x: 340, y: 258 },
  purified_ore: { x: 670, y: 76 },
  refined_ore: { x: 1000, y: 66 },
  impure_dust: { x: 670, y: 522 },
  pure_dust: { x: 1000, y: 438 },
  dust: { x: 1340, y: 306 },
  ingot: { x: 1660, y: 306 },
  gem: { x: 1660, y: 306 }
};

const OPERATION_LAYOUT = {
  "ore->crushed_ore": { x: 144, y: 168 },
  "raw_material->crushed_ore": { x: 144, y: 372 },
  "crushed_ore->purified_ore": { x: 500, y: 112 },
  "crushed_ore->refined_ore": { x: 570, y: 284 },
  "crushed_ore->impure_dust": { x: 500, y: 438 },
  "purified_ore->refined_ore": { x: 820, y: 90 },
  "purified_ore->pure_dust": { x: 820, y: 326 },
  "refined_ore->dust": { x: 1160, y: 160 },
  "impure_dust->dust": { x: 910, y: 540 },
  "pure_dust->dust": { x: 1160, y: 438 },
  "dust->ingot": { x: 1480, y: 314 },
  "dust->gem": { x: 1480, y: 314 },
  "purified_ore->gem": { x: 1370, y: 120 }
};

const state = {
  repository: null,
  textureAtlas: null,
  materials: [],
  search: "",
  selectedMaterial: "iron",
  selectedOperationId: null,
  flowView: {
    showHammerRoutes: false,
    showQuickSmelts: false,
    routeStrategy: "yield"
  }
};

const elements = {
  packName: document.querySelector("[data-role='ore-pack-name']"),
  packMeta: document.querySelector("[data-role='ore-pack-meta']"),
  search: document.querySelector("[data-role='ore-search']"),
  matchSummary: document.querySelector("[data-role='ore-match-summary']"),
  materialList: document.querySelector("[data-role='ore-material-list']"),
  title: document.querySelector("[data-role='ore-route-title']"),
  summary: document.querySelector("[data-role='ore-route-summary']"),
  count: document.querySelector("[data-role='ore-route-count']"),
  mapControls: document.querySelector("[data-role='ore-map-controls']"),
  flowFrame: document.querySelector("[data-role='ore-flow-frame']"),
  flowTrack: document.querySelector("[data-role='ore-flow-track']"),
  flowCanvas: document.querySelector("[data-role='ore-flow-canvas']"),
  yieldBoard: document.querySelector("[data-role='ore-yield-board']"),
  fallbackLane: document.querySelector("[data-role='ore-fallback-lane']"),
  quickSmeltLane: document.querySelector("[data-role='ore-quick-smelt-lane']"),
  detail: document.querySelector("[data-role='ore-route-detail']")
};

function dataUrlFromLocation() {
  return new URLSearchParams(window.location.search).get("data") || DEFAULT_DATA_URL;
}

function materialFromLocation() {
  return new URLSearchParams(window.location.search).get("material") || "iron";
}

async function loadTextureAtlas(url = DEFAULT_TEXTURE_ATLAS_URL) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function renderAll() {
  renderMaterialList();
  renderRoute();
}

function renderMaterialList() {
  const query = state.search.trim().toLowerCase();
  const materials = state.materials.filter((material) => {
    return !query || material.name.toLowerCase().includes(query) || material.id.includes(query);
  });

  elements.matchSummary.textContent = `${formatAmount(materials.length)} ore materials shown`;
  elements.materialList.innerHTML = materials.length
    ? materials.map(materialButton).join("")
    : `<div class="empty-state">No matching ores.</div>`;
}

function materialButton(material) {
  const selected = material.id === state.selectedMaterial ? " selected" : "";
  const iconId = representativeMaterialIconId(material.id);
  return `
    <button class="ore-material-button${selected}" type="button" data-action="select-material" data-material="${escapeHtml(material.id)}">
      ${goodIconMarkup(iconId)}
      <span>${escapeHtml(material.name)}</span>
    </button>
  `;
}

function renderRoute() {
  const graph = currentGraph();
  state.selectedOperationId = selectedOperation(graph)?.id ?? graph.operations[0]?.id ?? null;
  const quickSmelts = graph.operations.filter((operation) => operation.isQuickSmelt);
  const fallbackRoutes = graph.operations.filter((operation) => operation.isFallbackRoute);
  const mapOperations = graph.operations.length - quickSmelts.length - fallbackRoutes.length;
  const routeSummary = [
    `${formatAmount(mapOperations)} core routes`,
    fallbackRoutes.length ? `${formatAmount(fallbackRoutes.length)} fallbacks` : "",
    quickSmelts.length ? `${formatAmount(quickSmelts.length)} shortcuts` : ""
  ].filter(Boolean).join(" · ");
  elements.title.textContent = `${graph.name} Ore Processing`;
  elements.summary.textContent = `${routeSummary} from ${formatAmount(graph.steps.length)} exported recipes`;
  elements.count.textContent = `${formatAmount(graph.steps.length)} recipes`;
  renderMapControls();
  renderYieldBoard(graph);
  renderFlowMap(graph);
  renderFallbackLane(graph);
  renderQuickSmeltLane(graph);
  renderSelectedBranch(graph);
  updateMaterialUrl();
}

function currentGraph() {
  return buildOreFlowGraph(state.repository, state.selectedMaterial, state.flowView);
}

function selectedOperation(graph) {
  return graph.operations.find((operation) => operation.id === state.selectedOperationId) ?? null;
}

function renderMapControls() {
  elements.mapControls?.querySelectorAll("[data-option]").forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    input.checked = Boolean(state.flowView[input.dataset.option]);
  });
  const strategy = elements.mapControls?.querySelector("[data-role='ore-route-strategy']");
  if (strategy instanceof HTMLSelectElement) strategy.value = state.flowView.routeStrategy;
}

function renderFlowMap(graph) {
  const layout = layoutFlowGraph(graph);
  const connectors = layout.operations.flatMap((operation) => {
    const source = layout.stages.get(operation.inputStage);
    const target = layout.stages.get(operation.outputStage);
    if (!source || !target) return [];
    return [
      connectorLine(stageOutputPoint(source), operationInputPoint(operation), operation.recommended),
      connectorArrow(operationOutputPoint(operation), stageInputPoint(target), operation.recommended)
    ];
  }).join("");

  elements.flowCanvas.innerHTML = `
    <svg class="ore-flow-connectors" viewBox="0 0 ${FLOW_MAP_WIDTH} ${FLOW_MAP_HEIGHT}" aria-hidden="true">
      ${connectors}
    </svg>
    ${graph.stages.map((stage) => stageNode(stage, layout.stages.get(stage.id), graph.recommendedStageIds.includes(stage.id))).join("")}
    ${layout.operations.map(operationNode).join("")}
  `;

  fitFlowMap();
}

function layoutFlowGraph(graph) {
  const stages = new Map();
  for (const stage of graph.stages) {
    stages.set(stage.id, STAGE_LAYOUT[stage.id] ?? fallbackStagePosition(stage.order));
  }

  const groupedOperations = new Map();
  for (const operation of graph.operations.filter((candidate) => !candidate.isQuickSmelt && !candidate.isFallbackRoute)) {
    const pair = `${operation.inputStage}->${operation.outputStage}`;
    const operations = groupedOperations.get(pair) ?? [];
    operations.push(operation);
    groupedOperations.set(pair, operations);
  }

  const operations = [];
  for (const [pair, pairOperations] of groupedOperations) {
    const [inputStage, outputStage] = pair.split("->");
    const base = OPERATION_LAYOUT[pair] ?? fallbackOperationPosition(stages.get(inputStage), stages.get(outputStage));
    const gap = pairOperations.length > 1 ? 94 : 68;

    pairOperations.forEach((operation, index) => {
      operations.push({
        ...operation,
        x: base.x,
        y: Math.max(4, base.y + (index - (pairOperations.length - 1) / 2) * gap)
      });
    });
  }

  return { stages, operations };
}

function fallbackStagePosition(order) {
  return { x: 20 + order * 120, y: 520 };
}

function fallbackOperationPosition(source, target) {
  return {
    x: Math.round(((source?.x ?? 40) + (target?.x ?? 1240)) / 2),
    y: Math.round(((source?.y ?? 260) + (target?.y ?? 260)) / 2)
  };
}

function connectorLine(start, end, recommended) {
  return `<path class="ore-flow-line${recommended ? " recommended" : ""}" d="${connectorPath(start, end)}"></path>`;
}

function connectorArrow(start, end, recommended) {
  const availableWidth = Math.max(0, end.x - start.x);
  const width = Math.max(8, Math.min(recommended ? 30 : 24, availableWidth - 2));
  const halfHeight = Math.max(6, Math.round(width * (recommended ? 0.58 : 0.5)));
  const base = { x: end.x - width, y: end.y };
  return [
    connectorLine(start, base, recommended),
    `<path class="ore-flow-arrowhead${recommended ? " recommended" : ""}" d="M ${base.x} ${end.y - halfHeight} L ${end.x} ${end.y} L ${base.x} ${end.y + halfHeight} Z"></path>`
  ].join("");
}

function connectorPath(start, end) {
  const midpoint = Math.round((start.x + end.x) / 2);
  return `M ${start.x} ${start.y} H ${midpoint} V ${end.y} H ${end.x}`;
}

function stageInputPoint(stage) {
  return { x: stage.x, y: stage.y + STAGE_HEIGHT / 2 };
}

function stageOutputPoint(stage) {
  return { x: stage.x + STAGE_WIDTH, y: stage.y + STAGE_HEIGHT / 2 };
}

function operationInputPoint(operation) {
  return { x: operation.x, y: operation.y + OPERATION_HEIGHT / 2 };
}

function operationOutputPoint(operation) {
  return { x: operation.x + OPERATION_WIDTH, y: operation.y + OPERATION_HEIGHT / 2 };
}

function stageNode(stage, position, recommended) {
  if (!position) return "";
  return `
    <div class="ore-stage-node${recommended ? " recommended" : ""}" style="left:${position.x}px;top:${position.y}px">
      <div class="ore-stage-icons">
        ${stage.examples.slice(0, 2).map((id) => goodsSlot(id)).join("")}
      </div>
      <strong>${escapeHtml(stage.label)}</strong>
      ${stage.examples.length > 1 ? `<em>${formatAmount(stage.examples.length)} forms</em>` : ""}
    </div>
  `;
}

function operationNode(operation) {
  const recipeType = state.repository.getRecipeType(operation.recipeType);
  const machine = state.repository.chooseMachineForRecipe(operation.recipe).machine;
  const selected = operation.id === state.selectedOperationId ? " selected" : "";
  const recommended = operation.recommended ? " recommended" : "";
  const byproducts = secondaryOutputs(operation).slice(0, 3);
  return `
    <button
      class="ore-operation-node${selected}${recommended}"
      type="button"
      style="left:${operation.x}px;top:${operation.y}px"
      data-action="select-operation"
      data-operation-id="${escapeHtml(operation.id)}"
      aria-label="Inspect ${escapeHtml(recipeType.name)} route from ${escapeHtml(operation.inputStage)} to ${escapeHtml(operation.outputStage)}"
    >
      ${machineSlot(machine, recipeType.name, operation.recipe)}
      <strong>${escapeHtml(recipeType.name)}</strong>
      <small>${escapeHtml(formatStageLabel(operation.inputStage))} to ${escapeHtml(formatStageLabel(operation.outputStage))}</small>
      ${operation.variants.length > 1 ? `<span class="ore-operation-count">${formatAmount(operation.variants.length)}x</span>` : ""}
      ${byproducts.length ? `<span class="ore-operation-byproducts">${byproducts.map(miniByproduct).join("")}</span>` : ""}
    </button>
  `;
}

function secondaryOutputs(operation) {
  let skippedPrimary = false;
  return operation.recipe.outputs.filter((output) => {
    const classified = classifyOreRouteIngredient(state.repository, output, state.selectedMaterial);
    if (!skippedPrimary && classified?.form === operation.outputStage) {
      skippedPrimary = true;
      return false;
    }
    return true;
  });
}

function renderYieldBoard(graph) {
  const label = graph.routeStrategy === "fast" ? "Fastest route" : "Max byproducts";
  elements.yieldBoard.innerHTML = `
    <section class="ore-yield-panel possible">
      <div class="ore-yield-heading">
        <strong>Possible byproducts</strong>
        <span>Core machine branches</span>
      </div>
      <div class="ore-yield-chip-list">
        ${graph.possibleByproducts.length ? graph.possibleByproducts.map(possibleByproductChip).join("") : `<span class="ore-no-byproducts">No secondary outputs found</span>`}
      </div>
    </section>
    <section class="ore-yield-panel highlighted">
      <div class="ore-yield-heading">
        <strong>Highlighted path yield</strong>
        <span>${escapeHtml(label)}</span>
      </div>
      <div class="ore-yield-chip-list">
        ${graph.recommendedByproducts.length ? graph.recommendedByproducts.map(byproductChip).join("") : `<span class="ore-no-byproducts">None on this path</span>`}
      </div>
    </section>
  `;
}

function renderFallbackLane(graph) {
  const fallbackRoutes = graph.operations.filter((operation) => operation.isFallbackRoute);
  if (!fallbackRoutes.length) {
    elements.fallbackLane.innerHTML = "";
    elements.fallbackLane.hidden = true;
    return;
  }

  elements.fallbackLane.hidden = false;
  elements.fallbackLane.innerHTML = routeLaneMarkup({
    heading: "Hammer and crafting fallbacks",
    count: fallbackRoutes.length,
    operations: fallbackRoutes,
    cardClass: "fallback"
  });
}

function renderQuickSmeltLane(graph) {
  const quickSmelts = graph.operations.filter((operation) => operation.isQuickSmelt);
  if (!quickSmelts.length) {
    elements.quickSmeltLane.innerHTML = "";
    elements.quickSmeltLane.hidden = true;
    return;
  }

  elements.quickSmeltLane.hidden = false;
  elements.quickSmeltLane.innerHTML = routeLaneMarkup({
    heading: "Quick smelt shortcuts",
    count: quickSmelts.length,
    operations: quickSmelts,
    cardClass: "shortcut"
  });
}

function routeLaneMarkup({ heading, count, operations, cardClass }) {
  const groups = groupOperationsByRoute(operations);
  return `
    <div class="ore-route-lane-heading">
      <strong>${escapeHtml(heading)}</strong>
      <span>${formatAmount(count)} exported routes</span>
    </div>
    <div class="ore-route-lane-grid">
      ${[...groups.entries()].map(([key, routeOperations]) => routeLaneCard(key, routeOperations, cardClass)).join("")}
    </div>
  `;
}

function groupOperationsByRoute(operations) {
  const groups = new Map();
  for (const operation of operations) {
    const key = `${operation.inputStage}->${operation.outputStage}`;
    const group = groups.get(key) ?? [];
    group.push(operation);
    groups.set(key, group);
  }
  return groups;
}

function routeLaneCard(key, operations, cardClass) {
  const [inputStage, outputStage] = key.split("->");
  return `
    <article class="ore-route-lane-card ${escapeHtml(cardClass)}">
      <div class="ore-route-lane-route">
        <strong>${escapeHtml(formatStageLabel(inputStage))}</strong>
        <span aria-hidden="true"></span>
        <strong>${escapeHtml(formatStageLabel(outputStage))}</strong>
      </div>
      <div class="ore-route-lane-actions">
        ${operations.map(routeLaneButton).join("")}
      </div>
    </article>
  `;
}

function routeLaneButton(operation) {
  const type = state.repository.getRecipeType(operation.recipeType);
  const selected = operation.id === state.selectedOperationId ? " selected" : "";
  const recommended = operation.recommended ? " recommended" : "";
  return `
    <button
      class="ore-route-lane-button${selected}${recommended}"
      type="button"
      data-action="select-operation"
      data-operation-id="${escapeHtml(operation.id)}"
    >
      ${escapeHtml(type.name)}
    </button>
  `;
}

function renderSelectedBranch(graph) {
  const operation = selectedOperation(graph);
  if (!operation) {
    elements.detail.innerHTML = `<div class="ore-detail-empty">No mapped machine routes found for this material.</div>`;
    return;
  }

  const type = state.repository.getRecipeType(operation.recipeType);
  const byproducts = secondaryOutputs(operation);
  elements.detail.innerHTML = `
    <div class="ore-detail-header">
      <div>
        <strong>${escapeHtml(type.name)}</strong>
        <p>${escapeHtml(formatStageLabel(operation.inputStage))} to ${escapeHtml(formatStageLabel(operation.outputStage))}</p>
      </div>
      <span class="ore-detail-pill">${formatAmount(operation.variants.length)} exported variant${operation.variants.length === 1 ? "" : "s"}</span>
    </div>
    ${recipeCard(operation.recipe, operation.inputStage, operation.outputStage)}
    <div class="ore-byproduct-panel">
      <h3>Byproducts from one recipe run</h3>
      <div class="ore-byproduct-list">
        ${byproducts.length ? byproducts.map(byproductChip).join("") : `<span class="ore-no-byproducts">No secondary outputs</span>`}
      </div>
    </div>
    <div class="ore-variant-panel">
      <h3>Exported variants represented by this node</h3>
      <div class="ore-variant-list">
        ${operation.variants.slice(0, 20).map((variant) => `<span>${escapeHtml(variant.recipe.id)}</span>`).join("")}
        ${operation.variants.length > 20 ? `<span>+${formatAmount(operation.variants.length - 20)} more</span>` : ""}
      </div>
    </div>
  `;
}

function byproductChip(output) {
  const good = state.repository.getGood(output.id);
  const name = good?.name ?? output.id;
  const chanceText = output.chance !== undefined && !output.expected ? `${formatAmount(output.chance * 100)}%` : "";
  const amountText = output.expected ? `${formatAmount(output.amount)} avg` : `x${formatAmount(output.amount)}`;
  return `
    <span class="ore-byproduct-chip" ${tooltipAttrs({ name, id: output.id, amountText, detail: chanceText ? `${chanceText} chance` : "" })}>
      ${goodIconMarkup(output.id)}
      <span>${escapeHtml(name)}</span>
      <strong>${escapeHtml(amountText)}</strong>
      ${chanceText ? `<em>${escapeHtml(chanceText)}</em>` : ""}
    </span>
  `;
}

function possibleByproductChip(output) {
  const good = state.repository.getGood(output.id);
  const name = good?.name ?? output.id;
  const chanceText = output.maxChance < 1 ? `${formatAmount(output.maxChance * 100)}% chance` : "guaranteed";
  const routeText = `${formatAmount(output.routeCount)} route${output.routeCount === 1 ? "" : "s"}`;
  const machineText = output.recipeTypes.map((typeId) => state.repository.getRecipeType(typeId).name).join(", ");
  return `
    <span class="ore-byproduct-chip possible" ${tooltipAttrs({ name, id: output.id, amountText: routeText, detail: machineText })}>
      ${goodIconMarkup(output.id)}
      <span>${escapeHtml(name)}</span>
      <strong>${escapeHtml(routeText)}</strong>
      <em>${escapeHtml(chanceText)}</em>
    </span>
  `;
}

function recipeCard(recipe, inputStage, outputStage) {
  const type = state.repository.getRecipeType(recipe.type);
  const machine = state.repository.chooseMachineForRecipe(recipe).machine;
  const machineName = machine?.name ?? type.name;
  const meta = [
    recipe.durationTicks ? formatDuration(recipe.durationTicks) : "instant",
    recipe.eut ? `${formatAmount(recipe.eut)} EU/t` : "",
    `${formatStageLabel(inputStage)} -> ${formatStageLabel(outputStage)}`
  ].filter(Boolean);

  return `
    <article class="ore-recipe-card">
      <header class="ore-recipe-header">
        <div>
          <strong>${escapeHtml(type.name)}</strong>
          <p>${escapeHtml(recipe.id)}</p>
        </div>
        <span class="ore-recipe-stage">${escapeHtml(formatStageLabel(inputStage))} -> ${escapeHtml(formatStageLabel(outputStage))}</span>
      </header>
      <div class="ore-recipe-visual">
        <div class="ore-slot-flow">
          ${recipe.inputs.map(ingredientSlot).join("")}
        </div>
        <div class="ore-machine-stage">
          <em>Machine required</em>
          <strong>${escapeHtml(machineName)}</strong>
          <span>${recipe.durationTicks ? formatDuration(recipe.durationTicks) : "instant"}</span>
        </div>
        <span class="ore-recipe-arrow" aria-hidden="true"></span>
        <div class="ore-slot-flow outputs">
          ${recipe.outputs.map((output) => goodsSlot(output.id, output.amount)).join("")}
        </div>
      </div>
      <div class="ore-recipe-meta">
        ${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
      </div>
    </article>
  `;
}

function ingredientSlot(ingredient) {
  const resolved = state.repository.resolveIngredient(ingredient);
  return goodsSlot(resolved.id, ingredient.amount, ingredient.kind === "tag" ? ingredient.id : "");
}

function goodsSlot(goodsId, amount = 1, detail = "") {
  const good = state.repository.getGood(goodsId);
  const name = good?.name ?? goodsId;
  const kind = good?.kind ?? "item";
  const amountText = Number(amount) === 1 ? "" : formatAmount(amount);
  const icon = atlasIconMarkup(goodsId, "slot-image", 32)
    || `<span class="slot-swatch ${escapeHtml(kind)}" style="--swatch:${escapeHtml(good?.color ?? "#7d8790")}"></span>`;

  return `
    <span class="recipe-slot ${escapeHtml(kind)}" ${tooltipAttrs({ name, id: goodsId, amountText, detail })}>
      ${icon}
      ${amountText ? `<strong class="slot-amount">${escapeHtml(amountText)}</strong>` : ""}
    </span>
  `;
}

function machineSlot(machine, fallbackName, recipe) {
  const iconId = machineIconId(machine, recipe);
  if (iconId) return goodsSlot(iconId);
  return `
    <span class="recipe-slot" ${tooltipAttrs({ name: fallbackName, id: machine?.id ?? fallbackName })}>
      <span class="slot-swatch" style="--swatch:#6f8791"><span>${escapeHtml(initials(fallbackName))}</span></span>
    </span>
  `;
}

function machineIconId(machine, recipe) {
  if (machine && state.repository.getGood(machine.id)) return machine.id;
  if (!machine?.id.includes(":")) return null;

  const [namespace, family] = machine.id.split(":");
  const requiredTier = state.repository.getVoltageTierForEut(recipe.eut);
  const tiers = [...state.repository.voltageTiers.values()]
    .filter((tier) => !requiredTier || tier.voltage >= requiredTier.voltage)
    .sort((a, b) => a.voltage - b.voltage);

  for (const tier of tiers) {
    const goodsId = `${namespace}:${tier.id}_${family}`;
    if (state.repository.getGood(goodsId)) return goodsId;
  }

  return null;
}

function miniIcon(goodsId) {
  return atlasIconMarkup(goodsId, "ore-mini-icon", 32)
    || `<span class="ore-mini-icon" style="background:#7d8790"></span>`;
}

function miniByproduct(output) {
  const good = state.repository.getGood(output.id);
  const name = good?.name ?? output.id;
  const chanceText = output.chance !== undefined ? `${formatAmount(output.chance * 100)}% chance` : "";
  return `
    <span class="ore-mini-byproduct" ${tooltipAttrs({ name, id: output.id, amountText: formatAmount(output.amount), detail: chanceText })}>
      ${miniIcon(output.id)}
      <strong>${escapeHtml(formatAmount(output.amount))}</strong>
    </span>
  `;
}

function goodIconMarkup(goodsId) {
  const good = state.repository.getGood(goodsId);
  return atlasIconMarkup(goodsId, "good-icon", 20)
    || `<span class="good-swatch ${escapeHtml(good?.kind ?? "item")}" style="--swatch:${escapeHtml(good?.color ?? "#7d8790")}"></span>`;
}

function atlasIconMarkup(goodsId, className, displaySize) {
  const atlas = state.textureAtlas;
  const iconId = atlas?.icons?.[goodsId];
  if (!atlas || iconId === undefined) return "";

  const column = iconId % atlas.columns;
  const row = Math.floor(iconId / atlas.columns);
  const style = [
    `--atlas-url:url(${escapeHtml(atlas.image)})`,
    `--atlas-x:${-(column * displaySize)}px`,
    `--atlas-y:${-(row * displaySize)}px`,
    `--atlas-width:${atlas.columns * displaySize}px`
  ].join(";");
  return `<span class="${className}" style="${style}" aria-hidden="true"></span>`;
}

function representativeMaterialIconId(material) {
  const tags = [
    `forge:crushed_ores/${material}`,
    `forge:raw_materials/${material}`,
    `forge:dusts/${material}`,
    `forge:ingots/${material}`
  ];

  for (const tagId of tags) {
    const tag = state.repository.getTag(tagId);
    const id = tag?.preferred ?? tag?.entries?.[0];
    if (id) return id;
  }

  return `gtceu:${material}_dust`;
}

function initials(value) {
  return value
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function formatStageLabel(stage) {
  return stage.replaceAll("_", " ");
}

function tooltipAttrs({ name, id, amountText = "", detail = "" }) {
  return [
    "data-mc-tooltip",
    `data-tooltip-name="${escapeHtml(name)}"`,
    `data-tooltip-id="${escapeHtml(id)}"`,
    amountText ? `data-tooltip-amount="${escapeHtml(amountText)}"` : "",
    detail ? `data-tooltip-detail="${escapeHtml(detail)}"` : ""
  ].filter(Boolean).join(" ");
}

function fitFlowMap() {
  const availableWidth = Math.max(320, elements.flowFrame.clientWidth - 16);
  const scale = Math.min(1, Math.max(0.68, availableWidth / FLOW_MAP_WIDTH));
  elements.flowTrack.style.width = `${Math.round(FLOW_MAP_WIDTH * scale)}px`;
  elements.flowTrack.style.height = `${Math.round(FLOW_MAP_HEIGHT * scale)}px`;
  elements.flowCanvas.style.transform = `scale(${scale})`;
}

function updateMaterialUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("material", state.selectedMaterial);
  window.history.replaceState({}, "", url);
}

function setupMinecraftTooltips() {
  let tooltip = null;

  const getTooltip = () => {
    if (tooltip) return tooltip;
    tooltip = document.createElement("div");
    tooltip.className = "minecraft-tooltip";
    document.body.append(tooltip);
    return tooltip;
  };
  const hide = () => tooltip?.classList.remove("visible");
  const position = (event) => {
    const element = getTooltip();
    const offset = 14;
    const left = Math.min(event.clientX + offset, window.innerWidth - element.offsetWidth - 8);
    const top = Math.min(event.clientY + offset, window.innerHeight - element.offsetHeight - 8);
    element.style.left = `${Math.max(8, left)}px`;
    element.style.top = `${Math.max(8, top)}px`;
  };

  document.addEventListener("pointerover", (event) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest("[data-mc-tooltip]");
    if (!(target instanceof HTMLElement)) return;
    const element = getTooltip();
    element.innerHTML = `
      <div class="minecraft-tooltip-name">${escapeHtml(target.dataset.tooltipName ?? "Unknown item")}</div>
      ${target.dataset.tooltipAmount ? `<div class="minecraft-tooltip-amount">${escapeHtml(target.dataset.tooltipAmount)}</div>` : ""}
      ${target.dataset.tooltipDetail ? `<div class="minecraft-tooltip-detail">${escapeHtml(target.dataset.tooltipDetail)}</div>` : ""}
      <div class="minecraft-tooltip-id">${escapeHtml(target.dataset.tooltipId ?? "")}</div>
    `;
    element.classList.add("visible");
    position(event);
  });
  document.addEventListener("pointermove", (event) => {
    if (tooltip?.classList.contains("visible")) position(event);
  });
  document.addEventListener("pointerout", (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("[data-mc-tooltip]")) hide();
  });
}

function setupEvents() {
  elements.search.addEventListener("input", () => {
    state.search = elements.search.value;
    renderMaterialList();
  });

  elements.materialList.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("[data-action='select-material']");
    if (!(button instanceof HTMLElement) || !button.dataset.material) return;
    state.selectedMaterial = button.dataset.material;
    state.selectedOperationId = null;
    renderAll();
  });

  elements.mapControls.addEventListener("change", (event) => {
    const input = event.target;
    if (input instanceof HTMLSelectElement && input.dataset.action === "choose-route-strategy") {
      state.flowView.routeStrategy = input.value === "fast" ? "fast" : "yield";
      renderRoute();
      return;
    }
    if (!(input instanceof HTMLInputElement) || input.dataset.action !== "toggle-map-option") return;
    const option = input.dataset.option;
    if (!option || !(option in state.flowView)) return;
    state.flowView[option] = input.checked;
    renderRoute();
  });

  const selectOperation = (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("[data-action='select-operation']");
    if (!(button instanceof HTMLElement) || !button.dataset.operationId) return;
    state.selectedOperationId = button.dataset.operationId;
    const graph = currentGraph();
    renderFlowMap(graph);
    renderFallbackLane(graph);
    renderQuickSmeltLane(graph);
    renderSelectedBranch(graph);
  };
  elements.flowCanvas.addEventListener("click", selectOperation);
  elements.quickSmeltLane.addEventListener("click", selectOperation);

  window.addEventListener("resize", fitFlowMap);
  setupMinecraftTooltips();
}

async function main() {
  try {
    state.repository = await loadRepository(dataUrlFromLocation());
    state.textureAtlas = await loadTextureAtlas();
    state.materials = getOreRouteMaterials(state.repository);
    state.selectedMaterial = materialFromLocation();
    if (!state.materials.some((material) => material.id === state.selectedMaterial)) {
      state.selectedMaterial = state.materials[0]?.id ?? "";
    }

    const meta = state.repository.metadata;
    elements.packName.textContent = meta.packName;
    elements.packMeta.textContent = `${meta.packVersion} / Minecraft ${meta.minecraftVersion} / ${formatAmount(state.materials.length)} ore materials`;
    setupEvents();
    renderAll();
  } catch (error) {
    elements.summary.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
    console.error(error);
  }
}

main();
