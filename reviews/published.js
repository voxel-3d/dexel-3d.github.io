const reviewList = document.getElementById('review-list');
const listStatus = document.getElementById('review-list-status');

const endpoint = 'https://voxel-3d-reviews-api.satinhyacinth.chatgpt.site';
const more = document.getElementById('review-more');
let cursor = null;
const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeZone: 'Europe/Moscow' });

function renderReview({ id, name, rating, text, hasPhoto, createdAt }) {
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

  card.append(title);
  const writtenAt = new Date(createdAt);
  if (Number.isFinite(writtenAt.getTime())) {
    const date = document.createElement('time');
    date.className = 'published-review-date';
    date.dateTime = createdAt;
    date.textContent = dateFormat.format(writtenAt);
    card.append(date);
  }
  card.append(stars, quote);
  if (hasPhoto && /^\d{13}-[0-9a-f-]{36}$/.test(id)) {
    const link = document.createElement('a');
    link.className = 'published-review-photo';
    link.href = endpoint + '/photos/' + id;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', 'Открыть фото к отзыву');
    const photo = document.createElement('img');
    photo.src = link.href;
    photo.alt = 'Фото изделия к отзыву';
    photo.loading = 'lazy';
    link.append(photo);
    card.append(link);
  }
  return card;
}

function appendReviews(reviews, prepend = false) {
  const cards = [];
  for (const review of reviews) {
    if (!review || typeof review.name !== 'string' || !review.name.trim() ||
        typeof review.text !== 'string' || !review.text.trim() ||
        !Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5) continue;
    cards.push(renderReview(review));
  }
  if (prepend) reviewList.prepend(...cards);
  else reviewList.append(...cards);
}

async function loadOldReviews() {
  const response = await fetch('../published.ndjson', { cache: 'no-cache' });
  if (!response.ok) throw new Error('Review archive unavailable');
  const lines = (await response.text()).split(/\r?\n/).filter(line => line.trim() && !line.startsWith('#'));
  appendReviews(lines.map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }));
}

async function loadNewReviews() {
  more.disabled = true;
  try {
    const query = cursor ? '?cursor=' + encodeURIComponent(cursor) : '';
    const response = await fetch(endpoint + '/reviews' + query, { cache: 'no-store' });
    if (!response.ok) throw new Error('Review service unavailable');
    const page = await response.json();
    appendReviews(page.reviews, !cursor);
    cursor = page.cursor;
    more.hidden = !cursor;
    listStatus.textContent = '';
  } catch {
    listStatus.textContent = 'Не удалось загрузить новые отзывы.';
    more.hidden = false;
  } finally {
    more.disabled = false;
  }
}

more.addEventListener('click', loadNewReviews);

async function loadPublishedReviews() {
  listStatus.textContent = 'Загружаем отзывы…';
  const oldReviews = loadOldReviews().catch(() => false);
  await loadNewReviews();
  if (await oldReviews === false && !listStatus.textContent) {
    listStatus.textContent = 'Не удалось загрузить архив отзывов.';
  }
  if (!reviewList.childElementCount && !listStatus.textContent) {
    listStatus.textContent = cursor ? 'Покажите ещё, чтобы прочитать более ранние отзывы.' : 'Здесь пока нет отзывов.';
  }
}

loadPublishedReviews();
