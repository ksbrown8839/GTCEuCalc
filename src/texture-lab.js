import { escapeHtml } from "./format.js?v=texture-lab-2026-05-22b";
import { loadRepository } from "./repository.js?v=texture-lab-2026-05-22b";

const DEFAULT_DATA_URL = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_TEXTURE_ATLAS_URL = "data/texture-atlas.json";
const MAX_RESULTS = 240;

const elements = {
  packName: document.querySelector('[data-role="lab-pack-name"]'),
  packMeta: document.querySelector('[data-role="lab-pack-meta"]'),
  search: document.querySelector('[data-role="texture-search"]'),
  matchSummary: document.querySelector('[data-role="texture-match-summary"]'),
  size: document.querySelector('[data-role="texture-size"]'),
  sizeValue: document.querySelector('[data-role="texture-size-value"]'),
  atlasOnly: document.querySelector('[data-role="texture-atlas-only"]'),
  detail: document.querySelector('[data-role="texture-detail"]'),
  status: document.querySelector('[data-role="texture-status"]'),
  atlasSummary: document.querySelector('[data-role="texture-atlas-summary"]'),
  grid: document.querySelector('[data-role="texture-grid"]')
};

const state = {
  repository: null,
  goods: [],
  atlas: null,
  query: "",
  iconSize: 96,
  atlasOnly: true,
  selectedGoodsId: null
};

main().catch((error) => {
  console.error(error);
  elements.status.textContent = `Could not load texture lab: ${error.message}`;
});

async function main() {
  const [repository, atlas] = await Promise.all([
    loadRepository(dataUrlFromLocation()),
    loadTextureAtlas(textureAtlasUrlFromLocation())
  ]);

  state.repository = repository;
  state.goods = goodsListFromRepository(repository);
  state.atlas = atlas;

  const meta = repository.metadata;
  elements.packName.textContent = meta.packName ?? "GTCEu Modern";
  elements.packMeta.textContent = `${meta.packVersion ?? "unknown pack"} / Minecraft ${meta.minecraftVersion ?? "unknown"}`;

  if (atlas) {
    elements.atlasSummary.textContent = `${formatNumber(atlas.goodsWithIcons)} goods / ${formatNumber(atlas.iconCount)} tiles`;
    elements.status.textContent = `Loaded ${formatNumber(state.goods.length)} goods. Showing up to ${MAX_RESULTS} matches.`;
  } else {
    elements.atlasSummary.textContent = "No atlas loaded";
    elements.status.textContent = `Loaded ${formatNumber(state.goods.length)} goods. Atlas disabled or unavailable; showing fallback previews.`;
  }

  bindEvents();
  render();
}

function bindEvents() {
  elements.search.addEventListener("input", () => {
    state.query = elements.search.value;
    state.selectedGoodsId = null;
    render();
  });

  elements.size.addEventListener("input", () => {
    state.iconSize = Number(elements.size.value);
    elements.sizeValue.textContent = `${state.iconSize}px`;
    document.documentElement.style.setProperty("--texture-size", `${state.iconSize}px`);
  });

  elements.atlasOnly.addEventListener("change", () => {
    state.atlasOnly = elements.atlasOnly.checked;
    state.selectedGoodsId = null;
    render();
  });

  elements.grid.addEventListener("click", (event) => {
    const clicked = event.target;
    if (!(clicked instanceof Element)) return;
    const card = clicked.closest("[data-goods-id]");
    if (!(card instanceof HTMLElement)) return;
    state.selectedGoodsId = card.dataset.goodsId;
    render();
  });

  document.documentElement.style.setProperty("--texture-size", `${state.iconSize}px`);
}

function render() {
  const matches = filteredGoods();
  if (!state.selectedGoodsId && matches.length) state.selectedGoodsId = matches[0].id;

  elements.matchSummary.textContent = `${formatNumber(matches.length)} match${matches.length === 1 ? "" : "es"}${matches.length > MAX_RESULTS ? ` / showing first ${MAX_RESULTS}` : ""}`;
  elements.grid.innerHTML = matches.slice(0, MAX_RESULTS).map((good) => textureCardMarkup(good)).join("");
  renderDetail();
}

function filteredGoods() {
  const query = normalizeSearch(state.query);
  const terms = query.split(" ").filter(Boolean);

  return state.goods
    .filter((good) => !state.atlasOnly || hasAtlasIcon(good.id))
    .filter((good) => {
      if (!terms.length) return true;
      const haystack = normalizeSearch(`${good.id} ${good.name ?? ""} ${good.kind ?? ""} ${good.mod ?? ""}`);
      return terms.every((term) => haystack.includes(term));
    })
    .sort((a, b) => scoreGood(b, terms) - scoreGood(a, terms) || a.name.localeCompare(b.name));
}

function goodsListFromRepository(repository) {
  if (repository.goods instanceof Map) return [...repository.goods.values()];
  if (Array.isArray(repository.goods)) return repository.goods;
  if (Array.isArray(repository.data?.goods)) return repository.data.goods;
  return [];
}

function scoreGood(good, terms) {
  if (!terms.length) return hasAtlasIcon(good.id) ? 1 : 0;
  const name = normalizeSearch(good.name ?? "");
  const id = normalizeSearch(good.id);
  const mod = normalizeSearch(good.mod ?? "");
  let score = hasAtlasIcon(good.id) ? 10 : 0;
  for (const term of terms) {
    if (name === term || id === term) score += 200;
    else if (name.startsWith(term)) score += 90;
    else if (id.includes(`:${term}`)) score += 70;
    else if (name.includes(term)) score += 40;
    else if (id.includes(term)) score += 20;
    else if (mod.includes(term)) score += 10;
  }
  return score;
}

function textureCardMarkup(good) {
  const selected = good.id === state.selectedGoodsId ? " selected" : "";
  return `
    <button class="texture-card${selected}" type="button" data-goods-id="${escapeHtml(good.id)}">
      <span class="texture-preview-box">
        ${texturePreviewMarkup(good.id, "texture-preview", state.iconSize)}
      </span>
      <span class="texture-card-title">
        <strong title="${escapeHtml(good.name)}">${escapeHtml(good.name)}</strong>
        <span>${escapeHtml(good.id)}</span>
      </span>
    </button>
  `;
}

function renderDetail() {
  const good = state.selectedGoodsId ? state.repository.getGood(state.selectedGoodsId) : null;
  if (!good) {
    elements.detail.innerHTML = `
      <h2>Selected Texture</h2>
      <p class="empty-state">Select a texture to inspect it.</p>
    `;
    return;
  }

  const iconId = state.atlas?.icons?.[good.id];
  const atlasMeta = iconId === undefined
    ? "No atlas tile"
    : `Tile ${iconId} / row ${Math.floor(iconId / state.atlas.columns)} / column ${iconId % state.atlas.columns}`;

  elements.detail.innerHTML = `
    <h2>Selected Texture</h2>
    <div class="texture-detail-card">
      <div class="texture-detail-header">
        <strong title="${escapeHtml(good.name)}">${escapeHtml(good.name)}</strong>
        <span>${escapeHtml(good.kind ?? "item")}</span>
      </div>
      <div class="texture-detail-preview">
        ${texturePreviewMarkup(good.id, "texture-preview", 192)}
      </div>
      <div class="texture-detail-meta">
        <span>ID</span>
        <code>${escapeHtml(good.id)}</code>
        <span>Atlas</span>
        <code>${escapeHtml(atlasMeta)}</code>
        <span>Color fallback</span>
        <code>${escapeHtml(good.color ?? "none")}</code>
      </div>
    </div>
  `;
}

function texturePreviewMarkup(goodsId, className, displaySize) {
  const atlas = state.atlas;
  const animation = atlas?.animations?.[goodsId];
  if (animation) {
    const style = animatedStyle(animation, displaySize);
    return `<span class="${className} animated-texture" style="${style}" aria-hidden="true"></span>`;
  }

  const iconId = atlas?.icons?.[goodsId];
  if (!atlas || iconId === undefined) {
    const good = state.repository?.getGood(goodsId);
    return `<span class="${className} missing" style="--swatch:${escapeHtml(good?.color ?? "#7d8790")}">${escapeHtml(slotInitials(good?.name ?? goodsId))}</span>`;
  }

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

function animatedStyle(animation, displaySize) {
  const frames = Math.max(1, Number(animation.frames ?? animation.steps ?? 1));
  const visibleTransitions = Math.max(1, frames - 1);
  const steps = Math.max(1, Number(animation.steps ?? visibleTransitions));
  return [
    `--animation-url:url(${escapeHtml(animation.image)})`,
    `--animation-width:${displaySize}px`,
    `--animation-distance:${-(visibleTransitions * displaySize)}px`,
    `--animation-duration:${Math.max(80, Number(animation.durationMs ?? frames * 100))}ms`,
    `--animation-steps:${steps}`
  ].join(";");
}

function slotInitials(label) {
  return String(label)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("") || "?";
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

function hasAtlasIcon(goodsId) {
  return state.atlas?.icons?.[goodsId] !== undefined;
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

function normalizeSearch(value) {
  return String(value).trim().toLowerCase().replace(/[_:-]+/g, " ").replace(/\s+/g, " ");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}
