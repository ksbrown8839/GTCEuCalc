import { readFile } from "node:fs/promises";
import { Repository } from "../src/repository.js";
import { createPlan, machineCount, machineLoad } from "../src/planner.js";
import { getBoundaryPresetForGood, getBoundaryPresetGoods } from "../src/boundaries.js";
import { formatAmount, formatRate } from "../src/format.js";
import { buildOreFlowGraph, buildOreRoute, getOreRouteMaterials } from "../src/ore-routes-model.js";

const data = JSON.parse(await readFile("data/sample-pack.json", "utf-8"));
const repository = new Repository(data);
const plan = createPlan(repository, [{ goodsId: "gtceu:greenhouse", amountPerMinute: 1 }]);
const targetMatches = repository.searchGoods("poly", 10);
const boundaryPlan = createPlan(repository, [{ goodsId: "gtceu:greenhouse", amountPerMinute: 1 }], {
  externalGoods: new Set(["gtceu:mv_electric_motor"])
});
const circuitBoundaryGoods = getBoundaryPresetGoods(repository, new Set(["circuits"]));
const circuitBoundaryPlan = createPlan(repository, [{ goodsId: "gtceu:greenhouse", amountPerMinute: 1 }], {
  externalGoods: circuitBoundaryGoods
});

if (plan.recipeRows.length === 0) {
  throw new Error("Expected at least one recipe row.");
}

if (plan.planTrees.length !== 1 || plan.planTrees[0].goodsId !== "gtceu:greenhouse") {
  throw new Error("Expected a root crafting tree for the requested target.");
}

if (!plan.planTrees[0].children.some((child) => child.goodsId === "gtceu:tempered_glass")) {
  throw new Error("Expected crafting tree to include direct recipe inputs.");
}

if (!plan.externalRows.some((row) => row.goodsId === "minecraft:glass")) {
  throw new Error("Expected glass to appear as an external input in the sample plan.");
}

if (plan.totalAverageEut <= 0) {
  throw new Error("Expected non-zero average EU/t.");
}

if (!plan.machineRows.some((row) => row.machine.id === "gtceu:mv_assembler" && row.machineCount > 0 && row.machineLoad > 0)) {
  throw new Error("Expected the sample plan to include MV Assembler demand.");
}

if (plan.machineRows.some((row) => row.machineCount !== Math.ceil(row.machineLoad))) {
  throw new Error("Expected machine build counts to round equivalent load up to whole machines.");
}

if (machineLoad({ durationTicks: 100 }, 1) !== 1 / 12 || machineCount({ durationTicks: 100 }, 1) !== 1) {
  throw new Error("Expected machine load and build count to remain distinct.");
}

if (formatRate(1) !== "1/min") {
  throw new Error("Expected rates to use the /min unit.");
}

if (formatAmount(100) !== "100" || formatAmount(300) !== "300") {
  throw new Error("Expected whole hundreds to keep their trailing zeros.");
}

const loopRepository = new Repository({
  schema: "gtceu-planner-pack-v1",
  metadata: {},
  voltageTiers: [],
  goods: [
    { id: "minecraft:iron_ingot", kind: "item", name: "Iron Ingot", mod: "minecraft", tags: [] },
    { id: "minecraft:iron_nugget", kind: "item", name: "Iron Nugget", mod: "minecraft", tags: [] },
    { id: "gtceu:iron_dust", kind: "item", name: "Iron Dust", mod: "gtceu", tags: [] },
    { id: "gtceu:ingot_casting_mold", kind: "item", name: "Casting Mold (Ingot)", mod: "gtceu", tags: [] },
    { id: "gtceu:nugget_casting_mold", kind: "item", name: "Casting Mold (Nugget)", mod: "gtceu", tags: [] }
  ],
  tags: [
    { id: "forge:ingots/iron", kind: "item", name: "Ingots Iron", entries: ["minecraft:iron_ingot"], preferred: "minecraft:iron_ingot" },
    { id: "forge:nuggets/iron", kind: "item", name: "Nuggets Iron", entries: ["minecraft:iron_nugget"], preferred: "minecraft:iron_nugget" },
    { id: "forge:dusts/iron", kind: "item", name: "Dusts Iron", entries: ["gtceu:iron_dust"], preferred: "gtceu:iron_dust" }
  ],
  recipeTypes: [
    { id: "gtceu:alloy_smelter", name: "Alloy Smelter", category: "gtceu" },
    { id: "minecraft:smelting", name: "Smelting", category: "minecraft" }
  ],
  machines: [],
  recipes: [
    {
      id: "gtceu:alloy_smelter/alloy_smelt_iron_nugget_to_ingot",
      type: "gtceu:alloy_smelter",
      durationTicks: 56,
      eut: 7,
      inputs: [
        { kind: "tag", id: "forge:nuggets/iron", amount: 9 },
        { kind: "item", id: "gtceu:ingot_casting_mold", amount: 1, notConsumed: true }
      ],
      outputs: [{ kind: "item", id: "minecraft:iron_ingot", amount: 1 }]
    },
    {
      id: "gtceu:smelting/smelt_dust_iron_to_ingot",
      type: "minecraft:smelting",
      durationTicks: 200,
      eut: 0,
      inputs: [{ kind: "tag", id: "forge:dusts/iron", amount: 1 }],
      outputs: [{ kind: "item", id: "minecraft:iron_ingot", amount: 1 }]
    },
    {
      id: "gtceu:alloy_smelter/alloy_smelt_iron_to_nugget",
      type: "gtceu:alloy_smelter",
      durationTicks: 56,
      eut: 7,
      inputs: [
        { kind: "tag", id: "forge:ingots/iron", amount: 1 },
        { kind: "item", id: "gtceu:nugget_casting_mold", amount: 1, notConsumed: true }
      ],
      outputs: [{ kind: "item", id: "minecraft:iron_nugget", amount: 9 }]
    }
  ]
});

const defaultIronRecipe = loopRepository.chooseRecipeForOutput("minecraft:iron_ingot");
if (defaultIronRecipe?.id !== "gtceu:smelting/smelt_dust_iron_to_ingot") {
  throw new Error("Expected ingot defaults to prefer forward dust smelting over nugget repacking.");
}

const loopSafePlan = createPlan(loopRepository, [{ goodsId: "minecraft:iron_nugget", amountPerMinute: 9 }]);
if (loopSafePlan.warnings.some((warning) => warning.includes("Cycle detected"))) {
  throw new Error("Expected nugget planning to expand through a loop-safe ingot default.");
}

const manuallyPreferredRepacking = loopRepository.chooseRecipeForOutput("minecraft:iron_ingot", {
  "minecraft:iron_ingot": "gtceu:alloy_smelter/alloy_smelt_iron_nugget_to_ingot"
});
if (manuallyPreferredRepacking?.id !== "gtceu:alloy_smelter/alloy_smelt_iron_nugget_to_ingot") {
  throw new Error("Expected explicit recipe preferences to override automatic ranking.");
}

if (!targetMatches.some((good) => good.id === "gtceu:polyethylene")) {
  throw new Error("Expected target search to find Polyethylene.");
}

if (getBoundaryPresetForGood(repository.getGood("gtceu:polyethylene"))?.id !== "fluids") {
  throw new Error("Expected Polyethylene to be grouped with fluids.");
}

if (boundaryPlan.recipeRows.some((row) => row.recipe.id === "gtceu:assembler/mv_electric_motor")) {
  throw new Error("Expected externally supplied goods to stop recipe expansion.");
}

if (!boundaryPlan.externalRows.some((row) => row.goodsId === "gtceu:mv_electric_motor")) {
  throw new Error("Expected externally supplied goods to appear as an external input.");
}

if (!circuitBoundaryGoods.has("gtceu:good_electronic_circuit")) {
  throw new Error("Expected circuit boundary preset to include MV circuits.");
}

if (circuitBoundaryPlan.recipeRows.some((row) => row.recipe.id === "gtceu:assembler/good_electronic_circuit")) {
  throw new Error("Expected circuit boundary preset to stop circuit expansion.");
}

const realData = JSON.parse(await readFile("data/gtceu-modern-pack-1.14.5.json", "utf-8"));
const realRepository = new Repository(realData);
const realOreMaterials = getOreRouteMaterials(realRepository);
const ironOreRoute = buildOreRoute(realRepository, "iron");
const ironOreFlowGraph = buildOreFlowGraph(realRepository, "iron");
const ironOreFlowGraphWithHammers = buildOreFlowGraph(realRepository, "iron", { showHammerRoutes: true });
const ironOreFlowGraphWithShortcuts = buildOreFlowGraph(realRepository, "iron", { showQuickSmelts: true });
const ironFastOreFlowGraphWithShortcuts = buildOreFlowGraph(realRepository, "iron", {
  routeStrategy: "fast",
  showQuickSmelts: true
});
const diamondOreRoute = buildOreRoute(realRepository, "diamond");
const realMachineRecipe = realRepository.recipes.find((recipe) => {
  return recipe.durationTicks > 0 && realRepository.getMachinesForRecipeType(recipe.type).length > 0;
});

if (realRepository.machines.size === 0 || !realMachineRecipe) {
  throw new Error("Expected the real pack to include usable machine metadata.");
}

if (!realRepository.chooseMachineForRecipe(realMachineRecipe).machine) {
  throw new Error(`Expected a machine assignment for ${realMachineRecipe.id}.`);
}

if (!realOreMaterials.some((material) => material.id === "iron")) {
  throw new Error("Expected the ore route explorer to discover iron from exported ore tags.");
}

const expectedIronOreRouteRecipes = [
  "gtceu:ore_washer/wash_iron_crushed_ore_to_purified_ore",
  "gtceu:chemical_bath/bathe_iron_crushed_ore_to_purified_ore",
  "gtceu:thermal_centrifuge/centrifuge_iron_crushed_ore_to_refined_ore",
  "gtceu:centrifuge/centrifuge_iron_dirty_dust_to_dust",
  "gtceu:smelting/smelt_dust_iron_to_ingot"
];

for (const recipeId of expectedIronOreRouteRecipes) {
  if (!ironOreRoute.steps.some((step) => step.recipe.id === recipeId)) {
    throw new Error(`Expected the iron ore route explorer to include ${recipeId}.`);
  }
}

if (ironOreRoute.stages.some((stage) => stage.id === "gem")) {
  throw new Error("Expected molten iron and other bare material IDs not to appear as gem stages.");
}

if (!diamondOreRoute.stages.some((stage) => stage.id === "gem")) {
  throw new Error("Expected tagged gem ores such as diamond to include a gem finishing stage.");
}

if (!ironOreFlowGraph.operations.some((operation) => operation.key === "crushed_ore->purified_ore|gtceu:ore_washer")) {
  throw new Error("Expected the condensed ore graph to include the ore washer branch.");
}

if (!ironOreFlowGraph.operations.some((operation) => operation.key === "crushed_ore->refined_ore|gtceu:thermal_centrifuge")) {
  throw new Error("Expected the condensed ore graph to include the thermal centrifuge branch.");
}

if (ironOreFlowGraph.operations.some((operation) => operation.key === "crushed_ore->ingot|minecraft:smelting")) {
  throw new Error("Expected quick-smelt shortcuts to stay hidden in the default ore graph.");
}

if (!ironOreFlowGraphWithShortcuts.operations.some((operation) => operation.key === "crushed_ore->ingot|minecraft:smelting")) {
  throw new Error("Expected the ore graph to reveal quick-smelt shortcuts when requested.");
}

if (!ironOreFlowGraphWithShortcuts.operations.some((operation) => operation.isQuickSmelt)) {
  throw new Error("Expected shortcut routes to be marked for the compact quick-smelt lane.");
}

if (!ironOreFlowGraphWithHammers.operations.some((operation) => operation.isFallbackRoute)) {
  throw new Error("Expected hammer and crafting routes to be marked as fallback routes.");
}

const expectedIronYieldPath = [
  "ore-crushed-ore-gtceu-macerator",
  "crushed-ore-purified-ore-gtceu-chemical-bath",
  "purified-ore-refined-ore-gtceu-thermal-centrifuge",
  "refined-ore-dust-gtceu-macerator",
  "dust-ingot-minecraft-smelting"
];

if (ironOreFlowGraph.recommendedOperationIds.join("|") !== expectedIronYieldPath.join("|")) {
  throw new Error(`Expected iron's highlighted yield path to use advanced ore processing, got ${ironOreFlowGraph.recommendedOperationIds.join(", ")}.`);
}

if (!ironOreFlowGraph.recommendedByproducts.some((output) => output.id === "gtceu:gold_dust" && output.amount === 1.4)) {
  throw new Error("Expected iron's highlighted yield path to report normalized secondary gold dust.");
}

if (!ironOreFlowGraph.possibleByproducts.some((output) => output.id === "gtceu:gold_dust" && output.routeCount === 1)) {
  throw new Error("Expected iron's material-wide byproduct summary to include gold dust.");
}

if (ironFastOreFlowGraphWithShortcuts.recommendedOperationIds.join("|") !== "ore-ingot-minecraft-blasting") {
  throw new Error("Expected the fastest iron highlight to use the visible direct blasting shortcut.");
}

const expectedRealDefaults = new Map([
  ["minecraft:iron_ingot", "gtceu:smelting/smelt_dust_iron_to_ingot"],
  ["minecraft:copper_ingot", "gtceu:smelting/smelt_dust_copper_to_ingot"],
  ["minecraft:gold_ingot", "gtceu:smelting/smelt_dust_gold_to_ingot"],
  ["gtceu:tin_ingot", "gtceu:smelting/smelt_dust_tin_to_ingot"],
  ["gtceu:wrought_iron_ingot", "gtceu:smelting/smelt_dust_wrought_iron_to_ingot"],
  ["gtceu:steel_ingot", "gtceu:primitive_blast_furnace/steel_from_charcoal_dust"],
  ["gtceu:aluminium_ingot", "gtceu:electric_blast_furnace/blast_aluminium"],
  ["gtceu:bronze_ingot", "gtceu:alloy_smelter/copper_dust_and_tin_dust_into_bronze"]
]);

for (const [goodsId, expectedRecipeId] of expectedRealDefaults) {
  const recipe = realRepository.chooseRecipeForOutput(goodsId);
  if (recipe?.id !== expectedRecipeId) {
    throw new Error(`Expected ${goodsId} to default to ${expectedRecipeId}, got ${recipe?.id ?? "no recipe"}.`);
  }
}

console.log(
  `Smoke test passed: ${plan.recipeRows.length} sample recipe rows, ${plan.machineRows.length} sample machine groups, ${realRepository.machines.size} real machine families.`
);
