import { formatAmount, formatAverageEut, formatDuration, formatRate, escapeHtml } from "./format.js?v=inspector-2026-05-21";
import { loadRepository } from "./repository.js?v=inspector-2026-05-21";
import { createPlan } from "./planner.js?v=inspector-2026-05-21";
import { BOUNDARY_PRESETS, countBoundaryPresetGoods, getBoundaryPresetForGood, getBoundaryPresetGoods } from "./boundaries.js?v=inspector-2026-05-21";

const DEFAULT_DATA_URL = "data/gtceu-modern-pack-1.14.5.json";

const state = {
  repository: null,
  products: [{ goodsId: "gtceu:greenhouse", amountPerMinute: 1 }],
  preferredRecipeByOutput: {},
  manualExternalGoods: new Set(),
  manualMadeGoods: new Set(),
  activeBoundaryPresets: new Set(["fluids", "base-materials", "stock-parts", "circuits"]),
  targetSearch: "",
  inspectSearch: "",
  selectedGoodsId: null,
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
  recipePlan: document.querySelector("[data-role='recipe-plan']"),
  externalInputs: document.querySelector("[data-role='external-inputs']"),
  byproducts: document.querySelector("[data-role='byproducts']"),
  boundaryPresetList: document.querySelector("[data-role='boundary-preset-list']"),
  boundarySummary: document.querySelector("[data-role='boundary-summary']"),
  inspectSearchInput: document.querySelector("[data-role='inspect-search']"),
  inspectMatchSummary: document.querySelector("[data-role='inspect-match-summary']"),
  inspectResults: document.querySelector("[data-role='inspect-results']"),
  inspectorPanel: document.querySelector("[data-role='inspector-panel']"),
  packName: document.querySelector("[data-role='pack-name']"),
  packMeta: document.querySelector("[data-role='pack-meta']"),
  totalPower: document.querySelector("[data-role='total-power']")
};

function goodChip(repository, id, amountText = "") {
  const good = repository.getGood(id);
  const color = good?.color ?? "#7d8790";
  const name = good?.name ?? id;
  const kind = good?.kind ?? "item";
  return `
    <span class="good-chip" title="${escapeHtml(id)}">
      <span class="good-swatch ${kind}" style="--swatch:${escapeHtml(color)}"></span>
      <span>${escapeHtml(name)}</span>
      ${amountText ? `<strong>${escapeHtml(amountText)}</strong>` : ""}
    </span>
  `;
}

function ingredientChip(repository, ingredient) {
  const color = repository.getIngredientColor(ingredient);
  const name = repository.getIngredientName(ingredient);
  const prefix = ingredient.kind === "tag" ? "#" : "";
  return `
    <span class="good-chip muted" title="${escapeHtml(prefix + ingredient.id)}">
      <span class="good-swatch ${ingredient.kind}" style="--swatch:${escapeHtml(color)}"></span>
      <span>${escapeHtml(name)}</span>
      <strong>${formatAmount(ingredient.amount)}</strong>
    </span>
  `;
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
        <span>Recipe steps</span>
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

  elements.recipePlan.innerHTML = plan.recipeRows.length
    ? plan.recipeRows.map((row) => recipeRow(repository, row, externalGoods)).join("")
    : `<div class="empty-state">Choose a product to build a plan.</div>`;

  elements.craftingTree.innerHTML = plan.planTrees.length
    ? plan.planTrees.map((tree) => craftingTreeNode(repository, tree, 0)).join("")
    : `<div class="empty-state">Choose a product to build a tree.</div>`;

  elements.externalInputs.innerHTML = plan.externalRows.length
    ? externalInputGroups(repository, plan.externalRows, externalGoods)
    : `<div class="empty-state">No unresolved inputs.</div>`;

  elements.byproducts.innerHTML = plan.byproductRows.length
    ? plan.byproductRows.map((row) => goodChip(repository, row.goodsId, formatRate(row.amountPerMinute))).join("")
    : `<div class="empty-state">No byproducts in this chain.</div>`;
}

function craftingTreeNode(repository, node, depth) {
  const hasChildren = node.children.length > 0;
  const type = node.recipe ? repository.getRecipeType(node.recipe.type) : null;
  const open = depth < 2 ? " open" : "";
  const actions = treeActionButtons(repository, node);

  if (!hasChildren) {
    return `
      <div class="tree-node tree-leaf ${escapeHtml(node.reason ?? "external")}">
        <div class="tree-summary">
          ${goodChip(repository, node.goodsId, formatRate(node.amountPerMinute))}
          <span class="tree-badge">${escapeHtml(treeReasonLabel(node.reason))}</span>
          ${actions}
        </div>
      </div>
    `;
  }

  return `
    <details class="tree-node tree-recipe" style="--tree-depth:${depth}"${open}>
      <summary>
        <span class="tree-summary">
          ${goodChip(repository, node.goodsId, formatRate(node.amountPerMinute))}
          <span class="tree-machine">${escapeHtml(type?.name ?? "Recipe")}</span>
          ${actions}
        </span>
        <span class="tree-run-rate">${formatRate(node.runsPerMinute)} runs</span>
      </summary>
      <div class="tree-children">
        ${node.children.map((child) => craftingTreeNode(repository, child, depth + 1)).join("")}
      </div>
    </details>
  `;
}

function treeActionButtons(repository, node) {
  const canMake = node.reason === "external" && repository.findRecipesProducing(node.goodsId).length > 0;
  return goodActionButtons(repository, node.goodsId, { canMake, className: "tree-actions" });
}

function goodActionButtons(repository, goodsId, options = {}) {
  const canMake = options.canMake ?? false;
  const canInspect = Boolean(repository.getGood(goodsId));
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
  renderPlan();
  renderInspector();
}

function dataUrlFromLocation() {
  const params = new URLSearchParams(window.location.search);
  return params.get("data") || DEFAULT_DATA_URL;
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

function setupEvents() {
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

  elements.recipePlan.addEventListener("change", (event) => {
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
      renderInspector();
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
      renderAll();
      return;
    }

    if (action === "inspector-add-target" && goodsId) {
      event.preventDefault();
      addTarget(goodsId);
      renderAll();
      return;
    }

    if (action === "inspector-make-good" && goodsId) {
      event.preventDefault();
      makeGoodInPlan(goodsId);
      return;
    }

    if (action === "inspector-treat-external" && goodsId) {
      event.preventDefault();
      setGoodAsExternal(goodsId);
      renderBoundaryPresets();
      renderPlan();
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

async function main() {
  try {
    state.dataUrl = dataUrlFromLocation();
    state.repository = await loadRepository(state.dataUrl);
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
