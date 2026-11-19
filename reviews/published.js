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
  listStatus.textContent = 'Загружаем отзывы…';
  try {
    const response = await fetch('../published.ndjson', { cache: 'no-cache' });
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
