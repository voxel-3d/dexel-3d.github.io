const byId = id => document.getElementById(id);
const sourceInput = byId('stl-file');
const drop = byId('stl-drop');
const stage = byId('stl-stage');
const placeholder = byId('stl-placeholder');
const status = byId('stl-status');
const manual = byId('stl-manual');
const settings = byId('stl-settings');
const viewOptions = byId('stl-view-options');
const percent = byId('stl-percent');
const range = byId('stl-range');
const dimensions = ['x', 'y', 'z'].map(axis => byId('stl-' + axis));
const lock = byId('stl-lock');
const color = byId('stl-color');
const wireframe = byId('stl-wire');
const material = byId('stl-material');
const infill = byId('stl-infill');
const downloadButton = byId('stl-download');
const orderButton = byId('stl-order');

const BED = 250;
const MIN_SCALE = .1;
const MAX_SCALE = 5;
const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const DENSITY = { PETG: 1.27, PLA: 1.24, ABS: 1.04 };
const PLASTIC_FINISHES = {
  black: { color: 0x1c1c1e, roughness: .9 },
  white: { color: 0xf2f2f2 },
  gold: { color: 0xd4af37, metalness: .35, roughness: .35 },
  yellow: { color: 0xf5c518 },
  red: { color: 0xc92a2a },
  olive: { color: 0x556b2f },
  coyote: { color: 0x8b7355 },
  ultramarine: { color: 0x1b3f8b },
  translucent: { color: 0xf2f2f2, transparent: true, opacity: .72, roughness: .2 },
  green: { color: 0x2ecc40 },
  marble: { color: 0xe6e4df, marble: true }
};
const display = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const rawNumber = value => Number(value.toPrecision(9));
const clampScale = value => Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
let libPromise;
let model = null;
let scale = [1, 1, 1];
let view = null;
let loading = false;
let exporting = false;

function libraries() {
  if (!libPromise) {
    libPromise = Promise.all([
      import('three'),
      import('three/addons/loaders/STLLoader.js'),
      import('three/addons/exporters/STLExporter.js'),
      import('three/addons/controls/OrbitControls.js')
    ]).then(([THREE, { STLLoader }, { STLExporter }, { OrbitControls }]) => ({
      THREE, STLLoader, STLExporter, OrbitControls
    })).catch(error => {
      libPromise = null;
      throw error;
    });
  }
  return libPromise;
}

// Each triangle and the origin form a signed tetrahedron.
export function solidVolumeMm3(positions, center) {
  let volume = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i] - center.x, ay = positions[i + 1] - center.y, az = positions[i + 2] - center.z;
    const bx = positions[i + 3] - center.x, by = positions[i + 4] - center.y, bz = positions[i + 5] - center.z;
    const cx = positions[i + 6] - center.x, cy = positions[i + 7] - center.y, cz = positions[i + 8] - center.z;
    volume += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return Math.abs(volume) / 6;
}

function openScene({ THREE, OrbitControls }) {
  if (view) return view;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch {
    placeholder.textContent = '3D-сцена недоступна в этом браузере. Размеры, вес и экспорт доступны.';
    return null;
  }
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111112);
  const camera = new THREE.PerspectiveCamera(42, 1, 1, 5000);
  camera.up.set(0, 0, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.setAttribute('aria-label', 'Печатный стол и загруженная 3D-модель');
  stage.append(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .1;
  controls.zoomSpeed = .8;
  controls.minPolarAngle = .02;
  controls.maxPolarAngle = Math.PI * .97;
  scene.add(new THREE.HemisphereLight(0xfff0d8, 0x444653, 2));
  for (const [x, y, z, brightness, tint] of [[220, -180, 340, 2.6, 0xffe7c0], [-200, 200, 140, 1.6, 0xbccff6]]) {
    const light = new THREE.DirectionalLight(tint, brightness);
    light.position.set(x, y, z);
    scene.add(light);
  }
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(BED, BED),
    new THREE.MeshStandardMaterial({ color: 0x272521, roughness: 1, side: THREE.DoubleSide })
  );
  plate.position.z = -.2;
  scene.add(plate);
  const grid = new THREE.GridHelper(BED, BED / 10, 0xc5994d, 0x504945);
  grid.rotation.x = Math.PI / 2;
  grid.position.z = -.1;
  scene.add(grid);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(plate.geometry), new THREE.LineBasicMaterial({ color: 0xc5994d })
  );
  edges.position.z = -.05;
  scene.add(edges);

  let animation = 0;
  function render() {
    if (animation) return;
    animation = requestAnimationFrame(() => {
      animation = 0;
      controls.update();
      renderer.render(scene, camera);
    });
  }
  const resize = () => {
    const { clientWidth: width, clientHeight: height } = stage;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    render();
  };
  controls.addEventListener('change', render);
  new ResizeObserver(resize).observe(stage);
  view = { scene, camera, controls, render, mesh: null };
  resize();
  return view;
}

function getMetrics() {
  const size = model.size.map((length, axis) => length * scale[axis]);
  const determinant = scale[0] * scale[1] * scale[2];
  const volume = model.volume * determinant / 1000;
  const weight = volume * DENSITY[material.value] * Number(infill.value) / 100;
  return { size, volume, weight };
}

function resetCamera() {
  if (!view || !model) return;
  const { camera, controls, render } = view;
  const [x, y, z] = getMetrics().size;
  const radius = Math.hypot(Math.max(x, BED), Math.max(y, BED), z) / 2;
  const hFov = 2 * Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect);
  const distance = radius / Math.sin(Math.min(hFov, camera.fov * Math.PI / 180) / 2) * 1.1;
  const centerZ = z / 2;
  controls.target.set(0, 0, centerZ);
  camera.position.set(distance * .58, -distance * .66, centerZ + distance * .47);
  camera.far = distance * 35;
  camera.updateProjectionMatrix();
  controls.minDistance = Math.max(radius / 150, 1);
  controls.maxDistance = distance * 8;
  controls.update();
  render();
}


function createPreviewMaterial(THREE, size) {
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  const marbleEnabled = { value: 0 };
  const marbleScale = { value: 1 / Math.max(...size) };
  material.userData.marbleEnabled = marbleEnabled;
  material.onBeforeCompile = shader => {
    shader.uniforms.voxelMarbleEnabled = marbleEnabled;
    shader.uniforms.voxelMarbleScale = marbleScale;
    // STL meshes have no UVs. Sample the grain in the original model coordinates.
    shader.vertexShader = `
      uniform float voxelMarbleScale;
      varying vec3 vVoxelMarblePoint;
    ` + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vVoxelMarblePoint = position * voxelMarbleScale;
    `);
    shader.fragmentShader = `
      uniform float voxelMarbleEnabled;
      varying vec3 vVoxelMarblePoint;
      float voxelGrainHash(vec3 p) {
        p = fract(p * .1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }
      float voxelGrain(vec3 p) {
        vec3 cell = floor(p);
        vec3 frac = fract(p);
        vec3 s = frac * frac * (3.0 - 2.0 * frac);
        return mix(
          mix(mix(voxelGrainHash(cell), voxelGrainHash(cell + vec3(1.,0.,0.)), s.x),
              mix(voxelGrainHash(cell + vec3(0.,1.,0.)), voxelGrainHash(cell + vec3(1.,1.,0.)), s.x), s.y),
          mix(mix(voxelGrainHash(cell + vec3(0.,0.,1.)), voxelGrainHash(cell + vec3(1.,0.,1.)), s.x),
              mix(voxelGrainHash(cell + vec3(0.,1.,1.)), voxelGrainHash(cell + vec3(1.,1.,1.)), s.x), s.y),
          s.z
        );
      }
    ` + shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      if (voxelMarbleEnabled > .5) {
        vec3 p = vVoxelMarblePoint;
        float pattern = sin(dot(p, vec3(17., 12., 11.)) + 10. * voxelGrain(p * 5.));
        float vein = smoothstep(.74, .99, pattern) * .23;
        float flecks = smoothstep(.72, .90, voxelGrain(p * 96.)) * .29;
        diffuseColor.rgb *= 1.0 - min(vein + flecks, .48) * vec3(1., .97, .92);
      }
    `);
  };
  return material;
}

function applyPlasticFinish(material, key) {
  const {
    color, metalness = .08, roughness = .77, transparent = false, opacity = 1, marble = false
  } = PLASTIC_FINISHES[key] || PLASTIC_FINISHES.gold;
  const transparencyChanged = material.transparent !== transparent;
  material.color.setHex(color);
  material.metalness = metalness;
  material.roughness = roughness;
  material.transparent = transparent;
  material.opacity = opacity;
  material.depthWrite = !transparent;
  material.userData.marbleEnabled.value = marble ? 1 : 0;
  if (transparencyChanged) material.needsUpdate = true;
}

function updateView() {
  if (!view?.mesh) return;
  const { mesh, camera, controls, render } = view;
  mesh.scale.set(...scale);
  mesh.position.set(-model.center.x * scale[0], -model.center.y * scale[1], -model.minZ * scale[2]);
  applyPlasticFinish(mesh.material, color.value);
  mesh.material.wireframe = wireframe.checked;
  const largestSide = Math.max(BED, ...getMetrics().size);
  camera.far = Math.max(camera.far, largestSide * 24);
  camera.updateProjectionMatrix();
  controls.maxDistance = Math.max(controls.maxDistance, largestSide * 14);
  render();
}

function synchronize(skip = null) {
  if (!model) return;
  const { size, volume, weight } = getMetrics();
  const overall = Math.cbrt(scale[0] * scale[1] * scale[2]) * 100;
  if (skip !== percent) percent.value = String(rawNumber(overall));
  if (skip !== range) range.value = String(overall);
  dimensions.forEach((input, i) => {
    input.min = String(rawNumber(model.size[i] * MIN_SCALE));
    input.max = String(rawNumber(model.size[i] * MAX_SCALE));
    if (skip !== input) input.value = String(rawNumber(size[i]));
  });
  byId('stl-size').textContent = size.map(value => display.format(value)).join(' × ');
  byId('stl-volume').textContent = display.format(volume);
  byId('stl-weight').textContent = '~' + display.format(weight) + ' г';
  byId('stl-size-warning').hidden = !size.some(value => value > BED);
  updateView();
}

function uniform(input) {
  if (!model || !input.value || !Number.isFinite(input.valueAsNumber)) return;
  const factor = clampScale(input.valueAsNumber / 100);
  scale = [factor, factor, factor];
  synchronize(input);
}

for (const input of [percent, range]) {
  input.addEventListener('input', () => uniform(input));
  input.addEventListener('change', () => synchronize());
}
dimensions.forEach((input, i) => {
  input.addEventListener('input', () => {
    if (!model || !input.value || !Number.isFinite(input.valueAsNumber) || input.valueAsNumber <= 0) return;
    const next = clampScale(input.valueAsNumber / model.size[i]);
    if (lock.checked) scale = [next, next, next];
    else scale[i] = next;
    synchronize(input);
  });
  input.addEventListener('change', () => synchronize());
});
byId('stl-reset').addEventListener('click', () => { scale = [1, 1, 1]; synchronize(); });
byId('stl-camera').addEventListener('click', resetCamera);
for (const input of [color, wireframe, material, infill]) input.addEventListener('change', () => synchronize());

function validateSTLBytes(buffer) {
  if (buffer.byteLength >= 84) {
    const faces = new DataView(buffer).getUint32(80, true);
    if (faces > 0 && buffer.byteLength === 84 + faces * 50) return;
  }
  const prefix = new TextDecoder().decode(buffer.slice(0, 256)).trimStart();
  if (!/^solid(?:\s|$)/i.test(prefix)) throw new Error('STL повреждён или имеет неподдерживаемый формат.');
}

function updateButtons() {
  downloadButton.disabled = orderButton.disabled = !model || loading || exporting;
  settings.disabled = !model || loading || exporting;
  viewOptions.disabled = !model || loading;
  const sceneUnavailable = !view?.mesh;
  wireframe.disabled = sceneUnavailable;
  byId('stl-camera').disabled = sceneUnavailable;
}

async function loadModel(file) {
  if (!file || loading || exporting) return;
  manual.hidden = true;
  if (!/\.stl$/i.test(file.name) || !file.size || file.size > MAX_INPUT_BYTES) {
    status.textContent = 'Выберите непустой файл .STL размером до 50 МБ.';
    return;
  }
  status.textContent = 'Читаем модель…';
  loading = true;
  updateButtons();
  let geometry;
  try {
    let lib;
    try { lib = await libraries(); }
    catch { throw new Error('Не удалось загрузить Three.js. Проверьте подключение и попробуйте снова.'); }
    const buffer = await file.arrayBuffer();
    validateSTLBytes(buffer);
    try { geometry = new lib.STLLoader().parse(buffer); }
    catch { throw new Error('Не удалось прочитать STL. Проверьте файл и попробуйте снова.'); }
    const position = geometry.getAttribute('position');
    if (!position || position.count < 3 || position.count % 3 !== 0) throw new Error('В файле нет корректных треугольников.');
    for (const coordinate of position.array) {
      if (!Number.isFinite(coordinate)) throw new Error('STL содержит некорректные координаты.');
    }
    geometry.computeBoundingBox();
    const { min } = geometry.boundingBox;
    const size = geometry.boundingBox.getSize(new lib.THREE.Vector3()).toArray();
    if (size.some(length => !Number.isFinite(length) || length <= 0)) {
      throw new Error('Для печати у модели должны быть ненулевые размеры по всем трём осям.');
    }
    const center = geometry.boundingBox.getCenter(new lib.THREE.Vector3());
    const volume = solidVolumeMm3(position.array, center);
    const sceneView = openScene(lib);
    if (sceneView?.mesh) {
      sceneView.scene.remove(sceneView.mesh);
      sceneView.mesh.material.dispose();
    }
    model?.geometry.dispose();
    model = { geometry, size, center, minZ: min.z, volume, fileName: file.name };
    geometry = null;
    scale = [1, 1, 1];
    if (sceneView) {
      sceneView.mesh = new lib.THREE.Mesh(model.geometry, createPreviewMaterial(lib.THREE, model.size));
      sceneView.scene.add(sceneView.mesh);
      placeholder.hidden = true;
    }
    synchronize();
    resetCamera();
    status.textContent = file.name + (volume ? ' · модель загружена' : ' · объём не определён. Проверьте, что модель замкнута.');
  } catch (error) {
    geometry?.dispose();
    status.textContent = error.message || 'Не удалось загрузить STL.';
  } finally {
    loading = false;
    updateButtons();
  }
}

function makeName(size) {
  const base = model.fileName.replace(/\.stl$/i, '').replace(/[^0-9\p{L}_.-]/gu, '_').slice(0, 74) || 'voxel-model';
  return base + '_' + size.map(value => rawNumber(value)).join('x') + 'mm.stl';
}

async function generateFile() {
  const { THREE, STLExporter } = await libraries();
  const geometry = model.geometry.clone();
  try {
    geometry.scale(...scale);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    try {
      mesh.updateMatrixWorld(true);
      return new File([new STLExporter().parse(mesh, { binary: true })], makeName(getMetrics().size), { type: 'model/stl' });
    } finally {
      mesh.material.dispose();
    }
  } finally {
    geometry.dispose();
  }
}

function download(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function exportModel(forOrder) {
  if (!model || loading || exporting) return;
  exporting = true;
  updateButtons();
  status.textContent = 'Готовим STL…';
  try {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const file = await generateFile();
    if (!forOrder) {
      download(file);
      status.textContent = 'Готово: ' + file.name;
      return;
    }
    const { size, weight } = getMetrics();
    const factors = scale.map(factor => display.format(factor * 100));
    const scaleText = scale.every(factor => factor === scale[0])
      ? factors[0] + '%'
      : factors.join(' × ') + '% (по осям X/Y/Z)';
    const detail = {
      file,
      colorName: color.selectedOptions[0]?.textContent.trim(),
      summary: '3D-модель: ' + file.name + '\nГабариты (X × Y × Z): ' + size.map(value => display.format(value)).join(' × ') +
        ' мм. Масштаб: ' + scaleText + '. Материал: ' + material.value + '. Заполнение: ' + infill.value +
        '%. Примерный вес: ~' + display.format(weight) + ' г.'
    };
    byId('brief-form').dispatchEvent(new CustomEvent('voxel:prepare-stl', { detail }));
    if (!detail.attached) {
      status.textContent = detail.error || 'Не удалось прикрепить модель. Скачайте STL для ручной отправки.';
      manual.hidden = false;
      return;
    }
    manual.hidden = true;
    status.textContent = 'Подготовленный STL добавлен в заявку.';
    byId('request').scrollIntoView();
    byId('contact').focus({ preventScroll: true });
  } catch {
    status.textContent = 'Не удалось создать STL. Попробуйте ещё раз или загрузите модель поменьше.';
  } finally {
    exporting = false;
    updateButtons();
  }
}

sourceInput.addEventListener('change', () => {
  const file = sourceInput.files[0];
  sourceInput.value = '';
  loadModel(file);
});
for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) {
  drop.addEventListener(type, event => {
    event.preventDefault();
    drop.classList.toggle('is-dragging', type === 'dragenter' || type === 'dragover');
    if (type === 'drop') loadModel(event.dataTransfer.files[0]);
  });
}
downloadButton.addEventListener('click', () => exportModel(false));
orderButton.addEventListener('click', () => exportModel(true));
