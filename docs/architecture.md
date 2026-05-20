# Architecture

## Goal

Build a calculator for GregTech Community Pack Modern that can browse recipes, choose target products, and estimate required production chains, machines, power, and inputs.

We are writing our own code. The GTNH calculator is useful mainly because it proves the product model:

- normalize game data into an app-friendly repository
- let the user select products and recipes
- solve rates and leftovers
- display the results in a fast local browser UI

## Main Pieces

### 1. Pack Exporter

The exporter runs against a real GregTech Community Pack Modern instance. Its job is to collect the final, post-KubeJS recipe graph, not just the base mod recipes.

That distinction matters because the pack can add, remove, or replace recipes with KubeJS.

### 2. Normalized Pack Data

The app reads a plain JSON file with items, fluids, tags, recipe types, machines, voltage tiers, and recipes.

The app should not know whether that JSON came from KubeJS, a Forge helper mod, a server command, or a manual fixture.

### 3. Repository

The repository turns the JSON into lookup maps:

- goods by id
- recipes by output
- recipes by input
- tags and preferred tag representatives
- recipe type and voltage metadata

This layer keeps the UI from doing repeated scans through the raw data.

### 4. Planner

The initial planner is deliberately simple: it recursively picks a recipe for a requested product, scales recipe rates, and reports unresolved inputs.

Later, this should grow into a real constraint solver so it can handle:

- alternative recipes
- byproduct balancing
- loops
- tag substitutions
- fixed machine counts
- reusable catalysts and non-consumed inputs

### 5. UI

The UI should feel like a workbench, not a marketing site. The first screen is the calculator: targets, plan, external inputs, and recipe browser.

## Why JSON First

GTNH's reference app uses a compact binary format for speed. That is smart for a mature dataset, but early on JSON is better because it is inspectable and easy to debug.

Once the exporter is stable and the data gets large, we can add a compiled data format without changing the app's domain model.
