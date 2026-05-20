// GTCEu Modern Planner exporter.
//
// Drop this file into a pack instance at:
//   kubejs/server_scripts/gtceu_planner_export.js
//
// It writes:
//   kubejs/exported/gtceu-planner-pack.json

var EXPORT_FILE = ["kubejs", "exported", "gtceu-planner-pack.json"];
var PACK_ID = "gregtech-modern-community-pack";
var PACK_NAME = "GregTech Community Pack Modern";
var PACK_VERSION = "1.14.5";
var MINECRAFT_VERSION = "1.20.1";
var LOADER = "Forge";

var KubeJsonIO = typeof JsonIO !== "undefined" ? JsonIO : loadClass("dev.latvian.mods.kubejs.util.JsonIO");
var BuiltInRegistries = loadClass("net.minecraft.core.registries.BuiltInRegistries");
var Registries = loadClass("net.minecraft.core.registries.Registries");
var ResourceLocation = loadClass("net.minecraft.resources.ResourceLocation");
var TagKey = loadClass("net.minecraft.tags.TagKey");
var UtilsJS = loadClass("dev.latvian.mods.kubejs.util.UtilsJS");
var GTRecipeCapabilities = loadClass("com.gregtechceu.gtceu.common.data.GTRecipeCapabilities");
var GTValues = loadClass("com.gregtechceu.gtceu.api.GTValues");
var gtceuPlannerExportDone = false;

ServerEvents.afterRecipes(function(event) {
  if (gtceuPlannerExportDone) return;
  tryPlannerExport(function(consumer) {
    event.forEachRecipe({}, consumer);
  }, "afterRecipes");
});

ServerEvents.tick(function(event) {
  if (gtceuPlannerExportDone) return;

  tryPlannerExport(function(consumer) {
    eachRecipeFromManager(event.server.getRecipeManager(), consumer);
  }, "serverTick");
});

function tryPlannerExport(eachRecipe, trigger) {
  try {
    runPlannerExport(eachRecipe, trigger);
  } catch (error) {
    gtceuPlannerExportDone = true;
    console.error("[GTCEu Planner] Export failed during " + trigger + ": " + error);
  }
}

function runPlannerExport(eachRecipe, trigger) {
  var exporter = createExporter();
  var counts = {
    trigger: trigger,
    total: 0,
    gtceu: 0,
    vanilla: 0,
    skipped: 0,
    errors: 0
  };

  eachRecipe(function(recipe) {
    counts.total += 1;

    try {
      if (isGTRecipe(recipe)) {
        if (exporter.addGTRecipe(recipe)) {
          counts.gtceu += 1;
        } else {
          counts.skipped += 1;
        }
      } else if (exporter.addVanillaRecipe(recipe)) {
        counts.vanilla += 1;
      } else {
        counts.skipped += 1;
      }
    } catch (error) {
      counts.errors += 1;
      exporter.warn("Failed to export recipe " + recipeId(recipe) + ": " + error);
    }
  });

  var pack = exporter.build(counts);
  var outputPath = EXPORT_FILE.join("/");
  KubeJsonIO.write(outputPath, pack);
  gtceuPlannerExportDone = true;

  console.info(
    "[GTCEu Planner] Exported " +
      pack.recipes.length +
      " recipes, " +
      pack.goods.length +
      " goods, and " +
      pack.tags.length +
      " tags to " +
      outputPath
  );

  if (counts.errors > 0 || pack.metadata.warningCount > 0) {
    console.warn(
      "[GTCEu Planner] Export finished with " +
        counts.errors +
        " recipe errors and " +
        pack.metadata.warningCount +
        " warnings. See metadata.warnings in the JSON."
    );
  }
}

function eachRecipeFromManager(recipeManager, consumer) {
  var recipes = null;

  try {
    recipes = recipeManager.getRecipes();
  } catch (error) {
  }

  if (!recipes) {
    try {
      recipes = recipeManager.byName.values();
    } catch (error2) {
    }
  }

  if (!recipes) {
    throw new Error("Could not read recipes from Minecraft RecipeManager.");
  }

  eachJava(recipes, consumer);
}

function createExporter() {
  var goodsById = {};
  var tagsById = {};
  var recipeTypesById = {};
  var recipes = [];
  var warnings = [];

  function addGood(kind, id, name, tagId) {
    id = normalizeId(id);
    if (!id || id === "minecraft:air" || id === "minecraft:empty") return null;

    var good = goodsById[id];
    if (!good) {
      good = {
        id: id,
        kind: kind,
        name: name || humanName(id),
        mod: id.split(":")[0],
        tags: []
      };
      goodsById[id] = good;
    } else if (name && good.name === humanName(id)) {
      good.name = name;
    }

    if (tagId && good.tags.indexOf(tagId) === -1) {
      good.tags.push(tagId);
    }

    return good;
  }

  function addTag(id, kind, entries) {
    id = stripHash(id);
    if (!id) return null;
    entries = entries && entries.length > 0 ? entries : resolveTagEntries(kind, id);

    var tag = tagsById[id];
    if (!tag) {
      tag = {
        id: id,
        kind: kind,
        name: humanName(id),
        entries: []
      };
      tagsById[id] = tag;
    }

    if (kind && !tag.kind) {
      tag.kind = kind;
    }

    eachArray(entries || [], function(entryId) {
      entryId = normalizeId(entryId);
      if (!entryId) return;
      if (tag.entries.indexOf(entryId) === -1) {
        tag.entries.push(entryId);
      }
      addGood(kind, entryId, null, id);
    });

    if (!tag.preferred && tag.entries.length > 0) {
      tag.preferred = tag.entries[0];
    }

    return tag;
  }

  function resolveTagEntries(kind, id) {
    if (!BuiltInRegistries || !Registries || !ResourceLocation || !TagKey) return [];

    if (kind === "item") {
      return registryEntriesFromTag(BuiltInRegistries.ITEM, Registries.ITEM, id);
    }

    if (kind === "fluid") {
      return registryEntriesFromTag(BuiltInRegistries.FLUID, Registries.FLUID, id);
    }

    return [];
  }

  function addRecipeType(type) {
    if (!type || !type.id) return null;
    var id = normalizeId(type.id);
    var existing = recipeTypesById[id];
    if (existing) return existing;

    recipeTypesById[id] = {
      id: id,
      name: type.name || humanName(id),
      category: type.category || id.split(":")[0],
      itemInputs: numberOr(type.itemInputs, 0),
      fluidInputs: numberOr(type.fluidInputs, 0),
      itemOutputs: numberOr(type.itemOutputs, 0),
      fluidOutputs: numberOr(type.fluidOutputs, 0)
    };

    return recipeTypesById[id];
  }

  function addGTRecipe(recipe) {
    if (!GTRecipeCapabilities) return false;

    var recipeType = fieldOrGetter(recipe, "recipeType", "getType");
    var recipeTypeId = addGTRecipeType(recipeType);
    var id = recipeId(recipe);
    var durationTicks = numberOr(fieldOrGetter(recipe, "duration", "getDuration"), 0);
    var inputs = [];
    var outputs = [];

    pushRecords(inputs, recordsFromGTContents(recipe.getInputContents(GTRecipeCapabilities.ITEM), "item", "input"), 1);
    pushRecords(inputs, recordsFromGTContents(recipe.getInputContents(GTRecipeCapabilities.FLUID), "fluid", "input"), 1);
    pushRecords(outputs, recordsFromGTContents(recipe.getOutputContents(GTRecipeCapabilities.ITEM), "item", "output"), 1);
    pushRecords(outputs, recordsFromGTContents(recipe.getOutputContents(GTRecipeCapabilities.FLUID), "fluid", "output"), 1);

    pushRecords(inputs, recordsFromGTContents(recipe.getTickInputContents(GTRecipeCapabilities.ITEM), "item", "input"), durationTicks, "tick");
    pushRecords(inputs, recordsFromGTContents(recipe.getTickInputContents(GTRecipeCapabilities.FLUID), "fluid", "input"), durationTicks, "tick");
    pushRecords(outputs, recordsFromGTContents(recipe.getTickOutputContents(GTRecipeCapabilities.ITEM), "item", "output"), durationTicks, "tick");
    pushRecords(outputs, recordsFromGTContents(recipe.getTickOutputContents(GTRecipeCapabilities.FLUID), "fluid", "output"), durationTicks, "tick");

    if (outputs.length === 0) return false;

    recipes.push({
      id: id,
      type: recipeTypeId,
      durationTicks: durationTicks,
      eut: getRecipeEut(recipe),
      inputs: inputs,
      outputs: outputs
    });

    return true;
  }

  function addVanillaRecipe(recipe) {
    var output = recipeResultStack(recipe);
    if (!output || stackIsEmpty(output)) return false;

    var outputs = [recordFromItemStack(output, null)];
    if (!outputs[0]) return false;

    var inputs = [];
    eachJava(recipe.getIngredients(), function(ingredient) {
      pushRecords(inputs, recordsFromItemValue(ingredient, "input"), 1);
    });

    var typeId = vanillaRecipeTypeId(recipe);
    addRecipeType({
      id: typeId,
      name: humanName(typeId),
      category: typeId.split(":")[0],
      itemInputs: inputs.length,
      fluidInputs: 0,
      itemOutputs: outputs.length,
      fluidOutputs: 0
    });

    recipes.push({
      id: recipeId(recipe),
      type: typeId,
      durationTicks: 0,
      eut: 0,
      inputs: inputs,
      outputs: outputs
    });

    return true;
  }

  function addGTRecipeType(recipeType) {
    var id = normalizeId(fieldOrGetter(recipeType, "registryName", "getRegistryName") || recipeType);
    var type = addRecipeType({
      id: id,
      name: humanName(id),
      category: id.split(":")[0],
      itemInputs: safeNumber(function() {
        return recipeType.getMaxInputs(GTRecipeCapabilities.ITEM);
      }, 0),
      fluidInputs: safeNumber(function() {
        return recipeType.getMaxInputs(GTRecipeCapabilities.FLUID);
      }, 0),
      itemOutputs: safeNumber(function() {
        return recipeType.getMaxOutputs(GTRecipeCapabilities.ITEM);
      }, 0),
      fluidOutputs: safeNumber(function() {
        return recipeType.getMaxOutputs(GTRecipeCapabilities.FLUID);
      }, 0)
    });
    return type.id;
  }

  function recordsFromGTContents(contents, kind, direction) {
    var records = [];
    eachJava(contents, function(content) {
      var value = fieldOrGetter(content, "content", "getContent");
      var converted = kind === "fluid" ? recordsFromFluidValue(value, direction) : recordsFromItemValue(value, direction);
      eachArray(converted, function(record) {
        records.push(decorateWithContent(record, content, direction));
      });
    });
    return records;
  }

  function recordsFromItemValue(value, direction) {
    var parsed = parseIngredientJson(value);
    var records = parsed ? itemRecordsFromJson(parsed, value) : [];

    if (records.length === 0) {
      records = itemRecordsFromStacks(value);
    }

    return records;
  }

  function recordsFromFluidValue(value, direction) {
    var parsed = parseIngredientJson(value);
    var records = parsed ? fluidRecordsFromJson(parsed, value) : [];

    if (records.length === 0) {
      records = fluidRecordsFromStacks(value);
    }

    return records;
  }

  function itemRecordsFromJson(json, source) {
    return itemRecordsFromJsonNode(json, source, 1);
  }

  function itemRecordsFromJsonNode(node, source, amount) {
    if (!node) return [];

    if (isArray(node)) {
      if (node.length === 0) return [];
      var first = itemRecordsFromJsonNode(node[0], source, amount);
      var alternatives = [];
      eachArray(node, function(option) {
        eachArray(itemRecordsFromJsonNode(option, source, amount), function(record) {
          if (record.kind !== "tag" && alternatives.indexOf(record.id) === -1) {
            alternatives.push(record.id);
          }
        });
      });
      if (first.length > 0 && alternatives.length > 1) {
        first[0].alternatives = alternatives;
      }
      return first;
    }

    if (node.type === "gtceu:sized") {
      return itemRecordsFromJsonNode(node.ingredient, source, numberOr(node.count, amount));
    }

    if (node.ingredient) {
      return itemRecordsFromJsonNode(node.ingredient, source, amount);
    }

    if (node.item) {
      var itemId = normalizeId(node.item);
      addGood("item", itemId, null, null);
      return [{ kind: "item", id: itemId, amount: amount }];
    }

    if (node.tag) {
      var tagId = stripHash(node.tag);
      var entries = itemEntryIds(source);
      addTag(tagId, "item", entries);
      return [{ kind: "tag", id: tagId, amount: amount }];
    }

    return [];
  }

  function fluidRecordsFromJson(json, source) {
    if (!json) return [];
    var amount = numberOr(json.amount, 1);
    return fluidRecordsFromValueNode(json.value, source, amount);
  }

  function fluidRecordsFromValueNode(node, source, amount) {
    if (!node) return [];

    if (isArray(node)) {
      if (node.length === 0) return [];
      var first = fluidRecordsFromValueNode(node[0], source, amount);
      var alternatives = [];
      eachArray(node, function(option) {
        eachArray(fluidRecordsFromValueNode(option, source, amount), function(record) {
          if (record.kind !== "tag" && alternatives.indexOf(record.id) === -1) {
            alternatives.push(record.id);
          }
        });
      });
      if (first.length > 0 && alternatives.length > 1) {
        first[0].alternatives = alternatives;
      }
      return first;
    }

    if (typeof node === "string") {
      if (node.indexOf("#") === 0) {
        var stringTagId = stripHash(node);
        addTag(stringTagId, "fluid", fluidEntryIds(source));
        return [{ kind: "tag", id: stringTagId, amount: amount }];
      }
      var stringFluidId = normalizeId(node);
      addGood("fluid", stringFluidId, null, null);
      return [{ kind: "fluid", id: stringFluidId, amount: amount }];
    }

    if (node.fluid) {
      var fluidId = normalizeId(node.fluid);
      addGood("fluid", fluidId, null, null);
      return [{ kind: "fluid", id: fluidId, amount: amount }];
    }

    if (node.tag) {
      var tagId = stripHash(node.tag);
      addTag(tagId, "fluid", fluidEntryIds(source));
      return [{ kind: "tag", id: tagId, amount: amount }];
    }

    return [];
  }

  function itemRecordsFromStacks(value) {
    var stacks = [];

    if (isItemStack(value)) {
      stacks.push(value);
    } else if (value && typeof value.getItems === "function") {
      eachJava(value.getItems(), function(stack) {
        stacks.push(stack);
      });
    }

    var first = null;
    var alternatives = [];

    eachArray(stacks, function(stack) {
      if (stackIsEmpty(stack)) return;
      var record = recordFromItemStack(stack, null);
      if (!record) return;
      if (!first) first = record;
      if (alternatives.indexOf(record.id) === -1) alternatives.push(record.id);
    });

    if (!first) return [];
    if (alternatives.length > 1) first.alternatives = alternatives;
    return [first];
  }

  function fluidRecordsFromStacks(value) {
    var stacks = [];

    if (isFluidStack(value)) {
      stacks.push(value);
    } else if (value && typeof value.getStacks === "function") {
      eachJava(value.getStacks(), function(stack) {
        stacks.push(stack);
      });
    }

    var first = null;
    var alternatives = [];

    eachArray(stacks, function(stack) {
      if (fluidStackIsEmpty(stack)) return;
      var record = recordFromFluidStack(stack, null);
      if (!record) return;
      if (!first) first = record;
      if (alternatives.indexOf(record.id) === -1) alternatives.push(record.id);
    });

    if (!first) return [];
    if (alternatives.length > 1) first.alternatives = alternatives;
    return [first];
  }

  function recordFromItemStack(stack, amount) {
    if (!stack || stackIsEmpty(stack)) return null;
    var itemId = normalizeId(BuiltInRegistries.ITEM.getKey(stack.getItem()));
    if (!itemId || itemId === "minecraft:air") return null;

    addGood("item", itemId, stackName(stack), null);

    var record = {
      kind: "item",
      id: itemId,
      amount: positiveAmount(amount, positiveAmount(stack.getCount(), 1))
    };

    if (safeBool(function() {
      return stack.hasTag();
    }, false)) {
      record.nbt = String(stack.getTag());
    }

    return record;
  }

  function recordFromFluidStack(stack, amount) {
    if (!stack || fluidStackIsEmpty(stack)) return null;
    var fluidId = normalizeId(BuiltInRegistries.FLUID.getKey(stack.getFluid()));
    if (!fluidId || fluidId === "minecraft:empty") return null;

    addGood("fluid", fluidId, fluidStackName(stack), null);

    return {
      kind: "fluid",
      id: fluidId,
      amount: positiveAmount(amount, positiveAmount(stack.getAmount(), 1))
    };
  }

  function decorateWithContent(record, content, direction) {
    var chance = numberOr(fieldOrGetter(content, "chance", "getChance"), 0);
    var maxChance = numberOr(fieldOrGetter(content, "maxChance", "getMaxChance"), 0);
    var tierChanceBoost = numberOr(fieldOrGetter(content, "tierChanceBoost", "getTierChanceBoost"), 0);

    if (direction === "input" && chance === 0 && maxChance > 0) {
      record.notConsumed = true;
    } else if (chance > 0 && maxChance > 0 && chance < maxChance) {
      record.chance = roundRatio(chance / maxChance);
    }

    if (tierChanceBoost !== 0) {
      record.tierChanceBoost = tierChanceBoost;
    }

    return record;
  }

  function pushRecords(target, records, multiplier, source) {
    eachArray(records, function(record) {
      if (!record || !record.id || record.amount <= 0) return;
      var copy = cloneRecord(record);
      copy.amount = roundAmount(copy.amount * multiplier);
      if (source) copy.source = source;
      target.push(copy);
    });
  }

  function itemEntryIds(source) {
    var ids = [];
    if (!source || typeof source.getItems !== "function") return ids;
    eachJava(source.getItems(), function(stack) {
      if (stackIsEmpty(stack)) return;
      var id = normalizeId(BuiltInRegistries.ITEM.getKey(stack.getItem()));
      if (id && ids.indexOf(id) === -1) ids.push(id);
    });
    return ids;
  }

  function fluidEntryIds(source) {
    var ids = [];
    if (!source || typeof source.getStacks !== "function") return ids;
    eachJava(source.getStacks(), function(stack) {
      if (fluidStackIsEmpty(stack)) return;
      var id = normalizeId(BuiltInRegistries.FLUID.getKey(stack.getFluid()));
      if (id && ids.indexOf(id) === -1) ids.push(id);
    });
    return ids;
  }

  function getRecipeEut(recipe) {
    var input = safeNumber(function() {
      return recipe.getInputEUt().getTotalEU();
    }, 0);
    var output = safeNumber(function() {
      return recipe.getOutputEUt().getTotalEU();
    }, 0);

    if (input > 0) return input;
    if (output > 0) return -output;
    return 0;
  }

  function build(counts) {
    return {
      schema: "gtceu-planner-pack-v1",
      metadata: {
        packId: PACK_ID,
        packName: PACK_NAME,
        packVersion: PACK_VERSION,
        minecraftVersion: MINECRAFT_VERSION,
        loader: LOADER,
        exporter: "kubejs-after-recipes-v1",
        exportedAt: new Date().toISOString(),
        recipeCounts: counts,
        warningCount: warnings.length,
        warnings: warnings
      },
      voltageTiers: voltageTiers(),
      goods: valuesSortedById(goodsById),
      tags: valuesSortedById(tagsById),
      recipeTypes: valuesSortedById(recipeTypesById),
      machines: [],
      recipes: recipes.sort(function(a, b) {
        return a.id.localeCompare(b.id);
      })
    };
  }

  function warn(message) {
    if (warnings.length < 200) {
      warnings.push(String(message));
    }
  }

  return {
    addGTRecipe: addGTRecipe,
    addVanillaRecipe: addVanillaRecipe,
    build: build,
    warn: warn
  };
}

function voltageTiers() {
  var tiers = [];

  if (GTValues) {
    eachJava(GTValues.ALL_TIERS, function(tier) {
      var index = numberOr(tier, 0);
      tiers.push({
        id: String(GTValues.VN[index]).toLowerCase(),
        name: String(GTValues.VN[index]),
        voltage: Number(GTValues.V[index])
      });
    });
  }

  if (tiers.length > 0) return tiers;

  return [
    { id: "ulv", name: "ULV", voltage: 8 },
    { id: "lv", name: "LV", voltage: 32 },
    { id: "mv", name: "MV", voltage: 128 },
    { id: "hv", name: "HV", voltage: 512 },
    { id: "ev", name: "EV", voltage: 2048 },
    { id: "iv", name: "IV", voltage: 8192 }
  ];
}

function isGTRecipe(recipe) {
  if (!recipe || typeof recipe.getClass !== "function") return false;
  var klass = recipe.getClass();
  while (klass) {
    if (String(klass.getName()) === "com.gregtechceu.gtceu.api.recipe.GTRecipe") return true;
    klass = klass.getSuperclass();
  }
  return false;
}

function parseIngredientJson(value) {
  if (!value || typeof value.toJson !== "function") return null;
  try {
    return JSON.parse(String(value.toJson()));
  } catch (error) {
    return null;
  }
}

function recipeId(recipe) {
  return normalizeId(fieldOrGetter(recipe, "id", "getId") || recipe);
}

function vanillaRecipeTypeId(recipe) {
  if (BuiltInRegistries && recipe && typeof recipe.getSerializer === "function") {
    var serializerId = normalizeId(BuiltInRegistries.RECIPE_SERIALIZER.getKey(recipe.getSerializer()));
    if (serializerId) return serializerId;
  }
  if (BuiltInRegistries && recipe && typeof recipe.getType === "function") {
    var typeId = normalizeId(BuiltInRegistries.RECIPE_TYPE.getKey(recipe.getType()));
    if (typeId) return typeId;
  }
  return "minecraft:unknown";
}

function recipeResultStack(recipe) {
  if (!recipe || typeof recipe.getResultItem !== "function" || !UtilsJS) return null;
  try {
    return recipe.getResultItem(UtilsJS.staticRegistryAccess);
  } catch (error) {
    return null;
  }
}

function fieldOrGetter(object, fieldName, getterName) {
  if (!object) return null;

  try {
    var value = object[fieldName];
    if (value !== undefined && value !== null) return value;
  } catch (error) {
  }

  if (getterName) {
    try {
      if (typeof object[getterName] === "function") {
        return object[getterName]();
      }
    } catch (error2) {
    }
  }

  return null;
}

function loadClass(name) {
  try {
    return Java.loadClass(name);
  } catch (error) {
    console.warn("[GTCEu Planner] Could not load Java class " + name + ": " + error);
    return null;
  }
}

function isArray(value) {
  return Object.prototype.toString.call(value) === "[object Array]";
}

function eachArray(items, callback) {
  if (!items) return;
  for (var i = 0; i < items.length; i += 1) {
    callback(items[i], i);
  }
}

function eachJava(items, callback) {
  if (!items) return;

  if (isArray(items) || typeof items.length === "number") {
    for (var i = 0; i < items.length; i += 1) {
      callback(items[i], i);
    }
    return;
  }

  if (typeof items.iterator === "function") {
    var iterator = items.iterator();
    var index = 0;
    while (iterator.hasNext()) {
      callback(iterator.next(), index);
      index += 1;
    }
  }
}

function registryEntriesFromTag(registry, registryKey, id) {
  var entries = [];

  try {
    var tagKey = TagKey.create(registryKey, new ResourceLocation(id));
    eachJava(registry.getTagOrEmpty(tagKey), function(holder) {
      var entryId = normalizeId(registry.getKey(holder.value()));
      if (entryId && entries.indexOf(entryId) === -1) {
        entries.push(entryId);
      }
    });
  } catch (error) {
  }

  return entries;
}

function valuesSortedById(dictionary) {
  var values = [];
  for (var id in dictionary) {
    if (Object.prototype.hasOwnProperty.call(dictionary, id)) {
      values.push(dictionary[id]);
    }
  }
  values.sort(function(a, b) {
    return a.id.localeCompare(b.id);
  });
  return values;
}

function cloneRecord(record) {
  var copy = {};
  for (var key in record) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      copy[key] = record[key];
    }
  }
  if (record.alternatives) {
    copy.alternatives = record.alternatives.slice(0);
  }
  return copy;
}

function isItemStack(value) {
  return value && typeof value.getItem === "function" && typeof value.getCount === "function";
}

function isFluidStack(value) {
  return value && typeof value.getFluid === "function" && typeof value.getAmount === "function";
}

function stackIsEmpty(stack) {
  if (!stack) return true;
  try {
    return stack.isEmpty();
  } catch (error) {
    return false;
  }
}

function fluidStackIsEmpty(stack) {
  if (!stack) return true;
  try {
    return stack.isEmpty();
  } catch (error) {
    return false;
  }
}

function stackName(stack) {
  try {
    return String(stack.getHoverName().getString());
  } catch (error) {
    return null;
  }
}

function fluidStackName(stack) {
  try {
    return String(stack.getDisplayName().getString());
  } catch (error) {
    return null;
  }
}

function normalizeId(value) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/^#/, "");
}

function stripHash(value) {
  return normalizeId(value);
}

function numberOr(value, fallback) {
  var number = Number(value);
  return isFinite(number) ? number : fallback;
}

function positiveAmount(value, fallback) {
  var number = numberOr(value, fallback);
  return number > 0 ? number : fallback;
}

function safeNumber(reader, fallback) {
  try {
    return numberOr(reader(), fallback);
  } catch (error) {
    return fallback;
  }
}

function safeBool(reader, fallback) {
  try {
    return Boolean(reader());
  } catch (error) {
    return fallback;
  }
}

function roundRatio(value) {
  return Math.round(value * 1000000) / 1000000;
}

function roundAmount(value) {
  return Math.round(value * 1000000) / 1000000;
}

function humanName(id) {
  var path = normalizeId(id).split(":").pop();
  path = path.replace(/[\/_]+/g, " ");
  return path.replace(/\b[a-z]/g, function(letter) {
    return letter.toUpperCase();
  });
}
