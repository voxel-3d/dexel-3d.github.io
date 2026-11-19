const form = document.getElementById('review-form');
const button = form.querySelector('[type="submit"]');
const status = document.getElementById('review-status');
const result = document.getElementById('review-result');
const photoInput = document.getElementById('review-photo');
const endpoint = 'https://voxel-3d-reviews-api.satinhyacinth.chatgpt.site/reviews';

async function preparePhoto(file) {
  if (file.size > 15000000) throw new Error('Выберите фото размером до 15 МБ.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Выберите фото в JPG, PNG или WebP.');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try { await image.decode(); } catch { throw new Error('Не удалось открыть фото. Выберите другой файл.'); }
    const scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.7, 0.55, 0.4]) {
      const photo = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (photo && photo.size <= 900000) return photo;
    }
    throw new Error('Не удалось уменьшить фото. Выберите меньший файл.');
  } finally { URL.revokeObjectURL(url); }
}

form.addEventListener('input', event => {
  if (event.target.validity?.customError) event.target.setCustomValidity('');
  result.hidden = true;
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (button.disabled) return;
  const body = new FormData(form);
  for (const name of ['name', 'text']) {
    const input = form.elements.namedItem(name);
    body.set(name, input.value.trim());
    input.setCustomValidity(input.value.trim() ? '' : 'Заполните это поле.');
  }
  if (!form.reportValidity()) return;

  result.hidden = true;
  button.disabled = true;
  status.dataset.state = '';
  status.textContent = 'Публикуем отзыв…';
  try {
    const file = photoInput.files[0];
    if (file) body.set('photo', await preparePhoto(file), 'review.jpg');
    else body.delete('photo');
    const response = await fetch(endpoint, { method: 'POST', body });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.id) {
      throw new Error(data?.error || 'Сайт не подтвердил публикацию. Попробуйте позже.');
    }
    form.reset();
    status.textContent = 'Спасибо! Отзыв опубликован.';
    status.dataset.state = 'success';
    result.hidden = false;
  } catch (error) {
    status.textContent = error instanceof TypeError
      ? 'Не удалось связаться с сайтом. Проверьте подключение и попробуйте ещё раз.'
      : error.message;
    status.dataset.state = 'error';
  } finally { button.disabled = false; }
});
