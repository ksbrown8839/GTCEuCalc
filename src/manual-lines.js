import { formatAmount, formatRate, escapeHtml } from "./format.js?v=machine-build-counts-2026-05-31";
import { loadRepository } from "./repository.js?v=process-coproduct-routes-2026-06-09";

const DEFAULT_DATA_URL = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_TEXTURE_ATLAS_URL = "data/texture-atlas.json";
const STORAGE_KEY = "gtceu-manual-line-v1";
const MACHINE_TIERS = [
  { id: "", label: "Custom", eut: null },
  { id: "ULV", label: "ULV / 8 EU/t", eut: 8 },
  { id: "LV", label: "LV / 32 EU/t", eut: 32 },
  { id: "MV", label: "MV / 128 EU/t", eut: 128 },
  { id: "HV", label: "HV / 512 EU/t", eut: 512 },
  { id: "EV", label: "EV / 2.05k EU/t", eut: 2048 },
  { id: "IV", label: "IV / 8.19k EU/t", eut: 8192 },
  { id: "LuV", label: "LuV / 32.77k EU/t", eut: 32768 },
  { id: "ZPM", label: "ZPM / 131.07k EU/t", eut: 131072 },
  { id: "UV", label: "UV / 524.29k EU/t", eut: 524288 },
  { id: "UHV", label: "UHV / 2.1M EU/t", eut: 2097152 },
  { id: "UEV", label: "UEV / 8.39M EU/t", eut: 8388608 },
  { id: "UIV", label: "UIV / 33.55M EU/t", eut: 33554432 },
  { id: "UXV", label: "UXV / 134.22M EU/t", eut: 134217728 },
  { id: "OpV", label: "OpV / 536.87M EU/t", eut: 536870912 }
];
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
  editor: {
    open: false,
    kind: null,
    id: null
  },
  zoom: 1,
  sidePanel: "tools",
  nextNodeId: 1,
  nextEdgeId: 1
};

const elements = {
  packName: document.querySelector("[data-role='manual-pack-name']"),
  packMeta: document.querySelector("[data-role='manual-pack-meta']"),
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
  rateSheet: document.querySelector("[data-role='manual-rate-sheet']"),
  editor: document.querySelector("[data-role='manual-edit-modal']"),
  toolDock: document.querySelector(".manual-tool-dock"),
  selectionIndicator: document.querySelector("[data-role='manual-selection-indicator']"),
  sideTabs: document.querySelectorAll("[data-action='manual-side-tab']"),
  sidePanels: document.querySelectorAll("[data-side-panel]")
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
  renderSummary();
  renderCanvas();
  renderQuickAdd();
  renderInspector();
  renderEditor();
  renderRateSheet();
  renderSidePanels();
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
  const start = edgeOutputPoint(edge, from);
  const end = edgeInputPoint(edge, to);
  const route = connectorRoute(start, end);
  const selected = state.selectedEdgeId === edge.id ? " selected" : "";
  const rewiring = state.draftWire?.edgeId === edge.id ? " rewiring" : "";
  const marker = selected ? "manual-flow-arrow-selected" : "manual-flow-arrow";
  const badgeText = edge.label?.trim() || (numberValue(edge.rate) ? formatRate(edge.rate) : "rate");
  return `
    <path class="manual-flow-line${selected}${rewiring}" d="${route.path}" marker-end="url(#${marker})" data-edge-id="${escapeHtml(edge.id)}"></path>
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
  const to = nodeById(state.draftWire.toId);
  const edge = edgeById(state.draftWire.edgeId);
  const cursor = { x: state.draftWire.x, y: state.draftWire.y };
  const start = from ? (edge ? edgeOutputPoint(edge, from) : nodeOutputPoint(from)) : cursor;
  const end = to ? (edge ? edgeInputPoint(edge, to) : nodeInputPoint(to)) : cursor;
  if (!from && !to) return "";
  const route = connectorRoute(start, end, { preview: true });
  return `
    <path class="manual-draft-wire" d="${route.path}" marker-end="url(#manual-draft-arrowhead)"></path>
  `;
}

function connectorRoute(start, end, options = {}) {
  if (options.preview) {
    const forwardGap = end.x - start.x;
    const bendX = forwardGap >= 40
      ? Math.round(start.x + forwardGap / 2)
      : Math.round(start.x + 48);
    const path = Math.abs(end.y - start.y) < 1
      ? `M ${start.x} ${start.y} H ${end.x}`
      : `M ${start.x} ${start.y} H ${bendX} V ${end.y} H ${end.x}`;
    return {
      path,
      badgeX: Math.max(8, Math.round(bendX - 36)),
      badgeY: Math.max(8, Math.round(end.y - 34))
    };
  }

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
  const hasInput = nodeAcceptsInput(node);
  const hasOutput = nodeProvidesOutput(node);
  const inputCount = Math.max(1, connectedEdges(node.id, "to").length);
  const outputCount = Math.max(1, connectedEdges(node.id, "from").length);
  return `
    ${hasInput ? portMarkup("in", inputCount) : ""}
    ${hasOutput ? portMarkup("out", outputCount) : ""}
  `;
}

function portMarkup(kind, count) {
  return Array.from({ length: count }, (_, index) => (
    `<span class="manual-port manual-port-${kind}" data-port-kind="${kind}" style="top:${portPercent(index, count)}%" aria-hidden="true"></span>`
  )).join("");
}

function portPercent(index, count) {
  return Math.round(((index + 1) / (count + 1)) * 1000) / 10;
}

function connectedEdges(nodeId, endpoint) {
  return state.edges.filter((edge) => edge[endpoint] === nodeId);
}

function nodeAcceptsInput(node) {
  return ["machine", "intermediate", "output"].includes(node?.type);
}

function nodeProvidesOutput(node) {
  return ["input", "machine", "intermediate"].includes(node?.type);
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
    elements.inspector.innerHTML = edgeSummary(edge);
    return;
  }

  const node = selectedNode();
  elements.inspector.innerHTML = node ? nodeSummary(node) : `
    <div class="manual-empty-inspector">
      <p class="process-muted">Select a block to inspect it. Double-click a block to open the full editor.</p>
    </div>
  `;
}

function nodeSummary(node) {
  const rows = [
    ["Role", typeLabel(node.type)],
    node.type === "machine" ? ["Built", `${formatAmount(node.machines)} machines`] : null,
    node.type === "machine" ? ["Power", `${formatAmount(node.eut)} EU/t each`] : null,
    node.type === "machine" && node.tier ? ["Tier", node.tier] : null,
    ["Rate", ["input", "intermediate", "output"].includes(node.type) ? formatRate(node.rate) : `${formatRate(incomingRate(node))} in / ${formatRate(outgoingRate(node))} out`]
  ].filter(Boolean);
  return `
    <article class="manual-selected-summary">
      <strong>${escapeHtml(node.label)}</strong>
      ${rows.map(([label, value]) => `
        <span>${escapeHtml(label)}</span>
        <em>${escapeHtml(value)}</em>
      `).join("")}
      <button class="secondary-button" type="button" data-action="manual-open-editor" data-kind="node" data-id="${escapeHtml(node.id)}">Edit Block</button>
    </article>
  `;
}

function edgeSummary(edge) {
  const from = nodeById(edge.from);
  const to = nodeById(edge.to);
  return `
    <article class="manual-selected-summary">
      <strong>${escapeHtml(edge.label || "Signal")}</strong>
      <span>From</span>
      <em>${escapeHtml(from?.label ?? edge.from)}</em>
      <span>To</span>
      <em>${escapeHtml(to?.label ?? edge.to)}</em>
      <span>Rate</span>
      <em>${escapeHtml(formatRate(edge.rate))}</em>
      <button class="secondary-button" type="button" data-action="manual-open-editor" data-kind="edge" data-id="${escapeHtml(edge.id)}">Edit Signal</button>
    </article>
  `;
}

function renderEditor() {
  if (!state.editor.open) {
    elements.editor.hidden = true;
    elements.editor.innerHTML = "";
    return;
  }

  const node = state.editor.kind === "node" ? nodeById(state.editor.id) : null;
  const edge = state.editor.kind === "edge" ? edgeById(state.editor.id) : null;
  if (!node && !edge) {
    closeEditor();
    renderEditor();
    return;
  }

  elements.editor.hidden = false;
  elements.editor.innerHTML = `
    <div class="manual-edit-backdrop" data-action="manual-close-editor"></div>
    <section class="manual-edit-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(node ? "Edit block" : "Edit signal")}">
      <header>
        <div>
          <span>${node ? "Block Editor" : "Signal Editor"}</span>
          <h2>${escapeHtml(node?.label ?? edge?.label ?? "Signal")}</h2>
        </div>
        <button type="button" data-action="manual-close-editor" title="Close">x</button>
      </header>
      ${node ? nodeEditorForm(node) : edgeEditorForm(edge)}
    </section>
  `;
}

function nodeEditorForm(node) {
  const isMachine = node.type === "machine";
  const isGood = ["input", "intermediate", "output"].includes(node.type);
  return `
    <form class="manual-editor-form" data-manual-form="node">
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
          <select data-action="manual-edit-node" data-node-field="tier">
            ${tierOptions(node.tier)}
          </select>
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
        <button class="secondary-button" type="button" data-action="manual-close-editor">Done</button>
      </div>
    </form>
  `;
}

function edgeEditorForm(edge) {
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
        <button class="secondary-button" type="button" data-action="manual-close-editor">Done</button>
      </div>
    </form>
  `;
}

function tierOptions(selectedTier = "") {
  const normalized = selectedTier ?? "";
  const hasUnknown = normalized && !MACHINE_TIERS.some((tier) => tier.id === normalized);
  return `
    ${hasUnknown ? `<option value="${escapeHtml(normalized)}" selected>${escapeHtml(normalized)} / custom</option>` : ""}
    ${MACHINE_TIERS.map((tier) => `<option value="${escapeHtml(tier.id)}"${normalized === tier.id ? " selected" : ""}>${escapeHtml(tier.label)}</option>`).join("")}
  `;
}

function renderRateSheet() {
  const rows = balanceRows();
  elements.rateSheet.innerHTML = rows.length
    ? rows.map(rateRowMarkup).join("")
    : `<div class="empty-state">Add blocks to start a manual signal sheet.</div>`;
}

function renderSidePanels() {
  const hasSelection = Boolean(selectedNode() || selectedEdge());
  for (const tab of elements.sideTabs) {
    const active = tab.dataset.panel === state.sidePanel;
    tab.classList.toggle("active", active);
    tab.classList.toggle("has-selection", tab.dataset.panel === "selected" && hasSelection);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  }
  for (const panel of elements.sidePanels) {
    panel.hidden = panel.dataset.sidePanel !== state.sidePanel;
  }
  renderSelectionIndicator();
}

function renderSelectionIndicator() {
  const node = selectedNode();
  const edge = selectedEdge();
  if (!node && !edge) {
    elements.toolDock.classList.remove("has-selection");
    elements.selectionIndicator.hidden = true;
    elements.selectionIndicator.innerHTML = "";
    return;
  }

  elements.toolDock.classList.add("has-selection");
  elements.selectionIndicator.hidden = false;
  if (node) {
    const detail = node.type === "machine"
      ? `${typeLabel(node.type)} / ${formatAmount(node.machines)}x / ${formatAmount(node.eut)} EU/t`
      : `${typeLabel(node.type)} / ${node.type === "note" ? "annotation" : formatRate(node.rate)}`;
    elements.selectionIndicator.innerHTML = `
      <span>Selected block</span>
      <strong>${escapeHtml(node.label)}</strong>
      <em>${escapeHtml(detail)}</em>
    `;
    return;
  }

  const from = nodeById(edge.from);
  const to = nodeById(edge.to);
  elements.selectionIndicator.innerHTML = `
    <span>Selected signal</span>
    <strong>${escapeHtml(edge.label || `${from?.label ?? "Source"} to ${to?.label ?? "Target"}`)}</strong>
    <em>${escapeHtml(formatRate(edge.rate))}</em>
  `;
}

function balanceRows() {
  return state.nodes.map((node) => {
    const incoming = incomingRate(node);
    const outgoing = outgoingRate(node);
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

function incomingRate(node) {
  return state.edges.filter((edge) => edge.to === node.id).reduce((sum, edge) => sum + numberValue(edge.rate), 0);
}

function outgoingRate(node) {
  return state.edges.filter((edge) => edge.from === node.id).reduce((sum, edge) => sum + numberValue(edge.rate), 0);
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
  if (action === "manual-side-tab") {
    state.sidePanel = target.dataset.panel || "tools";
    renderSidePanels();
    return;
  }
  if (action === "manual-show-selection") {
    state.sidePanel = "selected";
    renderSidePanels();
    return;
  }
  if (action === "manual-open-editor") {
    openEditor(target.dataset.kind, target.dataset.id);
    return;
  }
  if (action === "manual-close-editor") {
    closeEditor();
    renderAll();
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
    closeEditor();
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

function openEditor(kind, id) {
  if (kind === "node" && nodeById(id)) {
    closeQuickAdd();
    state.selectedNodeId = id;
    state.selectedEdgeId = null;
    state.sidePanel = "selected";
    state.editor = { open: true, kind: "node", id };
    renderAll();
    focusEditor();
  } else if (kind === "edge" && edgeById(id)) {
    closeQuickAdd();
    state.selectedEdgeId = id;
    state.selectedNodeId = null;
    state.sidePanel = "selected";
    state.editor = { open: true, kind: "edge", id };
    renderAll();
    focusEditor();
  }
}

function closeEditor() {
  state.editor = { open: false, kind: null, id: null };
}

function focusEditor() {
  const firstInput = elements.editor.querySelector("input, select, textarea, button");
  firstInput?.focus();
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
  state.sidePanel = "selected";
  renderCanvasSelection();
  renderQuickAdd();
  renderInspector();
  renderSidePanels();
}

function selectEdge(edgeId) {
  if (!edgeId || !edgeById(edgeId)) return;
  closeQuickAdd();
  state.selectedEdgeId = edgeId;
  state.selectedNodeId = null;
  state.sidePanel = "selected";
  renderCanvasSelection();
  renderQuickAdd();
  renderInspector();
  renderSidePanels();
}

function selectNothing() {
  state.selectedNodeId = null;
  state.selectedEdgeId = null;
  state.linkSourceId = null;
}

function connectNodes(fromId, toId) {
  if (fromId === toId) return null;
  const from = nodeById(fromId);
  const to = nodeById(toId);
  if (!nodeProvidesOutput(from) || !nodeAcceptsInput(to)) return null;
  const exists = state.edges.some((edge) => edge.from === fromId && edge.to === toId);
  if (exists) return null;
  const suggestedRate = Math.min(positiveRate(from), positiveRate(to));
  const edge = createEdge(fromId, toId, suggestedRate);
  state.edges.push(edge);
  return edge;
}

function renderCanvasSelection() {
  for (const nodeElement of elements.canvas.querySelectorAll(".manual-node")) {
    const nodeId = nodeElement.dataset.nodeId;
    nodeElement.classList.toggle("selected", nodeId === state.selectedNodeId);
    nodeElement.classList.toggle("link-source", nodeId === state.linkSourceId);
  }
  for (const line of elements.canvas.querySelectorAll(".manual-flow-line")) {
    const selected = line.dataset.edgeId === state.selectedEdgeId;
    line.classList.toggle("selected", selected);
    line.setAttribute("marker-end", selected ? "url(#manual-flow-arrow-selected)" : "url(#manual-flow-arrow)");
  }
  for (const badge of elements.canvas.querySelectorAll(".manual-flow-badge")) {
    badge.classList.toggle("selected", badge.dataset.edgeId === state.selectedEdgeId);
  }
}

function deleteNode(nodeId) {
  state.nodes = state.nodes.filter((node) => node.id !== nodeId);
  state.edges = state.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
  if (state.editor.kind === "node" && state.editor.id === nodeId) closeEditor();
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
  if (state.editor.kind === "node" && state.editor.id === nodeId) {
    state.editor.id = copy.id;
  }
  selectNode(copy.id, { forceNormalSelect: true });
}

function deleteEdge(edgeId) {
  state.edges = state.edges.filter((edge) => edge.id !== edgeId);
  if (state.editor.kind === "edge" && state.editor.id === edgeId) closeEditor();
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
  } else if (field === "tier") {
    node.tier = target.value;
    const tier = MACHINE_TIERS.find((entry) => entry.id === target.value);
    if (tier?.eut != null && node.type === "machine") node.eut = tier.eut;
  } else {
    node[field] = target.value;
  }
  renderManualEditChange(target, field === "type" || field === "tier");
}

function updateSelectedEdge(target) {
  const edge = selectedEdge();
  if (!edge) return;
  const field = target.dataset.edgeField;
  if (!field) return;
  if (field === "rate") edge.rate = Math.max(0, Number(target.value) || 0);
  else edge[field] = target.value;
  renderManualEditChange(target);
}

function renderManualEditChange(target, rerenderEditor = false) {
  renderSummary();
  renderCanvas();
  renderInspector();
  renderRateSheet();
  renderSidePanels();
  if (!target.closest(".manual-edit-card") || rerenderEditor) renderEditor();
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
    closeEditor();
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
  closeEditor();
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
    if (event.target.closest(".manual-node, .manual-flow-hit, .manual-flow-badge")) return;
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

    const edgeElement = event.target.closest(".manual-flow-hit, .manual-flow-badge");
    if (edgeElement instanceof SVGElement) {
      const edge = edgeById(edgeElement.dataset.edgeId);
      if (!edge) return;
      event.preventDefault();
      event.stopPropagation();
      const point = canvasPointFromEvent(event);
      wire = {
        kind: "rewire",
        pointerId: event.pointerId,
        edgeId: edge.id,
        endpoint: nearestEdgeEndpoint(edge, point),
        startX: event.clientX,
        startY: event.clientY,
        moved: false
      };
      state.selectedNodeId = null;
      state.selectedEdgeId = edge.id;
      state.sidePanel = "selected";
      state.draftWire = draftWireForInteraction(wire, point);
      state.quickAdd.open = false;
      elements.frame.setPointerCapture(event.pointerId);
      elements.frame.classList.add("wiring");
      setModeNote("Reconnect signal: drag its loose end to an input or output port.");
      renderAll();
      return;
    }

    const nodeElement = event.target.closest(".manual-node");
    if (!(nodeElement instanceof HTMLElement)) return;
    const from = nodeById(nodeElement.dataset.nodeId);
    if (!from) return;
    event.preventDefault();
    event.stopPropagation();
    const startPort = event.target.closest(".manual-port");
    if (startPort?.dataset.portKind === "in" || !nodeProvidesOutput(from)) {
      setModeNote("Start a new signal from a block's output port.");
      return;
    }
    const point = canvasPointFromEvent(event);
    wire = {
      kind: "create",
      pointerId: event.pointerId,
      fromId: from.id,
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    };
    state.draftWire = draftWireForInteraction(wire, point);
    state.quickAdd.open = false;
    elements.frame.setPointerCapture(event.pointerId);
    elements.frame.classList.add("wiring");
    setModeNote(`Signal from ${from.label}: drag to a target block or empty space.`);
    renderAll();
  });

  elements.frame.addEventListener("pointermove", (event) => {
    if (!wire || wire.pointerId !== event.pointerId) return;
    const point = canvasPointFromEvent(event);
    wire.moved = wire.moved || Math.hypot(event.clientX - wire.startX, event.clientY - wire.startY) > 8;
    const dropTarget = connectionTargetFromViewportPoint(event.clientX, event.clientY);
    if (wire.kind === "rewire" && dropTarget?.portKind) {
      wire.endpoint = dropTarget.portKind === "out" ? "from" : "to";
    }
    state.draftWire = draftWireForInteraction(wire, point);
    renderCanvas();
  });

  for (const eventName of ["pointerup", "pointercancel"]) {
    elements.frame.addEventListener(eventName, (event) => {
      if (!wire || wire.pointerId !== event.pointerId) return;
      const activeWire = wire;
      wire = null;
      const point = canvasPointFromEvent(event);
      const dropTarget = connectionTargetFromViewportPoint(event.clientX, event.clientY);
      state.draftWire = null;
      elements.frame.classList.remove("wiring");
      if (eventName === "pointercancel") {
        renderAll();
        return;
      }

      if (activeWire.kind === "rewire") {
        if (!dropTarget) {
          setModeNote("Signal unchanged. Drop on an input or output port to reconnect it.");
          renderAll();
          return;
        }
        const endpoint = dropTarget.portKind === "out"
          ? "from"
          : dropTarget.portKind === "in"
            ? "to"
            : activeWire.endpoint;
        const result = rewireEdge(activeWire.edgeId, endpoint, dropTarget.node.id);
        setModeNote(result.message);
        renderAll();
        return;
      }

      if (dropTarget && dropTarget.portKind !== "out" && nodeAcceptsInput(dropTarget.node)) {
        const edge = connectNodes(activeWire.fromId, dropTarget.node.id);
        state.selectedNodeId = null;
        state.selectedEdgeId = edge?.id ?? null;
        setModeNote(edge ? "Signal connected." : "That signal already exists.");
        renderAll();
        return;
      }
      if (dropTarget) {
        setModeNote("New signals must end on an input port.");
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
    if (event.target instanceof Element) {
      const nodeElement = event.target.closest(".manual-node");
      if (nodeElement instanceof HTMLElement) {
        event.preventDefault();
        openEditor("node", nodeElement.dataset.nodeId);
        return;
      }
      const edgeTarget = event.target.closest(".manual-flow-hit, .manual-flow-badge");
      if (edgeTarget instanceof SVGElement) {
        event.preventDefault();
        openEditor("edge", edgeTarget.dataset.edgeId);
        return;
      }
    }
    event.preventDefault();
    const point = canvasPointFromEvent(event);
    openQuickAdd(point.x, point.y);
  });
}

function draftWireForInteraction(wire, point) {
  if (wire.kind === "rewire") {
    const edge = edgeById(wire.edgeId);
    if (!edge) return null;
    return wire.endpoint === "from"
      ? { edgeId: edge.id, toId: edge.to, x: point.x, y: point.y }
      : { edgeId: edge.id, fromId: edge.from, x: point.x, y: point.y };
  }
  return { fromId: wire.fromId, x: point.x, y: point.y };
}

function nearestEdgeEndpoint(edge, point) {
  const from = nodeById(edge.from);
  const to = nodeById(edge.to);
  if (!from || !to) return "to";
  const start = edgeOutputPoint(edge, from);
  const end = edgeInputPoint(edge, to);
  const startDistance = Math.hypot(point.x - start.x, point.y - start.y);
  const endDistance = Math.hypot(point.x - end.x, point.y - end.y);
  return startDistance < endDistance ? "from" : "to";
}

function connectionTargetFromViewportPoint(clientX, clientY) {
  const target = document.elementFromPoint(clientX, clientY);
  const nodeElement = target instanceof Element ? target.closest(".manual-node") : null;
  if (!(nodeElement instanceof HTMLElement)) return null;
  const node = nodeById(nodeElement.dataset.nodeId);
  if (!node) return null;
  const port = target.closest(".manual-port");
  return {
    node,
    portKind: port?.dataset.portKind ?? null
  };
}

function rewireEdge(edgeId, endpoint, nodeId) {
  const edge = edgeById(edgeId);
  const node = nodeById(nodeId);
  if (!edge || !node) return { ok: false, message: "Signal unchanged." };
  if (endpoint === "from" && !nodeProvidesOutput(node)) {
    return { ok: false, message: "That block does not provide an output port." };
  }
  if (endpoint === "to" && !nodeAcceptsInput(node)) {
    return { ok: false, message: "That block does not accept an input signal." };
  }

  const nextFrom = endpoint === "from" ? node.id : edge.from;
  const nextTo = endpoint === "to" ? node.id : edge.to;
  if (nextFrom === nextTo) {
    return { ok: false, message: "A signal cannot connect a block to itself." };
  }
  const duplicate = state.edges.some((candidate) => (
    candidate.id !== edge.id && candidate.from === nextFrom && candidate.to === nextTo
  ));
  if (duplicate) {
    return { ok: false, message: "That signal already exists." };
  }

  edge.from = nextFrom;
  edge.to = nextTo;
  state.selectedNodeId = null;
  state.selectedEdgeId = edge.id;
  state.sidePanel = "selected";
  return { ok: true, message: "Signal reconnected." };
}

function canvasPointFromEvent(event) {
  const rect = elements.frame.getBoundingClientRect();
  return {
    x: (elements.frame.scrollLeft + event.clientX - rect.left) / state.zoom,
    y: (elements.frame.scrollTop + event.clientY - rect.top) / state.zoom
  };
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
      : "Click a block to select it. Double-click a block to edit it, or double-click empty space to add one."
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

function edgeInputPoint(edge, node) {
  const size = nodeSize(node);
  const edges = connectedEdges(node.id, "to");
  const index = Math.max(0, edges.findIndex((candidate) => candidate.id === edge.id));
  return {
    x: node.x,
    y: node.y + size.height * ((index + 1) / (edges.length + 1))
  };
}

function edgeOutputPoint(edge, node) {
  const size = nodeSize(node);
  const edges = connectedEdges(node.id, "from");
  const index = Math.max(0, edges.findIndex((candidate) => candidate.id === edge.id));
  return {
    x: node.x + size.width,
    y: node.y + size.height * ((index + 1) / (edges.length + 1))
  };
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
