import { readFile, writeFile } from "node:fs/promises";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: node tools/normalize-export.mjs <export-json>");
  process.exit(1);
}

const data = JSON.parse(await readFile(filePath, "utf-8"));
let fixedAmounts = 0;

for (const recipe of data.recipes ?? []) {
  for (const output of recipe.outputs ?? []) {
    if (output.kind === "item" && !(output.amount > 0)) {
      output.amount = 1;
      fixedAmounts += 1;
    }
  }
}

await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);

console.log(`Normalized ${filePath}: fixed ${fixedAmounts} non-positive item output amounts.`);
