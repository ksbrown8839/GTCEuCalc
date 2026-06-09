import { formatAmount, formatDuration, formatRate, escapeHtml } from "./format.js?v=machine-build-counts-2026-05-31";
import { loadRepository } from "./repository.js?v=process-machine-tiers-2026-06-05";
import { BOUNDARY_PRESETS, countBoundaryPresetGoods, getBoundaryPresetGoods } from "./boundaries.js?v=inspector-2026-05-21";
import { buildProcessFlow } from "./process-flow-model.js?v=process-rate-sheet-2026-06-08";
import { effectiveDurationTicks } from "./planner.js?v=process-planning-modes-2026-06-09";

const DEFAULT_DATA_URL = "data/gtceu-modern-pack-1.14.5.json";
const DEFAULT_TEXTURE_ATLAS_URL = "data/texture-atlas.json";
const NODE_SIZES = {
  good: { width: 98, height: 72 },
  recipe: { width: 132, height: 72 }
};
const TARGET_LIMIT = 64;

const state = {
  repository: null,
  textureAtlas: null,
  dataUrl: DEFAULT_DATA_URL,
  targetGoodsId: "gtceu:diesel",
  planningMode: "target",
  targetRate: 6000,
  starterMachineCount: 1,
  targetSearch: "",
  preferredRecipeByOutput: {},
  machineTierByRecipeType: {},
  manualExternalGoods: new Set(),
  manualMadeGoods: new Set(),
  activeBoundaryPresets: new Set(["fluids", "base-materials", "stock-parts", "circuits"]),
  machineCounts: {},
  supplyRates: {},
  unlimitedSupplyGoods: new Set(),
  flowZoom: 1,
  selectedNodeId: null,
  detailOpen: false
};

const elements = {
  packName: document.querySelector("[data-role='process-pack-name']"),
  packMeta: document.querySelector("[data-role='process-pack-meta']"),
  targetSearch: document.querySelector("[data-role='process-target-search']"),
  targetMatchSummary: document.querySelector("[data-role='process-target-match-summary']"),
  targetResults: document.querySelector("[data-role='process-target-results']"),
  targetRate: document.querySelector("[data-role='process-target-rate']"),
  planningModeInputs: document.querySelectorAll("[data-action='set-process-planning-mode']"),
  modeNote: document.querySelector("[data-role='process-mode-note']"),
  starterControl: document.querySelector("[data-role='process-starter-control']"),
  starterMachineCount: document.querySelector("[data-role='process-starter-machine-count']"),
  starterBaselineRate: document.querySelector("[data-role='process-starter-baseline-rate']"),
  boundaryPresetList: document.querySelector("[data-role='process-boundary-preset-list']"),
  boundarySummary: document.querySelector("[data-role='process-boundary-summary']"),
  title: document.querySelector("[data-role='process-title']"),
  summary: document.querySelector("[data-role='process-summary']"),
  power: document.querySelector("[data-role='process-power']"),
  stats: document.querySelector("[data-role='process-stats']"),
  playerSummary: document.querySelector("[data-role='process-player-summary']"),
  flowFrame: document.querySelector("[data-role='process-flow-frame']"),
  flowTrack: document.querySelector("[data-role='process-flow-track']"),
  flowCanvas: document.querySelector("[data-role='process-flow-canvas']"),
  flowZoom: document.querySelector("[data-role='process-flow-zoom']"),
  externalInputs: document.querySelector("[data-role='process-external-inputs']"),
  byproducts: document.querySelector("[data-role='process-byproducts']"),
  rateSheet: document.querySelector("[data-role='process-rate-sheet']"),
  detailWindow: document.querySelector("[data-role='process-detail-window']"),
  detailHeading: document.querySelector("[data-role='process-detail-heading']"),
  detail: document.querySelector("[data-role='process-detail']")
};

function currentFlow() {
  return flowWithOverrides();
}

function flowWithOverrides(targetOverrides = {}, optionOverrides = {}) {
  const targetGoodsId = targetOverrides.goodsId ?? state.targetGoodsId;
  const machineCounts = {
    ...state.machineCounts,
    ...(optionOverrides.machineCounts ?? {})
  };
  const supplyRates = {
    ...state.supplyRates,
    ...(optionOverrides.supplyRates ?? {})
  };
  const machineTierByRecipeType = {
    ...state.machineTierByRecipeType,
    ...(optionOverrides.machineTierByRecipeType ?? {})
  };
  const preferredRecipeByOutput = optionOverrides.preferredRecipeByOutput ?? state.preferredRecipeByOutput;
  const targetRate = targetOverrides.amountPerMinute ?? planningTargetRate(targetGoodsId, {
    machineTierByRecipeType,
    preferredRecipeByOutput
  });

  return buildProcessFlow(state.repository, {
    goodsId: targetGoodsId,
    amountPerMinute: targetRate
  }, {
    preferredRecipeByOutput,
    machineTierByRecipeType,
    externalGoods: getEffectiveExternalGoods(),
    machineCounts,
    supplyRates,
    unlimitedSupplyGoods: optionOverrides.unlimitedSupplyGoods ?? state.unlimitedSupplyGoods
  });
}

function planningTargetRate(goodsId = state.targetGoodsId, options = {}) {
  if (state.planningMode !== "starter") return state.targetRate;
  return starterBaselineInfo(goodsId, options).amountPerMinute || state.targetRate;
}

function starterBaselineInfo(goodsId = state.targetGoodsId, options = {}) {
  const preferredRecipeByOutput = options.preferredRecipeByOutput ?? state.preferredRecipeByOutput;
  const recipe = state.repository.chooseRecipeForOutput(goodsId, preferredRecipeByOutput) ?? null;
  if (!recipe) {
    return {
      amountPerMinute: 0,
      recipe: null,
      machine: null,
      voltageTier: null,
      outputAmount: 0,
      effectiveDurationTicks: 0
    };
  }

  const machineTierByRecipeType = options.machineTierByRecipeType ?? state.machineTierByRecipeType;
  const assignment = state.repository.chooseMachineForRecipe(recipe, { machineTierByRecipeType });
  const outputAmount = recipe.outputs
    .filter((output) => output.id === goodsId)
    .reduce((sum, output) => sum + output.amount * (output.chance ?? 1), 0);
  const overclockSteps = state.repository.getVoltageTierDistance(assignment.minimumVoltageTier, assignment.voltageTier);
  const duration = effectiveDurationTicks(recipe, overclockSteps);
  const parallel = assignment.machine?.parallel ?? 1;
  const machines = Math.max(1, Math.floor(Number(state.starterMachineCount) || 1));
  const amountPerMinute = duration > 0
    ? outputAmount * machines * parallel * (1200 / duration)
    : outputAmount * machines;

  return {
    amountPerMinute,
    recipe,
    machine: assignment.machine,
    voltageTier: assignment.voltageTier,
    outputAmount,
    effectiveDurationTicks: duration,
    machines
  };
}

function getEffectiveExternalGoods() {
  const externalGoods = getBoundaryPresetGoods(state.repository, state.activeBoundaryPresets);
  externalGoods.delete(state.targetGoodsId);

  for (const goodsId of state.manualMadeGoods) {
    externalGoods.delete(goodsId);
  }

  for (const goodsId of state.manualExternalGoods) {
    if (goodsId !== state.targetGoodsId) externalGoods.add(goodsId);
  }

  return externalGoods;
}

function renderAll() {
  renderTargetControls();
  renderBoundaryControls();
  renderProcess();
}

function renderTargetControls() {
  const matches = targetMatches();
  const starter = starterBaselineInfo();
  for (const input of elements.planningModeInputs) {
    input.checked = input.value === state.planningMode;
  }
  elements.targetRate.closest(".process-rate-control").hidden = state.planningMode === "starter";
  elements.starterControl.hidden = state.planningMode !== "starter";
  elements.starterMachineCount.value = String(Math.max(1, Math.floor(state.starterMachineCount)));
  elements.starterBaselineRate.textContent = starter.recipe
    ? `${formatRate(starter.amountPerMinute)} from ${formatAmount(starter.machines)}x ${machineName(starter.machine, starter.voltageTier, recipeTypeName(starter.recipe))}`
    : "No final recipe selected.";
  elements.modeNote.textContent = state.planningMode === "starter"
    ? "Uses the selected final recipe and tier to calculate a natural output from the baseline machines."
    : "Enter the exact output rate you want the factory to sustain.";
  elements.targetResults.innerHTML = matches.length
    ? matches.map(targetButton).join("")
    : `<div class="empty-state">No matching process targets.</div>`;
  elements.targetMatchSummary.textContent = state.targetSearch.trim()
    ? `${formatAmount(matches.length)} matches shown`
    : `${formatAmount(matches.length)} suggested process targets`;
  elements.targetRate.value = state.planningMode === "starter"
    ? formatNumericInput(starter.amountPerMinute)
    : state.targetRate;
}

function targetMatches() {
  const query = state.targetSearch.trim();
  const source = query
    ? state.repository.searchGoods(query, TARGET_LIMIT * 4)
    : [...state.repository.goods.values()];

  return source
    .map((good, index) => ({
      good,
      index,
      recipeCount: state.repository.findRecipesProducing(good.id).length,
      score: processTargetScore(good)
    }))
    .filter((match) => match.recipeCount > 0 && (query || match.good.kind === "fluid" || match.good.mod === "gtceu"))
    .sort((a, b) => b.score - a.score || b.recipeCount - a.recipeCount || a.index - b.index)
    .slice(0, TARGET_LIMIT);
}

function processTargetScore(good) {
  let score = 0;
  if (good.id === state.targetGoodsId) score += 10000;
  if (/diesel|fuel|gasoline|oil|uranium|platinum|titanium/i.test(`${good.id} ${good.name}`)) score += 900;
  if (good.kind === "fluid") score += 400;
  if (state.textureAtlas?.icons?.[good.id] !== undefined) score += 50;
  if (good.mod === "gtceu") score += 20;
  return score;
}

function targetButton(match) {
  const { good, recipeCount } = match;
  const selected = good.id === state.targetGoodsId ? " selected" : "";
  return `
    <button class="process-target-button${selected}" type="button" data-action="select-process-target" data-id="${escapeHtml(good.id)}">
      ${goodIconMarkup(good.id)}
      <span>
        <strong>${escapeHtml(good.name)}</strong>
        <em>${escapeHtml(`${formatAmount(recipeCount)} recipes · ${good.kind}`)}</em>
      </span>
    </button>
  `;
}

function renderBoundaryControls() {
  const externalGoods = getEffectiveExternalGoods();
  elements.boundaryPresetList.innerHTML = BOUNDARY_PRESETS.map((preset) => {
    const checked = state.activeBoundaryPresets.has(preset.id) ? " checked" : "";
    return `
      <label class="boundary-toggle">
        <input type="checkbox" data-action="toggle-process-boundary" data-preset-id="${escapeHtml(preset.id)}"${checked}>
        <span>${escapeHtml(preset.label)}</span>
        <strong>${formatAmount(countBoundaryPresetGoods(state.repository, preset))}</strong>
      </label>
    `;
  }).join("");
  elements.boundarySummary.textContent = `${formatAmount(externalGoods.size)} goods treated as supplied`;
}

function renderProcess() {
  const flow = currentFlow();
  const targetGood = state.repository.getGood(flow.product.goodsId);
  if (state.selectedNodeId && !selectedNode(flow)) {
    state.selectedNodeId = null;
    state.detailOpen = false;
  }

  elements.title.textContent = `${targetGood?.name ?? flow.product.goodsId} Process Line`;
  elements.summary.textContent = [
    `${formatRate(flow.idealOutputPerMinute)} ${state.planningMode === "starter" ? "starter output" : "target"}`,
    `${formatAmount(flow.plan.recipeRows.length)} recipes`,
    `${formatAmount(flow.machineRows.length)} machine groups`
  ].join(" / ");
  elements.power.textContent = `${formatAmount(flow.targetPowerEut)} EU/t required`;

  renderStats(flow);
  renderPlayerSummary(flow);
  renderFlowMap(flow);
  renderExternalInputs(flow);
  renderByproducts(flow);
  renderRateSheet(flow);
  renderSelectedDetail(flow);
  updateUrl();
}

function selectedNode(flow) {
  return flow.graph.nodes.find((node) => node.id === state.selectedNodeId) ?? null;
}

function renderStats(flow) {
  const modeCopy = planningModeCopy();
  const bottleneckText = flow.bottleneck ? bottleneckDescription(flow.bottleneck) : "No active bottleneck";
  const machineText = flow.machineBottleneck ? bottleneckDescription(flow.machineBottleneck) : "No timed machine demand";
  const actualOutputText = flow.bottleneck
    ? `Real output after current limits. Bottleneck: ${bottleneckText}.`
    : "Real output matches the target because no machine or supply limit is active.";
  const machineCeilingText = flow.machineBottleneck
    ? `Machine-only limit before supplied inputs are considered: ${machineText}.`
    : "Machine capacity is not limiting this line at the current target.";
  const assumptionCount = flow.plan.warnings.length + flow.plan.suppressedWarningCount;
  const assumptions = assumptionCount
    ? `<div class="process-stat-card assumptions">
        <span>Planner assumptions</span>
        <strong>${formatAmount(assumptionCount)}</strong>
        <em>${escapeHtml(flow.plan.warnings[0] ?? "Review supplied boundaries and recipe choices.")}</em>
      </div>`
    : "";
  elements.stats.innerHTML = `
    <div class="process-stat-card">
      <span>${escapeHtml(modeCopy.idealLabel)}</span>
      <strong>${formatRate(flow.idealOutputPerMinute)}</strong>
      <em>${escapeHtml(modeCopy.idealNote)}</em>
    </div>
    <div class="process-stat-card">
      <span>Actual output</span>
      <strong>${formatRate(flow.capacityOutputPerMinute)}</strong>
      <em>${escapeHtml(actualOutputText)}</em>
    </div>
    <div class="process-stat-card">
      <span>Machine ceiling</span>
      <strong>${formatRate(flow.machineCapacityOutputPerMinute)}</strong>
      <em>${escapeHtml(machineCeilingText)}</em>
    </div>
    <div class="process-stat-card">
      <span>Energy cost</span>
      <strong>${formatAmount(flow.targetPowerEut)} EU/t</strong>
      <em>Average draw to hit the target. Current setup draws ${formatAmount(flow.capacityPowerEut)} EU/t.</em>
    </div>
    ${assumptions}
  `;
}

function planningModeCopy() {
  if (state.planningMode === "starter") {
    const starter = starterBaselineInfo();
    const machine = starter.recipe
      ? `${formatAmount(starter.machines)}x ${machineName(starter.machine, starter.voltageTier, recipeTypeName(starter.recipe))}`
      : "the selected final recipe";
    return {
      modeLabel: "Starter Line",
      meterLabel: "Starter output",
      idealLabel: "Starter output",
      idealNote: `Natural output from ${machine}.`,
      readyLabel: "Starter balanced",
      readyNote: "Your entered factory can support this starter line.",
      targetNote: (name) => `${name} from ${machine}.`
    };
  }

  return {
    modeLabel: "Target Rate",
    meterLabel: "Target",
    idealLabel: "Ideal output",
    idealNote: "The rate you asked the planner to make every minute.",
    readyLabel: "Target reachable",
    readyNote: "Your entered factory can meet this target.",
    targetNote: (name) => name
  };
}

function bottleneckDescription(row) {
  if (row.type === "machine") {
    return `${machineFamilyName(row.machine, "Machine")} at ${formatAmount(row.capacityFactor)}x target`;
  }

  return `${state.repository.getGoodName(row.goodsId)} supply at ${formatAmount(row.capacityFactor)}x target`;
}

function renderPlayerSummary(flow) {
  const targetGood = state.repository.getGood(flow.product.goodsId);
  const audit = factoryAudit(flow, targetGood);
  const modeCopy = planningModeCopy();
  elements.playerSummary.innerHTML = `
    <header class="process-action-header">
      <div>
        <span>Factory audit</span>
        <h2>What should I do next?</h2>
        <p>Set this to match your base, then use the recommendation before placing more machines.</p>
      </div>
      <strong class="${audit.ready ? "ready" : "blocked"}">${escapeHtml(audit.stateLabel)}</strong>
    </header>
    <div class="process-action-grid">
      <div class="process-action-meters">
        ${actionMeter(modeCopy.meterLabel, audit.targetText, audit.targetNote)}
        ${actionMeter("Actual", audit.actualText, audit.actualNote)}
        ${actionMeter("Efficiency", audit.efficiencyText, audit.efficiencyNote)}
      </div>
      <article class="process-bottleneck-card">
        <span>Main bottleneck</span>
        <strong>${escapeHtml(audit.bottleneck.title)}</strong>
        <p>${escapeHtml(audit.bottleneck.detail)}</p>
      </article>
      <article class="process-next-action-card">
        <span>Recommended next action</span>
        <strong>${escapeHtml(audit.mainAction.title)}</strong>
        <p>${escapeHtml(audit.mainAction.detail)}</p>
        <em>${escapeHtml(audit.mainAction.effect)}</em>
        ${recommendationButton(audit.mainAction)}
      </article>
    </div>
    ${audit.candidates.length ? `
      <div class="process-action-candidates">
        <span>Other useful moves</span>
        <div>
          ${audit.candidates.map((action) => actionCandidate(action)).join("")}
        </div>
      </div>
    ` : ""}
  `;
}

function actionMeter(label, value, note) {
  return `
    <span class="process-action-meter">
      <b>${escapeHtml(label)}</b>
      <strong>${escapeHtml(value)}</strong>
      <em>${escapeHtml(note)}</em>
    </span>
  `;
}

function factoryAudit(flow, targetGood) {
  const modeCopy = planningModeCopy();
  const targetText = formatRate(flow.idealOutputPerMinute);
  const actualText = formatRate(flow.capacityOutputPerMinute);
  const efficiency = flow.idealOutputPerMinute > 0
    ? (flow.capacityOutputPerMinute / flow.idealOutputPerMinute) * 100
    : 100;
  const ready = !flow.bottleneck || flow.lineFactor >= 0.999;
  const bottleneck = bottleneckAudit(flow);
  const mainAction = ready ? noBuildAction(flow) : primaryBottleneckAction(flow, flow.bottleneck);
  const candidates = secondaryActions(flow, mainAction);

  return {
    ready,
    stateLabel: ready ? modeCopy.readyLabel : "Action needed",
    targetText,
    targetNote: modeCopy.targetNote(targetGood?.name ?? flow.product.goodsId),
    actualText,
    actualNote: `${targetGood?.name ?? flow.product.goodsId} after current machine and supply limits.`,
    efficiencyText: `${formatAmount(efficiency)}%`,
    efficiencyNote: ready ? modeCopy.readyNote : `Actual output divided by ${modeCopy.idealLabel.toLowerCase()}.`,
    bottleneck,
    mainAction,
    candidates
  };
}

function bottleneckAudit(flow) {
  if (!flow.bottleneck || flow.lineFactor >= 0.999) {
    return {
      title: "No active bottleneck",
      detail: state.planningMode === "starter"
        ? "The configured machine counts and supplied input rates can support this starter baseline."
        : "The configured machine counts and supplied input rates can hit the requested target."
    };
  }

  if (flow.bottleneck.type === "machine") {
    const row = flow.bottleneck;
    return {
      title: `${machineFamilyName(row.machine, "Machine")} capacity`,
      detail: `Need ${formatAmount(row.idealLoad)} ${tierLabel(row.voltageTier)} machines worth of work, built ${formatAmount(row.builtCount)}.`
    };
  }

  const row = flow.bottleneck;
  const available = row.unlimited ? "no limit" : formatRate(row.availableAmountPerMinute);
  return {
    title: `${state.repository.getGoodName(row.goodsId)} supply`,
    detail: `Needs ${formatRate(row.requiredAmountPerMinute)} available, current cap is ${available}.`
  };
}

function noBuildAction(flow) {
  const headroom = flow.machineCapacityOutputPerMinute > flow.idealOutputPerMinute
    ? ` Machine headroom reaches ${formatRate(flow.machineCapacityOutputPerMinute)} before supply limits.`
    : "";
  const detail = state.planningMode === "starter"
    ? "This starter baseline has no machine or supplied input below its natural output rate."
    : "No machine or supplied input is below the requested rate right now.";
  return {
    title: "Build from the current plan",
    detail,
    effect: `Expected output is ${formatRate(flow.capacityOutputPerMinute)}.${headroom}`,
    apply: null
  };
}

function primaryBottleneckAction(flow, row) {
  if (row.type === "machine") return machineAddAction(flow, row, 1, "Apply +1 machine");
  return supplyRaiseAction(flow, row, "Set required supply");
}

function secondaryActions(flow, mainAction) {
  const actions = [];
  if (flow.bottleneck?.type === "machine") {
    const row = flow.bottleneck;
    const missingForTarget = Math.max(0, Math.ceil(row.idealLoad) - row.builtCount);
    if (missingForTarget > 1) actions.push(machineAddAction(flow, row, missingForTarget, `Build +${formatAmount(missingForTarget)}`));
    const upgrade = machineUpgradeAction(flow, row);
    if (upgrade) actions.push(upgrade);
  }

  if (flow.supplyBottleneck && flow.supplyBottleneck.capacityFactor < 1) {
    actions.push(supplyRaiseAction(flow, flow.supplyBottleneck, "Set supply cap"));
  }

  if (flow.capacityOutputPerMinute > 0 && flow.capacityOutputPerMinute < flow.idealOutputPerMinute) {
    actions.push({
      title: "Lower target to current output",
      detail: "Use this when you want the calculator to match the factory you already built.",
      effect: `Target becomes ${formatRate(flow.capacityOutputPerMinute)} with no new build.`,
      apply: {
        kind: "set-target-rate",
        value: flow.capacityOutputPerMinute,
        label: "Use actual output"
      },
      uniqueKey: "set-target-rate"
    });
  }

  return uniqueActions(actions, mainAction.uniqueKey).slice(0, 3);
}

function machineAddAction(flow, row, amount, buttonLabel) {
  const key = row.configKey ?? row.machineKey;
  const nextCount = Math.max(0, row.builtCount + amount);
  const preview = flowWithOverrides({}, {
    machineCounts: {
      [key]: nextCount
    }
  });
  const effect = outputChangeEffect(flow, preview);
  const targetNote = amount > 1
    ? `This should cover the target machine demand for this step.`
    : `To fully hit this machine demand, build ${formatAmount(Math.max(0, Math.ceil(row.idealLoad) - row.builtCount))} more.`;

  return {
    title: `Add ${formatAmount(amount)} ${tierLabel(row.voltageTier)} ${machineFamilyName(row.machine, "Machine")}`,
    detail: `${machineFamilyName(row.machine, "Machine")} is limiting the line. ${targetNote}`,
    effect,
    apply: {
      kind: "set-machine-count",
      key,
      value: nextCount,
      label: buttonLabel
    },
    uniqueKey: `machine:${key}:${nextCount}`
  };
}

function machineUpgradeAction(flow, row) {
  const recipeType = row.recipeTypes[0];
  if (!recipeType || !row.voltageTier) return null;
  const tiers = eligibleVoltageTiers(row.voltageTier);
  const currentIndex = tiers.findIndex((tier) => tier.id === row.voltageTier.id);
  const nextTier = currentIndex >= 0 ? tiers[currentIndex + 1] : null;
  if (!nextTier) return null;

  const preview = flowWithOverrides({}, {
    machineTierByRecipeType: {
      [recipeType]: nextTier.id
    }
  });
  if (preview.capacityOutputPerMinute <= flow.capacityOutputPerMinute) return null;

  return {
    title: `Upgrade ${machineFamilyName(row.machine, "Machine")} to ${nextTier.name}`,
    detail: "Use this if you can rebuild this step at the next voltage tier instead of adding another parallel machine.",
    effect: outputChangeEffect(flow, preview),
    apply: {
      kind: "set-machine-tier",
      key: recipeType,
      value: nextTier.id,
      label: `Use ${nextTier.name}`
    },
    uniqueKey: `tier:${recipeType}:${nextTier.id}`
  };
}

function supplyRaiseAction(flow, row, buttonLabel) {
  const preview = flowWithOverrides({}, {
    supplyRates: {
      [row.goodsId]: row.requiredAmountPerMinute
    }
  });
  return {
    title: `Raise ${state.repository.getGoodName(row.goodsId)} supply`,
    detail: `Provide ${formatRate(row.requiredAmountPerMinute)} or mark it as No limit if another line handles it.`,
    effect: outputChangeEffect(flow, preview),
    apply: {
      kind: "set-supply-rate",
      key: row.goodsId,
      value: row.requiredAmountPerMinute,
      label: buttonLabel
    },
    uniqueKey: `supply:${row.goodsId}`
  };
}

function outputChangeEffect(flow, preview) {
  const delta = preview.capacityOutputPerMinute - flow.capacityOutputPerMinute;
  const nextLimit = preview.bottleneck && preview.lineFactor < 0.999
    ? ` Next limit: ${bottleneckShortName(preview.bottleneck)}.`
    : " Target reached.";
  return `Output ${formatRate(flow.capacityOutputPerMinute)} -> ${formatRate(preview.capacityOutputPerMinute)} (${formatSignedRate(delta)}).${nextLimit}`;
}

function bottleneckShortName(row) {
  if (row.type === "machine") return machineFamilyName(row.machine, "Machine");
  return `${state.repository.getGoodName(row.goodsId)} supply`;
}

function formatSignedRate(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatRate(value)}`;
}

function uniqueActions(actions, excludeKey = "") {
  const seen = new Set(excludeKey ? [excludeKey] : []);
  return actions.filter((action) => {
    if (!action || seen.has(action.uniqueKey)) return false;
    seen.add(action.uniqueKey);
    return true;
  });
}

function recommendationButton(action) {
  if (!action.apply) return "";
  return `
    <button class="process-action-button" type="button" data-action="apply-process-recommendation" data-kind="${escapeHtml(action.apply.kind)}" data-key="${escapeHtml(action.apply.key ?? "")}" data-value="${escapeHtml(String(action.apply.value ?? ""))}">
      ${escapeHtml(action.apply.label)}
    </button>
  `;
}

function actionCandidate(action) {
  return `
    <article class="process-action-candidate">
      <strong>${escapeHtml(action.title)}</strong>
      <p>${escapeHtml(action.effect)}</p>
      ${recommendationButton(action)}
    </article>
  `;
}

function renderFlowMap(flow) {
  const connectors = flow.graph.edges.map((edge) => connector(edge, flow.graph.nodes)).join("");
  const zoom = state.flowZoom;
  elements.flowCanvas.style.width = `${flow.graph.width}px`;
  elements.flowCanvas.style.height = `${flow.graph.height}px`;
  elements.flowCanvas.style.transform = `scale(${zoom})`;
  elements.flowCanvas.innerHTML = `
    <svg class="process-flow-connectors" viewBox="0 0 ${flow.graph.width} ${flow.graph.height}" style="width:${flow.graph.width}px;height:${flow.graph.height}px" aria-hidden="true">
      ${connectors}
    </svg>
    ${flow.graph.nodes.map((node) => processNode(node, flow)).join("")}
  `;
  elements.flowTrack.style.width = `${Math.ceil(flow.graph.width * zoom)}px`;
  elements.flowTrack.style.height = `${Math.ceil(flow.graph.height * zoom)}px`;
  elements.flowZoom.value = String(zoom);
}

function connector(edge, nodes) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const from = nodeMap.get(edge.from);
  const to = nodeMap.get(edge.to);
  if (!from || !to) return "";
  const start = nodeOutputPoint(from);
  const end = nodeInputPoint(to);
  const midpoint = Math.round((start.x + end.x) / 2);
  const baseX = Math.max(start.x + 8, end.x - 22);
  const pathEndX = Math.max(start.x + 8, baseX);
  const path = `M ${start.x} ${start.y} H ${midpoint} V ${end.y} H ${pathEndX}`;
  const arrow = `M ${baseX} ${end.y - 10} L ${end.x} ${end.y} L ${baseX} ${end.y + 10} Z`;
  return `
    <path class="process-flow-line" d="${path}"></path>
    <path class="process-flow-arrowhead" d="${arrow}"></path>
  `;
}

function nodeInputPoint(node) {
  const size = nodeSize(node);
  return { x: node.x, y: node.y + size.height / 2 };
}

function nodeOutputPoint(node) {
  const size = nodeSize(node);
  return { x: node.x + size.width, y: node.y + size.height / 2 };
}

function nodeSize(node) {
  return {
    width: node.width ?? NODE_SIZES[node.type].width,
    height: node.height ?? NODE_SIZES[node.type].height
  };
}

function processNode(node, flow) {
  if (node.type === "recipe") return recipeNode(node, flow);
  return goodNode(node, flow);
}

function goodNode(node, flow) {
  const supplyRow = flow.supplyRows.find((row) => row.goodsId === node.goodsId);
  const selected = node.id === state.selectedNodeId ? " selected" : "";
  const supplied = node.reason ? ` ${node.reason}` : "";
  const bottleneck = supplyRow?.weakestSupply ? " bottleneck" : "";
  const underbuilt = supplyRow?.underbuilt ? " underbuilt" : "";
  return `
    <button class="process-good-node${selected}${supplied}${bottleneck}${underbuilt}" type="button" style="left:${node.x}px;top:${node.y}px" data-action="select-process-node" data-node-id="${escapeHtml(node.id)}">
      ${goodSlot(node.goodsId, formatRate(node.amountPerMinute))}
      <strong>${escapeHtml(node.label)}</strong>
    </button>
  `;
}

function recipeNode(node, flow) {
  const machineRow = machineRowForRecipe(flow, node.recipe.id);
  const selected = node.id === state.selectedNodeId ? " selected" : "";
  const bottleneck = machineRow?.weakestMachine ? " bottleneck" : "";
  const underbuilt = machineRow?.underbuilt ? " underbuilt" : "";
  const secondary = secondaryOutputs(node.recipe, node.goodsId).slice(0, 2);
  const size = nodeSize(node);
  const empty = (machineRow?.builtCount ?? node.builtCount ?? 1) === 0 ? " empty" : "";
  const machineCount = Math.max(0, Math.floor(Number(machineRow?.builtCount ?? node.builtCount ?? 0)));
  const machinePosition = node.overflowMachineCount
    ? `${tierLabel(node.voltageTier)} / ${formatAmount(node.overflowMachineCount)} more built`
    : machineCount > 1
      ? `${tierLabel(node.voltageTier)} / ${formatAmount(node.machineIndex)} / ${formatAmount(machineCount)} built`
      : tierLabel(node.voltageTier);
  const label = node.overflowMachineCount
    ? `+${formatAmount(node.overflowMachineCount)} more`
    : node.label;
  return `
    <button class="process-recipe-node${selected}${bottleneck}${underbuilt}${empty}" type="button" title="Configure ${escapeHtml(node.label)}" style="left:${node.x}px;top:${node.y}px;width:${size.width}px;min-height:${size.height}px;${voltageTierStyle(node.voltageTier)}" data-action="select-process-node" data-node-id="${escapeHtml(node.id)}">
      <strong>${escapeHtml(label)}</strong>
      <em>${formatRate(node.runsPerMinute)} runs</em>
      ${machinePosition ? `<span>${escapeHtml(machinePosition)}</span>` : ""}
      ${secondary.length ? `<span class="machine-block-byproducts">${secondary.map((output) => goodIconMarkup(output.id)).join("")}</span>` : ""}
    </button>
  `;
}

function machineRowForRecipe(flow, recipeId) {
  return flow.machineRows.find((row) => row.recipeRows.some((recipeRow) => recipeRow.recipe.id === recipeId));
}

function machineCountControl(row) {
  return `
    <label class="process-config-input">
      <span>Built machines</span>
      <span class="process-stepper">
        <button type="button" data-action="step-process-number" data-step-delta="-1" aria-label="Decrease built machines">-</button>
        <input type="number" min="0" step="1" value="${formatMachineInput(row.builtCount)}" data-action="set-process-machine-count" data-machine-key="${escapeHtml(row.configKey ?? row.machineKey)}">
        <button type="button" data-action="step-process-number" data-step-delta="1" aria-label="Increase built machines">+</button>
      </span>
    </label>
  `;
}

function machineTierControl(row, recipeType) {
  if (!recipeType) return "";
  const overrideTierId = state.machineTierByRecipeType[recipeType] ?? "";
  const selectedTierId = overrideTierId || row.voltageTier?.id || "";
  const minimumTier = row.minimumVoltageTier ?? row.voltageTier ?? null;
  const tierOptions = eligibleVoltageTiers(minimumTier);
  const autoLabel = row.voltageTier ? `Auto (${row.voltageTier.name})` : "Auto";

  return `
    <label class="process-config-input process-tier-input">
      <span>Machine tier</span>
      <select data-action="set-process-machine-tier" data-recipe-type="${escapeHtml(recipeType)}">
        <option value=""${overrideTierId ? "" : " selected"}>${escapeHtml(autoLabel)}</option>
        ${tierOptions.map((tier) => {
          const selected = overrideTierId && tier.id === selectedTierId ? " selected" : "";
          return `<option value="${escapeHtml(tier.id)}"${selected}>${escapeHtml(tier.name)} / ${formatAmount(tier.voltage)} EU/t</option>`;
        }).join("")}
      </select>
    </label>
  `;
}

function eligibleVoltageTiers(minimumTier) {
  const tiers = [...state.repository.voltageTiers.values()]
    .sort((a, b) => a.voltage - b.voltage);
  if (!minimumTier) return tiers;
  return tiers.filter((tier) => tier.voltage >= minimumTier.voltage);
}

function renderExternalInputs(flow) {
  elements.externalInputs.innerHTML = flow.supplyRows.length
    ? flow.supplyRows.slice(0, 18).map((row) => supplyRowMarkup(row)).join("")
    : `<div class="empty-state">No supplied inputs at this boundary.</div>`;
}

function supplyRowMarkup(row) {
  const canMake = state.repository.findRecipesProducing(row.goodsId).length > 0;
  const bottleneck = row.weakestSupply ? " bottleneck" : "";
  const underbuilt = row.underbuilt ? " underbuilt" : "";
  const unlimited = row.unlimited ? " unlimited" : "";
  const supplyLimitText = row.unlimited
    ? `Uses ${formatRate(row.actualUsedAmountPerMinute)} / no supply limit`
    : `Uses ${formatRate(row.actualUsedAmountPerMinute)} / max ${formatRate(row.maxOutputPerMinute)} output`;
  const limitControl = row.unlimited
    ? `<div class="process-infinite-value"><strong>No limit</strong><span>Handled separately</span></div>`
    : `<span class="process-stepper">
        <button type="button" data-action="step-process-number" data-step-delta="-1" aria-label="Decrease available rate">-</button>
        <input type="number" min="0" step="1" value="${formatNumericInput(row.availableAmountPerMinute)}" data-action="set-process-supply-rate" data-id="${escapeHtml(row.goodsId)}">
        <button type="button" data-action="step-process-number" data-step-delta="1" aria-label="Increase available rate">+</button>
      </span>`;
  return `
    <article class="process-supply-row${bottleneck}${underbuilt}${unlimited}">
      <div class="process-row-copy">
        <span class="process-row-kicker">Supplied input</span>
        ${goodChip(row.goodsId, `${formatRate(row.requiredAmountPerMinute)} required`)}
        <em>${escapeHtml(supplyLimitText)}</em>
      </div>
      <label class="process-config-input">
        <span>Available rate</span>
        ${limitControl}
      </label>
      <div class="process-supply-actions">
        <button class="secondary-button" type="button" data-action="toggle-process-supply-limit" data-id="${escapeHtml(row.goodsId)}">${row.unlimited ? "Set rate limit" : "No limit"}</button>
        ${canMake ? `<button class="secondary-button" type="button" data-action="make-process-good" data-id="${escapeHtml(row.goodsId)}">Make upstream</button>` : ""}
      </div>
    </article>
  `;
}

function renderByproducts(flow) {
  elements.byproducts.innerHTML = flow.plan.byproductRows.length
    ? flow.plan.byproductRows.slice(0, 18).map((row) => goodLine(row.goodsId, formatRate(row.amountPerMinute))).join("")
    : `<div class="empty-state">No byproducts in this selected chain.</div>`;
}

function renderRateSheet(flow) {
  elements.rateSheet.innerHTML = flow.stageRows.length
    ? flow.stageRows.map((row, index) => stageRateRow(row, index)).join("")
    : `<div class="empty-state">No machine stages in this process line.</div>`;
}

function stageRateRow(row, index) {
  const status = stageStatus(row);
  const machine = machineName(row.machine, row.voltageTier, row.recipeTypeName);
  const outputSummary = row.plannedOutputs.length
    ? row.plannedOutputs.map((output) => state.repository.getGoodName(output.goodsId)).join(", ")
    : row.outputs.map((output) => state.repository.getGoodName(output.goodsId)).join(", ");
  const statusClass = row.status === "machine-shortfall" ? " underbuilt" : row.status === "limited-upstream" ? " limited" : "";
  const bottleneckClass = row.isLineBottleneck ? " bottleneck" : "";
  return `
    <article class="process-rate-stage${statusClass}${bottleneckClass}">
      <div class="process-rate-stage-title">
        <span class="process-row-kicker">Stage ${formatAmount(index + 1)} / ${escapeHtml(row.recipeTypeName)}</span>
        <strong>${escapeHtml(outputSummary || row.recipeId)}</strong>
        <em>${escapeHtml(machine)} / ${escapeHtml(row.recipeId)}</em>
      </div>
      <div class="process-rate-stage-metrics">
        ${rateMetric("Target runs", formatRate(row.targetRunsPerMinute), "Backward planned recipe cycles.")}
        ${rateMetric("Actual runs", formatRate(row.actualRunsPerMinute), "Forward simulated after bottlenecks.")}
        ${rateMetric("Machines", `${formatAmount(row.requiredMachineCount)} need / ${formatAmount(row.builtMachineCount)} built`, formatMachineBalance(row))}
        ${rateMetric("Energy", `${formatAmount(row.averageEut)} EU/t`, `${formatAmount(row.actualAverageEut)} EU/t at current output.`)}
      </div>
      <div class="process-rate-stage-flow">
        <div>
          <span>Inputs consumed</span>
          <div class="chip-flow compact">${stageGoods(row.inputs, "input")}</div>
        </div>
        <div>
          <span>Outputs made</span>
          <div class="chip-flow compact">${stageGoods(row.outputs, "output")}</div>
        </div>
      </div>
      <div class="process-rate-stage-footer">
        <strong>${escapeHtml(status)}</strong>
        <span>Capacity ${escapeHtml(formatCapacityFactor(row.machineCapacityFactor))}</span>
        <button class="secondary-button" type="button" data-action="inspect-process-recipe" data-recipe-id="${escapeHtml(row.recipeId)}">Inspect</button>
      </div>
    </article>
  `;
}

function rateMetric(label, value, note) {
  return `
    <span class="process-rate-metric">
      <b>${escapeHtml(label)}</b>
      <strong>${escapeHtml(value)}</strong>
      <em>${escapeHtml(note)}</em>
    </span>
  `;
}

function stageGoods(items, kind) {
  if (!items.length) return `<span class="process-rate-empty">None</span>`;
  return items.slice(0, 8).map((item) => {
    const tag = kind === "output" && item.role === "byproduct" ? " byproduct" : "";
    const amount = `${formatRate(item.requiredAmountPerMinute)} target / ${formatRate(item.actualAmountPerMinute)} actual${tag}`;
    return goodChip(item.goodsId, amount);
  }).join("");
}

function stageStatus(row) {
  if (row.isLineBottleneck && row.status === "machine-shortfall") return "Line bottleneck: machine shortfall";
  if (row.status === "machine-shortfall") return "Machine shortfall";
  if (row.status === "limited-upstream") return "Limited by another stage";
  return "On target";
}

function formatMachineBalance(row) {
  if (!Number.isFinite(row.machineCapacityFactor)) return "No timed machine limit.";
  if (row.machineCapacityFactor < 1) {
    return `${formatAmount((1 - row.machineCapacityFactor) * 100)}% short of target.`;
  }
  return `Uses ${formatAmount(100 / row.machineCapacityFactor)}% of built capacity.`;
}

function formatCapacityFactor(value) {
  return Number.isFinite(value) ? `${formatAmount(value)}x target` : "No limit";
}

function renderSelectedDetail(flow) {
  const node = selectedNode(flow);
  if (!node || !state.detailOpen) {
    setDetailWindowVisible(false);
    elements.detail.innerHTML = "";
    return;
  }

  setDetailWindowVisible(true);
  elements.detailHeading.textContent = node.type === "recipe" ? "Selected Machine Step" : "Selected Good";
  elements.detail.innerHTML = node.type === "recipe"
    ? recipeDetail(node, flow)
    : goodDetail(node);
}

function setDetailWindowVisible(visible) {
  elements.detailWindow.hidden = !visible;
  document.body.classList.toggle("process-detail-open", visible);
}

function closeProcessDetail() {
  state.detailOpen = false;
  state.selectedNodeId = null;
  setDetailWindowVisible(false);
  elements.detail.innerHTML = "";
  renderProcess();
}

function recipeDetail(node, flow) {
  const recipe = node.recipe;
  const machineRow = machineRowForRecipe(flow, recipe.id);
  const progress = progressBarForRecipe(recipe);
  const inputs = recipe.inputs
    .filter((input) => !input.notConsumed)
    .map((input) => ingredientChip(input, { detailSlot: true }))
    .join("");
  const outputs = recipe.outputs
    .map((output) => goodChip(output.id, formatAmount(output.amount), { detailSlot: true }))
    .join("");
  return `
    <section class="process-detail-card process-recipe-detail-card" style="${progressStyle(progress)}">
      <header>
        <div>
          <h2>${escapeHtml(recipeTypeName(recipe))}</h2>
          <p>${escapeHtml(recipe.id)}</p>
        </div>
        <strong>${formatRate(node.runsPerMinute)} runs</strong>
      </header>
      <div class="process-detail-grid">
        <div class="recipe-goods-column recipe-inputs">
          <span class="section-label">Inputs</span>
          <div class="chip-flow">${inputs || "None"}</div>
        </div>
        <div class="recipe-progress" aria-hidden="true"></div>
        <div class="recipe-goods-column recipe-outputs">
          <span class="section-label">Outputs</span>
          <div class="chip-flow">${outputs || "None"}</div>
        </div>
      </div>
      <div class="recipe-meta">
        <span>${formatDuration(node.effectiveDurationTicks ?? recipe.durationTicks)}</span>
        <span>${formatAmount(node.effectiveEut ?? recipe.eut)} EU/t</span>
        <span>${escapeHtml(machineName(node.machine, node.voltageTier, recipeTypeName(recipe)))}</span>
        ${node.overclockSteps ? `<span>${formatAmount(node.overclockSteps)}x overclock</span>` : ""}
      </div>
      ${machineBuildControl(machineRow)}
      ${recipeChoiceControl(node.goodsId, recipe.id)}
    </section>
  `;
}

function machineBuildControl(row) {
  if (!row) return "";
  const machine = machineFamilyName(row.machine, "Machine");
  const recipeType = row.recipeTypes[0] ?? row.recipeRows[0]?.recipe.type ?? "";
  return `
    <div class="process-node-machine-control">
      <div>
        <span>Built machines</span>
        <strong>${escapeHtml(machine)}</strong>
        <em>${formatAmount(row.requiredCount)} needed / ${formatAmount(row.capacityFactor)}x capacity</em>
      </div>
      <div class="process-config-stack">
        ${machineTierControl(row, recipeType)}
        ${machineCountControl(row)}
      </div>
    </div>
  `;
}

function goodDetail(node) {
  const producedBy = state.repository.rankRecipesForOutput(node.goodsId);
  const external = getEffectiveExternalGoods().has(node.goodsId);
  return `
    <section class="process-detail-card">
      <header>
        <div>
          <h2>${escapeHtml(node.label)}</h2>
          <p>${escapeHtml(node.goodsId)}</p>
        </div>
        <strong>${formatRate(node.amountPerMinute)}</strong>
      </header>
      <div class="process-detail-actions">
        ${producedBy.length ? `<button class="secondary-button" type="button" data-action="make-process-good" data-id="${escapeHtml(node.goodsId)}">Make upstream</button>` : ""}
        ${node.goodsId !== state.targetGoodsId ? `<button class="secondary-button" type="button" data-action="supply-process-good" data-id="${escapeHtml(node.goodsId)}">Treat as supplied</button>` : ""}
      </div>
      <p class="process-muted">${external ? "Currently treated as supplied by the active boundaries." : "Currently allowed to expand into upstream recipes."}</p>
      ${producedBy.length ? recipeChoiceControl(node.goodsId, state.preferredRecipeByOutput[node.goodsId] ?? producedBy[0].id) : ""}
    </section>
  `;
}

function recipeChoiceControl(goodsId, currentRecipeId) {
  const recipes = state.repository.rankRecipesForOutput(goodsId);
  if (recipes.length <= 1) return "";
  const groups = recipeMethodGroups(recipes);
  const selectedGroup = groups.find((group) => group.recipes.some((recipe) => recipe.id === currentRecipeId)) ?? groups[0];
  return `
    <div class="process-method-picker">
      <span>Recipe method</span>
      <p class="process-method-help">Pick the machine route first, then choose a variant when that machine has multiple recipes.</p>
      <div class="process-method-menu">
        ${groups.map((group) => methodButton(goodsId, group, selectedGroup, recipes[0])).join("")}
      </div>
      ${recipeVariantControl(goodsId, selectedGroup, currentRecipeId)}
    </div>
  `;
}

function recipeMethodGroups(recipes) {
  const groups = new Map();
  for (const recipe of recipes) {
    const key = recipe.type;
    const current = groups.get(key);
    if (current) {
      current.recipes.push(recipe);
    } else {
      groups.set(key, {
        key,
        label: recipeTypeName(recipe),
        recipes: [recipe]
      });
    }
  }
  return [...groups.values()];
}

function methodButton(goodsId, group, selectedGroup, recommendedRecipe) {
  const selected = group.key === selectedGroup.key ? " selected" : "";
  const recommended = group.recipes.some((recipe) => recipe.id === recommendedRecipe.id) ? " recommended" : "";
  const variantText = `${formatAmount(group.recipes.length)} ${group.recipes.length === 1 ? "variant" : "variants"}`;
  return `
    <button class="process-method-button${selected}${recommended}" type="button" data-action="choose-process-machine" data-output-id="${escapeHtml(goodsId)}" data-recipe-id="${escapeHtml(group.recipes[0].id)}">
      <span class="machine-icon">${escapeHtml(machineInitialsForName(group.label))}</span>
      <span>
        <strong>${escapeHtml(group.label)}</strong>
        <em>${escapeHtml(variantText)}</em>
      </span>
    </button>
  `;
}

function recipeVariantControl(goodsId, group, currentRecipeId) {
  const selectedRecipeId = group.recipes.some((recipe) => recipe.id === currentRecipeId)
    ? currentRecipeId
    : group.recipes[0].id;
  if (group.recipes.length === 1) {
    return `<em class="process-method-note">${escapeHtml(recipeVariantLabel(group.recipes[0], goodsId, 0))}</em>`;
  }

  return `
    <label class="process-recipe-choice">
      <span>${escapeHtml(group.label)} variant</span>
      <select data-action="choose-process-recipe" data-output-id="${escapeHtml(goodsId)}">
        ${group.recipes.slice(0, 40).map((recipe, index) => {
          const selected = recipe.id === selectedRecipeId ? " selected" : "";
          return `<option value="${escapeHtml(recipe.id)}"${selected}>${escapeHtml(recipeVariantLabel(recipe, goodsId, index))}</option>`;
        }).join("")}
      </select>
    </label>
  `;
}

function recipeVariantLabel(recipe, goodsId, index) {
  const inputs = recipe.inputs
    .filter((input) => !input.notConsumed)
    .slice(0, 3)
    .map((input) => `${formatAmount(input.amount)} ${state.repository.getIngredientName(input)}`)
    .join(" + ");
  const extraInputCount = recipe.inputs.filter((input) => !input.notConsumed).length - 3;
  const output = recipe.outputs.find((item) => item.id === goodsId);
  const outputText = output
    ? `${formatAmount(output.amount)} ${state.repository.getGoodName(goodsId)}`
    : state.repository.getGoodName(goodsId);
  const byproductCount = secondaryOutputs(recipe, goodsId).length;
  const meta = [
    formatDuration(recipe.durationTicks),
    recipe.eut ? `${formatAmount(recipe.eut)} EU/t` : "",
    byproductCount ? `${formatAmount(byproductCount)} byproducts` : ""
  ].filter(Boolean).join(", ");
  const inputText = `${inputs || recipe.id}${extraInputCount > 0 ? ` + ${formatAmount(extraInputCount)} more` : ""}`;
  return `${index === 0 ? "Recommended / " : ""}${inputText} -> ${outputText}${meta ? ` (${meta})` : ""}`;
}

function goodLine(goodsId, amountText, options = {}) {
  const action = options.action
    ? `<button class="secondary-button" type="button" data-action="${escapeHtml(options.action)}" data-id="${escapeHtml(goodsId)}">${escapeHtml(options.actionLabel)}</button>`
    : "";
  return `
    <div class="process-good-line">
      ${goodChip(goodsId, amountText)}
      ${action}
    </div>
  `;
}

function goodChip(goodsId, amountText = "", options = {}) {
  const good = state.repository.getGood(goodsId);
  const name = good?.name ?? goodsId;
  const kind = good?.kind ?? "item";
  const detailClass = options.detailSlot ? " detail-slot" : "";
  const iconSize = options.detailSlot ? 32 : 18;
  return `
    <span class="good-chip ${escapeHtml(kind)}${detailClass}" ${goodTooltipAttrs(good, goodsId, amountText)}>
      ${goodIconMarkup(goodsId, iconSize)}
      <span>${escapeHtml(name)}</span>
      ${amountText ? `<strong>${escapeHtml(amountText)}</strong>` : ""}
    </span>
  `;
}

function ingredientChip(ingredient, options = {}) {
  const resolved = state.repository.resolveIngredient(ingredient);
  const detailClass = options.detailSlot ? " detail-slot" : "";
  if (resolved.good) return goodChip(resolved.id, formatAmount(ingredient.amount), options);
  return `
    <span class="good-chip muted${detailClass}">
      <span class="good-swatch tag"></span>
      <span>${escapeHtml(state.repository.getIngredientName(ingredient))}</span>
      <strong>${formatAmount(ingredient.amount)}</strong>
    </span>
  `;
}

function goodSlot(goodsId, amountText) {
  const good = state.repository.getGood(goodsId);
  const kind = good?.kind ?? "item";
  return `
    <span class="process-good-slot ${kind}" ${goodTooltipAttrs(good, goodsId, amountText)}>
      ${slotIconMarkup(goodsId, kind, good?.color ?? "#7d8790", good?.name ?? goodsId)}
      <span>${escapeHtml(good?.name ?? goodsId)}</span>
      <strong>${escapeHtml(amountText)}</strong>
    </span>
  `;
}

function goodIconMarkup(goodsId, displaySize = 18) {
  const good = state.repository.getGood(goodsId);
  const kind = good?.kind ?? "item";
  const atlasIcon = atlasIconMarkup(goodsId, kind, "good-icon", displaySize);
  if (atlasIcon) return atlasIcon;
  return `<span class="good-swatch ${kind}" style="--swatch:${escapeHtml(good?.color ?? "#7d8790")}"></span>`;
}

function slotIconMarkup(goodsId, kind, color, label) {
  const atlasIcon = atlasIconMarkup(goodsId, kind, "slot-image", 32);
  if (atlasIcon) return atlasIcon;
  return `<span class="slot-swatch ${kind}" style="--swatch:${escapeHtml(color)}"><span>${escapeHtml(slotInitials(label, goodsId))}</span></span>`;
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

function goodTooltipAttrs(good, fallbackId, amountText = "") {
  return [
    "data-mc-tooltip",
    `data-tooltip-name="${escapeHtml(good?.name ?? fallbackId)}"`,
    `data-tooltip-id="${escapeHtml(good?.id ?? fallbackId)}"`,
    amountText ? `data-tooltip-amount="${escapeHtml(amountText)}"` : "",
    good?.kind ? `data-tooltip-kind="${escapeHtml(good.kind)}"` : "",
    good?.mod ? `data-tooltip-mod="${escapeHtml(good.mod)}"` : ""
  ].filter(Boolean).join(" ");
}

function machineInitials(node) {
  return machineInitialsForName(machineName(node.machine, node.voltageTier, node.label));
}

function machineInitialsForName(name) {
  const words = name.split(/[^a-z0-9]+/i).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "M";
}

function machineName(machine, voltageTier, fallback = "Unknown machine") {
  if (!machine) return fallback;
  if (!voltageTier || machine.voltageTier) return machine.name;
  return `${voltageTier.name} ${machine.name}`;
}

function machineFamilyName(machine, fallback = "Unknown machine") {
  return machine?.name ?? fallback;
}

const VOLTAGE_TIER_COLORS = {
  ulv: "#505050",
  lv: "#a8a8a8",
  mv: "#50ffff",
  hv: "#ffa800",
  ev: "#a800a8",
  iv: "#5050ff",
  luv: "#ff50ff",
  zpm: "#ff5050",
  uv: "#00a8a8",
  uhv: "#a80000",
  uev: "#0b5cfe",
  uiv: "#914e91",
  uxv: "#488748",
  opv: "#8c0000",
  max: "#2828f5"
};

function tierLabel(voltageTier) {
  return voltageTier?.name ?? "Tier";
}

function voltageTierStyle(voltageTier) {
  const accent = VOLTAGE_TIER_COLORS[voltageTier?.id] ?? "#315a73";
  const background = mixHex(accent, "#d2d2d2", 0.5);
  const highlight = mixHex(accent, "#ffffff", 0.62);
  const shadow = mixHex(accent, "#303030", 0.38);
  return [
    `--tier-bg:${background}`,
    `--tier-border:${accent}`,
    `--tier-hi:${highlight}`,
    `--tier-lo:${shadow}`
  ].join(";");
}

function mixHex(a, b, bWeight = 0.5) {
  const left = hexToRgb(a);
  const right = hexToRgb(b);
  const aWeight = 1 - bWeight;
  return `#${[0, 1, 2].map((index) => {
    const value = Math.round(left[index] * aWeight + right[index] * bWeight);
    return value.toString(16).padStart(2, "0");
  }).join("")}`;
}

function hexToRgb(hex) {
  const normalized = String(hex).replace("#", "");
  const value = Number.parseInt(normalized, 16);
  return [
    (value >> 16) & 255,
    (value >> 8) & 255,
    value & 255
  ];
}

function recipeTypeName(recipe) {
  return state.repository.getRecipeType(recipe.type).name;
}

function progressBarForRecipe(recipe) {
  const key = `${recipe.type} ${recipeTypeName(recipe)}`.toLowerCase();
  const base = "assets/gui/gtceu/progress_bar/";
  const choices = [
    [/circuit[_\s-]*assembler/, "progress_bar_circuit_assembler.png", 20, 20],
    [/distillation/, "progress_bar_distillation_tower.png", 65, 75],
    [/cracking/, "progress_bar_cracking.png", 20, 20],
    [/macerat/, "progress_bar_macerate.png", 20, 20],
    [/compress/, "progress_bar_compress.png", 20, 20],
    [/assembler/, "progress_bar_assembler.png", 20, 20],
    [/mixer/, "progress_bar_mixer.png", 20, 20],
    [/bath/, "progress_bar_bath.png", 20, 20]
  ];
  const match = choices.find(([pattern]) => pattern.test(key));
  const [, file, frameWidth, frameHeight] = match ?? [null, "progress_bar_arrow.png", 20, 20];
  const scale = file === "progress_bar_distillation_tower.png" ? 1.2 : 2.6;
  const width = Math.round(frameWidth * scale);
  const height = Math.round(frameHeight * scale);

  return {
    url: `${base}${file}`,
    width,
    height,
    sheetHeight: height * 2
  };
}

function progressStyle(progress) {
  return [
    `--gtceu-progress:url(${progress.url})`,
    `--gtceu-progress-width:${progress.width}px`,
    `--gtceu-progress-height:${progress.height}px`,
    `--gtceu-progress-sheet-height:${progress.sheetHeight}px`
  ].join(";");
}

function secondaryOutputs(recipe, primaryGoodsId) {
  return recipe.outputs.filter((output) => output.id !== primaryGoodsId && state.repository.getGood(output.id));
}

function formatMachineInput(value) {
  return Number.isFinite(value) ? String(Math.max(0, Math.floor(value))) : "0";
}

function formatNumericInput(value) {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(Math.max(0, value) * 1000) / 1000);
}

function slotInitials(name, fallback) {
  const words = String(name).split(/[^a-z0-9]+/i).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((word) => word[0]).join("") : (words[0] ?? fallback).slice(0, 2)).toUpperCase();
}

function updateUrl() {
  const params = new URLSearchParams();
  if (state.dataUrl !== DEFAULT_DATA_URL) params.set("data", state.dataUrl);
  params.set("target", state.targetGoodsId);
  if (state.planningMode !== "target") params.set("mode", state.planningMode);
  if (state.planningMode === "target") params.set("rate", String(state.targetRate));
  if (state.planningMode === "starter" && state.starterMachineCount !== 1) {
    params.set("baseline", String(state.starterMachineCount));
  }
  const nextUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, "", nextUrl);
}

function dataUrlFromLocation() {
  return new URLSearchParams(window.location.search).get("data") || DEFAULT_DATA_URL;
}

function targetFromLocation() {
  return new URLSearchParams(window.location.search).get("target");
}

function planningModeFromLocation() {
  const value = new URLSearchParams(window.location.search).get("mode");
  return value === "starter" ? "starter" : "target";
}

function rateFromLocation() {
  const value = Number(new URLSearchParams(window.location.search).get("rate"));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function starterBaselineFromLocation() {
  const value = Number(new URLSearchParams(window.location.search).get("baseline"));
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : null;
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

function setupEvents() {
  elements.targetSearch.addEventListener("input", (event) => {
    state.targetSearch = event.target.value;
    renderTargetControls();
  });

  elements.targetRate.addEventListener("input", (event) => {
    state.targetRate = Math.max(0, Number(event.target.value) || 0);
    renderProcess();
  });

  elements.starterMachineCount.addEventListener("input", (event) => {
    state.starterMachineCount = Math.max(1, Math.floor(Number(event.target.value) || 1));
    renderTargetControls();
    renderProcess();
  });

  elements.flowZoom.addEventListener("input", (event) => {
    setFlowZoom(event.target.value);
  });

  setupFlowPan();

  document.addEventListener("input", (event) => {
    const target = event.target.closest("[data-action]");
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;

    if (action === "set-process-machine-count") {
      const machineKey = target.dataset.machineKey;
      if (!machineKey) return;
      state.machineCounts[machineKey] = Math.max(0, Number(target.value) || 0);
      renderProcess();
      return;
    }

    if (action === "set-process-supply-rate") {
      const goodsId = target.dataset.id;
      if (!goodsId) return;
      state.supplyRates[goodsId] = Math.max(0, Number(target.value) || 0);
      renderProcess();
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target.closest("[data-action]");
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;

    if (action === "toggle-process-boundary") {
      const presetId = target.dataset.presetId;
      if (!presetId) return;
      if (target.checked) state.activeBoundaryPresets.add(presetId);
      else state.activeBoundaryPresets.delete(presetId);
      renderAll();
    }

    if (action === "set-process-planning-mode") {
      state.planningMode = target.value === "starter" ? "starter" : "target";
      renderAll();
    }

    if (action === "choose-process-recipe") {
      const outputId = target.dataset.outputId;
      if (!outputId) return;
      chooseProcessRecipe(outputId, target.value);
      renderAll();
    }

    if (action === "set-process-machine-tier") {
      const recipeType = target.dataset.recipeType;
      if (!recipeType) return;
      if (target.value) state.machineTierByRecipeType[recipeType] = target.value;
      else delete state.machineTierByRecipeType[recipeType];
      renderAll();
    }
  });

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;
    const goodsId = target.dataset.id;

    if (action === "step-process-number") {
      stepProcessNumber(target);
      return;
    }

    if (action === "select-process-target" && goodsId) {
      state.targetGoodsId = goodsId;
      state.manualMadeGoods.add(goodsId);
      state.manualExternalGoods.delete(goodsId);
      state.machineCounts = {};
      state.supplyRates = {};
      state.unlimitedSupplyGoods = new Set();
      state.selectedNodeId = null;
      state.detailOpen = false;
      state.targetSearch = "";
      elements.targetSearch.value = "";
      renderAll();
      return;
    }

    if (action === "select-process-node") {
      state.selectedNodeId = target.dataset.nodeId ?? null;
      state.detailOpen = Boolean(state.selectedNodeId);
      renderProcess();
      return;
    }

    if (action === "inspect-process-recipe" && target.dataset.recipeId) {
      const nodeId = `recipe:${target.dataset.recipeId}`;
      const flow = currentFlow();
      const nodeExists = flow.graph.nodes.some((node) => node.id === nodeId);
      if (!nodeExists) return;
      state.selectedNodeId = nodeId;
      state.detailOpen = true;
      renderProcess();
      return;
    }

    if (action === "apply-process-recommendation") {
      applyProcessRecommendation(target);
      return;
    }

    if (action === "close-process-detail") {
      closeProcessDetail();
      return;
    }

    if (action === "choose-process-machine" && target.dataset.outputId && target.dataset.recipeId) {
      chooseProcessRecipe(target.dataset.outputId, target.dataset.recipeId);
      renderProcess();
      return;
    }

    if (action === "process-zoom-out") {
      setFlowZoom(state.flowZoom - 0.1);
      return;
    }

    if (action === "process-zoom-in") {
      setFlowZoom(state.flowZoom + 0.1);
      return;
    }

    if (action === "process-zoom-reset") {
      setFlowZoom(1);
      return;
    }

    if (action === "make-process-good" && goodsId) {
      state.manualMadeGoods.add(goodsId);
      state.manualExternalGoods.delete(goodsId);
      state.unlimitedSupplyGoods.delete(goodsId);
      renderAll();
      return;
    }

    if (action === "supply-process-good" && goodsId) {
      state.manualExternalGoods.add(goodsId);
      state.manualMadeGoods.delete(goodsId);
      delete state.preferredRecipeByOutput[goodsId];
      renderAll();
      return;
    }

    if (action === "toggle-process-supply-limit" && goodsId) {
      if (state.unlimitedSupplyGoods.has(goodsId)) state.unlimitedSupplyGoods.delete(goodsId);
      else state.unlimitedSupplyGoods.add(goodsId);
      renderProcess();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.detailOpen) return;
    closeProcessDetail();
  });
}

function applyProcessRecommendation(button) {
  const kind = button.dataset.kind;
  const key = button.dataset.key ?? "";
  const value = Number(button.dataset.value);

  if (kind === "set-machine-count" && key && Number.isFinite(value)) {
    state.machineCounts[key] = Math.max(0, Math.floor(value));
    renderProcess();
    return;
  }

  if (kind === "set-machine-tier" && key && button.dataset.value) {
    state.machineTierByRecipeType[key] = button.dataset.value;
    renderProcess();
    return;
  }

  if (kind === "set-supply-rate" && key && Number.isFinite(value)) {
    state.supplyRates[key] = Math.max(0, value);
    state.unlimitedSupplyGoods.delete(key);
    renderProcess();
    return;
  }

  if (kind === "set-target-rate" && Number.isFinite(value) && value > 0) {
    state.targetRate = Math.max(0, Math.round(value * 1000) / 1000);
    renderTargetControls();
    renderProcess();
  }
}

function setFlowZoom(value, anchor = null) {
  const nextZoom = Math.round(Math.min(1.75, Math.max(0.5, Number(value) || 1)) * 100) / 100;
  if (nextZoom === state.flowZoom) {
    elements.flowZoom.value = String(state.flowZoom);
    return;
  }
  state.flowZoom = nextZoom;
  renderProcess();
  if (anchor) {
    elements.flowFrame.scrollLeft = anchor.contentX * nextZoom - anchor.offsetX;
    elements.flowFrame.scrollTop = anchor.contentY * nextZoom - anchor.offsetY;
  }
}

function setupFlowPan() {
  let pan = null;

  elements.flowFrame.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = elements.flowFrame.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const anchor = {
      offsetX,
      offsetY,
      contentX: (elements.flowFrame.scrollLeft + offsetX) / state.flowZoom,
      contentY: (elements.flowFrame.scrollTop + offsetY) / state.flowZoom
    };
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    setFlowZoom(state.flowZoom + delta, anchor);
  }, { passive: false });

  elements.flowFrame.addEventListener("pointerdown", (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(".process-good-node, .process-recipe-node")) return;
    pan = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: elements.flowFrame.scrollLeft,
      scrollTop: elements.flowFrame.scrollTop
    };
    elements.flowFrame.setPointerCapture(event.pointerId);
    elements.flowFrame.classList.add("panning");
  });

  elements.flowFrame.addEventListener("pointermove", (event) => {
    if (!pan || pan.pointerId !== event.pointerId) return;
    elements.flowFrame.scrollLeft = pan.scrollLeft - (event.clientX - pan.x);
    elements.flowFrame.scrollTop = pan.scrollTop - (event.clientY - pan.y);
  });

  for (const eventName of ["pointerup", "pointercancel"]) {
    elements.flowFrame.addEventListener(eventName, (event) => {
      if (!pan || pan.pointerId !== event.pointerId) return;
      pan = null;
      elements.flowFrame.classList.remove("panning");
    });
  }
}

function chooseProcessRecipe(outputId, recipeId) {
  state.preferredRecipeByOutput[outputId] = recipeId;
  state.manualMadeGoods.add(outputId);
  state.manualExternalGoods.delete(outputId);
}

function setupMinecraftTooltips() {
  let tooltip = null;
  let activeTarget = null;
  function getTooltip() {
    if (tooltip) return tooltip;
    tooltip = document.createElement("div");
    tooltip.className = "minecraft-tooltip";
    tooltip.setAttribute("role", "tooltip");
    document.body.append(tooltip);
    return tooltip;
  }
  function position(x, y) {
    if (!tooltip) return;
    const pad = 14;
    tooltip.style.left = `${Math.min(window.innerWidth - tooltip.offsetWidth - 10, x + pad)}px`;
    tooltip.style.top = `${Math.min(window.innerHeight - tooltip.offsetHeight - 10, y + pad)}px`;
  }
  function show(target, event) {
    const node = getTooltip();
    activeTarget = target;
    node.innerHTML = `
      <div class="minecraft-tooltip-name">${escapeHtml(target.dataset.tooltipName ?? "Unknown")}</div>
      ${target.dataset.tooltipAmount ? `<div class="minecraft-tooltip-amount">${escapeHtml(target.dataset.tooltipAmount)}</div>` : ""}
      <div class="minecraft-tooltip-detail">${escapeHtml(target.dataset.tooltipId ?? "")}</div>
      ${target.dataset.tooltipMod || target.dataset.tooltipKind ? `<div class="minecraft-tooltip-meta">${escapeHtml([target.dataset.tooltipMod, target.dataset.tooltipKind].filter(Boolean).join(" / "))}</div>` : ""}
    `;
    node.classList.add("visible");
    position(event.clientX, event.clientY);
  }
  function hide() {
    activeTarget = null;
    tooltip?.classList.remove("visible");
  }
  document.addEventListener("pointerover", (event) => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest("[data-mc-tooltip]");
    if (target instanceof HTMLElement) show(target, event);
  });
  document.addEventListener("pointermove", (event) => {
    if (activeTarget) position(event.clientX, event.clientY);
  });
  document.addEventListener("pointerout", (event) => {
    if (!activeTarget) return;
    if (event.relatedTarget instanceof Node && activeTarget.contains(event.relatedTarget)) return;
    hide();
  });
}

function stepProcessNumber(button) {
  const input = button.closest(".process-stepper")?.querySelector("input[type='number']");
  if (!input) return;

  const step = Math.abs(Number(input.step)) || 1;
  const delta = Number(button.dataset.stepDelta) || 0;
  const min = input.min === "" ? -Infinity : Number(input.min);
  const max = input.max === "" ? Infinity : Number(input.max);
  const current = Number(input.value);
  const base = Number.isFinite(current) ? current : (Number.isFinite(min) ? min : 0);
  const next = Math.min(max, Math.max(min, base + step * delta));
  input.value = formatStepperValue(next, step);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function formatStepperValue(value, step) {
  const decimals = String(step).includes(".")
    ? String(step).split(".")[1].length
    : 0;
  return String(Number(value.toFixed(Math.min(6, decimals))));
}

async function main() {
  try {
    state.dataUrl = dataUrlFromLocation();
    state.repository = await loadRepository(state.dataUrl);
    state.textureAtlas = await loadTextureAtlas(textureAtlasUrlFromLocation());
    state.planningMode = planningModeFromLocation();
    state.starterMachineCount = starterBaselineFromLocation() ?? state.starterMachineCount;
    state.targetGoodsId = targetFromLocation() && state.repository.getGood(targetFromLocation())
      ? targetFromLocation()
      : state.repository.getGood("gtceu:diesel")
        ? "gtceu:diesel"
        : [...state.repository.goods.values()].find((good) => state.repository.findRecipesProducing(good.id).length)?.id;
    state.targetRate = rateFromLocation() ?? state.targetRate;
    state.manualMadeGoods.add(state.targetGoodsId);
    const meta = state.repository.metadata;
    const packCounts = `${formatAmount(state.repository.goods.size)} goods / ${formatAmount(state.repository.recipes.length)} recipes`;
    elements.packName.textContent = meta.packName;
    elements.packMeta.textContent = `${meta.packVersion} / Minecraft ${meta.minecraftVersion} / ${packCounts}`;
    setupEvents();
    setupMinecraftTooltips();
    renderAll();
  } catch (error) {
    elements.summary.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
    console.error(error);
  }
}

main();
