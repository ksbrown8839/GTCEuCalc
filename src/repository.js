export class Repository {
  constructor(data) {
    if (data.schema !== "gtceu-planner-pack-v1") {
      throw new Error(`Unsupported data schema: ${data.schema}`);
    }

    this.data = data;
    this.metadata = data.metadata;
    this.goods = new Map(data.goods.map((good) => [good.id, good]));
    this.tags = new Map(data.tags.map((tag) => [tag.id, tag]));
    this.recipeTypes = new Map(data.recipeTypes.map((type) => [type.id, type]));
    this.voltageTiers = new Map(data.voltageTiers.map((tier) => [tier.id, tier]));
    this.machines = new Map(data.machines.map((machine) => [machine.id, machine]));
    this.recipes = data.recipes;
    this.recipesByOutput = new Map();
    this.recipesByInput = new Map();

    for (const recipe of this.recipes) {
      for (const output of recipe.outputs) {
        this.addToIndex(this.recipesByOutput, output.id, recipe);
      }
      for (const input of recipe.inputs) {
        this.addToIndex(this.recipesByInput, input.id, recipe);
      }
    }
  }

  addToIndex(index, id, recipe) {
    const list = index.get(id) ?? [];
    list.push(recipe);
    index.set(id, list);
  }

  getGood(id) {
    return this.goods.get(id) ?? null;
  }

  getRecipeType(id) {
    return this.recipeTypes.get(id) ?? { id, name: id, category: "unknown" };
  }

  getTag(id) {
    return this.tags.get(id) ?? null;
  }

  getGoodName(id) {
    return this.getGood(id)?.name ?? id;
  }

  getIngredientName(ingredient) {
    if (ingredient.kind === "tag") {
      const tag = this.getTag(ingredient.id);
      return tag ? `#${tag.name}` : `#${ingredient.id}`;
    }
    return this.getGoodName(ingredient.id);
  }

  getIngredientColor(ingredient) {
    if (ingredient.kind === "tag") {
      const resolved = this.resolveIngredient(ingredient);
      return resolved.good?.color ?? "#7d8790";
    }
    return this.getGood(ingredient.id)?.color ?? "#7d8790";
  }

  resolveIngredient(ingredient) {
    if (ingredient.kind !== "tag") {
      return {
        ingredient,
        id: ingredient.id,
        good: this.getGood(ingredient.id),
        warning: null
      };
    }

    const tag = this.getTag(ingredient.id);
    const selected = tag?.preferred ?? tag?.entries?.[0];
    return {
      ingredient,
      id: selected ?? ingredient.id,
      good: selected ? this.getGood(selected) : null,
      warning: selected
        ? `Used ${this.getGoodName(selected)} for #${ingredient.id}`
        : `No item available for #${ingredient.id}`
    };
  }

  findRecipesProducing(goodsId) {
    return this.recipesByOutput.get(goodsId) ?? [];
  }

  findRecipesUsing(goodsId) {
    return this.recipesByInput.get(goodsId) ?? [];
  }

  chooseRecipeForOutput(goodsId, preferences = {}) {
    const preferredRecipe = preferences[goodsId];
    const recipes = this.findRecipesProducing(goodsId);
    if (preferredRecipe) {
      const match = recipes.find((recipe) => recipe.id === preferredRecipe);
      if (match) return match;
    }
    return recipes[0] ?? null;
  }

  searchGoods(query, limit = 80) {
    const normalized = query.trim().toLowerCase();
    const goods = [...this.goods.values()];
    if (!normalized) return goods.slice(0, limit);

    return goods
      .map((good) => {
        return {
          good,
          score: scoreGoodSearchMatch(good, normalized)
        };
      })
      .filter((match) => match.score !== null)
      .sort((a, b) => a.score - b.score || a.good.name.localeCompare(b.good.name) || a.good.id.localeCompare(b.good.id))
      .slice(0, limit)
      .map((match) => match.good);
  }

  searchRecipes(query) {
    const normalized = query.trim().toLowerCase();
    const recipes = this.recipes;
    if (!normalized) return recipes.slice(0, 80);

    return recipes
      .filter((recipe) => {
        const type = this.getRecipeType(recipe.type).name.toLowerCase();
        const outputs = recipe.outputs.map((output) => this.getGoodName(output.id).toLowerCase()).join(" ");
        const inputs = recipe.inputs.map((input) => this.getIngredientName(input).toLowerCase()).join(" ");
        return recipe.id.toLowerCase().includes(normalized) || type.includes(normalized) || outputs.includes(normalized) || inputs.includes(normalized);
      })
      .slice(0, 80);
  }
}

function scoreGoodSearchMatch(good, query) {
  const name = good.name.toLowerCase();
  const id = good.id.toLowerCase();
  const mod = good.mod.toLowerCase();
  const tags = good.tags ?? [];

  if (name === query || id === query) return 0;
  if (name.startsWith(query)) return 1;
  if (id.startsWith(query)) return 2;
  if (name.includes(query)) return 3;
  if (id.includes(query)) return 4;
  if (tags.some((tag) => tag.toLowerCase().includes(query))) return 5;
  if (mod.includes(query)) return 6;
  return null;
}

export async function loadRepository(url = "data/sample-pack.json") {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load pack data: ${response.status}`);
  }
  const data = await response.json();
  return new Repository(data);
}
