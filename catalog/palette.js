export const DEFAULT_COLOR = '#23272e';

const colors = [
  ['Графитовый / Чёрный', DEFAULT_COLOR],
  ['Белый', '#f1f3f5'],
  ['Белый мрамор / Гранит', '#d8dadf'],
  ['Олива', '#556b2f'],
  ['Койот', '#8b6d4c'],
  ['Ультрамарин / Синий', '#1e56a0'],
  ['Красный', '#c0392b'],
  ['Золотой', '#d4af37'],
  ['Жёлтый', '#e6b800'],
  ['Полупрозрачный', '#beced5']
];

export function normalizeColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : DEFAULT_COLOR;
}

export function colorName(value) {
  return colors.find(([, hex]) => hex === value)?.[0] ?? 'Свой цвет ' + value;
}

export function mountPalette(fieldset, onChange, {translucent = false, live = false} = {}) {
  const swatches = document.createElement('div');
  swatches.className = 'palette-swatch-list';
  const customLabel = document.createElement('label');
  customLabel.className = 'palette-custom';
  customLabel.append('Свой цвет ');
  const custom = document.createElement('input');
  custom.type = 'color';
  customLabel.append(custom);
  const name = document.createElement('span');
  name.className = 'palette-name';
  name.setAttribute('aria-live', 'polite');
  const buttons = new Map();
  let value;
  function set(hex) {
    value = normalizeColor(hex);
    custom.value = value;
    name.textContent = colorName(value);
    for (const [color, button] of buttons) button.setAttribute('aria-pressed', String(color === value));
  }
  function choose(hex) {
    set(hex);
    onChange?.(value);
  }
  for (const [label, hex] of (translucent ? colors : colors.slice(0, -1))) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'palette-swatch';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.style.setProperty('--swatch', hex);
    button.addEventListener('click', () => choose(hex));
    buttons.set(hex, button);
    swatches.append(button);
  }
  custom.addEventListener('input', () => {
    if (live) choose(custom.value);
    else set(custom.value);
  });
  custom.addEventListener('change', () => choose(custom.value));
  fieldset.append(swatches, customLabel, name);
  set(DEFAULT_COLOR);
  return {set, get value() { return value; }};
}
