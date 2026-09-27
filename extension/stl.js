// Pure helpers: pick model meshes out of captured three.js scenes and write
// them as binary STL. Duck-typed against three.js objects, no three.js import.
(function (root) {
  'use strict';

  const MODEL_NAME = /^tripo/i;
  // Fallback when no mesh is tripo-named: keep meshes at least this fraction
  // of the largest one, which drops gizmos, view cubes and overlay handles.
  const FALLBACK_MIN_RATIO = 0.01;

  function denormDivisor(array) {
    if (array instanceof Int8Array) return 127;
    if (array instanceof Uint8Array) return 255;
    if (array instanceof Int16Array) return 32767;
    if (array instanceof Uint16Array) return 65535;
    return 1;
  }

  function triangleCount(geometry) {
    const position = geometry && geometry.attributes && geometry.attributes.position;
    if (!position) return 0;
    const total = geometry.index ? geometry.index.count : position.count;
    const range = geometry.drawRange || { start: 0, count: Infinity };
    const start = Math.max(range.start || 0, 0);
    const count = Math.min(range.count, total - start);
    return Math.max(Math.floor(count / 3), 0);
  }

  // World-space positions, converted from three.js Y-up to STL Z-up.
  function worldPositions(mesh) {
    const position = mesh.geometry.attributes.position;
    const interleaved = position.isInterleavedBufferAttribute;
    const src = interleaved ? position.data.array : position.array;
    const stride = interleaved ? position.data.stride : position.itemSize;
    const offset = interleaved ? position.offset : 0;
    const div = position.normalized ? denormDivisor(src) : 1;
    const e = mesh.matrixWorld.elements;
    const out = new Float32Array(position.count * 3);

    for (let i = 0; i < position.count; i++) {
      const s = i * stride + offset;
      let x = src[s], y = src[s + 1], z = src[s + 2];
      if (div !== 1) {
        x = Math.max(x / div, -1);
        y = Math.max(y / div, -1);
        z = Math.max(z / div, -1);
      }
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      out[i * 3] = wx;
      out[i * 3 + 1] = -wz;
      out[i * 3 + 2] = wy;
    }
    return out;
  }

  function isMirrored(e) {
    const det =
      e[0] * (e[5] * e[10] - e[9] * e[6]) -
      e[4] * (e[1] * e[10] - e[9] * e[2]) +
      e[8] * (e[1] * e[6] - e[5] * e[2]);
    return det < 0;
  }

  function meshesToStl(meshes) {
    let total = 0;
    for (const mesh of meshes) total += triangleCount(mesh.geometry);

    const buffer = new ArrayBuffer(84 + total * 50);
    const dv = new DataView(buffer);
    const header = 'Binary STL exported from three.js preview';
    for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
    dv.setUint32(80, total, true);

    let o = 84;
    for (const mesh of meshes) {
      const tris = triangleCount(mesh.geometry);
      if (!tris) continue;
      const pos = worldPositions(mesh);
      const index = mesh.geometry.index ? mesh.geometry.index.array : null;
      const start = Math.max((mesh.geometry.drawRange && mesh.geometry.drawRange.start) || 0, 0);
      const flip = isMirrored(mesh.matrixWorld.elements);

      for (let t = 0; t < tris; t++) {
        const k = start + t * 3;
        let a = index ? index[k] : k;
        let b = index ? index[k + 1] : k + 1;
        let c = index ? index[k + 2] : k + 2;
        if (flip) { const tmp = b; b = c; c = tmp; }
        a *= 3; b *= 3; c *= 3;

        const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
        const bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
        const cx = pos[c], cy = pos[c + 1], cz = pos[c + 2];

        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        if (len > 0) { nx /= len; ny /= len; nz /= len; } else { nx = ny = nz = 0; }

        dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
        dv.setFloat32(o + 12, ax, true); dv.setFloat32(o + 16, ay, true); dv.setFloat32(o + 20, az, true);
        dv.setFloat32(o + 24, bx, true); dv.setFloat32(o + 28, by, true); dv.setFloat32(o + 32, bz, true);
        dv.setFloat32(o + 36, cx, true); dv.setFloat32(o + 40, cy, true); dv.setFloat32(o + 44, cz, true);
        o += 50; // trailing uint16 attribute byte count stays 0
      }
    }
    return buffer;
  }

  function visibleMeshes(node, out) {
    if (!node || node.visible === false) return;
    if (node.isMesh && !node.isInstancedMesh && !node.isBatchedMesh && triangleCount(node.geometry) > 0) {
      out.push(node);
    }
    for (const child of node.children || []) visibleMeshes(child, out);
  }

  function collectMeshes(scenes) {
    const all = [];
    for (const scene of scenes) visibleMeshes(scene, all);

    const named = all.filter((m) => MODEL_NAME.test(m.name || ''));
    if (named.length) return named;

    let largest = 0;
    for (const m of all) largest = Math.max(largest, triangleCount(m.geometry));
    return all.filter((m) => triangleCount(m.geometry) >= largest * FALLBACK_MIN_RATIO);
  }

  const api = { meshesToStl, collectMeshes, triangleCount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.__tripoStl = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
