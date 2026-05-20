# Data Contract

The planner reads a normalized JSON file. The current version is `gtceu-planner-pack-v1`.

## Top Level

```json
{
  "schema": "gtceu-planner-pack-v1",
  "metadata": {},
  "voltageTiers": [],
  "goods": [],
  "tags": [],
  "recipeTypes": [],
  "machines": [],
  "recipes": []
}
```

## Metadata

Required fields:

- `packId`
- `packName`
- `packVersion`
- `minecraftVersion`
- `loader`
- `exportedAt`

## Goods

Goods are items or fluids.

```json
{
  "id": "gtceu:greenhouse",
  "kind": "item",
  "name": "Greenhouse",
  "mod": "gtceu",
  "color": "#6fa857",
  "tags": []
}
```

`kind` is one of:

- `item`
- `fluid`

## Tags

Tags model pack choices such as `#gtceu:circuits/mv`.

```json
{
  "id": "gtceu:circuits/mv",
  "name": "MV Circuits",
  "entries": ["gtceu:good_electronic_circuit"],
  "preferred": "gtceu:good_electronic_circuit"
}
```

The planner uses `preferred` as the first automatic choice. Later the UI should let the user override this per plan.

## Recipe Types

```json
{
  "id": "gtceu:assembler",
  "name": "Assembler",
  "category": "gtceu",
  "itemInputs": 6,
  "fluidInputs": 1,
  "itemOutputs": 1,
  "fluidOutputs": 0
}
```

## Machines

```json
{
  "id": "gtceu:mv_assembler",
  "name": "MV Assembler",
  "recipeType": "gtceu:assembler",
  "voltageTier": "mv",
  "parallel": 1
}
```

Machines are optional for early data. If absent, the planner can still reason about recipes.

## Recipes

```json
{
  "id": "gtceu:assembler/tempered_glass",
  "type": "gtceu:assembler",
  "durationTicks": 100,
  "eut": 30,
  "inputs": [
    { "kind": "item", "id": "minecraft:glass", "amount": 1 },
    { "kind": "fluid", "id": "gtceu:polyethylene", "amount": 144 }
  ],
  "outputs": [
    { "kind": "item", "id": "gtceu:tempered_glass", "amount": 1 }
  ]
}
```

Ingredient `kind` values:

- `item`
- `fluid`
- `tag`

Amounts are per recipe run. Fluid amounts are in millibuckets.

Optional ingredient fields:

- `chance` - `0.0` to `1.0`
- `notConsumed` - true for catalysts, molds, circuits, etc.
- `alternatives` - possible item/fluid ids when the exporter had to choose one representative value
- `nbt` - string form of stack NBT, currently informational only
- `source` - for values derived from tick-based recipe contents

The planner skips `notConsumed` inputs when calculating demand. It does not yet distinguish recipes by NBT identity.
