const DEFAULT_GUI_TRANSFORM = {
  rotation: [30, 225, 0],
  translation: [0, 0, 0],
  scale: [0.625, 0.625, 0.625]
};

const FACE_NORMALS = {
  up: [0, 1, 0],
  down: [0, -1, 0],
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0]
};

const FACE_SHADE = {
  up: 1.08,
  north: 0.88,
  south: 0.82,
  east: 0.86,
  west: 0.76,
  down: 0.55
};

const FACE_PRIORITY = {
  down: 0,
  north: 10,
  south: 12,
  west: 18,
  east: 20,
  up: 30
};

export function canRenderModelDefinition(definition) {
  return Boolean(definition && Array.isArray(definition.elements) && definition.elements.length > 0);
}

export function drawModelIcon(definition, images, atlas, atlasWidth, iconId, tileSize, columns) {
  if (!canRenderModelDefinition(definition)) return false;

  const targetX = (iconId % columns) * tileSize;
  const targetY = Math.floor(iconId / columns) * tileSize;
  const transform = resolvedGuiTransform(definition);
  const faces = collectRenderableFaces(definition, images, transform);
  if (!faces.length) return false;

  const fit = projectionFit(faces, tileSize);

  faces.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return (FACE_PRIORITY[a.faceName] ?? 0) - (FACE_PRIORITY[b.faceName] ?? 0);
  });

  for (const face of faces) {
    drawTexturedFace(face, images, atlas, atlasWidth, targetX, targetY, fit);
  }

  return true;
}

function collectRenderableFaces(definition, images, transform) {
  const faces = [];

  for (const element of definition.elements) {
    const from = normalizeVector(element.from, [0, 0, 0]);
    const to = normalizeVector(element.to, [16, 16, 16]);
    const elementFaces = element.faces ?? {};

    for (const [faceName, face] of Object.entries(elementFaces)) {
      if (!face?.texture || !images[face.texture]) continue;

      const rawVertices = faceVertices(faceName, from, to);
      const vertices = rawVertices.map((vertex) => transformVertex(vertex, transform));
      const normal = transformNormal(FACE_NORMALS[faceName] ?? [0, 0, 1], transform);
      if (!isFaceVisible(normal)) continue;

      faces.push({
        element,
        face,
        faceName,
        vertices,
        normal,
        depth: averageDepth(vertices, faceName)
      });
    }
  }

  return faces;
}

function resolvedGuiTransform(definition) {
  const gui = definition?.display?.gui ?? {};
  return {
    rotation: normalizeVector(gui.rotation, DEFAULT_GUI_TRANSFORM.rotation),
    translation: normalizeVector(gui.translation, DEFAULT_GUI_TRANSFORM.translation),
    scale: normalizeVector(gui.scale, DEFAULT_GUI_TRANSFORM.scale)
  };
}

function normalizeVector(value, fallback) {
  if (!Array.isArray(value) || value.length < 3) return [...fallback];
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

function transformVertex(vertex, transform) {
  let [x, y, z] = vertex.map(Number);

  x -= 8;
  y -= 8;
  z -= 8;

  x *= transform.scale[0];
  y *= transform.scale[1];
  z *= transform.scale[2];

  [x, y, z] = rotateX([x, y, z], degreesToRadians(transform.rotation[0]));
  [x, y, z] = rotateY([x, y, z], degreesToRadians(transform.rotation[1]));
  [x, y, z] = rotateZ([x, y, z], degreesToRadians(transform.rotation[2]));

  x += transform.translation[0];
  y += transform.translation[1];
  z += transform.translation[2];

  return [x, y, z];
}

function transformNormal(normal, transform) {
  let [x, y, z] = normal.map(Number);
  [x, y, z] = rotateX([x, y, z], degreesToRadians(transform.rotation[0]));
  [x, y, z] = rotateY([x, y, z], degreesToRadians(transform.rotation[1]));
  [x, y, z] = rotateZ([x, y, z], degreesToRadians(transform.rotation[2]));
  return normalizeNormal([x, y, z]);
}

function normalizeNormal([x, y, z]) {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function isFaceVisible(normal) {
  return normal[2] < -0.0001;
}

function degreesToRadians(degrees) {
  return (Number(degrees) * Math.PI) / 180;
}

function rotateX([x, y, z], radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [x, y * c - z * s, y * s + z * c];
}

function rotateY([x, y, z], radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [x * c + z * s, y, -x * s + z * c];
}

function rotateZ([x, y, z], radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [x * c - y * s, x * s + y * c, z];
}

function faceVertices(faceName, from, to) {
  const [x1, y1, z1] = from;
  const [x2, y2, z2] = to;

  switch (faceName) {
    case "up":
      return [[x1, y2, z1], [x2, y2, z1], [x2, y2, z2], [x1, y2, z2]];
    case "down":
      return [[x1, y1, z2], [x2, y1, z2], [x2, y1, z1], [x1, y1, z1]];
    case "north":
      return [[x2, y2, z1], [x1, y2, z1], [x1, y1, z1], [x2, y1, z1]];
    case "south":
      return [[x1, y2, z2], [x2, y2, z2], [x2, y1, z2], [x1, y1, z2]];
    case "east":
      return [[x2, y2, z2], [x2, y2, z1], [x2, y1, z1], [x2, y1, z2]];
    case "west":
      return [[x1, y2, z1], [x1, y2, z2], [x1, y1, z2], [x1, y1, z1]];
    default:
      return [[x1, y2, z1], [x2, y2, z1], [x2, y1, z1], [x1, y1, z1]];
  }
}

function averageDepth(vertices, faceName) {
  const z = vertices.reduce((sum, vertex) => sum + vertex[2], 0) / vertices.length;
  return z + (FACE_PRIORITY[faceName] ?? 0) / 10000;
}

function projectionFit(faces, tileSize) {
  const points = faces.flatMap((face) => face.vertices.map(projectRaw));
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const width = Math.max(0.0001, maxX - minX);
  const height = Math.max(0.0001, maxY - minY);
  const padding = Math.max(2, tileSize * 0.08);
  const scale = Math.min((tileSize - padding * 2) / width, (tileSize - padding * 2) / height);
  const offsetX = padding + (tileSize - padding * 2 - width * scale) / 2 - minX * scale;
  const offsetY = padding + (tileSize - padding * 2 - height * scale) / 2 - minY * scale;
  return { scale, offsetX, offsetY };
}

function projectRaw([x, y]) {
  return [x, -y];
}

function project(vertex, fit) {
  const [x, y] = projectRaw(vertex);
  return [x * fit.scale + fit.offsetX, y * fit.scale + fit.offsetY];
}

function drawTexturedFace(faceEntry, images, atlas, atlasWidth, targetX, targetY, fit) {
  const image = images[faceEntry.face.texture];
  if (!image) return;

  const points = faceEntry.vertices.map((vertex) => project(vertex, fit));
  const shade = shadeForFace(faceEntry);
  const uv = normalizeUv(faceEntry.face.uv);
  const rotation = Number(faceEntry.face.rotation ?? 0);

  drawTexturedQuad(image, atlas, atlasWidth, targetX, targetY, points, uv, rotation, shade);
}

function shadeForFace(faceEntry) {
  const base = FACE_SHADE[faceEntry.faceName] ?? 1;
  const normalLift = Math.max(0, faceEntry.normal[1]) * 0.18;
  const normalTurn = Math.max(0, -faceEntry.normal[2]) * 0.08;
  return Math.min(1.18, Math.max(0.58, base + normalLift + normalTurn));
}

function normalizeUv(uv) {
  if (!Array.isArray(uv) || uv.length < 4) return [0, 0, 16, 16];
  return uv.map(Number);
}

function drawTexturedQuad(image, atlas, atlasWidth, targetX, targetY, points, uv, rotation, shade) {
  const [minX, minY, maxX, maxY] = polygonBounds(points);
  const [originX, originY] = points[0];
  const [uEndX, uEndY] = points[1];
  const [vEndX, vEndY] = points[3];
  const ux = uEndX - originX;
  const uy = uEndY - originY;
  const vx = vEndX - originX;
  const vy = vEndY - originY;
  const determinant = ux * vy - uy * vx;

  if (!determinant) return;

  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y += 1) {
    for (let x = Math.floor(minX); x <= Math.ceil(maxX); x += 1) {
      const qx = x + 0.5 - originX;
      const qy = y + 0.5 - originY;
      let u = (qx * vy - qy * vx) / determinant;
      let v = (ux * qy - uy * qx) / determinant;

      if (u < 0 || u > 1 || v < 0 || v > 1) continue;

      [u, v] = rotateUvCoordinate(u, v, rotation);
      const source = sampleUv(image, uv, u, v, shade);
      if (source[3] === 0) continue;
      blendPixel(atlas, atlasWidth, Math.round(targetX + x), Math.round(targetY + y), source);
    }
  }
}

function rotateUvCoordinate(u, v, rotation) {
  const normalized = ((rotation % 360) + 360) % 360;
  if (normalized === 90) return [v, 1 - u];
  if (normalized === 180) return [1 - u, 1 - v];
  if (normalized === 270) return [1 - v, u];
  return [u, v];
}

function sampleUv(image, uv, u, v, shade) {
  const [u0, v0, u1, v1] = uv;
  const textureU = u0 + (u1 - u0) * u;
  const textureV = v0 + (v1 - v0) * v;
  const sourceX = Math.min(image.width - 1, Math.max(0, Math.floor((textureU / 16) * image.width)));
  const sourceY = Math.min(image.height - 1, Math.max(0, Math.floor((textureV / 16) * image.height)));
  const sourceOffset = (sourceY * image.width + sourceX) * 4;

  return [
    Math.min(255, Math.round(image.pixels[sourceOffset] * shade)),
    Math.min(255, Math.round(image.pixels[sourceOffset + 1] * shade)),
    Math.min(255, Math.round(image.pixels[sourceOffset + 2] * shade)),
    image.pixels[sourceOffset + 3]
  ];
}

function polygonBounds(points) {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function blendPixel(atlas, atlasWidth, x, y, color) {
  if (x < 0 || y < 0 || x >= atlasWidth) return;
  const offset = (y * atlasWidth + x) * 4;
  if (offset < 0 || offset + 3 >= atlas.length) return;

  const alpha = color[3] / 255;
  const inverse = 1 - alpha;
  atlas[offset] = Math.round(color[0] * alpha + atlas[offset] * inverse);
  atlas[offset + 1] = Math.round(color[1] * alpha + atlas[offset + 1] * inverse);
  atlas[offset + 2] = Math.round(color[2] * alpha + atlas[offset + 2] * inverse);
  atlas[offset + 3] = Math.round(255 * (alpha + (atlas[offset + 3] / 255) * inverse));
}
