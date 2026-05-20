# KubeJS Exporter Notes

This is the reasoning behind the first exporter.

## Why `afterRecipes`

KubeJS exposes a server event named `afterRecipes`. Its event object can iterate the already loaded recipe list with `forEachRecipe(filter, consumer)`. That is the right moment for our export because Forge, GTCEu, and KubeJS recipe edits have already had a chance to contribute to the final graph.

Source: [KubeJS `AfterRecipesLoadedEventJS`](https://github.com/KubeJS-Mods/KubeJS/blob/2001/common/src/main/java/dev/latvian/mods/kubejs/recipe/AfterRecipesLoadedEventJS.java)

## Why GTCEu Recipes Need Special Handling

GTCEu machine recipes are not just vanilla item-in/item-out recipes. `GTRecipe` stores separate item, fluid, and per-tick content maps, plus duration and EU/t. The exporter reads those directly so the planner gets real machine math instead of lossy vanilla recipe data.

Sources:

- [GTCEu `GTRecipe`](https://github.com/GregTechCEu/GregTech-Modern/blob/1.20.1/src/main/java/com/gregtechceu/gtceu/api/recipe/GTRecipe.java)
- [GTCEu `GTRecipeCapabilities`](https://github.com/GregTechCEu/GregTech-Modern/blob/1.20.1/src/main/java/com/gregtechceu/gtceu/common/data/GTRecipeCapabilities.java)
- [GTCEu `Content`](https://github.com/GregTechCEu/GregTech-Modern/blob/1.20.1/src/main/java/com/gregtechceu/gtceu/api/recipe/content/Content.java)

## Ingredient Shape

GTCEu item ingredients can be sized wrappers around vanilla ingredients, and fluid ingredients have their own JSON shape. The exporter first tries to read each ingredient's JSON form because that preserves tags. If that fails, it falls back to the resolved item or fluid stacks.

Sources:

- [GTCEu `SizedIngredient`](https://github.com/GregTechCEu/GregTech-Modern/blob/1.20.1/src/main/java/com/gregtechceu/gtceu/api/recipe/ingredient/SizedIngredient.java)
- [GTCEu `FluidIngredient`](https://github.com/GregTechCEu/GregTech-Modern/blob/1.20.1/src/main/java/com/gregtechceu/gtceu/api/recipe/ingredient/FluidIngredient.java)

## Voltage And EU/t

Voltage tiers come from GTCEu constants. Recipe EU/t is read from GTCEu's lazy energy stacks.

Sources:

- [GTCEu `GTValues`](https://github.com/GregTechCEu/GregTech-Modern/blob/1.20.1/src/main/java/com/gregtechceu/gtceu/api/GTValues.java)
- [GTCEu `EnergyStack`](https://github.com/GregTechCEu/GregTech-Modern/blob/1.20.1/src/main/java/com/gregtechceu/gtceu/api/recipe/ingredient/EnergyStack.java)
