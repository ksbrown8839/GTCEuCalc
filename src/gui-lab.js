import { escapeHtml } from "./format.js?v=machine-build-counts-2026-05-31";

const DEFAULT_MANIFEST_URL = "data/gui-assets.local.json";

const state = {
  manifest: null,
  assets: [],
  query: "",
  namespace: "all",
  scale: 2
};

const elements = {
  packName: document.querySelector("[data-role='gui-pack-name']"),
  packMeta: document.querySelector("[data-role='gui-pack-meta']"),
  search: document.querySelector("[data-role='gui-search']"),
  namespace: document.querySelector("[data-role='gui-namespace']"),
  scale: document.querySelector("[data-role='gui-scale']"),
  matchSummary: document.querySelector("[data-role='gui-match-summary']"),
  status: document.querySelector("[data-role='gui-status']"),
  grid: document.querySelector("[data-role='gui-grid']")
};

main().catch((error) => {
  console.error(error);
  elements.status.textContent = `Could not load GUI lab: ${error.message}`;
  elements.grid.innerHTML = `
    <div class="empty-state">
      Run <code>node tools/extract-gui-textures.mjs --instance "$INSTANCE"</code> to generate local GUI assets.
    </div>
  `;
});

async function main() {
  state.manifest = await loadManifest(manifestUrlFromLocation());
  state.assets = (state.manifest.assets ?? []).filter((asset) => asset.output?.endsWith(".png"));

  elements.packName.textContent = state.manifest.packName ?? "GUI assets";
  elements.packMeta.textContent = [
    state.manifest.packVersion,
    state.manifest.minecraftVersion ? `Minecraft ${state.manifest.minecraftVersion}` : "",
    `${state.assets.length.toLocaleString("en-US")} PNG assets`
  ].filter(Boolean).join(" / ");
  elements.status.textContent = `Loaded ${state.assets.length.toLocaleString("en-US")} extracted GUI textures.`;

  renderNamespaceOptions();
  setupEvents();
  render();
}

async function loadManifest(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Missing ${url}`);
  const manifest = await response.json();
  if (manifest.schema !== "gtceu-gui-assets-v1") throw new Error(`Unsupported GUI manifest schema: ${manifest.schema}`);
  return manifest;
}

function renderNamespaceOptions() {
  const namespaces = [...new Set(state.assets.map((asset) => asset.namespace).filter(Boolean))].sort();
  elements.namespace.innerHTML = [
    `<option value="all">All namespaces</option>`,
    ...namespaces.map((namespace) => `<option value="${escapeHtml(namespace)}">${escapeHtml(namespace)}</option>`)
  ].join("");
}

function setupEvents() {
  elements.search.addEventListener("input", () => {
    state.query = elements.search.value;
    render();
  });

  elements.namespace.addEventListener("change", () => {
    state.namespace = elements.namespace.value;
    render();
  });

  elements.scale.addEventListener("input", () => {
    state.scale = Number(elements.scale.value) || 2;
    document.documentElement.style.setProperty("--gui-scale", String(state.scale));
  });

  document.documentElement.style.setProperty("--gui-scale", String(state.scale));
}

function render() {
  const matches = filteredAssets();
  elements.matchSummary.textContent = `${matches.length.toLocaleString("en-US")} match${matches.length === 1 ? "" : "es"}`;
  elements.grid.innerHTML = matches.slice(0, 500).map(assetCard).join("");
}

function filteredAssets() {
  const terms = normalizeSearch(state.query).split(" ").filter(Boolean);
  return state.assets
    .filter((asset) => state.namespace === "all" || asset.namespace === state.namespace)
    .filter((asset) => {
      if (!terms.length) return true;
      const haystack = normalizeSearch(`${asset.id} ${asset.output} ${asset.sourcePath} ${asset.archive} ${asset.namespace}`);
      return terms.every((term) => haystack.includes(term));
    })
    .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.output.localeCompare(b.output));
}

function assetCard(asset) {
  const width = Number(asset.width) || 16;
  const height = Number(asset.height) || 16;
  return `
    <article class="gui-asset-card">
      <div class="gui-asset-preview-box">
        <img class="gui-asset-preview" src="${escapeHtml(asset.output)}" alt="" style="--gui-width:${width}px;--gui-height:${height}px">
      </div>
      <div class="gui-asset-meta">
        <strong title="${escapeHtml(asset.id)}">${escapeHtml(asset.id)}</strong>
        <span>${escapeHtml(`${width}x${height} / ${asset.namespace}`)}</span>
        <code title="${escapeHtml(asset.output)}">${escapeHtml(asset.output)}</code>
        <span title="${escapeHtml(asset.archive ?? "")}">${escapeHtml(asset.archive ?? "")}</span>
      </div>
    </article>
  `;
}

function manifestUrlFromLocation() {
  return new URLSearchParams(window.location.search).get("manifest") || DEFAULT_MANIFEST_URL;
}

function normalizeSearch(value) {
  return String(value).trim().toLowerCase().replace(/[_:/.-]+/g, " ").replace(/\s+/g, " ");
}
