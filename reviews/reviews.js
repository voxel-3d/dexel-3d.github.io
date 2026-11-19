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

const reviewList = document.getElementById('review-list');
const listStatus = document.getElementById('review-list-status');

function renderReview({ name, rating, text }) {
  const card = document.createElement('article');
  card.className = 'review-card';

  const title = document.createElement('h3');
  title.textContent = name;
  const stars = document.createElement('div');
  stars.className = 'review-stars';
  stars.setAttribute('aria-label', 'Оценка: ' + rating + ' из 5');
  stars.textContent = '★'.repeat(rating) + '☆'.repeat(5 - rating);
  const quote = document.createElement('blockquote');
  quote.textContent = text;

  card.append(title, stars, quote);
  return card;
}

async function loadPublishedReviews() {
  try {
    const response = await fetch('published.ndjson', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Review list unavailable');

    const lines = (await response.text()).split(/\r?\n/).filter(line => line.trim() && !line.startsWith('#'));
    let published = 0;
    for (const line of lines) {
      try {
        const review = JSON.parse(line);
        if (!review || typeof review.name !== 'string' || !review.name.trim() ||
            typeof review.text !== 'string' || !review.text.trim() ||
            !Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5) continue;
        reviewList.append(renderReview(review));
        published++;
      } catch (error) {
        console.warn('Не удалось прочитать опубликованный отзыв.', error);
      }
    }
    listStatus.textContent = published ? '' : 'Здесь пока нет отзывов, оставленных на сайте.';
  } catch {
    listStatus.textContent = 'Список отзывов не загрузился. Обновите страницу чуть позже.';
  }
}

loadPublishedReviews();
