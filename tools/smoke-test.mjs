import { readFile } from "node:fs/promises";
import { Repository } from "../src/repository.js";
import { createPlan } from "../src/planner.js";
import { getBoundaryPresetGoods } from "../src/boundaries.js";

const data = JSON.parse(await readFile("data/sample-pack.json", "utf-8"));
const repository = new Repository(data);
const plan = createPlan(repository, [{ goodsId: "gtceu:greenhouse", amountPerMinute: 1 }]);
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

if (!plan.externalRows.some((row) => row.goodsId === "minecraft:glass")) {
  throw new Error("Expected glass to appear as an external input in the sample plan.");
}

if (plan.totalAverageEut <= 0) {
  throw new Error("Expected non-zero average EU/t.");
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

console.log(`Smoke test passed: ${plan.recipeRows.length} recipe rows, ${plan.externalRows.length} external inputs.`);
