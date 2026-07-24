import { formatAmount, formatAverageEut, formatDuration, formatRate, escapeHtml } from "./format.js?v=machine-build-counts-2026-05-31";
import { loadRepository } from "./repository.js?v=tool-tag-icons-2026-07-23";
import { createPlan } from "./planner.js?v=discrete-tree-tools-2026-07-23";
import { BOUNDARY_PRESETS, countBoundaryPresetGoods, getBoundaryPresetForGood, getBoundaryPresetGoods } from "./boundaries.js?v=inspector-2026-05-21";

const DEFAULT_DATA_URL = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_TEXTURE_ATLAS_URL = "data/texture-atlas.json";
const DEFAULT_MULTIBLOCK_STRUCTURES_URL = "data/multiblock-structures.json";

const state = {
  repository: null,
  textureAtlas: null,
  products: [{ goodsId: "gtceu:greenhouse", amountPerMinute: 1 }],
  preferredRecipeByOutput: {},
  manualExternalGoods: new Set(),
  manualMadeGoods: new Set(),
  activeBoundaryPresets: new Set(["fluids", "base-materials", "stock-parts", "circuits"]),
  targetSearch: "",
  targetFilter: "all",
  inspectSearch: "",
  selectedGoodsId: null,
  selectedTreeGoodsId: null,
  selectedTreeNodeKey: null,
  inspectorOpen: false,
  currentPlan: null,
  treeView: {
    showGraph: true,
    showRecipeChoices: false,
    showRecipePreviews: true,
    showInspectButtons: false,
    showRates: false
  },
  recipeGraph: {
    zoom: 1
  },
  treeContextMenu: null,
  completedTreeGoods: new Set(),
  expandedTreeGoods: new Set(),
  structureTreeGoods: new Set(),
  multiblockStructures: new Map(),
  dataUrl: DEFAULT_DATA_URL
};

const EXTERNAL_RECIPE_VALUE = "__external__";
const STRUCTURE_RECIPE_VALUE = "__structure__";

const VIRTUAL_TOOL_ICON_BY_ID = {
  "gtceu:tools/crafting_hammers": "gtceu:bronze_hammer",
  "gtceu:tools/crafting_files": "gtceu:bronze_file",
  "gtceu:tools/crafting_wrenches": "gtceu:bronze_wrench",
  "gtceu:tools/crafting_screwdrivers": "gtceu:bronze_screwdriver",
  "gtceu:tools/crafting_mallets": "gtceu:wood_mallet",
  "gtceu:tools/crafting_saws": "gtceu:bronze_saw",
  "gtceu:tools/crafting_wire_cutters": "gtceu:bronze_wire_cutter",
  "gtceu:tools/crafting_knives": "gtceu:bronze_knife",
  "gtceu:tools/crafting_crowbars": "gtceu:bronze_crowbar",
  "gtceu:tools/crafting_mortars": "gtceu:bronze_mortar"
};

const EXTERNAL_INPUT_GROUPS = [
  { id: "fluids", label: "Fluids" },
  { id: "circuits", label: "Circuits" },
  { id: "stock-parts", label: "Stock parts" },
  { id: "base-materials", label: "Base materials" },
  { id: "tools", label: "Reusable tools" },
  { id: "other", label: "Other inputs" },
  { id: "unresolved", label: "Unresolved" }
];

const TARGET_BROWSER_LIMIT = 180;

const elements = {
  status: document.querySelector("[data-role='status']"),
  productList: document.querySelector("[data-role='product-list']"),
  targetBrowserPanel: document.querySelector("[data-role='target-browser-panel']"),
  targetBrowserSelected: document.querySelector("[data-role='target-browser-selected']"),
  targetFilterButtons: document.querySelectorAll("[data-action='target-filter']"),
  targetSearchInput: document.querySelector("[data-role='target-search']"),
  targetMatchSummary: document.querySelector("[data-role='target-match-summary']"),
  targetResults: document.querySelector("[data-role='target-results']"),
  targetSearchClear: document.querySelector("[data-action='clear-target-search']"),
  craftingTree: document.querySelector("[data-role='crafting-tree']"),
  treeViewControls: document.querySelector("[data-role='tree-view-controls']"),
  recipeTracker: document.querySelector("[data-role='recipe-tracker']"),
  treeGoodPicker: document.querySelector("[data-role='tree-good-picker']"),
  treeContextMenu: document.querySelector("[data-role='tree-context-menu']"),
  recipePlan: document.querySelector("[data-role='recipe-plan']"),
  machinePlan: document.querySelector("[data-role='machine-plan']"),
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
  const iconId = atlas?.icons?.[atlasIconGoodsId(goodsId)];
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

function atlasIconGoodsId(goodsId) {
  return VIRTUAL_TOOL_ICON_BY_ID[goodsId] ?? goodsId;
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

function displayGoodTooltipAttrs(repository, id, amountText = "", detail = "") {
  const good = repository.getGood(id);
  return tooltipAttrs({
    name: repository.getGoodName(id),
    id: good?.id ?? id,
    amountText,
    kind: good?.kind ?? (isVirtualToolGood(id) ? "tool" : ""),
    mod: good?.mod ?? "",
    detail
  });
}

function goodChip(repository, id, amountText = "") {
  const good = repository.getGood(id);
  const name = repository.getGoodName(id);
  return `
    <span class="good-chip" ${displayGoodTooltipAttrs(repository, id, amountText)}>
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
  const name = repository.getGoodName(id);
  const kind = good?.kind ?? "item";
  const className = options.className ? ` ${options.className}` : "";
  const virtualTool = isVirtualToolGood(id);
  const content = `
    ${slotIconMarkup({ goodsId: id, kind, color, label: name, fallback: id })}
    <span class="slot-name">${escapeHtml(name)}</span>
    ${amountText ? `<strong class="slot-amount">${escapeHtml(amountText)}</strong>` : ""}
  `;

  if (!good || virtualTool) {
    const detail = virtualTool ? "Reusable crafting tool tag" : "Unresolved good";
    const unresolvedClass = virtualTool ? "" : " unresolved";
    return `<span class="recipe-slot${unresolvedClass}${className}" ${displayGoodTooltipAttrs(repository, id, amountText, detail)}>${content}</span>`;
  }

  return `
    <button class="recipe-slot ${kind}${className}" type="button" ${goodTooltipAttrs(good, id, amountText)} aria-label="Inspect ${escapeHtml(name)}" data-action="inspect-good" data-id="${escapeHtml(id)}">
      ${content}
    </button>
  `;
}

function graphGoodIcon(repository, id, amountText = "") {
  const good = repository.getGood(id);
  const color = good?.color ?? "#7d8790";
  const name = repository.getGoodName(id);
  const kind = good?.kind ?? "item";
  return `
    <span class="emi-good-icon ${kind}" ${displayGoodTooltipAttrs(repository, id, amountText)}>
      ${slotIconMarkup({ goodsId: id, kind, color, label: name, fallback: id })}
      ${amountText ? `<strong class="slot-amount">${escapeHtml(amountText)}</strong>` : ""}
    </span>
  `;
}

function isVirtualToolGood(id) {
  return Boolean(VIRTUAL_TOOL_ICON_BY_ID[id]);
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
  const isStructure = isStructureRecipe(recipe);
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
    <span class="recipe-visual machine-visual${isStructure ? " structure-visual" : ""}" aria-label="${escapeHtml(type.name)} recipe preview">
      <span class="machine-inputs">
        ${visibleInputs.map((input) => ingredientSlot(repository, input)).join("")}
        ${hiddenInputCount ? overflowSlot(hiddenInputCount) : ""}
      </span>
      <span class="machine-stage${options.compactMachineStage ? " compact" : ""}">
        ${isStructure
          ? `<em>Structure</em> <span>${escapeHtml(recipe.structure?.name ?? type.name)}</span>`
          : options.compactMachineStage
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

function isStructureRecipe(recipe) {
  return recipe?.type === "gtceu:multiblock_structure";
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
  state.expandedTreeGoods.delete(goodsId);
  state.structureTreeGoods.delete(goodsId);
  delete state.preferredRecipeByOutput[goodsId];
}

function setSingleTarget(goodsId) {
  state.products = [{ goodsId, amountPerMinute: 1 }];
  setGoodAsMade(goodsId);
  state.selectedGoodsId = goodsId;
  state.selectedTreeGoodsId = null;
  state.selectedTreeNodeKey = null;
  state.completedTreeGoods.clear();
  state.expandedTreeGoods.clear();
  state.structureTreeGoods.clear();
  if (structureForGood(goodsId)) {
    state.structureTreeGoods.add(goodsId);
  }
}

function addTarget(goodsId) {
  setGoodAsMade(goodsId);
  state.selectedGoodsId = goodsId;
  state.selectedTreeNodeKey = null;
  state.products.push({ goodsId, amountPerMinute: 1 });
  if (structureForGood(goodsId)) {
    state.structureTreeGoods.add(goodsId);
  }
}

function makeGoodInPlan(goodsId, options = {}) {
  const path = findTreePath(goodsId, state.currentPlan?.planTrees ?? []);
  for (const pathGoodsId of path) {
    state.expandedTreeGoods.add(pathGoodsId);
  }
  const shouldSelect = options.select === true;
  setGoodAsMade(goodsId);
  state.expandedTreeGoods.add(goodsId);
  state.completedTreeGoods.delete(goodsId);
  state.selectedGoodsId = goodsId;
  state.selectedTreeGoodsId = shouldSelect ? goodsId : null;
  if (!shouldSelect) {
    state.selectedTreeNodeKey = null;
  }
  state.treeContextMenu = null;
  renderBoundaryPresets();
  renderPlan(options.preserveGraphViewport ? { preserveGraphViewport: true } : {});
  renderInspector();
  if (options.preserveGraphViewport) return;

  requestAnimationFrame(() => {
    if (state.treeView.showGraph) {
      positionRecipeGraph();
      return;
    }

    const node = elements.craftingTree.querySelector(`[data-goods-id="${cssEscape(goodsId)}"]`);
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
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
  const matches = targetBrowserMatches(repository);

  renderTargetBrowserCurrentTargets(repository);
  renderTargetFilterButtons();

  elements.targetResults.innerHTML = matches.length
    ? matches.map((match) => targetBrowserCard(repository, match)).join("")
    : `<div class="empty-state">No target matches.</div>`;

  const filterLabel = targetBrowserFilterLabel(state.targetFilter).toLowerCase();
  if (state.targetSearch.trim()) {
    elements.targetMatchSummary.textContent = matches.length
      ? `${formatAmount(matches.length)} ${filterLabel} matches shown`
      : "No matches";
  } else {
    const suggestionText = state.targetFilter === "all" ? "craftable suggestions" : `${filterLabel} entries`;
    elements.targetMatchSummary.textContent = `Showing ${formatAmount(matches.length)} ${suggestionText}`;
  }
}

function targetBrowserMatches(repository) {
  const query = state.targetSearch.trim();
  const source = query
    ? repository.searchGoods(query, TARGET_BROWSER_LIMIT * 4)
    : [...repository.goods.values()];

  return source
    .map((good, index) => {
      const recipeCount = repository.findRecipesProducing(good.id).length;
      const hasStructure = Boolean(structureForGood(good.id));
      return {
        good,
        index,
        recipeCount,
        hasStructure,
        score: targetBrowserScore(good, recipeCount, hasStructure)
      };
    })
    .filter((match) => query || state.targetFilter !== "all" || match.recipeCount > 0 || match.hasStructure)
    .filter((match) => targetBrowserFilterMatch(match))
    .sort((a, b) => {
      if (query) return b.score - a.score || a.index - b.index;
      return b.score - a.score || a.good.name.localeCompare(b.good.name) || a.good.id.localeCompare(b.good.id);
    })
    .slice(0, TARGET_BROWSER_LIMIT);
}

function renderTargetBrowserCurrentTargets(repository) {
  if (!elements.targetBrowserSelected) return;

  elements.targetBrowserSelected.innerHTML = state.products.length
    ? state.products
      .map((product) => {
        const good = repository.getGood(product.goodsId);
        const name = good?.name ?? product.goodsId;
        return `
          <span class="target-current-chip" ${goodTooltipAttrs(good, product.goodsId, formatRate(product.amountPerMinute))}>
            ${targetBrowserIconMarkup(good ?? { id: product.goodsId, kind: "item", color: "#7d8790" })}
            <span>
              <strong>${escapeHtml(name)}</strong>
              <em>${escapeHtml(formatRate(product.amountPerMinute))}</em>
            </span>
          </span>
        `;
      })
      .join("")
    : `<span class="target-current-empty">No target selected</span>`;
}

function renderTargetFilterButtons() {
  elements.targetFilterButtons.forEach((button) => {
    const active = button.dataset.filter === state.targetFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function targetBrowserFilterMatch(match) {
  switch (state.targetFilter) {
    case "craftable":
      return match.recipeCount > 0 || match.hasStructure;
    case "items":
      return match.good.kind !== "fluid";
    case "fluids":
      return match.good.kind === "fluid";
    case "structures":
      return match.hasStructure;
    default:
      return true;
  }
}

function targetBrowserFilterLabel(filter) {
  switch (filter) {
    case "craftable":
      return "Craftable";
    case "items":
      return "Item";
    case "fluids":
      return "Fluid";
    case "structures":
      return "Structure";
    default:
      return "Target";
  }
}

function targetBrowserScore(good, recipeCount, hasStructure = false) {
  let score = 0;
  if (state.products.some((product) => product.goodsId === good.id)) score += 10000;
  if (recipeCount) score += 1000 + Math.min(recipeCount, 99);
  if (hasStructure) score += 180;
  if (state.textureAtlas?.icons?.[good.id] !== undefined) score += 100;
  if (good.kind === "item") score += 20;
  if (good.mod === "gtceu") score += 10;
  return score;
}

function targetBrowserIconMarkup(good) {
  const kind = good?.kind ?? "item";
  const atlasIcon = atlasIconMarkup(good.id, kind, "target-grid-icon", 44);
  if (atlasIcon) return atlasIcon;

  return `<span class="target-grid-swatch ${kind}" style="--swatch:${escapeHtml(good?.color ?? "#7d8790")}"></span>`;
}

function targetBrowserCard(repository, match) {
  const { good, recipeCount, hasStructure } = match;
  const selected = state.products.some((product) => product.goodsId === good.id) ? " selected" : "";
  const kindLabel = good.kind === "fluid" ? "fluid" : (good.mod || "item");
  const recipeText = recipeCount
    ? planCountText(recipeCount, "recipe")
    : "no exported recipe";
  const typeText = hasStructure ? "multiblock" : good.kind;

  return `
    <article class="target-card${selected}" data-kind="${escapeHtml(good.kind)}">
      <button class="target-card-main" type="button" data-action="set-target" data-id="${escapeHtml(good.id)}" aria-label="Set ${escapeHtml(good.name)} as target">
        <span class="target-grid-slot">
          ${targetBrowserIconMarkup(good)}
        </span>
        <span class="target-card-text">
          <strong title="${escapeHtml(good.name)}">${escapeHtml(good.name)}</strong>
          <span>${escapeHtml(typeText)} / ${escapeHtml(kindLabel)}</span>
          <em title="${escapeHtml(good.id)}">${escapeHtml(recipeText)}</em>
        </span>
      </button>
      <button class="target-card-add" type="button" data-action="add-target-card" data-id="${escapeHtml(good.id)}" aria-label="Add ${escapeHtml(good.name)} target">+</button>
    </article>
  `;
}

function openTargetBrowser() {
  if (!elements.targetBrowserPanel) return;
  elements.targetBrowserPanel.open = true;
  renderTargetPicker();
  requestAnimationFrame(() => {
    elements.targetSearchInput?.focus();
    elements.targetSearchInput?.select();
  });
}

function closeTargetBrowser() {
  if (elements.targetBrowserPanel) {
    elements.targetBrowserPanel.open = false;
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
          ${targetRateControl(repository, product, index)}
          <button class="icon-button" data-action="remove-product" data-index="${index}" aria-label="Remove target">x</button>
        </div>
      `;
    })
    .join("");
}

function targetRateControl(repository, product, index) {
  const good = repository.getGood(product.goodsId);
  const shortcuts = targetRateShortcuts(good);
  const shortcutButtons = shortcuts
    .map((amount) => {
      const selected = Number(product.amountPerMinute) === amount ? " active" : "";
      return `<button class="target-rate-chip${selected}" type="button" data-action="set-product-rate" data-index="${index}" data-value="${amount}">${escapeHtml(targetRateShortcutLabel(good, amount))}</button>`;
    })
    .join("");

  return `
    <div class="target-rate-control">
      <span>Target rate</span>
      <div class="target-rate-stepper">
        <button class="icon-button" type="button" data-action="adjust-product-rate" data-index="${index}" data-direction="-1" aria-label="Decrease target rate">-</button>
        <input type="number" min="0" step="0.1" value="${escapeHtml(targetInputValue(product.amountPerMinute))}" data-action="update-product" data-index="${index}" aria-label="Target rate per minute">
        <button class="icon-button" type="button" data-action="adjust-product-rate" data-index="${index}" data-direction="1" aria-label="Increase target rate">+</button>
        <button class="target-rate-chip" type="button" data-action="scale-product-rate" data-index="${index}" data-factor="0.5">/2</button>
        <button class="target-rate-chip" type="button" data-action="scale-product-rate" data-index="${index}" data-factor="2">x2</button>
      </div>
      <div class="target-rate-shortcuts" aria-label="Common target rates">
        ${shortcutButtons}
      </div>
    </div>
  `;
}

function targetRateShortcuts(good) {
  return good?.kind === "fluid" ? [1000, 8000, 24000] : [1, 16, 64];
}

function targetRateShortcutLabel(good, amount) {
  if (good?.kind === "fluid" && amount >= 1000) return `${formatAmount(amount / 1000)}k`;
  return formatAmount(amount);
}

function targetInputValue(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 1000) / 1000);
}

function targetRateStep(repository, product) {
  const amount = Number(product?.amountPerMinute) || 0;
  const good = repository.getGood(product?.goodsId);
  if (good?.kind === "fluid") return amount < 1000 ? 1000 : 1000;
  return amount >= 64 ? 16 : 1;
}

function setProductRate(index, amount, options = {}) {
  const product = state.products[index];
  if (!product) return;
  const normalized = Math.max(0, Math.round((Number(amount) || 0) * 1000) / 1000);
  product.amountPerMinute = normalized;

  if (options.renderControls) {
    renderProductControls();
  }

  renderPlan({ preserveGraphViewport: true });
}

function renderPlan(options = {}) {
  const graphViewport = options.preserveGraphViewport ? captureRecipeGraphViewport() : null;
  const repository = state.repository;
  const externalGoods = getEffectiveExternalGoods(repository);
  const plan = createPlan(repository, state.products, {
    preferredRecipeByOutput: state.preferredRecipeByOutput,
    externalGoods,
    expandedGoods: state.expandedTreeGoods,
    structureTargets: state.structureTreeGoods,
    structuresByController: state.multiblockStructures,
    discreteItems: !state.treeView.showRates,
    reusableTools: true
  });
  state.currentPlan = plan;
  const treeNodes = flattenPlanTrees(plan.planTrees);
  const readyRows = readyIntermediateRows(repository, plan, treeNodes);

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
    ${neededInputsOverview(repository, plan, assumptionCount)}
    ${assumptionHtml}
  `;

  elements.recipeTracker.innerHTML = recipeTrackerPanel(repository, plan, externalGoods, treeNodes, readyRows);

  elements.machinePlan.innerHTML = machinePlanRows(repository, plan.machineRows);
  elements.treeGoodPicker.innerHTML = treeGoodPickerPanel(repository, plan, externalGoods);
  renderTreeContextMenu();

  if (elements.recipePlan) {
    elements.recipePlan.innerHTML = plan.recipeRows.length
      ? plan.recipeRows.map((row) => recipeRow(repository, row, externalGoods)).join("")
      : `<div class="empty-state">Choose a product to build a plan.</div>`;
  }

  elements.craftingTree.innerHTML = plan.planTrees.length
    ? (state.treeView.showGraph
      ? recipeGraphView(repository, plan, externalGoods)
      : plan.planTrees.map((tree, index) => craftingTreeNode(repository, tree, 0, externalGoods, String(index))).join(""))
    : `<div class="empty-state">Choose a product to build a tree.</div>`;

  elements.externalInputs.innerHTML = buildGuidePanel(repository, plan, externalGoods, readyRows);

  elements.byproducts.innerHTML = plan.byproductRows.length
    ? plan.byproductRows.map((row) => goodChip(repository, row.goodsId, demandAmountText(row.amountPerMinute))).join("")
    : `<div class="empty-state">No byproducts in this chain.</div>`;

  if (state.treeView.showGraph) {
    requestAnimationFrame(() => {
      if (graphViewport) {
        restoreRecipeGraphViewport(graphViewport);
        return;
      }

      positionRecipeGraph();
    });
  }
}

function neededInputsOverview(repository, plan, assumptionCount) {
  const summary = [
    planCountText(plan.externalRows.length, "supplied input"),
    planCountText(plan.recipeRows.length, "tree recipe"),
    planCountText(plan.machineRows.length, "machine group")
  ];

  if (plan.byproductRows.length) {
    summary.push(planCountText(plan.byproductRows.length, "byproduct"));
  }

  if (assumptionCount) {
    summary.push(planCountText(assumptionCount, "assumption"));
  }

  const chips = plan.externalRows.length
    ? plan.externalRows
        .map((row) => goodChip(repository, row.goodsId, externalInputAmountText(row)))
        .join("")
    : `<span class="needed-empty">No supplied inputs needed</span>`;

  return `
    <div class="needed-overview">
      <div class="needed-overview-header">
        <strong>Needed Inputs</strong>
        <span>${escapeHtml(summary.join(" · "))}</span>
      </div>
      <div class="needed-input-list">
        ${chips}
      </div>
    </div>
  `;
}

function recipeTrackerPanel(
  repository,
  plan,
  externalGoods,
  treeNodes = flattenPlanTrees(plan.planTrees),
  readyRows = readyIntermediateRows(repository, plan, treeNodes)
) {
  const trackableNodes = treeNodes.filter((entry) => entry.node.goodsId);
  const completedCount = trackableNodes.filter((entry) => state.completedTreeGoods.has(entry.node.goodsId)).length;
  const nextAction = nextTreeAction(repository, plan, externalGoods, treeNodes, readyRows);
  const targetChips = plan.products.length
    ? plan.products.map((product) => goodChip(repository, product.goodsId, demandAmountText(product.amountPerMinute))).join("")
    : `<span class="needed-empty">Choose a target to start a tree</span>`;

  return `
    <div class="recipe-tracker-grid">
      <section class="tracker-card tracker-goal">
        <span class="tracker-label">Current craft</span>
        <div class="tracker-targets">${targetChips}</div>
        <p>${escapeHtml(planCountText(trackableNodes.length, "tracked step"))} / ${formatAmount(completedCount)} done</p>
      </section>
      <section class="tracker-card tracker-next ${escapeHtml(nextAction.kind)}">
        <span class="tracker-label">Next useful action</span>
        <strong>${escapeHtml(nextAction.title)}</strong>
        <p>${escapeHtml(nextAction.detail)}</p>
        ${nextAction.actions}
      </section>
      <section class="tracker-card tracker-counts">
        <span><strong>${formatAmount(plan.externalRows.length)}</strong> base costs</span>
        <span><strong>${formatAmount(plan.machineRows.length)}</strong> machine groups</span>
        <span><strong>${formatAmount(plan.recipeRows.length)}</strong> recipe steps</span>
        <span><strong>${formatAmount(plan.byproductRows.length)}</strong> leftovers</span>
      </section>
    </div>
  `;
}

function flattenPlanTrees(trees) {
  const nodes = [];

  function visit(node, depth, ancestors, key) {
    nodes.push({ node, depth, ancestors, key });
    (node.children ?? []).forEach((child, index) => {
      visit(child, depth + 1, [...ancestors, node.goodsId], `${key}/${index}`);
    });
  }

  trees.forEach((tree, index) => {
    visit(tree, 0, [], String(index));
  });

  return nodes;
}

function selectedTreeEntry(plan) {
  const treeNodes = flattenPlanTrees(plan.planTrees);
  if (state.selectedTreeNodeKey) {
    const keyed = treeNodes.find((entry) => entry.key === state.selectedTreeNodeKey);
    if (keyed) return keyed;
    state.selectedTreeNodeKey = null;
  }

  if (state.selectedTreeGoodsId) {
    const matched = treeNodes.find((entry) => entry.node.goodsId === state.selectedTreeGoodsId);
    if (matched) {
      state.selectedTreeNodeKey = matched.key;
      return matched;
    }
  }

  return null;
}

function nextTreeAction(repository, plan, externalGoods, treeNodes, readyRows = []) {
  if (!plan.planTrees.length) {
    return {
      kind: "empty",
      title: "Pick an output",
      detail: "Search the target list, choose an item or fluid, then expand only the branches you want to craft.",
      actions: ""
    };
  }

  const ready = readyRows[0];
  if (ready) {
    const name = repository.getGoodName(ready.goodsId);
    const recipeName = ready.recipeName;
    return {
      kind: ready.isTarget ? "complete" : "recipe",
      title: ready.isTarget ? `Finish ${name}` : `Craft ${name}`,
      detail: `${recipeName} is the lowest open recipe layer. Its child recipes are already handled or are base inputs you can gather now.`,
      actions: trackerActionButtons(ready.goodsId, [
        { action: "work-tree-step", label: "Work here", nodeKey: ready.nodeKey },
        { action: "toggle-done-step", label: "Mark done" },
        { action: "focus-tree-good", label: "Locate" }
      ])
    };
  }

  const unfinishedLeaves = treeNodes
    .map((entry) => entry.node)
    .filter((node) => !node.children.length && !state.completedTreeGoods.has(node.goodsId));
  const craftableExternal = unfinishedLeaves.find((node) => {
    return node.reason === "external" && repository.findRecipesProducing(node.goodsId).length > 0;
  });

  if (craftableExternal) {
    const name = repository.getGoodName(craftableExternal.goodsId);
    return {
      kind: "branch",
      title: `Decide ${name}`,
      detail: "This is currently counted as supplied, but it has exported recipes. Make it a branch if you want the tree to break it down.",
      actions: trackerActionButtons(craftableExternal.goodsId, [
        { action: "make-input", label: "Make branch" },
        { action: "toggle-done-step", label: "Mark done" },
        { action: "focus-tree-good", label: "Locate" }
      ])
    };
  }

  const rawLeaf = unfinishedLeaves.find((node) => node.reason === "external" || node.reason === "missing" || node.reason === "unresolved");
  if (rawLeaf) {
    const name = repository.getGoodName(rawLeaf.goodsId);
    return {
      kind: rawLeaf.reason ?? "input",
      title: `Gather ${name}`,
      detail: `${formatRate(rawLeaf.amountPerMinute)} is still a base cost for this tree.`,
      actions: trackerActionButtons(rawLeaf.goodsId, [
        { action: "toggle-done-step", label: "Mark done" },
        { action: "focus-tree-good", label: "Locate" }
      ])
    };
  }

  const unfinishedRecipe = treeNodes
    .map((entry) => entry.node)
    .find((node) => node.recipe && !state.completedTreeGoods.has(node.goodsId));
  if (unfinishedRecipe) {
    const type = repository.getRecipeType(unfinishedRecipe.recipe.type);
    return {
      kind: "recipe",
      title: `Run ${type.name}`,
      detail: `${repository.getGoodName(unfinishedRecipe.goodsId)} is ready to craft once its visible children are handled.`,
      actions: trackerActionButtons(unfinishedRecipe.goodsId, [
        { action: "toggle-done-step", label: "Mark done" },
        { action: "focus-tree-good", label: "Locate" }
      ])
    };
  }

  return {
    kind: "complete",
    title: "Tree checked off",
    detail: "Every visible step is marked done. Clear done when you start planning another pass.",
    actions: `<button class="secondary-button" type="button" data-action="clear-done-steps">Clear done</button>`
  };
}

function trackerActionButtons(goodsId, actions) {
  return `
    <div class="tracker-actions">
      ${actions.map((entry) => `<button class="secondary-button" type="button" data-action="${escapeHtml(entry.action)}" data-id="${escapeHtml(goodsId)}"${entry.nodeKey ? ` data-node-key="${escapeHtml(entry.nodeKey)}"` : ""}>${escapeHtml(entry.label)}</button>`).join("")}
    </div>
  `;
}

function readyIntermediateRows(repository, plan, treeNodes) {
  const targetGoods = new Set(plan.products.map((product) => product.goodsId));
  const rows = new Map();

  for (const entry of treeNodes) {
    const node = entry.node;
    if (!isReadyIntermediateNode(node)) continue;

    const key = node.goodsId;
    const current = rows.get(key);
    if (current) {
      current.amountPerMinute += node.amountPerMinute;
      current.depth = Math.max(current.depth, entry.depth);
      current.nodeCount += 1;
      mergeDirectNeeds(current.needs, node.children);
      continue;
    }

    rows.set(key, {
      goodsId: node.goodsId,
      amountPerMinute: node.amountPerMinute,
      depth: entry.depth,
      nodeKey: entry.key,
      nodeCount: 1,
      recipe: node.recipe,
      recipeName: readyRecipeLabel(repository, node),
      isTarget: targetGoods.has(node.goodsId),
      needs: directNeedsFromChildren(node.children)
    });
  }

  return [...rows.values()].sort((a, b) => {
    const targetSort = Number(a.isTarget) - Number(b.isTarget);
    return targetSort
      || b.depth - a.depth
      || b.amountPerMinute - a.amountPerMinute
      || repository.getGoodName(a.goodsId).localeCompare(repository.getGoodName(b.goodsId));
  });
}

function isReadyIntermediateNode(node) {
  if (!node?.recipe || state.completedTreeGoods.has(node.goodsId)) return false;
  if (!node.children?.length) return false;

  return node.children.every((child) => !child.recipe || state.completedTreeGoods.has(child.goodsId));
}

function readyRecipeLabel(repository, node) {
  if (isStructureRecipe(node.recipe)) return "Multiblock structure";
  if (isCraftingRecipe(node.recipe)) return "Crafting grid";
  return repository.getRecipeType(node.recipe.type).name;
}

function directNeedsFromChildren(children) {
  const needs = new Map();
  mergeDirectNeeds(needs, children);
  return needs;
}

function mergeDirectNeeds(needs, children) {
  for (const child of children ?? []) {
    const current = needs.get(child.goodsId);
    const reusable = Boolean(child.reusable);
    const amountPerMinute = reusable ? 1 : child.amountPerMinute;

    if (current) {
      current.reusable = current.reusable || reusable;
      current.amountPerMinute = current.reusable
        ? 1
        : current.amountPerMinute + amountPerMinute;
    } else {
      needs.set(child.goodsId, {
        goodsId: child.goodsId,
        amountPerMinute,
        reusable
      });
    }
  }
}

function intermediateQueuePanel(repository, readyRows, options = {}) {
  const limit = options.limit ?? 8;
  const visibleRows = readyRows.slice(0, limit);
  const hiddenCount = Math.max(0, readyRows.length - visibleRows.length);
  const shownIds = visibleRows.map((row) => row.goodsId).join(",");
  const title = options.title ?? "Next intermediate builds";
  const subtitle = options.subtitle ?? "Work bottom-up";
  const className = options.className ?? "";
  const description = options.description ?? (visibleRows.length
    ? "Craft these lowest open recipe layers first. As you mark them done, this queue advances toward the final build."
    : "Expand an item in the graph to create the next craftable intermediate layer.");
  const emptyText = options.emptyText ?? "No intermediate steps ready yet";

  return `
    <section class="intermediate-queue ${escapeHtml(className)}">
      <header class="tracker-queue-header">
        <div>
          <span class="tracker-label">${escapeHtml(title)}</span>
          <strong>${escapeHtml(subtitle)}</strong>
        </div>
        ${visibleRows.length ? `<button class="secondary-button" type="button" data-action="mark-ready-intermediates-done" data-ids="${escapeHtml(shownIds)}">Mark shown done</button>` : ""}
      </header>
      <p>${escapeHtml(description)}</p>
      <div class="tracker-step-list">
        ${visibleRows.length ? visibleRows.map((row) => intermediateStepCard(repository, row)).join("") : `<span class="needed-empty">${escapeHtml(emptyText)}</span>`}
      </div>
      ${hiddenCount ? `<p class="tracker-more">${formatAmount(hiddenCount)} more ready steps are hidden until these are handled.</p>` : ""}
    </section>
  `;
}

function intermediateStepCard(repository, row) {
  const name = repository.getGoodName(row.goodsId);
  const needs = [...row.needs.values()]
    .slice(0, 4)
    .map((need) => goodChip(repository, need.goodsId, externalInputAmountText(need)))
    .join("");
  const hiddenNeeds = Math.max(0, row.needs.size - 4);
  const duplicateText = row.nodeCount > 1 ? ` · ${formatAmount(row.nodeCount)} places` : "";
  const nodeKeyAttr = row.nodeKey ? ` data-node-key="${escapeHtml(row.nodeKey)}"` : "";

  return `
    <article class="tracker-step-row${row.isTarget ? " final" : ""}">
      <button class="tracker-step-main" type="button" data-action="work-tree-step" data-id="${escapeHtml(row.goodsId)}"${nodeKeyAttr}>
        ${graphGoodIcon(repository, row.goodsId, demandAmountText(row.amountPerMinute))}
        <span>
          <strong>${escapeHtml(name)}</strong>
          <em>${escapeHtml(row.isTarget ? "Final build" : row.recipeName)}${escapeHtml(duplicateText)}</em>
        </span>
      </button>
      <div class="tracker-step-needs">
        <span>Needs</span>
        ${needs || `<span class="needed-empty">No direct inputs</span>`}
        ${hiddenNeeds ? `<span class="tree-cost-more">+${formatAmount(hiddenNeeds)} more</span>` : ""}
      </div>
      <div class="tracker-actions">
        <button class="secondary-button done-button" type="button" data-action="toggle-done-step" data-id="${escapeHtml(row.goodsId)}">Done</button>
        <button class="secondary-button" type="button" data-action="focus-tree-good" data-id="${escapeHtml(row.goodsId)}">Locate</button>
      </div>
    </article>
  `;
}

function treeGoodPickerPanel(repository, plan, externalGoods) {
  const selectedEntry = selectedTreeEntry(plan);
  if (!selectedEntry) return "";

  const { node: selectedNode, key: selectedNodeKey } = selectedEntry;
  const goodsId = selectedNode.goodsId;
  const good = repository.getGood(goodsId);
  if (!good) return "";

  const recipes = repository.rankRecipesForOutput(goodsId);
  const structure = structureForGood(goodsId);
  const isTarget = state.products.some((product) => product.goodsId === goodsId);
  const isExternal = externalGoods.has(goodsId) && !isTarget;
  const isCollapsed = selectedNode?.reason === "collapsed";
  const canExpandBranch = recipes.length && (isCollapsed || (!isTarget && isExternal));
  const selectedIsStructure = isStructureRecipe(selectedNode?.recipe);
  const selectedRecipeId = isExternal
    ? EXTERNAL_RECIPE_VALUE
    : selectedIsStructure
      ? selectedNode.recipe.id
      : state.preferredRecipeByOutput[goodsId] ?? selectedNode?.recipe?.id ?? recipes[0]?.id ?? "";
  const recipeCards = recipes.length
    ? recipes.slice(0, 6).map((recipe, index) => treePickerRecipeCard(repository, goodsId, recipe, index, selectedRecipeId, {
        nodeKey: selectedNodeKey,
        clearStructure: selectedIsStructure
      })).join("")
    : `<div class="empty-state">No exported recipe. This remains a base cost.</div>`;
  const selectedAmount = selectedNode ? graphAmountText(selectedNode.amountPerMinute) : "";

  return `
    <section class="tree-good-picker-card tree-good-picker-window" role="dialog" aria-modal="false" aria-label="Branch recipe options for ${escapeHtml(good.name)}">
      <header class="tree-picker-header">
        <div class="tree-picker-heading">
          <span class="tracker-label">Branch options</span>
          ${goodChip(repository, goodsId, selectedAmount)}
        </div>
        <div class="tree-picker-actions">
          ${canExpandBranch ? `<button class="secondary-button" type="button" data-action="make-input" data-id="${escapeHtml(goodsId)}">Expand branch</button>` : ""}
          ${!isTarget && !isExternal ? `<button class="secondary-button" type="button" data-action="supply-tree-good" data-id="${escapeHtml(goodsId)}">Treat supplied</button>` : ""}
          ${!isTarget ? `<button class="secondary-button" type="button" data-action="set-tree-target" data-id="${escapeHtml(goodsId)}">Set target</button>` : ""}
          <button class="secondary-button" type="button" data-action="focus-tree-good" data-id="${escapeHtml(goodsId)}">Locate</button>
          <button class="secondary-button" type="button" data-action="inspect-good" data-id="${escapeHtml(goodsId)}">Inspect</button>
          <button class="icon-button tree-picker-close" type="button" data-action="close-tree-picker" aria-label="Close branch options">x</button>
        </div>
      </header>
      <div class="tree-picker-status">
        <span>${isCollapsed ? "ready to expand" : isExternal ? "supplied base cost" : recipes.length ? "recipe-driven branch" : "base cost"}</span>
        <span>${isCollapsed || (isExternal && recipes.length) ? "expand when you want the next recipe layer" : "recipe cards change this branch only"}</span>
        ${selectedNode?.recipe ? `<span>${escapeHtml(repository.getRecipeType(selectedNode.recipe.type).name)}</span>` : ""}
        ${selectedNode?.machine ? `<span>${escapeHtml(machineName(selectedNode.machine, selectedNode.voltageTier))}</span>` : ""}
        ${structure ? `<span>multiblock structure</span>` : ""}
      </div>
      <div class="tree-picker-recipes">
        ${!isTarget ? treePickerSuppliedCard(repository, goodsId, selectedRecipeId) : ""}
        ${structure ? treePickerStructureCard(repository, structure, selectedIsStructure || selectedRecipeId === structure.id, selectedNodeKey) : ""}
        ${recipeCards}
      </div>
    </section>
  `;
}

function renderTreeContextMenu() {
  if (!elements.treeContextMenu) return;
  elements.treeContextMenu.innerHTML = treeContextMenuPanel(state.repository, state.currentPlan);
}

function treeContextMenuPanel(repository, plan) {
  const menu = state.treeContextMenu;
  if (!menu || !repository || !plan) return "";

  const entry = treeEntryForContext(menu.goodsId, menu.nodeKey, plan);
  const node = entry?.node;
  const goodsId = node?.goodsId ?? menu.goodsId;
  const good = repository.getGood(goodsId);
  if (!goodsId || !good) return "";

  const visibleBranchGoods = node ? collectVisibleBranchGoods(node) : new Set([goodsId]);
  const completedCount = [...visibleBranchGoods].filter((id) => state.completedTreeGoods.has(id)).length;
  const hasBranch = Boolean(node?.children?.length);
  const isDone = state.completedTreeGoods.has(goodsId);
  const isTarget = state.products.some((product) => product.goodsId === goodsId);
  const canCollapse = !isTarget && Boolean(node?.recipe || node?.children?.length || state.expandedTreeGoods.has(goodsId) || state.structureTreeGoods.has(goodsId));
  const canExpand = Boolean(
    node?.reason === "collapsed"
      ? repository.findRecipesProducing(goodsId).length
      : !isTarget && node?.reason === "external" && repository.findRecipesProducing(goodsId).length
  );
  const nodeKey = entry?.key ?? menu.nodeKey ?? "";
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 292));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - 260));
  const nodeKeyAttr = nodeKey ? ` data-node-key="${escapeHtml(nodeKey)}"` : "";

  return `
    <section class="tree-context-menu" style="left:${left}px;top:${top}px" role="menu" aria-label="Tree actions for ${escapeHtml(good.name)}">
      <header>
        <span class="tracker-label">Tree actions</span>
        ${goodChip(repository, goodsId, "")}
      </header>
      <div class="tree-context-menu-actions">
        <button type="button" data-action="toggle-done-step" data-id="${escapeHtml(goodsId)}">${isDone ? "Clear item done" : "Mark item done"}</button>
        ${hasBranch ? `<button type="button" data-action="mark-tree-branch-done" data-id="${escapeHtml(goodsId)}"${nodeKeyAttr}>Mark branch done</button>` : ""}
        ${hasBranch && completedCount ? `<button type="button" data-action="clear-tree-branch-done" data-id="${escapeHtml(goodsId)}"${nodeKeyAttr}>Clear branch done</button>` : ""}
        ${canCollapse ? `<button type="button" data-action="collapse-tree-branch" data-id="${escapeHtml(goodsId)}"${nodeKeyAttr}>Collapse branch</button>` : ""}
        ${canExpand ? `<button type="button" data-action="make-input" data-id="${escapeHtml(goodsId)}">Expand branch</button>` : ""}
        <button type="button" data-action="focus-tree-good" data-id="${escapeHtml(goodsId)}">Locate</button>
        <button type="button" data-action="inspect-good" data-id="${escapeHtml(goodsId)}">Inspect</button>
      </div>
    </section>
  `;
}

function treeEntryForContext(goodsId, nodeKey = "", plan = state.currentPlan) {
  const entries = flattenPlanTrees(plan?.planTrees ?? []);
  if (nodeKey) {
    const keyed = entries.find((entry) => entry.key === nodeKey);
    if (keyed) return keyed;
  }
  return entries.find((entry) => entry.node.goodsId === goodsId) ?? null;
}

function collectVisibleBranchGoods(node) {
  const ids = new Set();

  function visit(current) {
    if (!current?.goodsId) return;
    ids.add(current.goodsId);
    (current.children ?? []).forEach(visit);
  }

  visit(node);
  return ids;
}

function selectedTreeGoodsId(plan) {
  return selectedTreeEntry(plan)?.node.goodsId ?? null;
}

function treePickerSuppliedCard(repository, goodsId, selectedRecipeId) {
  const selected = selectedRecipeId === EXTERNAL_RECIPE_VALUE ? " selected" : "";
  return `
    <article class="tree-picker-recipe supplied${selected}">
      <div>
        <strong>Treat as supplied</strong>
        <p>${escapeHtml(repository.getGoodName(goodsId))} stays in Total Cost and does not expand further.</p>
      </div>
      <button class="secondary-button" type="button" data-action="supply-tree-good" data-id="${escapeHtml(goodsId)}">Use</button>
    </article>
  `;
}

function treePickerRecipeCard(repository, goodsId, recipe, index, selectedRecipeId, options = {}) {
  const type = repository.getRecipeType(recipe.type);
  const selected = recipe.id === selectedRecipeId ? " selected" : "";
  const recommended = index === 0 ? `<span class="preferred-pill">recommended</span>` : "";
  const preview = recipeVisual(repository, recipe, { compactMachineStage: true });
  const nodeKey = options.nodeKey ? ` data-node-key="${escapeHtml(options.nodeKey)}"` : "";
  const clearStructure = options.clearStructure ? ` data-clear-structure="true"` : "";

  return `
    <article class="tree-picker-recipe${selected}">
      <div class="tree-picker-recipe-main">
        <strong>${escapeHtml(type.name)}</strong>
        <p>${escapeHtml(recipe.id)}</p>
        <div class="tree-picker-recipe-preview">
          ${preview}
        </div>
      </div>
      <div class="tree-picker-recipe-side">
        ${recommended}
        <span>${formatDuration(recipe.durationTicks)}</span>
        <span>${formatAmount(recipe.eut)} EU/t</span>
        <button class="secondary-button" type="button" data-action="use-tree-recipe" data-output-id="${escapeHtml(goodsId)}" data-recipe-id="${escapeHtml(recipe.id)}"${nodeKey}${clearStructure}>Use</button>
      </div>
    </article>
  `;
}

function treePickerStructureCard(repository, structure, selected = false, nodeKey = "") {
  const coverage = structureCoverageLabel(structure);
  const coverageClass = structureCoverageClass(structure);
  const nodeKeyAttr = nodeKey ? ` data-node-key="${escapeHtml(nodeKey)}"` : "";
  const requirements = (structure.requirements ?? [])
    .map((requirement) => {
      const role = requirement.role ? `<em>${escapeHtml(requirement.role)}</em>` : "";
      return `
        <span class="tree-structure-requirement">
          ${goodChip(repository, requirement.id, `x${formatAmount(requirement.amount ?? 1)}`)}
          ${role}
        </span>
      `;
    })
    .join("");
  const notes = (structure.notes ?? [])
    .slice(0, 3)
    .map((note) => `<li>${escapeHtml(note)}</li>`)
    .join("");

  return `
    <article class="tree-picker-recipe tree-picker-structure${selected ? " selected" : ""}">
      <div>
        <strong>${escapeHtml(structure.name ?? "Multiblock structure")}</strong>
        <p>${escapeHtml(structure.description ?? "Build the formed multiblock around this controller.")}</p>
        <div class="tree-structure-requirements">
          ${requirements || `<span class="needed-empty">No structure parts recorded yet.</span>`}
        </div>
        ${notes ? `<ul class="tree-structure-notes">${notes}</ul>` : ""}
      </div>
      <div class="tree-picker-recipe-side">
        <span class="preferred-pill">${selected ? "selected" : "structure"}</span>
        <span class="preferred-pill structure-coverage ${coverageClass}">${escapeHtml(coverage)}</span>
        <button class="secondary-button" type="button" data-action="use-tree-structure" data-id="${escapeHtml(structure.controller)}"${nodeKeyAttr}>Use</button>
      </div>
    </article>
  `;
}

function structureCoverageLabel(structure) {
  switch (structure?.coverage) {
    case "exact":
      return "exact cost";
    case "pattern-lower-bound":
      return "lower bound";
    case "standard-build":
      return "standard build";
    case "controller-only":
      return "controller only";
    default:
      return "supplemental";
  }
}

function structureCoverageClass(structure) {
  const coverage = structure?.coverage ?? "supplemental";
  return coverage.replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
}

function recipeGraphView(repository, plan, externalGoods) {
  return `
    <div class="emi-tree-workbench">
      <div class="emi-tree-toolbar" aria-label="Recipe graph view controls">
        <span>Drag empty space to pan. Use the mouse wheel to zoom.</span>
        <div>
          <button class="secondary-button" type="button" data-action="recipe-graph-zoom-out" aria-label="Zoom recipe graph out">-</button>
          <strong data-role="recipe-graph-zoom">${Math.round(state.recipeGraph.zoom * 100)}%</strong>
          <button class="secondary-button" type="button" data-action="recipe-graph-zoom-in" aria-label="Zoom recipe graph in">+</button>
          <button class="secondary-button" type="button" data-action="recipe-graph-reset">Reset</button>
        </div>
      </div>
      <div class="emi-tree-scroll" style="--graph-scale:${state.recipeGraph.zoom}">
        <div class="emi-tree-forest">
          ${plan.planTrees.map((tree, index) => recipeGraphSubtree(repository, tree, externalGoods, 0, String(index))).join("")}
        </div>
      </div>
    </div>
  `;
}

function recipeGraphSubtree(repository, node, externalGoods, depth, nodeKey) {
  const childCount = node.children.length;
  const childClass = childCount > 1 ? " multi" : childCount === 1 ? " single" : "";
  const children = childCount
    ? `
      <div class="emi-children${childClass}" style="--child-count:${childCount}">
        ${node.children.map((child, index) => recipeGraphSubtree(repository, child, externalGoods, depth + 1, `${nodeKey}/${index}`)).join("")}
      </div>
    `
    : "";

  return `
    <div class="emi-subtree" style="--graph-depth:${depth}">
      ${node.recipe ? recipeGraphCraftNode(repository, node, externalGoods, nodeKey) : recipeGraphLeafNode(repository, node, nodeKey)}
      ${children}
    </div>
  `;
}

function recipeGraphCraftNode(repository, node, externalGoods, nodeKey) {
  const type = repository.getRecipeType(node.recipe.type);
  const isDone = state.completedTreeGoods.has(node.goodsId);
  const selected = state.selectedTreeNodeKey === nodeKey || (!state.selectedTreeNodeKey && state.selectedTreeGoodsId === node.goodsId) ? " selected" : "";
  const done = isDone ? " done" : "";
  const supplied = externalGoods.has(node.goodsId) ? " supplied" : "";
  const recipeKind = isStructureRecipe(node.recipe) ? "structure" : isCraftingRecipe(node.recipe) ? "crafting" : "machine";
  const recipeSymbol = recipeKind === "structure" ? "S" : recipeKind === "crafting" ? "C" : "M";
  const tooltip = `${node.structure?.name ?? type.name}${node.machine ? ` · ${machineName(node.machine, node.voltageTier)}` : ""}`;

  return `
    <span class="emi-node-wrap">
      <button class="emi-node emi-craft-node ${recipeKind}${selected}${done}${supplied}" type="button" data-action="select-tree-good" data-id="${escapeHtml(node.goodsId)}" data-node-key="${escapeHtml(nodeKey)}" aria-label="Select ${escapeHtml(repository.getGoodName(node.goodsId))}">
        <span class="emi-node-frame" title="${escapeHtml(tooltip)}">
          <span class="emi-recipe-symbol ${recipeKind}" aria-hidden="true">${recipeSymbol}</span>
          ${graphGoodIcon(repository, node.goodsId)}
        </span>
        <span class="emi-node-count">${escapeHtml(graphAmountText(node.amountPerMinute))}</span>
      </button>
      ${graphDoneButton(repository, node.goodsId, isDone)}
    </span>
  `;
}

function recipeGraphLeafNode(repository, node, nodeKey) {
  const isDone = state.completedTreeGoods.has(node.goodsId);
  const selected = state.selectedTreeNodeKey === nodeKey || (!state.selectedTreeNodeKey && state.selectedTreeGoodsId === node.goodsId) ? " selected" : "";
  const done = isDone ? " done" : "";
  const canMake = repository.findRecipesProducing(node.goodsId).length > 0;
  const reason = node.reason ?? "external";

  return `
    <span class="emi-node-wrap">
      <button class="emi-node emi-leaf-node ${escapeHtml(reason)}${canMake ? " craftable" : ""}${selected}${done}" type="button" data-action="select-tree-good" data-id="${escapeHtml(node.goodsId)}" data-node-key="${escapeHtml(nodeKey)}" aria-label="Select ${escapeHtml(repository.getGoodName(node.goodsId))}">
        ${graphGoodIcon(repository, node.goodsId)}
        <span class="emi-node-count">${escapeHtml(graphAmountText(node.amountPerMinute))}</span>
      </button>
      ${graphDoneButton(repository, node.goodsId, isDone)}
    </span>
  `;
}

function graphDoneButton(repository, goodsId, isDone) {
  const name = repository.getGoodName(goodsId);
  return `
    <button class="emi-node-done-button${isDone ? " active" : ""}" type="button" data-action="toggle-done-step" data-id="${escapeHtml(goodsId)}" aria-label="${isDone ? "Clear done" : "Mark done"} for ${escapeHtml(name)}">
      ${isDone ? "&#10003;" : ""}
    </button>
  `;
}

function stackBreakdownText(repository, goodsId, amount) {
  const good = repository.getGood(goodsId);
  if (good?.kind !== "item") return "";

  const count = Number(amount);
  if (!Number.isFinite(count) || count <= 0) return "";

  const rounded = Math.round(count);
  if (Math.abs(rounded - count) > 0.001) return "";

  const stacks = Math.floor(rounded / 64);
  const extra = rounded % 64;
  if (!stacks) return `${formatAmount(extra)} extra`;
  if (!extra) return `${formatAmount(stacks)} ${stacks === 1 ? "stack" : "stacks"}`;
  return `${formatAmount(stacks)} ${stacks === 1 ? "stack" : "stacks"} + ${formatAmount(extra)}`;
}

function selectTreeGood(goodsId, nodeKey = "") {
  if (!goodsId) return;
  const repository = state.repository;
  const externalGoods = getEffectiveExternalGoods(repository);
  const selectedEntry = flattenPlanTrees(state.currentPlan?.planTrees ?? [])
    .find((entry) => nodeKey ? entry.key === nodeKey : entry.node.goodsId === goodsId);
  const selectedNode = selectedEntry?.node;
  const isTarget = state.products.some((product) => product.goodsId === goodsId);
  const canExpand = selectedNode?.reason === "collapsed" || (!isTarget && externalGoods.has(goodsId) && repository.findRecipesProducing(goodsId).length > 0);

  state.selectedTreeGoodsId = goodsId;
  state.selectedTreeNodeKey = selectedEntry?.key ?? null;
  state.selectedGoodsId = goodsId;

  if (canExpand) {
    makeGoodInPlan(goodsId, {
      preserveGraphViewport: state.treeView.showGraph
    });
    return;
  }

  renderPlan();
}

function useTreeRecipe(outputId, recipeId, options = {}) {
  if (!outputId || !recipeId) return;
  setGoodAsMade(outputId);
  if (options.clearStructure) {
    state.structureTreeGoods.delete(outputId);
  }
  state.expandedTreeGoods.add(outputId);
  state.preferredRecipeByOutput[outputId] = recipeId;
  if (options.closePicker) {
    state.selectedTreeGoodsId = null;
    state.selectedTreeNodeKey = null;
  } else {
    state.selectedTreeGoodsId = outputId;
    if (options.nodeKey !== undefined) {
      state.selectedTreeNodeKey = options.nodeKey || null;
    }
  }
  state.selectedGoodsId = outputId;
  renderBoundaryPresets();
  renderPlan(options.closePicker ? { preserveGraphViewport: true } : {});
  renderInspector();
}

function useTreeStructure(goodsId, options = {}) {
  if (!goodsId || !structureForGood(goodsId)) return;
  setGoodAsMade(goodsId);
  state.structureTreeGoods.add(goodsId);
  state.expandedTreeGoods.add(goodsId);
  delete state.preferredRecipeByOutput[goodsId];
  if (options.closePicker) {
    state.selectedTreeGoodsId = null;
    state.selectedTreeNodeKey = null;
  } else {
    state.selectedTreeGoodsId = goodsId;
    if (options.nodeKey !== undefined) {
      state.selectedTreeNodeKey = options.nodeKey || null;
    }
  }
  state.selectedGoodsId = goodsId;
  renderBoundaryPresets();
  renderPlan(options.closePicker ? { preserveGraphViewport: true } : {});
  renderInspector();
}

function applyRecipeGraphZoom(scroll = elements.craftingTree.querySelector(".emi-tree-scroll")) {
  if (!(scroll instanceof HTMLElement)) return;
  scroll.style.setProperty("--graph-scale", String(state.recipeGraph.zoom));
  elements.craftingTree.querySelectorAll("[data-role='recipe-graph-zoom']").forEach((node) => {
    node.textContent = `${Math.round(state.recipeGraph.zoom * 100)}%`;
  });
  requestAnimationFrame(drawRecipeGraphConnectors);
}

function setRecipeGraphZoom(value, anchor = null) {
  const nextZoom = Math.round(Math.min(1.8, Math.max(0.55, Number(value) || 1)) * 100) / 100;
  const scroll = elements.craftingTree.querySelector(".emi-tree-scroll");

  state.recipeGraph.zoom = nextZoom;
  applyRecipeGraphZoom(scroll);

  if (anchor && scroll instanceof HTMLElement) {
    scroll.scrollLeft = anchor.contentX * nextZoom - anchor.offsetX;
    scroll.scrollTop = anchor.contentY * nextZoom - anchor.offsetY;
  }
}

function captureRecipeGraphViewport() {
  const scroll = elements.craftingTree.querySelector(".emi-tree-scroll");
  if (!(scroll instanceof HTMLElement)) return null;

  return {
    scrollLeft: scroll.scrollLeft,
    scrollTop: scroll.scrollTop
  };
}

function restoreRecipeGraphViewport(viewport) {
  const scroll = elements.craftingTree.querySelector(".emi-tree-scroll");
  if (!(scroll instanceof HTMLElement) || !viewport) return;

  applyRecipeGraphZoom(scroll);
  scroll.scrollLeft = Math.max(0, Math.min(viewport.scrollLeft, scroll.scrollWidth - scroll.clientWidth));
  scroll.scrollTop = Math.max(0, Math.min(viewport.scrollTop, scroll.scrollHeight - scroll.clientHeight));
  drawRecipeGraphConnectors();
}

function positionRecipeGraph() {
  const scroll = elements.craftingTree.querySelector(".emi-tree-scroll");
  if (!(scroll instanceof HTMLElement)) return;
  applyRecipeGraphZoom(scroll);

  const selected = state.selectedTreeNodeKey
    ? elements.craftingTree.querySelector(`.emi-node[data-node-key="${cssEscape(state.selectedTreeNodeKey)}"]`)
    : state.selectedTreeGoodsId
    ? elements.craftingTree.querySelector(`.emi-node[data-id="${cssEscape(state.selectedTreeGoodsId)}"]`)
    : null;

  if (selected instanceof HTMLElement) {
    centerRecipeGraphNode(scroll, selected);
    return;
  }

  scroll.scrollLeft = Math.max(0, (scroll.scrollWidth - scroll.clientWidth) / 2);
  scroll.scrollTop = 0;
  drawRecipeGraphConnectors();
}

function centerRecipeGraphNode(scroll, node) {
  const scrollRect = scroll.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const nodeX = nodeRect.left - scrollRect.left + scroll.scrollLeft;
  const nodeY = nodeRect.top - scrollRect.top + scroll.scrollTop;
  scroll.scrollLeft = Math.max(0, nodeX - (scroll.clientWidth - nodeRect.width) / 2);
  scroll.scrollTop = Math.max(0, nodeY - (scroll.clientHeight - nodeRect.height) / 2);
  drawRecipeGraphConnectors();
}

function drawRecipeGraphConnectors() {
  const forest = elements.craftingTree.querySelector(".emi-tree-forest");
  if (!(forest instanceof HTMLElement)) return;

  let svg = forest.querySelector(".emi-tree-connectors");
  if (!(svg instanceof SVGSVGElement)) {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("emi-tree-connectors");
    svg.setAttribute("aria-hidden", "true");
    forest.prepend(svg);
  }

  const scale = state.recipeGraph.zoom || 1;
  const forestRect = forest.getBoundingClientRect();
  const forestWidth = Math.max(1, forest.scrollWidth / scale);
  const forestHeight = Math.max(1, forest.scrollHeight / scale);
  svg.setAttribute("viewBox", `0 0 ${forestWidth} ${forestHeight}`);
  svg.setAttribute("width", String(forestWidth));
  svg.setAttribute("height", String(forestHeight));

  const paths = [];
  const topSubtrees = [...forest.children].filter((child) => child.classList?.contains("emi-subtree"));

  for (const subtree of topSubtrees) {
    drawSubtreeConnectors(subtree, forestRect, scale, paths);
  }

  svg.innerHTML = paths.map((path) => `<path class="emi-connector-path" d="${path}"></path>`).join("");
}

function drawSubtreeConnectors(subtree, forestRect, scale, paths) {
  const parentNode = subtreeGraphNode(subtree);
  const childWrap = [...subtree.children].find((child) => child.classList?.contains("emi-children"));
  if (!(parentNode instanceof HTMLElement) || !(childWrap instanceof HTMLElement)) return;

  const childSubtrees = [...childWrap.children].filter((child) => child.classList?.contains("emi-subtree"));
  for (const childSubtree of childSubtrees) {
    const childNode = subtreeGraphNode(childSubtree);
    if (!(childNode instanceof HTMLElement)) continue;

    const start = graphNodePoint(parentNode, forestRect, scale, "bottom");
    const end = graphNodePoint(childNode, forestRect, scale, "top");
    const midY = start.y + Math.max(18, (end.y - start.y) / 2);
    paths.push(`M ${roundGraphCoord(start.x)} ${roundGraphCoord(start.y)} V ${roundGraphCoord(midY)} H ${roundGraphCoord(end.x)} V ${roundGraphCoord(end.y)}`);
    drawSubtreeConnectors(childSubtree, forestRect, scale, paths);
  }
}

function subtreeGraphNode(subtree) {
  for (const child of subtree.children) {
    if (child.classList?.contains("emi-node")) return child;
    if (child.classList?.contains("emi-node-wrap")) {
      return child.querySelector(".emi-node");
    }
  }
  return null;
}

function graphNodePoint(node, forestRect, scale, edge) {
  const rect = node.getBoundingClientRect();
  return {
    x: (rect.left - forestRect.left + rect.width / 2) / scale,
    y: (rect.top - forestRect.top + (edge === "bottom" ? rect.height : 0)) / scale
  };
}

function roundGraphCoord(value) {
  return Math.round(value * 10) / 10;
}

function graphAmountText(amountPerMinute) {
  if (!Number.isFinite(amountPerMinute) || amountPerMinute <= 0) return "";
  return demandAmountText(amountPerMinute);
}

function demandAmountText(amountPerMinute) {
  if (!Number.isFinite(amountPerMinute) || amountPerMinute <= 0) return "";
  return state.treeView.showRates ? formatRate(amountPerMinute) : `x${formatAmount(amountPerMinute)}`;
}

function externalInputAmountText(row) {
  if (row?.reusable) return "x1 reusable";
  return demandAmountText(row?.amountPerMinute ?? 0);
}

function machinePlanRows(repository, machineRows) {
  const visibleRows = machineRows.slice(0, 12);

  if (!visibleRows.length) {
    return `<div class="empty-state">No timed machine recipes in this tree.</div>`;
  }

  return `
    ${visibleRows.map((row) => machinePlanRow(repository, row)).join("")}
    ${machineRows.length > visibleRows.length
      ? `<div class="machine-overflow">${machineRows.length - visibleRows.length} more machine groups in tree recipes.</div>`
      : ""}
  `;
}

function machinePlanRow(repository, row) {
  const name = machineName(row.machine, row.voltageTier);
  const typeNames = row.machine.recipeTypes.map((type) => repository.getRecipeType(type).name).join(", ");
  const load = machineLoadLabel(row.machineLoad, row.machineCount);
  const inferred = row.machine.inferred ? `<span class="machine-note">inferred family</span>` : "";

  return `
    <div class="machine-row">
      <div>
        <strong>${escapeHtml(name)}</strong>
        <span>${escapeHtml(typeNames)}</span>
        <span>${escapeHtml(load)}</span>
        ${inferred}
      </div>
      <strong>${formatAmount(row.machineCount)} x</strong>
    </div>
  `;
}

function machineName(machine, voltageTier, fallback = "Unknown machine") {
  if (!machine) return fallback;
  if (!voltageTier || machine.voltageTier) return machine.name;
  return `${voltageTier.name} ${machine.name}`;
}

function machineLoadLabel(load, count) {
  if (!load || !count) return "idle";
  return `${formatAmount(load)} equivalent load · ${formatAmount((load / count) * 100)}% utilized`;
}

function planCountText(count, singular) {
  return `${formatAmount(count)} ${singular}${count === 1 ? "" : "s"}`;
}

function visibleRate(amountPerMinute) {
  return state.treeView.showRates ? formatRate(amountPerMinute) : "";
}

function renderTreeViewControls() {
  elements.treeViewControls?.querySelectorAll("[data-option]").forEach((input) => {
    if (!(input instanceof HTMLInputElement)) return;
    const option = input.dataset.option;
    input.checked = Boolean(option && state.treeView[option]);
  });
}

function craftingTreeNode(repository, node, depth, externalGoods, nodeKey) {
  const hasChildren = node.children.length > 0;
  const type = node.recipe ? repository.getRecipeType(node.recipe.type) : null;
  const recipeKindClass = node.recipe
    ? isStructureRecipe(node.recipe)
      ? " tree-structure-node"
      : isCraftingRecipe(node.recipe)
        ? " tree-crafting"
        : " tree-machine-node"
    : "";
  const actions = treeActionButtons(repository, node, externalGoods);
  const doneClass = state.completedTreeGoods.has(node.goodsId) ? " tree-done" : "";
  const stateClass = ` tree-state-${escapeHtml(node.reason ?? (node.recipe ? "recipe" : "step"))}`;

  if (!hasChildren) {
    return `
      <div class="tree-node tree-leaf ${escapeHtml(node.reason ?? "external")}${doneClass}${stateClass}" data-goods-id="${escapeHtml(node.goodsId)}" data-node-key="${escapeHtml(nodeKey)}" style="--tree-depth:${depth}">
        <div class="tree-leaf-card">
          <span class="tree-step-marker">${treeNodeMarker(node)}</span>
          <div class="tree-node-header">
            ${goodChip(repository, node.goodsId, visibleRate(node.amountPerMinute))}
            <span class="tree-badge">${escapeHtml(treeReasonLabel(node.reason))}</span>
            ${actions}
          </div>
        </div>
      </div>
    `;
  }

  return `
    <details class="tree-node tree-recipe${recipeKindClass}${doneClass}${stateClass}" data-goods-id="${escapeHtml(node.goodsId)}" data-node-key="${escapeHtml(nodeKey)}" style="--tree-depth:${depth}"${treeOpenAttribute(node.goodsId)}>
      <summary class="tree-card-summary">
        <span class="tree-step-marker">${treeNodeMarker(node)}</span>
        <span class="tree-card-body">
          <span class="tree-node-header">
            <span class="tree-node-title">
              <span class="tree-step-label">${escapeHtml(depth ? "Step" : "Target")}</span>
              ${goodChip(repository, node.goodsId, visibleRate(node.amountPerMinute))}
            </span>
            <span class="tree-badge">${state.completedTreeGoods.has(node.goodsId) ? "done" : "planned"}</span>
            ${node.recipe?.durationTicks && !state.treeView.showRecipePreviews ? `<span class="tree-stat">${formatDuration(node.recipe.durationTicks)}</span>` : ""}
            ${node.recipe?.eut ? `<span class="tree-stat">${formatAverageEut(node.recipe, node.runsPerMinute)}</span>` : ""}
            ${actions}
          </span>
          ${node.recipe ? machineRequirementBanner(node, type) : ""}
          ${state.treeView.showRecipeChoices && node.recipe ? treeRecipeChoiceControl(repository, node, externalGoods, nodeKey) : ""}
          ${state.treeView.showRecipePreviews ? recipeVisual(repository, node.recipe, { compactMachineStage: true }) : ""}
          ${treeCostStrip(repository, node)}
        </span>
        ${state.treeView.showRates ? `<span class="tree-run-rate">${formatRate(node.runsPerMinute)} runs</span>` : ""}
      </summary>
      <div class="tree-children">
        ${node.children.map((child, index) => craftingTreeNode(repository, child, depth + 1, externalGoods, `${nodeKey}/${index}`)).join("")}
      </div>
    </details>
  `;
}

function treeNodeMarker(node) {
  if (state.completedTreeGoods.has(node.goodsId)) return "OK";
  if (node.reason === "collapsed") return "+";
  if (node.reason === "external") return "B";
  if (node.reason === "missing" || node.reason === "unresolved" || node.reason === "cycle" || node.reason === "depth") return "!";
  if (node.recipe && isStructureRecipe(node.recipe)) return "S";
  if (node.recipe && isCraftingRecipe(node.recipe)) return "C";
  return "M";
}

function treeOpenAttribute(goodsId) {
  return state.expandedTreeGoods.has(goodsId) ? " open" : "";
}

function machineRequirementBanner(node, type) {
  const { recipe } = node;
  if (isStructureRecipe(recipe)) {
    return `
      <span class="tree-machine-banner structure">
        <span>Structure build</span>
        <strong>${escapeHtml(recipe.structure?.name ?? type?.name ?? "Multiblock Structure")}</strong>
        <em>${escapeHtml(planCountText(recipe.inputs?.length ?? 0, "part type"))}</em>
      </span>
    `;
  }

  const crafting = isCraftingRecipe(recipe);
  const label = crafting ? "Crafting method" : "Machine required";
  const name = crafting
    ? (type?.name ?? "Recipe").replace(/^Crafting\s+/i, "")
    : machineName(node.machine, node.voltageTier, type?.name ?? "Recipe");
  const count = !crafting && node.machineCount > 0 ? `${formatAmount(node.machineCount)} x ` : "";
  const load = !crafting && node.machineLoad > 0 ? `${formatAmount(node.machineLoad)} load` : "";
  const note = [load, node.machine?.inferred ? "inferred family" : ""].filter(Boolean).join(" · ");
  return `
    <span class="tree-machine-banner ${crafting ? "crafting" : "machine"}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(count + name)}</strong>
      ${note ? `<em>${escapeHtml(note)}</em>` : ""}
    </span>
  `;
}

function treeRecipeChoiceControl(repository, node, externalGoods, nodeKey = "") {
  const recipes = repository.rankRecipesForOutput(node.goodsId);
  const goodName = repository.getGoodName(node.goodsId);
  const structure = structureForGood(node.goodsId);
  const isTarget = state.products.some((product) => product.goodsId === node.goodsId);
  const canTreatAsExternal = !isTarget;
  const selectedIsStructure = isStructureRecipe(node.recipe);

  if (recipes.length <= 1 && !canTreatAsExternal && !structure) return "";

  const selectedRecipeId = canTreatAsExternal && externalGoods.has(node.goodsId)
    ? EXTERNAL_RECIPE_VALUE
    : selectedIsStructure
      ? node.recipe.id
      : state.preferredRecipeByOutput[node.goodsId] ?? node.recipe.id;
  const structureSelected = Boolean(structure && (selectedIsStructure || selectedRecipeId === structure.id));
  const recipeOptions = recipes
    .map((candidate, index) => {
      const type = repository.getRecipeType(candidate.type);
      const label = `${index === 0 ? "Recommended · " : ""}${type.name} · ${candidate.id}`;
      const selected = candidate.id === selectedRecipeId ? " selected" : "";
      return `<option value="${escapeHtml(candidate.id)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");
  const externalSelected = selectedRecipeId === EXTERNAL_RECIPE_VALUE ? " selected" : "";
  const structureOption = structure
    ? `<option value="${STRUCTURE_RECIPE_VALUE}"${structureSelected ? " selected" : ""}>Multiblock Structure · ${escapeHtml(structure.name ?? goodName)}</option>`
    : "";
  const nodeKeyAttr = nodeKey ? ` data-node-key="${escapeHtml(nodeKey)}"` : "";
  const clearStructureAttr = selectedIsStructure ? ` data-clear-structure="true"` : "";

  return `
    <label class="tree-recipe-choice">
      <span>
        <strong>Recipe</strong>
      </span>
      <select data-action="choose-recipe" data-output-id="${escapeHtml(node.goodsId)}"${nodeKeyAttr}${clearStructureAttr} aria-label="Choose recipe for ${escapeHtml(goodName)}">
        ${canTreatAsExternal ? `<option value="${EXTERNAL_RECIPE_VALUE}"${externalSelected}>Treat as supplied</option>` : ""}
        ${structureOption}
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
      ${visibleChildren.map((child) => goodChip(repository, child.goodsId, visibleRate(child.amountPerMinute))).join("")}
      ${hiddenCount ? `<span class="tree-cost-more">+${formatAmount(hiddenCount)} more</span>` : ""}
    </span>
  `;
}

function treeActionButtons(repository, node, externalGoods) {
  const isTarget = state.products.some((product) => product.goodsId === node.goodsId);
  const isDone = state.completedTreeGoods.has(node.goodsId);
  const canMake = (node.reason === "external" || node.reason === "collapsed") && repository.findRecipesProducing(node.goodsId).length > 0;
  const canSupply = !isTarget && node.recipe && !externalGoods.has(node.goodsId);
  const canInspect = state.treeView.showInspectButtons && Boolean(repository.getGood(node.goodsId));

  if (!canMake && !canSupply && !canInspect && !node.goodsId) return "";

  return `
    <span class="tree-actions">
      ${canMake ? `<button class="secondary-button" data-action="make-input" data-id="${escapeHtml(node.goodsId)}">Make branch</button>` : ""}
      ${canSupply ? `<button class="secondary-button" data-action="supply-tree-good" data-id="${escapeHtml(node.goodsId)}">Supply</button>` : ""}
      <button class="secondary-button done-button${isDone ? " active" : ""}" data-action="toggle-done-step" data-id="${escapeHtml(node.goodsId)}">${isDone ? "Done" : "Mark done"}</button>
      ${canInspect ? `<button class="secondary-button" data-action="inspect-good" data-id="${escapeHtml(node.goodsId)}">Inspect</button>` : ""}
    </span>
  `;
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
    case "collapsed":
      return "expand";
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

function buildGuidePanel(repository, plan, externalGoods, readyRows = []) {
  const queue = intermediateQueuePanel(repository, readyRows, {
    limit: 6,
    className: "build-guide-queue",
    title: "Next up",
    subtitle: "Craft these first",
    description: readyRows.length
      ? "Mark items done on the graph or here; this advances toward the final build."
      : "Expand a branch or clear completed items to reveal the next craftable intermediate.",
    emptyText: "No next intermediate ready"
  });
  const baseCosts = plan.externalRows.length
    ? externalInputGroups(repository, plan.externalRows, externalGoods)
    : `<div class="empty-state">No unresolved inputs.</div>`;

  return `
    ${queue}
    <section class="guide-cost-section">
      <header class="guide-cost-header">
        <div>
          <span class="tracker-label">Remaining base cost</span>
          <strong>${escapeHtml(planCountText(plan.externalRows.length, "input"))}</strong>
        </div>
        <button class="secondary-button" type="button" data-action="clear-done-steps">Clear done</button>
      </header>
      ${baseCosts}
    </section>
  `;
}

function externalInputGroups(repository, rows, externalGoods) {
  const groupedRows = new Map(EXTERNAL_INPUT_GROUPS.map((group) => [group.id, []]));

  for (const row of rows) {
    groupedRows.get(getExternalInputGroupId(repository, row)).push(row);
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

function getExternalInputGroupId(repository, row) {
  if (row.reusable) return "tools";
  const goodsId = row.goodsId;
  const good = repository.getGood(goodsId);
  if (!good) return "unresolved";
  return getBoundaryPresetForGood(good)?.id ?? "other";
}

function externalInputRow(repository, row, externalGoods) {
  const canMake = externalGoods.has(row.goodsId) && repository.findRecipesProducing(row.goodsId).length > 0;
  const actions = goodActionButtons(repository, row.goodsId, { canMake });
  const amountText = externalInputAmountText(row);
  const stackText = row.reusable
    ? "reusable tool"
    : stackBreakdownText(repository, row.goodsId, row.amountPerMinute);
  const stackNote = stackText ? `<span class="external-stack-note">${escapeHtml(stackText)}</span>` : "";

  if (!actions) {
    return `
      <div class="external-input-row">
        ${goodChip(repository, row.goodsId, amountText)}
        ${stackNote}
      </div>
    `;
  }

  return `
    <div class="external-input-row">
      ${goodChip(repository, row.goodsId, amountText)}
      ${stackNote}
      ${actions}
    </div>
  `;
}

function recipeRow(repository, row, externalGoods) {
  const { recipe, runsPerMinute } = row;
  const type = repository.getRecipeType(recipe.type);
  const isStructure = isStructureRecipe(recipe);
  const outputs = recipe.outputs.map((output) => goodChip(repository, output.id, formatAmount(output.amount))).join("");
  const inputs = recipe.inputs.map((input) => ingredientChip(repository, input)).join("");
  const plannedOutputs = [...row.plannedOutputs.entries()].sort((a, b) => b[1] - a[1]);
  const recipeChoices = plannedOutputs
    .map(([goodsId, amountPerMinute]) => recipeChoiceControl(repository, goodsId, recipe.id, amountPerMinute, externalGoods))
    .join("");
  const machine = !isStructure && row.machineCount > 0
    ? `<span>${formatAmount(row.machineCount)} x ${escapeHtml(machineName(row.machine, row.voltageTier, type.name))}</span>`
    : "";
  const machineLoad = !isStructure && row.machineLoad > 0
    ? `<span>${escapeHtml(machineLoadLabel(row.machineLoad, row.machineCount))}</span>`
    : "";
  const structureMeta = isStructure ? `<span>structure checklist</span>` : "";
  const durationMeta = recipe.durationTicks ? `<span>${formatDuration(recipe.durationTicks)}</span>` : "";
  const eutMeta = recipe.eut ? `<span>${formatAmount(recipe.eut)} EU/t</span>` : "";
  const averageMeta = row.averageEut ? `<span>${formatAverageEut(recipe, runsPerMinute)}</span>` : "";

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
        ${structureMeta}
        ${machine}
        ${machineLoad}
        ${durationMeta}
        ${eutMeta}
        ${averageMeta}
      </div>
    </article>
  `;
}

function recipeChoiceControl(repository, goodsId, currentRecipeId, amountPerMinute, externalGoods) {
  const recipes = repository.rankRecipesForOutput(goodsId);
  const goodName = repository.getGoodName(goodsId);
  const structure = structureForGood(goodsId);
  const selectedRecipeId = externalGoods.has(goodsId)
    ? EXTERNAL_RECIPE_VALUE
    : state.preferredRecipeByOutput[goodsId] ?? currentRecipeId;
  const structureSelected = Boolean(structure && (selectedRecipeId === structure.id || state.structureTreeGoods.has(goodsId)));

  const recipeOptions = recipes
    .map((candidate, index) => {
      const type = repository.getRecipeType(candidate.type);
      const label = `${index === 0 ? "Recommended · " : ""}${type.name} · ${candidate.id}`;
      const selected = candidate.id === selectedRecipeId ? " selected" : "";
      return `<option value="${escapeHtml(candidate.id)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");
  const externalSelected = selectedRecipeId === EXTERNAL_RECIPE_VALUE ? " selected" : "";
  const structureOption = structure
    ? `<option value="${STRUCTURE_RECIPE_VALUE}"${structureSelected ? " selected" : ""}>Multiblock Structure · ${escapeHtml(structure.name ?? goodName)}</option>`
    : "";

  return `
    <label class="recipe-choice">
      <span>Recipe for ${goodChip(repository, goodsId, formatRate(amountPerMinute))}</span>
      <select data-action="choose-recipe" data-output-id="${escapeHtml(goodsId)}" aria-label="Choose recipe for ${escapeHtml(goodName)}">
        <option value="${EXTERNAL_RECIPE_VALUE}"${externalSelected}>Treat as external input</option>
        ${structureOption}
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
  const producedBy = repository.rankRecipesForOutput(good.id);
  const usedIn = repository.findRecipesUsing(good.id);
  const effectiveExternalGoods = getEffectiveExternalGoods(repository);
  const isExternal = effectiveExternalGoods.has(good.id);
  const boundary = getBoundaryPresetForGood(good);
  const preferredRecipeId = state.preferredRecipeByOutput[good.id];
  const recommendedRecipeId = producedBy[0]?.id;

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
        ? producedBy.slice(0, 8).map((recipe) => inspectorRecipeCard(repository, recipe, good.id, "produced", preferredRecipeId, recommendedRecipeId)).join("")
        : `<div class="empty-state">No producing recipe. This is a raw or supplied input.</div>`}
      ${producedBy.length > 8 ? `<p class="match-summary">Showing 8 of ${formatAmount(producedBy.length)} producing recipes.</p>` : ""}
    </section>

    <section class="inspector-section">
      <h2>Used in</h2>
      ${usedIn.length
        ? usedIn.slice(0, 8).map((recipe) => inspectorRecipeCard(repository, recipe, good.id, "used", null, null)).join("")
        : `<div class="empty-state">No exported recipes use this good.</div>`}
      ${usedIn.length > 8 ? `<p class="match-summary">Showing 8 of ${formatAmount(usedIn.length)} using recipes.</p>` : ""}
    </section>
  `;
}

function inspectorRecipeCard(repository, recipe, inspectedGoodsId, mode, preferredRecipeId, recommendedRecipeId) {
  const type = repository.getRecipeType(recipe.type);
  const outputs = recipe.outputs.map((output) => goodChip(repository, output.id, formatAmount(output.amount))).join("");
  const inputs = recipe.inputs.map((input) => ingredientChip(repository, input)).join("");
  const isPreferred = recipe.id === preferredRecipeId;
  const isRecommended = recipe.id === recommendedRecipeId;
  const firstOutput = recipe.outputs.find((output) => repository.getGood(output.id));
  const activeClass = isPreferred || isRecommended ? " active" : "";

  return `
    <article class="inspector-recipe-card${activeClass}">
      <header>
        <div>
          <strong>${escapeHtml(type.name)}</strong>
          <p>${escapeHtml(recipe.id)}</p>
        </div>
        ${isPreferred || isRecommended ? `<span class="preferred-pill">${isPreferred ? "preferred" : "recommended"}</span>` : ""}
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

function toggleDoneStep(goodsId) {
  if (!goodsId) return;
  state.treeContextMenu = null;
  if (state.completedTreeGoods.has(goodsId)) {
    state.completedTreeGoods.delete(goodsId);
  } else {
    state.completedTreeGoods.add(goodsId);
  }
  renderPlan({ preserveGraphViewport: true });
}

function clearDoneSteps() {
  state.treeContextMenu = null;
  state.completedTreeGoods.clear();
  renderPlan({ preserveGraphViewport: true });
}

function setTreeGoodsDone(goodsIds, done = true) {
  const ids = [...new Set(goodsIds.filter(Boolean))];
  if (!ids.length) return;

  for (const goodsId of ids) {
    if (done) {
      state.completedTreeGoods.add(goodsId);
    } else {
      state.completedTreeGoods.delete(goodsId);
    }
  }

  state.treeContextMenu = null;
  renderPlan({ preserveGraphViewport: true });
}

function setTreeBranchDone(goodsId, nodeKey = "", done = true) {
  const entry = treeEntryForContext(goodsId, nodeKey);
  const ids = entry?.node ? collectVisibleBranchGoods(entry.node) : new Set([goodsId]);

  for (const id of ids) {
    if (done) {
      state.completedTreeGoods.add(id);
    } else {
      state.completedTreeGoods.delete(id);
    }
  }

  state.treeContextMenu = null;
  renderPlan({ preserveGraphViewport: true });
}

function collapseTreeBranch(goodsId, nodeKey = "") {
  if (!goodsId || state.products.some((product) => product.goodsId === goodsId)) return;
  setGoodAsExternal(goodsId);
  state.selectedGoodsId = goodsId;
  state.selectedTreeGoodsId = null;
  state.selectedTreeNodeKey = null;
  state.treeContextMenu = null;
  renderBoundaryPresets();
  renderPlan({ preserveGraphViewport: true });
  renderInspector();
}

function closeTreePicker() {
  if (!state.selectedTreeGoodsId && !state.selectedTreeNodeKey) return;
  state.selectedTreeGoodsId = null;
  state.selectedTreeNodeKey = null;
  renderPlan();
}

function closeTreeContextMenu() {
  if (!state.treeContextMenu) return;
  state.treeContextMenu = null;
  renderTreeContextMenu();
}

function openTreeContextMenu(goodsId, nodeKey, x, y) {
  if (!goodsId) return;
  state.treeContextMenu = { goodsId, nodeKey: nodeKey ?? "", x, y };
  renderTreeContextMenu();
}

function focusTreeGood(goodsId) {
  if (!goodsId) return;
  const path = findTreePath(goodsId, state.currentPlan?.planTrees ?? []);

  for (const pathGoodsId of path.slice(0, -1)) {
    state.expandedTreeGoods.add(pathGoodsId);
  }

  state.selectedTreeGoodsId = goodsId;
  state.selectedTreeNodeKey = null;
  state.treeContextMenu = null;
  renderPlan();
  requestAnimationFrame(() => {
    if (state.treeView.showGraph) {
      positionRecipeGraph();
      return;
    }

    const node = elements.craftingTree.querySelector(`[data-goods-id="${cssEscape(goodsId)}"]`);
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

function workOnTreeStep(goodsId, nodeKey = "") {
  if (!goodsId) return;
  const entry = treeEntryForContext(goodsId, nodeKey);
  const selectedKey = entry?.key ?? nodeKey;
  const path = findTreePath(goodsId, state.currentPlan?.planTrees ?? []);

  for (const pathGoodsId of path.slice(0, -1)) {
    state.expandedTreeGoods.add(pathGoodsId);
  }

  state.selectedGoodsId = goodsId;
  state.selectedTreeGoodsId = goodsId;
  state.selectedTreeNodeKey = selectedKey || null;
  state.treeContextMenu = null;
  renderPlan();
  renderInspector();

  if (state.treeView.showGraph) return;

  requestAnimationFrame(() => {
    const selector = selectedKey
      ? `[data-node-key="${cssEscape(selectedKey)}"]`
      : `[data-goods-id="${cssEscape(goodsId)}"]`;
    const node = elements.craftingTree.querySelector(selector);
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

function findTreePath(goodsId, trees) {
  function visit(node, path) {
    const nextPath = [...path, node.goodsId];
    if (node.goodsId === goodsId) return nextPath;

    for (const child of node.children ?? []) {
      const childPath = visit(child, nextPath);
      if (childPath.length) return childPath;
    }

    return [];
  }

  for (const tree of trees) {
    const path = visit(tree, []);
    if (path.length) return path;
  }

  return [goodsId];
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
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

function multiblockStructuresUrlFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const value = params.get("structures");
  if (value === "none") return null;
  return value || DEFAULT_MULTIBLOCK_STRUCTURES_URL;
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

async function loadMultiblockStructures(url) {
  const structures = new Map();
  if (!url) return structures;

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return structures;
    const data = await response.json();
    if (data.schema !== "gtceu-planner-multiblock-structures-v1" || !Array.isArray(data.structures)) {
      console.warn(`Ignoring unsupported multiblock structure schema: ${data.schema}`);
      return structures;
    }

    for (const structure of data.structures) {
      if (!structure?.controller || !Array.isArray(structure.requirements)) continue;
      structures.set(structure.controller, structure);
    }
  } catch (error) {
    console.warn(`Could not load multiblock structures ${url}.`, error);
  }

  return structures;
}

function structureForGood(goodsId) {
  return state.multiblockStructures.get(goodsId) ?? null;
}

function applyDefaultStructureTargets() {
  for (const product of state.products) {
    if (structureForGood(product.goodsId)) {
      state.structureTreeGoods.add(product.goodsId);
    }
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
  setupRecipeGraphViewport();

  elements.productList.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.action !== "update-product") return;
    const index = Number(target.dataset.index);
    setProductRate(index, target.value);
  });

  elements.productList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const index = Number(target.dataset.index);

    if (target.dataset.action === "remove-product") {
      state.products.splice(index, 1);
      renderAll();
      return;
    }

    if (target.dataset.action === "adjust-product-rate") {
      event.preventDefault();
      const product = state.products[index];
      const direction = Number(target.dataset.direction) || 0;
      const step = targetRateStep(state.repository, product);
      const current = Number(product?.amountPerMinute) || 0;
      const next = direction > 0 && current < step ? step : current + direction * step;
      setProductRate(index, next, { renderControls: true });
      return;
    }

    if (target.dataset.action === "scale-product-rate") {
      event.preventDefault();
      const current = Number(state.products[index]?.amountPerMinute) || 0;
      const factor = Number(target.dataset.factor) || 1;
      setProductRate(index, current * factor, { renderControls: true });
      return;
    }

    if (target.dataset.action === "set-product-rate") {
      event.preventDefault();
      setProductRate(index, target.dataset.value, { renderControls: true });
    }
  });

  elements.craftingTree.addEventListener("toggle", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLDetailsElement) || !target.classList.contains("tree-recipe")) return;
    const goodsId = target.dataset.goodsId;
    if (!goodsId) return;

    if (target.open) {
      state.expandedTreeGoods.add(goodsId);
    } else {
      state.expandedTreeGoods.delete(goodsId);
    }
  }, true);

  elements.craftingTree.addEventListener("contextmenu", (event) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest(".emi-node, .tree-node");
    if (!(target instanceof HTMLElement)) return;
    const goodsId = target.dataset.id ?? target.dataset.goodsId;
    if (!goodsId) return;

    event.preventDefault();
    event.stopPropagation();
    openTreeContextMenu(goodsId, target.dataset.nodeKey ?? "", event.clientX, event.clientY);
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

    if (target.dataset.action === "clear-done-steps") {
      clearDoneSteps();
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || target.dataset.action !== "choose-recipe") return;
    const outputId = target.dataset.outputId;
    if (!outputId) return;

    if (target.value === EXTERNAL_RECIPE_VALUE) {
      setGoodAsExternal(outputId);
    } else if (target.value === STRUCTURE_RECIPE_VALUE) {
      useTreeStructure(outputId, {
        nodeKey: target.dataset.nodeKey ?? ""
      });
      return;
    } else {
      setGoodAsMade(outputId);
      if (target.dataset.clearStructure === "true") {
        state.structureTreeGoods.delete(outputId);
      }
      state.preferredRecipeByOutput[outputId] = target.value;
      state.selectedTreeNodeKey = target.dataset.nodeKey ?? state.selectedTreeNodeKey;
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

  elements.targetSearchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const firstMatch = targetBrowserMatches(state.repository)[0];
    if (!firstMatch) return;
    event.preventDefault();
    setSingleTarget(firstMatch.good.id);
    closeTargetBrowser();
    renderAll();
  });

  elements.targetSearchClear.addEventListener("click", () => {
    state.targetSearch = "";
    elements.targetSearchInput.value = "";
    renderTargetPicker();
  });

  elements.targetResults.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest("[data-action]");
    if (!(target instanceof HTMLElement)) return;
    const goodsId = target.dataset.id;
    if (!goodsId) return;

    if (target.dataset.action === "set-target") {
      event.preventDefault();
      setSingleTarget(goodsId);
      closeTargetBrowser();
      renderAll();
    }

    if (target.dataset.action === "add-target-card") {
      event.preventDefault();
      addTarget(goodsId);
      renderAll();
    }
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
    if (!(event.target instanceof Element)) return;
    const clickedInsideTreePicker = Boolean(event.target.closest(".tree-good-picker-window"));
    const clickedInsideTreeContext = Boolean(event.target.closest(".tree-context-menu"));
    const clickedInsideTargetBrowser = Boolean(event.target.closest(".target-browser-panel"));
    const target = event.target.closest("[data-action]");
    if (!(target instanceof HTMLElement)) {
      if (!clickedInsideTargetBrowser) {
        closeTargetBrowser();
      }
      if (!clickedInsideTreePicker) {
        closeTreePicker();
      }
      if (!clickedInsideTreeContext) {
        closeTreeContextMenu();
      }
      return;
    }

    const action = target.dataset.action;
    const goodsId = target.dataset.id;

    if (!clickedInsideTreeContext && state.treeContextMenu) {
      closeTreeContextMenu();
    }

    if (action === "open-target-browser") {
      event.preventDefault();
      event.stopPropagation();
      openTargetBrowser();
      return;
    }

    if (action === "close-target-browser") {
      event.preventDefault();
      event.stopPropagation();
      closeTargetBrowser();
      return;
    }

    if (action === "target-filter") {
      event.preventDefault();
      event.stopPropagation();
      state.targetFilter = target.dataset.filter ?? "all";
      renderTargetPicker();
      return;
    }

    if (action === "toggle-done-step" && goodsId) {
      event.preventDefault();
      event.stopPropagation();
      toggleDoneStep(goodsId);
      return;
    }

    if (action === "clear-done-steps") {
      event.preventDefault();
      event.stopPropagation();
      clearDoneSteps();
      return;
    }

    if (action === "mark-ready-intermediates-done") {
      event.preventDefault();
      event.stopPropagation();
      setTreeGoodsDone((target.dataset.ids ?? "").split(",").filter(Boolean), true);
      return;
    }

    if (action === "mark-tree-branch-done" && goodsId) {
      event.preventDefault();
      event.stopPropagation();
      setTreeBranchDone(goodsId, target.dataset.nodeKey ?? "", true);
      return;
    }

    if (action === "clear-tree-branch-done" && goodsId) {
      event.preventDefault();
      event.stopPropagation();
      setTreeBranchDone(goodsId, target.dataset.nodeKey ?? "", false);
      return;
    }

    if (action === "collapse-tree-branch" && goodsId) {
      event.preventDefault();
      event.stopPropagation();
      collapseTreeBranch(goodsId, target.dataset.nodeKey ?? "");
      return;
    }

    if (action === "close-tree-picker") {
      event.preventDefault();
      event.stopPropagation();
      closeTreePicker();
      return;
    }

    if (action === "recipe-graph-zoom-out") {
      event.preventDefault();
      event.stopPropagation();
      setRecipeGraphZoom(state.recipeGraph.zoom - 0.1);
      return;
    }

    if (action === "recipe-graph-zoom-in") {
      event.preventDefault();
      event.stopPropagation();
      setRecipeGraphZoom(state.recipeGraph.zoom + 0.1);
      return;
    }

    if (action === "recipe-graph-reset") {
      event.preventDefault();
      event.stopPropagation();
      setRecipeGraphZoom(1);
      positionRecipeGraph();
      return;
    }

    if (action === "focus-tree-good" && goodsId) {
      event.preventDefault();
      event.stopPropagation();
      focusTreeGood(goodsId);
      return;
    }

    if (action === "work-tree-step" && goodsId) {
      event.preventDefault();
      event.stopPropagation();
      workOnTreeStep(goodsId, target.dataset.nodeKey ?? "");
      return;
    }

    if (action === "supply-tree-good" && goodsId) {
      event.preventDefault();
      event.stopPropagation();
      setGoodAsExternal(goodsId);
      if (clickedInsideTreePicker) {
        state.selectedTreeGoodsId = null;
        state.selectedTreeNodeKey = null;
      } else {
        state.selectedTreeGoodsId = goodsId;
        state.selectedTreeNodeKey = target.dataset.nodeKey ?? state.selectedTreeNodeKey;
      }
      renderBoundaryPresets();
      renderPlan(clickedInsideTreePicker ? { preserveGraphViewport: true } : {});
      renderInspector();
      return;
    }

    if (action === "select-tree-good" && goodsId) {
      event.preventDefault();
      event.stopPropagation();
      selectTreeGood(goodsId, target.dataset.nodeKey ?? "");
      return;
    }

    if (action === "set-tree-target" && goodsId) {
      event.preventDefault();
      event.stopPropagation();
      setSingleTarget(goodsId);
      state.targetSearch = "";
      elements.targetSearchInput.value = "";
      closeTargetBrowser();
      renderAll();
      return;
    }

    if (action === "use-tree-recipe") {
      const outputId = target.dataset.outputId;
      const recipeId = target.dataset.recipeId;
      if (!outputId || !recipeId) return;
      event.preventDefault();
      event.stopPropagation();
      useTreeRecipe(outputId, recipeId, {
        nodeKey: target.dataset.nodeKey ?? "",
        clearStructure: target.dataset.clearStructure === "true",
        closePicker: clickedInsideTreePicker
      });
      return;
    }

    if (action === "use-tree-structure" && goodsId) {
      event.preventDefault();
      event.stopPropagation();
      useTreeStructure(goodsId, {
        nodeKey: target.dataset.nodeKey ?? "",
        closePicker: clickedInsideTreePicker
      });
      return;
    }

    if (action === "inspect-good" && goodsId) {
      event.preventDefault();
      event.stopPropagation();
      state.treeContextMenu = null;
      state.selectedGoodsId = goodsId;
      state.inspectorOpen = true;
      renderTreeContextMenu();
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
      event.stopPropagation();
      makeGoodInPlan(goodsId, {
        preserveGraphViewport: state.treeView.showGraph
      });
      return;
    }

    if (action === "inspector-set-target" && goodsId) {
      event.preventDefault();
      setSingleTarget(goodsId);
      state.targetSearch = "";
      elements.targetSearchInput.value = "";
      state.inspectorOpen = false;
      closeTargetBrowser();
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
      state.structureTreeGoods.delete(outputId);
      state.preferredRecipeByOutput[outputId] = recipeId;
      state.selectedGoodsId = outputId;
      renderBoundaryPresets();
      renderPlan();
      renderInspector();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !elements.targetBrowserPanel?.open) return;
    event.preventDefault();
    closeTargetBrowser();
  });
}

function setupRecipeGraphViewport() {
  let pan = null;

  function panTargetFromEvent(event) {
    if (!(event.target instanceof Element)) return null;
    const scroll = event.target.closest(".emi-tree-scroll");
    if (!(scroll instanceof HTMLElement)) return null;
    if (event.target.closest(".emi-node, button, input, select, textarea, a")) return null;
    return scroll;
  }

  function beginPan(event, pointerId) {
    const scroll = panTargetFromEvent(event);
    if (!scroll) return false;

    event.preventDefault();
    pan = {
      pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: scroll.scrollLeft,
      scrollTop: scroll.scrollTop,
      scroll
    };
    scroll.classList.add("panning");
    return true;
  }

  function movePan(event, pointerId) {
    if (!pan || pan.pointerId !== pointerId) return false;
    event.preventDefault();
    pan.scroll.scrollLeft = pan.scrollLeft - (event.clientX - pan.x);
    pan.scroll.scrollTop = pan.scrollTop - (event.clientY - pan.y);
    return true;
  }

  function endPan(pointerId) {
    if (!pan || pan.pointerId !== pointerId) return false;
    pan.scroll.classList.remove("panning");
    pan = null;
    return true;
  }

  elements.craftingTree.addEventListener("wheel", (event) => {
    if (!(event.target instanceof Element)) return;
    const scroll = event.target.closest(".emi-tree-scroll");
    if (!(scroll instanceof HTMLElement)) return;

    event.preventDefault();
    const rect = scroll.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const anchor = {
      offsetX,
      offsetY,
      contentX: (scroll.scrollLeft + offsetX) / state.recipeGraph.zoom,
      contentY: (scroll.scrollTop + offsetY) / state.recipeGraph.zoom
    };
    setRecipeGraphZoom(state.recipeGraph.zoom + (event.deltaY > 0 ? -0.1 : 0.1), anchor);
  }, { passive: false });

  window.addEventListener("resize", () => {
    if (state.treeView.showGraph) requestAnimationFrame(drawRecipeGraphConnectors);
  });

  elements.craftingTree.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (beginPan(event, event.pointerId)) {
      pan.scroll.setPointerCapture(event.pointerId);
    }
  });

  elements.craftingTree.addEventListener("pointermove", (event) => {
    movePan(event, event.pointerId);
  });

  for (const eventName of ["pointerup", "pointercancel"]) {
    elements.craftingTree.addEventListener(eventName, (event) => {
      endPan(event.pointerId);
    });
  }

  elements.craftingTree.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || pan) return;
    beginPan(event, "mouse");
  });

  window.addEventListener("mousemove", (event) => {
    movePan(event, "mouse");
  });

  window.addEventListener("mouseup", () => {
    endPan("mouse");
  });
}

function setTreeExpansion(open) {
  if (open) {
    const repository = state.repository;
    const fullPlan = createPlan(repository, state.products, {
      preferredRecipeByOutput: state.preferredRecipeByOutput,
      externalGoods: getEffectiveExternalGoods(repository),
      structureTargets: state.structureTreeGoods,
      structuresByController: state.multiblockStructures,
      discreteItems: !state.treeView.showRates,
      reusableTools: true
    });
    flattenPlanTrees(fullPlan.planTrees).forEach((entry) => {
      if (entry.node.goodsId) state.expandedTreeGoods.add(entry.node.goodsId);
    });
  } else {
    state.expandedTreeGoods.clear();
  }

  renderPlan();
}

async function main() {
  try {
    state.dataUrl = dataUrlFromLocation();
    state.repository = await loadRepository(state.dataUrl);
    state.textureAtlas = await loadTextureAtlas(textureAtlasUrlFromLocation());
    state.multiblockStructures = await loadMultiblockStructures(multiblockStructuresUrlFromLocation());
    state.products = chooseInitialProducts(state.repository);
    applyDefaultStructureTargets();
    state.selectedGoodsId = state.products[0]?.goodsId ?? null;
    state.selectedTreeGoodsId = null;
    state.selectedTreeNodeKey = null;
    const meta = state.repository.metadata;
    const packCounts = `${formatAmount(state.repository.goods.size)} goods / ${formatAmount(state.repository.recipes.length)} recipes / ${formatAmount(state.repository.machines.size)} machines`;
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
