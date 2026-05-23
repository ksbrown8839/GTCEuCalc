const DEFAULT_DATA_URL = "data/gtceu-modern-pack-1.14.5.json";

const checkbox = document.querySelector('[data-role="texture-fluids-only"]');
const search = document.querySelector('[data-role="texture-search"]');
const grid = document.querySelector('[data-role="texture-grid"]');
const matchSummary = document.querySelector('[data-role="texture-match-summary"]');
const fluidIds = new Set();

let savedQuery = "";
let ready = false;

loadFluidIds().then(() => {
  ready = true;
  applyFluidFilter();
});

checkbox?.addEventListener("change", () => {
  if (!search) return;

  if (checkbox.checked) {
    savedQuery = search.value;
    search.value = withFluidTerm(search.value);
  } else {
    search.value = savedQuery;
  }

  search.dispatchEvent(new Event("input", { bubbles: true }));
  queueApplyFluidFilter();
});

search?.addEventListener("input", () => {
  if (!checkbox?.checked) return;
  if (!hasFluidTerm(search.value)) {
    search.value = withFluidTerm(search.value);
  }
  queueApplyFluidFilter();
});

if (grid) {
  new MutationObserver(queueApplyFluidFilter).observe(grid, { childList: true });
}

async function loadFluidIds() {
  const response = await fetch(dataUrlFromLocation(), { cache: "no-store" });
  if (!response.ok) return;

  const data = await response.json();
  for (const good of data.goods ?? []) {
    if (good.kind === "fluid") fluidIds.add(good.id);
  }
}

function queueApplyFluidFilter() {
  window.requestAnimationFrame(applyFluidFilter);
}

function applyFluidFilter() {
  if (!ready || !checkbox?.checked || !grid) return;

  let visible = 0;
  for (const card of grid.querySelectorAll("[data-goods-id]")) {
    const isFluid = fluidIds.has(card.dataset.goodsId ?? "");
    card.hidden = !isFluid;
    if (isFluid) visible += 1;
  }

  if (matchSummary) {
    matchSummary.textContent = `${visible.toLocaleString("en-US")} fluid match${visible === 1 ? "" : "es"}`;
  }
}

function withFluidTerm(value) {
  const trimmed = value.trim();
  if (hasFluidTerm(trimmed)) return trimmed;
  return trimmed ? `fluid ${trimmed}` : "fluid";
}

function hasFluidTerm(value) {
  return normalizeSearch(value).split(" ").includes("fluid");
}

function normalizeSearch(value) {
  return String(value).trim().toLowerCase().replace(/[_:-]+/g, " ").replace(/\s+/g, " ");
}

function dataUrlFromLocation() {
  const params = new URLSearchParams(window.location.search);
  return params.get("data") || DEFAULT_DATA_URL;
}
