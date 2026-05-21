export function formatAmount(value, unit = "") {
  if (!Number.isFinite(value)) return "n/a";
  const abs = Math.abs(value);
  let scaled = value;
  let suffix = "";

  if (abs >= 1_000_000_000) {
    scaled = value / 1_000_000_000;
    suffix = "G";
  } else if (abs >= 1_000_000) {
    scaled = value / 1_000_000;
    suffix = "M";
  } else if (abs >= 1_000) {
    scaled = value / 1_000;
    suffix = "k";
  }

  const decimals = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
  const text = scaled.toFixed(decimals).replace(/\.?0+$/, "");
  return `${text}${suffix}${unit}`;
}

export function formatRate(value, unit = "/min") {
  return `${formatAmount(value)}${unit}`;
}

export function formatEu(value) {
  return `${formatAmount(value)} EU`;
}

export function formatAverageEut(recipe, runsPerMinute) {
  if (!recipe.eut || !recipe.durationTicks) return "0 EU/t";
  const average = (recipe.eut * recipe.durationTicks * runsPerMinute) / 1200;
  return `${formatAmount(average)} EU/t avg`;
}

export function formatDuration(ticks) {
  if (!ticks) return "instant";
  const seconds = ticks / 20;
  if (seconds < 60) return `${formatAmount(seconds)}s`;
  return `${formatAmount(seconds / 60)}m`;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
