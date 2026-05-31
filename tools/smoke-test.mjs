import { readFile } from "node:fs/promises";
import { Repository } from "../src/repository.js";
import { createPlan } from "../src/planner.js";
import { getBoundaryPresetForGood, getBoundaryPresetGoods } from "../src/boundaries.js";
import { formatRate } from "../src/format.js";

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

if (!plan.machineRows.some((row) => row.machine.id === "gtceu:mv_assembler" && row.machineCount > 0)) {
  throw new Error("Expected the sample plan to include MV Assembler demand.");
}

if (formatRate(1) !== "1/min") {
  throw new Error("Expected rates to use the /min unit.");
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
const realMachineRecipe = realRepository.recipes.find((recipe) => {
  return recipe.durationTicks > 0 && realRepository.getMachinesForRecipeType(recipe.type).length > 0;
});

if (realRepository.machines.size === 0 || !realMachineRecipe) {
  throw new Error("Expected the real pack to include usable machine metadata.");
}

if (!realRepository.chooseMachineForRecipe(realMachineRecipe).machine) {
  throw new Error(`Expected a machine assignment for ${realMachineRecipe.id}.`);
}

console.log(
  `Smoke test passed: ${plan.recipeRows.length} sample recipe rows, ${plan.machineRows.length} sample machine groups, ${realRepository.machines.size} real machine families.`
);
