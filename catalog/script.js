// Use the project URL and a public publishable (or legacy anon) key from Supabase.
const SUPABASE_URL = 'https://vvwsenwbjhmagwigtfqs.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zXO4GY-2ou6HpvEWzeaO9Q_XT7uJkDg';

// Add public STL entries here. Version the file URL when replacing an existing STL.
const publishedModels = [
  {
    id: 'ribbed-vase',
    fileUrl: 'assets/ribbed-vase.stl',
    title: 'Рельефная ваза',
    description: 'Мягкий силуэт и ритм вертикальных рёбер для сухоцветов.',
    color: '#a87a55',
    placeholder: 'assets/ribbed-vase.webp'
  },
  {
    id: 'phone-stand',
    fileUrl: 'assets/phone-stand.stl',
    title: 'Подставка для телефона',
    description: 'Наклонная опора с нижним упором для рабочего стола.',
    color: '#426487',
    placeholder: 'assets/phone-stand.webp'
  },
  {
    id: 'hex-organizer',
    fileUrl: 'assets/hex-organizer.stl',
    title: 'Шестигранный органайзер',
    description: 'Открытый лоток для ключей, крепежа и мелочей.',
    color: '#677047',
    placeholder: 'assets/hex-organizer.webp'
  }
];

const colors = [
  ['Белый', '#eeeeeb'], ['Чёрный', '#252529'], ['Жёлтый', '#e8b817'],
  ['Красный', '#b7282b'], ['Синий', '#275caf'], ['Койот', '#a3865b'], ['Олива', '#566540']
];

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_PHOTO_SIZE = 10 * 1024 * 1024;
const MAX_PHOTO_EDGE = 1280;
const MAX_SOFTWARE_TRIANGLES = 50000;
const COVER_WIDTH = 640;
const COVER_HEIGHT = 500;
const COVER_PREFIX = 'dexel-stl-cover:';
const COVER_VERSION = '1';

const byId = id => document.getElementById(id);
const dialog = byId('model-dialog');
const stage = byId('model-stage');
const preview = byId('model-preview');
const status = byId('model-status');
const title = byId('model-title');
const description = byId('model-description');
const colorPicker = byId('model-color');
const actions = [...dialog.querySelectorAll('[data-view-action]')];
const grid = byId('library-grid');
const template = byId('library-card');
const libraryStatus = byId('library-status');
let currentLoad;
let viewer;
let studioRenderer;
let coverQueue = Promise.resolve();

function getSTLModules() {
  return Promise.all([import('three'), import('three/addons/loaders/STLLoader.js')]);
}

function enableActions(enabled) {
  for (const action of actions) action.disabled = !enabled;
  colorPicker.disabled = !enabled;
}

function initColors(color) {
  colorPicker.replaceChildren();
  const choices = colors.some(([, hex]) => hex === color) ? colors : [['Цвет модели', color], ...colors];
  for (const [label, hex] of choices) colorPicker.add(new Option(label, hex));
  colorPicker.value = color;
}

function disposeModel(model) {
  model.geometry.dispose();
  model.material.dispose();
}

async function selectRenderer(THREE, preserveDrawingBuffer = false) {
  const canvas = document.createElement('canvas');
  const attributes = { antialias: true, alpha: false, preserveDrawingBuffer };
  const context = canvas.getContext('webgl2', attributes);
  if (context) {
    const renderer = new THREE.WebGLRenderer({ canvas, context, ...attributes });
    renderer.setPixelRatio(preserveDrawingBuffer ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    return renderer;
  }

  const { SVGRenderer } = await import('three/addons/renderers/SVGRenderer.js');
  const renderer = new SVGRenderer();
  renderer.setPrecision(1);
  return renderer;
}

function modelDirection(THREE, azimuth = 45, elevation = 40) {
  const yaw = THREE.MathUtils.degToRad(azimuth);
  const pitch = THREE.MathUtils.degToRad(elevation);
  return new THREE.Vector3(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
}

async function loadSTL(THREE, STLLoader, entry, signal) {
  let bytes;
  if (entry.file) {
    bytes = await entry.file.arrayBuffer();
  } else {
    const response = await fetch(entry.fileUrl, { signal });
    if (!response.ok) throw new Error('Не удалось загрузить STL.');
    bytes = await response.arrayBuffer();
  }
  signal?.throwIfAborted();
  if (!bytes.byteLength || bytes.byteLength > MAX_FILE_SIZE) {
    throw new Error('Нужен непустой STL-файл размером до 20 МБ.');
  }

  let geometry;
  try {
    const header = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
    const startsWithSolid = new TextDecoder().decode(header).trimStart().startsWith('solid');
    if (!startsWithSolid) {
      const view = new DataView(bytes);
      if (view.byteLength < 84 || 84 + view.getUint32(80, true) * 50 > view.byteLength) throw new Error();
    }
    geometry = new STLLoader().parse(bytes);
    const positions = geometry.getAttribute('position');
    if (!positions || positions.count < 3 || positions.count % 3 !== 0) throw new Error();
    geometry.computeBoundingSphere();
    const { center, radius } = geometry.boundingSphere;
    if (!Number.isFinite(radius) || radius <= 0) throw new Error();
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.scale(1 / radius, 1 / radius, 1 / radius);
    // STL is Z-up. Three.js is Y-up.
    geometry.rotateX(-Math.PI / 2);
  } catch {
    geometry?.dispose();
    throw new Error('Не удалось прочитать геометрию. Проверьте STL-файл.');
  }

  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: entry.color, roughness: .64, metalness: .06
  }));
}

function studioScene(THREE, renderer, model) {
  const webgl = renderer.isWebGLRenderer;
  if (!webgl && model.geometry.getAttribute('position').count / 3 > MAX_SOFTWARE_TRIANGLES) {
    throw new Error('Для этой модели нужен WebGL. Без него поддерживаются STL до 50 000 треугольников.');
  }
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x20221d);
  scene.add(model);
  scene.add(new THREE.AmbientLight(0xe8dfd1, webgl ? .3 : 1));
  scene.add(new THREE.HemisphereLight(0xfff5df, 0x83705c, 1.7));

  const key = new THREE.DirectionalLight(0xffe5ba, webgl ? 3 : .72);
  key.position.set(-3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xccdcff, webgl ? 1.15 : .25);
  fill.position.set(4, 2, 1);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffc87d, webgl ? 2.1 : .42);
  rim.position.set(2, 3, -4);
  scene.add(rim);
  return scene;
}

async function snapshot(renderer) {
  if (renderer.isWebGLRenderer) return renderer.domElement.toDataURL('image/png');
  // Keep cover generation available on devices where the interactive SVG fallback is used.
  const svg = new XMLSerializer().serializeToString(renderer.domElement);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = COVER_WIDTH;
    canvas.height = COVER_HEIGHT;
    const context = canvas.getContext('2d');
    context.fillStyle = '#20221d';
    context.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT);
    context.drawImage(image, 0, 0, COVER_WIDTH, COVER_HEIGHT);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function renderCover(entry) {
  const [THREE, { STLLoader }] = await getSTLModules();
  const renderer = studioRenderer ??= await selectRenderer(THREE, true);
  const model = await loadSTL(THREE, STLLoader, entry);
  try {
    const scene = studioScene(THREE, renderer, model);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 12);
    camera.position.copy(modelDirection(THREE, entry.azimuth, entry.elevation)).multiplyScalar(4);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    const point = new THREE.Vector3();
    const min = new THREE.Vector2(Infinity, Infinity);
    const max = new THREE.Vector2(-Infinity, -Infinity);
    const positions = model.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(camera.matrixWorldInverse);
      min.x = Math.min(min.x, point.x);
      min.y = Math.min(min.y, point.y);
      max.x = Math.max(max.x, point.x);
      max.y = Math.max(max.y, point.y);
    }
    const aspect = COVER_WIDTH / COVER_HEIGHT;
    const halfHeight = Math.max((max.y - min.y) / 2, (max.x - min.x) / (2 * aspect), .001) * 1.14;
    const mid = min.clone().add(max).multiplyScalar(.5);
    camera.top = mid.y + halfHeight;
    camera.bottom = mid.y - halfHeight;
    camera.left = mid.x - halfHeight * aspect;
    camera.right = mid.x + halfHeight * aspect;
    camera.updateProjectionMatrix();

    renderer.setSize(COVER_WIDTH, COVER_HEIGHT, false);
    renderer.render(scene, camera);
    return await snapshot(renderer);
  } finally {
    disposeModel(model);
  }
}

function queueCover(entry, active = () => true) {
  const run = coverQueue.then(async () => {
    await new Promise(resolve => {
      if ('requestIdleCallback' in window) requestIdleCallback(resolve, { timeout: 1400 });
      else setTimeout(resolve, 0);
    });
    if (active()) return renderCover(entry);
  });
  coverQueue = run.catch(() => {});
  return run;
}

const coverCacheKey = model => [COVER_PREFIX + COVER_VERSION, model.fileUrl, model.color].join(':');

function cachedCover(model) {
  try {
    const cover = localStorage.getItem(coverCacheKey(model));
    return cover?.startsWith('data:image/png;base64,') ? cover : undefined;
  } catch {
    return undefined;
  }
}

function rememberCover(model, cover) {
  try {
    const key = coverCacheKey(model);
    const cached = Object.keys(localStorage).filter(name => name.startsWith(COVER_PREFIX) && name !== key);
    while (cached.length >= 8) localStorage.removeItem(cached.shift());
    localStorage.setItem(key, cover);
  } catch {
    // Browsing modes and storage quotas must not stop the models from appearing.
  }
}

function openLibrary() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('dexel-stl-library', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('models', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Хранилище библиотеки занято.'));
  });
}

async function libraryTransaction(mode, run) {
  const db = await openLibrary();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('models', mode);
      const request = run(tx.objectStore('models'));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function createViewer(THREE, OrbitControls, renderer, model, imageAlt, onContextLost) {
  const bounds = new THREE.Box3().setFromObject(model);
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) {
    throw new Error('Пустая модель');
  }

  const surface = renderer.domElement;
  surface.classList.add('model-surface');
  surface.setAttribute('tabindex', '0');
  surface.setAttribute('aria-label', imageAlt + '. Интерактивная 3D-модель.');

  const scene = studioScene(THREE, renderer, model);

  const camera = new THREE.PerspectiveCamera(38, 1, sphere.radius * .03, sphere.radius * 150);
  const direction = modelDirection(THREE);
  camera.position.copy(direction).multiplyScalar(4 * sphere.radius);
  const controls = new OrbitControls(camera, surface);
  controls.enablePan = false;
  controls.minDistance = sphere.radius * 1.06;
  controls.maxDistance = sphere.radius * 40;
  controls.zoomSpeed = .8;

  let frame = 0;
  function render() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      renderer.render(scene, camera);
    });
  }
  controls.addEventListener('change', render);

  let fitDistance = 0;
  function resize() {
    const { clientWidth: width, clientHeight: height } = stage;
    if (!width || !height) return;
    camera.aspect = width / height;
    const halfHeight = THREE.MathUtils.degToRad(camera.fov / 2);
    const halfWidth = Math.atan(Math.tan(halfHeight) * camera.aspect);
    const nextFit = 1.12 * sphere.radius / Math.sin(Math.min(halfHeight, halfWidth));
    if (fitDistance) camera.position.multiplyScalar(nextFit / fitDistance);
    else camera.position.copy(direction).multiplyScalar(nextFit);
    fitDistance = nextFit;
    controls.maxDistance = Math.max(sphere.radius * 40, fitDistance * 2);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    controls.update();
    render();
  }

  function zoom(factor) {
    const distance = THREE.MathUtils.clamp(camera.position.length() * factor, controls.minDistance, controls.maxDistance);
    camera.position.setLength(distance);
    controls.update();
    render();
  }

  function reset() {
    camera.position.copy(direction).multiplyScalar(fitDistance);
    controls.update();
    render();
  }

  const orbit = new THREE.Spherical();
  const arrows = {
    ArrowLeft: [-.13, 0], ArrowRight: [.13, 0],
    ArrowUp: [0, -.13], ArrowDown: [0, .13]
  };
  surface.addEventListener('keydown', event => {
    const shift = arrows[event.key];
    if (shift) {
      orbit.setFromVector3(camera.position);
      orbit.theta += shift[0];
      orbit.phi += shift[1];
      camera.position.setFromSpherical(orbit.makeSafe());
      controls.update();
      render();
    } else if (event.key === '+' || event.key === '=') {
      zoom(.8);
    } else if (event.key === '-' || event.key === '−') {
      zoom(1.25);
    } else {
      return;
    }
    event.preventDefault();
  });
  surface.addEventListener('webglcontextlost', onContextLost, { once: true });

  const observer = new ResizeObserver(resize);
  function releaseRenderer() {
    observer.disconnect();
    controls.dispose();
    cancelAnimationFrame(frame);
    surface.removeEventListener('webglcontextlost', onContextLost);
    surface.remove();
  }

  try {
    stage.append(surface);
    observer.observe(stage);
    resize();
    return {
      zoom, reset,
      setColor(color) {
        model.material.color.set(color);
        render();
      },
      dispose() {
        releaseRenderer();
        disposeRenderer(renderer);
        disposeModel(model);
      }
    };
  } catch (error) {
    releaseRenderer();
    throw error;
  }
}

function disposeRenderer(renderer) {
  renderer?.dispose?.();
  renderer?.forceContextLoss?.();
}

function showError(message) {
  viewer?.dispose();
  viewer = undefined;
  preview.hidden = !preview.hasAttribute('src');
  enableActions(false);
  status.textContent = message;
}

async function openModel(entry) {
  const cover = entry.cover || entry.placeholder;
  if (cover) preview.src = cover;
  preview.alt = entry.title;
  preview.hidden = !cover;
  title.textContent = entry.title;
  description.textContent = entry.description;
  initColors(entry.color);
  status.textContent = 'Загружаем 3D-модель…';
  enableActions(false);
  dialog.showModal();

  const load = new AbortController();
  currentLoad = load;
  let model;
  let renderer;
  try {
    const [[THREE, { STLLoader }], { OrbitControls }] = await Promise.all([
      getSTLModules(), import('three/addons/controls/OrbitControls.js')
    ]);
    model = await loadSTL(THREE, STLLoader, entry, load.signal);
    load.signal.throwIfAborted();
    renderer = await selectRenderer(THREE);
    load.signal.throwIfAborted();
    viewer = createViewer(THREE, OrbitControls, renderer, model, entry.title, () => {
      showError('3D-просмотр прервался. Закройте окно и откройте его снова.');
    });
    preview.hidden = true;
    status.textContent = '';
    enableActions(true);
  } catch (error) {
    if (!viewer) {
      disposeRenderer(renderer);
      if (model) disposeModel(model);
    }
    if (!load.signal.aborted) {
      showError(error instanceof Error ? error.message : '3D-модель не открылась.');
    }
  }
}

function addCard(entry, first = false) {
  const card = template.content.firstElementChild.cloneNode(true);
  const image = card.querySelector('img');
  image.alt = entry.title + ' — 3D-превью';
  const cover = entry.cover || entry.placeholder;
  if (cover) image.src = cover;
  card.querySelector('h2').textContent = entry.title;
  card.querySelector('.catalog-card-description').textContent = entry.description;
  const meta = card.querySelector('.catalog-card-meta');
  meta.textContent = describeModel(entry);
  card.querySelector('button').addEventListener('click', () => {
    openModel(entry);
    logModelEvent(entry, 'view', meta);
  });

  const download = card.querySelector('.catalogue-download');
  const fileName = entry.remote
    ? entry.title.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 80) + '.stl'
    : entry.file?.name || entry.fileUrl.split('/').at(-1).split('?')[0];
  download.download = fileName;
  if (entry.remote) {
    download.href = cloudFile(entry.remote.stl_path, fileName);
    download.addEventListener('click', () => logModelEvent(entry, 'download', meta));
  } else if (entry.downloadUrl || entry.fileUrl) {
    download.href = entry.downloadUrl || entry.fileUrl;
    if (entry.downloadUrl) {
      download.target = '_blank';
      download.rel = 'noopener noreferrer';
    }
  } else {
    download.href = URL.createObjectURL(entry.file);
  }
  const params = new URLSearchParams({ model: entry.title });
  const order = card.querySelector('.catalog-order');
  order.href = '../#request?' + params.toString();
  if (entry.remote) {
    order.addEventListener('click', async event => {
      const recorded = logModelEvent(entry, 'order', meta);
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      await Promise.race([recorded, new Promise(resolve => setTimeout(resolve, 1000))]);
      window.location.assign(order.href);
    });
    card.dataset.cloudModel = entry.id;
  }
  if (first) grid.prepend(card);
  else grid.append(card);
  return image;
}

for (const button of actions) {
  button.addEventListener('click', () => {
    if (!viewer) return;
    if (button.dataset.viewAction === 'reset') viewer.reset();
    else viewer.zoom(button.dataset.viewAction === 'in' ? .8 : 1.25);
  });
}

colorPicker.addEventListener('change', () => viewer?.setColor(colorPicker.value));

dialog.addEventListener('close', () => {
  currentLoad?.abort();
  viewer?.dispose();
  viewer = undefined;
  preview.removeAttribute('src');
  preview.hidden = true;
  enableActions(false);
});

const BUCKET = 'stl-models';
const PAGE_SIZE = 24;
const number = new Intl.NumberFormat('ru-RU');
const accountLink = byId('account-link');
const accountPanel = byId('account-panel');
const publicCatalog = byId('public-catalog');
const accountStatus = byId('account-status');
const ownedList = byId('owned-models');
const catalogMore = byId('catalog-more');
const authDialog = byId('auth-dialog');
const authForm = byId('auth-form');
const authStatus = byId('auth-status');
const authSubmit = byId('auth-submit');
const authMode = byId('auth-mode');
const authName = byId('auth-name');
const authPassword = byId('auth-password');

let supabase;
let user;
let register = false;
let publicOffset = 0;
let listing = false;
let catalogVersion = 0;
let dashboardVersion = 0;
let owned = [];
let authTarget = 'account';
const publicEntries = new Map();
const pendingEvents = new Map();

function note(element, message, error = false) {
  element.textContent = message;
  element.toggleAttribute('data-error', error);
}

function describeModel(entry) {
  const row = entry.remote;
  if (!row) return entry.file ? 'Локальная модель' : 'Автор: DEXEL 3D · демомодель';
  return [
    'Автор: ' + row.author_name,
    row.category,
    row.tags.map(tag => '#' + tag).join(' '),
    'Просмотры: ' + number.format(row.views_count),
    'Скачивания: ' + number.format(row.downloads_count)
  ].filter(Boolean).join(' · ');
}

function cloudFile(path, download) {
  return supabase.storage.from(BUCKET).getPublicUrl(path, download ? { download } : {}).data.publicUrl;
}

function publicEntry(row) {
  return {
    id: row.id, title: row.title, description: row.description,
    color: '#d4af37', fileUrl: cloudFile(row.stl_path), cover: cloudFile(row.cover_path), remote: row
  };
}

async function listPublicModels(restart = false) {
  if (!supabase) return;
  if (listing && !restart) return;
  if (restart) publicOffset = 0;
  listing = true;
  const offset = publicOffset;
  const version = ++catalogVersion;
  catalogMore.disabled = true;
  try {
    const { data, error } = await supabase.from('models').select('*').eq('deleting', false)
      .order('created_at', { ascending: false }).order('id').range(offset, offset + PAGE_SIZE - 1);
    if (version !== catalogVersion) return;
    if (error) throw error;
    if (restart) {
      for (const card of grid.querySelectorAll('[data-cloud-model]')) card.remove();
      publicEntries.clear();
    }
    for (const row of data) {
      if (publicEntries.has(row.id)) continue;
      const entry = publicEntry(row);
      publicEntries.set(row.id, entry);
      addCard(entry);
    }
    publicOffset += data.length;
    catalogMore.hidden = data.length < PAGE_SIZE;
    note(libraryStatus, '');
  } catch {
    if (version !== catalogVersion) return;
    note(libraryStatus, 'Общий каталог временно недоступен. Можно открыть демонстрационные модели.', true);
    catalogMore.textContent = 'Повторить загрузку';
    catalogMore.hidden = false;
  } finally {
    if (version === catalogVersion) {
      listing = false;
      catalogMore.disabled = false;
    }
  }
}

catalogMore.addEventListener('click', () => {
  catalogMore.textContent = 'Показать ещё';
  listPublicModels();
});

function logModelEvent(entry, kind, meta) {
  if (!entry.remote || !supabase) return Promise.resolve();
  const modelId = entry.id;
  const previous = pendingEvents.get(modelId) || Promise.resolve();
  const pending = previous.then(async () => {
    const { data, error } = await supabase.rpc('record_model_event', { model_id: modelId, event_type: kind });
    if (error || !data?.[0]) return;
    const counters = data[0];
    Object.assign(entry.remote, counters);
    meta.textContent = describeModel(entry);
    const active = publicEntries.get(modelId);
    if (active && active !== entry) {
      Object.assign(active.remote, counters);
      const activeMeta = grid.querySelector('[data-cloud-model="' + modelId + '"] .catalog-card-meta');
      if (activeMeta) activeMeta.textContent = describeModel(active);
    }
    const item = owned.find(row => row.id === modelId);
    if (item) {
      Object.assign(item, counters);
      if (!accountPanel.hidden) renderOwned();
    }
  }).catch(() => {});
  pendingEvents.set(modelId, pending);
  pending.finally(() => {
    if (pendingEvents.get(modelId) === pending) pendingEvents.delete(modelId);
  });
  return pending;
}

function countersText(row) {
  return [
    'Просмотры: ' + number.format(row.views_count),
    'Скачивания: ' + number.format(row.downloads_count),
    'Клики по заказу: ' + number.format(row.orders_count)
  ].join(' · ');
}

function renderOwned() {
  ownedList.replaceChildren();
  byId('total-models').textContent = number.format(owned.length);
  for (const [key, id] of [['views_count', 'total-views'], ['downloads_count', 'total-downloads'], ['orders_count', 'total-orders']]) {
    const total = owned.reduce((sum, row) => sum + BigInt(row[key] ?? 0), 0n);
    byId(id).textContent = number.format(total);
  }
  for (const row of owned) {
    const card = document.createElement('article');
    card.className = 'owned-model';
    const image = document.createElement('img');
    image.alt = '';
    if (!row.deleting) image.src = cloudFile(row.cover_path);
    image.loading = 'lazy';
    const text = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = row.title + (row.deleting ? ' · ожидает удаления' : '');
    const counts = document.createElement('p');
    counts.textContent = countersText(row);
    text.append(heading, counts);
    const buttons = document.createElement('div');
    buttons.className = 'owned-actions';
    for (const [label, event] of [
      ['Редактировать', () => openEditor(row)],
      [row.deleting ? 'Повторить удаление' : 'Удалить', () => askToDelete(row)]
    ]) {
      if (row.deleting && label === 'Редактировать') continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', event);
      buttons.append(button);
    }
    card.append(image, text, buttons);
    ownedList.append(card);
  }
}

async function loadDashboard() {
  if (!user || !supabase) return;
  const id = user.id;
  const version = ++dashboardVersion;
  note(accountStatus, 'Загружаем ваши модели…');
  try {
    const rows = [];
    const batchSize = 200;
    for (let start = 0;; start += batchSize) {
      const { data, error } = await supabase.from('models').select('*').eq('user_id', id)
        .order('created_at', { ascending: false }).order('id').range(start, start + batchSize - 1);
      if (version !== dashboardVersion || user?.id !== id) return;
      if (error) throw error;
      rows.push(...data);
      if (data.length < batchSize) break;
    }
    owned = rows;
    renderOwned();
    note(accountStatus, owned.length ? '' : 'У вас пока нет моделей.');
  } catch {
    if (version === dashboardVersion) note(accountStatus, 'Не удалось загрузить модели. Откройте кабинет ещё раз.', true);
  }
}

function showCatalog() {
  accountPanel.hidden = true;
  publicCatalog.hidden = false;
  byId('catalog-title').setAttribute('tabindex', '-1');
  byId('catalog-title').focus();
}

function showAccount() {
  if (!user) return;
  publicCatalog.hidden = true;
  accountPanel.hidden = false;
  byId('account-identity').textContent = user.user_metadata?.display_name || user.email;
  byId('account-heading').focus();
  loadDashboard();
}

function updateSession(session) {
  const before = user?.id;
  user = session?.user;
  accountLink.textContent = user
    ? (user.user_metadata?.display_name || user.email || 'Личный кабинет')
    : 'Войти / Регистрация';
  accountLink.setAttribute('aria-label', user ? 'Личный кабинет — ' + accountLink.textContent : accountLink.textContent);
  if (before !== user?.id) {
    dashboardVersion++;
    owned = [];
    ownedList.replaceChildren();
    for (const id of ['total-models', 'total-views', 'total-downloads', 'total-orders']) byId(id).textContent = '—';
    if (!user && !accountPanel.hidden) showCatalog();
    else if (user && !accountPanel.hidden) showAccount();
  }
}

function setAuthMode(value) {
  register = value;
  byId('auth-title').textContent = register ? 'Регистрация' : 'Войти';
  byId('auth-name-field').hidden = !register;
  authName.required = register;
  authPassword.minLength = register ? 6 : 0;
  authPassword.autocomplete = register ? 'new-password' : 'current-password';
  authSubmit.textContent = register ? 'Зарегистрироваться' : 'Войти';
  authMode.textContent = register ? 'Уже есть аккаунт' : 'Создать аккаунт';
  note(authStatus, '');
}

function openAuth(target) {
  authTarget = target;
  authForm.reset();
  setAuthMode(false);
  authForm.hidden = !supabase;
  if (!supabase) note(authStatus, 'Облачный кабинет пока не подключён. Каталог и локальная загрузка доступны.');
  authDialog.showModal();
}

authMode.addEventListener('click', () => setAuthMode(!register));
authForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!supabase || authSubmit.disabled) return;
  const fields = new FormData(authForm);
  const email = fields.get('email').trim();
  const password = fields.get('password');
  const displayName = fields.get('displayName').trim();
  if (register && !displayName) {
    note(authStatus, 'Укажите имя автора.', true);
    return;
  }
  authSubmit.disabled = authMode.disabled = true;
  note(authStatus, register ? 'Создаём аккаунт…' : 'Входим…');
  try {
    const { data, error } = register
      ? await supabase.auth.signUp({
        email, password,
        options: { data: { display_name: displayName }, emailRedirectTo: new URL('./', location.href).href }
      })
      : await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const message = { invalid_credentials: 'Проверьте e-mail и пароль.', email_not_confirmed: 'Подтвердите e-mail и попробуйте снова.', weak_password: 'Выберите более надёжный пароль.', over_email_send_rate_limit: 'Письмо уже отправлено. Подождите перед повторной попыткой.' }[error.code];
      throw new Error(message || 'Не удалось выполнить вход или регистрацию. Попробуйте ещё раз.');
    }
    if (!data.session) {
      authPassword.value = '';
      note(authStatus, 'Если адрес можно зарегистрировать, вы получите письмо для подтверждения e-mail.');
      return;
    }
    updateSession(data.session);
    authDialog.close();
    if (authTarget === 'add') openEditor();
    else showAccount();
  } catch (error) {
    note(authStatus, error.message || 'Нет связи с сервером.', true);
  } finally {
    authSubmit.disabled = authMode.disabled = false;
  }
});

byId('account-back').addEventListener('click', showCatalog);
byId('sign-out').addEventListener('click', async () => {
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
    updateSession(null);
  } catch {
    note(accountStatus, 'Не удалось завершить сеанс. Попробуйте ещё раз.', true);
  }
});

async function initCloud() {
  if (!SUPABASE_URL.trim() || !SUPABASE_ANON_KEY.trim()) return;
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/+esm');
    supabase = createClient(SUPABASE_URL.trim(), SUPABASE_ANON_KEY.trim(), {
      auth: { storageKey: 'dexel-library-session' },
      global: {
        fetch: (input, init) => fetch(input, String(input.url || input).includes('/rpc/record_model_event')
          ? { ...init, keepalive: true }
          : init)
      }
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => updateSession(session), 0);
    });
    const { data } = await supabase.auth.getSession();
    updateSession(data?.session);
    listPublicModels();
  } catch {
    supabase = undefined;
    note(libraryStatus, 'Облачный каталог временно недоступен. Открыт локальный режим.', true);
  }
}

const cloudSetup = initCloud();
accountLink.addEventListener('click', async () => {
  await cloudSetup;
  if (user) showAccount();
  else openAuth('account');
});

const addDialog = byId('add-model-dialog');
const addForm = byId('add-model-form');
const fileInput = byId('library-file');
const photoInput = byId('library-photo');
const stlCoverButton = byId('use-stl-cover');
const addStatus = byId('add-model-status');
const coverImage = byId('library-cover');
const coverDownload = byId('download-cover');
const angleFields = byId('cover-angle');
const azimuthInput = byId('cover-azimuth');
const elevationInput = byId('cover-elevation');
const addButton = addForm.querySelector('button[type="submit"]');
const closeEditor = byId('close-add-model');
const deleteDialog = byId('delete-model-dialog');

let editing;
let draft;
let pendingDeletion;
let saving = false;
let previewRevision = 0;

function setAngleReadouts() {
  byId('cover-azimuth-value').textContent = azimuthInput.value + '°';
  byId('cover-elevation-value').textContent = elevationInput.value + '°';
}

function clearEditorPreview() {
  previewRevision++;
  draft = undefined;
  coverImage.hidden = true;
  coverImage.removeAttribute('src');
  coverDownload.hidden = true;
  if (coverDownload.hasAttribute('href')) URL.revokeObjectURL(coverDownload.href);
  coverDownload.removeAttribute('href');
  addButton.disabled = true;
}

function showExistingCover() {
  angleFields.hidden = true;
  stlCoverButton.hidden = !editing;
  if (editing) {
    coverImage.src = cloudFile(editing.cover_path);
    coverImage.hidden = false;
    addButton.disabled = false;
  }
}

function openEditor(row) {
  editing = row;
  addForm.reset();
  clearEditorPreview();
  note(addStatus, '');
  setAngleReadouts();
  fileInput.required = !row;
  byId('cloud-model-fields').hidden = !supabase;
  byId('local-model-fields').hidden = Boolean(supabase);
  byId('add-model-title').textContent = row ? 'Редактировать модель' : 'Добавить модель';
  addButton.textContent = row ? 'Сохранить изменения' : (supabase ? 'Опубликовать модель' : 'Добавить в каталог');
  byId('add-model-help').textContent = row
    ? 'Вы можете заменить STL, выбрать новое фото или переснять обложку текущей модели.'
    : supabase
      ? 'STL и обложка появятся в общем каталоге. Публикуйте модели, которыми вы вправе делиться.'
      : 'Модель сохранится в этом браузере.';
  if (row) {
    byId('library-title').value = row.title;
    byId('library-description').value = row.description;
    byId('library-category').value = row.category;
    byId('library-tags').value = row.tags.join(', ');
    azimuthInput.value = row.cover_azimuth;
    elevationInput.value = row.cover_elevation;
    setAngleReadouts();
  }
  showExistingCover();
  addDialog.showModal();
}

async function startAdding() {
  await cloudSetup;
  if (supabase && !user) openAuth('add');
  else openEditor();
}
byId('open-add-model').addEventListener('click', startAdding);
byId('account-add').addEventListener('click', startAdding);
closeEditor.addEventListener('click', () => addDialog.close());
addDialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
addDialog.addEventListener('close', () => {
  if (!addDialog.open) clearEditorPreview();
});

async function photoCover(photo) {
  if (!/\.(jpe?g|png|webp)$/i.test(photo.name) || !photo.size || photo.size > MAX_PHOTO_SIZE) {
    throw new Error('Выберите фото в формате JPG, PNG или WebP до 10 МБ.');
  }
  const url = URL.createObjectURL(photo);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    throw new Error('Не удалось открыть фото. Попробуйте выбрать другое изображение.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function renderEditorCover() {
  clearEditorPreview();
  const file = fileInput.files[0];
  const photo = photoInput.files[0];
  angleFields.hidden = Boolean(photo) || (!file && !editing);
  stlCoverButton.hidden = !photo && !editing;
  if (file && (!/\.stl$/i.test(file.name) || !file.size || file.size > MAX_FILE_SIZE)) {
    angleFields.hidden = true;
    note(addStatus, 'Выберите непустой STL-файл размером до 20 МБ.', true);
    return;
  }
  if (!file && !photo && !editing) {
    note(addStatus, '');
    return;
  }

  const version = previewRevision;
  const selection = {
    file,
    fileUrl: !file && editing ? cloudFile(editing.stl_path) : undefined,
    customPhoto: Boolean(photo),
    color: '#d4af37',
    azimuth: Number(azimuthInput.value),
    elevation: Number(elevationInput.value)
  };
  const active = () => version === previewRevision && addDialog.open;
  note(addStatus, photo ? 'Готовим фото…' : 'Создаём обложку…');
  try {
    const cover = photo ? await photoCover(photo) : await queueCover(selection, active);
    if (!active()) return;
    const bytes = Uint8Array.from(atob(cover.split(',')[1]), character => character.charCodeAt(0));
    draft = { ...selection, cover, png: new Blob([bytes], { type: 'image/png' }) };
    coverImage.src = cover;
    coverImage.hidden = false;
    coverDownload.href = URL.createObjectURL(draft.png);
    const name = file?.name || photo?.name || 'dexel-model';
    coverDownload.download = name.replace(/\.[^.]+$/, '') + '-cover.png';
    coverDownload.hidden = false;
    addButton.disabled = !file && !editing;
    note(addStatus, addButton.disabled ? 'Фото готово. Добавьте STL-файл модели.' : 'Обложка готова.');
  } catch (error) {
    if (active()) note(addStatus, error instanceof Error ? error.message : 'Не удалось создать обложку.', true);
  }
}

fileInput.addEventListener('change', () => {
  if (fileInput.files.length || photoInput.files.length || !editing) renderEditorCover();
  else {
    clearEditorPreview();
    showExistingCover();
    note(addStatus, '');
  }
});
photoInput.addEventListener('change', renderEditorCover);
stlCoverButton.addEventListener('click', () => {
  photoInput.value = '';
  renderEditorCover();
});
for (const input of [azimuthInput, elevationInput]) {
  input.addEventListener('input', () => {
    setAngleReadouts();
    addButton.disabled = true;
  });
  input.addEventListener('change', renderEditorCover);
}

async function saveCloudModel(fields, selection, row, account) {
  const id = row?.id ?? crypto.randomUUID();
  const prefix = account.id + '/' + id + '/' + crypto.randomUUID();
  const storage = supabase.storage.from(BUCKET);
  const uploaded = [];

  async function upload(path, bytes, contentType) {
    uploaded.push(path);
    const { error } = await storage.upload(path, await bytes.arrayBuffer(), { contentType, upsert: false });
    if (error) throw new Error('Не удалось загрузить файлы модели. Проверьте подключение и настройки хранилища.');
  }

  const payload = { ...fields };
  try {
    if (selection?.file) {
      payload.stl_path = prefix + '.stl';
      await upload(payload.stl_path, selection.file, 'model/stl');
    }
    if (selection) {
      payload.cover_path = prefix + '.png';
      payload.cover_azimuth = selection.azimuth;
      payload.cover_elevation = selection.elevation;
      await upload(payload.cover_path, selection.png, 'image/png');
    }
  } catch (error) {
    if (uploaded.length) await storage.remove(uploaded).catch(() => {});
    throw error;
  }

  let saved;
  try {
    const table = supabase.from('models');
    const change = row
      ? table.update(payload).eq('id', id).eq('user_id', account.id).eq('updated_at', row.updated_at).eq('deleting', false)
      : table.insert({ id, ...payload });
    const { data, error } = await change.select('id, stl_path, cover_path').maybeSingle();
    if (error || !data) throw new Error();
    saved = data;
  } catch {
    // Resolve an interrupted response before removing any file that may have been committed.
    const { data: current, error } = await supabase.from('models')
      .select('id, title, description, category, tags, stl_path, cover_path, cover_azimuth, cover_elevation')
      .eq('id', id).eq('user_id', account.id).eq('deleting', false).maybeSingle();
    const matches = current && Object.entries(payload).every(([key, value]) => JSON.stringify(current[key]) === JSON.stringify(value));
    const filesMatch = current && uploaded.length && uploaded.every(path => path === current.stl_path || path === current.cover_path);
    if (!error && (matches || filesMatch)) {
      saved = current;
    } else {
      if (!error && uploaded.length) {
        await storage.remove(uploaded.filter(path => path !== current?.stl_path && path !== current?.cover_path)).catch(() => {});
      }
      throw new Error('Не удалось подтвердить сохранение. Обновите список моделей перед повторной попыткой.');
    }
  }

  if (row) {
    const old = [row.stl_path, row.cover_path].filter(path => path !== saved.stl_path && path !== saved.cover_path);
    if (old.length) await storage.remove(old).catch(() => {});
  }
}

async function saveLocalModel(data, fields) {
  const link = data.get('download').trim();
  let downloadUrl;
  if (link) {
    const url = new URL(link);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Укажите ссылку для скачивания с https:// или http://.');
    }
    downloadUrl = url.href;
  }
  const { file, cover, color, azimuth, elevation } = draft;
  const model = { file, cover, color, azimuth, elevation, ...fields, downloadUrl, id: crypto.randomUUID(), createdAt: Date.now() };
  let persisted = true;
  try {
    await libraryTransaction('readwrite', store => store.put(model));
  } catch {
    persisted = false;
  }
  addCard(model, true);
  note(libraryStatus, persisted ? 'Модель добавлена в этом браузере.' : 'Модель доступна до закрытия страницы.');
}

addForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving || addButton.disabled || (!editing && !draft?.file)) return;
  const data = new FormData(addForm);
  const fields = { title: data.get('title').trim(), description: data.get('description').trim() };
  if (!fields.title || !fields.description) {
    note(addStatus, 'Укажите название и описание модели.', true);
    return;
  }
  if (supabase) {
    fields.category = data.get('category').trim();
    fields.tags = [...new Set(data.get('tags').split(',').map(tag => tag.trim().replace(/^#+/, '')).filter(Boolean))];
    if (fields.tags.length > 8) {
      note(addStatus, 'Можно указать до восьми тегов.', true);
      return;
    }
    if (!user) {
      note(addStatus, 'Войдите снова, чтобы опубликовать модель.', true);
      return;
    }
  }
  saving = true;
  const editorControls = [closeEditor, fileInput, photoInput, stlCoverButton, azimuthInput, elevationInput];
  addButton.disabled = true;
  for (const control of editorControls) control.disabled = true;
  note(addStatus, supabase ? 'Сохраняем модель в общем каталоге…' : 'Сохраняем модель…');
  try {
    if (draft?.customPhoto && draft.file) {
      const [THREE, { STLLoader }] = await getSTLModules();
      disposeModel(await loadSTL(THREE, STLLoader, draft));
    }
    if (supabase) {
      await saveCloudModel(fields, draft, editing, user);
      listPublicModels(true);
      if (!accountPanel.hidden) loadDashboard();
    } else {
      await saveLocalModel(data, fields);
    }
    addDialog.close();
  } catch (error) {
    note(addStatus, error.message || 'Не удалось сохранить модель. Попробуйте ещё раз.', true);
  } finally {
    saving = false;
    for (const control of editorControls) control.disabled = false;
    addButton.disabled = !editing && !draft?.file;
  }
});

function askToDelete(row) {
  pendingDeletion = row;
  deleteDialog.returnValue = '';
  byId('delete-model-message').textContent = '«' + row.title + '» исчезнет из каталога. STL и обложка будут удалены.';
  deleteDialog.showModal();
}

deleteDialog.addEventListener('close', async () => {
  if (deleteDialog.returnValue !== 'delete' || !pendingDeletion || !user) return;
  const row = pendingDeletion;
  const owner = user.id;
  pendingDeletion = undefined;
  ownedList.inert = true;
  note(accountStatus, 'Удаляем модель и её файлы…');
  try {
    const table = supabase.from('models');
    if (!row.deleting) {
      const { data, error } = await table.update({ deleting: true }).eq('id', row.id).eq('user_id', owner)
        .eq('updated_at', row.updated_at).select('id').maybeSingle();
      if (error || !data) throw new Error();
      row.deleting = true;
      listPublicModels(true);
    }

    const folder = owner + '/' + row.id;
    const storage = supabase.storage.from(BUCKET);
    const paths = [];
    for (let offset = 0;; offset += 100) {
      const { data, error } = await storage.list(folder, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw error;
      paths.push(...data.filter(file => file.id).map(file => folder + '/' + file.name));
      if (data.length < 100) break;
    }
    for (let start = 0; start < paths.length; start += 100) {
      const { error } = await storage.remove(paths.slice(start, start + 100));
      if (error) throw error;
    }
    const { error } = await supabase.from('models').delete().eq('id', row.id).eq('user_id', owner).eq('deleting', true);
    if (error) throw error;
    await loadDashboard();
  } catch {
    await loadDashboard();
    note(accountStatus, 'Удаление не завершилось. Проверьте список и повторите попытку.', true);
  } finally {
    ownedList.inert = false;
  }
});

for (const model of publishedModels) {
  model.cover = cachedCover(model);
  const image = addCard(model);
  if (model.cover) continue;
  queueCover(model).then(cover => {
    model.cover = cover;
    image.src = cover;
    rememberCover(model, cover);
  }).catch(() => {
    if (!model.placeholder) image.alt = 'Обложка модели недоступна';
  });
}

libraryTransaction('readonly', store => store.getAll()).then(entries => {
  entries.sort((a, b) => a.createdAt - b.createdAt);
  for (const entry of entries) addCard(entry, true);
}).catch(() => {});
