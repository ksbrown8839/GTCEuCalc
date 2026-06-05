import { formatAmount, formatDuration, formatRate, escapeHtml } from "./format.js?v=machine-build-counts-2026-05-31";
import { loadRepository } from "./repository.js?v=process-simple-defaults-2026-06-04";
import { BOUNDARY_PRESETS, countBoundaryPresetGoods, getBoundaryPresetGoods } from "./boundaries.js?v=inspector-2026-05-21";
import { buildProcessFlow } from "./process-flow-model.js?v=process-map-tiles-zoom-2026-06-04";

const DEFAULT_DATA_URL = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_TEXTURE_ATLAS_URL = "data/texture-atlas.json";
const NODE_SIZES = {
  good: { width: 98, height: 72 },
  recipe: { width: 154, height: 104 }
};
const TARGET_LIMIT = 64;
const MACHINE_LIMIT = 18;

const state = {
  repository: null,
  textureAtlas: null,
  dataUrl: DEFAULT_DATA_URL,
  targetGoodsId: "gtceu:diesel",
  targetRate: 6000,
  targetSearch: "",
  preferredRecipeByOutput: {},
  manualExternalGoods: new Set(),
  manualMadeGoods: new Set(),
  activeBoundaryPresets: new Set(["fluids", "base-materials", "stock-parts", "circuits"]),
  machineCounts: {},
  supplyRates: {},
  unlimitedSupplyGoods: new Set(),
  generatorEuT: 32,
  flowZoom: 1,
  selectedNodeId: null
};

const elements = {
  packName: document.querySelector("[data-role='process-pack-name']"),
  packMeta: document.querySelector("[data-role='process-pack-meta']"),
  targetSearch: document.querySelector("[data-role='process-target-search']"),
  targetMatchSummary: document.querySelector("[data-role='process-target-match-summary']"),
  targetResults: document.querySelector("[data-role='process-target-results']"),
  targetRate: document.querySelector("[data-role='process-target-rate']"),
  boundaryPresetList: document.querySelector("[data-role='process-boundary-preset-list']"),
  boundarySummary: document.querySelector("[data-role='process-boundary-summary']"),
  title: document.querySelector("[data-role='process-title']"),
  summary: document.querySelector("[data-role='process-summary']"),
  power: document.querySelector("[data-role='process-power']"),
  stats: document.querySelector("[data-role='process-stats']"),
  flowFrame: document.querySelector("[data-role='process-flow-frame']"),
  flowTrack: document.querySelector("[data-role='process-flow-track']"),
  flowCanvas: document.querySelector("[data-role='process-flow-canvas']"),
  flowZoom: document.querySelector("[data-role='process-flow-zoom']"),
  machineConfig: document.querySelector("[data-role='process-machine-config']"),
  externalInputs: document.querySelector("[data-role='process-external-inputs']"),
  byproducts: document.querySelector("[data-role='process-byproducts']"),
  detail: document.querySelector("[data-role='process-detail']"),
  generatorEuT: document.querySelector("[data-role='process-generator-eut']")
};

function currentFlow() {
  return buildProcessFlow(state.repository, {
    goodsId: state.targetGoodsId,
    amountPerMinute: state.targetRate
  }, {
    preferredRecipeByOutput: state.preferredRecipeByOutput,
    externalGoods: getEffectiveExternalGoods(),
    machineCounts: state.machineCounts,
    supplyRates: state.supplyRates,
    unlimitedSupplyGoods: state.unlimitedSupplyGoods,
    generatorEuT: state.generatorEuT
  });
}

function getEffectiveExternalGoods() {
  const externalGoods = getBoundaryPresetGoods(state.repository, state.activeBoundaryPresets);
  externalGoods.delete(state.targetGoodsId);

  for (const goodsId of state.manualMadeGoods) {
    externalGoods.delete(goodsId);
  }

  for (const goodsId of state.manualExternalGoods) {
    if (goodsId !== state.targetGoodsId) externalGoods.add(goodsId);
  }

  return externalGoods;
}

function renderAll() {
  renderTargetControls();
  renderBoundaryControls();
  renderProcess();
}

function renderTargetControls() {
  const matches = targetMatches();
  elements.targetResults.innerHTML = matches.length
    ? matches.map(targetButton).join("")
    : `<div class="empty-state">No matching process targets.</div>`;
  elements.targetMatchSummary.textContent = state.targetSearch.trim()
    ? `${formatAmount(matches.length)} matches shown`
    : `${formatAmount(matches.length)} suggested process targets`;
  elements.targetRate.value = state.targetRate;
}

function targetMatches() {
  const query = state.targetSearch.trim();
  const source = query
    ? state.repository.searchGoods(query, TARGET_LIMIT * 4)
    : [...state.repository.goods.values()];

  return source
    .map((good, index) => ({
      good,
      index,
      recipeCount: state.repository.findRecipesProducing(good.id).length,
      score: processTargetScore(good)
    }))
    .filter((match) => match.recipeCount > 0 && (query || match.good.kind === "fluid" || match.good.mod === "gtceu"))
    .sort((a, b) => b.score - a.score || b.recipeCount - a.recipeCount || a.index - b.index)
    .slice(0, TARGET_LIMIT);
}

function processTargetScore(good) {
  let score = 0;
  if (good.id === state.targetGoodsId) score += 10000;
  if (/diesel|fuel|gasoline|oil|uranium|platinum|titanium/i.test(`${good.id} ${good.name}`)) score += 900;
  if (good.kind === "fluid") score += 400;
  if (state.textureAtlas?.icons?.[good.id] !== undefined) score += 50;
  if (good.mod === "gtceu") score += 20;
  return score;
}

function targetButton(match) {
  const { good, recipeCount } = match;
  const selected = good.id === state.targetGoodsId ? " selected" : "";
  return `
    <button class="process-target-button${selected}" type="button" data-action="select-process-target" data-id="${escapeHtml(good.id)}">
      ${goodIconMarkup(good.id)}
      <span>
        <strong>${escapeHtml(good.name)}</strong>
        <em>${escapeHtml(`${formatAmount(recipeCount)} recipes · ${good.kind}`)}</em>
      </span>
    </button>
  `;
}

function renderBoundaryControls() {
  const externalGoods = getEffectiveExternalGoods();
  elements.boundaryPresetList.innerHTML = BOUNDARY_PRESETS.map((preset) => {
    const checked = state.activeBoundaryPresets.has(preset.id) ? " checked" : "";
    return `
      <label class="boundary-toggle">
        <input type="checkbox" data-action="toggle-process-boundary" data-preset-id="${escapeHtml(preset.id)}"${checked}>
        <span>${escapeHtml(preset.label)}</span>
        <strong>${formatAmount(countBoundaryPresetGoods(state.repository, preset))}</strong>
      </label>
    `;
  }).join("");
  elements.boundarySummary.textContent = `${formatAmount(externalGoods.size)} goods treated as supplied`;
}

function renderProcess() {
  const flow = currentFlow();
  const targetGood = state.repository.getGood(flow.product.goodsId);
  state.selectedNodeId = selectedNode(flow)?.id ?? flow.graph.nodes.find((node) => node.type === "recipe")?.id ?? flow.graph.nodes[0]?.id ?? null;

  elements.title.textContent = `${targetGood?.name ?? flow.product.goodsId} Process Line`;
  elements.summary.textContent = [
    `${formatRate(flow.idealOutputPerMinute)} target`,
    `${formatAmount(flow.plan.recipeRows.length)} recipes`,
    `${formatAmount(flow.machineRows.length)} machine groups`
  ].join(" / ");
  elements.power.textContent = `${formatAmount(flow.targetPowerEut)} EU/t target`;

  renderStats(flow);
  renderFlowMap(flow);
  renderMachineConfig(flow);
  renderExternalInputs(flow);
  renderByproducts(flow);
  renderSelectedDetail(flow);
  updateUrl();
}

function selectedNode(flow) {
  return flow.graph.nodes.find((node) => node.id === state.selectedNodeId) ?? null;
}

function renderStats(flow) {
  const bottleneckText = flow.bottleneck ? bottleneckDescription(flow.bottleneck) : "No active bottleneck";
  const machineText = flow.machineBottleneck ? bottleneckDescription(flow.machineBottleneck) : "No timed machine demand";
  const assumptionCount = flow.plan.warnings.length + flow.plan.suppressedWarningCount;
  const assumptions = assumptionCount
    ? `<div class="process-stat-card assumptions">
        <span>Planner assumptions</span>
        <strong>${formatAmount(assumptionCount)}</strong>
        <em>${escapeHtml(flow.plan.warnings[0] ?? "Review supplied boundaries and recipe choices")}</em>
      </div>`
    : "";
  elements.stats.innerHTML = `
    <div class="process-stat-card">
      <span>Ideal output</span>
      <strong>${formatRate(flow.idealOutputPerMinute)}</strong>
      <em>Requested target rate</em>
    </div>
    <div class="process-stat-card">
      <span>Actual output</span>
      <strong>${formatRate(flow.capacityOutputPerMinute)}</strong>
      <em>${escapeHtml(bottleneckText)}</em>
    </div>
    <div class="process-stat-card">
      <span>Machine ceiling</span>
      <strong>${formatRate(flow.machineCapacityOutputPerMinute)}</strong>
      <em>${escapeHtml(machineText)}</em>
    </div>
    <div class="process-stat-card">
      <span>Power draw</span>
      <strong>${formatAmount(flow.targetPowerEut)} EU/t</strong>
      <em>${formatAmount(flow.capacityPowerEut)} EU/t actual / ${formatAmount(flow.targetGeneratorCount)} generators @ ${formatAmount(flow.generatorEuT)} EU/t</em>
    </div>
    ${assumptions}
  `;
}

function bottleneckDescription(row) {
  if (row.type === "machine") {
    return `${machineFamilyName(row.machine, "Machine")} at ${formatAmount(row.capacityFactor)}x target`;
  }

  return `${state.repository.getGoodName(row.goodsId)} supply at ${formatAmount(row.capacityFactor)}x target`;
}

function renderFlowMap(flow) {
  const connectors = flow.graph.edges.map((edge) => connector(edge, flow.graph.nodes)).join("");
  const zoom = state.flowZoom;
  elements.flowCanvas.style.width = `${flow.graph.width}px`;
  elements.flowCanvas.style.height = `${flow.graph.height}px`;
  elements.flowCanvas.style.transform = `scale(${zoom})`;
  elements.flowCanvas.innerHTML = `
    <svg class="process-flow-connectors" viewBox="0 0 ${flow.graph.width} ${flow.graph.height}" style="width:${flow.graph.width}px;height:${flow.graph.height}px" aria-hidden="true">
      ${connectors}
    </svg>
    ${flow.graph.nodes.map((node) => processNode(node, flow)).join("")}
  `;
  elements.flowTrack.style.width = `${Math.ceil(flow.graph.width * zoom)}px`;
  elements.flowTrack.style.height = `${Math.ceil(flow.graph.height * zoom)}px`;
  elements.flowZoom.value = String(zoom);
}

function connector(edge, nodes) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const from = nodeMap.get(edge.from);
  const to = nodeMap.get(edge.to);
  if (!from || !to) return "";
  const start = nodeOutputPoint(from);
  const end = nodeInputPoint(to);
  const midpoint = Math.round((start.x + end.x) / 2);
  const baseX = Math.max(start.x + 8, end.x - 22);
  const pathEndX = Math.max(start.x + 8, baseX);
  const path = `M ${start.x} ${start.y} H ${midpoint} V ${end.y} H ${pathEndX}`;
  const arrow = `M ${baseX} ${end.y - 10} L ${end.x} ${end.y} L ${baseX} ${end.y + 10} Z`;
  return `
    <path class="process-flow-line" d="${path}"></path>
    <path class="process-flow-arrowhead" d="${arrow}"></path>
  `;
}

function nodeInputPoint(node) {
  const size = nodeSize(node);
  return { x: node.x, y: node.y + size.height / 2 };
}

function nodeOutputPoint(node) {
  const size = nodeSize(node);
  return { x: node.x + size.width, y: node.y + size.height / 2 };
}

function nodeSize(node) {
  return {
    width: node.width ?? NODE_SIZES[node.type].width,
    height: node.height ?? NODE_SIZES[node.type].height
  };
}

function processNode(node, flow) {
  if (node.type === "recipe") return recipeNode(node, flow);
  return goodNode(node, flow);
}

function goodNode(node, flow) {
  const supplyRow = flow.supplyRows.find((row) => row.goodsId === node.goodsId);
  const selected = node.id === state.selectedNodeId ? " selected" : "";
  const supplied = node.reason ? ` ${node.reason}` : "";
  const bottleneck = supplyRow?.weakestSupply ? " bottleneck" : "";
  const underbuilt = supplyRow?.underbuilt ? " underbuilt" : "";
  return `
    <button class="process-good-node${selected}${supplied}${bottleneck}${underbuilt}" type="button" style="left:${node.x}px;top:${node.y}px" data-action="select-process-node" data-node-id="${escapeHtml(node.id)}">
      ${goodSlot(node.goodsId, formatRate(node.amountPerMinute))}
      <strong>${escapeHtml(node.label)}</strong>
    </button>
  `;
}

function recipeNode(node, flow) {
  const machineRow = machineRowForRecipe(flow, node.recipe.id);
  const selected = node.id === state.selectedNodeId ? " selected" : "";
  const bottleneck = machineRow?.weakestMachine ? " bottleneck" : "";
  const underbuilt = machineRow?.underbuilt ? " underbuilt" : "";
  const secondary = secondaryOutputs(node.recipe, node.goodsId).slice(0, 2);
  const builtCount = machineRow?.builtCount ?? node.machineCount ?? 1;
  const machineLabel = machineInitials(node);
  const size = nodeSize(node);
  return `
    <button class="process-recipe-node${selected}${bottleneck}${underbuilt}" type="button" title="Configure ${escapeHtml(node.label)}" style="left:${node.x}px;top:${node.y}px;width:${size.width}px;min-height:${size.height}px" data-action="select-process-node" data-node-id="${escapeHtml(node.id)}">
      ${machineTileRackMarkup(machineLabel, builtCount)}
      <strong>${escapeHtml(node.label)}</strong>
      <span>${formatRate(node.runsPerMinute)} runs / ${formatAmount(builtCount)} built</span>
      ${secondary.length ? `<em>${secondary.map((output) => goodIconMarkup(output.id)).join("")}</em>` : ""}
    </button>
  `;
}

function machineRowForRecipe(flow, recipeId) {
  return flow.machineRows.find((row) => row.recipeRows.some((recipeRow) => recipeRow.recipe.id === recipeId));
}

function renderMachineConfig(flow) {
  const visibleRows = flow.machineRows.slice(0, MACHINE_LIMIT);
  elements.generatorEuT.value = flow.generatorEuT;
  elements.machineConfig.innerHTML = visibleRows.length
    ? visibleRows.map((row) => machineConfigRow(row)).join("")
    : `<div class="empty-state">No timed machine recipes in this process line.</div>`;
}

function machineConfigRow(row) {
  const machine = machineFamilyName(row.machine, "Machine");
  const recipeTypes = row.recipeTypes
    .map((typeId) => state.repository.getRecipeType(typeId).name)
    .filter((name) => name !== machine)
    .join(", ");
  const detail = [row.voltageTier ? `${row.voltageTier.name} tier` : "", recipeTypes].filter(Boolean).join(" / ");
  const stepText = `${formatAmount(row.recipeCount)} recipe ${row.recipeCount === 1 ? "step" : "steps"}`;
  const bottleneck = row.weakestMachine ? " bottleneck" : "";
  const underbuilt = row.underbuilt ? " underbuilt" : "";
  return `
    <article class="process-machine-row${bottleneck}${underbuilt}">
      <div class="process-row-copy">
        <span class="process-row-kicker">Machine group</span>
        <strong>${escapeHtml(machine)}</strong>
        <span>${escapeHtml(detail || stepText)}</span>
        <em>${stepText} / ${formatRate(row.runsPerMinute)} runs / ${formatAmount(row.idealLoad)} load / ${formatAmount(row.capacityFactor)}x capacity</em>
      </div>
      <label class="process-config-input">
        <span>Built machines <em>configurable</em></span>
        <input type="number" min="0" step="1" value="${formatMachineInput(row.builtCount)}" data-action="set-process-machine-count" data-machine-key="${escapeHtml(row.machineKey)}">
      </label>
    </article>
  `;
}

function renderExternalInputs(flow) {
  elements.externalInputs.innerHTML = flow.supplyRows.length
    ? flow.supplyRows.slice(0, 18).map((row) => supplyRowMarkup(row)).join("")
    : `<div class="empty-state">No supplied inputs at this boundary.</div>`;
}

function supplyRowMarkup(row) {
  const canMake = state.repository.findRecipesProducing(row.goodsId).length > 0;
  const bottleneck = row.weakestSupply ? " bottleneck" : "";
  const underbuilt = row.underbuilt ? " underbuilt" : "";
  const unlimited = row.unlimited ? " unlimited" : "";
  const supplyLimitText = row.unlimited
    ? `Uses ${formatRate(row.actualUsedAmountPerMinute)} / no supply limit`
    : `Uses ${formatRate(row.actualUsedAmountPerMinute)} / max ${formatRate(row.maxOutputPerMinute)} output`;
  const limitControl = row.unlimited
    ? `<div class="process-infinite-value"><strong>No limit</strong><span>Handled separately</span></div>`
    : `<input type="number" min="0" step="1" value="${formatNumericInput(row.availableAmountPerMinute)}" data-action="set-process-supply-rate" data-id="${escapeHtml(row.goodsId)}">`;
  return `
    <article class="process-supply-row${bottleneck}${underbuilt}${unlimited}">
      <div class="process-row-copy">
        <span class="process-row-kicker">Supplied input</span>
        ${goodChip(row.goodsId, `${formatRate(row.requiredAmountPerMinute)} required`)}
        <em>${escapeHtml(supplyLimitText)}</em>
      </div>
      <label class="process-config-input">
        <span>Available rate <em>configurable</em></span>
        ${limitControl}
      </label>
      <div class="process-supply-actions">
        <button class="secondary-button" type="button" data-action="toggle-process-supply-limit" data-id="${escapeHtml(row.goodsId)}">${row.unlimited ? "Set rate limit" : "No limit"}</button>
        ${canMake ? `<button class="secondary-button" type="button" data-action="make-process-good" data-id="${escapeHtml(row.goodsId)}">Make upstream</button>` : ""}
      </div>
    </article>
  `;
}

function renderByproducts(flow) {
  elements.byproducts.innerHTML = flow.plan.byproductRows.length
    ? flow.plan.byproductRows.slice(0, 18).map((row) => goodLine(row.goodsId, formatRate(row.amountPerMinute))).join("")
    : `<div class="empty-state">No byproducts in this selected chain.</div>`;
}

function renderSelectedDetail(flow) {
  const node = selectedNode(flow);
  if (!node) {
    elements.detail.innerHTML = `<div class="empty-state">Select a graph node.</div>`;
    return;
  }

  elements.detail.innerHTML = node.type === "recipe"
    ? recipeDetail(node, flow)
    : goodDetail(node);
}

function recipeDetail(node, flow) {
  const recipe = node.recipe;
  const machineRow = machineRowForRecipe(flow, recipe.id);
  const progress = progressBarForRecipe(recipe);
  const inputs = recipe.inputs
    .filter((input) => !input.notConsumed)
    .map((input) => ingredientChip(input, { detailSlot: true }))
    .join("");
  const outputs = recipe.outputs
    .map((output) => goodChip(output.id, formatAmount(output.amount), { detailSlot: true }))
    .join("");
  return `
    <section class="process-detail-card process-recipe-detail-card" style="${progressStyle(progress)}">
      <header>
        <div>
          <h2>${escapeHtml(recipeTypeName(recipe))}</h2>
          <p>${escapeHtml(recipe.id)}</p>
        </div>
        <strong>${formatRate(node.runsPerMinute)} runs</strong>
      </header>
      <div class="process-detail-grid">
        <div class="recipe-goods-column recipe-inputs">
          <span class="section-label">Inputs</span>
          <div class="chip-flow">${inputs || "None"}</div>
        </div>
        <div class="recipe-progress" aria-hidden="true"></div>
        <div class="recipe-goods-column recipe-outputs">
          <span class="section-label">Outputs</span>
          <div class="chip-flow">${outputs || "None"}</div>
        </div>
      </div>
      <div class="recipe-meta">
        <span>${formatDuration(recipe.durationTicks)}</span>
        <span>${formatAmount(recipe.eut)} EU/t</span>
        <span>${escapeHtml(machineName(node.machine, node.voltageTier, recipeTypeName(recipe)))}</span>
      </div>
      ${machineBuildControl(machineRow)}
      ${recipeChoiceControl(node.goodsId, recipe.id)}
    </section>
  `;
}

function machineBuildControl(row) {
  if (!row) return "";
  const machine = machineFamilyName(row.machine, "Machine");
  return `
    <div class="process-node-machine-control">
      <div>
        <span>Built machines</span>
        <strong>${escapeHtml(machine)}</strong>
        <em>${formatAmount(row.requiredCount)} needed / ${formatAmount(row.capacityFactor)}x capacity</em>
      </div>
      <label class="process-config-input">
        <span>Built machines <em>configurable</em></span>
        <input type="number" min="0" step="1" value="${formatMachineInput(row.builtCount)}" data-action="set-process-machine-count" data-machine-key="${escapeHtml(row.machineKey)}">
      </label>
    </div>
  `;
}

function goodDetail(node) {
  const producedBy = state.repository.rankRecipesForOutput(node.goodsId);
  const external = getEffectiveExternalGoods().has(node.goodsId);
  return `
    <section class="process-detail-card">
      <header>
        <div>
          <h2>${escapeHtml(node.label)}</h2>
          <p>${escapeHtml(node.goodsId)}</p>
        </div>
        <strong>${formatRate(node.amountPerMinute)}</strong>
      </header>
      <div class="process-detail-actions">
        ${producedBy.length ? `<button class="secondary-button" type="button" data-action="make-process-good" data-id="${escapeHtml(node.goodsId)}">Make upstream</button>` : ""}
        ${node.goodsId !== state.targetGoodsId ? `<button class="secondary-button" type="button" data-action="supply-process-good" data-id="${escapeHtml(node.goodsId)}">Treat as supplied</button>` : ""}
      </div>
      <p class="process-muted">${external ? "Currently treated as supplied by the active boundaries." : "Currently allowed to expand into upstream recipes."}</p>
      ${producedBy.length ? recipeChoiceControl(node.goodsId, state.preferredRecipeByOutput[node.goodsId] ?? producedBy[0].id) : ""}
    </section>
  `;
}

function recipeChoiceControl(goodsId, currentRecipeId) {
  const recipes = state.repository.rankRecipesForOutput(goodsId);
  if (recipes.length <= 1) return "";
  const groups = recipeMethodGroups(recipes);
  const selectedGroup = groups.find((group) => group.recipes.some((recipe) => recipe.id === currentRecipeId)) ?? groups[0];
  return `
    <div class="process-method-picker">
      <span>Recipe method <em>configurable</em></span>
      <p class="process-method-help">Pick the machine route first, then choose a variant when that machine has multiple recipes.</p>
      <div class="process-method-menu">
        ${groups.map((group) => methodButton(goodsId, group, selectedGroup, recipes[0])).join("")}
      </div>
      ${recipeVariantControl(goodsId, selectedGroup, currentRecipeId)}
    </div>
  `;
}

function recipeMethodGroups(recipes) {
  const groups = new Map();
  for (const recipe of recipes) {
    const key = recipe.type;
    const current = groups.get(key);
    if (current) {
      current.recipes.push(recipe);
    } else {
      groups.set(key, {
        key,
        label: recipeTypeName(recipe),
        recipes: [recipe]
      });
    }
  }
  return [...groups.values()];
}

function methodButton(goodsId, group, selectedGroup, recommendedRecipe) {
  const selected = group.key === selectedGroup.key ? " selected" : "";
  const recommended = group.recipes.some((recipe) => recipe.id === recommendedRecipe.id) ? " recommended" : "";
  const variantText = `${formatAmount(group.recipes.length)} ${group.recipes.length === 1 ? "variant" : "variants"}`;
  return `
    <button class="process-method-button${selected}${recommended}" type="button" data-action="choose-process-machine" data-output-id="${escapeHtml(goodsId)}" data-recipe-id="${escapeHtml(group.recipes[0].id)}">
      <span class="machine-icon">${escapeHtml(machineInitialsForName(group.label))}</span>
      <span>
        <strong>${escapeHtml(group.label)}</strong>
        <em>${escapeHtml(variantText)}</em>
      </span>
    </button>
  `;
}

function recipeVariantControl(goodsId, group, currentRecipeId) {
  const selectedRecipeId = group.recipes.some((recipe) => recipe.id === currentRecipeId)
    ? currentRecipeId
    : group.recipes[0].id;
  if (group.recipes.length === 1) {
    return `<em class="process-method-note">${escapeHtml(recipeVariantLabel(group.recipes[0], goodsId, 0))}</em>`;
  }

  return `
    <label class="process-recipe-choice">
      <span>${escapeHtml(group.label)} variant</span>
      <select data-action="choose-process-recipe" data-output-id="${escapeHtml(goodsId)}">
        ${group.recipes.slice(0, 40).map((recipe, index) => {
          const selected = recipe.id === selectedRecipeId ? " selected" : "";
          return `<option value="${escapeHtml(recipe.id)}"${selected}>${escapeHtml(recipeVariantLabel(recipe, goodsId, index))}</option>`;
        }).join("")}
      </select>
    </label>
  `;
}

function recipeVariantLabel(recipe, goodsId, index) {
  const inputs = recipe.inputs
    .filter((input) => !input.notConsumed)
    .slice(0, 3)
    .map((input) => `${formatAmount(input.amount)} ${state.repository.getIngredientName(input)}`)
    .join(" + ");
  const extraInputCount = recipe.inputs.filter((input) => !input.notConsumed).length - 3;
  const output = recipe.outputs.find((item) => item.id === goodsId);
  const outputText = output
    ? `${formatAmount(output.amount)} ${state.repository.getGoodName(goodsId)}`
    : state.repository.getGoodName(goodsId);
  const byproductCount = secondaryOutputs(recipe, goodsId).length;
  const meta = [
    formatDuration(recipe.durationTicks),
    recipe.eut ? `${formatAmount(recipe.eut)} EU/t` : "",
    byproductCount ? `${formatAmount(byproductCount)} byproducts` : ""
  ].filter(Boolean).join(", ");
  const inputText = `${inputs || recipe.id}${extraInputCount > 0 ? ` + ${formatAmount(extraInputCount)} more` : ""}`;
  return `${index === 0 ? "Recommended / " : ""}${inputText} -> ${outputText}${meta ? ` (${meta})` : ""}`;
}

function goodLine(goodsId, amountText, options = {}) {
  const action = options.action
    ? `<button class="secondary-button" type="button" data-action="${escapeHtml(options.action)}" data-id="${escapeHtml(goodsId)}">${escapeHtml(options.actionLabel)}</button>`
    : "";
  return `
    <div class="process-good-line">
      ${goodChip(goodsId, amountText)}
      ${action}
    </div>
  `;
}

function goodChip(goodsId, amountText = "", options = {}) {
  const good = state.repository.getGood(goodsId);
  const name = good?.name ?? goodsId;
  const kind = good?.kind ?? "item";
  const detailClass = options.detailSlot ? " detail-slot" : "";
  const iconSize = options.detailSlot ? 32 : 18;
  return `
    <span class="good-chip ${escapeHtml(kind)}${detailClass}" ${goodTooltipAttrs(good, goodsId, amountText)}>
      ${goodIconMarkup(goodsId, iconSize)}
      <span>${escapeHtml(name)}</span>
      ${amountText ? `<strong>${escapeHtml(amountText)}</strong>` : ""}
    </span>
  `;
}

function ingredientChip(ingredient, options = {}) {
  const resolved = state.repository.resolveIngredient(ingredient);
  const detailClass = options.detailSlot ? " detail-slot" : "";
  if (resolved.good) return goodChip(resolved.id, formatAmount(ingredient.amount), options);
  return `
    <span class="good-chip muted${detailClass}">
      <span class="good-swatch tag"></span>
      <span>${escapeHtml(state.repository.getIngredientName(ingredient))}</span>
      <strong>${formatAmount(ingredient.amount)}</strong>
    </span>
  `;
}

function goodSlot(goodsId, amountText) {
  const good = state.repository.getGood(goodsId);
  const kind = good?.kind ?? "item";
  return `
    <span class="process-good-slot ${kind}" ${goodTooltipAttrs(good, goodsId, amountText)}>
      ${slotIconMarkup(goodsId, kind, good?.color ?? "#7d8790", good?.name ?? goodsId)}
      <span>${escapeHtml(good?.name ?? goodsId)}</span>
      <strong>${escapeHtml(amountText)}</strong>
    </span>
  `;
}

function goodIconMarkup(goodsId, displaySize = 18) {
  const good = state.repository.getGood(goodsId);
  const kind = good?.kind ?? "item";
  const atlasIcon = atlasIconMarkup(goodsId, kind, "good-icon", displaySize);
  if (atlasIcon) return atlasIcon;
  return `<span class="good-swatch ${kind}" style="--swatch:${escapeHtml(good?.color ?? "#7d8790")}"></span>`;
}

function machineTileRackMarkup(label, count) {
  const builtCount = Math.max(0, Math.floor(Number(count) || 0));
  const visibleCount = Math.min(Math.max(builtCount, 1), 8);
  const extraCount = Math.max(0, builtCount - visibleCount);
  const empty = builtCount === 0 ? " empty" : "";
  const tiles = Array.from({ length: visibleCount }, (_, index) => {
    return `<span class="machine-tile" aria-label="Machine ${index + 1}">${escapeHtml(label)}</span>`;
  }).join("");
  return `
    <span class="machine-tile-rack${empty}" title="${formatAmount(builtCount)} built machines">
      ${tiles}
      ${extraCount > 0 ? `<span class="machine-tile-extra">+${formatAmount(extraCount)}</span>` : ""}
    </span>
  `;
}

function slotIconMarkup(goodsId, kind, color, label) {
  const atlasIcon = atlasIconMarkup(goodsId, kind, "slot-image", 32);
  if (atlasIcon) return atlasIcon;
  return `<span class="slot-swatch ${kind}" style="--swatch:${escapeHtml(color)}"><span>${escapeHtml(slotInitials(label, goodsId))}</span></span>`;
}

function atlasIconMarkup(goodsId, kind, className, displaySize) {
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
  return `<span class="${className} ${kind}" style="${style}" aria-hidden="true"></span>`;
}

function goodTooltipAttrs(good, fallbackId, amountText = "") {
  return [
    "data-mc-tooltip",
    `data-tooltip-name="${escapeHtml(good?.name ?? fallbackId)}"`,
    `data-tooltip-id="${escapeHtml(good?.id ?? fallbackId)}"`,
    amountText ? `data-tooltip-amount="${escapeHtml(amountText)}"` : "",
    good?.kind ? `data-tooltip-kind="${escapeHtml(good.kind)}"` : "",
    good?.mod ? `data-tooltip-mod="${escapeHtml(good.mod)}"` : ""
  ].filter(Boolean).join(" ");
}

function machineInitials(node) {
  return machineInitialsForName(machineName(node.machine, node.voltageTier, node.label));
}

function machineInitialsForName(name) {
  const words = name.split(/[^a-z0-9]+/i).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "M";
}

function machineName(machine, voltageTier, fallback = "Unknown machine") {
  if (!machine) return fallback;
  if (!voltageTier || machine.voltageTier) return machine.name;
  return `${voltageTier.name} ${machine.name}`;
}

function machineFamilyName(machine, fallback = "Unknown machine") {
  return machine?.name ?? fallback;
}

function recipeTypeName(recipe) {
  return state.repository.getRecipeType(recipe.type).name;
}

function progressBarForRecipe(recipe) {
  const key = `${recipe.type} ${recipeTypeName(recipe)}`.toLowerCase();
  const base = "assets/gui/gtceu/progress_bar/";
  const choices = [
    [/circuit[_\s-]*assembler/, "progress_bar_circuit_assembler.png", 20, 20],
    [/distillation/, "progress_bar_distillation_tower.png", 65, 75],
    [/cracking/, "progress_bar_cracking.png", 20, 20],
    [/macerat/, "progress_bar_macerate.png", 20, 20],
    [/compress/, "progress_bar_compress.png", 20, 20],
    [/assembler/, "progress_bar_assembler.png", 20, 20],
    [/mixer/, "progress_bar_mixer.png", 20, 20],
    [/bath/, "progress_bar_bath.png", 20, 20]
  ];
  const match = choices.find(([pattern]) => pattern.test(key));
  const [, file, frameWidth, frameHeight] = match ?? [null, "progress_bar_arrow.png", 20, 20];
  const scale = file === "progress_bar_distillation_tower.png" ? 1.2 : 2.6;
  const width = Math.round(frameWidth * scale);
  const height = Math.round(frameHeight * scale);

  return {
    url: `${base}${file}`,
    width,
    height,
    sheetHeight: height * 2
  };
}

function progressStyle(progress) {
  return [
    `--gtceu-progress:url(${progress.url})`,
    `--gtceu-progress-width:${progress.width}px`,
    `--gtceu-progress-height:${progress.height}px`,
    `--gtceu-progress-sheet-height:${progress.sheetHeight}px`
  ].join(";");
}

function secondaryOutputs(recipe, primaryGoodsId) {
  return recipe.outputs.filter((output) => output.id !== primaryGoodsId && state.repository.getGood(output.id));
}

function formatMachineInput(value) {
  return Number.isFinite(value) ? String(Math.max(0, Math.floor(value))) : "0";
}

function formatNumericInput(value) {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(Math.max(0, value) * 1000) / 1000);
}

function slotInitials(name, fallback) {
  const words = String(name).split(/[^a-z0-9]+/i).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((word) => word[0]).join("") : (words[0] ?? fallback).slice(0, 2)).toUpperCase();
}

function updateUrl() {
  const params = new URLSearchParams();
  if (state.dataUrl !== DEFAULT_DATA_URL) params.set("data", state.dataUrl);
  params.set("target", state.targetGoodsId);
  params.set("rate", String(state.targetRate));
  const nextUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, "", nextUrl);
}

function dataUrlFromLocation() {
  return new URLSearchParams(window.location.search).get("data") || DEFAULT_DATA_URL;
}

function targetFromLocation() {
  return new URLSearchParams(window.location.search).get("target");
}

function rateFromLocation() {
  const value = Number(new URLSearchParams(window.location.search).get("rate"));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function textureAtlasUrlFromLocation() {
  const value = new URLSearchParams(window.location.search).get("textures");
  if (value === "none") return null;
  return value || DEFAULT_TEXTURE_ATLAS_URL;
}

async function loadTextureAtlas(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function setupEvents() {
  elements.targetSearch.addEventListener("input", (event) => {
    state.targetSearch = event.target.value;
    renderTargetControls();
  });

  elements.targetRate.addEventListener("input", (event) => {
    state.targetRate = Math.max(0, Number(event.target.value) || 0);
    renderProcess();
  });

  elements.generatorEuT.addEventListener("input", (event) => {
    state.generatorEuT = Math.max(1, Number(event.target.value) || 32);
    renderProcess();
  });

  elements.flowZoom.addEventListener("input", (event) => {
    setFlowZoom(event.target.value);
  });

  setupFlowPan();

  document.addEventListener("input", (event) => {
    const target = event.target.closest("[data-action]");
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;

    if (action === "set-process-machine-count") {
      const machineKey = target.dataset.machineKey;
      if (!machineKey) return;
      state.machineCounts[machineKey] = Math.max(0, Number(target.value) || 0);
      renderProcess();
      return;
    }

    if (action === "set-process-supply-rate") {
      const goodsId = target.dataset.id;
      if (!goodsId) return;
      state.supplyRates[goodsId] = Math.max(0, Number(target.value) || 0);
      renderProcess();
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target.closest("[data-action]");
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;

    if (action === "toggle-process-boundary") {
      const presetId = target.dataset.presetId;
      if (!presetId) return;
      if (target.checked) state.activeBoundaryPresets.add(presetId);
      else state.activeBoundaryPresets.delete(presetId);
      renderAll();
    }

    if (action === "choose-process-recipe") {
      const outputId = target.dataset.outputId;
      if (!outputId) return;
      chooseProcessRecipe(outputId, target.value);
      renderProcess();
    }
  });

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;
    const goodsId = target.dataset.id;

    if (action === "select-process-target" && goodsId) {
      state.targetGoodsId = goodsId;
      state.manualMadeGoods.add(goodsId);
      state.manualExternalGoods.delete(goodsId);
      state.machineCounts = {};
      state.supplyRates = {};
      state.unlimitedSupplyGoods = new Set();
      state.targetSearch = "";
      elements.targetSearch.value = "";
      renderAll();
      return;
    }

    if (action === "select-process-node") {
      state.selectedNodeId = target.dataset.nodeId ?? null;
      renderProcess();
      return;
    }

    if (action === "choose-process-machine" && target.dataset.outputId && target.dataset.recipeId) {
      chooseProcessRecipe(target.dataset.outputId, target.dataset.recipeId);
      renderProcess();
      return;
    }

    if (action === "process-zoom-out") {
      setFlowZoom(state.flowZoom - 0.1);
      return;
    }

    if (action === "process-zoom-in") {
      setFlowZoom(state.flowZoom + 0.1);
      return;
    }

    if (action === "process-zoom-reset") {
      setFlowZoom(1);
      return;
    }

    if (action === "make-process-good" && goodsId) {
      state.manualMadeGoods.add(goodsId);
      state.manualExternalGoods.delete(goodsId);
      state.unlimitedSupplyGoods.delete(goodsId);
      renderAll();
      return;
    }

    if (action === "supply-process-good" && goodsId) {
      state.manualExternalGoods.add(goodsId);
      state.manualMadeGoods.delete(goodsId);
      delete state.preferredRecipeByOutput[goodsId];
      renderAll();
      return;
    }

    if (action === "toggle-process-supply-limit" && goodsId) {
      if (state.unlimitedSupplyGoods.has(goodsId)) state.unlimitedSupplyGoods.delete(goodsId);
      else state.unlimitedSupplyGoods.add(goodsId);
      renderProcess();
    }
  });
}

function setFlowZoom(value) {
  const nextZoom = Math.round(Math.min(1.75, Math.max(0.5, Number(value) || 1)) * 100) / 100;
  if (nextZoom === state.flowZoom) {
    elements.flowZoom.value = String(state.flowZoom);
    return;
  }
  state.flowZoom = nextZoom;
  renderProcess();
}

function setupFlowPan() {
  let pan = null;

  elements.flowFrame.addEventListener("pointerdown", (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(".process-good-node, .process-recipe-node")) return;
    pan = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: elements.flowFrame.scrollLeft,
      scrollTop: elements.flowFrame.scrollTop
    };
    elements.flowFrame.setPointerCapture(event.pointerId);
    elements.flowFrame.classList.add("panning");
  });

  elements.flowFrame.addEventListener("pointermove", (event) => {
    if (!pan || pan.pointerId !== event.pointerId) return;
    elements.flowFrame.scrollLeft = pan.scrollLeft - (event.clientX - pan.x);
    elements.flowFrame.scrollTop = pan.scrollTop - (event.clientY - pan.y);
  });

  for (const eventName of ["pointerup", "pointercancel"]) {
    elements.flowFrame.addEventListener(eventName, (event) => {
      if (!pan || pan.pointerId !== event.pointerId) return;
      pan = null;
      elements.flowFrame.classList.remove("panning");
    });
  }
}

function chooseProcessRecipe(outputId, recipeId) {
  state.preferredRecipeByOutput[outputId] = recipeId;
  state.manualMadeGoods.add(outputId);
  state.manualExternalGoods.delete(outputId);
}

function setupMinecraftTooltips() {
  let tooltip = null;
  let activeTarget = null;
  function getTooltip() {
    if (tooltip) return tooltip;
    tooltip = document.createElement("div");
    tooltip.className = "minecraft-tooltip";
    tooltip.setAttribute("role", "tooltip");
    document.body.append(tooltip);
    return tooltip;
  }
  function position(x, y) {
    if (!tooltip) return;
    const pad = 14;
    tooltip.style.left = `${Math.min(window.innerWidth - tooltip.offsetWidth - 10, x + pad)}px`;
    tooltip.style.top = `${Math.min(window.innerHeight - tooltip.offsetHeight - 10, y + pad)}px`;
  }
  function show(target, event) {
    const node = getTooltip();
    activeTarget = target;
    node.innerHTML = `
      <div class="minecraft-tooltip-name">${escapeHtml(target.dataset.tooltipName ?? "Unknown")}</div>
      ${target.dataset.tooltipAmount ? `<div class="minecraft-tooltip-amount">${escapeHtml(target.dataset.tooltipAmount)}</div>` : ""}
      <div class="minecraft-tooltip-detail">${escapeHtml(target.dataset.tooltipId ?? "")}</div>
      ${target.dataset.tooltipMod || target.dataset.tooltipKind ? `<div class="minecraft-tooltip-meta">${escapeHtml([target.dataset.tooltipMod, target.dataset.tooltipKind].filter(Boolean).join(" / "))}</div>` : ""}
    `;
    node.classList.add("visible");
    position(event.clientX, event.clientY);
  }
  function hide() {
    activeTarget = null;
    tooltip?.classList.remove("visible");
  }
  document.addEventListener("pointerover", (event) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest("[data-mc-tooltip]");
    if (target instanceof HTMLElement) show(target, event);
  });
  document.addEventListener("pointermove", (event) => {
    if (activeTarget) position(event.clientX, event.clientY);
  });
  document.addEventListener("pointerout", (event) => {
    if (!activeTarget) return;
    if (event.relatedTarget instanceof Node && activeTarget.contains(event.relatedTarget)) return;
    hide();
  });
}

async function main() {
  try {
    state.dataUrl = dataUrlFromLocation();
    state.repository = await loadRepository(state.dataUrl);
    state.textureAtlas = await loadTextureAtlas(textureAtlasUrlFromLocation());
    state.targetGoodsId = targetFromLocation() && state.repository.getGood(targetFromLocation())
      ? targetFromLocation()
      : state.repository.getGood("gtceu:diesel")
        ? "gtceu:diesel"
        : [...state.repository.goods.values()].find((good) => state.repository.findRecipesProducing(good.id).length)?.id;
    state.targetRate = rateFromLocation() ?? state.targetRate;
    state.manualMadeGoods.add(state.targetGoodsId);
    const meta = state.repository.metadata;
    const packCounts = `${formatAmount(state.repository.goods.size)} goods / ${formatAmount(state.repository.recipes.length)} recipes`;
    elements.packName.textContent = meta.packName;
    elements.packMeta.textContent = `${meta.packVersion} / Minecraft ${meta.minecraftVersion} / ${packCounts}`;
    setupEvents();
    setupMinecraftTooltips();
    renderAll();
  } catch (error) {
    elements.summary.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
    console.error(error);
  }
}

main();
