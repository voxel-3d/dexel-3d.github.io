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

function modelDirection(THREE) {
  const elevation = THREE.MathUtils.degToRad(40);
  return new THREE.Vector3(Math.cos(elevation) / Math.SQRT2, Math.sin(elevation), Math.cos(elevation) / Math.SQRT2);
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
    camera.position.copy(modelDirection(THREE)).multiplyScalar(4);
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
  card.querySelector('p').textContent = entry.description;
  card.querySelector('button').addEventListener('click', () => openModel(entry));

  const download = card.querySelector('.catalogue-download');
  const fileName = entry.file?.name || entry.fileUrl.split('/').at(-1).split('?')[0];
  download.download = fileName;
  if (entry.downloadUrl || entry.fileUrl) {
    download.href = entry.downloadUrl || entry.fileUrl;
    if (entry.downloadUrl) {
      download.target = '_blank';
      download.rel = 'noopener noreferrer';
    }
  } else {
    download.href = URL.createObjectURL(entry.file);
  }
  const params = new URLSearchParams({ model: entry.title });
  card.querySelector('.catalog-order').href = '../#request?' + params.toString();
  if (first) grid.prepend(card);
  else grid.append(card);
  return image;
}

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

const addDialog = byId('add-model-dialog');
const addForm = byId('add-model-form');
const fileInput = byId('library-file');
const addStatus = byId('add-model-status');
const coverImage = byId('library-cover');
const coverDownload = byId('download-cover');
const addButton = addForm.querySelector('button[type="submit"]');
let draft;
let saving = false;

function setAddStatus(message, error = false) {
  addStatus.textContent = message;
  addStatus.toggleAttribute('data-error', error);
}

function clearCover() {
  draft = undefined;
  coverImage.hidden = true;
  coverImage.removeAttribute('src');
  coverDownload.hidden = true;
  if (coverDownload.hasAttribute('href')) URL.revokeObjectURL(coverDownload.href);
  coverDownload.removeAttribute('href');
  addButton.disabled = true;
}

byId('open-add-model').addEventListener('click', () => addDialog.showModal());
byId('close-add-model').addEventListener('click', () => addDialog.close());

fileInput.addEventListener('change', async () => {
  clearCover();
  const file = fileInput.files[0];
  if (!file) {
    setAddStatus('');
    return;
  }
  if (!/\.stl$/i.test(file.name) || !file.size || file.size > MAX_FILE_SIZE) {
    setAddStatus('Выберите непустой STL-файл размером до 20 МБ.', true);
    return;
  }

  const selection = { file, color: colors[0][1] };
  draft = selection;
  const active = () => draft === selection;
  setAddStatus('Создаём обложку…');
  try {
    const cover = await queueCover(selection, active);
    if (!active()) return;
    const bytes = Uint8Array.from(atob(cover.split(',')[1]), character => character.charCodeAt(0));
    const png = new Blob([bytes], { type: 'image/png' });

    selection.cover = cover;
    coverImage.src = cover;
    coverImage.hidden = false;
    coverDownload.href = URL.createObjectURL(png);
    coverDownload.download = file.name.replace(/\.stl$/i, '') + '-cover.png';
    coverDownload.hidden = false;
    addButton.disabled = false;
    setAddStatus('Обложка готова.');
  } catch (error) {
    if (active()) setAddStatus(error instanceof Error ? error.message : 'Не удалось создать обложку.', true);
  }
});

addForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!draft?.cover || saving) return;

  const data = new FormData(addForm);
  const name = data.get('title').trim();
  const summary = data.get('description').trim();
  const link = data.get('download').trim();
  if (!name || !summary) {
    setAddStatus('Укажите название и описание модели.', true);
    return;
  }
  let downloadUrl;
  if (link) {
    try {
      const url = new URL(link);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
      downloadUrl = url.href;
    } catch {
      setAddStatus('Укажите ссылку для скачивания с https:// или http://.', true);
      return;
    }
  }
  const record = {
    ...draft, id: crypto.randomUUID(), title: name, description: summary,
    downloadUrl, createdAt: Date.now()
  };
  saving = true;
  fileInput.disabled = addButton.disabled = true;
  let persisted = true;
  try {
    await libraryTransaction('readwrite', store => store.put(record));
  } catch {
    persisted = false;
  } finally {
    saving = false;
    fileInput.disabled = false;
  }
  addCard(record, true);
  libraryStatus.textContent = persisted ? 'Модель добавлена в этом браузере.' : 'Модель доступна до закрытия страницы.';
  addForm.reset();
  clearCover();
  setAddStatus('');
  addDialog.close();
});

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
