import { loadRepository } from "./repository.js?v=default-recipe-ranking-2026-05-31";
import { buildOreRoute, classifyOreRouteIngredient, getOreRouteMaterials } from "./ore-routes-model.js?v=ore-route-explorer-2026-05-31";
import { escapeHtml, formatAmount, formatDuration } from "./format.js?v=machine-build-counts-2026-05-31";

const DEFAULT_DATA_URL = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_TEXTURE_ATLAS_URL = "data/texture-atlas.json";

const state = {
  repository: null,
  textureAtlas: null,
  materials: [],
  search: "",
  selectedMaterial: "iron"
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
  stageRail: document.querySelector("[data-role='ore-stage-rail']"),
  routeGroups: document.querySelector("[data-role='ore-route-groups']")
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
  const route = buildOreRoute(state.repository, state.selectedMaterial);
  elements.title.textContent = `${route.name} Ore Processing`;
  elements.summary.textContent = `${formatAmount(route.groups.length)} branch groups · ${formatAmount(route.stages.length)} exported stages`;
  elements.count.textContent = `${formatAmount(route.steps.length)} recipes`;
  elements.stageRail.innerHTML = route.stages.length
    ? route.stages.map((stage, index) => stageCard(stage, index < route.stages.length - 1)).join("")
    : `<div class="empty-state">No ore-processing stages found for ${escapeHtml(route.name)}.</div>`;
  elements.routeGroups.innerHTML = route.groups.length
    ? route.groups.map((group, index) => routeGroup(route, group, index)).join("")
    : `<div class="empty-state">No ore-processing branches found for ${escapeHtml(route.name)}.</div>`;
}

function stageCard(stage, showArrow) {
  return `
    <div class="ore-stage-card">
      <div class="ore-stage-icons">
        ${stage.examples.slice(0, 2).map((id) => goodsSlot(id)).join("")}
      </div>
      <strong>${escapeHtml(stage.label)}</strong>
    </div>
    ${showArrow ? `<span class="ore-stage-arrow" aria-hidden="true"></span>` : ""}
  `;
}

function routeGroup(route, group, index) {
  const open = index > 0 && group.steps.length <= 8 ? " open" : "";
  return `
    <details class="ore-route-group" data-route-group="${escapeHtml(group.id)}"${open}>
      <summary>
        <span class="ore-route-group-title">
          <strong>${escapeHtml(group.label)}</strong>
          <span>${escapeHtml(group.note)}</span>
        </span>
        <span class="ore-route-group-count">${formatAmount(group.steps.length)} recipes</span>
      </summary>
      <div class="ore-route-card-list">
        ${group.steps.map((step) => recipeCard(route, step)).join("")}
      </div>
    </details>
  `;
}

function recipeCard(route, step) {
  const recipe = step.recipe;
  const type = state.repository.getRecipeType(recipe.type);
  const machine = state.repository.chooseMachineForRecipe(recipe).machine;
  const machineName = machine?.name ?? type.name;
  const meta = [
    recipe.durationTicks ? formatDuration(recipe.durationTicks) : "instant",
    recipe.eut ? `${formatAmount(recipe.eut)} EU/t` : "",
    `${escapeHtml(step.inputStage)} → ${escapeHtml(step.outputStage)}`
  ].filter(Boolean);

  return `
    <article class="ore-recipe-card">
      <header class="ore-recipe-header">
        <div>
          <strong>${escapeHtml(type.name)}</strong>
          <p>${escapeHtml(recipe.id)}</p>
        </div>
        <span class="ore-recipe-stage">${escapeHtml(step.inputStage)} → ${escapeHtml(step.outputStage)}</span>
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
        ${meta.map((item) => `<span>${item}</span>`).join("")}
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
    <span class="recipe-slot ${escapeHtml(kind)}" ${tooltipAttrs({
      name,
      id: goodsId,
      amountText,
      detail
    })}>
      ${icon}
      ${amountText ? `<strong class="slot-amount">${escapeHtml(amountText)}</strong>` : ""}
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

function tooltipAttrs({ name, id, amountText = "", detail = "" }) {
  return [
    "data-mc-tooltip",
    `data-tooltip-name="${escapeHtml(name)}"`,
    `data-tooltip-id="${escapeHtml(id)}"`,
    amountText ? `data-tooltip-amount="${escapeHtml(amountText)}"` : "",
    detail ? `data-tooltip-detail="${escapeHtml(detail)}"` : ""
  ].filter(Boolean).join(" ");
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
    renderAll();
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("[data-action]");
    if (!(button instanceof HTMLButtonElement)) return;
    const open = button.dataset.action === "expand-routes";
    if (!open && button.dataset.action !== "collapse-routes") return;
    document.querySelectorAll("details.ore-route-group").forEach((group) => {
      group.open = open;
    });
  });

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
