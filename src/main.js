import { formatAmount, formatAverageEut, formatDuration, formatRate, escapeHtml } from "./format.js?v=inspector-2026-05-21";
import { loadRepository } from "./repository.js?v=inspector-2026-05-21";
import { createPlan } from "./planner.js?v=inspector-2026-05-21";
import { BOUNDARY_PRESETS, countBoundaryPresetGoods, getBoundaryPresetForGood, getBoundaryPresetGoods } from "./boundaries.js?v=inspector-2026-05-21";

const DEFAULT_DATA_URL = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_TEXTURE_ATLAS_URL = "data/texture-atlas.json";

const state = {
  repository: null,
  textureAtlas: null,
  products: [{ goodsId: "gtceu:greenhouse", amountPerMinute: 1 }],
  preferredRecipeByOutput: {},
  manualExternalGoods: new Set(),
  manualMadeGoods: new Set(),
  activeBoundaryPresets: new Set(["fluids", "base-materials", "stock-parts", "circuits"]),
  targetSearch: "",
  inspectSearch: "",
  selectedGoodsId: null,
  inspectorOpen: false,
  treeView: {
    showRecipeChoices: false,
    showRecipePreviews: true,
    showInspectButtons: false
  },
  dataUrl: DEFAULT_DATA_URL
};

const EXTERNAL_RECIPE_VALUE = "__external__";

const EXTERNAL_INPUT_GROUPS = [
  { id: "fluids", label: "Fluids" },
  { id: "circuits", label: "Circuits" },
  { id: "stock-parts", label: "Stock parts" },
  { id: "base-materials", label: "Base materials" },
  { id: "other", label: "Other inputs" },
  { id: "unresolved", label: "Unresolved" }
];

const elements = {
  status: document.querySelector("[data-role='status']"),
  productList: document.querySelector("[data-role='product-list']"),
  productSelect: document.querySelector("[data-role='product-select']"),
  targetSearchInput: document.querySelector("[data-role='target-search']"),
  targetMatchSummary: document.querySelector("[data-role='target-match-summary']"),
  addProduct: document.querySelector("[data-action='add-product']"),
  craftingTree: document.querySelector("[data-role='crafting-tree']"),
  treeViewControls: document.querySelector("[data-role='tree-view-controls']"),
  recipePlan: document.querySelector("[data-role='recipe-plan']"),
  externalInputs: document.querySelector("[data-role='external-inputs']"),
  byproducts: document.querySelector("[data-role='byproducts']"),
  boundaryPresetList: document.querySelector("[data-role='boundary-preset-list']"),
  boundarySummary: document.querySelector("[data-role='boundary-summary']"),
  inspectSearchInput: document.querySelector("[data-role='inspect-search']"),
  inspectMatchSummary: document.querySelector("[data-role='inspect-match-summary']"),
  inspectResults: document.querySelector("[data-role='inspect-results']"),
  inspectorDrawer: document.querySelector("[data-role='inspector-drawer']"),
  inspectorPanel: document.querySelector("[data-role='inspector-panel']"),
  packName: document.querySelector("[data-role='pack-name']"),
  packMeta: document.querySelector("[data-role='pack-meta']"),
  totalPower: document.querySelector("[data-role='total-power']")
};

function goodIconMarkup(repository, id) {
  const good = repository.getGood(id);
  const color = good?.color ?? "#7d8790";
  const kind = good?.kind ?? "item";
  const atlasIcon = atlasIconMarkup(id, kind, "good-icon", 18);

  if (atlasIcon) {
    return atlasIcon;
  }

  return `<span class="good-swatch ${kind}" style="--swatch:${escapeHtml(color)}"></span>`;
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

function slotIconMarkup({ goodsId, kind, color, label, fallback }) {
  const atlasIcon = goodsId ? atlasIconMarkup(goodsId, kind, "slot-image", 32) : "";
  if (atlasIcon) {
    return atlasIcon;
  }

  return `
    <span class="slot-swatch ${kind}" style="--swatch:${escapeHtml(color)}">
      <span>${escapeHtml(slotInitials(label, fallback))}</span>
    </span>
  `;
}

function tooltipAttrs({ name, id, amountText = "", kind = "", mod = "", detail = "" }) {
  const attrs = [
    "data-mc-tooltip",
    `data-tooltip-name="${escapeHtml(name)}"`,
    `data-tooltip-id="${escapeHtml(id)}"`
  ];

  if (amountText) attrs.push(`data-tooltip-amount="${escapeHtml(amountText)}"`);
  if (kind) attrs.push(`data-tooltip-kind="${escapeHtml(kind)}"`);
  if (mod) attrs.push(`data-tooltip-mod="${escapeHtml(mod)}"`);
  if (detail) attrs.push(`data-tooltip-detail="${escapeHtml(detail)}"`);

  return attrs.join(" ");
}

function goodTooltipAttrs(good, fallbackId, amountText = "", detail = "") {
  return tooltipAttrs({
    name: good?.name ?? fallbackId,
    id: good?.id ?? fallbackId,
    amountText,
    kind: good?.kind ?? "",
    mod: good?.mod ?? "",
    detail
  });
}

function goodChip(repository, id, amountText = "") {
  const good = repository.getGood(id);
  const name = good?.name ?? id;
  return `
    <span class="good-chip" ${goodTooltipAttrs(good, id, amountText)}>
      ${goodIconMarkup(repository, id)}
      <span>${escapeHtml(name)}</span>
      ${amountText ? `<strong>${escapeHtml(amountText)}</strong>` : ""}
    </span>
  `;
}

function ingredientChip(repository, ingredient) {
  const color = repository.getIngredientColor(ingredient);
  const name = repository.getIngredientName(ingredient);
  const prefix = ingredient.kind === "tag" ? "#" : "";
  const resolved = ingredient.kind === "tag" ? repository.resolveIngredient(ingredient) : null;
  const atlasIcon = atlasIconMarkup(resolved?.good ? resolved.id : ingredient.id, ingredient.kind, "good-icon", 18);
  const tooltip = resolved?.good
    ? goodTooltipAttrs(resolved.good, resolved.id, formatAmount(ingredient.amount), `${prefix}${ingredient.id}`)
    : tooltipAttrs({
        name,
        id: `${prefix}${ingredient.id}`,
        amountText: formatAmount(ingredient.amount),
        kind: ingredient.kind,
        detail: "Unresolved ingredient"
      });
  return `
    <span class="good-chip muted" ${tooltip}>
      ${atlasIcon || `<span class="good-swatch ${ingredient.kind}" style="--swatch:${escapeHtml(color)}"></span>`}
      <span>${escapeHtml(name)}</span>
      <strong>${formatAmount(ingredient.amount)}</strong>
    </span>
  `;
}

function goodSlot(repository, id, amountText = "", options = {}) {
  const good = repository.getGood(id);
  const color = good?.color ?? "#7d8790";
  const name = good?.name ?? id;
  const kind = good?.kind ?? "item";
  const className = options.className ? ` ${options.className}` : "";
  const content = `
    ${slotIconMarkup({ goodsId: id, kind, color, label: name, fallback: id })}
    <span class="slot-name">${escapeHtml(name)}</span>
    ${amountText ? `<strong class="slot-amount">${escapeHtml(amountText)}</strong>` : ""}
  `;

  if (!good) {
    return `<span class="recipe-slot unresolved${className}" ${goodTooltipAttrs(good, id, amountText, "Unresolved good")}>${content}</span>`;
  }

  return `
    <button class="recipe-slot ${kind}${className}" type="button" ${goodTooltipAttrs(good, id, amountText)} aria-label="Inspect ${escapeHtml(name)}" data-action="inspect-good" data-id="${escapeHtml(id)}">
      ${content}
    </button>
  `;
}

function ingredientSlot(repository, ingredient) {
  if (!ingredient) {
    return `<span class="recipe-slot empty" aria-hidden="true"></span>`;
  }

  if (ingredient.kind === "tag") {
    const resolved = repository.resolveIngredient(ingredient);
    const color = resolved.good?.color ?? "#7d8790";
    const name = repository.getIngredientName(ingredient);
    const detail = resolved.good ? `${ingredient.id} -> ${resolved.good.name}` : ingredient.id;
    const content = `
      ${slotIconMarkup({ goodsId: resolved.good ? resolved.id : null, kind: "tag", color, label: name, fallback: ingredient.id })}
      <span class="slot-name">${escapeHtml(name)}</span>
      ${formatSlotAmount(ingredient.amount) ? `<strong class="slot-amount">${formatSlotAmount(ingredient.amount)}</strong>` : ""}
    `;

    if (!resolved.good) {
      return `<span class="recipe-slot tag unresolved" ${tooltipAttrs({ name, id: ingredient.id, amountText: formatSlotAmount(ingredient.amount), kind: "tag", detail: "Unresolved tag" })}>${content}</span>`;
    }

    return `
      <button class="recipe-slot tag" type="button" ${goodTooltipAttrs(resolved.good, resolved.id, formatSlotAmount(ingredient.amount), detail)} aria-label="Inspect ${escapeHtml(resolved.good.name)}" data-action="inspect-good" data-id="${escapeHtml(resolved.id)}">
        ${content}
      </button>
    `;
  }

  return goodSlot(repository, ingredient.id, formatSlotAmount(ingredient.amount));
}

function recipeVisual(repository, recipe, options = {}) {
  if (!recipe) return "";
  const type = repository.getRecipeType(recipe.type);
  const inputs = recipe.inputs.filter((input) => !input.notConsumed);
  const outputs = recipe.outputs.filter((output) => repository.getGood(output.id));
  const isCrafting = isCraftingRecipe(recipe);

  if (isCrafting) {
    return `
      <span class="recipe-visual crafting-visual" aria-label="${escapeHtml(type.name)} recipe preview">
        <span class="crafting-grid">
          ${Array.from({ length: 9 }, (_, index) => ingredientSlot(repository, inputs[index])).join("")}
        </span>
        <span class="recipe-arrow" aria-hidden="true">&rarr;</span>
        <span class="recipe-output-stack">
          ${outputs.length ? outputs.slice(0, 3).map((output) => goodSlot(repository, output.id, formatSlotAmount(output.amount), { className: "output-slot" })).join("") : `<span class="recipe-slot empty"></span>`}
        </span>
      </span>
    `;
  }

  const visibleInputs = inputs.slice(0, 8);
  const hiddenInputCount = Math.max(0, inputs.length - visibleInputs.length);
  const visibleOutputs = outputs.slice(0, 4);

  return `
    <span class="recipe-visual machine-visual" aria-label="${escapeHtml(type.name)} recipe preview">
      <span class="machine-inputs">
        ${visibleInputs.map((input) => ingredientSlot(repository, input)).join("")}
        ${hiddenInputCount ? overflowSlot(hiddenInputCount) : ""}
      </span>
      <span class="machine-stage${options.compactMachineStage ? " compact" : ""}">
        ${options.compactMachineStage
          ? `<em>Process</em>${recipe.durationTicks ? ` <strong>${formatDuration(recipe.durationTicks)}</strong>` : ""}`
          : `<em>Machine</em> <span>${escapeHtml(type.name)}</span>${recipe.durationTicks ? ` <strong>${formatDuration(recipe.durationTicks)}</strong>` : ""}`}
      </span>
      <span class="recipe-arrow" aria-hidden="true">&rarr;</span>
      <span class="recipe-output-stack">
        ${visibleOutputs.length ? visibleOutputs.map((output) => goodSlot(repository, output.id, formatSlotAmount(output.amount), { className: "output-slot" })).join("") : `<span class="recipe-slot empty"></span>`}
      </span>
    </span>
  `;
}

function formatSlotAmount(amount) {
  return Number(amount) === 1 ? "" : formatAmount(amount);
}

function slotInitials(name, fallback) {
  const words = String(name)
    .replace(/^#/, "")
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
  const letters = words.length > 1
    ? words.slice(0, 2).map((word) => word[0]).join("")
    : (words[0] ?? fallback).slice(0, 2);
  return letters.toUpperCase();
}

function overflowSlot(count) {
  return `
    <span class="recipe-slot overflow" title="${formatAmount(count)} more ingredients">
      <span class="slot-name">+${formatAmount(count)}</span>
    </span>
  `;
}

function isCraftingRecipe(recipe) {
  return recipe.type.includes("crafting") || recipe.type.includes("shaped") || recipe.type.includes("shapeless");
}

function getEffectiveExternalGoods(repository) {
  const externalGoods = getBoundaryPresetGoods(repository, state.activeBoundaryPresets);

  for (const goodsId of state.manualMadeGoods) {
    externalGoods.delete(goodsId);
  }

  for (const goodsId of state.manualExternalGoods) {
    externalGoods.add(goodsId);
  }

  for (const product of state.products) {
    externalGoods.delete(product.goodsId);
  }

  return externalGoods;
}

function setGoodAsMade(goodsId) {
  state.manualExternalGoods.delete(goodsId);
  state.manualMadeGoods.add(goodsId);
}

function setGoodAsExternal(goodsId) {
  state.manualExternalGoods.add(goodsId);
  state.manualMadeGoods.delete(goodsId);
  delete state.preferredRecipeByOutput[goodsId];
}

function setSingleTarget(goodsId) {
  state.products = [{ goodsId, amountPerMinute: 1 }];
  setGoodAsMade(goodsId);
  state.selectedGoodsId = goodsId;
}

function addTarget(goodsId) {
  setGoodAsMade(goodsId);
  state.selectedGoodsId = goodsId;
  state.products.push({ goodsId, amountPerMinute: 1 });
}

function makeGoodInPlan(goodsId) {
  setGoodAsMade(goodsId);
  state.selectedGoodsId = goodsId;
  renderBoundaryPresets();
  renderPlan();
  renderInspector();
}

function renderBoundaryPresets() {
  const repository = state.repository;
  const externalGoods = getEffectiveExternalGoods(repository);

  elements.boundaryPresetList.innerHTML = BOUNDARY_PRESETS.map((preset) => {
    const checked = state.activeBoundaryPresets.has(preset.id) ? " checked" : "";
    const count = countBoundaryPresetGoods(repository, preset);
    return `
      <label class="boundary-toggle">
        <input type="checkbox" data-action="toggle-boundary-preset" data-preset-id="${escapeHtml(preset.id)}"${checked}>
        <span>${escapeHtml(preset.label)}</span>
        <strong>${formatAmount(count)}</strong>
      </label>
    `;
  }).join("");

  elements.boundarySummary.textContent = `${formatAmount(externalGoods.size)} goods treated as external`;
}

function renderTargetPicker() {
  const repository = state.repository;
  const matches = repository.searchGoods(state.targetSearch, 120);

  elements.productSelect.innerHTML = matches
    .map((good) => {
      const kind = good.kind === "fluid" ? "fluid" : good.mod;
      return `<option value="${escapeHtml(good.id)}">${escapeHtml(`${good.name} · ${kind}`)}</option>`;
    })
    .join("");

  elements.addProduct.disabled = matches.length === 0;

  if (state.targetSearch.trim()) {
    elements.targetMatchSummary.textContent = matches.length
      ? `${formatAmount(matches.length)} matches shown`
      : "No matches";
  } else {
    elements.targetMatchSummary.textContent = `Showing ${formatAmount(matches.length)} of ${formatAmount(repository.goods.size)} goods`;
  }
}

function renderProductControls() {
  const repository = state.repository;
  renderTargetPicker();

  elements.productList.innerHTML = state.products
    .map((product, index) => {
      return `
        <div class="target-row">
          ${goodChip(repository, product.goodsId)}
          <label>
            <span>per minute</span>
            <input type="number" min="0" step="0.1" value="${product.amountPerMinute}" data-action="update-product" data-index="${index}">
          </label>
          <button class="icon-button" data-action="remove-product" data-index="${index}" aria-label="Remove target">x</button>
        </div>
      `;
    })
    .join("");
}

function renderPlan() {
  const repository = state.repository;
  const externalGoods = getEffectiveExternalGoods(repository);
  const plan = createPlan(repository, state.products, {
    preferredRecipeByOutput: state.preferredRecipeByOutput,
    externalGoods
  });

  elements.totalPower.textContent = `${formatAmount(plan.totalAverageEut)} EU/t average`;

  const assumptionCount = plan.warnings.length + plan.suppressedWarningCount;
  const assumptionHtml = assumptionCount
    ? `<details class="assumption-panel">
        <summary>
          <span>Planner assumptions</span>
          <strong>${formatAmount(assumptionCount)}</strong>
        </summary>
        <div class="warning-list">
          ${plan.warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}
          ${plan.suppressedWarningCount ? `<p>${escapeHtml(`${plan.suppressedWarningCount} more distinct assumptions hidden.`)}</p>` : ""}
        </div>
      </details>`
    : "";

  elements.status.innerHTML = `
    <div class="plan-overview">
      <div class="plan-metric">
        <strong>${formatAmount(plan.recipeRows.length)}</strong>
        <span>Tree recipes</span>
      </div>
      <div class="plan-metric">
        <strong>${formatAmount(plan.externalRows.length)}</strong>
        <span>External inputs</span>
      </div>
      <div class="plan-metric">
        <strong>${formatAmount(plan.byproductRows.length)}</strong>
        <span>Byproducts</span>
      </div>
      <div class="plan-metric">
        <strong>${formatAmount(assumptionCount)}</strong>
        <span>Assumptions</span>
      </div>
    </div>
    ${assumptionHtml}
  `;

  if (elements.recipePlan) {
    elements.recipePlan.innerHTML = plan.recipeRows.length
      ? plan.recipeRows.map((row) => recipeRow(repository, row, externalGoods)).join("")
      : `<div class="empty-state">Choose a product to build a plan.</div>`;
  }

  elements.craftingTree.innerHTML = plan.planTrees.length
    ? plan.planTrees.map((tree) => craftingTreeNode(repository, tree, 0, externalGoods)).join("")
    : `<div class="empty-state">Choose a product to build a tree.</div>`;

  elements.externalInputs.innerHTML = plan.externalRows.length
    ? externalInputGroups(repository, plan.externalRows, externalGoods)
    : `<div class="empty-state">No unresolved inputs.</div>`;

  elements.byproducts.innerHTML = plan.byproductRows.length
    ? plan.byproductRows.map((row) => goodChip(repository, row.goodsId, formatRate(row.amountPerMinute))).join("")
    : `<div class="empty-state">No byproducts in this chain.</div>`;
}

function renderTreeViewControls() {
  elements.treeViewControls?.querySelectorAll("[data-option]").forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    const option = input.dataset.option;
    input.checked = Boolean(option && state.treeView[option]);
  });
}

function craftingTreeNode(repository, node, depth, externalGoods) {
  const hasChildren = node.children.length > 0;
  const type = node.recipe ? repository.getRecipeType(node.recipe.type) : null;
  const recipeKindClass = node.recipe && isCraftingRecipe(node.recipe) ? " tree-crafting" : " tree-machine-node";
  const actions = treeActionButtons(repository, node);

  if (!hasChildren) {
    return `
      <div class="tree-node tree-leaf ${escapeHtml(node.reason ?? "external")}">
        <div class="tree-leaf-card">
          <div class="tree-node-header">
            ${goodChip(repository, node.goodsId, formatRate(node.amountPerMinute))}
            <span class="tree-badge">${escapeHtml(treeReasonLabel(node.reason))}</span>
            ${actions}
          </div>
        </div>
      </div>
    `;
  }

  return `
    <details class="tree-node tree-recipe${recipeKindClass}" style="--tree-depth:${depth}">
      <summary class="tree-card-summary">
        <span class="tree-card-body">
          ${node.recipe ? machineRequirementBanner(node.recipe, type) : ""}
          <span class="tree-node-header">
            ${goodChip(repository, node.goodsId, formatRate(node.amountPerMinute))}
            ${node.recipe?.durationTicks && !state.treeView.showRecipePreviews ? `<span class="tree-stat">${formatDuration(node.recipe.durationTicks)}</span>` : ""}
            ${node.recipe?.eut ? `<span class="tree-stat">${formatAverageEut(node.recipe, node.runsPerMinute)}</span>` : ""}
            ${actions}
          </span>
          ${state.treeView.showRecipeChoices && node.recipe ? treeRecipeChoiceControl(repository, node, externalGoods) : ""}
          ${state.treeView.showRecipePreviews ? recipeVisual(repository, node.recipe, { compactMachineStage: true }) : ""}
          ${treeCostStrip(repository, node)}
        </span>
        <span class="tree-run-rate">${formatRate(node.runsPerMinute)} runs</span>
      </summary>
      <div class="tree-children">
        ${node.children.map((child) => craftingTreeNode(repository, child, depth + 1, externalGoods)).join("")}
      </div>
    </details>
  `;
}

function machineRequirementBanner(recipe, type) {
  const crafting = isCraftingRecipe(recipe);
  const label = crafting ? "Crafting method" : "Machine required";
  const name = crafting
    ? (type?.name ?? "Recipe").replace(/^Crafting\s+/i, "")
    : type?.name ?? "Recipe";
  return `
    <span class="tree-machine-banner ${crafting ? "crafting" : "machine"}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(name)}</strong>
    </span>
  `;
}

function treeRecipeChoiceControl(repository, node, externalGoods) {
  const recipes = repository.findRecipesProducing(node.goodsId);
  const goodName = repository.getGoodName(node.goodsId);
  const isTarget = state.products.some((product) => product.goodsId === node.goodsId);
  const canTreatAsExternal = !isTarget;

  if (recipes.length <= 1 && !canTreatAsExternal) return "";

  const selectedRecipeId = canTreatAsExternal && externalGoods.has(node.goodsId)
    ? EXTERNAL_RECIPE_VALUE
    : state.preferredRecipeByOutput[node.goodsId] ?? node.recipe.id;
  const recipeOptions = recipes
    .map((candidate) => {
      const type = repository.getRecipeType(candidate.type);
      const label = `${type.name} · ${candidate.id}`;
      const selected = candidate.id === selectedRecipeId ? " selected" : "";
      return `<option value="${escapeHtml(candidate.id)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");
  const externalSelected = selectedRecipeId === EXTERNAL_RECIPE_VALUE ? " selected" : "";

  return `
    <label class="tree-recipe-choice">
      <span>
        <strong>Recipe</strong>
      </span>
      <select data-action="choose-recipe" data-output-id="${escapeHtml(node.goodsId)}" aria-label="Choose recipe for ${escapeHtml(goodName)}">
        ${canTreatAsExternal ? `<option value="${EXTERNAL_RECIPE_VALUE}"${externalSelected}>Treat as supplied</option>` : ""}
        ${recipeOptions}
      </select>
    </label>
  `;
}

function treeCostStrip(repository, node) {
  if (!node.children.length) return "";
  const visibleChildren = node.children.slice(0, 6);
  const hiddenCount = Math.max(0, node.children.length - visibleChildren.length);

  return `
    <span class="tree-cost-strip">
      <span class="tree-cost-label">Needs</span>
      ${visibleChildren.map((child) => goodChip(repository, child.goodsId, formatRate(child.amountPerMinute))).join("")}
      ${hiddenCount ? `<span class="tree-cost-more">+${formatAmount(hiddenCount)} more</span>` : ""}
    </span>
  `;
}

function treeActionButtons(repository, node) {
  const canMake = node.reason === "external" && repository.findRecipesProducing(node.goodsId).length > 0;
  return goodActionButtons(repository, node.goodsId, {
    canMake,
    className: "tree-actions",
    showInspect: state.treeView.showInspectButtons
  });
}

function goodActionButtons(repository, goodsId, options = {}) {
  const canMake = options.canMake ?? false;
  const canInspect = options.showInspect !== false && Boolean(repository.getGood(goodsId));
  const className = options.className ?? "good-actions";

  if (!canMake && !canInspect) return "";

  return `
    <span class="${className}">
      ${canMake ? `<button class="secondary-button" data-action="make-input" data-id="${escapeHtml(goodsId)}">Make</button>` : ""}
      ${canInspect ? `<button class="secondary-button" data-action="inspect-good" data-id="${escapeHtml(goodsId)}">Inspect</button>` : ""}
    </span>
  `;
}

function treeReasonLabel(reason) {
  switch (reason) {
    case "external":
      return "supplied";
    case "missing":
      return "no recipe";
    case "cycle":
      return "cycle";
    case "depth":
      return "depth limit";
    case "invalid":
      return "invalid recipe";
    case "unresolved":
      return "unresolved";
    default:
      return "leaf";
  }
}

function externalInputGroups(repository, rows, externalGoods) {
  const groupedRows = new Map(EXTERNAL_INPUT_GROUPS.map((group) => [group.id, []]));

  for (const row of rows) {
    groupedRows.get(getExternalInputGroupId(repository, row.goodsId)).push(row);
  }

  return EXTERNAL_INPUT_GROUPS
    .map((group) => {
      const groupRows = groupedRows.get(group.id);
      if (!groupRows.length) return "";

      return `
        <section class="external-group">
          <header>
            <h3>${escapeHtml(group.label)}</h3>
            <span>${formatAmount(groupRows.length)}</span>
          </header>
          <div class="stacked-list">
            ${groupRows.map((row) => externalInputRow(repository, row, externalGoods)).join("")}
          </div>
        </section>
      `;
    })
    .join("");
}

function getExternalInputGroupId(repository, goodsId) {
  const good = repository.getGood(goodsId);
  if (!good) return "unresolved";
  return getBoundaryPresetForGood(good)?.id ?? "other";
}

function externalInputRow(repository, row, externalGoods) {
  const canMake = externalGoods.has(row.goodsId) && repository.findRecipesProducing(row.goodsId).length > 0;
  const actions = goodActionButtons(repository, row.goodsId, { canMake });

  if (!actions) {
    return goodChip(repository, row.goodsId, formatRate(row.amountPerMinute));
  }

  return `
    <div class="external-input-row">
      ${goodChip(repository, row.goodsId, formatRate(row.amountPerMinute))}
      ${actions}
    </div>
  `;
}

function recipeRow(repository, row, externalGoods) {
  const { recipe, runsPerMinute } = row;
  const type = repository.getRecipeType(recipe.type);
  const outputs = recipe.outputs.map((output) => goodChip(repository, output.id, formatAmount(output.amount))).join("");
  const inputs = recipe.inputs.map((input) => ingredientChip(repository, input)).join("");
  const plannedOutputs = [...row.plannedOutputs.entries()].sort((a, b) => b[1] - a[1]);
  const recipeChoices = plannedOutputs
    .map(([goodsId, amountPerMinute]) => recipeChoiceControl(repository, goodsId, recipe.id, amountPerMinute, externalGoods))
    .join("");

  return `
    <article class="recipe-row">
      <div class="recipe-main">
        <div>
          <h3>${escapeHtml(type.name)}</h3>
          <p>${escapeHtml(recipe.id)}</p>
        </div>
        <div class="rate-pill">${formatRate(runsPerMinute)} runs</div>
      </div>
      ${recipeChoices ? `<div class="recipe-choice-list">${recipeChoices}</div>` : ""}
      <div class="io-grid">
        <div>
          <span class="section-label">Inputs</span>
          <div class="chip-flow">${inputs || "None"}</div>
        </div>
        <div>
          <span class="section-label">Outputs</span>
          <div class="chip-flow">${outputs || "None"}</div>
        </div>
      </div>
      <div class="recipe-meta">
        <span>${formatDuration(recipe.durationTicks)}</span>
        <span>${formatAmount(recipe.eut)} EU/t</span>
        <span>${formatAverageEut(recipe, runsPerMinute)}</span>
      </div>
    </article>
  `;
}

function recipeChoiceControl(repository, goodsId, currentRecipeId, amountPerMinute, externalGoods) {
  const recipes = repository.findRecipesProducing(goodsId);
  const goodName = repository.getGoodName(goodsId);
  const selectedRecipeId = externalGoods.has(goodsId)
    ? EXTERNAL_RECIPE_VALUE
    : state.preferredRecipeByOutput[goodsId] ?? currentRecipeId;

  const recipeOptions = recipes
    .map((candidate) => {
      const type = repository.getRecipeType(candidate.type);
      const label = `${type.name} · ${candidate.id}`;
      const selected = candidate.id === selectedRecipeId ? " selected" : "";
      return `<option value="${escapeHtml(candidate.id)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");
  const externalSelected = selectedRecipeId === EXTERNAL_RECIPE_VALUE ? " selected" : "";

  return `
    <label class="recipe-choice">
      <span>Recipe for ${goodChip(repository, goodsId, formatRate(amountPerMinute))}</span>
      <select data-action="choose-recipe" data-output-id="${escapeHtml(goodsId)}" aria-label="Choose recipe for ${escapeHtml(goodName)}">
        <option value="${EXTERNAL_RECIPE_VALUE}"${externalSelected}>Treat as external input</option>
        ${recipeOptions}
      </select>
    </label>
  `;
}

function renderInspector() {
  const repository = state.repository;
  const matches = repository.searchGoods(state.inspectSearch, 30);
  const selectedGood = state.selectedGoodsId ? repository.getGood(state.selectedGoodsId) : null;

  elements.inspectResults.innerHTML = matches.length
    ? matches.map((good) => inspectorResultRow(repository, good)).join("")
    : `<div class="empty-state">No matching goods.</div>`;

  if (state.inspectSearch.trim()) {
    elements.inspectMatchSummary.textContent = matches.length
      ? `${formatAmount(matches.length)} matches shown`
      : "No matches";
  } else {
    elements.inspectMatchSummary.textContent = `Showing ${formatAmount(matches.length)} suggested goods`;
  }

  elements.inspectorPanel.innerHTML = selectedGood
    ? selectedGoodPanel(repository, selectedGood)
    : `<div class="empty-state">Select an item or fluid to inspect it.</div>`;

  setInspectorOpen(state.inspectorOpen);
}

function setInspectorOpen(open) {
  state.inspectorOpen = open;
  elements.inspectorDrawer?.classList.toggle("open", open);
  elements.inspectorDrawer?.setAttribute("aria-hidden", open ? "false" : "true");
}

function inspectorResultRow(repository, good) {
  const selected = good.id === state.selectedGoodsId ? " selected" : "";
  const detail = `${good.id} · ${good.kind === "fluid" ? "fluid" : good.mod}`;
  return `
    <button class="browser-row inspector-row${selected}" data-action="inspect-good" data-id="${escapeHtml(good.id)}">
      ${goodChip(repository, good.id)}
      <span>${escapeHtml(detail)}</span>
    </button>
  `;
}

function selectedGoodPanel(repository, good) {
  const producedBy = repository.findRecipesProducing(good.id);
  const usedIn = repository.findRecipesUsing(good.id);
  const effectiveExternalGoods = getEffectiveExternalGoods(repository);
  const isExternal = effectiveExternalGoods.has(good.id);
  const boundary = getBoundaryPresetForGood(good);
  const preferredRecipeId = state.preferredRecipeByOutput[good.id];

  return `
    <section class="inspector-card selected-good-card">
      <div class="inspector-good-header">
        ${goodChip(repository, good.id)}
        <span class="inspector-id">${escapeHtml(good.id)}</span>
      </div>
      <div class="inspector-meta">
        <span>${escapeHtml(good.kind)}</span>
        <span>${escapeHtml(good.mod)}</span>
        <span>${formatAmount(producedBy.length)} producing recipes</span>
        <span>${formatAmount(usedIn.length)} using recipes</span>
        ${boundary ? `<span>${escapeHtml(boundary.label)}</span>` : ""}
        ${isExternal ? `<span>treated as external</span>` : `<span>planner may craft</span>`}
      </div>
      <div class="inspector-actions">
        <button class="primary-button" data-action="inspector-set-target" data-id="${escapeHtml(good.id)}">Set as target</button>
        <button class="secondary-button" data-action="inspector-add-target" data-id="${escapeHtml(good.id)}">Add target</button>
        <button class="secondary-button" data-action="inspector-make-good" data-id="${escapeHtml(good.id)}">Make in plan</button>
        <button class="secondary-button" data-action="inspector-treat-external" data-id="${escapeHtml(good.id)}">Treat external</button>
      </div>
    </section>

    <section class="inspector-section">
      <h2>Produced by</h2>
      ${producedBy.length
        ? producedBy.slice(0, 8).map((recipe) => inspectorRecipeCard(repository, recipe, good.id, "produced", preferredRecipeId)).join("")
        : `<div class="empty-state">No producing recipe. This is a raw or supplied input.</div>`}
      ${producedBy.length > 8 ? `<p class="match-summary">Showing 8 of ${formatAmount(producedBy.length)} producing recipes.</p>` : ""}
    </section>

    <section class="inspector-section">
      <h2>Used in</h2>
      ${usedIn.length
        ? usedIn.slice(0, 8).map((recipe) => inspectorRecipeCard(repository, recipe, good.id, "used", null)).join("")
        : `<div class="empty-state">No exported recipes use this good.</div>`}
      ${usedIn.length > 8 ? `<p class="match-summary">Showing 8 of ${formatAmount(usedIn.length)} using recipes.</p>` : ""}
    </section>
  `;
}

function inspectorRecipeCard(repository, recipe, inspectedGoodsId, mode, preferredRecipeId) {
  const type = repository.getRecipeType(recipe.type);
  const outputs = recipe.outputs.map((output) => goodChip(repository, output.id, formatAmount(output.amount))).join("");
  const inputs = recipe.inputs.map((input) => ingredientChip(repository, input)).join("");
  const isPreferred = recipe.id === preferredRecipeId;
  const firstOutput = recipe.outputs.find((output) => repository.getGood(output.id));
  const activeClass = isPreferred ? " active" : "";

  return `
    <article class="inspector-recipe-card${activeClass}">
      <header>
        <div>
          <strong>${escapeHtml(type.name)}</strong>
          <p>${escapeHtml(recipe.id)}</p>
        </div>
        ${isPreferred ? `<span class="preferred-pill">preferred</span>` : ""}
      </header>
      <div class="recipe-meta compact-meta">
        <span>${formatDuration(recipe.durationTicks)}</span>
        <span>${formatAmount(recipe.eut)} EU/t</span>
      </div>
      <div class="inspector-io">
        <span class="section-label">Inputs</span>
        <div class="chip-flow">${inputs || "None"}</div>
        <span class="section-label">Outputs</span>
        <div class="chip-flow">${outputs || "None"}</div>
      </div>
      <div class="inspector-recipe-actions">
        ${mode === "produced"
          ? `<button class="secondary-button" data-action="inspector-prefer-recipe" data-output-id="${escapeHtml(inspectedGoodsId)}" data-recipe-id="${escapeHtml(recipe.id)}">Prefer recipe</button>`
          : ""}
        ${firstOutput
          ? `<button class="secondary-button" data-action="inspect-good" data-id="${escapeHtml(firstOutput.id)}">Inspect output</button>`
          : ""}
      </div>
    </article>
  `;
}

function renderAll() {
  renderProductControls();
  renderBoundaryPresets();
  renderTreeViewControls();
  renderPlan();
  renderInspector();
}

function dataUrlFromLocation() {
  const params = new URLSearchParams(window.location.search);
  return params.get("data") || DEFAULT_DATA_URL;
}

function textureAtlasUrlFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("textures");
  if (value === "none") return null;
  return value || DEFAULT_TEXTURE_ATLAS_URL;
}

async function loadTextureAtlas(url) {
  if (!url) return null;

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    const atlas = await response.json();
    if (atlas.schema !== "gtceu-planner-texture-atlas-v1") {
      console.warn(`Ignoring unsupported texture atlas schema: ${atlas.schema}`);
      return null;
    }
    return atlas;
  } catch (error) {
    console.warn(`Could not load texture atlas ${url}.`, error);
    return null;
  }
}

function chooseInitialProducts(repository) {
  if (repository.getGood("gtceu:greenhouse")) {
    return [{ goodsId: "gtceu:greenhouse", amountPerMinute: 1 }];
  }

  const firstProducedItem = repository.recipes
    .flatMap((recipe) => recipe.outputs)
    .find((output) => repository.getGood(output.id)?.kind === "item");

  if (firstProducedItem) {
    return [{ goodsId: firstProducedItem.id, amountPerMinute: 1 }];
  }

  const firstItem = [...repository.goods.values()].find((good) => good.kind === "item");
  return firstItem ? [{ goodsId: firstItem.id, amountPerMinute: 1 }] : [];
}

let activeTooltipTarget = null;
let tooltipElement = null;

function setupMinecraftTooltips() {
  const showFromEvent = (event) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest("[data-mc-tooltip]");
    if (!(target instanceof HTMLElement)) return;
    showMinecraftTooltip(target, event);
  };

  const moveFromEvent = (event) => {
    if (!activeTooltipTarget || !tooltipElement) return;
    positionMinecraftTooltip(event.clientX, event.clientY);
  };

  const hideFromEvent = (event) => {
    if (!activeTooltipTarget) return;
    if (event.relatedTarget instanceof Node && activeTooltipTarget.contains(event.relatedTarget)) return;
    hideMinecraftTooltip();
  };

  document.addEventListener("pointerover", showFromEvent);
  document.addEventListener("pointermove", moveFromEvent);
  document.addEventListener("pointerout", hideFromEvent);
  document.addEventListener("mouseover", showFromEvent);
  document.addEventListener("mousemove", moveFromEvent);
  document.addEventListener("mouseout", hideFromEvent);

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest("[data-mc-tooltip]");
    if (!(target instanceof HTMLElement)) {
      hideMinecraftTooltip();
      return;
    }

    showMinecraftTooltip(target, event);
  });

  document.addEventListener("focusin", (event) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest("[data-mc-tooltip]");
    if (!(target instanceof HTMLElement)) return;
    const rect = target.getBoundingClientRect();
    showMinecraftTooltip(target, { clientX: rect.right, clientY: rect.top });
  });

  document.addEventListener("focusout", () => hideMinecraftTooltip());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideMinecraftTooltip();
      setInspectorOpen(false);
    }
  });
}

function showMinecraftTooltip(target, pointer) {
  const tooltip = getMinecraftTooltipElement();
  activeTooltipTarget = target;
  tooltip.replaceChildren(...minecraftTooltipLines(target));
  tooltip.classList.add("visible");
  positionMinecraftTooltip(pointer.clientX, pointer.clientY);
}

function hideMinecraftTooltip() {
  activeTooltipTarget = null;
  tooltipElement?.classList.remove("visible");
}

function getMinecraftTooltipElement() {
  if (tooltipElement) return tooltipElement;
  tooltipElement = document.createElement("div");
  tooltipElement.className = "minecraft-tooltip";
  tooltipElement.setAttribute("role", "tooltip");
  document.body.append(tooltipElement);
  return tooltipElement;
}

function minecraftTooltipLines(target) {
  const lines = [];
  const title = document.createElement("div");
  title.className = "minecraft-tooltip-name";
  title.textContent = target.dataset.tooltipName ?? "Unknown item";
  lines.push(title);

  if (target.dataset.tooltipAmount) {
    const amount = document.createElement("div");
    amount.className = "minecraft-tooltip-amount";
    amount.textContent = target.dataset.tooltipAmount;
    lines.push(amount);
  }

  if (target.dataset.tooltipDetail) {
    const detail = document.createElement("div");
    detail.className = "minecraft-tooltip-detail";
    detail.textContent = target.dataset.tooltipDetail;
    lines.push(detail);
  }

  const meta = [target.dataset.tooltipMod, target.dataset.tooltipKind].filter(Boolean).join(" / ");
  if (meta) {
    const metaLine = document.createElement("div");
    metaLine.className = "minecraft-tooltip-meta";
    metaLine.textContent = meta;
    lines.push(metaLine);
  }

  if (target.dataset.tooltipId) {
    const id = document.createElement("div");
    id.className = "minecraft-tooltip-id";
    id.textContent = target.dataset.tooltipId;
    lines.push(id);
  }

  return lines;
}

function positionMinecraftTooltip(clientX, clientY) {
  const tooltip = getMinecraftTooltipElement();
  const offset = 14;
  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;
  let left = clientX + offset;
  let top = clientY + offset;

  if (left + width + 8 > window.innerWidth) {
    left = clientX - width - offset;
  }

  if (top + height + 8 > window.innerHeight) {
    top = clientY - height - offset;
  }

  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
}

function setupEvents() {
  setupMinecraftTooltips();

  elements.addProduct.addEventListener("click", () => {
    const goodsId = elements.productSelect.value;
    addTarget(goodsId);
    renderAll();
  });

  elements.productList.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.action !== "update-product") return;
    const index = Number(target.dataset.index);
    state.products[index].amountPerMinute = Number(target.value);
    renderPlan();
  });

  elements.productList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.dataset.action !== "remove-product") return;
    const index = Number(target.dataset.index);
    state.products.splice(index, 1);
    renderAll();
  });

  elements.treeViewControls?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.action !== "toggle-tree-option") return;
    const option = target.dataset.option;
    if (!option || !(option in state.treeView)) return;

    state.treeView[option] = target.checked;
    renderTreeViewControls();
    renderPlan();
  });

  elements.treeViewControls?.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest("[data-action]");
    if (!(target instanceof HTMLButtonElement)) return;

    if (target.dataset.action === "collapse-tree") {
      setTreeExpansion(false);
    }

    if (target.dataset.action === "expand-tree") {
      setTreeExpansion(true);
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || target.dataset.action !== "choose-recipe") return;
    const outputId = target.dataset.outputId;
    if (!outputId) return;

    if (target.value === EXTERNAL_RECIPE_VALUE) {
      setGoodAsExternal(outputId);
    } else {
      setGoodAsMade(outputId);
      state.preferredRecipeByOutput[outputId] = target.value;
    }
    renderBoundaryPresets();
    renderPlan();
    renderInspector();
  });

  elements.boundaryPresetList.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.action !== "toggle-boundary-preset") return;
    const presetId = target.dataset.presetId;
    if (!presetId) return;

    if (target.checked) {
      state.activeBoundaryPresets.add(presetId);
    } else {
      state.activeBoundaryPresets.delete(presetId);
    }
    renderBoundaryPresets();
    renderPlan();
    renderInspector();
  });

  elements.targetSearchInput.addEventListener("input", () => {
    state.targetSearch = elements.targetSearchInput.value;
    renderTargetPicker();
  });

  elements.inspectSearchInput.addEventListener("input", () => {
    state.inspectSearch = elements.inspectSearchInput.value;
    const matches = state.repository.searchGoods(state.inspectSearch, 30);
    if (matches.length && (!state.selectedGoodsId || state.inspectSearch.trim())) {
      state.selectedGoodsId = matches[0].id;
    }
    renderInspector();
  });

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!(target instanceof HTMLElement)) return;

    const action = target.dataset.action;
    const goodsId = target.dataset.id;

    if (action === "inspect-good" && goodsId) {
      event.preventDefault();
      state.selectedGoodsId = goodsId;
      state.inspectorOpen = true;
      renderInspector();
      return;
    }

    if (action === "close-inspector") {
      event.preventDefault();
      setInspectorOpen(false);
      return;
    }

    if (action === "make-input" && goodsId) {
      event.preventDefault();
      makeGoodInPlan(goodsId);
      return;
    }

    if (action === "inspector-set-target" && goodsId) {
      event.preventDefault();
      setSingleTarget(goodsId);
      state.targetSearch = "";
      elements.targetSearchInput.value = "";
      state.inspectorOpen = false;
      renderAll();
      return;
    }

    if (action === "inspector-add-target" && goodsId) {
      event.preventDefault();
      addTarget(goodsId);
      state.inspectorOpen = false;
      renderAll();
      return;
    }

    if (action === "inspector-make-good" && goodsId) {
      event.preventDefault();
      state.inspectorOpen = false;
      makeGoodInPlan(goodsId);
      return;
    }

    if (action === "inspector-treat-external" && goodsId) {
      event.preventDefault();
      setGoodAsExternal(goodsId);
      renderBoundaryPresets();
      renderPlan();
      state.inspectorOpen = false;
      renderInspector();
      return;
    }

    if (action === "inspector-prefer-recipe") {
      const outputId = target.dataset.outputId;
      const recipeId = target.dataset.recipeId;
      if (!outputId || !recipeId) return;
      event.preventDefault();
      setGoodAsMade(outputId);
      state.preferredRecipeByOutput[outputId] = recipeId;
      state.selectedGoodsId = outputId;
      renderBoundaryPresets();
      renderPlan();
      renderInspector();
    }
  });
}

function setTreeExpansion(open) {
  elements.craftingTree
    .querySelectorAll("details.tree-recipe")
    .forEach((node) => {
      node.open = open;
    });
}

async function main() {
  try {
    state.dataUrl = dataUrlFromLocation();
    state.repository = await loadRepository(state.dataUrl);
    state.textureAtlas = await loadTextureAtlas(textureAtlasUrlFromLocation());
    state.products = chooseInitialProducts(state.repository);
    state.selectedGoodsId = state.products[0]?.goodsId ?? null;
    const meta = state.repository.metadata;
    const packCounts = `${formatAmount(state.repository.goods.size)} goods / ${formatAmount(state.repository.recipes.length)} recipes`;
    elements.packName.textContent = meta.packName;
    elements.packMeta.textContent = `${meta.packVersion} / Minecraft ${meta.minecraftVersion} / ${meta.loader} / ${packCounts} / ${state.dataUrl}`;
    setupEvents();
    renderAll();
  } catch (error) {
    elements.status.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
    console.error(error);
  }
}

main();
