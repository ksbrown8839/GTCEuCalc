const VISIBLE_FACE_GROUPS = [
  ["north", "south"],
  ["east", "west"],
  ["up"]
];

const FACE_SHADE = {
  up: 1.08,
  north: 0.82,
  south: 0.82,
  east: 0.72,
  west: 0.72,
  down: 0.55
};

const FACE_PRIORITY = {
  south: 10,
  north: 12,
  west: 18,
  east: 20,
  up: 30,
  down: 0
};

export function canRenderModelDefinition(definition) {
  return Boolean(definition && Array.isArray(definition.elements) && definition.elements.length > 0);
}

export function drawModelIcon(definition, images, atlas, atlasWidth, iconId, tileSize, columns) {
  if (!canRenderModelDefinition(definition)) return false;

  const targetX = (iconId % columns) * tileSize;
  const targetY = Math.floor(iconId / columns) * tileSize;
  const scale = tileSize / 32;
  const faces = collectRenderableFaces(definition, images);

  faces.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return FACE_PRIORITY[a.faceName] - FACE_PRIORITY[b.faceName];
  });

  for (const face of faces) {
    drawTexturedFace(face, images, atlas, atlasWidth, targetX, targetY, scale);
  }

  return true;
}

function collectRenderableFaces(definition, images) {
  const faces = [];

  for (const element of definition.elements) {
    const from = normalizeVector(element.from, [0, 0, 0]);
    const to = normalizeVector(element.to, [16, 16, 16]);
    const elementFaces = element.faces ?? {};
    const selectedFaceNames = selectVisibleFaceNames(elementFaces);

    for (const faceName of selectedFaceNames) {
      const face = elementFaces[faceName];
      if (!face?.texture || !images[face.texture]) continue;

      const vertices = faceVertices(faceName, from, to);
      faces.push({
        element,
        face,
        faceName,
        vertices,
        depth: averageDepth(vertices, faceName)
      });
    }
  }

  return faces;
}

function selectVisibleFaceNames(faces) {
  const selected = [];
  for (const group of VISIBLE_FACE_GROUPS) {
    const faceName = group.find((candidate) => faces[candidate]?.texture);
    if (faceName) selected.push(faceName);
  }
  return selected;
}

function normalizeVector(value, fallback) {
  if (!Array.isArray(value) || value.length < 3) return fallback;
  return [Number(value[0]), Number(value[1]), Number(value[2])];
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
  const center = vertices.reduce((sum, vertex) => {
    sum[0] += vertex[0];
    sum[1] += vertex[1];
    sum[2] += vertex[2];
    return sum;
  }, [0, 0, 0]).map((value) => value / vertices.length);

  const [x, y, z] = center;
  return x + z - y * 0.08 + (FACE_PRIORITY[faceName] ?? 0) / 100;
}

function project([x, y, z], scale) {
  return [
    (16 + (x - z) * (11 / 16)) * scale,
    (3 + (x + z) * (6 / 16) + (16 - y) * (13 / 16)) * scale
  ];
}

function drawTexturedFace(faceEntry, images, atlas, atlasWidth, targetX, targetY, scale) {
  const image = images[faceEntry.face.texture];
  if (!image) return;

  const points = faceEntry.vertices.map((vertex) => project(vertex, scale));
  const shade = FACE_SHADE[faceEntry.faceName] ?? 1;
  const uv = normalizeUv(faceEntry.face.uv);
  const rotation = Number(faceEntry.face.rotation ?? 0);

  drawTexturedQuad(image, atlas, atlasWidth, targetX, targetY, points, uv, rotation, shade);
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
