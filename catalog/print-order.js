import { colorName, mountPalette } from './palette.js?v=1';
const MATERIALS = {
  PETG: { density: 1.27, multiplier: 1 },
  PLA: { density: 1.24, multiplier: 1.2 },
  ABS: { density: 1.04, multiplier: 1.1 }
};
const STRENGTHS = { 15: 'Декор', 25: 'Стандарт', 50: 'Усиленная', 100: 'Монолит' };
const MIN_ORDER = 200;
const ESTIMATE_PER_GRAM = 6;
const format = new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 1});

export function initPrintOrder({readMetrics, modelURL, recordOrder}) {
  const $ = id => document.getElementById(id);
  const dialog = $('print-dialog');
  const form = $('print-form');
  const material = form.elements.namedItem('material');
  const strength = form.elements.namedItem('strength');
  const quantity = form.elements.namedItem('quantity');
  const palette = mountPalette($('print-palette'), undefined, {translucent: true});
  let entry;
  let loading = false;
  let version = 0;
  function calculate() {
    const plastic = MATERIALS[material.value];
    const count = quantity.valueAsNumber;
    const infill = Number(strength.value);
    const volume = entry?.metrics?.volume;
    if (!quantity.validity.valid) {
      $('print-estimate').textContent = 'Введите целое количество от 1 до 10 000.';
      return;
    }
    const grams = volume > 0 ? volume * plastic.density * infill / 100 : null;
    const estimate = grams === null ? NaN : Math.max(MIN_ORDER, Math.ceil(grams * plastic.multiplier * ESTIMATE_PER_GRAM * count));
    const price = Number.isSafeInteger(estimate) ? estimate : null;
    $('print-estimate').textContent = price === null
      ? (loading ? 'Рассчитываем объём модели…' : 'Объём недоступен. Стоимость уточнит мастерская.')
      : `Объём: ${format.format(volume)} см³ · Пластик: ≈ ${format.format(grams * count)} г · Тираж: ≈ ${format.format(price)} ₽`;
    const params = new URLSearchParams({
      model: entry.title, modelId: entry.id, material: material.value, color: colorName(palette.value),
      strength: `${STRENGTHS[infill]} (${infill}% заполнения)`, qty: String(count)
    });
    if (!entry.file) params.set('modelURL', modelURL(entry));
    if (price !== null) params.set('estimate', String(price));
    return '../#request?' + params;
  }
  form.addEventListener('input', calculate);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const href = calculate();
    if (!href) return;
    const submit = form.querySelector('[type=submit]');
    if (submit.disabled) return;
    submit.disabled = true;
    recordOrder(entry, href);
  });
  $('print-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (!dialog.open) version++; });
  return async (model, color = model.color) => {
    entry = model;
    const revision = ++version;
    form.reset();
    palette.set(color);
    form.querySelector('[type=submit]').disabled = false;
    $('print-title').textContent = model.title;
    loading = !model.metrics;
    calculate();
    if (!dialog.open) dialog.showModal();
    if (!loading) return;
    try { await readMetrics(model); }
    catch { /* A quote request remains available without a mesh volume. */ }
    if (revision !== version || !dialog.open) return;
    loading = false;
    calculate();
  };
}
