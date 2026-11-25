export const MAX_MODEL_SIZE = 50 * 1024 * 1024;
export const DRIVE_CHUNK_SIZE = 8 * 1024 * 1024;
const ASCII_THRESHOLD = 10 * 1024 * 1024;

export function modelExtension(name = '') {
  return name.match(/\.(stl|3mf)(?:$|[?#])/i)?.[1].toLowerCase();
}

export function modelMime(extension) {
  return extension === '3mf' ? 'model/3mf' : 'model/stl';
}

export function binarySTL(bytes) {
  if (bytes.byteLength < 84) return false;
  const faces = new DataView(bytes).getUint32(80, true);
  return faces > 0 && 84 + faces * 50 === bytes.byteLength;
}

export async function prepareModelFile(file, libraries, loadExporter = () => import('three/addons/exporters/STLExporter.js')) {
  if (file.size <= ASCII_THRESHOLD || modelExtension(file.name) !== 'stl') return file;
  const header = await file.slice(0, 84).arrayBuffer();
  const faces = header.byteLength >= 84 ? new DataView(header).getUint32(80, true) : 0;
  if ((faces && 84 + faces * 50 === file.size) ||
      !/^\s*solid(?:\s|$)/.test(new TextDecoder().decode(header))) return file;

  const [[THREE, {STLLoader}], {STLExporter}] = await Promise.all([libraries(), loadExporter()]);
  const geometry = new STLLoader().parse(await file.arrayBuffer());
  const material = new THREE.MeshBasicMaterial();
  try {
    const positions = geometry.getAttribute('position');
    if (!positions || positions.count < 3 || positions.count % 3 ||
        !positions.array.every(Number.isFinite)) throw new Error('Не удалось прочитать геометрию STL.');
    const size = 84 + positions.count / 3 * 50;
    if (size >= file.size) return file;
    const binary = new STLExporter().parse(new THREE.Mesh(geometry, material), {binary: true});
    return new File([binary], file.name, {type: 'model/stl'});
  } finally {
    geometry.dispose();
    material.dispose();
  }
}

export async function parse3MF(THREE, bytes) {
  const [{ThreeMFLoader}, {unzipSync}] = await Promise.all([
    import('three/addons/loaders/3MFLoader.js'),
    import('three/addons/libs/fflate.module.js')
  ]);
  let expanded = 0;
  const parts = unzipSync(new Uint8Array(bytes), {filter(entry) {
    expanded += entry.originalSize;
    if (expanded > 192 * 1024 * 1024) throw new Error('Распакованный 3MF превышает 192 МБ.');
    return entry.name === '_rels/.rels';
  }});
  const xml = new DOMParser();
  const decode = data => new TextDecoder().decode(data);
  if (!parts['_rels/.rels']) throw new Error('Не найдена структура 3MF.');
  const relation = Array.from(xml.parseFromString(decode(parts['_rels/.rels']), 'application/xml')
    .getElementsByTagNameNS('*', 'Relationship')).find(node => node.getAttribute('Type')?.endsWith('/3dmodel'));
  const root = relation?.getAttribute('Target')?.replace(/^\//, '');
  if (!root) throw new Error('В 3MF не найдена основная модель.');
  const modelPart = unzipSync(new Uint8Array(bytes), {filter: entry => entry.name === root})[root];
  if (!modelPart) throw new Error('В 3MF не найден файл геометрии.');
  const unit = xml.parseFromString(decode(modelPart), 'application/xml').documentElement.getAttribute('unit') || 'millimeter';
  const scale = {micron: .001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000}[unit];
  if (!Number.isFinite(scale)) throw new Error('Неизвестные единицы измерения 3MF.');
  let group;
  try {
    group = new ThreeMFLoader().parse(bytes);
  } catch (error) {
    // ThreeMFLoader can fail on component references to other .model parts in a
    // 3MF package (e.g. exports from slicers). Resolve those references directly.
    if (!(error instanceof TypeError)) throw error;
    return read3MFComponents(THREE, bytes, root, unzipSync);
  }
  if (!group?.traverse) throw new Error('В 3MF не найдена геометрия сборки.');
  group.updateMatrixWorld(true);
  const meshes = [];
  const geometries = new Set();
  const materials = new Set();
  let total = 0;
  group.traverse(object => {
    if (!object?.isMesh || !object.geometry) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material) materials.add(material);
    const positions = object.geometry.getAttribute('position');
    if (!positions) return;
    const index = object.geometry.getIndex();
    const count = index ? index.count : positions.count;
    meshes.push({positions, index, count, matrix: object.matrixWorld});
    total += count;
  });
  try {
    if (!total || total % 3 || total > 6_000_000) throw new Error('Геометрия 3MF пуста или слишком сложна для предпросмотра.');
    const data = new Float32Array(total * 3);
    const point = new THREE.Vector3();
    let offset = 0;
    for (const {positions, index, count, matrix} of meshes) {
      const mirrored = matrix.determinant() < 0;
      for (let i = 0; i < count; i++) {
        const vertex = mirrored && i % 3 ? (i % 3 === 1 ? i + 1 : i - 1) : i;
        point.fromBufferAttribute(positions, index ? index.getX(vertex) : vertex).applyMatrix4(matrix).multiplyScalar(scale);
        data[offset++] = point.x;
        data[offset++] = point.y;
        data[offset++] = point.z;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data, 3));
    geometry.computeVertexNormals();
    return geometry;
  } finally {
    for (const geometry of geometries) geometry.dispose();
    const textures = new Set();
    for (const material of materials) {
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      material.dispose();
    }
    for (const texture of textures) texture.dispose();
  }
}

// Read only geometry, as the catalog applies its own plastic material.
// References are resolved inside the already bounded archive; no external URLs.
function read3MFComponents(THREE, bytes, root, unzipSync) {
  const archive = unzipSync(new Uint8Array(bytes), {
    filter: entry => /\.model$/i.test(entry.name)
  });
  const models = new Map();
  const children = (node, name) => Array.from(node?.children || []).filter(child => child.localName === name);
  const child = (node, name) => children(node, name)[0];
  function modelAt(path) {
    if (models.has(path)) return models.get(path);
    if (!archive[path]) throw new Error('В 3MF отсутствует часть сборки: ' + path);
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(archive[path]), 'application/xml');
    const model = doc.documentElement;
    if (model?.localName !== 'model') throw new Error('Некорректный XML модели 3MF.');
    const scale = {micron:.001, millimeter:1, centimeter:10, inch:25.4, foot:304.8, meter:1000}[model.getAttribute('unit') || 'millimeter'];
    if (!Number.isFinite(scale)) throw new Error('Неизвестные единицы измерения 3MF.');
    const objects = new Map(children(child(model,'resources'),'object').map(object => [object.getAttribute('id'),object]));
    const result = {model,scale,objects};
    models.set(path,result);
    return result;
  }
  function componentPath(node, path) {
    const ref = Array.from(node.attributes).find(attr => attr.localName === 'path' || attr.name.endsWith(':path'))?.value;
    if (!ref) return path;
    const segments = (ref.startsWith('/') ? ref.slice(1) : path.slice(0,path.lastIndexOf('/')+1)+ref).split('/');
    const resolved = [];
    for (const segment of segments) {
      if (!segment || segment === '.') continue;
      if (segment === '..') {
        if (!resolved.length) throw new Error('Некорректная ссылка на часть 3MF.');
        resolved.pop();
      } else resolved.push(segment);
    }
    return resolved.join('/');
  }
  function transform(node) {
    const text = node.getAttribute('transform');
    if (!text) return new THREE.Matrix4();
    const t = text.trim().split(/\s+/).map(Number);
    if (t.length !== 12 || !t.every(Number.isFinite)) throw new Error('Некорректное преобразование детали 3MF.');
    return new THREE.Matrix4().set(t[0],t[3],t[6],t[9], t[1],t[4],t[7],t[10], t[2],t[5],t[8],t[11], 0,0,0,1);
  }
  const chunks = [];
  let count = 0;
  const point = new THREE.Vector3();
  function visit(path, id, world, ancestors) {
    const key = path + '#' + id;
    if (ancestors.has(key) || ancestors.size >= 64) throw new Error('Циклическая или слишком глубокая сборка 3MF.');
    const {objects,scale} = modelAt(path);
    const object = objects.get(id);
    if (!object) throw new Error('В 3MF не найдена деталь ' + id + '.');
    const mesh = child(object,'mesh');
    if (mesh) {
      const vertices = children(child(mesh,'vertices'),'vertex');
      const triangles = children(child(mesh,'triangles'),'triangle');
      count += triangles.length * 3;
      if (count > 6_000_000) throw new Error('Геометрия 3MF слишком сложна для предпросмотра.');
      const positions = new Float32Array(triangles.length * 9);
      const mirrored = world.determinant() < 0;
      let offset = 0;
      for (const triangle of triangles) {
        for (const label of mirrored ? ['v1','v3','v2'] : ['v1','v2','v3']) {
          const vertexIndex = triangle.getAttribute(label);
          const vertex = vertexIndex === null ? undefined : vertices[Number(vertexIndex)];
          if (!vertex) throw new Error('Некорректный индекс вершины 3MF.');
          const coords = ['x','y','z'].map(axis => Number(vertex.getAttribute(axis)));
          if (!coords.every(Number.isFinite)) throw new Error('Некорректные координаты 3MF.');
          point.set(...coords).applyMatrix4(world);
          positions[offset++] = point.x;
          positions[offset++] = point.y;
          positions[offset++] = point.z;
        }
      }
      chunks.push(positions);
      return;
    }
    const next = new Set(ancestors).add(key);
    for (const component of children(child(object,'components'),'component')) {
      const target = componentPath(component,path);
      const ratio = modelAt(target).scale / scale;
      const matrix = world.clone().multiply(transform(component)).multiply(new THREE.Matrix4().makeScale(ratio,ratio,ratio));
      visit(target,component.getAttribute('objectid'),matrix,next);
    }
  }
  const main = modelAt(root);
  const millimetres = new THREE.Matrix4().makeScale(main.scale,main.scale,main.scale);
  for (const item of children(child(main.model,'build'),'item')) {
    const target = componentPath(item,root);
    const ratio = modelAt(target).scale / main.scale;
    const matrix = millimetres.clone().multiply(transform(item)).multiply(new THREE.Matrix4().makeScale(ratio,ratio,ratio));
    visit(target,item.getAttribute('objectid'),matrix,new Set());
  }
  if (!count) throw new Error('В сборке 3MF нет треугольников.');
  const positions = new Float32Array(count * 3);
  let offset = 0;
  for (const chunk of chunks) { positions.set(chunk,offset); offset += chunk.length; }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.computeVertexNormals();
  return geometry;
}
