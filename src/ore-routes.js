import { loadRepository } from "./repository.js?v=default-recipe-ranking-2026-05-31";
import { buildOreFlowGraph, classifyOreRouteIngredient, getOreRouteMaterials } from "./ore-routes-model.js?v=connected-ore-map-2026-05-31";
import { escapeHtml, formatAmount, formatDuration } from "./format.js?v=machine-build-counts-2026-05-31";

const DEFAULT_DATA_URL = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_TEXTURE_ATLAS_URL = "data/texture-atlas.json";
const FLOW_MAP_WIDTH = 1320;
const FLOW_MAP_HEIGHT = 620;
const STAGE_WIDTH = 92;
const STAGE_HEIGHT = 74;
const OPERATION_WIDTH = 116;
const OPERATION_HEIGHT = 58;

const STAGE_LAYOUT = {
  ore: { x: 18, y: 112 },
  raw_material: { x: 18, y: 286 },
  crushed_ore: { x: 242, y: 202 },
  purified_ore: { x: 502, y: 62 },
  refined_ore: { x: 742, y: 38 },
  impure_dust: { x: 502, y: 454 },
  pure_dust: { x: 742, y: 368 },
  dust: { x: 982, y: 244 },
  ingot: { x: 1210, y: 244 },
  gem: { x: 1210, y: 244 }
};

const OPERATION_LAYOUT = {
  "ore->crushed_ore": { x: 132, y: 120 },
  "raw_material->crushed_ore": { x: 132, y: 300 },
  "crushed_ore->purified_ore": { x: 370, y: 86 },
  "crushed_ore->refined_ore": { x: 472, y: 220 },
  "crushed_ore->impure_dust": { x: 370, y: 362 },
  "purified_ore->refined_ore": { x: 622, y: 44 },
  "purified_ore->pure_dust": { x: 622, y: 238 },
  "refined_ore->dust": { x: 852, y: 116 },
  "impure_dust->dust": { x: 662, y: 464 },
  "pure_dust->dust": { x: 852, y: 344 },
  "dust->ingot": { x: 1092, y: 252 },
  "dust->gem": { x: 1092, y: 252 },
  "purified_ore->gem": { x: 928, y: 92 }
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
    showQuickSmelts: false
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
  elements.title.textContent = `${graph.name} Ore Processing`;
  elements.summary.textContent = `${formatAmount(graph.operations.length)} mapped routes from ${formatAmount(graph.steps.length)} exported recipes`;
  elements.count.textContent = `${formatAmount(graph.steps.length)} recipes`;
  renderMapControls();
  renderFlowMap(graph);
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
}

function renderFlowMap(graph) {
  const layout = layoutFlowGraph(graph);
  const connectors = layout.operations.flatMap((operation) => {
    const source = layout.stages.get(operation.inputStage);
    const target = layout.stages.get(operation.outputStage);
    if (!source || !target) return [];
    return [
      `<path d="${connectorPath(stageOutputPoint(source), operationInputPoint(operation))}"></path>`,
      `<path d="${connectorPath(operationOutputPoint(operation), stageInputPoint(target))}" marker-end="url(#ore-flow-arrow)"></path>`
    ];
  }).join("");

  elements.flowCanvas.innerHTML = `
    <svg class="ore-flow-connectors" viewBox="0 0 ${FLOW_MAP_WIDTH} ${FLOW_MAP_HEIGHT}" aria-hidden="true">
      <defs>
        <marker id="ore-flow-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
          <path d="M 0 0 L 9 4.5 L 0 9 z"></path>
        </marker>
      </defs>
      ${connectors}
    </svg>
    ${graph.stages.map((stage) => stageNode(stage, layout.stages.get(stage.id))).join("")}
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
  for (const operation of graph.operations) {
    const pair = `${operation.inputStage}->${operation.outputStage}`;
    const operations = groupedOperations.get(pair) ?? [];
    operations.push(operation);
    groupedOperations.set(pair, operations);
  }

  const operations = [];
  for (const [pair, pairOperations] of groupedOperations) {
    const [inputStage, outputStage] = pair.split("->");
    const base = OPERATION_LAYOUT[pair] ?? fallbackOperationPosition(stages.get(inputStage), stages.get(outputStage));
    const gap = pairOperations.length > 2 ? 52 : 68;

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

function stageNode(stage, position) {
  if (!position) return "";
  return `
    <div class="ore-stage-node" style="left:${position.x}px;top:${position.y}px">
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
  const byproducts = secondaryOutputs(operation).slice(0, 2);
  return `
    <button
      class="ore-operation-node${selected}"
      type="button"
      style="left:${operation.x}px;top:${operation.y}px"
      data-action="select-operation"
      data-operation-id="${escapeHtml(operation.id)}"
      aria-label="Inspect ${escapeHtml(recipeType.name)} route from ${escapeHtml(operation.inputStage)} to ${escapeHtml(operation.outputStage)}"
    >
      ${machineSlot(machine, recipeType.name, operation.recipe)}
      <strong>${escapeHtml(recipeType.name)}</strong>
      <small>${escapeHtml(operation.inputStage)} to ${escapeHtml(operation.outputStage)}</small>
      ${operation.variants.length > 1 ? `<span class="ore-operation-count">${formatAmount(operation.variants.length)}x</span>` : ""}
      ${byproducts.length ? `<span class="ore-operation-byproducts">${byproducts.map((output) => miniIcon(output.id)).join("")}</span>` : ""}
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

function renderSelectedBranch(graph) {
  const operation = selectedOperation(graph);
  if (!operation) {
    elements.detail.innerHTML = `<div class="ore-detail-empty">No mapped machine routes found for this material.</div>`;
    return;
  }

  const type = state.repository.getRecipeType(operation.recipeType);
  elements.detail.innerHTML = `
    <div class="ore-detail-header">
      <div>
        <strong>${escapeHtml(type.name)}</strong>
        <p>${escapeHtml(operation.inputStage)} to ${escapeHtml(operation.outputStage)}</p>
      </div>
      <span class="ore-detail-pill">${formatAmount(operation.variants.length)} exported variant${operation.variants.length === 1 ? "" : "s"}</span>
    </div>
    ${recipeCard(operation.recipe, operation.inputStage, operation.outputStage)}
    <div class="ore-variant-panel">
      <h3>Exported variants represented by this node</h3>
      <div class="ore-variant-list">
        ${operation.variants.slice(0, 20).map((variant) => `<span>${escapeHtml(variant.recipe.id)}</span>`).join("")}
        ${operation.variants.length > 20 ? `<span>+${formatAmount(operation.variants.length - 20)} more</span>` : ""}
      </div>
    </div>
  `;
}

function recipeCard(recipe, inputStage, outputStage) {
  const type = state.repository.getRecipeType(recipe.type);
  const machine = state.repository.chooseMachineForRecipe(recipe).machine;
  const machineName = machine?.name ?? type.name;
  const meta = [
    recipe.durationTicks ? formatDuration(recipe.durationTicks) : "instant",
    recipe.eut ? `${formatAmount(recipe.eut)} EU/t` : "",
    `${inputStage} -> ${outputStage}`
  ].filter(Boolean);

  return `
    <article class="ore-recipe-card">
      <header class="ore-recipe-header">
        <div>
          <strong>${escapeHtml(type.name)}</strong>
          <p>${escapeHtml(recipe.id)}</p>
        </div>
        <span class="ore-recipe-stage">${escapeHtml(inputStage)} -> ${escapeHtml(outputStage)}</span>
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
  return atlasIconMarkup(goodsId, "ore-mini-icon", 18)
    || `<span class="ore-mini-icon" style="background:#7d8790"></span>`;
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
    if (!(input instanceof HTMLInputElement) || input.dataset.action !== "toggle-map-option") return;
    const option = input.dataset.option;
    if (!option || !(option in state.flowView)) return;
    state.flowView[option] = input.checked;
    renderRoute();
  });

  elements.flowCanvas.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("[data-action='select-operation']");
    if (!(button instanceof HTMLElement) || !button.dataset.operationId) return;
    state.selectedOperationId = button.dataset.operationId;
    const graph = currentGraph();
    renderFlowMap(graph);
    renderSelectedBranch(graph);
  });

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
