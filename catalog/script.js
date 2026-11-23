const GOOGLE_DRIVE_UPLOAD_URL = 'https://script.google.com/macros/s/AKfycbzulR4uSuyRMdNPEm784BzatwkIUgyw5-_RLJUGb1e7WgOYywgmiGuXXn7qb_QRaFS2/exec';

import { initSocial } from './social.js?v=social';

// Use the project URL and a public publishable (or legacy anon) key from Supabase.
const SUPABASE_URL = 'https://vvwsenwbjhmagwigtfqs.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zXO4GY-2ou6HpvEWzeaO9Q_XT7uJkDg';

const INFILL = 0.25;
const DENSITY_G_CM3 = 1.25;
const CATEGORIES = ['Все', 'Для дома и быта', 'Автотовары', 'Тактика и шевроны', 'Органайзеры', 'Аксессуары и подарки', 'Другое'];

// Add public STL entries here. Version the file URL when replacing an existing STL.
const publishedModels = [
  {
    id: 'ribbed-vase', category: 'Для дома и быта',
    fileUrl: 'assets/ribbed-vase.stl',
    title: 'Рельефная ваза',
    description: 'Мягкий силуэт и ритм вертикальных рёбер для сухоцветов.',
    color: '#a87a55',
    placeholder: 'assets/ribbed-vase.webp'
  },
  {
    id: 'phone-stand', category: 'Органайзеры',
    fileUrl: 'assets/phone-stand.stl',
    title: 'Подставка для телефона',
    description: 'Наклонная опора с нижним упором для рабочего стола.',
    color: '#426487',
    placeholder: 'assets/phone-stand.webp'
  },
  {
    id: 'hex-organizer', category: 'Органайзеры',
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
const catalogTitle = document.title;
const canonical = document.querySelector('link[rel="canonical"]');
const catalogURL = canonical.href;
const entries = new Map();
const cards = new WeakMap();
const localMeasurements = new WeakMap();
const decimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
let social;
let activeModel;
let activeCategory = 'Все';
let visibleLimit = 24;
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
  byId('printer-bed').disabled = byId('model-wireframe').disabled = !enabled;
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

// Signed tetrahedra in the original STL coordinate system (Z up, millimetres).
function measureGeometry(geometry) {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  const positions = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const count = index ? index.count : positions.count;
  let sixVolume = 0;
  let netX = 0, netY = 0, netZ = 0, area = 0;
  for (let i = 0; i < count; i += 3) {
    const a = index ? index.getX(i) : i;
    const b = index ? index.getX(i + 1) : i + 1;
    const c = index ? index.getX(i + 2) : i + 2;
    const ax = positions.getX(a) - min.x, ay = positions.getY(a) - min.y, az = positions.getZ(a) - min.z;
    const bx = positions.getX(b) - min.x, by = positions.getY(b) - min.y, bz = positions.getZ(b) - min.z;
    const cx = positions.getX(c) - min.x, cy = positions.getY(c) - min.y, cz = positions.getZ(c) - min.z;
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    sixVolume += ax * nx + ay * ny + az * nz;
    netX += nx; netY += ny; netZ += nz;
    area += Math.sqrt(nx * nx + ny * ny + nz * nz);
  }
  // Nonzero net surface normal is evidence of a hole or inconsistent triangle winding.
  const volume = Math.hypot(netX, netY, netZ) <= area * 1e-6 ? Math.abs(sixVolume) / 6000 : null;
  return { width: max.x - min.x, depth: max.y - min.y, height: max.z - min.z, volume };
}

function validMetrics(metrics) {
  return metrics && ['width', 'depth', 'height'].every(key =>
    Number.isFinite(metrics[key]) && metrics[key] >= 0) &&
    (metrics.volume === null || (Number.isFinite(metrics.volume) && metrics.volume >= 0));
}

function showSpecs(container, metrics) {
  container.replaceChildren();
  if (!validMetrics(metrics)) return;
  const { width, depth, height, volume } = metrics;
  const dimensions = document.createElement('span');
  dimensions.textContent = 'Ш × Г × В: ' + [width, depth, height].map(v => decimal.format(v)).join(' × ') + ' мм';
  container.append(dimensions);
  const material = document.createElement('span');
  container.append(material);
  if (!volume) {
    material.textContent = 'Объём не определён. Проверьте замкнутость сетки.';
    return;
  }
  const grams = volume * DENSITY_G_CM3 * INFILL;
  material.textContent = 'Объём: ' + decimal.format(volume) + ' см³ · Пластик: ≈ ' + decimal.format(grams) + ' г';
}

async function readMetrics(entry) {
  if (entry.coverTask) await entry.coverTask;
  if (validMetrics(entry.metrics)) return entry.metrics;
  if (entry.file && localMeasurements.has(entry.file)) {
    entry.metrics = localMeasurements.get(entry.file);
    return entry.metrics;
  }
  const [THREE, { STLLoader }] = await getSTLModules();
  const mesh = await loadSTL(THREE, STLLoader, entry);
  disposeModel(mesh);
  return entry.metrics;
}

// Google Apps Script handles STL bytes; Supabase retains metadata and light images.
function driveFileId(path = '') {
  return path.match(/\/drive-([A-Za-z0-9_-]{10,160})\.stl$/)?.[1];
}
function driveEndpoint() {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(GOOGLE_DRIVE_UPLOAD_URL)) {
    throw new Error('Загрузка STL пока не настроена. Укажите GOOGLE_DRIVE_UPLOAD_URL веб-приложения Google Apps Script.');
  }
  return GOOGLE_DRIVE_UPLOAD_URL;
}
function driveJSONP(params, signal) {
  return new Promise((resolve, reject) => {
    const url = new URL(driveEndpoint());
    const callback = 'dexelDrive_' + crypto.randomUUID().replaceAll('-', '');
    for (const [key, value] of Object.entries({...params, callback})) url.searchParams.set(key, value);
    const script = document.createElement('script');
    let timer;
    const finish = (error, data) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      script.remove();
      // A late JSONP response must not throw after cancellation.
      window[callback] = () => {};
      setTimeout(() => delete window[callback], 60000);
      error ? reject(error) : resolve(data);
    };
    const abort = () => finish(new DOMException('Aborted', 'AbortError'));
    if (signal?.aborted) return abort();
    window[callback] = data => finish(null, data);
    script.onerror = () => finish(new Error('Google Диск недоступен. Проверьте доступ Web App: «Все».'));
    timer = setTimeout(() => finish(new Error('Google Диск не ответил вовремя. Повторите попытку.')), 90000);
    signal?.addEventListener('abort', abort, {once:true});
    script.src = url.href;
    script.referrerPolicy = 'no-referrer';
    document.head.append(script);
  });
}
async function driveRead(fileId, signal) {
  const url = new URL(driveEndpoint());
  url.searchParams.set('id', fileId);
  let data;
  try {
    const response = await fetch(url, {signal, credentials:'omit', redirect:'follow'});
    if (!response.ok) throw new Error('HTTP ' + response.status);
    data = await response.json();
  } catch (error) {
    signal?.throwIfAborted();
    data = await driveJSONP({id:fileId}, signal);
  }
  if (!data.ok) throw new Error(data.error || 'Не удалось получить STL с Google Диска.');
  if (typeof data.base64 !== 'string' || data.base64.length > Math.ceil(MAX_FILE_SIZE / 3) * 4) throw new Error('Некорректный размер STL.');
  const binary = atob(data.base64);
  if (!binary.length || binary.length > MAX_FILE_SIZE) throw new Error('Некорректный размер STL.');
  return Uint8Array.from(binary, char => char.charCodeAt(0)).buffer;
}
async function drivePost(action, payload) {
  const endpoint = driveEndpoint();
  const {data, error} = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('Войдите в личный кабинет заново.');
  const requestId = crypto.randomUUID();
  let result;
  try {
    const response = await fetch(endpoint, {
      method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
      credentials:'omit', redirect:'follow', signal:AbortSignal.timeout(120000),
      body:JSON.stringify({action, requestId, ...payload, accessToken:data.session.access_token})
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    result = await response.json();
  } catch {
    // POST may have succeeded although its redirect was blocked. Never repeat a write blindly.
    for (let attempt = 0; attempt < 6; attempt++) {
      result = await driveJSONP({action:'status', requestId});
      if (!result.pending) break;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    if (result?.pending) throw new Error('Не удалось подтвердить загрузку/удаление на Google Диске. Проверьте папку и подключение перед повтором.');
  }
  if (!result?.ok) throw new Error(result?.error || 'Ошибка Google Диска.');
  return result;
}
function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Не удалось прочитать STL.'));
    reader.readAsDataURL(file);
  });
}
async function removeAsset(path) {
  const id = driveFileId(path);
  if (id) await drivePost('delete', {fileId:id});
  else {
    const {error} = await supabase.storage.from(BUCKET).remove([path]);
    if (error) throw error;
  }
}
async function webpCover(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = COVER_WIDTH;
    canvas.height = COVER_HEIGHT;
    const context = canvas.getContext('2d');
    context.fillStyle = '#20221d';
    context.fillRect(0, 0, canvas.width, canvas.height);
    // Preserve the complete model/photo rather than cropping it.
    const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
    context.drawImage(image, (canvas.width-w)/2, (canvas.height-h)/2, w, h);
    const result = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .82));
    if (!result || result.type !== 'image/webp') throw new Error('Браузер не поддерживает сохранение WebP. Обновите браузер.');
    return result;
  } finally { URL.revokeObjectURL(url); }
}
async function downloadDriveModel(event, entry, name) {
  event.preventDefault();
  const button = event.currentTarget;
  if (button.getAttribute('aria-busy') === 'true') return;
  button.setAttribute('aria-busy', 'true');
  const label = button.textContent;
  button.textContent = 'Загружаем STL…';
  try {
    const bytes = await driveRead(entry.driveId);
    const url = URL.createObjectURL(new Blob([bytes], {type:'model/stl'}));
    const link = document.createElement('a');
    link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    logModelEvent(entry, 'download');
  } catch (error) { note(libraryStatus, error.message, true); }
  finally { button.removeAttribute('aria-busy'); button.textContent = label; }
}

async function loadSTL(THREE, STLLoader, entry, signal) {
  let bytes;
  if (entry.file) {
    bytes = await entry.file.arrayBuffer();
  } else if (entry.driveId) {
    bytes = await driveRead(entry.driveId, signal);
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
  let originalRadius;
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
    originalRadius = radius;
    entry.metrics = measureGeometry(geometry);
    if (entry.file) localMeasurements.set(entry.file, entry.metrics);
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.scale(1 / radius, 1 / radius, 1 / radius);
    // STL is Z-up. Three.js is Y-up.
    geometry.rotateX(-Math.PI / 2);
  } catch {
    geometry?.dispose();
    throw new Error('Не удалось прочитать геометрию. Проверьте STL-файл.');
  }

  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: entry.color, roughness: .64, metalness: .06
  }));
  mesh.userData.mmPerUnit = originalRadius;
  return mesh;
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

  const bedSize = 260 / model.userData.mmPerUnit;
  const bed = new THREE.GridHelper(bedSize, 26, 0xd4af37, 0x99824c);
  bed.position.set(sphere.center.x, bounds.min.y, sphere.center.z);
  bed.material.transparent = true;
  bed.material.opacity = .45;
  bed.material.depthWrite = false;
  bed.visible = false;
  scene.add(bed);
  const bedRadius = Math.max(sphere.radius, Math.hypot(bedSize / Math.sqrt(2), bed.position.y) + sphere.center.length());

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
    const fitRadius = bed.visible ? bedRadius : sphere.radius;
    const nextFit = 1.12 * fitRadius / Math.sin(Math.min(halfHeight, halfWidth));
    if (fitDistance) camera.position.multiplyScalar(nextFit / fitDistance);
    else camera.position.copy(direction).multiplyScalar(nextFit);
    fitDistance = nextFit;
    controls.maxDistance = Math.max(sphere.radius * 40, fitDistance * 2);
    camera.far = Math.max(sphere.radius * 150, fitRadius * 150);
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
    bed.dispose();
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
      setBed(visible) {
        bed.visible = visible;
        fitDistance = 0;
        resize();
      },
      setWireframe(enabled) {
        model.material.wireframe = enabled;
        render();
      },
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

async function openModel(entry, push = true) {
  if (dialog.open && activeModel?.id === entry.id) return;
  currentLoad?.abort();
  viewer?.dispose();
  viewer = undefined;
  activeModel = entry;
  social?.openModel(entry);
  if (push && new URL(location.href).searchParams.get('model') !== entry.id) {
    const url = new URL(location.href);
    url.searchParams.set('model', entry.id);
    const depth = !dialog.open ? 1 : history.state?.dexelDepth ? history.state.dexelDepth + 1 : 0;
    history.pushState({ ...history.state, dexelDepth: depth }, '', url);
  }
  document.title = entry.title + ' — 3D-модель скачать и заказать печать | DEXEL 3D';
  canonical.href = modelURL(entry, catalogURL);
  byId('viewer-share-status').textContent = '';
  byId('printer-bed').checked = byId('model-wireframe').checked = false;
  showSpecs(byId('viewer-specs'), entry.metrics);
  byId('viewer-order').href = orderURL(entry);
  showRelated(entry);
  logModelEvent(entry, 'view');
  preview.removeAttribute('src');
  const cover = entry.cover || entry.placeholder;
  if (cover) preview.src = cover;
  preview.alt = entry.title;
  preview.hidden = !cover;
  title.textContent = entry.title;
  description.textContent = entry.description;
  initColors(entry.color);
  status.textContent = 'Загружаем 3D-модель…';
  enableActions(false);
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;

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
    showSpecs(byId('viewer-specs'), entry.metrics);
    const card = cards.get(entry);
    if (card) showSpecs(card.querySelector('.model-specs'), entry.metrics);
    renderer = await selectRenderer(THREE);
    load.signal.throwIfAborted();
    viewer = createViewer(THREE, OrbitControls, renderer, model, entry.title, () => {
      showError('3D-просмотр прервался. Закройте окно и откройте его снова.');
    });
    preview.hidden = true;
    status.textContent = '';
    enableActions(true);
  } catch (error) {
    disposeRenderer(renderer);
    if (model) disposeModel(model);
    if (!load.signal.aborted) {
      showError(error instanceof Error ? error.message : '3D-модель не открылась.');
    }
  }
}

function modelURL(entry, base = new URL(location.pathname, location.origin)) {
  const url = new URL(base);
  url.searchParams.set('model', entry.id);
  return url.href;
}

function bindModelLink(link, entry) {
  link.href = modelURL(entry);
  link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openModel(entry);
  });
}

function orderURL(entry) {
  return '../#request?' + new URLSearchParams({ model: entry.title });
}

async function recordOrder(event, entry) {
  if (!entry.remote) return;
  const recorded = logModelEvent(entry, 'order');
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const href = event.currentTarget.href;
  await Promise.race([recorded, new Promise(resolve => setTimeout(resolve, 1000))]);
  location.assign(href);
}

async function shareModel(entry, message) {
  const url = modelURL(entry);
  try {
    await navigator.clipboard.writeText(url);
    clearTimeout(message.dismissTimer);
    message.textContent = entry.file ? 'Ссылка скопирована. Локальная модель доступна в этом браузере.' : 'Ссылка скопирована';
    message.dismissTimer = setTimeout(() => { message.textContent = ''; }, 3500);
  } catch {
    window.prompt('Скопируйте ссылку на модель', url);
  }
}

function categoryOf(entry) {
  return CATEGORIES.includes(entry.category) ? entry.category : 'Другое';
}

function showRelated(entry) {
  const pool = [...entries.values()].filter(other => other.id !== entry.id && categoryOf(other) === categoryOf(entry));
  const related = byId('related-grid');
  related.replaceChildren();
  for (let i = 0; i < Math.min(3, pool.length); i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    const other = pool[i];
    const link = document.createElement('a');
    link.className = 'related-card';
    const src = other.cover || other.placeholder;
    if (src) {
      const image = new Image();
      image.alt = '';
      image.src = src;
      link.append(image);
    }
    link.append(other.title);
    bindModelLink(link, other);
    related.append(link);
  }
  byId('related-models').hidden = !related.childElementCount;
}

function createCard(entry) {
  const card = template.content.firstElementChild.cloneNode(true);
  const image = card.querySelector('img');
  image.alt = entry.title + ' — 3D-превью';
  const cover = entry.cover || entry.placeholder;
  if (cover) image.src = cover;
  const link = card.querySelector('.model-link');
  link.textContent = entry.title;
  bindModelLink(link, entry);
  bindModelLink(card.querySelector('.open-model'), entry);
  card.querySelector('.catalog-card-description').textContent = entry.description;
  const meta = card.querySelector('.catalog-card-meta');
  meta.textContent = describeModel(entry);
  card.querySelector('.catalog-share').addEventListener('click', () => shareModel(entry, byId('catalog-share-status')));
  social?.bindFavorite(card.querySelector('.favorite-button'), entry);
  card.dataset.modelId = entry.id;
  showSpecs(card.querySelector('.model-specs'), entry.metrics);

  const download = card.querySelector('.catalogue-download');
  const fileName = entry.remote
    ? entry.title.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 80) + '.stl'
    : entry.file?.name || entry.fileUrl.split('/').at(-1).split('?')[0];
  download.download = fileName;
  if (entry.driveId) {
    download.href = 'https://drive.google.com/file/d/' + entry.driveId + '/view';
    download.addEventListener('click', event => downloadDriveModel(event, entry, fileName));
  } else if (entry.remote) {
    download.href = cloudFile(entry.remote.stl_path, fileName);
    download.addEventListener('click', () => logModelEvent(entry, 'download'));
  } else if (entry.downloadUrl || entry.fileUrl) {
    download.href = entry.downloadUrl || entry.fileUrl;
    if (entry.downloadUrl) {
      download.target = '_blank';
      download.rel = 'noopener noreferrer';
    }
  } else {
    download.href = URL.createObjectURL(entry.file);
  }
  const order = card.querySelector('.catalog-order');
  order.href = orderURL(entry);
  order.addEventListener('click', event => recordOrder(event, entry));
  return card;
}

let measurementQueue = Promise.resolve();
const measureVisible = new IntersectionObserver(records => {
  for (const record of records) {
    if (!record.isIntersecting) continue;
    const card = record.target;
    measureVisible.unobserve(card);
    const entry = entries.get(card.dataset.modelId);
    if (!entry || validMetrics(entry.metrics)) continue;
    measurementQueue = measurementQueue.then(async () => {
      if (!card.isConnected) return;
      const specs = card.querySelector('.model-specs');
      try { showSpecs(specs, await readMetrics(entry)); }
      catch { specs.textContent = 'Расчёт недоступен. Откройте модель для повторной попытки.'; }
    }).catch(() => {});
  }
}, { rootMargin: '160px' });

function renderCatalog(reset = false) {
  if (reset) visibleLimit = PAGE_SIZE;
  const search = byId('model-search').value.trim().toLocaleLowerCase('ru');
  const sort = byId('catalog-sort').value;
  const matches = [...entries.values()].filter(entry =>
    (activeCategory === 'Все' || categoryOf(entry) === activeCategory) &&
    (entry.title + ' ' + entry.description).toLocaleLowerCase('ru').includes(search));
  matches.sort((a,b) => {
    const delta = sort === 'new' ? 0 : (b.remote?.[sort] || 0) - (a.remote?.[sort] || 0);
    return delta || (b.createdAt || 0) - (a.createdAt || 0);
  });
  const visible = matches.slice(0, visibleLimit).map(entry => {
    let card = cards.get(entry);
    if (!card) {
      card = createCard(entry);
      cards.set(entry, card);
    }
    if (!validMetrics(entry.metrics)) measureVisible.observe(card);
    else showSpecs(card.querySelector('.model-specs'), entry.metrics);
    return card;
  });
  if (grid.children.length !== visible.length || visible.some((card,i) => grid.children[i] !== card)) {
    for (const card of grid.children) if (!visible.includes(card)) measureVisible.unobserve(card);
    grid.replaceChildren(...visible);
  }
  byId('catalog-empty').hidden = listing || matches.length !== 0;
  catalogMore.hidden = !catalogFailed && matches.length <= visibleLimit;
}

for (const button of actions) {
  button.addEventListener('click', () => {
    if (!viewer) return;
    if (button.dataset.viewAction === 'reset') viewer.reset();
    else viewer.zoom(button.dataset.viewAction === 'in' ? .8 : 1.25);
  });
}

colorPicker.addEventListener('change', () => viewer?.setColor(colorPicker.value));

byId('printer-bed').addEventListener('change', event => viewer?.setBed(event.target.checked));
byId('model-wireframe').addEventListener('change', event => viewer?.setWireframe(event.target.checked));
byId('viewer-share').addEventListener('click', () => shareModel(activeModel, byId('viewer-share-status')));
byId('viewer-order').addEventListener('click', event => recordOrder(event, activeModel));

dialog.addEventListener('close', () => {
  if (dialog.open) return;
  const wasActive = activeModel;
  activeModel = undefined;
  document.title = catalogTitle;
  canonical.href = catalogURL;
  const url = new URL(location.href);
  if (wasActive && url.searchParams.get('model') === wasActive.id) {
    if (history.state?.dexelDepth) history.go(-history.state.dexelDepth);
    else {
      url.searchParams.delete('model');
      history.replaceState(history.state, '', url);
    }
  }
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
let catalogFailed = false;
let listing = false;
let catalogVersion = 0;
let dashboardVersion = 0;
let owned = [];
let authTarget = 'account';

const pendingEvents = new Map();

function note(element, message, error = false) {
  element.textContent = message;
  element.toggleAttribute('data-error', error);
}

function describeModel(entry) {
  const row = entry.remote;
  if (!row) return (entry.file ? 'Локальная модель' : 'Автор: DEXEL 3D') + ' · ' + categoryOf(entry);
  return [
    'Автор: ' + row.author_name,
    categoryOf(entry),
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
    id: row.id, title: row.title, description: row.description, category: row.category,
    createdAt: Date.parse(row.created_at), metrics: row.geometry_metrics,
    color: '#d4af37', driveId: driveFileId(row.stl_path),
    fileUrl: driveFileId(row.stl_path) ? undefined : cloudFile(row.stl_path), cover: cloudFile(row.cover_path), remote: row
  };
}

async function listPublicModels(restart = false) {
  if (!supabase) return;
  if (listing && !restart) return;
  listing = true;
  catalogFailed = false;
  const version = ++catalogVersion;
  const rows = [];
  try {
    // Fetch metadata only; page the visible cards and load older STL geometry on demand.
    const batchSize = 200;
    for (let offset = 0;; offset += batchSize) {
      const { data, error } = await supabase.from('models').select('*').eq('deleting', false)
        .order('created_at', { ascending: false }).order('id').range(offset, offset + batchSize - 1);
      if (version !== catalogVersion) return;
      if (error) throw error;
      rows.push(...data);
      if (data.length < batchSize) break;
    }
    const available = new Set(rows.map(row => row.id));
    for (const [id, entry] of entries) if (entry.remote && !available.has(id)) entries.delete(id);
    for (const row of rows) entries.set(row.id, publicEntry(row));
    note(libraryStatus, '');
    if (activeModel) showRelated(activeModel);
    social?.catalogUpdated();
  } catch {
    if (version !== catalogVersion) return;
    catalogFailed = true;
    note(libraryStatus, 'Не удалось загрузить общий каталог. Можно повторить загрузку.', true);
  } finally {
    if (version === catalogVersion) {
      listing = false;
      catalogMore.textContent = catalogFailed ? 'Повторить загрузку' : 'Показать ещё';
      renderCatalog();
    }
  }
}

catalogMore.addEventListener('click', () => {
  if (catalogFailed) { listPublicModels(true).then(followLocation); return; }
  visibleLimit += PAGE_SIZE;
  renderCatalog();
});

function logModelEvent(entry, kind) {
  if (!entry.remote || !supabase) return Promise.resolve();
  const modelId = entry.id;
  const previous = pendingEvents.get(modelId) || Promise.resolve();
  const pending = previous.then(async () => {
    const { data, error } = await supabase.rpc('record_model_event', { model_id: modelId, event_type: kind });
    if (error || !data?.[0]) return;
    const counters = data[0];
    Object.assign(entry.remote, counters);
    const active = entries.get(modelId);
    if (active?.remote) {
      Object.assign(active.remote, counters);
      const activeMeta = cards.get(active)?.querySelector('.catalog-card-meta');
      if (activeMeta) activeMeta.textContent = describeModel(active);
    }
    if (byId('catalog-sort').value !== 'new') renderCatalog();
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
  byId('requests-panel').hidden = true;
  byId('catalog-title').setAttribute('tabindex', '-1');
  byId('catalog-title').focus();
}

function showAccount() {
  if (!user) return;
  publicCatalog.hidden = true;
  byId('requests-panel').hidden = true;
  accountPanel.hidden = false;
  byId('account-identity').textContent = user.user_metadata?.display_name || user.email;
  byId('account-heading').focus();
  loadDashboard();
}

function updateSession(session) {
  const before = user?.id;
  user = session?.user;
  social?.sessionChanged(user);
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
  byId('upload-specs').replaceChildren();
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
    byId('library-category').value = categoryOf(row);
    showSpecs(byId('upload-specs'), row.geometry_metrics);
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
    driveId: !file && editing ? driveFileId(editing.stl_path) : undefined,
    fileUrl: !file && editing && !driveFileId(editing.stl_path) ? cloudFile(editing.stl_path) : undefined,
    color: '#d4af37',
    azimuth: Number(azimuthInput.value),
    elevation: Number(elevationInput.value)
  };
  const active = () => version === previewRevision && addDialog.open;
  note(addStatus, photo ? 'Готовим фото…' : 'Создаём обложку…');
  try {
    const cover = photo ? await photoCover(photo) : await queueCover(selection, active);
    if (!active()) return;
    if (photo && file) selection.metrics = await readMetrics(selection);
    if (!active()) return;
    showSpecs(byId('upload-specs'), selection.metrics || editing?.geometry_metrics);
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
    if (active()) {
      showSpecs(byId('upload-specs'), selection.metrics);
      note(addStatus, error instanceof Error ? error.message : 'Не удалось создать обложку.', true);
    }
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
  let drivePath;
  const cleanup = async paths => {
    const failed = [];
    for (const path of paths) {
      try { await removeAsset(path); } catch { failed.push(path); }
    }
    if (failed.length) note(accountStatus, 'Модель сохранена/обновлена не полностью: часть старых или временных файлов не удалена. Проверьте хранилище.', true);
  };

  async function upload(path, bytes, contentType) {
    uploaded.push(path);
    const { error } = await storage.upload(path, await bytes.arrayBuffer(), { contentType, upsert: false });
    if (error) throw new Error('Не удалось загрузить файлы модели. Проверьте подключение и настройки хранилища.');
  }

  const payload = { ...fields };
  try {
    if (selection?.file) {
      payload.geometry_metrics = selection.metrics;
      if (!selection.file.size || selection.file.size > MAX_FILE_SIZE) throw new Error('STL должен быть не больше 20 МБ.');
      const result = await drivePost('upload', {modelId:id, name:selection.file.name, base64:await fileBase64(selection.file)});
      if (!/^[A-Za-z0-9_-]{10,160}$/.test(result.fileId || '')) throw new Error('Google Диск вернул неверный ID файла.');
      payload.stl_path = account.id + '/' + id + '/drive-' + result.fileId + '.stl';
      drivePath = payload.stl_path;
    }
    if (selection) {
      payload.cover_path = prefix + '.webp';
      payload.cover_azimuth = selection.azimuth;
      payload.cover_elevation = selection.elevation;
      await upload(payload.cover_path, await webpCover(selection.png), 'image/webp');
    }
  } catch (error) {
    await cleanup([...uploaded, ...(drivePath ? [drivePath] : [])]);
    throw error;
  }

  let saved;
  try {
    const table = supabase.from('models');
    const write = () => {
      const change = row
        ? table.update(payload).eq('id', id).eq('user_id', account.id).eq('updated_at', row.updated_at).eq('deleting', false)
        : table.insert({ id, ...payload });
      return change.select('id, stl_path, cover_path').maybeSingle();
    };
    let { data, error } = await write();
    if (error?.code === 'PGRST204' && error.message.includes('geometry_metrics') && 'geometry_metrics' in payload) {
      // Existing installations can still publish before the optional migration runs.
      delete payload.geometry_metrics;
      ({ data, error } = await write());
    }
    if (error || !data) throw new Error();
    saved = data;
  } catch {
    // Resolve an interrupted response before removing any file that may have been committed.
    const { data: current, error } = await supabase.from('models')
      .select('*')
      .eq('id', id).eq('user_id', account.id).eq('deleting', false).maybeSingle();
    const matches = current && Object.entries(payload).every(([key, value]) => JSON.stringify(current[key]) === JSON.stringify(value));
    const written = [...uploaded, ...(drivePath ? [drivePath] : [])];
    const filesMatch = current && written.length && written.every(path => path === current.stl_path || path === current.cover_path);
    if (!error && (matches || filesMatch)) {
      saved = current;
    } else {
      if (!error && written.length) {
        await cleanup(written.filter(path => path !== current?.stl_path && path !== current?.cover_path));
      }
      throw new Error('Не удалось подтвердить сохранение. Обновите список моделей перед повторной попыткой.');
    }
  }

  if (row) {
    const old = [row.stl_path, row.cover_path].filter(path => path !== saved.stl_path && path !== saved.cover_path);
    if (old.length) await cleanup(old);
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
  const model = { file, cover, color, azimuth, elevation, metrics: draft.metrics, ...fields, downloadUrl, id: crypto.randomUUID(), createdAt: Date.now() };
  let persisted = true;
  try {
    await libraryTransaction('readwrite', store => store.put(model));
  } catch {
    persisted = false;
  }
  entries.set(model.id, model);
  renderCatalog();
  note(libraryStatus, persisted ? 'Модель добавлена в этом браузере.' : 'Модель доступна до закрытия страницы.');
}

addForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving || addButton.disabled || (!editing && !draft?.file)) return;
  const data = new FormData(addForm);
  const fields = { title: data.get('title').trim(), description: data.get('description').trim(), category: data.get('category') };
  if (!fields.title || !fields.description) {
    note(addStatus, 'Укажите название и описание модели.', true);
    return;
  }
  if (supabase) {
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

    if (driveFileId(row.stl_path)) await removeAsset(row.stl_path);
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

for (const category of CATEGORIES) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = category;
  button.setAttribute('aria-pressed', String(category === activeCategory));
  button.addEventListener('click', () => {
    activeCategory = category;
    for (const option of byId('category-filters').children) option.setAttribute('aria-pressed', String(option === button));
    renderCatalog(true);
  });
  byId('category-filters').append(button);
  byId('library-category').add(new Option(category, category, category === 'Другое', category === 'Другое'));
}
byId('model-search').addEventListener('input', () => renderCatalog(true));
byId('catalog-sort').addEventListener('change', () => renderCatalog(true));

for (const model of publishedModels) {
  model.cover = cachedCover(model);
  entries.set(model.id, model);
  if (model.cover) continue;
  model.coverTask = queueCover(model).then(cover => {
    model.cover = cover;
    const card = cards.get(model);
    if (card) {
      card.querySelector('img').src = cover;
      showSpecs(card.querySelector('.model-specs'), model.metrics);
    }
    rememberCover(model, cover);
  }).catch(() => {}).finally(() => { delete model.coverTask; });
}
renderCatalog();
const localReady = libraryTransaction('readonly', store => store.getAll()).then(models => {
  for (const model of models) entries.set(model.id, model);
  renderCatalog();
  if (activeModel) showRelated(activeModel);
}).catch(() => {});

async function followLocation() {
  const id = new URL(location.href).searchParams.get('model');
  if (!id) {
    if (dialog.open) dialog.close();
    return;
  }
  if (!entries.has(id)) {
    await Promise.all([localReady, cloudSetup]);
    if (new URL(location.href).searchParams.get('model') !== id) return;
  }
  let entry = entries.get(id);
  let lookupFailed = false;
  if (!entry && supabase && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    try {
      const { data, error } = await supabase.from('models').select('*').eq('id', id).eq('deleting', false).maybeSingle();
      if (error) throw error;
      if (new URL(location.href).searchParams.get('model') !== id) return;
      if (data) {
        entry = entries.get(id) || publicEntry(data);
        entries.set(id, entry);
      }
    } catch { lookupFailed = true; }
  }
  if (new URL(location.href).searchParams.get('model') !== id) return;
  if (entry) openModel(entry, false);
  else {
    if (dialog.open) dialog.close();
    note(libraryStatus, catalogFailed || lookupFailed ? 'Не удалось открыть модель. Повторите загрузку каталога.' :
      'Модель недоступна по этой ссылке. Локальные модели открываются только в браузере автора.', true);
  }
}
window.addEventListener('popstate', followLocation);
followLocation();

social = initSocial({
  getClient: () => supabase, getUser: () => user, getActiveModel: () => activeModel,
  getEntries: () => entries, categories: CATEGORIES, maxFileSize: MAX_FILE_SIZE,
  openAuth, showCatalog, showAccount, createCard, publicEntry, modelURL,
  queueCover, saveCloudModel, listPublicModels, loadDashboard,
  closeViewer: () => dialog.close(), cloudSetup
});

for (const entry of entries.values()) {
  const card = cards.get(entry);
  if (card) social.bindFavorite(card.querySelector('.favorite-button'), entry);
}
if (activeModel) social.openModel(activeModel);
