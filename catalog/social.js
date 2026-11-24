const $ = id => document.getElementById(id);
const countFormatter = new Intl.NumberFormat('ru-RU');
const MAX_PHOTO = 10 * 1024 * 1024;

export function initSocial(api) {
  let user;
  let favoriteKeys = new Set();
  let favoriteCounts = new Map();
  let voteKeys = new Set();
  let requestRows = [];
  let requestCounts = new Map();
  let socialVersion = 0;
  let makesVersion = 0;
  let requestVersion = 0;
  let bulkRunning = false;
  const favoriteBindings = new Map();

  const setStatus = (id, text, error = false) => {
    const element = $(id);
    element.textContent = text;
    element.toggleAttribute('data-error', error);
  };
  const photoURL = path => api.getClient().storage.from('catalog-social').getPublicUrl(path).data.publicUrl;
  const publicModel = entry => entry && !entry.file;
  const requireAccount = () => {
    if (api.getClient() && api.getUser()) return true;
    api.openAuth('account');
    return false;
  };
  const requireSocial = () => {
    if (api.getClient()) return true;
    setStatus('requests-status', 'Облачные функции временно недоступны.', true);
    return false;
  };

  function renderFavorite(button, entry) {
    const chosen = favoriteKeys.has(entry.id);
    button.setAttribute('aria-pressed', String(chosen));
    const compact = button.classList.contains('card-favorite');
    const label = chosen ? 'Убрать из избранного' : 'В избранное';
    button.setAttribute('aria-label', label + ' · ' + countFormatter.format(favoriteCounts.get(entry.id) || 0));
    button.title = label;
    button.replaceChildren(document.createTextNode(compact ? (chosen ? '♥ ' : '♡ ') : (chosen ? '♥ В избранном ' : '♡ Избранное ')));
    const count = document.createElement('span');
    count.textContent = countFormatter.format(favoriteCounts.get(entry.id) || 0);
    button.append(count);
    button.disabled = !publicModel(entry);
    if (entry.file) button.title = 'Доступно для опубликованных моделей';
  }

  function updateFavoriteButtons(id) {
    for (const [button, entry] of favoriteBindings) {
      if (!button.isConnected && button.id !== 'viewer-favorite') {
        favoriteBindings.delete(button);
        continue;
      }
      if (!id || entry.id === id) renderFavorite(button, entry);
    }
  }

  function bindFavorite(button, entry) {
    favoriteBindings.set(button, entry);
    renderFavorite(button, entry);
    if (!button.dataset.favoriteBound) {
      button.dataset.favoriteBound = '1';
      button.addEventListener('click', async () => {
        const model = favoriteBindings.get(button);
        if (!publicModel(model) || !requireAccount() || button.disabled) return;
        button.disabled = true;
        const chosen = favoriteKeys.has(model.id);
        try {
          const table = api.getClient().from('favorites');
          const { error } = chosen
            ? await table.delete().eq('model_key', model.id).eq('user_id', api.getUser().id)
            : await table.insert({ model_key: model.id });
          if (error) throw error;
          if (chosen) favoriteKeys.delete(model.id); else favoriteKeys.add(model.id);
          favoriteCounts.set(model.id, Math.max(0, (favoriteCounts.get(model.id) || 0) + (chosen ? -1 : 1)));
          updateFavoriteButtons(model.id);
          if (!$('favorite-panel').hidden) renderFavorites();
        } catch {
          setStatus($('model-dialog').open ? 'viewer-share-status' : 'library-status', 'Не удалось изменить избранное. Проверьте соединение и настройки Supabase.', true);
        } finally {
          button.disabled = false;
        }
      });
    }
  }

  async function loadSocial() {
    const client = api.getClient();
    const version = ++socialVersion;
    if (!client) return;
    try {
      const [counts, authors, ownFavorites, ownVotes] = await Promise.all([
        client.rpc('favorite_counts'), client.rpc('popular_model_authors'),
        user ? client.from('favorites').select('model_key').eq('user_id', user.id) : Promise.resolve({data: []}),
        user ? client.from('request_votes').select('request_id').eq('user_id', user.id) : Promise.resolve({data: []})
      ]);
      if (version !== socialVersion) return;
      if ([counts,authors,ownFavorites,ownVotes].some(result => result.error)) throw new Error();
      favoriteCounts = new Map(counts.data.map(row => [row.model_key, Number(row.count)]));
      favoriteKeys = new Set(ownFavorites.data.map(row => row.model_key));
      voteKeys = new Set(ownVotes.data.map(row => row.request_id));
      const list = $('authors-list');
      list.replaceChildren();
      for (const author of authors.data) {
        const item = document.createElement('span');
        item.textContent = author.author_name + ' · ' + countFormatter.format(author.views) + ' просмотров · ' + countFormatter.format(author.downloads) + ' скачиваний';
        list.append(item);
      }
      $('popular-authors').hidden = !authors.data.length;
      updateFavoriteButtons();
      if (!$('favorite-panel').hidden) renderFavorites();
      if (!$('requests-panel').hidden) loadRequests();
    } catch {
      if (version === socialVersion) {
        setStatus('library-status', 'Облачные функции каталога недоступны. Проверьте настройки базы.', true);
      }
    }
  }

  function renderFavorites() {
    const grid = $('favorite-grid');
    grid.replaceChildren();
    for (const key of favoriteKeys) {
      const entry = api.getEntries().get(key);
      if (entry) grid.append(api.createCard(entry));
    }
    setStatus('favorite-status', grid.childElementCount ? '' : 'У вас пока нет сохранённых моделей.');
  }

  $('account-models-tab').addEventListener('click', () => showAccountTab(false));
  $('account-favorites-tab').addEventListener('click', () => showAccountTab(true));
  function showAccountTab(favorites) {
    $('account-own-panel').hidden = favorites;
    $('favorite-panel').hidden = !favorites;
    $('account-models-tab').setAttribute('aria-pressed', String(!favorites));
    $('account-favorites-tab').setAttribute('aria-pressed', String(favorites));
    if (favorites) renderFavorites();
  }

  async function compressPhoto(file) {
    if (!file || !/\.(jpe?g|png|webp)$/i.test(file.name) || !file.size || file.size > MAX_PHOTO) {
      throw new Error('Выберите JPG, PNG или WebP размером до 10 МБ.');
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .84));
      if (!blob) throw new Error();
      return blob;
    } catch {
      throw new Error('Не удалось обработать фото. Выберите другое изображение.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function uploadPhoto(file, folder, owner) {
    const blob = await compressPhoto(file);
    const path = folder + '/' + owner + '/' + crypto.randomUUID() + '.jpg';
    const { error } = await api.getClient().storage.from('catalog-social').upload(path, await blob.arrayBuffer(), { contentType: 'image/jpeg', upsert: false });
    if (error) throw new Error('Не удалось загрузить фото.');
    return path;
  }

  async function insertWithPhoto(tableName, id, fields, photoPath, owner) {
    const client = api.getClient();
    const result = await client.from(tableName).insert({ id, ...fields }).select('id').maybeSingle();
    if (!result.error && result.data) return;
    // A response can be lost after the server commits. Check before deleting an uploaded file.
    const check = await client.from(tableName).select('id').eq('id', id).eq('user_id', owner).maybeSingle();
    if (!check.error && check.data) return;
    if (!check.error && photoPath) await client.storage.from('catalog-social').remove([photoPath]);
    throw new Error('Не удалось сохранить запись. Проверьте подключение и попробуйте снова.');
  }

  async function loadMakes(entry) {
    const version = ++makesVersion;
    const grid = $('makes-grid');
    grid.replaceChildren();
    $('make-open').disabled = !publicModel(entry);
    if (!publicModel(entry)) {
      setStatus('makes-status', 'Фото доступны для опубликованных моделей.');
      return;
    }
    if (!api.getClient()) { setStatus('makes-status', 'Фотографии временно недоступны.'); return; }
    setStatus('makes-status', 'Загружаем фотографии…');
    let data, error;
    try {
      ({ data, error } = await api.getClient().from('model_makes').select('*').eq('model_key', entry.id).order('created_at', { ascending: false }).limit(100));
    } catch {
      if (version === makesVersion) setStatus('makes-status', 'Не удалось загрузить фотографии.', true);
      return;
    }
    if (version !== makesVersion) return;
    if (error) { setStatus('makes-status', 'Не удалось загрузить фотографии.', true); return; }
    for (const row of data) {
      const card = document.createElement('article');
      card.className = 'make-card';
      const img = new Image();
      img.loading = 'lazy'; img.src = photoURL(row.photo_path); img.alt = 'Отпечаток модели, автор ' + row.author_name;
      const meta = document.createElement('strong'); meta.textContent = row.author_name + ' · ' + row.material;
      const comment = document.createElement('p'); comment.textContent = row.comment;
      card.append(img, meta, comment); grid.append(card);
    }
    setStatus('makes-status', data.length ? '' : 'Фото ещё нет. Вы можете добавить первое.');
  }

  $('make-open').addEventListener('click', () => {
    if (!requireAccount()) return;
    $('make-form').reset(); setStatus('make-status', ''); $('make-dialog').showModal();
  });
  $('make-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!requireAccount()) return;
    const button = event.currentTarget.querySelector('[type=submit]');
    const owner = api.getUser().id;
    const entry = api.getActiveModel();
    const file = $('make-photo').files[0];
    button.disabled = true; setStatus('make-status', 'Загружаем фото…');
    try {
      const path = await uploadPhoto(file, 'makes', owner);
      await insertWithPhoto('model_makes', crypto.randomUUID(), {
        model_key: entry.id, material: $('make-material').value,
        comment: $('make-comment').value.trim(), photo_path: path
      }, path, owner);
      $('make-dialog').close();
      if (api.getActiveModel()?.id === entry.id) loadMakes(entry);
    } catch (error) { setStatus('make-status', error.message, true); }
    finally { button.disabled = false; }
  });

  async function loadRequests() {
    if (!requireSocial()) return;
    const version = ++requestVersion;
    setStatus('requests-status', 'Загружаем идеи…');
    try {
      const rows = [];
      const counts = [];
      for (let offset = 0;; offset += 200) {
        const page = await api.getClient().from('model_requests').select('*').order('created_at', { ascending: false }).order('id').range(offset, offset + 199);
        if (page.error) throw page.error;
        rows.push(...page.data);
        if (page.data.length < 200) break;
      }
      for (let offset = 0;; offset += 200) {
        const page = await api.getClient().rpc('request_vote_counts').range(offset, offset + 199);
        if (page.error) throw page.error;
        counts.push(...page.data);
        if (page.data.length < 200) break;
      }
      if (version !== requestVersion) return;
      requestRows = rows;
      requestCounts = new Map(counts.map(row => [row.request_id, Number(row.count)]));
      renderRequests();
    } catch {
      if (version === requestVersion) setStatus('requests-status', 'Не удалось загрузить идеи.', true);
    }
  }

  function renderRequests() {
    const list = $('requests-list');
    list.replaceChildren();
    const sorted = [...requestRows].sort((a,b) => (requestCounts.get(b.id) || 0) - (requestCounts.get(a.id) || 0) || Date.parse(b.created_at) - Date.parse(a.created_at));
    for (const row of sorted) {
      const card = document.createElement('article'); card.className = 'request-card';
      const title = document.createElement('h2'); title.textContent = row.title;
      const meta = document.createElement('p'); meta.textContent = row.author_name + ' · ' + row.status;
      const desc = document.createElement('p'); desc.textContent = row.description;
      card.append(title,meta,desc);
      if (row.photo_path) {
        const img = new Image(); img.src = photoURL(row.photo_path); img.alt = 'Фото-референс к идее «' + row.title + '»'; img.loading = 'lazy'; card.append(img);
      }
      if (row.status === 'Готово' && row.ready_model) {
        const link = document.createElement('a'); link.href = new URL('?model=' + encodeURIComponent(row.ready_model), new URL(location.pathname, location.origin)).href;
        link.textContent = 'Смотреть готовую модель'; card.append(link);
      }
      const vote = document.createElement('button');
      vote.type = 'button'; vote.className = 'request-vote';
      const own = api.getUser()?.id === row.user_id;
      const selected = voteKeys.has(row.id);
      vote.setAttribute('aria-pressed', String(selected));
      vote.textContent = (selected ? 'Поддерживаю' : 'Хочу такую модель +1') + ' · ' + countFormatter.format(requestCounts.get(row.id) || 0);
      vote.disabled = own; if (own) vote.title = 'Голосовать за свою идею нельзя';
      vote.addEventListener('click', async () => {
        if (!requireAccount()) return;
        vote.disabled = true;
        try {
          const table = api.getClient().from('request_votes');
          const { error } = selected ? await table.delete().eq('request_id',row.id).eq('user_id',api.getUser().id) : await table.insert({ request_id: row.id });
          if (error) throw error;
          if (selected) voteKeys.delete(row.id); else voteKeys.add(row.id);
          requestCounts.set(row.id, Math.max(0,(requestCounts.get(row.id) || 0)+(selected ? -1 : 1)));
          renderRequests();
        } catch { vote.disabled = false; setStatus('requests-status','Не удалось изменить голос.',true); }
      });
      card.append(vote);
      if (own) {
        const status = document.createElement('select');
        status.setAttribute('aria-label', 'Статус идеи «' + row.title + '»');
        for (const name of ['Ищем исполнителя','В работе','Готово']) status.add(new Option(name,name,false,name===row.status));
        const model = document.createElement('select');
        model.setAttribute('aria-label', 'Готовая модель для идеи «' + row.title + '»');
        model.add(new Option('Выберите готовую модель',''));
        for (const item of api.getEntries().values()) if (publicModel(item)) model.add(new Option(item.title,item.id,false,item.id===row.ready_model));
        const save = document.createElement('button'); save.type='button'; save.className='catalog-card-button'; save.textContent='Сохранить статус';
        save.addEventListener('click', async () => {
          if (status.value === 'Готово' && !model.value) { setStatus('requests-status','Выберите готовую модель.',true); return; }
          save.disabled=true;
          const { error } = await api.getClient().from('model_requests').update({ status: status.value, ready_model: status.value === 'Готово' ? model.value : null }).eq('id',row.id).eq('user_id',api.getUser().id);
          if (error) { save.disabled=false; setStatus('requests-status','Не удалось сохранить статус.',true); }
          else loadRequests();
        });
        card.append(status,model,save);
      }
      list.append(card);
    }
    setStatus('requests-status', sorted.length ? '' : 'Идей пока нет. Предложите первую.');
  }

  $('open-requests').addEventListener('click', async () => {
    await api.cloudSetup;
    $('public-catalog').hidden = true; $('account-panel').hidden = true; $('requests-panel').hidden = false;
    loadRequests();
  });
  $('requests-back').addEventListener('click', api.showCatalog);
  $('request-open-form').addEventListener('click', () => {
    if (!requireAccount()) return;
    $('request-form').reset(); setStatus('idea-status',''); $('request-dialog').showModal();
  });
  $('request-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!requireAccount()) return;
    const button = event.currentTarget.querySelector('[type=submit]');
    const owner = api.getUser().id;
    const title = $('idea-title').value.trim(), description = $('idea-description').value.trim();
    if (!title || !description) { setStatus('idea-status','Введите название и описание.',true); return; }
    button.disabled=true; setStatus('idea-status','Публикуем идею…');
    try {
      const file = $('idea-photo').files[0];
      const path = file ? await uploadPhoto(file,'requests',owner) : null;
      await insertWithPhoto('model_requests',crypto.randomUUID(),{title,description,photo_path:path},path,owner);
      $('request-dialog').close(); loadRequests();
    } catch (error) { setStatus('idea-status',error.message,true); }
    finally { button.disabled=false; }
  });

  for (const category of api.categories) if (category !== 'Все') $('bulk-category').add(new Option(category,category,category === 'Другое',category === 'Другое'));
  const bulkPreview = $('bulk-cover-preview');
  const bulkPaletteField = $('bulk-palette');
  let previewVersion = 0;
  const bulkPalette = api.mountPalette(bulkPaletteField, renderBulkPreview);
  async function renderBulkPreview() {
    const revision = ++previewVersion;
    bulkPreview.hidden = true;
    const file = $('bulk-files').files?.[0];
    if (bulkRunning || !file || !/\.stl$/i.test(file.name) || !file.size || file.size > api.maxFileSize) return;
    const active = () => revision === previewVersion && $('bulk-dialog').open && !bulkRunning;
    try {
      const cover = await api.queueCover({file, color: bulkPalette.value, azimuth: 35, elevation: 30}, active);
      if (!active()) return;
      bulkPreview.src = cover;
      bulkPreview.hidden = false;
    } catch { /* Individual file errors are reported on submission. */ }
  }
  $('bulk-files').addEventListener('change', renderBulkPreview);
  $('bulk-open').addEventListener('click', () => {
    if (!requireAccount()) return;
    $('bulk-form').reset();
    bulkPalette.set(api.defaultColor);
    bulkPreview.hidden = true;
    bulkPreview.removeAttribute('src'); $('bulk-errors').replaceChildren(); $('bulk-progress').hidden=true; setStatus('bulk-status',''); $('bulk-dialog').showModal();
  });
  $('bulk-close').addEventListener('click', () => { if (!bulkRunning) $('bulk-dialog').close(); });
  $('bulk-dialog').addEventListener('cancel', event => { if (bulkRunning) event.preventDefault(); });
  $('bulk-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (bulkRunning || !requireAccount()) return;
    const files = [...$('bulk-files').files];
    if (!files.length || files.length > 50) { setStatus('bulk-status','Выберите от 1 до 50 STL-файлов.',true); return; }
    const owner = api.getUser(), category = $('bulk-category').value, color = bulkPalette.value;
    const progress = $('bulk-progress'), errors = $('bulk-errors');
    errors.replaceChildren(); progress.max = files.length; progress.value = 0; progress.hidden = false;
    bulkRunning = true;
    for (const id of ['bulk-close','bulk-submit','bulk-files','bulk-category','bulk-palette']) $(id).disabled = true;
    let success = 0;
    for (const file of files) {
      setStatus('bulk-status','Обработано ' + progress.value + ' из ' + files.length + ' моделей…');
      try {
        if (api.getUser()?.id !== owner.id) throw new Error('Сеанс завершён. Войдите снова.');
        if (!/\.stl$/i.test(file.name) || !file.size || file.size > api.maxFileSize) throw new Error('Нужен непустой STL до 20 МБ.');
        let title = file.name.replace(/\.stl$/i,'').replace(/[-_]+/g,' ').trim().slice(0,100);
        if (!title) throw new Error('Укажите имя файла.');
        title = title[0].toLocaleUpperCase('ru') + title.slice(1);
        const selection = {file,color,azimuth:35,elevation:30};
        const cover = await api.queueCover(selection);
        const bytes = Uint8Array.from(atob(cover.split(',')[1]), character => character.charCodeAt(0));
        selection.png = new Blob([bytes],{type:'image/png'});
        await api.saveCloudModel({title,description:'',category,tags:[]},selection,null,owner);
        success++;
      } catch (error) {
        const item = document.createElement('li');
        item.textContent = file.name + ': ' + (error.message || 'ошибка загрузки.');
        errors.append(item);
      }
      progress.value++;
    }
    setStatus('bulk-status','Обработано ' + files.length + ' из ' + files.length + '. Загружено: ' + success + '.');
    bulkRunning=false;
    for (const id of ['bulk-close','bulk-submit','bulk-files','bulk-category','bulk-palette']) $(id).disabled = false;
    if (success) { api.listPublicModels(true); api.loadDashboard(); }
  });

  api.cloudSetup.then(() => {
    user = api.getUser();
    loadSocial();
  });
  return {
    bindFavorite,
    openModel(entry) { bindFavorite($('viewer-favorite'),entry); loadMakes(entry); },
    catalogUpdated() { updateFavoriteButtons(); if (!$('favorite-panel').hidden) renderFavorites(); },
    sessionChanged(next) { user = next; favoriteKeys = new Set(); voteKeys = new Set(); updateFavoriteButtons(); loadSocial(); }
  };
}
