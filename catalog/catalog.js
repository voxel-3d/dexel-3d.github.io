const dialog = document.getElementById('model-dialog');
const stage = document.getElementById('model-stage');
const preview = document.getElementById('model-preview');
const status = document.getElementById('model-status');
const title = document.getElementById('model-title');
const description = document.getElementById('model-description');
const actions = [...dialog.querySelectorAll('[data-view-action]')];

let currentLoad;
let viewer;

function enableActions(enabled) {
  for (const action of actions) action.disabled = !enabled;
}

function disposeModel(model) {
  const disposable = new Set();
  model.traverse(object => {
    if (!object.isMesh) return;
    disposable.add(object.geometry);
    for (const material of [object.material].flat()) {
      disposable.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) disposable.add(value);
      }
    }
  });
  for (const resource of disposable) resource.dispose();
}

async function selectRenderer(THREE) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (context) {
    const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    return renderer;
  }

  const { SVGRenderer } = await import('three/addons/renderers/SVGRenderer.js');
  const renderer = new SVGRenderer();
  renderer.setPrecision(1);
  return renderer;
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

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x151713);
  model.position.sub(sphere.center);
  scene.add(model);
  const webgl = renderer.isWebGLRenderer;
  scene.add(webgl ? new THREE.HemisphereLight(0xfff5df, 0x83705c, 2.1) : new THREE.AmbientLight(0xd4cbb9));

  const key = new THREE.DirectionalLight(0xffe5ba, webgl ? 3.1 : .73);
  key.position.set(-3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbad3ff, webgl ? 1.2 : .26);
  fill.position.set(4, 2, 1);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffcc8d, webgl ? 2.2 : .44);
  rim.position.set(2, 3, -4);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(38, 1, sphere.radius * .03, sphere.radius * 150);
  const direction = new THREE.Vector3(1, .65, 1.35).normalize();
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
  preview.hidden = false;
  enableActions(false);
  status.textContent = message;
}

async function openModel(button) {
  const card = button.closest('.catalog-card');
  const image = card.querySelector('img');
  preview.src = image.currentSrc || image.src;
  preview.alt = image.alt;
  preview.hidden = false;
  title.textContent = card.querySelector('h2').textContent;
  description.textContent = card.querySelector('p').textContent;
  status.textContent = 'Загружаем 3D-модель…';
  enableActions(false);
  dialog.showModal();

  const load = new AbortController();
  currentLoad = load;
  let model;
  let renderer;
  try {
    const [THREE, { OrbitControls }, { GLTFLoader }] = await Promise.all([
      import('three'),
      import('three/addons/controls/OrbitControls.js'),
      import('three/addons/loaders/GLTFLoader.js')
    ]);
    if (load.signal.aborted) return;
    const url = new URL(button.dataset.model, document.baseURI);
    const response = await fetch(url, { signal: load.signal });
    if (!response.ok) throw new Error('Не удалось загрузить файл модели');
    const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), new URL('.', url).href);
    model = gltf.scene;
    if (load.signal.aborted) {
      disposeModel(model);
      return;
    }
    renderer = await selectRenderer(THREE);
    if (load.signal.aborted) {
      disposeRenderer(renderer);
      disposeModel(model);
      return;
    }
    viewer = createViewer(THREE, OrbitControls, renderer, model, image.alt, () => {
      showError('3D-просмотр прервался. Закройте окно и откройте его снова.');
    });
    preview.hidden = true;
    status.textContent = '';
    enableActions(true);
  } catch {
    if (!viewer) {
      disposeRenderer(renderer);
      if (model) disposeModel(model);
    }
    if (!load.signal.aborted) showError('3D-модель не открылась. Доступно статичное превью.');
  }
}

for (const button of document.querySelectorAll('[data-model]')) {
  button.addEventListener('click', () => openModel(button));
}

for (const button of actions) {
  button.addEventListener('click', () => {
    if (!viewer) return;
    if (button.dataset.viewAction === 'reset') viewer.reset();
    else viewer.zoom(button.dataset.viewAction === 'in' ? .8 : 1.25);
  });
}

dialog.addEventListener('close', () => {
  currentLoad?.abort();
  viewer?.dispose();
  viewer = undefined;
  preview.removeAttribute('src');
  preview.hidden = true;
  enableActions(false);
});
