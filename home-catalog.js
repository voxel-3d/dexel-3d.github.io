import { getPublicSupabase } from './supabase-public.js?v=1';
import { BUCKET, publishedModels } from './catalog/catalog-data.js?v=1';

const LIMIT = 4;
const grid = document.getElementById('home-catalog-grid');
const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const catalogURL = new URL('./catalog/', import.meta.url);
const fallback = publishedModels.map(model => ({
  id: model.id, title: model.title,
  cover: new URL(model.placeholder, catalogURL).href,
  dimensions: model.dimensions
}));

function render(models) {
  const fragment = document.createDocumentFragment();
  for (const model of models) {
    const article = document.createElement('article');
    article.className = 'home-catalog-card';
    const preview = document.createElement('div');
    preview.className = 'home-catalog-preview';
    if (model.cover) {
      const image = document.createElement('img');
      image.src = model.cover;
      image.alt = '';
      image.width = 640;
      image.height = 500;
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', () => image.remove());
      preview.append(image);
    }
    const badge = document.createElement('span');
    badge.textContent = '3D-обзор';
    preview.append(badge);

    const body = document.createElement('div');
    body.className = 'home-catalog-card-body';
    const title = document.createElement('h3');
    title.textContent = model.title;
    const specs = document.createElement('p');
    const dims = model.dimensions;
    specs.textContent = dims?.length === 3 && dims.every(value => Number.isFinite(value) && value >= 0)
      ? dims.map(value => number.format(value)).join(' × ') + ' мм'
      : 'Габариты в 3D-просмотре';
    const link = document.createElement('a');
    const href = new URL(catalogURL);
    href.searchParams.set('model', model.id);
    link.href = href.href;
    link.textContent = 'Открыть в 3D и заказать';
    link.setAttribute('aria-label', 'Открыть в 3D и заказать: ' + model.title);
    body.append(title, specs, link);
    article.append(preview, body);
    fragment.append(article);
  }
  grid.replaceChildren(fragment);
  grid.hidden = models.length === 0;
}

async function refresh() {
  const client = await getPublicSupabase();
  const signal = AbortSignal.timeout(6000);
  const models = () => client.from('models').select('*').eq('deleting', false);
  const featured = models().eq('is_featured', true).order('featured_rank')
    .order('created_at', { ascending: false }).order('id').limit(LIMIT).abortSignal(signal);
  const newest = models().order('created_at', { ascending: false }).order('id').limit(LIMIT).abortSignal(signal);
  const builtins = client.from('catalog_builtin_models').select('*').abortSignal(signal);
  const [recommended, fresh, overrides] = await Promise.allSettled([featured, newest, builtins]);
  const rows = new Map();
  for (const result of [recommended, fresh]) {
    if (result.status !== 'fulfilled' || result.value.error) continue;
    for (const row of result.value.data || []) if (!rows.has(row.id)) rows.set(row.id, row);
  }
  const coverURL = (bucket, path) => path ? client.storage.from(bucket).getPublicUrl(path).data.publicUrl : '';
  const remote = [...rows.values()].slice(0, LIMIT).map(row => ({
    id: row.id, title: row.title, cover: coverURL(BUCKET, row.cover_path),
    dimensions: ['width', 'depth', 'height'].map(key => row.geometry_metrics?.[key])
  }));
  const settings = overrides.status === 'fulfilled' && !overrides.value.error ? overrides.value.data : [];
  const builtin = fallback.flatMap(model => {
    const row = settings?.find(setting => setting.slug === model.id);
    if (row?.hidden) return [];
    return [{ ...model, title: row?.title || model.title,
      cover: coverURL('model-media', row?.studio_cover_path) || model.cover }];
  });
  render([...remote, ...builtin].slice(0, LIMIT));
}

if (grid) {
  render(fallback);
  const load = () => void refresh().catch(() => {});
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      load();
    }, { rootMargin: '300px' });
    observer.observe(grid);
  } else {
    load();
  }
}
