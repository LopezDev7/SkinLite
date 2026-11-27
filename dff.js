/* Reducción conservadora de vértices para modelos DFF de GTA San Andreas. */
(function (global) {
  'use strict';

  const CHUNK = {
    STRUCT: 1,
    EXTENSION: 3,
    GEOMETRY: 15,
    CLUMP: 16,
    GEOMETRYLIST: 26,
    SKIN: 278,
    DELTA_MORPH: 290,
    BINMESH: 1294,
    EXTRA_VERTEX_COLOR: 39056121,
  };
  const CONTAINERS = new Set([3, 6, 7, 8, 14, 15, 16, 20, 26]);

  function concat(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  function ensureRange(bytes, offset, length, label = 'DFF incompleto') {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length) {
      throw new Error(label);
    }
  }

  function parseChunks(bytes, start, end) {
    ensureRange(bytes, start, end - start, 'DFF con límites incorrectos');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const chunks = [];
    let offset = start;
    while (offset + 12 <= end) {
      const type = view.getUint32(offset, true);
      const size = view.getUint32(offset + 4, true);
      if (size > end - offset - 12) throw new Error('El DFF tiene un bloque dañado.');
      const chunk = {
        type,
        size,
        version: view.getUint32(offset + 8, true),
        start: offset,
        end: offset + 12 + size,
        payload: bytes.subarray(offset + 12, offset + 12 + size),
        children: [],
        trailing: null,
      };
      if (CONTAINERS.has(type)) {
        let childOffset = offset + 12;
        chunk.children = parseChunks(bytes, childOffset, chunk.end);
        for (const child of chunk.children) childOffset = child.end;
        if (childOffset < chunk.end) chunk.trailing = bytes.subarray(childOffset, chunk.end);
      }
      chunks.push(chunk);
      offset = chunk.end;
    }
    return chunks;
  }

  function findChunks(chunks, type, found = []) {
    for (const chunk of chunks) {
      if (chunk.type === type) found.push(chunk);
      findChunks(chunk.children, type, found);
    }
    return found;
  }

  function findChunk(chunks, type) {
    return findChunks(chunks, type)[0] || null;
  }

  function serializeChunks(chunks, replacements) {
    const parts = [];
    for (const chunk of chunks) {
      const payload = chunk.children.length
        ? concat([serializeChunks(chunk.children, replacements), chunk.trailing || new Uint8Array(0)])
        : (replacements.get(chunk) || chunk.payload);
      const header = new Uint8Array(12);
      const view = new DataView(header.buffer);
      view.setUint32(0, chunk.type, true);
      view.setUint32(4, payload.length, true);
      view.setUint32(8, chunk.version, true);
      parts.push(header, payload);
    }
    return concat(parts);
  }

  function asBytes(array) {
    return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  }

  function readFloats(payload, position, count) {
    ensureRange(payload, position, count * 4, 'El DFF tiene datos de vértices incompletos.');
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) out[i] = view.getFloat32(position + i * 4, true);
    return out;
  }

  function parseGeometry(payload) {
    ensureRange(payload, 0, 16, 'No encontramos la cabecera de la geometría.');
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const flags = view.getUint32(0, true);
    const numTriangles = view.getUint32(4, true);
    const numVertices = view.getUint32(8, true);
    const numMorphs = view.getUint32(12, true);
    if (numVertices > 65535 || numTriangles > 2000000 || numMorphs < 1 || numMorphs > 32) {
      throw new Error('La geometría usa un tamaño que todavía no podemos procesar.');
    }

    let pos = 16;
    let colors = null;
    if (flags & 0x8) {
      ensureRange(payload, pos, numVertices * 4, 'Los colores de la geometría están incompletos.');
      colors = payload.subarray(pos, pos + numVertices * 4);
      pos += numVertices * 4;
    }

    let uvLayers = (flags >>> 16) & 0xff;
    if (uvLayers === 0 && (flags & 0x4)) uvLayers = 1;
    if (uvLayers > 8) throw new Error('La geometría usa demasiadas capas de textura.');
    const uvs = [];
    for (let layer = 0; layer < uvLayers; layer++) {
      uvs.push(readFloats(payload, pos, numVertices * 2));
      pos += numVertices * 8;
    }

    ensureRange(payload, pos, numTriangles * 8, 'La lista de triángulos está incompleta.');
    const triangles = [];
    for (let i = 0; i < numTriangles; i++) {
      triangles.push([
        view.getUint16(pos, true),
        view.getUint16(pos + 2, true),
        view.getUint16(pos + 4, true),
        view.getUint16(pos + 6, true),
      ]);
      pos += 8;
    }

    const morphTargets = [];
    for (let morph = 0; morph < numMorphs; morph++) {
      ensureRange(payload, pos, 24, 'Un objetivo de forma está incompleto.');
      const sphere = payload.slice(pos, pos + 16);
      pos += 16;
      const hasVertices = view.getUint32(pos, true) !== 0;
      const hasNormals = view.getUint32(pos + 4, true) !== 0;
      pos += 8;
      const vertices = hasVertices ? readFloats(payload, pos, numVertices * 3) : null;
      if (vertices) pos += numVertices * 12;
      const normals = hasNormals ? readFloats(payload, pos, numVertices * 3) : null;
      if (normals) pos += numVertices * 12;
      morphTargets.push({ sphere, hasVertices, hasNormals, vertices, normals });
    }
    if (!morphTargets[0].vertices) throw new Error('El DFF no guarda posiciones de vértices que podamos reducir.');

    return {
      flags,
      numVertices,
      colors,
      uvs,
      triangles,
      morphTargets,
      vertices: morphTargets[0].vertices,
      normals: morphTargets[0].normals,
      trailing: payload.subarray(pos),
    };
  }

  function buildGeometry(geom) {
    const header = new Uint8Array(16);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, geom.flags, true);
    headerView.setUint32(4, geom.triangles.length, true);
    headerView.setUint32(8, geom.numVertices, true);
    headerView.setUint32(12, geom.morphTargets.length, true);

    const triangleBytes = new Uint8Array(geom.triangles.length * 8);
    const triangleView = new DataView(triangleBytes.buffer);
    let pos = 0;
    for (const tri of geom.triangles) {
      for (let i = 0; i < 4; i++) triangleView.setUint16(pos + i * 2, tri[i], true);
      pos += 8;
    }

    const parts = [header];
    if (geom.colors) parts.push(geom.colors);
    for (const layer of geom.uvs) parts.push(asBytes(layer));
    parts.push(triangleBytes);
    for (const target of geom.morphTargets) {
      const morphHeader = new Uint8Array(24);
      morphHeader.set(target.sphere, 0);
      const morphView = new DataView(morphHeader.buffer);
      morphView.setUint32(16, target.vertices ? 1 : 0, true);
      morphView.setUint32(20, target.normals ? 1 : 0, true);
      parts.push(morphHeader);
      if (target.vertices) parts.push(asBytes(target.vertices));
      if (target.normals) parts.push(asBytes(target.normals));
    }
    if (geom.trailing.length) parts.push(geom.trailing);
    return concat(parts);
  }

  function parseSkin(payload, vertexCount) {
    if (payload.length < 4) throw new Error('El bloque del esqueleto está incompleto.');
    const numBones = payload[0];
    const usedCount = payload[1];
    const header = payload.slice(0, 4);
    const usedStart = 4;
    const indexStart = usedStart + usedCount;
    const weightStart = indexStart + vertexCount * 4;
    const matrixStart = weightStart + vertexCount * 16;
    const matrixLength = numBones * 64;
    ensureRange(payload, 0, matrixStart + matrixLength, 'Los datos del esqueleto no coinciden con la geometría.');

    const trailingStart = matrixStart + matrixLength;
    const trailing = payload.subarray(trailingStart);
    if (trailing.length !== 0 && trailing.length !== 12) {
      throw new Error('Este DFF usa una variante del esqueleto que todavía no podemos conservar.');
    }

    const usedBones = payload.slice(usedStart, indexStart);
    const indices = [];
    const weights = [];
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    for (let i = 0; i < vertexCount; i++) {
      const boneIndices = [];
      const boneWeights = [];
      for (let j = 0; j < 4; j++) boneIndices.push(payload[indexStart + i * 4 + j]);
      for (let j = 0; j < 4; j++) boneWeights.push(view.getFloat32(weightStart + i * 16 + j * 4, true));
      indices.push(boneIndices);
      weights.push(boneWeights);
    }
    return { header, usedBones, indices, weights, matrices: payload.slice(matrixStart, trailingStart), trailing };
  }

  function buildSkin(skin, order, averagedWeights) {
    const indexBytes = new Uint8Array(order.length * 4);
    const weightBytes = new Uint8Array(order.length * 16);
    const weightView = new DataView(weightBytes.buffer);
    for (let i = 0; i < order.length; i++) {
      const source = order[i];
      const boneIndices = skin.indices[source];
      const boneWeights = averagedWeights ? averagedWeights[i] : skin.weights[source];
      if (!boneIndices || !boneWeights) throw new Error('Los pesos del esqueleto no coinciden con los vértices.');
      for (let j = 0; j < 4; j++) {
        indexBytes[i * 4 + j] = boneIndices[j];
        weightView.setFloat32(i * 16 + j * 4, boneWeights[j], true);
      }
    }
    return concat([skin.header, skin.usedBones, indexBytes, weightBytes, skin.matrices, skin.trailing]);
  }

  function parseBinMesh(payload) {
    ensureRange(payload, 0, 12, 'El bloque BinMesh está incompleto.');
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const flags = view.getUint32(0, true);
    const meshCount = view.getUint32(4, true);
    const totalIndices = view.getUint32(8, true);
    if (flags !== 0 && flags !== 1) throw new Error('Este DFF usa un tipo de malla que todavía no podemos conservar.');
    const meshes = [];
    let pos = 12;
    let readIndexCount = 0;
    for (let i = 0; i < meshCount; i++) {
      ensureRange(payload, pos, 8, 'La lista de mallas está incompleta.');
      const count = view.getUint32(pos, true);
      const material = view.getUint32(pos + 4, true);
      pos += 8;
      ensureRange(payload, pos, count * 4, 'La lista de índices está incompleta.');
      const indices = [];
      for (let j = 0; j < count; j++) indices.push(view.getUint32(pos + j * 4, true));
      pos += count * 4;
      readIndexCount += count;

      const triangles = [];
      if (flags === 0) {
        if (count % 3 !== 0) throw new Error('La lista de triángulos del DFF está incompleta.');
        for (let j = 0; j < count; j += 3) triangles.push([indices[j], indices[j + 1], indices[j + 2]]);
      } else {
        for (let j = 0; j + 2 < count; j++) {
          const triangle = (j & 1)
            ? [indices[j + 1], indices[j], indices[j + 2]]
            : [indices[j], indices[j + 1], indices[j + 2]];
          if (triangle[0] !== triangle[1] && triangle[1] !== triangle[2] && triangle[0] !== triangle[2]) triangles.push(triangle);
        }
      }
      meshes.push({ material, triangles });
    }
    if (pos !== payload.length || readIndexCount !== totalIndices) throw new Error('El bloque BinMesh tiene un tamaño inconsistente.');
    return { meshes };
  }

  function buildBinMesh(bin) {
    const meshes = bin.meshes.filter((mesh) => mesh.triangles.length > 0);
    const total = meshes.reduce((sum, mesh) => sum + mesh.triangles.length * 3, 0);
    const out = new Uint8Array(12 + meshes.length * 8 + total * 4);
    const view = new DataView(out.buffer);
    view.setUint32(0, 0, true); // Reescribimos las tiras como listas de triángulos.
    view.setUint32(4, meshes.length, true);
    view.setUint32(8, total, true);
    let pos = 12;
    for (const mesh of meshes) {
      view.setUint32(pos, mesh.triangles.length * 3, true);
      view.setUint32(pos + 4, mesh.material, true);
      pos += 8;
      for (const triangle of mesh.triangles) {
        for (const index of triangle) {
          view.setUint32(pos, index, true);
          pos += 4;
        }
      }
    }
    return out;
  }

  function selectVectors(source, components, order) {
    const selected = new Float32Array(order.length * components);
    for (let i = 0; i < order.length; i++) {
      const from = order[i] * components;
      selected.set(source.subarray(from, from + components), i * components);
    }
    return selected;
  }

  function normalKeyPart(source, index) {
    const x = source[index * 3];
    const y = source[index * 3 + 1];
    const z = source[index * 3 + 2];
    const length = Math.hypot(x, y, z) || 1;
    const step = 0.125;
    return `${Math.round(x / length / step)},${Math.round(y / length / step)},${Math.round(z / length / step)}`;
  }

  function selectAveragedNormals(source, map, order) {
    const groups = groupByTarget(map, order.length);
    const out = new Float32Array(order.length * 3);
    for (let target = 0; target < order.length; target++) {
      let x = 0, y = 0, z = 0;
      for (const i of groups[target]) {
        x += source[i * 3];
        y += source[i * 3 + 1];
        z += source[i * 3 + 2];
      }
      const length = Math.hypot(x, y, z);
      if (length > 1e-6) {
        out[target * 3] = x / length;
        out[target * 3 + 1] = y / length;
        out[target * 3 + 2] = z / length;
      } else {
        out[target * 3] = source[order[target] * 3];
        out[target * 3 + 1] = source[order[target] * 3 + 1];
        out[target * 3 + 2] = source[order[target] * 3 + 2];
      }
    }
    return out;
  }

  function groupByTarget(map, count) {
    const groups = Array.from({ length: count }, () => []);
    for (let i = 0; i < map.length; i++) groups[map[i]].push(i);
    return groups;
  }

  function uvKeyPart(source, index) {
    const step = 0.01;
    return `${Math.round(source[index * 2] / step)},${Math.round(source[index * 2 + 1] / step)}`;
  }

  function selectAveragedUVs(source, map, order) {
    const groups = groupByTarget(map, order.length);
    const out = new Float32Array(order.length * 2);
    for (let target = 0; target < order.length; target++) {
      let u = 0, v = 0;
      for (const i of groups[target]) {
        u += source[i * 2];
        v += source[i * 2 + 1];
      }
      out[target * 2] = u / groups[target].length;
      out[target * 2 + 1] = v / groups[target].length;
    }
    return out;
  }

  function weightKeyPart(weights) {
    const step = 0.01;
    return weights.map((weight) => Math.round(weight / step)).join(',');
  }

  function selectAveragedWeights(weights, map, order) {
    const groups = groupByTarget(map, order.length);
    return groups.map((group) => {
      const averaged = [0, 0, 0, 0];
      for (const i of group) {
        for (let j = 0; j < 4; j++) averaged[j] += weights[i][j];
      }
      return averaged.map((sum) => sum / group.length);
    });
  }

  function clusterVertices(geom, skin, cell) {
    const map = new Int32Array(geom.numVertices).fill(-1);
    const buckets = new Map();
    const order = [];
    const representative = [];
    for (let i = 0; i < geom.numVertices; i++) {
      const x = geom.vertices[i * 3];
      const y = geom.vertices[i * 3 + 1];
      const z = geom.vertices[i * 3 + 2];
      if (![x, y, z].every(Number.isFinite)) throw new Error('El DFF tiene una posición de vértice inválida.');
      const keyParts = [Math.round(x / cell), Math.round(y / cell), Math.round(z / cell)];

      if (geom.colors) keyParts.push(Array.from(geom.colors.subarray(i * 4, i * 4 + 4)).join(','));
      for (const uv of geom.uvs) keyParts.push(uvKeyPart(uv, i));
      for (let morph = 0; morph < geom.morphTargets.length; morph++) {
        const target = geom.morphTargets[morph];
        if (target.vertices && morph > 0) keyParts.push(Array.from(target.vertices.subarray(i * 3, i * 3 + 3)).join(','));
        if (target.normals) keyParts.push(normalKeyPart(target.normals, i));
      }
      if (skin) {
        keyParts.push(skin.indices[i].join(','));
        keyParts.push(weightKeyPart(skin.weights[i]));
      }

      const key = keyParts.join('|');
      let targetIndex = buckets.get(key);
      if (targetIndex === undefined) {
        targetIndex = order.length;
        buckets.set(key, targetIndex);
        order.push(i);
      }
      map[i] = targetIndex;
      representative[targetIndex] = i;
    }

    const triangles = [];
    for (const tri of geom.triangles) {
      if (tri[0] >= map.length || tri[1] >= map.length || tri[3] >= map.length) throw new Error('Un triángulo apunta fuera de la geometría.');
      const a = map[tri[0]], b = map[tri[1]], c = map[tri[3]];
      if (a !== b && b !== c && a !== c) triangles.push([a, b, tri[2], c]);
    }
    return { map, order, representative, triangles };
  }

  function remapBinMesh(bin, map) {
    const meshes = [];
    for (const mesh of bin.meshes) {
      const triangles = [];
      for (const triangle of mesh.triangles) {
        if (triangle.some((index) => index >= map.length)) throw new Error('Un índice de BinMesh apunta fuera de la geometría.');
        const mapped = triangle.map((index) => map[index]);
        if (mapped[0] !== mapped[1] && mapped[1] !== mapped[2] && mapped[0] !== mapped[2]) triangles.push(mapped);
      }
      if (triangles.length) meshes.push({ material: mesh.material, triangles });
    }
    if (!meshes.length) throw new Error('La reducción quitaría todas las caras del DFF.');
    return { meshes };
  }

  function reduceGeometry(geometryChunk, replacements, targetReduction) {
    const geometryStruct = geometryChunk.children.find((chunk) => chunk.type === CHUNK.STRUCT);
    if (!geometryStruct) throw new Error('Una pieza del DFF no tiene datos de geometría.');
    const geom = parseGeometry(geometryStruct.payload);
    const skinChunks = findChunks(geometryChunk.children, CHUNK.SKIN);
    const binChunks = findChunks(geometryChunk.children, CHUNK.BINMESH);
    if (skinChunks.length > 1 || binChunks.length > 1) throw new Error('Esta pieza tiene bloques de geometría duplicados que no podemos conservar.');
    if (findChunk(geometryChunk.children, CHUNK.EXTRA_VERTEX_COLOR) || findChunk(geometryChunk.children, CHUNK.DELTA_MORPH)) {
      throw new Error('Esta pieza usa un complemento de vértices que todavía no podemos ajustar.');
    }

    const skin = skinChunks.length ? parseSkin(skinChunks[0].payload, geom.numVertices) : null;
    const bin = binChunks.length ? parseBinMesh(binChunks[0].payload) : null;
    if (!geom.triangles.length && !bin) throw new Error('Esta pieza no tiene una lista de caras que podamos reconstruir.');

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < geom.numVertices; i++) {
      minX = Math.min(minX, geom.vertices[i * 3]);
      minY = Math.min(minY, geom.vertices[i * 3 + 1]);
      minZ = Math.min(minZ, geom.vertices[i * 3 + 2]);
      maxX = Math.max(maxX, geom.vertices[i * 3]);
      maxY = Math.max(maxY, geom.vertices[i * 3 + 1]);
      maxZ = Math.max(maxZ, geom.vertices[i * 3 + 2]);
    }
    const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
    let best = null;
    let low = diagonal * 0.00005;
    let high = diagonal * 0.05;
    for (let step = 0; step < 18; step++) {
      const cell = (low + high) / 2;
      const result = clusterVertices(geom, skin, cell);
      const reduction = 1 - result.order.length / geom.numVertices;
      if (!best || Math.abs(reduction - targetReduction) < Math.abs(best.reduction - targetReduction)) {
        best = { ...result, reduction };
      }
      if (reduction < targetReduction) low = cell;
      else high = cell;
    }
    if (!best || best.reduction < 0.02) return false;
    if (!best.triangles.length && geom.triangles.length) throw new Error('La reducción quitaría todas las caras de una pieza.');

    const newCount = best.order.length;
    const morphTargets = geom.morphTargets.map((target, index) => ({
      ...target,
      vertices: target.vertices ? selectVectors(target.vertices, 3, best.representative) : null,
      normals: target.normals ? selectAveragedNormals(target.normals, best.map, best.order) : null,
    }));
    const newGeom = {
      ...geom,
      flags: geom.flags & ~0x1,
      numVertices: newCount,
      colors: geom.colors ? (() => {
        const selected = new Uint8Array(newCount * 4);
        for (let i = 0; i < newCount; i++) selected.set(geom.colors.subarray(best.representative[i] * 4, best.representative[i] * 4 + 4), i * 4);
        return selected;
      })() : null,
      uvs: geom.uvs.map((uv) => selectAveragedUVs(uv, best.map, best.order)),
      morphTargets,
      vertices: morphTargets[0].vertices,
      normals: morphTargets[0].normals,
      triangles: best.triangles,
    };

    replacements.set(geometryStruct, buildGeometry(newGeom));
    if (skinChunks.length) replacements.set(skinChunks[0], buildSkin(skin, best.representative, selectAveragedWeights(skin.weights, best.map, best.order)));
    if (binChunks.length) replacements.set(binChunks[0], buildBinMesh(remapBinMesh(bin, best.map)));
    return true;
  }

  function reduceDff(bytes, percent) {
    const chunks = parseChunks(bytes, 0, bytes.length);
    const clump = chunks.find((chunk) => chunk.type === CHUNK.CLUMP);
    if (!clump) throw new Error('El archivo no es un DFF de GTA San Andreas.');
    const geometryChunks = findChunks([clump], CHUNK.GEOMETRY);
    if (!geometryChunks.length) throw new Error('El DFF no tiene geometría.');
    const target = Math.max(0, Math.min(0.5, percent / 100));
    if (target === 0) return new Uint8Array(bytes);

    const replacements = new Map();
    let changed = false;
    for (const geometryChunk of geometryChunks) {
      changed = reduceGeometry(geometryChunk, replacements, target) || changed;
    }
    if (!changed) return new Uint8Array(bytes);
    const parsedEnd = chunks.reduce((end, chunk) => Math.max(end, chunk.end), 0);
    const tail = bytes.subarray(parsedEnd);
    return concat([serializeChunks(chunks, replacements), tail]);
  }

  const api = { optimizeDff: reduceDff, parseChunks, findChunk, findChunks, CHUNK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SkinLiteDff = api;
})(typeof window !== 'undefined' ? window : globalThis);
