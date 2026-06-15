import { formatAmount, formatRate, escapeHtml } from "./format.js?v=machine-build-counts-2026-05-31";
import { loadRepository } from "./repository.js?v=process-coproduct-routes-2026-06-09";

const DEFAULT_DATA_URL = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_TEXTURE_ATLAS_URL = "data/texture-atlas.json";
const STORAGE_KEY = "gtceu-manual-line-v1";
const SEARCH_LIMIT = 16;
const NODE_SIZE = {
  input: { width: 128, height: 82 },
  intermediate: { width: 128, height: 82 },
  output: { width: 128, height: 82 },
  machine: { width: 150, height: 92 },
  note: { width: 170, height: 78 }
};

const state = {
  repository: null,
  textureAtlas: null,
  dataUrl: DEFAULT_DATA_URL,
  title: "Manual Production Line",
  goodSearch: "",
  machineSearch: "",
  nodes: [],
  edges: [],
  selectedNodeId: null,
  selectedEdgeId: null,
  linkMode: false,
  linkSourceId: null,
  draftWire: null,
  quickAdd: {
    open: false,
    x: 0,
    y: 0,
    query: "",
    pendingFromId: null
  },
  zoom: 1,
  nextNodeId: 1,
  nextEdgeId: 1
};

const elements = {
  packName: document.querySelector("[data-role='manual-pack-name']"),
  packMeta: document.querySelector("[data-role='manual-pack-meta']"),
  goodSearch: document.querySelector("[data-role='manual-good-search']"),
  goodSummary: document.querySelector("[data-role='manual-good-summary']"),
  goodResults: document.querySelector("[data-role='manual-good-results']"),
  machineSearch: document.querySelector("[data-role='manual-machine-search']"),
  machineSummary: document.querySelector("[data-role='manual-machine-summary']"),
  machineResults: document.querySelector("[data-role='manual-machine-results']"),
  modeNote: document.querySelector("[data-role='manual-mode-note']"),
  title: document.querySelector("[data-role='manual-title']"),
  summary: document.querySelector("[data-role='manual-summary']"),
  power: document.querySelector("[data-role='manual-power']"),
  audit: document.querySelector("[data-role='manual-audit']"),
  frame: document.querySelector("[data-role='manual-frame']"),
  track: document.querySelector("[data-role='manual-track']"),
  canvas: document.querySelector("[data-role='manual-canvas']"),
  quickAdd: document.querySelector("[data-role='manual-quick-add']"),
  zoom: document.querySelector("[data-role='manual-zoom']"),
  inspector: document.querySelector("[data-role='manual-inspector']"),
  rateSheet: document.querySelector("[data-role='manual-rate-sheet']")
};

async function main() {
  try {
    state.dataUrl = dataUrlFromLocation();
    state.repository = await loadRepository(state.dataUrl);
    state.textureAtlas = await loadTextureAtlas(textureAtlasUrlFromLocation());
    const meta = state.repository.metadata;
    const packCounts = `${formatAmount(state.repository.goods.size)} goods / ${formatAmount(state.repository.recipes.length)} recipes`;
    elements.packName.textContent = meta.packName;
    elements.packMeta.textContent = `${meta.packVersion} / Minecraft ${meta.minecraftVersion} / ${packCounts}`;
    setupEvents();
    seedExample();
    renderAll();
  } catch (error) {
    elements.summary.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
    console.error(error);
  }
}

function dataUrlFromLocation() {
  return new URLSearchParams(window.location.search).get("data") || DEFAULT_DATA_URL;
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

function seedExample() {
  state.nextNodeId = 1;
  state.nextEdgeId = 1;
  state.title = "Diesel Line Sketch";
  state.nodes = [
    createGoodNode("gtceu:light_fuel", "input", 48_000, 60, 110),
    createGoodNode("gtceu:heavy_fuel", "input", 12_000, 60, 280),
    createMachineNode("gtceu:large_chemical_reactor", "Large Chemical Reactor", 2, 512, 340, 170),
    createGoodNode("gtceu:diesel", "output", 60_000, 660, 190)
  ];
  state.edges = [
    createEdge(state.nodes[0].id, state.nodes[2].id, 48_000),
    createEdge(state.nodes[1].id, state.nodes[2].id, 12_000),
    createEdge(state.nodes[2].id, state.nodes[3].id, 60_000)
  ];
}

function renderAll() {
  renderSearches();
  renderSummary();
  renderCanvas();
  renderQuickAdd();
  renderInspector();
  renderRateSheet();
}

function renderSearches() {
  const goods = goodsMatches();
  elements.goodResults.innerHTML = goods.length
    ? goods.map(goodSearchCard).join("")
    : `<div class="empty-state">No matching goods.</div>`;
  elements.goodSummary.textContent = state.goodSearch.trim()
    ? `${formatAmount(goods.length)} goods shown`
    : "Search pack items and fluids.";

  const machines = machineMatches();
  elements.machineResults.innerHTML = machines.length
    ? machines.map(machineSearchCard).join("")
    : `<div class="empty-state">No matching machines.</div>`;
  elements.machineSummary.textContent = state.machineSearch.trim()
    ? `${formatAmount(machines.length)} process blocks shown`
    : "Search GTCEu process blocks.";
}

function goodsMatches() {
  const query = state.goodSearch.trim();
  const goods = query
    ? state.repository.searchGoods(query, SEARCH_LIMIT)
    : ["gtceu:diesel", "gtceu:light_fuel", "gtceu:heavy_fuel", "gtceu:uranium_235_dust", "gtceu:uranium_dust", "gtceu:oxygen"]
      .map((id) => state.repository.getGood(id))
      .filter(Boolean);
  return goods.slice(0, SEARCH_LIMIT);
}

function machineMatches() {
  const query = state.machineSearch.trim().toLowerCase();
  const machines = [...state.repository.machines.values()]
    .filter((machine) => {
      if (!query) return /chemical_reactor|distillery|mixer|electrolyzer|centrifuge|macerator|assembler/i.test(machine.id);
      return `${machine.id} ${machine.name}`.toLowerCase().includes(query);
    })
    .sort((a, b) => machineSortName(a).localeCompare(machineSortName(b)))
    .slice(0, SEARCH_LIMIT);
  return machines;
}

function goodSearchCard(good) {
  return `
    <article class="manual-search-card">
      <strong>${escapeHtml(good.name)}</strong>
      <span>${escapeHtml(good.kind)} / ${escapeHtml(good.id)}</span>
      <div class="manual-search-actions">
        <button class="secondary-button" type="button" data-action="manual-add-good" data-role-kind="input" data-id="${escapeHtml(good.id)}">Source</button>
        <button class="secondary-button" type="button" data-action="manual-add-good" data-role-kind="intermediate" data-id="${escapeHtml(good.id)}">Buffer</button>
        <button class="secondary-button" type="button" data-action="manual-add-good" data-role-kind="output" data-id="${escapeHtml(good.id)}">Sink</button>
      </div>
    </article>
  `;
}

function machineSearchCard(machine) {
  const recipeTypes = (machine.recipeTypes ?? []).slice(0, 3).map((type) => state.repository.getRecipeType(type).name).join(", ");
  return `
    <article class="manual-search-card">
      <strong>${escapeHtml(machine.name)}</strong>
      <span>${escapeHtml(recipeTypes || machine.id)}</span>
      <div class="manual-search-actions">
        <button class="secondary-button" type="button" data-action="manual-add-machine" data-id="${escapeHtml(machine.id)}">Add Process</button>
      </div>
    </article>
  `;
}

function renderSummary() {
  const audit = buildAudit();
  elements.title.textContent = state.title;
  elements.summary.textContent = `${formatAmount(state.nodes.length)} blocks / ${formatAmount(state.edges.length)} signals / ${formatAmount(audit.machineCount)} processes`;
  elements.power.textContent = `${formatAmount(audit.totalEut)} EU/t`;
  elements.audit.innerHTML = `
    <div class="manual-audit-grid">
      ${auditCard("Source Flow", formatRate(audit.inputRate), "Total rate on source blocks.")}
      ${auditCard("Sink Flow", formatRate(audit.outputRate), "Total rate on sink blocks.")}
      ${auditCard("Processes", formatAmount(audit.machineCount), "Manual process count.")}
      ${auditCard("Power", `${formatAmount(audit.totalEut)} EU/t`, "Manual EU/t draw.")}
    </div>
    <article class="manual-balance-card${audit.mainWarning ? " warning" : ""}">
      <span>Signal check</span>
      <strong>${escapeHtml(audit.mainWarning?.title ?? "No obvious mismatch")}</strong>
      <em>${escapeHtml(audit.mainWarning?.detail ?? "Signals are manually entered; use this as a scratchpad, then compare against in-game behavior.")}</em>
    </article>
  `;
}

function auditCard(label, value, note) {
  return `
    <article class="manual-audit-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <em>${escapeHtml(note)}</em>
    </article>
  `;
}

function buildAudit() {
  const inputRate = state.nodes
    .filter((node) => node.type === "input")
    .reduce((sum, node) => sum + numberValue(node.rate), 0);
  const outputRate = state.nodes
    .filter((node) => node.type === "output")
    .reduce((sum, node) => sum + numberValue(node.rate), 0);
  const machineCount = state.nodes
    .filter((node) => node.type === "machine")
    .reduce((sum, node) => sum + numberValue(node.machines), 0);
  const totalEut = state.nodes
    .filter((node) => node.type === "machine")
    .reduce((sum, node) => sum + numberValue(node.eut) * Math.max(1, numberValue(node.machines)), 0);
  const mainWarning = balanceRows()
    .filter((row) => row.warning)
    .sort((a, b) => b.delta - a.delta)[0] ?? null;
  return { inputRate, outputRate, machineCount, totalEut, mainWarning };
}

function renderCanvas() {
  const bounds = graphBounds();
  elements.canvas.style.width = `${bounds.width}px`;
  elements.canvas.style.height = `${bounds.height}px`;
  elements.canvas.style.transform = `scale(${state.zoom})`;
  elements.track.style.width = `${Math.ceil(bounds.width * state.zoom)}px`;
  elements.track.style.height = `${Math.ceil(bounds.height * state.zoom)}px`;
  elements.zoom.value = String(state.zoom);
  elements.canvas.innerHTML = `
    <svg class="manual-connectors" viewBox="0 0 ${bounds.width} ${bounds.height}" style="width:${bounds.width}px;height:${bounds.height}px" aria-hidden="true">
      ${connectorDefs()}
      ${state.edges.map(edgeMarkup).join("")}
      ${draftWireMarkup()}
    </svg>
    ${state.nodes.map(nodeMarkup).join("")}
  `;
}

function connectorDefs() {
  return `
    <defs>
      <marker id="manual-flow-arrow" markerWidth="18" markerHeight="18" refX="16" refY="9" orient="auto" markerUnits="userSpaceOnUse">
        <path class="manual-flow-marker" d="M 2 2 L 16 9 L 2 16 Z"></path>
      </marker>
      <marker id="manual-flow-arrow-selected" markerWidth="18" markerHeight="18" refX="16" refY="9" orient="auto" markerUnits="userSpaceOnUse">
        <path class="manual-flow-marker selected" d="M 2 2 L 16 9 L 2 16 Z"></path>
      </marker>
      <marker id="manual-draft-arrowhead" markerWidth="18" markerHeight="18" refX="16" refY="9" orient="auto" markerUnits="userSpaceOnUse">
        <path class="manual-draft-marker" d="M 2 2 L 16 9 L 2 16 Z"></path>
      </marker>
    </defs>
  `;
}

function graphBounds() {
  const maxX = state.nodes.reduce((max, node) => Math.max(max, node.x + nodeSize(node).width + 120), 1000);
  const maxY = state.nodes.reduce((max, node) => Math.max(max, node.y + nodeSize(node).height + 120), 620);
  return {
    width: Math.max(1000, maxX),
    height: Math.max(620, maxY)
  };
}

function edgeMarkup(edge) {
  const from = nodeById(edge.from);
  const to = nodeById(edge.to);
  if (!from || !to) return "";
  const start = nodeOutputPoint(from);
  const end = nodeInputPoint(to);
  const route = connectorRoute(start, end);
  const selected = state.selectedEdgeId === edge.id ? " selected" : "";
  const marker = selected ? "manual-flow-arrow-selected" : "manual-flow-arrow";
  const badgeText = edge.label?.trim() || (numberValue(edge.rate) ? formatRate(edge.rate) : "rate");
  return `
    <path class="manual-flow-line${selected}" d="${route.path}" marker-end="url(#${marker})"></path>
    <path class="manual-flow-hit" d="${route.path}" data-action="manual-select-edge" data-edge-id="${escapeHtml(edge.id)}"></path>
    <g class="manual-flow-badge${selected}" transform="translate(${route.badgeX} ${route.badgeY})" data-action="manual-select-edge" data-edge-id="${escapeHtml(edge.id)}">
      <rect width="72" height="20"></rect>
      <text x="36" y="14">${escapeHtml(badgeText)}</text>
    </g>
  `;
}

function draftWireMarkup() {
  if (!state.draftWire) return "";
  const from = nodeById(state.draftWire.fromId);
  if (!from) return "";
  const start = nodeOutputPoint(from);
  const end = { x: state.draftWire.x, y: state.draftWire.y };
  const route = connectorRoute(start, end);
  return `
    <path class="manual-draft-wire" d="${route.path}" marker-end="url(#manual-draft-arrowhead)"></path>
  `;
}

function connectorRoute(start, end) {
  const forwardGap = end.x - start.x;
  if (forwardGap >= 72) {
    const midpoint = Math.round((start.x + end.x) / 2);
    const path = `M ${start.x} ${start.y} H ${midpoint} V ${end.y} H ${end.x}`;
    return {
      path,
      badgeX: Math.max(8, Math.round(midpoint - 36)),
      badgeY: Math.max(8, Math.round(end.y - 34))
    };
  }

  const exitX = Math.round(start.x + 48);
  const approachX = Math.round(end.x - 42);
  const routeAbove = end.y < start.y && Math.min(start.y, end.y) > 110;
  const bendY = routeAbove
    ? Math.round(Math.min(start.y, end.y) - 72)
    : Math.round(Math.max(start.y, end.y) + 72);
  const path = `M ${start.x} ${start.y} H ${exitX} V ${bendY} H ${approachX} V ${end.y} H ${end.x}`;
  return {
    path,
    badgeX: Math.max(8, Math.round((Math.min(exitX, approachX) + Math.abs(exitX - approachX) / 2) - 36)),
    badgeY: Math.max(8, Math.round(bendY - 28))
  };
}

function nodeMarkup(node) {
  const selected = state.selectedNodeId === node.id ? " selected" : "";
  const linkSource = state.linkSourceId === node.id ? " link-source" : "";
  const type = node.type;
  const ports = nodePortMarkup(node);
  const icon = node.type === "machine"
    ? `<span class="manual-machine-icon">${escapeHtml(machineInitials(node.label))}</span>`
    : node.type === "note"
      ? `<span class="manual-machine-icon">N</span>`
      : goodIconMarkup(node.goodsId, 28);
  const subtitle = node.type === "machine"
    ? `${formatAmount(node.machines)}x / ${formatAmount(node.eut)} EU/t`
    : node.type === "note"
      ? "note"
      : formatRate(node.rate);
  return `
    <button class="manual-node ${escapeHtml(type)}${selected}${linkSource}" type="button" style="left:${node.x}px;top:${node.y}px" data-action="manual-select-node" data-node-id="${escapeHtml(node.id)}">
      ${ports}
      ${icon}
      <strong>${escapeHtml(node.label)}</strong>
      <em>${escapeHtml(subtitle)}</em>
      ${node.notes ? `<span>${escapeHtml(node.notes)}</span>` : ""}
    </button>
  `;
}

function nodePortMarkup(node) {
  const hasInput = ["machine", "intermediate", "output"].includes(node.type);
  const hasOutput = ["input", "machine", "intermediate"].includes(node.type);
  return `
    ${hasInput ? `<span class="manual-port manual-port-in" aria-hidden="true"></span>` : ""}
    ${hasOutput ? `<span class="manual-port manual-port-out" aria-hidden="true"></span>` : ""}
  `;
}

function renderQuickAdd() {
  if (!state.quickAdd.open) {
    elements.quickAdd.hidden = true;
    elements.quickAdd.innerHTML = "";
    return;
  }

  const pending = nodeById(state.quickAdd.pendingFromId);
  const goods = quickGoodMatches();
  const machines = quickMachineMatches();
  const position = quickAddScreenPosition();
  elements.quickAdd.hidden = false;
  elements.quickAdd.style.left = `${position.x}px`;
  elements.quickAdd.style.top = `${position.y}px`;
  elements.quickAdd.innerHTML = `
    <div class="manual-quick-header">
      <strong>${pending ? "Add Connected Block" : "Add Block"}</strong>
      <button type="button" data-action="manual-close-quick-add" title="Close">x</button>
    </div>
    ${pending ? `<p class="manual-quick-context">Signal from ${escapeHtml(pending.label)}</p>` : ""}
    <input data-action="manual-quick-search" value="${escapeHtml(state.quickAdd.query)}" placeholder="Type item, fluid, or machine">
    <div class="manual-quick-results">
      ${machines.map(quickMachineCard).join("")}
      ${goods.map(quickGoodCard).join("")}
      ${!machines.length && !goods.length ? `<div class="empty-state">No matching blocks.</div>` : ""}
    </div>
  `;
}

function quickAddScreenPosition() {
  const mapSection = elements.quickAdd.closest(".manual-map-section");
  const mapRect = mapSection.getBoundingClientRect();
  const frameRect = elements.frame.getBoundingClientRect();
  const rawX = frameRect.left - mapRect.left + state.quickAdd.x * state.zoom - elements.frame.scrollLeft;
  const rawY = frameRect.top - mapRect.top + state.quickAdd.y * state.zoom - elements.frame.scrollTop;
  return {
    x: Math.round(Math.max(8, Math.min(rawX, mapRect.width - 300))),
    y: Math.round(Math.max(8, Math.min(rawY, mapRect.height - 320)))
  };
}

function quickGoodMatches() {
  const query = state.quickAdd.query.trim();
  const goods = query
    ? state.repository.searchGoods(query, 6)
    : ["gtceu:diesel", "gtceu:light_fuel", "gtceu:heavy_fuel", "gtceu:oxygen"]
      .map((id) => state.repository.getGood(id))
      .filter(Boolean);
  return goods.slice(0, 6);
}

function quickMachineMatches() {
  const query = state.quickAdd.query.trim().toLowerCase();
  const machines = [...state.repository.machines.values()]
    .filter((machine) => {
      if (!query) return /chemical_reactor|distillery|mixer|centrifuge/i.test(machine.id);
      return `${machine.id} ${machine.name}`.toLowerCase().includes(query);
    })
    .sort((a, b) => machineSortName(a).localeCompare(machineSortName(b)))
    .slice(0, 5);
  return machines;
}

function quickMachineCard(machine) {
  return `
    <article class="manual-quick-card process">
      <span>Process</span>
      <strong>${escapeHtml(machine.name)}</strong>
      <button type="button" data-action="manual-quick-add-machine" data-id="${escapeHtml(machine.id)}">Add</button>
    </article>
  `;
}

function quickGoodCard(good) {
  const preferredRole = state.quickAdd.pendingFromId ? "intermediate" : "input";
  return `
    <article class="manual-quick-card">
      <span>${escapeHtml(good.kind)}</span>
      <strong>${escapeHtml(good.name)}</strong>
      <div>
        <button type="button" data-action="manual-quick-add-good" data-role-kind="${preferredRole}" data-id="${escapeHtml(good.id)}">${preferredRole === "input" ? "Source" : "Buffer"}</button>
        <button type="button" data-action="manual-quick-add-good" data-role-kind="output" data-id="${escapeHtml(good.id)}">Sink</button>
      </div>
    </article>
  `;
}

function renderInspector() {
  const edge = selectedEdge();
  if (edge) {
    elements.inspector.innerHTML = edgeInspector(edge);
    return;
  }

  const node = selectedNode();
  elements.inspector.innerHTML = node ? nodeInspector(node) : `
    <div class="manual-empty-inspector">
      <p class="process-muted">Select a block or signal to edit it. Right-drag from a block to connect it, or double-click empty space to add another block.</p>
    </div>
  `;
}

function nodeInspector(node) {
  const isMachine = node.type === "machine";
  const isGood = ["input", "intermediate", "output"].includes(node.type);
  return `
    <form data-manual-form="node">
      <label>
        <span>Label</span>
        <input value="${escapeHtml(node.label)}" data-action="manual-edit-node" data-node-field="label">
      </label>
      <label>
        <span>Role</span>
        <select data-action="manual-edit-node" data-node-field="type">
          ${["input", "intermediate", "machine", "output", "note"].map((type) => `<option value="${type}"${node.type === type ? " selected" : ""}>${typeLabel(type)}</option>`).join("")}
        </select>
      </label>
      ${isGood ? `
        <label>
          <span>Rate / min</span>
          <input type="number" min="0" step="1" value="${formatInputNumber(node.rate)}" data-action="manual-edit-node" data-node-field="rate">
        </label>
      ` : ""}
      ${isMachine ? `
        <label>
          <span>Machines built</span>
          <input type="number" min="0" step="1" value="${formatInputNumber(node.machines)}" data-action="manual-edit-node" data-node-field="machines">
        </label>
        <label>
          <span>EU/t each</span>
          <input type="number" min="0" step="1" value="${formatInputNumber(node.eut)}" data-action="manual-edit-node" data-node-field="eut">
        </label>
        <label>
          <span>Tier</span>
          <input value="${escapeHtml(node.tier ?? "")}" data-action="manual-edit-node" data-node-field="tier">
        </label>
      ` : ""}
      <label>
        <span>Notes</span>
        <textarea data-action="manual-edit-node" data-node-field="notes">${escapeHtml(node.notes ?? "")}</textarea>
      </label>
      <div class="manual-inspector-actions">
        <button class="secondary-button" type="button" data-action="manual-start-link" data-id="${escapeHtml(node.id)}">Link from this</button>
        <button class="secondary-button" type="button" data-action="manual-duplicate-node" data-id="${escapeHtml(node.id)}">Duplicate</button>
        <button class="secondary-button danger" type="button" data-action="manual-delete-node" data-id="${escapeHtml(node.id)}">Delete</button>
      </div>
    </form>
  `;
}

function edgeInspector(edge) {
  const from = nodeById(edge.from);
  const to = nodeById(edge.to);
  return `
    <form class="manual-edge-form" data-manual-form="edge">
      <p class="process-muted">${escapeHtml(from?.label ?? edge.from)} -> ${escapeHtml(to?.label ?? edge.to)}</p>
      <label>
        <span>Signal label</span>
        <input value="${escapeHtml(edge.label ?? "")}" data-action="manual-edit-edge" data-edge-field="label">
      </label>
      <label>
        <span>Rate / min</span>
        <input type="number" min="0" step="1" value="${formatInputNumber(edge.rate)}" data-action="manual-edit-edge" data-edge-field="rate">
      </label>
      <div class="manual-inspector-actions">
        <button class="secondary-button danger" type="button" data-action="manual-delete-edge" data-id="${escapeHtml(edge.id)}">Delete signal</button>
      </div>
    </form>
  `;
}

function renderRateSheet() {
  const rows = balanceRows();
  elements.rateSheet.innerHTML = rows.length
    ? rows.map(rateRowMarkup).join("")
    : `<div class="empty-state">Add blocks to start a manual signal sheet.</div>`;
}

function balanceRows() {
  return state.nodes.map((node) => {
    const incoming = state.edges.filter((edge) => edge.to === node.id).reduce((sum, edge) => sum + numberValue(edge.rate), 0);
    const outgoing = state.edges.filter((edge) => edge.from === node.id).reduce((sum, edge) => sum + numberValue(edge.rate), 0);
    const declared = numberValue(node.rate);
    let delta = 0;
    let title = "";
    let detail = "";

    if (node.type === "input") {
      delta = Math.abs(declared - outgoing);
      if (delta > 0.01 && declared > 0) {
        title = `${node.label} output mismatch`;
        detail = `${formatRate(declared)} declared, ${formatRate(outgoing)} sent.`;
      }
    } else if (node.type === "output") {
      delta = Math.abs(declared - incoming);
      if (delta > 0.01 && declared > 0) {
        title = `${node.label} input mismatch`;
        detail = `${formatRate(declared)} expected, ${formatRate(incoming)} received.`;
      }
    } else if (node.type === "intermediate") {
      delta = Math.abs(incoming - outgoing);
      if (delta > 0.01 && (incoming > 0 || outgoing > 0)) {
        title = `${node.label} flow imbalance`;
        detail = `${formatRate(incoming)} in, ${formatRate(outgoing)} out.`;
      } else if (declared > 0) {
        const connectedRate = Math.max(incoming, outgoing);
        delta = Math.abs(declared - connectedRate);
        if (delta > 0.01) {
          title = `${node.label} declared rate mismatch`;
          detail = `${formatRate(declared)} declared, ${formatRate(connectedRate)} connected.`;
        }
      }
    } else if (node.type === "machine") {
      delta = Math.abs(incoming - outgoing);
      if (delta > 0.01 && (incoming > 0 || outgoing > 0)) {
        title = `${node.label} flow imbalance`;
        detail = `${formatRate(incoming)} in, ${formatRate(outgoing)} out.`;
      }
    }

    const warning = Boolean(title);
    return {
      node,
      incoming,
      outgoing,
      declared,
      delta,
      warning,
      title,
      detail
    };
  });
}

function rateRowMarkup(row) {
  const warning = row.warning ? " warning" : "";
  return `
    <article class="manual-rate-row${warning}">
      <strong>${escapeHtml(row.node.label)}</strong>
      <span>${escapeHtml(typeLabel(row.node.type))}</span>
      <span>${formatRate(row.incoming)} in</span>
      <span>${formatRate(row.outgoing)} out</span>
      <em>${row.node.type === "machine" ? `${formatAmount(row.node.machines)} machines / ${formatAmount(row.node.eut)} EU/t each` : `${formatRate(row.declared)} declared`}</em>
    </article>
  `;
}

function setupEvents() {
  elements.goodSearch.addEventListener("input", (event) => {
    state.goodSearch = event.target.value;
    renderSearches();
  });

  elements.machineSearch.addEventListener("input", (event) => {
    state.machineSearch = event.target.value;
    renderSearches();
  });

  elements.zoom.addEventListener("input", (event) => setZoom(event.target.value));

  document.addEventListener("input", (event) => {
    const actionTarget = event.target.closest("[data-action]");
    if (!(actionTarget instanceof HTMLElement)) return;
    if (actionTarget.dataset.action === "manual-edit-node") updateSelectedNode(actionTarget);
    if (actionTarget.dataset.action === "manual-edit-edge") updateSelectedEdge(actionTarget);
    if (actionTarget.dataset.action === "manual-quick-search") {
      state.quickAdd.query = actionTarget.value;
      renderQuickAdd();
      const quickInput = elements.quickAdd.querySelector("[data-action='manual-quick-search']");
      quickInput?.focus();
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target.closest("[data-action]");
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.action === "manual-edit-node") updateSelectedNode(target);
  });

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!(target instanceof Element)) return;
    handleAction(target);
  });

  setupCanvasDrag();
  setupCanvasPan();
  setupCanvasWiring();
}

function handleAction(target) {
  const action = target.dataset.action;
  if (action === "manual-add-good") {
    addGood(target.dataset.id, target.dataset.roleKind);
    return;
  }
  if (action === "manual-add-machine") {
    addMachine(target.dataset.id);
    return;
  }
  if (action === "manual-quick-add-good") {
    addQuickGood(target.dataset.id, target.dataset.roleKind);
    return;
  }
  if (action === "manual-quick-add-machine") {
    addQuickMachine(target.dataset.id);
    return;
  }
  if (action === "manual-close-quick-add") {
    closeQuickAdd();
    renderQuickAdd();
    return;
  }
  if (action === "manual-search-machine") {
    searchMachines(target.dataset.query);
    return;
  }
  if (action === "manual-auto-layout") {
    autoLayoutGraph();
    return;
  }
  if (action === "manual-add-note") {
    addNote();
    return;
  }
  if (action === "manual-select-node") {
    selectNode(target.dataset.nodeId);
    return;
  }
  if (action === "manual-select-edge") {
    selectEdge(target.dataset.edgeId);
    return;
  }
  if (action === "manual-link-mode") {
    state.linkMode = !state.linkMode;
    state.linkSourceId = null;
    setModeNote();
    renderCanvas();
    return;
  }
  if (action === "manual-start-link") {
    state.linkMode = true;
    state.linkSourceId = target.dataset.id ?? null;
    setModeNote();
    renderCanvas();
    return;
  }
  if (action === "manual-delete-node") {
    deleteNode(target.dataset.id);
    return;
  }
  if (action === "manual-duplicate-node") {
    duplicateNode(target.dataset.id);
    return;
  }
  if (action === "manual-delete-edge") {
    deleteEdge(target.dataset.id);
    return;
  }
  if (action === "manual-save") {
    savePlan();
    return;
  }
  if (action === "manual-load") {
    loadPlan();
    return;
  }
  if (action === "manual-example") {
    seedExample();
    selectNothing();
    setModeNote("Loaded the diesel sketch example.");
    renderAll();
    return;
  }
  if (action === "manual-clear") {
    clearPlan();
    return;
  }
  if (action === "manual-zoom-out") setZoom(state.zoom - 0.1);
  if (action === "manual-zoom-in") setZoom(state.zoom + 0.1);
  if (action === "manual-zoom-reset") setZoom(1);
}

function addGood(goodsId, roleKind = "intermediate", position = nextNodePosition(), connectFromId = null) {
  const good = state.repository.getGood(goodsId);
  if (!good) return null;
  const role = ["input", "intermediate", "output"].includes(roleKind) ? roleKind : "intermediate";
  const node = createGoodNode(goodsId, role, 0, position.x, position.y);
  state.nodes.push(node);
  if (connectFromId) connectNodes(connectFromId, node.id);
  selectNode(node.id, { forceNormalSelect: true });
  return node;
}

function addMachine(machineId, position = nextNodePosition(), connectFromId = null) {
  const machine = state.repository.machines.get(machineId);
  if (!machine) return null;
  const node = createMachineNode(machine.id, machine.name, 1, 0, position.x, position.y);
  state.nodes.push(node);
  if (connectFromId) connectNodes(connectFromId, node.id);
  selectNode(node.id, { forceNormalSelect: true });
  return node;
}

function searchMachines(query = "") {
  state.machineSearch = query;
  elements.machineSearch.value = query;
  renderSearches();
}

function addQuickGood(goodsId, roleKind = "intermediate") {
  const position = { x: state.quickAdd.x, y: state.quickAdd.y };
  const connectFromId = state.quickAdd.pendingFromId;
  closeQuickAdd();
  const node = addGood(goodsId, roleKind, position, connectFromId);
  if (node && connectFromId) setModeNote(`Added ${node.label} and connected the signal.`);
  else if (node) setModeNote(`Added ${node.label}. Drag it into place or connect it with a signal.`);
}

function addQuickMachine(machineId) {
  const position = { x: state.quickAdd.x, y: state.quickAdd.y };
  const connectFromId = state.quickAdd.pendingFromId;
  closeQuickAdd();
  const node = addMachine(machineId, position, connectFromId);
  if (node && connectFromId) setModeNote(`Added ${node.label} and connected the signal.`);
  else if (node) setModeNote(`Added ${node.label}. Drag it into place or connect it with a signal.`);
}

function openQuickAdd(x, y, pendingFromId = null, query = "") {
  state.quickAdd = {
    open: true,
    x: Math.max(8, Math.round(x)),
    y: Math.max(8, Math.round(y)),
    query,
    pendingFromId
  };
  state.selectedEdgeId = null;
  renderAll();
  const input = elements.quickAdd.querySelector("[data-action='manual-quick-search']");
  input?.focus();
  setModeNote(pendingFromId ? "Choose a block to create and connect." : "Choose a block to add to the diagram.");
}

function closeQuickAdd() {
  state.quickAdd.open = false;
  state.quickAdd.query = "";
  state.quickAdd.pendingFromId = null;
}

function autoLayoutGraph() {
  const lanes = new Map();
  for (const node of state.nodes) {
    const lane = graphLane(node);
    if (!lanes.has(lane)) lanes.set(lane, []);
    lanes.get(lane).push(node);
  }
  const laneX = {
    0: 70,
    1: 320,
    2: 570,
    3: 820
  };
  for (const [lane, nodes] of lanes) {
    nodes
      .sort((a, b) => a.label.localeCompare(b.label))
      .forEach((node, index) => {
        node.x = laneX[lane] ?? 70;
        node.y = 90 + index * 140;
      });
  }
  setModeNote("Auto Layout arranged blocks into source, process, buffer, and sink lanes.");
  renderAll();
}

function graphLane(node) {
  if (node.type === "input") return 0;
  if (node.type === "machine") return 1;
  if (node.type === "intermediate" || node.type === "note") return 2;
  if (node.type === "output") return 3;
  return 2;
}

function addNote() {
  const position = nextNodePosition();
  const node = {
    id: nextNodeId(),
    type: "note",
    label: "Build note",
    notes: "Write a reminder here.",
    x: position.x,
    y: position.y
  };
  state.nodes.push(node);
  selectNode(node.id, { forceNormalSelect: true });
}

function createGoodNode(goodsId, type, rate, x, y) {
  const good = state.repository?.getGood(goodsId);
  return {
    id: nextNodeId(),
    type,
    goodsId,
    label: good?.name ?? goodsId,
    rate,
    notes: "",
    x,
    y
  };
}

function createMachineNode(machineId, label, machines, eut, x, y) {
  return {
    id: nextNodeId(),
    type: "machine",
    machineId,
    label,
    machines,
    eut,
    tier: "",
    notes: "",
    x,
    y
  };
}

function createEdge(from, to, rate = 0) {
  return {
    id: nextEdgeId(),
    from,
    to,
    rate,
    label: ""
  };
}

function selectNode(nodeId, options = {}) {
  if (!nodeId || !nodeById(nodeId)) return;
  if (state.linkMode && !options.forceNormalSelect) {
    if (!state.linkSourceId) {
      state.linkSourceId = nodeId;
      setModeNote(`Wire source: ${nodeById(nodeId)?.label ?? "block"}. Click a target block.`);
    } else if (state.linkSourceId !== nodeId) {
      connectNodes(state.linkSourceId, nodeId);
      state.linkSourceId = null;
      setModeNote("Signal added. Click another source block, or turn Wire Mode off.");
    }
    renderAll();
    return;
  }
  closeQuickAdd();
  state.selectedNodeId = nodeId;
  state.selectedEdgeId = null;
  renderAll();
}

function selectEdge(edgeId) {
  if (!edgeId || !edgeById(edgeId)) return;
  closeQuickAdd();
  state.selectedEdgeId = edgeId;
  state.selectedNodeId = null;
  renderAll();
}

function selectNothing() {
  state.selectedNodeId = null;
  state.selectedEdgeId = null;
  state.linkSourceId = null;
}

function connectNodes(fromId, toId) {
  if (fromId === toId) return null;
  const exists = state.edges.some((edge) => edge.from === fromId && edge.to === toId);
  if (exists) return null;
  const from = nodeById(fromId);
  const to = nodeById(toId);
  const suggestedRate = Math.min(positiveRate(from), positiveRate(to));
  const edge = createEdge(fromId, toId, suggestedRate);
  state.edges.push(edge);
  return edge;
}

function deleteNode(nodeId) {
  state.nodes = state.nodes.filter((node) => node.id !== nodeId);
  state.edges = state.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
  selectNothing();
  renderAll();
}

function duplicateNode(nodeId) {
  const node = nodeById(nodeId);
  if (!node) return;
  const copy = {
    ...node,
    id: nextNodeId(),
    label: `${node.label} Copy`,
    x: node.x + 42,
    y: node.y + 42
  };
  state.nodes.push(copy);
  selectNode(copy.id, { forceNormalSelect: true });
}

function deleteEdge(edgeId) {
  state.edges = state.edges.filter((edge) => edge.id !== edgeId);
  state.selectedEdgeId = null;
  renderAll();
}

function updateSelectedNode(target) {
  const node = selectedNode();
  if (!node) return;
  const field = target.dataset.nodeField;
  if (!field) return;
  if (["rate", "machines", "eut"].includes(field)) {
    node[field] = Math.max(0, Number(target.value) || 0);
  } else if (field === "type") {
    node.type = target.value;
  } else {
    node[field] = target.value;
  }
  renderAll();
}

function updateSelectedEdge(target) {
  const edge = selectedEdge();
  if (!edge) return;
  const field = target.dataset.edgeField;
  if (!field) return;
  if (field === "rate") edge.rate = Math.max(0, Number(target.value) || 0);
  else edge[field] = target.value;
  renderAll();
}

function savePlan() {
  const payload = {
    title: state.title,
    nodes: state.nodes,
    edges: state.edges,
    nextNodeId: state.nextNodeId,
    nextEdgeId: state.nextEdgeId
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  setModeNote("Saved this manual line in this browser.");
}

function loadPlan() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    setModeNote("No saved manual line found yet.");
    return;
  }
  try {
    const payload = JSON.parse(raw);
    state.title = payload.title || "Manual Production Line";
    state.nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    state.edges = Array.isArray(payload.edges) ? payload.edges : [];
    state.nextNodeId = Number(payload.nextNodeId) || nextNumberFromIds(state.nodes, "node");
    state.nextEdgeId = Number(payload.nextEdgeId) || nextNumberFromIds(state.edges, "edge");
    selectNothing();
    setModeNote("Loaded your saved manual line.");
    renderAll();
  } catch {
    setModeNote("Saved manual line could not be read.");
  }
}

function clearPlan() {
  state.title = "Manual Production Line";
  state.nodes = [];
  state.edges = [];
  state.nextNodeId = 1;
  state.nextEdgeId = 1;
  selectNothing();
  setModeNote("Cleared the canvas.");
  renderAll();
}

function setupCanvasDrag() {
  let drag = null;
  elements.canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (!(event.target instanceof Element)) return;
    const nodeElement = event.target.closest(".manual-node");
    if (!(nodeElement instanceof HTMLElement)) return;
    const node = nodeById(nodeElement.dataset.nodeId);
    if (!node) return;
    drag = {
      pointerId: event.pointerId,
      node,
      startX: event.clientX,
      startY: event.clientY,
      x: node.x,
      y: node.y,
      moved: false
    };
    nodeElement.setPointerCapture(event.pointerId);
  });

  elements.canvas.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = (event.clientX - drag.startX) / state.zoom;
    const dy = (event.clientY - drag.startY) / state.zoom;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
    drag.node.x = Math.max(8, Math.round(drag.x + dx));
    drag.node.y = Math.max(8, Math.round(drag.y + dy));
    renderCanvas();
  });

  for (const eventName of ["pointerup", "pointercancel"]) {
    elements.canvas.addEventListener(eventName, (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag = null;
    });
  }
}

function setupCanvasPan() {
  let pan = null;
  elements.frame.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = elements.frame.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const anchor = {
      offsetX,
      offsetY,
      contentX: (elements.frame.scrollLeft + offsetX) / state.zoom,
      contentY: (elements.frame.scrollTop + offsetY) / state.zoom
    };
    setZoom(state.zoom + (event.deltaY > 0 ? -0.1 : 0.1), anchor);
  }, { passive: false });

  elements.frame.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(".manual-node, .manual-flow-hit")) return;
    pan = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: elements.frame.scrollLeft,
      scrollTop: elements.frame.scrollTop
    };
    elements.frame.setPointerCapture(event.pointerId);
    elements.frame.classList.add("panning");
  });

  elements.frame.addEventListener("pointermove", (event) => {
    if (!pan || pan.pointerId !== event.pointerId) return;
    elements.frame.scrollLeft = pan.scrollLeft - (event.clientX - pan.x);
    elements.frame.scrollTop = pan.scrollTop - (event.clientY - pan.y);
  });

  for (const eventName of ["pointerup", "pointercancel"]) {
    elements.frame.addEventListener(eventName, (event) => {
      if (!pan || pan.pointerId !== event.pointerId) return;
      pan = null;
      elements.frame.classList.remove("panning");
    });
  }
}

function setupCanvasWiring() {
  let wire = null;

  elements.frame.addEventListener("contextmenu", (event) => {
    if (event.target instanceof Element && event.target.closest(".manual-canvas-frame, .manual-canvas, .manual-node")) {
      event.preventDefault();
    }
  });

  elements.canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 2) return;
    if (!(event.target instanceof Element)) return;
    const nodeElement = event.target.closest(".manual-node");
    if (!(nodeElement instanceof HTMLElement)) return;
    const from = nodeById(nodeElement.dataset.nodeId);
    if (!from) return;
    event.preventDefault();
    event.stopPropagation();
    const point = canvasPointFromEvent(event);
    wire = {
      pointerId: event.pointerId,
      fromId: from.id,
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    };
    state.draftWire = { fromId: from.id, x: point.x, y: point.y };
    state.quickAdd.open = false;
    elements.frame.setPointerCapture(event.pointerId);
    setModeNote(`Signal from ${from.label}: drag to a target block or empty space.`);
    renderAll();
  });

  elements.frame.addEventListener("pointermove", (event) => {
    if (!wire || wire.pointerId !== event.pointerId) return;
    const point = canvasPointFromEvent(event);
    wire.moved = wire.moved || Math.hypot(event.clientX - wire.startX, event.clientY - wire.startY) > 8;
    state.draftWire = { fromId: wire.fromId, x: point.x, y: point.y };
    renderCanvas();
  });

  for (const eventName of ["pointerup", "pointercancel"]) {
    elements.frame.addEventListener(eventName, (event) => {
      if (!wire || wire.pointerId !== event.pointerId) return;
      const activeWire = wire;
      wire = null;
      const point = canvasPointFromEvent(event);
      const targetNode = nodeFromViewportPoint(event.clientX, event.clientY);
      state.draftWire = null;
      if (eventName === "pointercancel") {
        renderAll();
        return;
      }
      if (targetNode && targetNode.id !== activeWire.fromId) {
        const edge = connectNodes(activeWire.fromId, targetNode.id);
        state.selectedNodeId = null;
        state.selectedEdgeId = edge?.id ?? null;
        setModeNote(edge ? "Signal connected." : "That signal already exists.");
        renderAll();
        return;
      }
      if (activeWire.moved) {
        openQuickAdd(point.x, point.y, activeWire.fromId);
        return;
      }
      renderAll();
    });
  }

  elements.frame.addEventListener("dblclick", (event) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(".manual-node, .manual-flow-hit, .manual-flow-badge")) return;
    event.preventDefault();
    const point = canvasPointFromEvent(event);
    openQuickAdd(point.x, point.y);
  });
}

function canvasPointFromEvent(event) {
  const rect = elements.frame.getBoundingClientRect();
  return {
    x: (elements.frame.scrollLeft + event.clientX - rect.left) / state.zoom,
    y: (elements.frame.scrollTop + event.clientY - rect.top) / state.zoom
  };
}

function nodeFromViewportPoint(clientX, clientY) {
  const target = document.elementFromPoint(clientX, clientY);
  const nodeElement = target instanceof Element ? target.closest(".manual-node") : null;
  if (!(nodeElement instanceof HTMLElement)) return null;
  return nodeById(nodeElement.dataset.nodeId);
}

function setZoom(value, anchor = null) {
  const nextZoom = Math.round(Math.min(1.75, Math.max(0.55, Number(value) || 1)) * 100) / 100;
  if (nextZoom === state.zoom) {
    elements.zoom.value = String(state.zoom);
    return;
  }
  state.zoom = nextZoom;
  renderCanvas();
  if (anchor) {
    elements.frame.scrollLeft = anchor.contentX * nextZoom - anchor.offsetX;
    elements.frame.scrollTop = anchor.contentY * nextZoom - anchor.offsetY;
  }
}

function setModeNote(message = null) {
  elements.modeNote.textContent = message ?? (
    state.linkMode
      ? state.linkSourceId
        ? "Wire Mode: click the target block."
        : "Wire Mode: click the source block."
      : "Click a block to edit it. Drag blocks to move them, right-drag to wire them, or double-click empty space to add one."
  );
}

function nodeById(id) {
  return state.nodes.find((node) => node.id === id) ?? null;
}

function edgeById(id) {
  return state.edges.find((edge) => edge.id === id) ?? null;
}

function selectedNode() {
  return nodeById(state.selectedNodeId);
}

function selectedEdge() {
  return edgeById(state.selectedEdgeId);
}

function nodeSize(node) {
  return NODE_SIZE[node.type] ?? NODE_SIZE.intermediate;
}

function nodeInputPoint(node) {
  const size = nodeSize(node);
  return { x: node.x, y: node.y + size.height / 2 };
}

function nodeOutputPoint(node) {
  const size = nodeSize(node);
  return { x: node.x + size.width, y: node.y + size.height / 2 };
}

function nextNodePosition() {
  const index = state.nodes.length;
  return {
    x: 80 + (index % 4) * 190,
    y: 110 + Math.floor(index / 4) * 140
  };
}

function nextNodeId() {
  return `node-${state.nextNodeId++}`;
}

function nextEdgeId() {
  return `edge-${state.nextEdgeId++}`;
}

function nextNumberFromIds(items, prefix) {
  const max = items.reduce((largest, item) => {
    const match = String(item.id ?? "").match(new RegExp(`^${prefix}-(\\d+)$`));
    return Math.max(largest, match ? Number(match[1]) : 0);
  }, 0);
  return max + 1;
}

function positiveRate(node) {
  if (!node) return 0;
  if (node.type === "machine") return 0;
  return numberValue(node.rate);
}

function numberValue(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function formatInputNumber(value) {
  return String(Math.round(numberValue(value) * 1000) / 1000);
}

function typeLabel(type) {
  return {
    input: "Source",
    intermediate: "Buffer",
    machine: "Process",
    output: "Sink",
    note: "Note"
  }[type] ?? type;
}

function machineSortName(machine) {
  return `${machine.name} ${machine.id}`;
}

function machineInitials(name) {
  const words = String(name).split(/[^a-z0-9]+/i).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "M";
}

function goodIconMarkup(goodsId, displaySize = 18) {
  const good = state.repository.getGood(goodsId);
  const kind = good?.kind ?? "item";
  const atlasIcon = atlasIconMarkup(goodsId, kind, "good-icon", displaySize);
  if (atlasIcon) return atlasIcon;
  return `<span class="good-swatch ${kind}" style="--swatch:${escapeHtml(good?.color ?? "#7d8790")}"></span>`;
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

main();
