import fs from "node:fs";

const PACK_DATA_PATH = "data/gtceu-modern-pack-1.14.5.json";
const OUTPUT_PATH = "data/multiblock-structures.json";

const CONTROLLER_ONLY_IDS = [
  "gtceu:active_transformer",
  "gtceu:alloy_blast_smelter",
  "gtceu:assembly_line",
  "gtceu:bronze_large_boiler",
  "gtceu:central_monitor",
  "gtceu:charcoal_pile_igniter",
  "gtceu:cleanroom",
  "gtceu:coke_oven",
  "gtceu:cracker",
  "gtceu:data_bank",
  "gtceu:distillation_tower",
  "gtceu:electric_blast_furnace",
  "gtceu:ev_fluid_drilling_rig",
  "gtceu:ev_large_miner",
  "gtceu:extreme_combustion_engine",
  "gtceu:gas_large_turbine",
  "gtceu:high_performance_computation_array",
  "gtceu:hv_fluid_drilling_rig",
  "gtceu:implosion_compressor",
  "gtceu:iv_large_miner",
  "gtceu:large_arc_smelter",
  "gtceu:large_assembler",
  "gtceu:large_autoclave",
  "gtceu:large_brewer",
  "gtceu:large_centrifuge",
  "gtceu:large_chemical_bath",
  "gtceu:large_chemical_reactor",
  "gtceu:large_circuit_assembler",
  "gtceu:large_combustion_engine",
  "gtceu:large_cutter",
  "gtceu:large_distillery",
  "gtceu:large_electrolyzer",
  "gtceu:large_electromagnet",
  "gtceu:large_engraving_laser",
  "gtceu:large_extractor",
  "gtceu:large_extruder",
  "gtceu:large_maceration_tower",
  "gtceu:large_material_press",
  "gtceu:large_mixer",
  "gtceu:large_packer",
  "gtceu:large_sifting_funnel",
  "gtceu:large_solidifier",
  "gtceu:large_wiremill",
  "gtceu:luv_fusion_reactor",
  "gtceu:luv_large_miner",
  "gtceu:mega_blast_furnace",
  "gtceu:mega_vacuum_freezer",
  "gtceu:multi_smelter",
  "gtceu:mv_fluid_drilling_rig",
  "gtceu:network_switch",
  "gtceu:palladium_substation",
  "gtceu:plasma_large_turbine",
  "gtceu:power_substation",
  "gtceu:primitive_blast_furnace",
  "gtceu:primitive_pump",
  "gtceu:pyrolyse_oven",
  "gtceu:research_station",
  "gtceu:steam_large_turbine",
  "gtceu:steam_oven",
  "gtceu:steel_large_boiler",
  "gtceu:titanium_large_boiler",
  "gtceu:tungstensteel_large_boiler",
  "gtceu:uv_fusion_reactor",
  "gtceu:vacuum_freezer",
  "gtceu:zpm_fusion_reactor"
];

const packData = JSON.parse(fs.readFileSync(PACK_DATA_PATH, "utf8"));
const goodsById = new Map(packData.goods.map((good) => [good.id, good]));

function titleFromId(id) {
  return id
    .replace(/^.*:/, "")
    .split("_")
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(" ");
}

function goodName(id) {
  return goodsById.get(id)?.name ?? titleFromId(id);
}

function structureName(controller) {
  const name = goodName(controller);
  return /\bmultiblock\b/i.test(name) ? `${name} Structure` : `${name} Multiblock`;
}

function requirement(id, amount, role) {
  return { id, amount, role };
}

function exactStructure({ controller, name, description, source, notes, requirements }) {
  return {
    id: `gtceu:multiblock/${controller.replace(/^gtceu:/, "")}`,
    controller,
    name,
    description,
    source,
    coverage: "exact",
    notes,
    requirements
  };
}

function lowerBoundStructure({ controller, name, description, source, notes, requirements }) {
  return {
    id: `gtceu:multiblock/${controller.replace(/^gtceu:/, "")}`,
    controller,
    name,
    description,
    source,
    coverage: "pattern-lower-bound",
    notes,
    requirements
  };
}

function standardStructure({ controller, name, description, source, notes, requirements }) {
  return {
    id: `gtceu:multiblock/${controller.replace(/^gtceu:/, "")}`,
    controller,
    name,
    description,
    source,
    coverage: "standard-build",
    notes,
    requirements
  };
}

function controllerOnlyStructure(controller) {
  return {
    id: `gtceu:multiblock/${controller.replace(/^gtceu:/, "")}`,
    controller,
    name: structureName(controller),
    description: "Formed multiblock scaffold. The exported recipe data includes the controller recipe, but not the full EMI structure pattern yet.",
    source: "GTCEu Modern Pack 1.14.5 exported controller goods",
    coverage: "controller-only",
    notes: [
      "Counts and expands the controller block recipe so the structure can participate in the recipe tree.",
      "Full casing, hatch, coil, frame, and special part counts still need an EMI or GTCEu pattern export before this can be exact."
    ],
    requirements: [
      requirement(controller, 1, "controller")
    ]
  };
}

const knownStructures = [
  exactStructure({
    controller: "gtceu:steam_grinder",
    name: "Steam Grinder Multiblock",
    description: "Build requirements for the formed Steam Grinder structure. This is supplemental planner metadata because the exporter only exposes the controller block recipes.",
    source: "GTCEu Modern Pack 1.14.5 in-game multiblock preview",
    notes: [
      "Uses Steam Grinder macerating and ore-grinding recipes.",
      "Counts the controller and structure parts so the recipe tree can include the full build cost."
    ],
    requirements: [
      requirement("gtceu:steam_grinder", 1, "controller"),
      requirement("gtceu:steam_machine_casing", 22, "structure casing"),
      requirement("gtceu:steam_input_hatch", 1, "steam input"),
      requirement("gtceu:steam_input_bus", 1, "item input"),
      requirement("gtceu:steam_output_bus", 1, "item output")
    ]
  }),
  lowerBoundStructure({
    controller: "gtceu:greenhouse",
    name: "Greenhouse Multiblock",
    description: "Lower-bound build requirements from the pack's KubeJS Greenhouse pattern.",
    source: "kubejs/startup_scripts/machinery/greenhouse.js",
    notes: [
      "The pattern contains 56 B positions; at least 5 must be ULV Machine Casing.",
      "Remaining B positions may be casings or recipe ability blocks, so exact hatch/bus choices are still player-configured."
    ],
    requirements: [
      requirement("gtceu:greenhouse", 1, "controller"),
      requirement("gtceu:ulv_machine_casing", 5, "minimum casing"),
      requirement("minecraft:dirt", 9, "soil"),
      requirement("gtceu:tempered_glass", 9, "glass")
    ]
  }),
  lowerBoundStructure({
    controller: "gtceu:construction_core",
    name: "Construction Core Multiblock",
    description: "Lower-bound build requirements from the pack's KubeJS Construction Core pattern.",
    source: "kubejs/startup_scripts/machinery/construction_core.js",
    notes: [
      "The pattern contains 18 B positions; at least 5 must be LV Machine Casing.",
      "Remaining B positions may be casings or recipe ability blocks, so exact hatch/bus choices are still player-configured."
    ],
    requirements: [
      requirement("gtceu:construction_core", 1, "controller"),
      requirement("gtceu:lv_machine_casing", 5, "minimum casing"),
      requirement("gtceu:tempered_glass", 8, "glass"),
      requirement("gtceu:steel_gearbox", 1, "gearbox")
    ]
  }),
  standardStructure({
    controller: "gtceu:wooden_multiblock_tank",
    name: "Wooden Multiblock Tank Standard Build",
    description: "Standard 3x3x3 hollow tank build from GTCEu's multiblock tank pattern.",
    source: "GTCEu GTMachineUtils.registerMultiblockTank",
    notes: [
      "The pattern uses 25 wall positions around the hollow center plus the controller.",
      "The in-game shape preview places 1 valve. GTCEu allows up to 2 valves by replacing wall blocks."
    ],
    requirements: [
      requirement("gtceu:wooden_multiblock_tank", 1, "controller"),
      requirement("gtceu:wood_wall", 24, "tank wall"),
      requirement("gtceu:wooden_tank_valve", 1, "tank valve")
    ]
  }),
  standardStructure({
    controller: "gtceu:bronze_multiblock_tank",
    name: "Bronze Multiblock Tank Standard Build",
    description: "Standard 3x3x3 hollow tank build from GTCEu's multiblock tank pattern.",
    source: "GTCEu GTMachineUtils.registerMultiblockTank",
    notes: [
      "The pattern uses 25 casing positions around the hollow center plus the controller.",
      "The in-game shape preview places 1 valve. GTCEu allows up to 2 valves by replacing casing blocks."
    ],
    requirements: [
      requirement("gtceu:bronze_multiblock_tank", 1, "controller"),
      requirement("gtceu:bronze_brick_casing", 24, "tank casing"),
      requirement("gtceu:bronze_tank_valve", 1, "tank valve")
    ]
  }),
  standardStructure({
    controller: "gtceu:steel_multiblock_tank",
    name: "Steel Multiblock Tank Standard Build",
    description: "Standard 3x3x3 hollow tank build from GTCEu's multiblock tank pattern.",
    source: "GTCEu GTMachineUtils.registerMultiblockTank",
    notes: [
      "The pattern uses 25 casing positions around the hollow center plus the controller.",
      "The in-game shape preview places 1 valve. GTCEu allows up to 2 valves by replacing casing blocks."
    ],
    requirements: [
      requirement("gtceu:steel_multiblock_tank", 1, "controller"),
      requirement("gtceu:steel_machine_casing", 24, "tank casing"),
      requirement("gtceu:steel_tank_valve", 1, "tank valve")
    ]
  })
];

const structuresByController = new Map();
for (const structure of knownStructures) {
  structuresByController.set(structure.controller, structure);
}

for (const controller of CONTROLLER_ONLY_IDS) {
  if (!goodsById.has(controller)) {
    console.warn(`Skipping ${controller}: controller good is not present in ${PACK_DATA_PATH}.`);
    continue;
  }
  if (!structuresByController.has(controller)) {
    structuresByController.set(controller, controllerOnlyStructure(controller));
  }
}

const missingRequirementIds = [];
for (const structure of structuresByController.values()) {
  if (!goodsById.has(structure.controller)) {
    missingRequirementIds.push(`${structure.controller} (controller for ${structure.id})`);
  }
  for (const item of structure.requirements) {
    if (!goodsById.has(item.id)) {
      missingRequirementIds.push(`${item.id} (requirement for ${structure.id})`);
    }
  }
}

if (missingRequirementIds.length) {
  throw new Error(`Multiblock structure metadata references missing goods:\n${missingRequirementIds.join("\n")}`);
}

const output = {
  schema: "gtceu-planner-multiblock-structures-v1",
  generatedBy: "tools/build-multiblock-structures.mjs",
  description: "Supplemental multiblock build metadata for recipe-tree structure branches. Controller-only entries are intentionally marked until full formed-pattern exports are available.",
  structures: [...structuresByController.values()]
    .sort((a, b) => goodName(a.controller).localeCompare(goodName(b.controller)) || a.controller.localeCompare(b.controller))
};

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${output.structures.length} multiblock structures to ${OUTPUT_PATH}.`);
