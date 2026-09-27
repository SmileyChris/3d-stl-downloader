const test = require('node:test');
const assert = require('node:assert');
const { meshesToStl, collectMeshes } = require('../extension/stl.js');

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mesh({ position, index = null, matrix = IDENTITY, name = '', visible = true, drawRange }) {
  return {
    isMesh: true,
    name,
    visible,
    parent: null,
    children: [],
    matrixWorld: { elements: matrix },
    geometry: {
      attributes: { position },
      index,
      drawRange: drawRange || { start: 0, count: Infinity },
    },
  };
}

function attr(array, { itemSize = 3, normalized = false } = {}) {
  return { array, itemSize, normalized, count: array.length / itemSize };
}

function parse(buf) {
  const dv = new DataView(buf);
  const n = dv.getUint32(80, true);
  assert.strictEqual(buf.byteLength, 84 + n * 50);
  const tris = [];
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50;
    const f = [];
    for (let k = 0; k < 12; k++) f.push(dv.getFloat32(o + k * 4, true));
    tris.push({ normal: f.slice(0, 3), verts: [f.slice(3, 6), f.slice(6, 9), f.slice(9, 12)] });
  }
  return tris;
}

const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-4, `${a} != ${b}`));

// Triangle in the three.js XZ (ground) plane, facing +Y.
const GROUND_TRI = [0, 0, 0, 0, 0, 1, 1, 0, 0];

test('non-indexed triangle: Y-up becomes Z-up, normal recomputed', () => {
  const [t] = parse(meshesToStl([mesh({ position: attr(new Float32Array(GROUND_TRI)) })]));
  // (x, y, z) -> (x, -z, y)
  near(t.verts[0], [0, 0, 0]);
  near(t.verts[1], [0, -1, 0]);
  near(t.verts[2], [1, 0, 0]);
  near(t.normal, [0, 0, 1]);
});

test('indexed geometry expands through the index', () => {
  const position = attr(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]));
  const index = { array: new Uint16Array([0, 1, 2, 0, 2, 3]), count: 6 };
  const tris = parse(meshesToStl([mesh({ position, index })]));
  assert.strictEqual(tris.length, 2);
  near(tris[1].verts[2], [0, 0, 1]);
});

test('drawRange limits exported triangles', () => {
  const position = attr(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]));
  const index = { array: new Uint16Array([0, 1, 2, 0, 2, 3]), count: 6 };
  const tris = parse(meshesToStl([mesh({ position, index, drawRange: { start: 3, count: 3 } })]));
  assert.strictEqual(tris.length, 1);
  near(tris[0].verts[1], [1, 0, 1]);
});

test('matrixWorld translation and scale applied', () => {
  const matrix = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 10, 20, 30, 1];
  const [t] = parse(meshesToStl([mesh({ position: attr(new Float32Array(GROUND_TRI)), matrix })]));
  near(t.verts[0], [10, -30, 20]);
  near(t.verts[2], [12, -30, 20]);
});

test('mirrored matrix flips winding so normal stays outward', () => {
  const matrix = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const [t] = parse(meshesToStl([mesh({ position: attr(new Float32Array(GROUND_TRI)), matrix })]));
  near(t.normal, [0, 0, 1]);
});

test('normalized int16 positions are denormalized', () => {
  const position = attr(new Int16Array([0, 0, 0, 0, 0, 32767, 32767, 0, 0]), { normalized: true });
  const [t] = parse(meshesToStl([mesh({ position })]));
  near(t.verts[1], [0, -1, 0]);
  near(t.verts[2], [1, 0, 0]);
});

test('interleaved positions honour stride and offset', () => {
  // layout per vertex: [u, v, x, y, z]
  const data = new Float32Array([9, 9, 0, 0, 0, 9, 9, 0, 0, 1, 9, 9, 1, 0, 0]);
  const position = {
    isInterleavedBufferAttribute: true,
    data: { array: data, stride: 5 },
    offset: 2,
    itemSize: 3,
    normalized: false,
    count: 3,
  };
  const [t] = parse(meshesToStl([mesh({ position })]));
  near(t.verts[1], [0, -1, 0]);
  near(t.verts[2], [1, 0, 0]);
});

test('multiple meshes are concatenated', () => {
  const a = mesh({ position: attr(new Float32Array(GROUND_TRI)) });
  const b = mesh({ position: attr(new Float32Array(GROUND_TRI)) });
  assert.strictEqual(parse(meshesToStl([a, b])).length, 2);
});

function tree(node, children = []) {
  node.children = children;
  children.forEach((c) => (c.parent = node));
  return node;
}

function bigAttr(tris) {
  return attr(new Float32Array(tris * 9));
}

test('collectMeshes prefers tripo-named meshes over gizmos', () => {
  const model = mesh({ position: bigAttr(100), name: 'tripo_node_abc' });
  const gizmo = mesh({ position: bigAttr(384), name: 'X' });
  const scene = tree({ isScene: true, visible: true, parent: null }, [model, gizmo]);
  assert.deepStrictEqual(collectMeshes([scene]), [model]);
});

test('collectMeshes skips invisible meshes and invisible ancestors', () => {
  const hidden = mesh({ position: bigAttr(100), name: 'tripo_node_a', visible: false });
  const underHidden = mesh({ position: bigAttr(100), name: 'tripo_node_b' });
  const shown = mesh({ position: bigAttr(100), name: 'tripo_node_c' });
  const group = tree({ visible: false, parent: null }, [underHidden]);
  const scene = tree({ isScene: true, visible: true, parent: null }, [hidden, group, shown]);
  assert.deepStrictEqual(collectMeshes([scene]), [shown]);
});

test('collectMeshes falls back to large meshes when nothing is tripo-named', () => {
  const model = mesh({ position: bigAttr(10000), name: '' });
  const part = mesh({ position: bigAttr(500), name: '' });
  const gizmo = mesh({ position: bigAttr(12), name: 'X' });
  const scene = tree({ isScene: true, visible: true, parent: null }, [model, part, gizmo]);
  assert.deepStrictEqual(collectMeshes([scene]), [model, part]);
});

test('collectMeshes ignores instanced and skinned-less non-mesh objects, returns [] when empty', () => {
  const line = { isLine: true, visible: true, children: [], geometry: { attributes: { position: bigAttr(5) } } };
  const inst = Object.assign(mesh({ position: bigAttr(100), name: 'tripo_x' }), { isInstancedMesh: true });
  const scene = tree({ isScene: true, visible: true, parent: null }, [line, inst]);
  assert.deepStrictEqual(collectMeshes([scene]), []);
});
