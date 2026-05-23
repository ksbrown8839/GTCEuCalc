const DEFAULT_DATA_URL = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_TEXTURE_ATLAS_URL = "data/texture-atlas.json";

const checkbox = document.querySelector('[data-role="texture-fluids-only"]');
const search = document.querySelector('[data-role="texture-search"]');
const atlasOnly = document.querySelector('[data-role="texture-atlas-only"]');
const grid = document.querySelector('[data-role="texture-grid"]');
const matchSummary = document.querySelector('[data-role="texture-match-summary"]');

let fluidGoods = [];
let atlas = null;
let ready = false;

Promise.all([loadFluidGoods(), loadTextureAtlas()]).then(([goods, loadedAtlas]) => {
  fluidGoods = goods;
  atlas = loadedAtlas;
  ready = true;
  renderFluidGridIfEnabled();
});

checkbox?.addEventListener("change", () => {
  if (checkbox.checked) {
    renderFluidGridIfEnabled();
  } else {
    rerenderDefaultGrid();
  }
});

search?.addEventListener("input", () => {
  renderFluidGridIfEnabled();
});

atlasOnly?.addEventListener("change", () => {
  renderFluidGridIfEnabled();
});

async function loadFluidGoods() {
  const response = await fetch(dataUrlFromLocation(), { cache: "no-store" });
  if (!response.ok) return [];

  const data = await response.json();
  return (data.goods ?? []).filter((good) => good.kind === "fluid");
}

async function loadTextureAtlas() {
  const url = textureAtlasUrlFromLocation();
  if (!url) return null;

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    const loadedAtlas = await response.json();
    return loadedAtlas.schema === "gtceu-planner-texture-atlas-v1" ? loadedAtlas : null;
  } catch {
    return null;
  }
}

function renderFluidGridIfEnabled() {
  if (!ready || !checkbox?.checked || !grid) return;

  const terms = normalizeSearch(search?.value ?? "").split(" ").filter(Boolean);
  const matches = fluidGoods
    .filter((good) => !atlasOnly?.checked || hasAtlasIcon(good.id))
    .filter((good) => matchesTerms(good, terms))
    .sort((a, b) => scoreGood(b, terms) - scoreGood(a, terms) || String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)));

  grid.innerHTML = matches.map((good) => fluidCardMarkup(good)).join("");

  if (matchSummary) {
    matchSummary.textContent = `${matches.length.toLocaleString("en-US")} fluid match${matches.length === 1 ? "" : "es"}`;
  }
}

function rerenderDefaultGrid() {
  if (!search) return;
  search.dispatchEvent(new Event("input", { bubbles: true }));
}

function matchesTerms(good, terms) {
  if (!terms.length) return true;
  const haystack = normalizeSearch(`${good.id} ${good.name ?? ""} ${good.mod ?? ""}`);
  return terms.every((term) => haystack.includes(term));
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

function fluidCardMarkup(good) {
  return `
    <button class="texture-card" type="button" data-goods-id="${escapeHtml(good.id)}">
      <span class="texture-preview-box">
        ${texturePreviewMarkup(good)}
      </span>
      <span class="texture-card-title">
        <strong title="${escapeHtml(good.name ?? good.id)}">${escapeHtml(good.name ?? good.id)}</strong>
        <span>${escapeHtml(good.id)}</span>
      </span>
    </button>
  `;
}

function texturePreviewMarkup(good) {
  const iconId = atlas?.icons?.[good.id];
  if (!atlas || iconId === undefined) {
    return `<span class="texture-preview missing" style="--swatch:${escapeHtml(good.color ?? "#7d8790")}">${escapeHtml(slotInitials(good.name ?? good.id))}</span>`;
  }

  const displaySize = Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue("--texture-size"), 10) || 96;
  const column = iconId % atlas.columns;
  const row = Math.floor(iconId / atlas.columns);
  const style = [
    `--atlas-url:url(${escapeHtml(atlas.image)})`,
    `--atlas-x:${-(column * displaySize)}px`,
    `--atlas-y:${-(row * displaySize)}px`,
    `--atlas-width:${atlas.columns * displaySize}px`
  ].join(";");

  return `<span class="texture-preview" style="${style}" aria-hidden="true"></span>`;
}

function hasAtlasIcon(goodsId) {
  return atlas?.icons?.[goodsId] !== undefined;
}

function slotInitials(label) {
  return String(label)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("") || "?";
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
