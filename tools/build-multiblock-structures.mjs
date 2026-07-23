import fs from "node:fs";

const PACK_DATA_PATH = "data/gtceu-modern-pack-1.14.5.json";
const OUTPUT_PATH = "data/multiblock-structures.json";
const GTCEU_SOURCE = "GTCEu v7.5.1-1.20.1 source multiblock patterns";

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

function requirements(list) {
  return list
    .filter(([, amount]) => amount > 0)
    .map(([id, amount, role]) => requirement(id, amount, role));
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

function standardFromSource({ controller, name, notes = [], requirements: parts }) {
  return standardStructure({
    controller,
    name: name ?? `${structureName(controller)} Standard Build`,
    description: "Standard build requirements from GTCEu's displayed multiblock pattern.",
    source: GTCEU_SOURCE,
    notes,
    requirements: requirements(parts)
  });
}

function lowerBoundFromSource({ controller, name, notes = [], requirements: parts }) {
  return lowerBoundStructure({
    controller,
    name: name ?? `${structureName(controller)} Lower-Bound Build`,
    description: "Minimum fixed structure costs from GTCEu's multiblock pattern. Configurable hatches, buses, and ability blocks can replace some casing positions.",
    source: GTCEU_SOURCE,
    notes,
    requirements: requirements(parts)
  });
}

function tiered(tier, part) {
  return `gtceu:${tier}_${part}`;
}

function commonConfigNotes(extra = []) {
  return [
    "The fixed casing/special-block counts come from the GTCEu pattern; buses, hatches, maintenance, mufflers, and parallel hatches may replace casing slots where the pattern permits.",
    "Use the in-game multiblock preview for final hatch placement and optional upgrades.",
    ...extra
  ];
}

function largeBoiler({ controller, casing, pipe, firebox }) {
  return standardFromSource({
    controller,
    notes: [
      "Uses a solid-fuel starter layout: one item input bus, one steam/fluid output hatch, one muffler, and one maintenance hatch.",
      "A fluid input hatch can replace the item bus if you build the boiler for fluid fuel."
    ],
    requirements: [
      [controller, 1, "controller"],
      [casing, 23, "boiler casing"],
      [pipe, 2, "pipe casing"],
      [firebox, 6, "firebox"],
      [tiered("lv", "input_bus"), 1, "solid fuel input"],
      [tiered("lv", "output_hatch"), 1, "steam output"],
      [tiered("lv", "muffler_hatch"), 1, "muffler"],
      ["gtceu:maintenance_hatch", 1, "maintenance"]
    ]
  });
}

function largeCombustionEngine({ controller, casing, gearbox, intake, tier }) {
  return standardFromSource({
    controller,
    notes: [
      "Uses the source standard frame with one fuel input hatch, one dynamo hatch, one muffler, and one maintenance hatch.",
      "Actual output depends on rotor/fuel tuning and generator behavior in-game."
    ],
    requirements: [
      [controller, 1, "controller"],
      [casing, 21, "engine casing"],
      [gearbox, 2, "gearbox"],
      [intake, 8, "intake casing"],
      [tiered(tier, "energy_output_hatch"), 1, "energy output"],
      [tiered(tier, "input_hatch"), 1, "fuel input"],
      [tiered(tier, "muffler_hatch"), 1, "muffler"],
      ["gtceu:maintenance_hatch", 1, "maintenance"]
    ]
  });
}

function largeTurbine({ controller, casing, gearbox, tier, needsMuffler }) {
  return standardFromSource({
    controller,
    notes: [
      "Includes one rotor holder, one dynamo hatch, one fluid input hatch, and maintenance.",
      needsMuffler ? "The gas turbine standard build also includes a muffler hatch." : "This source pattern does not require a muffler hatch."
    ],
    requirements: [
      [controller, 1, "controller"],
      [casing, needsMuffler ? 28 : 29, "turbine casing"],
      [gearbox, 2, "gearbox"],
      [tiered(tier, "rotor_holder"), 1, "rotor holder"],
      [tiered(tier, "energy_output_hatch"), 1, "energy output"],
      [tiered(tier, "input_hatch"), 1, "fluid input"],
      [needsMuffler ? tiered(tier, "muffler_hatch") : casing, needsMuffler ? 1 : 0, "muffler"],
      ["gtceu:maintenance_hatch", 1, "maintenance"]
    ]
  });
}

function fusionReactor({ controller, casing, coil, tier }) {
  return standardFromSource({
    controller,
    name: `${goodName(controller)} Standard Build`,
    notes: [
      "Uses the glass preview variant from GTCEu's fusion reactor shape info.",
      "The alternate preview can replace fusion glass with fusion casing."
    ],
    requirements: [
      [controller, 1, "controller"],
      [casing, 48, "fusion casing"],
      ["gtceu:fusion_glass", 31, "fusion glass"],
      [coil, 4, "fusion coil"],
      [tiered(tier, "energy_input_hatch"), 16, "energy input"],
      [tiered(tier, "input_hatch"), 16, "fluid input"],
      [tiered(tier, "output_hatch"), 16, "fluid output"]
    ]
  });
}

function fluidDrillingRig({ controller, casing, frame, tier }) {
  return standardFromSource({
    controller,
    notes: [
      "Standard utility layout with one energy input hatch and one fluid output hatch.",
      "Extra energy hatches can replace casing positions allowed by the pattern."
    ],
    requirements: [
      [controller, 1, "controller"],
      [casing, 9, "rig casing"],
      [frame, 15, "support frame"],
      [tiered(tier, "energy_input_hatch"), 1, "energy input"],
      [tiered(tier, "output_hatch"), 1, "fluid output"]
    ]
  });
}

function largeMiner({ controller, casing, frame, tier }) {
  return standardFromSource({
    controller,
    notes: [
      "Standard utility layout with one energy input hatch, one drilling-fluid input hatch, and one item output bus.",
      "Extra energy hatches can replace casing positions allowed by the pattern."
    ],
    requirements: [
      [controller, 1, "controller"],
      [casing, 8, "miner casing"],
      [frame, 15, "support frame"],
      [tiered(tier, "energy_input_hatch"), 1, "energy input"],
      [tiered(tier, "input_hatch"), 1, "drilling fluid input"],
      [tiered(tier, "output_bus"), 1, "item output"]
    ]
  });
}

function gcymLower({ controller, casing, minCasings, fixed = [], notes = [] }) {
  return lowerBoundFromSource({
    controller,
    notes: commonConfigNotes(notes),
    requirements: [
      [controller, 1, "controller"],
      [casing, minCasings, "minimum casing"],
      ...fixed
    ]
  });
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
    requirements: requirements([
      ["gtceu:steam_grinder", 1, "controller"],
      ["gtceu:steam_machine_casing", 22, "structure casing"],
      ["gtceu:steam_input_hatch", 1, "steam input"],
      ["gtceu:steam_input_bus", 1, "item input"],
      ["gtceu:steam_output_bus", 1, "item output"]
    ])
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
    requirements: requirements([
      ["gtceu:greenhouse", 1, "controller"],
      ["gtceu:ulv_machine_casing", 5, "minimum casing"],
      ["minecraft:dirt", 9, "soil"],
      ["gtceu:tempered_glass", 9, "glass"]
    ])
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
    requirements: requirements([
      ["gtceu:construction_core", 1, "controller"],
      ["gtceu:lv_machine_casing", 5, "minimum casing"],
      ["gtceu:tempered_glass", 8, "glass"],
      ["gtceu:steel_gearbox", 1, "gearbox"]
    ])
  }),
  standardFromSource({
    controller: "gtceu:wooden_multiblock_tank",
    name: "Wooden Multiblock Tank Standard Build",
    notes: ["GTCEu allows up to 2 valves by replacing wall blocks; the standard preview places 1 valve."],
    requirements: [
      ["gtceu:wooden_multiblock_tank", 1, "controller"],
      ["gtceu:wood_wall", 24, "tank wall"],
      ["gtceu:wooden_tank_valve", 1, "tank valve"]
    ]
  }),
  standardFromSource({
    controller: "gtceu:bronze_multiblock_tank",
    name: "Bronze Multiblock Tank Standard Build",
    notes: ["GTCEu allows up to 2 valves by replacing casing blocks; the standard preview places 1 valve."],
    requirements: [
      ["gtceu:bronze_multiblock_tank", 1, "controller"],
      ["gtceu:steam_machine_casing", 24, "tank casing"],
      ["gtceu:bronze_tank_valve", 1, "tank valve"]
    ]
  }),
  standardFromSource({
    controller: "gtceu:steel_multiblock_tank",
    name: "Steel Multiblock Tank Standard Build",
    notes: ["GTCEu allows up to 2 valves by replacing casing blocks; the standard preview places 1 valve."],
    requirements: [
      ["gtceu:steel_multiblock_tank", 1, "controller"],
      ["gtceu:solid_machine_casing", 24, "tank casing"],
      ["gtceu:steel_tank_valve", 1, "tank valve"]
    ]
  }),

  standardFromSource({
    controller: "gtceu:coke_oven",
    notes: ["The hollow 3x3x3 pattern allows up to 5 Coke Oven Hatches; the standard build uses 1 hatch and 24 bricks."],
    requirements: [
      ["gtceu:coke_oven", 1, "controller"],
      ["gtceu:coke_oven_bricks", 24, "coke oven bricks"],
      ["gtceu:coke_oven_hatch", 1, "hatch"]
    ]
  }),
  exactStructure({
    controller: "gtceu:primitive_blast_furnace",
    name: "Primitive Blast Furnace Multiblock",
    description: "Fixed Primitive Blast Furnace structure from GTCEu's multiblock pattern.",
    source: GTCEU_SOURCE,
    coverage: "exact",
    notes: ["The center air/snow positions are not counted as build ingredients."],
    requirements: requirements([
      ["gtceu:primitive_blast_furnace", 1, "controller"],
      ["gtceu:firebricks", 32, "primitive bricks"]
    ])
  }),
  exactStructure({
    controller: "gtceu:primitive_pump",
    name: "Primitive Pump Multiblock",
    description: "Fixed Primitive Pump structure from GTCEu's multiblock pattern.",
    source: GTCEU_SOURCE,
    notes: ["Counts the pump hatch variant shown by the source pattern."],
    requirements: requirements([
      ["gtceu:primitive_pump", 1, "controller"],
      ["gtceu:pump_deck", 10, "pump deck"],
      ["gtceu:treated_wood_frame", 10, "treated wood frame"],
      ["gtceu:pump_hatch", 1, "pump hatch"]
    ])
  }),
  standardFromSource({
    controller: "gtceu:steam_oven",
    notes: ["Uses one steam hatch, one steam input bus, and one steam output bus in the allowed positions."],
    requirements: [
      ["gtceu:steam_oven", 1, "controller"],
      ["gtceu:steam_machine_casing", 8, "steam machine casing"],
      ["gtceu:bronze_firebox_casing", 8, "bronze firebox"],
      ["gtceu:steam_input_hatch", 1, "steam input"],
      ["gtceu:steam_input_bus", 1, "item input"],
      ["gtceu:steam_output_bus", 1, "item output"]
    ]
  }),
  standardFromSource({
    controller: "gtceu:electric_blast_furnace",
    notes: ["Uses the lowest displayed coil option, Cupronickel, and LV hatch/bus previews."],
    requirements: [
      ["gtceu:electric_blast_furnace", 1, "controller"],
      ["gtceu:heatproof_machine_casing", 9, "heatproof casing"],
      ["gtceu:cupronickel_coil_block", 16, "heating coil"],
      [tiered("lv", "energy_input_hatch"), 2, "energy input"],
      [tiered("lv", "input_bus"), 1, "item input"],
      [tiered("lv", "output_bus"), 1, "item output"],
      [tiered("lv", "input_hatch"), 1, "fluid input"],
      [tiered("lv", "output_hatch"), 1, "fluid output"],
      [tiered("lv", "muffler_hatch"), 1, "muffler"],
      ["gtceu:maintenance_hatch", 1, "maintenance"]
    ]
  }),
  standardFromSource({
    controller: "gtceu:large_chemical_reactor",
    notes: ["Uses the first GTCEu shape preview with one Cupronickel coil and HV hatch/bus previews."],
    requirements: [
      ["gtceu:large_chemical_reactor", 1, "controller"],
      ["gtceu:inert_machine_casing", 18, "inert casing"],
      ["gtceu:ptfe_pipe_casing", 1, "PTFE pipe casing"],
      ["gtceu:cupronickel_coil_block", 1, "heating coil"],
      [tiered("hv", "energy_input_hatch"), 1, "energy input"],
      [tiered("hv", "input_bus"), 1, "item input"],
      [tiered("hv", "output_bus"), 1, "item output"],
      [tiered("hv", "input_hatch"), 1, "fluid input"],
      [tiered("hv", "output_hatch"), 1, "fluid output"],
      ["gtceu:maintenance_hatch", 1, "maintenance"]
    ]
  }),
  lowerBoundFromSource({
    controller: "gtceu:implosion_compressor",
    notes: commonConfigNotes(["The 3x3x3 hollow shell has 24 configurable X positions; at least 14 must be Solid Machine Casing."]),
    requirements: [
      ["gtceu:implosion_compressor", 1, "controller"],
      ["gtceu:solid_machine_casing", 14, "minimum casing"]
    ]
  }),
  standardFromSource({
    controller: "gtceu:pyrolyse_oven",
    notes: ["Uses the lowest displayed coil option, Cupronickel, and LV hatch/bus previews."],
    requirements: [
      ["gtceu:pyrolyse_oven", 1, "controller"],
      ["gtceu:ulv_machine_casing", 9, "ULV casing"],
      ["gtceu:cupronickel_coil_block", 16, "heating coil"],
      [tiered("lv", "energy_input_hatch"), 2, "energy input"],
      [tiered("lv", "input_bus"), 1, "item input"],
      [tiered("lv", "output_bus"), 1, "item output"],
      [tiered("lv", "input_hatch"), 1, "fluid input"],
      [tiered("lv", "output_hatch"), 1, "fluid output"],
      [tiered("lv", "muffler_hatch"), 1, "muffler"],
      ["gtceu:maintenance_hatch", 1, "maintenance"]
    ]
  }),
  standardFromSource({
    controller: "gtceu:multi_smelter",
    notes: ["Uses the lowest displayed coil option, Cupronickel, and LV hatch/bus previews."],
    requirements: [
      ["gtceu:multi_smelter", 1, "controller"],
      ["gtceu:heatproof_machine_casing", 11, "heatproof casing"],
      ["gtceu:cupronickel_coil_block", 8, "heating coil"],
      [tiered("lv", "energy_input_hatch"), 2, "energy input"],
      [tiered("lv", "input_bus"), 1, "item input"],
      [tiered("lv", "output_bus"), 1, "item output"],
      [tiered("lv", "muffler_hatch"), 1, "muffler"],
      ["gtceu:maintenance_hatch", 1, "maintenance"]
    ]
  }),
  standardFromSource({
    controller: "gtceu:cracker",
    notes: ["Uses the lowest displayed coil option, Cupronickel, and LV hatch/bus previews."],
    requirements: [
      ["gtceu:cracker", 1, "controller"],
      ["gtceu:clean_machine_casing", 18, "clean casing"],
      ["gtceu:cupronickel_coil_block", 16, "heating coil"],
      [tiered("lv", "energy_input_hatch"), 2, "energy input"],
      [tiered("lv", "input_bus"), 1, "item input"],
      [tiered("lv", "input_hatch"), 1, "fluid input"],
      [tiered("lv", "output_hatch"), 1, "fluid output"],
      [tiered("lv", "muffler_hatch"), 1, "muffler"],
      ["gtceu:maintenance_hatch", 1, "maintenance"]
    ]
  }),
  standardFromSource({
    controller: "gtceu:distillation_tower",
    notes: [
      "Uses the smallest one-layer tower preview.",
      "Each extra tower layer adds 7 Clean Machine Casings and 1 fluid output hatch."
    ],
    requirements: [
      ["gtceu:distillation_tower", 1, "controller"],
      ["gtceu:clean_machine_casing", 19, "clean casing"],
      [tiered("hv", "output_bus"), 1, "item output"],
      [tiered("hv", "input_hatch"), 1, "fluid input"],
      [tiered("hv", "output_hatch"), 2, "fluid output"],
      [tiered("hv", "energy_input_hatch"), 1, "energy input"],
      ["gtceu:maintenance_hatch", 1, "maintenance"]
    ]
  }),
  lowerBoundFromSource({
    controller: "gtceu:vacuum_freezer",
    notes: commonConfigNotes(["The 3x3x3 hollow shell has 24 configurable X positions; at least 14 must be Frost Proof Aluminium Machine Casing."]),
    requirements: [
      ["gtceu:vacuum_freezer", 1, "controller"],
      ["gtceu:frostproof_machine_casing", 14, "minimum casing"]
    ]
  }),
  lowerBoundFromSource({
    controller: "gtceu:assembly_line",
    notes: [
      "Minimum length is one start slice, three repeated input slices, and one end slice.",
      "Data hatch slots can use Assembly Line Grating for the bare structure, or data access hatches for recipe data.",
      "Fluid input hatches can replace solid casing in the F positions when recipes need fluids."
    ],
    requirements: [
      ["gtceu:assembly_line", 1, "controller"],
      ["gtceu:solid_machine_casing", 14, "minimum steel casing"],
      ["gtceu:laminated_glass", 10, "laminated glass"],
      ["gtceu:assembly_line_casing", 5, "assembly line casing"],
      ["gtceu:assembly_line_unit", 5, "assembly control casing"],
      ["gtceu:assembly_line_grating", 9, "grating/data slots"],
      [tiered("ulv", "input_bus"), 4, "item input"],
      [tiered("ulv", "output_bus"), 1, "item output"],
      [tiered("lv", "energy_input_hatch"), 1, "energy input"]
    ]
  }),

  largeBoiler({
    controller: "gtceu:bronze_large_boiler",
    casing: "gtceu:steam_machine_casing",
    pipe: "gtceu:bronze_pipe_casing",
    firebox: "gtceu:bronze_firebox_casing"
  }),
  largeBoiler({
    controller: "gtceu:steel_large_boiler",
    casing: "gtceu:solid_machine_casing",
    pipe: "gtceu:steel_pipe_casing",
    firebox: "gtceu:steel_firebox_casing"
  }),
  largeBoiler({
    controller: "gtceu:titanium_large_boiler",
    casing: "gtceu:stable_machine_casing",
    pipe: "gtceu:titanium_pipe_casing",
    firebox: "gtceu:titanium_firebox_casing"
  }),
  largeBoiler({
    controller: "gtceu:tungstensteel_large_boiler",
    casing: "gtceu:robust_machine_casing",
    pipe: "gtceu:tungstensteel_pipe_casing",
    firebox: "gtceu:tungstensteel_firebox_casing"
  }),
  largeCombustionEngine({
    controller: "gtceu:large_combustion_engine",
    casing: "gtceu:stable_machine_casing",
    gearbox: "gtceu:titanium_gearbox",
    intake: "gtceu:engine_intake_casing",
    tier: "ev"
  }),
  largeCombustionEngine({
    controller: "gtceu:extreme_combustion_engine",
    casing: "gtceu:robust_machine_casing",
    gearbox: "gtceu:tungstensteel_gearbox",
    intake: "gtceu:extreme_engine_intake_casing",
    tier: "iv"
  }),
  largeTurbine({
    controller: "gtceu:steam_large_turbine",
    casing: "gtceu:steel_turbine_casing",
    gearbox: "gtceu:steel_gearbox",
    tier: "hv",
    needsMuffler: false
  }),
  largeTurbine({
    controller: "gtceu:gas_large_turbine",
    casing: "gtceu:stainless_steel_turbine_casing",
    gearbox: "gtceu:stainless_steel_gearbox",
    tier: "ev",
    needsMuffler: true
  }),
  largeTurbine({
    controller: "gtceu:plasma_large_turbine",
    casing: "gtceu:tungstensteel_turbine_casing",
    gearbox: "gtceu:tungstensteel_gearbox",
    tier: "iv",
    needsMuffler: false
  }),

  fusionReactor({ controller: "gtceu:luv_fusion_reactor", casing: "gtceu:fusion_casing", coil: "gtceu:superconducting_coil", tier: "luv" }),
  fusionReactor({ controller: "gtceu:zpm_fusion_reactor", casing: "gtceu:fusion_casing_mk2", coil: "gtceu:fusion_coil", tier: "zpm" }),
  fusionReactor({ controller: "gtceu:uv_fusion_reactor", casing: "gtceu:fusion_casing_mk3", coil: "gtceu:fusion_coil", tier: "uv" }),

  fluidDrillingRig({ controller: "gtceu:mv_fluid_drilling_rig", casing: "gtceu:solid_machine_casing", frame: "gtceu:steel_frame", tier: "mv" }),
  fluidDrillingRig({ controller: "gtceu:hv_fluid_drilling_rig", casing: "gtceu:stable_machine_casing", frame: "gtceu:titanium_frame", tier: "hv" }),
  fluidDrillingRig({ controller: "gtceu:ev_fluid_drilling_rig", casing: "gtceu:robust_machine_casing", frame: "gtceu:tungsten_steel_frame", tier: "ev" }),
  largeMiner({ controller: "gtceu:ev_large_miner", casing: "gtceu:solid_machine_casing", frame: "gtceu:steel_frame", tier: "ev" }),
  largeMiner({ controller: "gtceu:iv_large_miner", casing: "gtceu:stable_machine_casing", frame: "gtceu:titanium_frame", tier: "iv" }),
  largeMiner({ controller: "gtceu:luv_large_miner", casing: "gtceu:robust_machine_casing", frame: "gtceu:tungsten_steel_frame", tier: "luv" }),

  standardFromSource({
    controller: "gtceu:cleanroom",
    notes: [
      "Uses the GTCEu cleanroom preview with Filter Casings; Sterilizing Filter Casings are an alternate filter option.",
      "Door upper/lower halves are counted as two Iron Door blocks in the planner."
    ],
    requirements: [
      ["gtceu:cleanroom", 1, "controller"],
      ["gtceu:plascrete", 75, "cleanroom wall"],
      ["gtceu:cleanroom_glass", 6, "cleanroom glass"],
      ["gtceu:filter_casing", 8, "filter casing"],
      [tiered("lv", "energy_input_hatch"), 1, "energy input"],
      ["gtceu:hv_item_passthrough_hatch", 1, "item passthrough"],
      ["gtceu:hv_fluid_passthrough_hatch", 1, "fluid passthrough"],
      ["gtceu:hv_machine_hull", 1, "machine hull"],
      ["gtceu:hv_diode", 1, "diode"],
      ["minecraft:iron_door", 2, "door"],
      ["gtceu:maintenance_hatch", 1, "maintenance"]
    ]
  }),
  lowerBoundFromSource({
    controller: "gtceu:active_transformer",
    notes: commonConfigNotes(["Remaining X positions are configurable transformer hatch slots."]),
    requirements: [
      ["gtceu:active_transformer", 1, "controller"],
      ["gtceu:high_power_casing", 12, "minimum casing"],
      ["gtceu:superconducting_coil", 1, "coil"]
    ]
  }),
  standardFromSource({
    controller: "gtceu:power_substation",
    notes: [
      "Uses the lowest-capacity battery preview entry available in the exported data.",
      "Battery blocks are configurable in-game; swap this branch to higher-tier batteries if your build uses them."
    ],
    requirements: [
      ["gtceu:power_substation", 1, "controller"],
      ["gtceu:palladium_substation", 44, "substation casing"],
      ["gtceu:laminated_glass", 57, "laminated glass"],
      ["gtceu:lv_lithium_battery", 18, "battery blocks"],
      [tiered("hv", "energy_input_hatch"), 1, "energy input"],
      [tiered("ev", "substation_input_hatch_64a"), 1, "substation input"],
      [tiered("hv", "energy_output_hatch"), 1, "energy output"],
      [tiered("ev", "substation_output_hatch_64a"), 1, "substation output"],
      ["gtceu:maintenance_hatch", 1, "maintenance"]
    ]
  }),
  exactStructure({
    controller: "gtceu:charcoal_pile_igniter",
    name: "Charcoal Pile Igniter Multiblock",
    description: "Fixed Charcoal Pile Igniter structure from GTCEu's multiblock pattern.",
    source: GTCEU_SOURCE,
    notes: ["Logs become the charcoal pile core; the controller replaces one dirt position."],
    requirements: requirements([
      ["gtceu:charcoal_pile_igniter", 1, "controller"],
      ["minecraft:dirt", 44, "dirt shell"],
      ["minecraft:bricks", 9, "brick cap"],
      ["minecraft:oak_log", 27, "log core"]
    ])
  }),
  standardFromSource({
    controller: "gtceu:central_monitor",
    notes: ["The B positions accept monitor blocks; this standard build uses basic GTCEu Monitors."],
    requirements: [
      ["gtceu:central_monitor", 1, "controller"],
      ["gtceu:monitor", 11, "monitor blocks"]
    ]
  }),
  standardFromSource({
    controller: "gtceu:research_station",
    notes: ["Uses the GTCEu source preview with the computation receiver, object holder, LuV energy hatch, and maintenance hatch."],
    requirements: [
      ["gtceu:research_station", 1, "controller"],
      ["gtceu:computer_casing", 58, "computer casing"],
      ["gtceu:advanced_computer_casing", 23, "advanced computer casing"],
      ["gtceu:computer_heat_vent", 14, "computer heat vent"],
      ["gtceu:object_holder", 1, "object holder"],
      ["gtceu:computation_receiver_hatch", 1, "computation receiver"],
      [tiered("luv", "energy_input_hatch"), 1, "energy input"],
      ["gtceu:maintenance_hatch", 1, "maintenance"]
    ]
  }),
  standardFromSource({
    controller: "gtceu:data_bank",
    notes: ["Uses a practical data-bank layout with three data access hatches and one optical data transmitter/receiver pair."],
    requirements: [
      ["gtceu:data_bank", 1, "controller"],
      ["gtceu:computer_heat_vent", 18, "computer heat vent"],
      ["gtceu:computer_casing", 13, "computer casing"],
      ["gtceu:high_power_casing", 6, "high power casing"],
      ["gtceu:data_access_hatch", 3, "data access"],
      ["gtceu:data_transmitter_hatch", 1, "data transmitter"],
      ["gtceu:data_receiver_hatch", 1, "data receiver"],
      [tiered("luv", "energy_input_hatch"), 1, "energy input"],
      ["gtceu:maintenance_hatch", 1, "maintenance"]
    ]
  }),
  standardFromSource({
    controller: "gtceu:network_switch",
    notes: ["Uses the source preview with one computation receiver and three computation transmitters."],
    requirements: [
      ["gtceu:network_switch", 1, "controller"],
      ["gtceu:computer_casing", 19, "computer casing"],
      ["gtceu:advanced_computer_casing", 1, "advanced computer casing"],
      ["gtceu:computation_receiver_hatch", 1, "computation receiver"],
      ["gtceu:computation_transmitter_hatch", 3, "computation transmitter"],
      [tiered("luv", "energy_input_hatch"), 1, "energy input"],
      ["gtceu:maintenance_hatch", 1, "maintenance"]
    ]
  }),
  standardFromSource({
    controller: "gtceu:high_performance_computation_array",
    notes: ["Uses the first GTCEu HPCA preview: six empty components, two heat sinks, and one computation component."],
    requirements: [
      ["gtceu:high_performance_computation_array", 1, "controller"],
      ["gtceu:advanced_computer_casing", 13, "advanced computer casing"],
      ["gtceu:computer_casing", 8, "computer casing"],
      ["gtceu:computer_heat_vent", 15, "computer heat vent"],
      ["gtceu:hpca_empty_component", 6, "empty HPCA component"],
      ["gtceu:hpca_heat_sink_component", 2, "HPCA heat sink"],
      ["gtceu:hpca_computation_component", 1, "HPCA computation"],
      ["gtceu:computation_transmitter_hatch", 1, "computation transmitter"],
      [tiered("luv", "energy_input_hatch"), 1, "energy input"],
      [tiered("lv", "input_hatch"), 1, "coolant input"],
      ["gtceu:maintenance_hatch", 1, "maintenance"]
    ]
  }),

  gcymLower({ controller: "gtceu:large_maceration_tower", casing: "gtceu:secure_maceration_casing", minCasings: 55, fixed: [["gtceu:crushing_wheels", 18, "crushing wheels"]] }),
  gcymLower({ controller: "gtceu:large_chemical_bath", casing: "gtceu:watertight_casing", minCasings: 55, fixed: [["gtceu:titanium_pipe_casing", 6, "titanium pipe casing"]] }),
  gcymLower({ controller: "gtceu:large_centrifuge", casing: "gtceu:vibration_safe_casing", minCasings: 40, fixed: [["gtceu:steel_pipe_casing", 4, "steel pipe casing"]] }),
  gcymLower({
    controller: "gtceu:large_mixer",
    casing: "gtceu:reaction_safe_mixing_casing",
    minCasings: 50,
    fixed: [
      ["gtceu:hastelloy_x_frame", 8, "Hastelloy-X frame"],
      ["gtceu:stainless_steel_gearbox", 1, "gearbox"],
      ["gtceu:titanium_pipe_casing", 11, "titanium pipe casing"]
    ]
  }),
  gcymLower({ controller: "gtceu:large_electrolyzer", casing: "gtceu:nonconducting_casing", minCasings: 30, fixed: [["gtceu:electrolytic_cell", 12, "electrolytic cell"]] }),
  gcymLower({ controller: "gtceu:large_electromagnet", casing: "gtceu:nonconducting_casing", minCasings: 35, fixed: [["gtceu:electrolytic_cell", 12, "electrolytic cell"]] }),
  gcymLower({ controller: "gtceu:large_packer", casing: "gtceu:robust_machine_casing", minCasings: 30 }),
  gcymLower({ controller: "gtceu:large_assembler", casing: "gtceu:large_scale_assembler_casing", minCasings: 40, fixed: [["gtceu:tempered_glass", 9, "tempered glass"]], notes: ["The pattern requires exactly one energy input hatch in a casing slot."] }),
  gcymLower({
    controller: "gtceu:large_circuit_assembler",
    casing: "gtceu:large_scale_assembler_casing",
    minCasings: 55,
    fixed: [
      ["gtceu:tempered_glass", 4, "tempered glass"],
      ["gtceu:assembly_line_grating", 10, "grating"],
      ["gtceu:tungstensteel_pipe_casing", 6, "tungstensteel pipe casing"]
    ],
    notes: ["The pattern requires exactly one energy input hatch in a casing slot."]
  }),
  gcymLower({
    controller: "gtceu:large_arc_smelter",
    casing: "gtceu:high_temperature_smelting_casing",
    minCasings: 45,
    fixed: [
      ["gtceu:molybdenum_disilicide_coil_block", 8, "fixed coil blocks"],
      [tiered("iv", "muffler_hatch"), 1, "muffler"]
    ]
  }),
  gcymLower({
    controller: "gtceu:large_engraving_laser",
    casing: "gtceu:laser_safe_engraving_casing",
    minCasings: 50,
    fixed: [
      ["gtceu:tempered_glass", 8, "tempered glass"],
      ["gtceu:assembly_line_grating", 8, "grating"],
      ["gtceu:tungstensteel_pipe_casing", 1, "tungstensteel pipe casing"]
    ]
  }),
  gcymLower({ controller: "gtceu:large_sifting_funnel", casing: "gtceu:vibration_safe_casing", minCasings: 50, fixed: [["gtceu:assembly_line_grating", 18, "grating"]] }),
  standardFromSource({
    controller: "gtceu:alloy_blast_smelter",
    notes: ["Uses the lowest displayed coil option, Cupronickel, and LV hatch/bus previews."],
    requirements: [
      ["gtceu:alloy_blast_smelter", 1, "controller"],
      ["gtceu:high_temperature_smelting_casing", 34, "smelting casing"],
      ["gtceu:cupronickel_coil_block", 24, "heating coil"],
      ["gtceu:heat_vent", 12, "heat vent"],
      [tiered("lv", "energy_input_hatch"), 2, "energy input"],
      [tiered("lv", "input_bus"), 1, "item input"],
      [tiered("lv", "input_hatch"), 1, "fluid input"],
      [tiered("lv", "output_hatch"), 1, "fluid output"],
      [tiered("lv", "muffler_hatch"), 1, "muffler"],
      ["gtceu:maintenance_hatch", 1, "maintenance"]
    ]
  }),
  gcymLower({ controller: "gtceu:large_autoclave", casing: "gtceu:watertight_casing", minCasings: 30, fixed: [["gtceu:steel_pipe_casing", 3, "steel pipe casing"]] }),
  gcymLower({
    controller: "gtceu:large_material_press",
    casing: "gtceu:stress_proof_casing",
    minCasings: 40,
    fixed: [
      ["gtceu:steel_gearbox", 3, "steel gearbox"],
      ["gtceu:tempered_glass", 3, "tempered glass"]
    ]
  }),
  gcymLower({
    controller: "gtceu:large_brewer",
    casing: "gtceu:corrosion_proof_casing",
    minCasings: 50,
    fixed: [
      ["gtceu:steel_pipe_casing", 3, "steel pipe casing"],
      ["gtceu:molybdenum_disilicide_coil_block", 8, "fixed coil blocks"]
    ]
  }),
  gcymLower({
    controller: "gtceu:large_cutter",
    casing: "gtceu:shock_proof_cutting_casing",
    minCasings: 65,
    fixed: [
      ["gtceu:tempered_glass", 6, "tempered glass"],
      ["gtceu:slicing_blades", 6, "slicing blades"]
    ]
  }),
  standardFromSource({
    controller: "gtceu:large_distillery",
    notes: ["Uses the smallest Large Distillery preview with one distillation layer and IV hatch previews."],
    requirements: [
      ["gtceu:large_distillery", 1, "controller"],
      ["gtceu:watertight_casing", 43, "watertight casing"],
      ["gtceu:steel_pipe_casing", 1, "steel pipe casing"],
      [tiered("iv", "parallel_hatch"), 1, "parallel hatch"],
      [tiered("iv", "input_hatch"), 1, "fluid input"],
      [tiered("iv", "output_bus"), 1, "item output"],
      [tiered("iv", "energy_input_hatch"), 1, "energy input"],
      [tiered("iv", "output_hatch"), 1, "fluid output"],
      ["gtceu:maintenance_hatch", 1, "maintenance"]
    ]
  }),
  gcymLower({ controller: "gtceu:large_extractor", casing: "gtceu:watertight_casing", minCasings: 25, fixed: [["gtceu:steel_pipe_casing", 2, "steel pipe casing"]] }),
  gcymLower({
    controller: "gtceu:large_extruder",
    casing: "gtceu:stress_proof_casing",
    minCasings: 40,
    fixed: [
      ["gtceu:titanium_pipe_casing", 4, "titanium pipe casing"],
      ["gtceu:tempered_glass", 4, "tempered glass"]
    ]
  }),
  gcymLower({ controller: "gtceu:large_solidifier", casing: "gtceu:watertight_casing", minCasings: 45, fixed: [["gtceu:steel_pipe_casing", 8, "steel pipe casing"]] }),
  gcymLower({ controller: "gtceu:large_wiremill", casing: "gtceu:stress_proof_casing", minCasings: 25, fixed: [["gtceu:titanium_gearbox", 2, "titanium gearbox"]] }),
  standardFromSource({
    controller: "gtceu:mega_blast_furnace",
    name: "Rotary Hearth Furnace Standard Build",
    notes: ["Uses the lowest displayed coil option, Cupronickel, and the source standard hatch preview."],
    requirements: [
      ["gtceu:mega_blast_furnace", 1, "controller"],
      ["gtceu:high_temperature_smelting_casing", 382, "smelting casing"],
      ["gtceu:cupronickel_coil_block", 96, "heating coil"],
      ["gtceu:naquadah_alloy_frame", 132, "Naquadah Alloy frame"],
      ["gtceu:heat_vent", 20, "heat vent"],
      ["gtceu:robust_machine_casing", 88, "robust casing"],
      ["gtceu:tungstensteel_pipe_casing", 72, "tungstensteel pipe casing"],
      ["gtceu:tungstensteel_firebox_casing", 28, "tungstensteel firebox"],
      ["gtceu:extreme_engine_intake_casing", 40, "intake casing"],
      [tiered("lv", "energy_input_hatch"), 2, "energy input"],
      [tiered("lv", "input_bus"), 1, "item input"],
      [tiered("lv", "output_bus"), 1, "item output"],
      [tiered("lv", "input_hatch"), 1, "fluid input"],
      [tiered("lv", "output_hatch"), 1, "fluid output"],
      [tiered("lv", "muffler_hatch"), 1, "muffler"],
      ["gtceu:maintenance_hatch", 1, "maintenance"]
    ]
  }),
  gcymLower({
    controller: "gtceu:mega_vacuum_freezer",
    casing: "gtceu:frostproof_machine_casing",
    minCasings: 140,
    fixed: [
      ["gtceu:clean_machine_casing", 36, "clean casing"],
      ["gtceu:heat_vent", 26, "heat vent"],
      ["gtceu:tungstensteel_pipe_casing", 74, "tungstensteel pipe casing"],
      ["gtceu:tempered_glass", 9, "tempered glass"]
    ]
  })
];

const structuresByController = new Map();
for (const structure of knownStructures) {
  if (!goodsById.has(structure.controller)) {
    console.warn(`Skipping ${structure.controller}: controller good is not present in ${PACK_DATA_PATH}.`);
    continue;
  }
  if (structuresByController.has(structure.controller)) {
    throw new Error(`Duplicate multiblock structure metadata for ${structure.controller}.`);
  }
  structuresByController.set(structure.controller, structure);
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

const controllerOnlyStructures = [...structuresByController.values()].filter((structure) => structure.coverage === "controller-only");
if (controllerOnlyStructures.length) {
  throw new Error(`Controller-only multiblock structures are not allowed:\n${controllerOnlyStructures.map((structure) => structure.controller).join("\n")}`);
}

const output = {
  schema: "gtceu-planner-multiblock-structures-v1",
  generatedBy: "tools/build-multiblock-structures.mjs",
  description: "Supplemental multiblock build metadata for recipe-tree structure branches. Entries use exact, standard, or lower-bound GTCEu structure costs instead of controller-only scaffolds.",
  structures: [...structuresByController.values()]
    .sort((a, b) => goodName(a.controller).localeCompare(goodName(b.controller)) || a.controller.localeCompare(b.controller))
};

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${output.structures.length} multiblock structures to ${OUTPUT_PATH}.`);
