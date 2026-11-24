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
  const group = new ThreeMFLoader().parse(bytes);
  group.updateMatrixWorld(true);
  const meshes = [];
  const geometries = new Set();
  const materials = new Set();
  let total = 0;
  group.traverse(object => {
    if (!object.isMesh) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
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
