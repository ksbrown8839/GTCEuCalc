import { readFile, writeFile } from "node:fs/promises";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: node tools/normalize-export.mjs <export-json>");
  process.exit(1);
}

const data = JSON.parse(await readFile(filePath, "utf-8"));
let fixedAmounts = 0;
let inferredMachines = 0;

for (const recipe of data.recipes ?? []) {
  for (const output of recipe.outputs ?? []) {
    if (output.kind === "item" && !(output.amount > 0)) {
      output.amount = 1;
      fixedAmounts += 1;
    }
  }
}

if (!Array.isArray(data.machines) || data.machines.length === 0) {
  const timedRecipeTypes = new Set(
    (data.recipes ?? [])
      .filter((recipe) => recipe.durationTicks > 0)
      .map((recipe) => recipe.type)
  );

  data.machines = (data.recipeTypes ?? [])
    .filter((type) => type.category === "gtceu" && timedRecipeTypes.has(type.id))
    .map((type) => ({
      id: type.id,
      name: type.name,
      recipeTypes: [type.id],
      parallel: 1,
      inferred: true
    }));

  inferredMachines = data.machines.length;
  if (inferredMachines > 0) {
    data.metadata ??= {};
    data.metadata.machineMetadata = "inferred-from-recipe-types";
  }
}

await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);

console.log(
  `Normalized ${filePath}: fixed ${fixedAmounts} non-positive item output amounts, inferred ${inferredMachines} machines.`
);
