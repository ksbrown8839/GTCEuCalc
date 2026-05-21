import { formatAmount, formatAverageEut, formatDuration, formatRate, escapeHtml } from "./format.js";
import { loadRepository } from "./repository.js";
import { createPlan } from "./planner.js";
import { BOUNDARY_PRESETS, countBoundaryPresetGoods, getBoundaryPresetGoods } from "./boundaries.js";

const DEFAULT_DATA_URL = "data/gtceu-modern-pack-1.14.5.json";

const state = {
  repository: null,
  products: [{ goodsId: "gtceu:greenhouse", amountPerMinute: 1 }],
  preferredRecipeByOutput: {},
  manualExternalGoods: new Set(),
  manualMadeGoods: new Set(),
  activeBoundaryPresets: new Set(["fluids", "base-materials", "stock-parts", "circuits"]),
  search: "",
  dataUrl: DEFAULT_DATA_URL
};

const EXTERNAL_RECIPE_VALUE = "__external__";

const elements = {
  status: document.querySelector("[data-role='status']"),
  productList: document.querySelector("[data-role='product-list']"),
  productSelect: document.querySelector("[data-role='product-select']"),
  addProduct: document.querySelector("[data-action='add-product']"),
  recipePlan: document.querySelector("[data-role='recipe-plan']"),
  externalInputs: document.querySelector("[data-role='external-inputs']"),
  byproducts: document.querySelector("[data-role='byproducts']"),
  boundaryPresetList: document.querySelector("[data-role='boundary-preset-list']"),
  boundarySummary: document.querySelector("[data-role='boundary-summary']"),
  recipeBrowser: document.querySelector("[data-role='recipe-browser']"),
  goodsBrowser: document.querySelector("[data-role='goods-browser']"),
  searchInput: document.querySelector("[data-role='search']"),
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

function renderProductControls() {
  const repository = state.repository;
  elements.productSelect.innerHTML = repository
    .searchGoods("")
    .filter((good) => good.kind === "item")
    .map((good) => `<option value="${escapeHtml(good.id)}">${escapeHtml(good.name)}</option>`)
    .join("");

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

  const warningHtml = plan.warnings.length
    ? `<div class="warning-list">
        ${plan.warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}
        ${plan.suppressedWarningCount ? `<p>${escapeHtml(`${plan.suppressedWarningCount} more distinct warnings hidden.`)}</p>` : ""}
      </div>`
    : "";

  elements.status.innerHTML = `
    <strong>${plan.recipeRows.length}</strong> recipe steps,
    <strong>${plan.externalRows.length}</strong> external inputs.
    ${warningHtml}
  `;

  elements.recipePlan.innerHTML = plan.recipeRows.length
    ? plan.recipeRows.map((row) => recipeRow(repository, row, externalGoods)).join("")
    : `<div class="empty-state">Choose a product to build a plan.</div>`;

  elements.externalInputs.innerHTML = plan.externalRows.length
    ? plan.externalRows.map((row) => externalInputRow(repository, row, externalGoods)).join("")
    : `<div class="empty-state">No unresolved inputs.</div>`;

  elements.byproducts.innerHTML = plan.byproductRows.length
    ? plan.byproductRows.map((row) => goodChip(repository, row.goodsId, formatRate(row.amountPerMinute))).join("")
    : `<div class="empty-state">No byproducts in this chain.</div>`;
}

function externalInputRow(repository, row, externalGoods) {
  const canMake = externalGoods.has(row.goodsId) && repository.findRecipesProducing(row.goodsId).length > 0;

  if (!canMake) {
    return goodChip(repository, row.goodsId, formatRate(row.amountPerMinute));
  }

  return `
    <div class="external-input-row">
      ${goodChip(repository, row.goodsId, formatRate(row.amountPerMinute))}
      <button class="secondary-button" data-action="make-input" data-id="${escapeHtml(row.goodsId)}">Make</button>
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

function renderBrowser() {
  const repository = state.repository;
  const query = state.search;

  elements.goodsBrowser.innerHTML = repository
    .searchGoods(query)
    .map((good) => `
      <button class="browser-row" data-action="set-target" data-id="${escapeHtml(good.id)}">
        ${goodChip(repository, good.id)}
        <span>${escapeHtml(good.id)}</span>
      </button>
    `)
    .join("");

  elements.recipeBrowser.innerHTML = repository
    .searchRecipes(query)
    .map((recipe) => {
      const type = repository.getRecipeType(recipe.type);
      const outputs = recipe.outputs.map((output) => repository.getGoodName(output.id)).join(", ");
      return `
        <div class="browser-row static">
          <span class="recipe-type-dot"></span>
          <strong>${escapeHtml(type.name)}</strong>
          <span>${escapeHtml(outputs)}</span>
        </div>
      `;
    })
    .join("");
}

function renderAll() {
  renderProductControls();
  renderBoundaryPresets();
  renderPlan();
  renderBrowser();
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
    state.manualExternalGoods.delete(goodsId);
    state.manualMadeGoods.add(goodsId);
    state.products.push({
      goodsId,
      amountPerMinute: 1
    });
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
      state.manualExternalGoods.add(outputId);
      state.manualMadeGoods.delete(outputId);
      delete state.preferredRecipeByOutput[outputId];
    } else {
      state.manualExternalGoods.delete(outputId);
      state.manualMadeGoods.add(outputId);
      state.preferredRecipeByOutput[outputId] = target.value;
    }
    renderBoundaryPresets();
    renderPlan();
  });

  elements.externalInputs.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action='make-input']");
    if (!(target instanceof HTMLElement)) return;
    const goodsId = target.dataset.id;
    if (!goodsId) return;
    state.manualExternalGoods.delete(goodsId);
    state.manualMadeGoods.add(goodsId);
    renderBoundaryPresets();
    renderPlan();
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
  });

  elements.searchInput.addEventListener("input", () => {
    state.search = elements.searchInput.value;
    renderBrowser();
  });

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action='set-target']");
    if (!(target instanceof HTMLElement)) return;
    const goodsId = target.dataset.id;
    if (!goodsId) return;
    state.products = [{ goodsId, amountPerMinute: 1 }];
    state.manualExternalGoods.delete(goodsId);
    state.manualMadeGoods.add(goodsId);
    renderAll();
  });
}

async function main() {
  try {
    state.dataUrl = dataUrlFromLocation();
    state.repository = await loadRepository(state.dataUrl);
    state.products = chooseInitialProducts(state.repository);
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
