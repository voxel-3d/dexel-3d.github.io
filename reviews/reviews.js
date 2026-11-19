const reviewForm = document.getElementById('review-form');
const reviewStatus = document.getElementById('review-status');
const reviewFallback = document.getElementById('review-mail-fallback');
const reviewButton = reviewForm.querySelector('[type="submit"]');
const reviewEndpoint = 'https://functions.yandexcloud.net/d4evt0q80matet5dunuk?route=api/send-order';

function setReviewStatus(message, state = '') {
  reviewStatus.textContent = message;
  reviewStatus.dataset.state = state;
}

reviewForm.addEventListener('input', event => {
  if (event.target.validity?.customError) event.target.setCustomValidity('');
  reviewFallback.hidden = true;
});

reviewForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (reviewButton.disabled) return;

  const fields = new FormData(reviewForm);
  const name = String(fields.get('name') ?? '').trim();
  const text = String(fields.get('text') ?? '').trim();
  const rating = Number(fields.get('rating'));
  const email = String(fields.get('email') ?? '').trim();
  const nameField = reviewForm.elements.namedItem('name');
  const textField = reviewForm.elements.namedItem('text');

  nameField.setCustomValidity(name ? '' : 'Укажите имя или псевдоним.');
  textField.setCustomValidity(text ? '' : 'Напишите отзыв.');
  if (!reviewForm.reportValidity() || !Number.isInteger(rating) || rating < 1 || rating > 5) return;

  const publicationLine = JSON.stringify({ name, rating, text })
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const description = 'Отзыв с сайта Voxel 3D. Требуется модерация.\n\n'
    + 'Если вы одобрили отзыв, скопируйте строку ниже в reviews/published.ndjson:\n'
    + publicationLine;
  reviewFallback.href = 'mailto:voxel3d.shop@yandex.ru?subject='
    + encodeURIComponent('[Отзыв] Voxel 3D') + '&body=' + encodeURIComponent(description);
  reviewFallback.hidden = true;

  reviewButton.disabled = true;
  setReviewStatus('Отправляем отзыв…');
  try {
    const response = await fetch(reviewEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        item: '[Отзыв] Voxel 3D',
        quantity: 1,
        description,
        contact: email
      })
    });
    const data = await response.json();
    if (!response.ok || data.ok !== true) throw new Error('Review delivery was not confirmed');

    reviewForm.reset();
    setReviewStatus('Спасибо! Отзыв отправлен на модерацию.', 'success');
  } catch {
    setReviewStatus('Сайт не смог подтвердить отправку. Можно попробовать ещё раз или отправить отзыв на почту.', 'error');
    reviewFallback.hidden = false;
  } finally {
    reviewButton.disabled = false;
  }
});
