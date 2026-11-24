// STL has no unit metadata. Keep the chosen mode and resolved unit with the metrics.
const MILLIMETRES = { mm: 1, m: 1000, in: 25.4 };

export function unitMode(value) {
  return Object.hasOwn(MILLIMETRES, value) ? value : 'auto';
}

export function millimetresPerUnit(value) {
  return MILLIMETRES[unitMode(value)] ?? 1;
}

export function scaleSTLMetrics(metrics, mode = 'auto') {
  const maximum = Math.max(metrics.width, metrics.depth, metrics.height);
  const unit = mode === 'auto' ? (maximum > 0 && maximum < 2 ? 'm' : 'mm') : mode;
  const scale = millimetresPerUnit(unit);
  return {
    width: metrics.width * scale,
    depth: metrics.depth * scale,
    height: metrics.height * scale,
    volume: metrics.volume === null ? null : metrics.volume * scale ** 3,
    unitMode: mode,
    stlUnit: unit
  };
}

export function normalizeStoredMetrics(metrics) {
  if (!metrics || metrics.stlUnit || !['width', 'depth', 'height'].every(
    key => Number.isFinite(metrics[key]) && metrics[key] >= 0
  ) || (metrics.volume !== null && (!Number.isFinite(metrics.volume) || metrics.volume < 0))) {
    return metrics;
  }
  // Legacy records already have volume in cm³ on the old assumption of millimetres.
  return scaleSTLMetrics(metrics);
}
