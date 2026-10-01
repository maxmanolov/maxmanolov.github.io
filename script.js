// Public GitHub contribution snapshot refreshed September 28, 2026.
const contributions = {
  "2026-07-13": [6, 1],
  "2026-07-14": [1, 1],
  "2026-07-18": [14, 1],
  "2026-07-24": [5, 1],
  "2026-07-27": [14, 1],
  "2026-07-28": [65, 3],
  "2026-07-30": [133, 4],
  "2026-07-31": [103, 4],
  "2026-08-01": [10, 1],
  "2026-08-02": [71, 3],
  "2026-08-03": [1, 1],
  "2026-08-04": [27, 2],
  "2026-08-05": [160, 4],
  "2026-08-06": [91, 4],
  "2026-08-07": [47, 2],
  "2026-08-08": [33, 2],
  "2026-08-09": [18, 1],
  "2026-08-10": [6, 1],
  "2026-08-11": [3, 1],
  "2026-08-15": [86, 4],
  "2026-08-16": [36, 2],
  "2026-09-03": [16, 1],
  "2026-09-05": [15, 1],
  "2026-09-07": [11, 1],
  "2026-09-21": [40, 2],
};

const graph = document.querySelector("#graph");
const start = new Date("2026-06-28T00:00:00Z");
const end = new Date("2026-09-28T00:00:00Z");
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
  const isoDate = date.toISOString().slice(0, 10);
  const [count = 0, level = 0] = contributions[isoDate] ?? [];
  const cell = document.createElement("span");
  const contributionLabel = `${count} contribution${count === 1 ? "" : "s"}`;

  cell.className = "day";
  cell.dataset.level = level;
  cell.title = `${contributionLabel} on ${dateFormatter.format(date)}`;
  cell.setAttribute("role", "gridcell");
  cell.setAttribute("aria-label", cell.title);
  graph.append(cell);
}

const chipCanvas = document.querySelector("#chip-background");
const introBlock = document.querySelector(".intro");
const contributionCard = document.querySelector(".contributions");
const chipContext = chipCanvas.getContext("2d");
const glyphAtlas = document.createElement("canvas");
const glyphContext = glyphAtlas.getContext("2d");

// The package is modelled in object units: x runs right, y runs back, z runs up.
// Yaw stays inside (0, π/2), so the -x and -y side faces are the visible ones.
const BASE_YAW = Math.PI / 4;
const BASE_ELEVATION = 0.64;
const YAW_RANGE = 0.09;
const ELEVATION_RANGE = 0.045;
const CAMERA_EASE = 0.1;
// Phone tilt: degrees of movement for a full tilt, and how quickly (seconds)
// the resting angle recentres, so the chip wiggles as the phone moves and
// settles when it is held still.
const MOTION_RANGE = 8;
const MOTION_RECENTER = 1.2;
const LIGHT_EASE = 0.085;
const LIGHT_RADIUS = 1.05;
const LIGHT_PEAK = 0.62;
const WAVE_SPEED = 5.2;
const WAVE_EDGE = 0.34;
const WAVE_TAIL = 0.55;
const WAVE_REACH = 9.2;
const HEAT_LEVELS = 6;

function box(x0, y0, x1, y1, z0, z1) {
  return { x0, y0, x1, y1, z0, z1 };
}

const substrate = box(-4.8, -4.8, 4.8, 4.8, -0.26, 0);
const interposer = box(-4.02, -2.3, 4.02, 2.3, 0, 0.07);
const die = box(-2.1, -2, 2.1, 2, 0.07, 0.25);
const PIN_DEPTH = 0.12;
const GROUND_Z = substrate.z0 - PIN_DEPTH - 0.04;

// Glyph atlas: one column per character, one row per tone.
const DOT = 0;
const COLON = 1;
const PLUS = 2;
const HASH = 3;
const EQUAL = 4;
const CROSS = 5;
const GLYPHS = ["·", ":", "+", "#", "=", "x"];
const INK = [23, 24, 22];
const TONES = [
  [...INK, 0.1],
  [...INK, 0.17],
  [...INK, 0.25],
  [...INK, 0.34],
];
const HEAT_TONE = TONES.length - 1;
for (let level = 1; level <= HEAT_LEVELS; level += 1) {
  const amount = (level - 1) / (HEAT_LEVELS - 1);
  TONES.push([...mix([98, 183, 125], [11, 99, 62], amount), 0.34 + level * 0.09]);
}
const COMPUTE_RAMP = [DOT, COLON, COLON, PLUS, PLUS, HASH, HASH];
const CACHE_RAMP = [EQUAL, EQUAL, EQUAL, EQUAL, HASH, HASH, HASH];
const SIGNAL_RAMP = [COLON, COLON, COLON, PLUS, PLUS, HASH, HASH];
const SWITCH_RAMP = [CROSS, CROSS, CROSS, CROSS, CROSS, HASH, HASH];

function mix(from, to, amount) {
  return from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount));
}

function rgb(color) {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

function inkStroke(alpha) {
  return `rgba(${INK[0]}, ${INK[1]}, ${INK[2]}, ${alpha})`;
}

// Opaque, paper-like materials. Side faces carry nine relight steps so the
// pointer can shift the light without building colour strings every frame.
function material(top, left, right) {
  const steps = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
  return {
    top: rgb(top),
    left: steps.map((step) => rgb(left.map((channel) => Math.round(channel - step * 1.5)))),
    right: steps.map((step) => rgb(right.map((channel) => Math.round(channel + step * 1.5)))),
  };
}

function heatRamp(idle, hot) {
  return Array.from({ length: HEAT_LEVELS + 1 }, (_, level) => rgb(mix(idle, hot, level / HEAT_LEVELS)));
}

const MATERIALS = {
  substrate: material([240, 239, 232], [228, 227, 218], [217, 216, 206]),
  interposer: material([243, 242, 236], [230, 229, 221], [221, 220, 211]),
  die: material([249, 248, 244], [229, 228, 220], [218, 217, 208]),
  memory: material([245, 244, 239], [231, 230, 222], [221, 220, 211]),
  capacitor: material([234, 232, 223], [221, 219, 209], [211, 209, 198]),
};
const FILLS = {
  tile: heatRamp([239, 238, 231], [170, 216, 182]),
  cache: heatRamp([234, 233, 225], [170, 216, 182]),
  port: heatRamp([231, 230, 222], [150, 205, 166]),
  memory: heatRamp([245, 244, 239], [206, 231, 212]),
};
const STROKES = {
  silhouette: inkStroke(0.3),
  edge: inkStroke(0.22),
  structure: inkStroke(0.13),
  faint: inkStroke(0.08),
  pins: inkStroke(0.24),
  routes: inkStroke(0.2),
  hotRoutes: "rgba(11, 99, 62, 0.62)",
};

// Floorplan: eight GPCs of 2 × 4 SMs around a split L2 and a central crossbar,
// three HBM PHYs on each long edge, each routed across the interposer to a stack.
const units = [];
const tiles = [];
const gpcs = [];
const cacheSlices = [];
const ports = [];
const routes = [];
const stacks = [];

function unit(x0, y0, x1, y1, extra = {}) {
  const part = {
    x0,
    y0,
    x1,
    y1,
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
    delay: 0,
    heat: 0,
    ...extra,
  };
  part.portX ??= part.cx;
  part.portY ??= part.cy;
  units.push(part);
  return part;
}

for (const [rowStart, rowEnd] of [[0.32, 1.92], [-1.92, -0.32]]) {
  for (let column = 0; column < 4; column += 1) {
    const x0 = -1.76 + column * 0.9;
    gpcs.push(box(x0, rowStart, x0 + 0.82, rowEnd, die.z1, die.z1));
    for (let row = 0; row < 4; row += 1) {
      for (let lane = 0; lane < 2; lane += 1) {
        const tileX = x0 + 0.05 + lane * 0.38;
        const tileY = rowStart + 0.05 + row * 0.385;
        tiles.push(unit(tileX, tileY, tileX + 0.34, tileY + 0.345));
      }
    }
  }
}

for (const start of [-1.76, 0.2]) {
  for (let slice = 0; slice < 8; slice += 1) {
    const x0 = start + slice * 0.1975;
    cacheSlices.push(unit(x0, -0.22, x0 + 0.1775, 0.22));
  }
}
const crossbar = unit(-0.14, -0.22, 0.14, 0.22);
const switches = [crossbar];

for (const side of [-1, 1]) {
  for (let index = 0; index < 3; index += 1) {
    const centerY = (index - 1) * 1.36;
    const portX0 = side < 0 ? -2.04 : 1.84;
    const port = unit(portX0, centerY - 0.52, portX0 + 0.2, centerY + 0.52);
    const portFields = { portX: port.cx, portY: port.cy };
    const routeX0 = side < 0 ? -2.42 : 2.1;
    const stackX0 = side < 0 ? -3.72 : 2.42;
    ports.push(port);
    routes.push(unit(routeX0, centerY - 0.36, routeX0 + 0.32, centerY + 0.36, {
      ...portFields,
      delay: 0.2,
    }));
    const stack = unit(stackX0, centerY - 0.62, stackX0 + 1.3, centerY + 0.62, {
      ...portFields,
      delay: 0.5,
    });
    stack.z0 = interposer.z1;
    stack.z1 = die.z1;
    stacks.push(stack);
  }
}

// Painter's order for the raised parts: farthest first. Their footprints are
// disjoint and yaw never leaves its quadrant, so the order is fixed.
const raisedParts = [die, ...stacks].sort((a, b) => depthKey(b) - depthKey(a));

function depthKey(part) {
  const cx = (part.x0 + part.x1) / 2;
  const cy = (part.y0 + part.y1) / 2;
  return cx * Math.sin(BASE_YAW) + cy * Math.cos(BASE_YAW);
}

// Decoupling capacitors: one bank under each HBM column, one under the die.
const backCapacitors = [];
const frontCapacitors = [];
for (const bankX of [-3.07, 0, 3.07]) {
  const count = bankX === 0 ? 6 : 4;
  for (let index = 0; index < count; index += 1) {
    const x0 = bankX + (index - count / 2) * 0.34 + 0.08;
    backCapacitors.push(box(x0, 2.62, x0 + 0.18, 2.72, 0, 0.045));
    frontCapacitors.push(box(x0, -2.72, x0 + 0.18, -2.62, 0, 0.045));
  }
}

const substrateDots = [];
for (let x = -4.6; x < 4.65; x += 0.4) {
  for (let y = -4.6; y < 4.65; y += 0.4) {
    const nearInterposer = Math.abs(x) < 4.3 && Math.abs(y) < 2.58;
    const nearCapacitors = Math.abs(y) > 2.45 && Math.abs(y) < 2.9 && Math.abs(x) < 3.9;
    if (!nearInterposer && !nearCapacitors) substrateDots.push(x, y);
  }
}
const substrateDotPoints = new Float32Array(substrateDots);

const pointer = {
  clientX: 0,
  clientY: 0,
  inside: false,
};
const motion = {
  x: 0,
  y: 0,
  rawX: 0,
  rawY: 0,
  restX: 0,
  restY: 0,
  ready: false,
};
const view = {
  tiltX: 0,
  tiltY: 0,
  relight: 0,
};
const light = {
  x: 0,
  y: 0,
  amount: 0,
};
const lightTarget = { x: 0, y: 0 };
const waveOrigin = { x: 0, y: 0 };
const waves = Array.from({ length: 3 }, () => ({ x: 0, y: 0, startedAt: 0, active: false }));
let nextWave = 0;
let viewportWidth = 0;
let viewportHeight = 0;
let pixelRatio = 1;
let scale = 1;
let originX = 0;
let originY = 0;
let pxx = 0;
let pxy = 0;
let pyx = 0;
let pyy = 0;
let pyz = 0;
let glyphColumns = 1;
let glyphSize = 0;
let cellWidth = 0;
let cellHeight = 0;
let frameRequest = 0;
let lastTick = 0;
let atlasKey = "";
const groundShadow = chipContext.createRadialGradient(0, 0, 0, 0, 0, 7.4);
groundShadow.addColorStop(0, "rgba(64, 60, 44, 0.1)");
groundShadow.addColorStop(0.62, "rgba(64, 60, 44, 0.045)");
groundShadow.addColorStop(1, "rgba(64, 60, 44, 0)");

function projectX(x, y) {
  return originX + x * pxx + y * pxy;
}

function projectY(x, y, z) {
  return originY + x * pyx + y * pyy + z * pyz;
}

function setProjection(yaw, elevation) {
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const sinElevation = Math.sin(elevation);
  pxx = scale * cosYaw;
  pxy = -scale * sinYaw;
  pyx = -scale * sinYaw * sinElevation;
  pyy = -scale * cosYaw * sinElevation;
  pyz = -scale * Math.cos(elevation);
}

function applyTilt() {
  setProjection(BASE_YAW - view.tiltX * YAW_RANGE, BASE_ELEVATION - view.tiltY * ELEVATION_RANGE);
}

// Screen point (device pixels) → object coordinates on the plane z.
function unproject(screenX, screenY, z, target) {
  const dx = screenX - originX;
  const dy = screenY - originY - z * pyz;
  const determinant = pxx * pyy - pxy * pyx;
  target.x = (dx * pyy - pxy * dy) / determinant;
  target.y = (pxx * dy - pyx * dx) / determinant;
  return target;
}

function resizeChipCanvas() {
  viewportWidth = window.innerWidth;
  viewportHeight = window.innerHeight;
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(viewportWidth * pixelRatio);
  const height = Math.round(viewportHeight * pixelRatio);
  if (chipCanvas.width !== width || chipCanvas.height !== height) {
    chipCanvas.width = width;
    chipCanvas.height = height;
  }

  // Unit-scale bounds of the package at the resting view.
  const spanX = 2 * (substrate.x1 * Math.cos(BASE_YAW) + substrate.y1 * Math.sin(BASE_YAW));
  const reach = substrate.x1 * Math.sin(BASE_YAW) + substrate.y1 * Math.cos(BASE_YAW);
  const top = reach * Math.sin(BASE_ELEVATION);
  const bottom = reach * Math.sin(BASE_ELEVATION) + (PIN_DEPTH - substrate.z0) * Math.cos(BASE_ELEVATION);
  const spanY = top + bottom;
  const coreSpan = 2 * (interposer.x1 * Math.cos(BASE_YAW) + interposer.y1 * Math.sin(BASE_YAW));
  const compact = viewportWidth < 640 || viewportWidth < viewportHeight * 0.8;

  // Wide screens show the whole package; narrow screens keep the interposer
  // (die, memory and fabric) in frame and let the substrate corners bleed.
  const cssScale = compact
    ? Math.min((viewportWidth * 0.96) / coreSpan, (viewportHeight * 0.62) / spanY)
    : Math.min((viewportWidth * 0.9) / spanX, (viewportHeight * 0.84) / spanY, 112);
  // Rest the die in the gap between the introduction and the card, keeping
  // the whole package in frame whenever it fits.
  const scrollTop = window.scrollY;
  const gapY = (introBlock.getBoundingClientRect().bottom + contributionCard.getBoundingClientRect().top) / 2 + scrollTop;
  // The clamp uses the steepest tilt, so the pointer never pushes it out of frame.
  const dieLift = die.z1 * Math.cos(BASE_ELEVATION) * cssScale;
  const steepest = Math.sin(BASE_ELEVATION + ELEVATION_RANGE);
  const topReach = reach * steepest;
  const bottomReach = reach * steepest + (PIN_DEPTH - substrate.z0) * Math.cos(BASE_ELEVATION - ELEVATION_RANGE);
  const margin = 12;
  let restY = Math.min(gapY, viewportHeight * 0.56) + dieLift;
  // Tall phones have open space below the card: the die sits there, clear of
  // the reading veil, with the package rising behind the content.
  const dieReach = (die.x1 * Math.sin(BASE_YAW) + die.y1 * Math.cos(BASE_YAW)) * Math.sin(BASE_ELEVATION) * cssScale;
  const cardBottom = contributionCard.getBoundingClientRect().bottom + scrollTop;
  const room = viewportHeight - cardBottom - dieReach * 2 - 12;
  if (compact && room >= 0) restY = cardBottom + 12 + dieReach + room / 2 + dieLift;
  if (!compact && (topReach + bottomReach) * cssScale < viewportHeight - margin * 2) {
    restY = Math.max(topReach * cssScale + margin, Math.min(viewportHeight - bottomReach * cssScale - margin, restY));
  }
  scale = cssScale * pixelRatio;
  originX = (viewportWidth / 2) * pixelRatio;
  originY = restY * pixelRatio;
  glyphColumns = cssScale >= 68 ? 2 : 1;
  glyphSize = Math.max(6, Math.min(8.5, Math.round(cssScale * 0.18) / 2));
  buildGlyphAtlas();
}

function buildGlyphAtlas() {
  const fontSize = Math.round(glyphSize * pixelRatio);
  const key = `${fontSize}:${document.fonts?.check?.(`500 ${fontSize}px "Geist Mono"`)}`;
  if (key === atlasKey) return;
  atlasKey = key;
  cellWidth = Math.ceil(fontSize * 0.75) + 2;
  cellHeight = Math.ceil(fontSize * 1.3) + 2;
  glyphAtlas.width = cellWidth * GLYPHS.length;
  glyphAtlas.height = cellHeight * TONES.length;
  glyphContext.font = `500 ${fontSize}px "Geist Mono", ui-monospace, monospace`;
  glyphContext.textAlign = "center";
  glyphContext.textBaseline = "middle";
  TONES.forEach(([red, green, blue, alpha], tone) => {
    glyphContext.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    GLYPHS.forEach((glyph, column) => {
      glyphContext.fillText(glyph, (column + 0.5) * cellWidth, (tone + 0.5) * cellHeight);
    });
  });
}

function drawGlyph(glyph, tone, x, y) {
  chipContext.drawImage(
    glyphAtlas,
    glyph * cellWidth,
    tone * cellHeight,
    cellWidth,
    cellHeight,
    Math.round(x - cellWidth / 2),
    Math.round(y - cellHeight / 2),
    cellWidth,
    cellHeight,
  );
}

function heatLevel(heat) {
  return heat < 0.05 ? 0 : Math.min(HEAT_LEVELS, Math.ceil(heat * HEAT_LEVELS));
}

function snap(value) {
  return Math.round(value) + 0.5;
}

function quadPath(x0, y0, x1, y1, z) {
  chipContext.moveTo(projectX(x0, y0), projectY(x0, y0, z));
  chipContext.lineTo(projectX(x1, y0), projectY(x1, y0, z));
  chipContext.lineTo(projectX(x1, y1), projectY(x1, y1, z));
  chipContext.lineTo(projectX(x0, y1), projectY(x0, y1, z));
  chipContext.closePath();
}

function drawBox(part, surface, edge) {
  const shade = Math.round(view.relight * 4) + 4;
  const ax = snap(projectX(part.x0, part.y0));
  const bx = snap(projectX(part.x1, part.y0));
  const cx = snap(projectX(part.x1, part.y1));
  const dx = snap(projectX(part.x0, part.y1));
  const ay = projectY(part.x0, part.y0, part.z1);
  const by = projectY(part.x1, part.y0, part.z1);
  const cy = projectY(part.x1, part.y1, part.z1);
  const dy = projectY(part.x0, part.y1, part.z1);
  const drop = (part.z0 - part.z1) * pyz;

  chipContext.beginPath();
  chipContext.moveTo(ax, ay);
  chipContext.lineTo(bx, by);
  chipContext.lineTo(bx, by + drop);
  chipContext.lineTo(ax, ay + drop);
  chipContext.closePath();
  chipContext.fillStyle = surface.right[shade];
  chipContext.fill();

  chipContext.beginPath();
  chipContext.moveTo(ax, ay);
  chipContext.lineTo(dx, dy);
  chipContext.lineTo(dx, dy + drop);
  chipContext.lineTo(ax, ay + drop);
  chipContext.closePath();
  chipContext.fillStyle = surface.left[shade];
  chipContext.fill();

  chipContext.beginPath();
  chipContext.moveTo(ax, ay);
  chipContext.lineTo(bx, by);
  chipContext.lineTo(cx, cy);
  chipContext.lineTo(dx, dy);
  chipContext.closePath();
  chipContext.fillStyle = surface.top;
  chipContext.fill();

  if (!edge) return;
  chipContext.beginPath();
  chipContext.moveTo(dx, dy + drop);
  chipContext.lineTo(dx, dy);
  chipContext.lineTo(cx, cy);
  chipContext.lineTo(bx, by);
  chipContext.lineTo(bx, by + drop);
  chipContext.lineTo(ax, ay + drop);
  chipContext.closePath();
  chipContext.moveTo(dx, dy);
  chipContext.lineTo(ax, ay);
  chipContext.lineTo(bx, by);
  chipContext.moveTo(ax, ay);
  chipContext.lineTo(ax, ay + drop);
  chipContext.strokeStyle = edge;
  chipContext.lineWidth = 1;
  chipContext.stroke();
}

function drawGroundShadow() {
  chipContext.setTransform(pxx, pyx, pxy, pyy, originX, originY + GROUND_Z * pyz);
  chipContext.translate(0.35, -0.55);
  chipContext.fillStyle = groundShadow;
  chipContext.fillRect(-7.4, -7.4, 14.8, 14.8);
  chipContext.setTransform(1, 0, 0, 1, 0, 0);
}

function drawPins() {
  const edge = substrate.x0 + 0.05;
  chipContext.beginPath();
  for (let step = 0; step < 31; step += 1) {
    const along = -4.5 + step * 0.3;
    pinPath(edge, along);
    pinPath(along, edge);
  }
  chipContext.strokeStyle = STROKES.pins;
  chipContext.lineWidth = Math.max(1, pixelRatio * 0.75);
  chipContext.stroke();
}

function pinPath(x, y) {
  const pinX = snap(projectX(x, y));
  chipContext.moveTo(pinX, projectY(x, y, substrate.z0));
  chipContext.lineTo(pinX, projectY(x, y, substrate.z0 - PIN_DEPTH));
}

function drawSubstrateSurface() {
  for (let index = 0; index < substrateDotPoints.length; index += 2) {
    const x = substrateDotPoints[index];
    const y = substrateDotPoints[index + 1];
    drawGlyph(DOT, 1, projectX(x, y), projectY(x, y, 0));
  }

  // Pin-one dot in the back-left corner, drawn in the substrate plane.
  chipContext.setTransform(pxx, pyx, pxy, pyy, originX, originY);
  chipContext.beginPath();
  chipContext.arc(substrate.x0 + 0.34, substrate.y1 - 0.34, 0.06, 0, Math.PI * 2);
  chipContext.setTransform(1, 0, 0, 1, 0, 0);
  chipContext.fillStyle = STROKES.faint;
  chipContext.fill();
}

function drawCapacitors(capacitors) {
  for (const capacitor of capacitors) drawBox(capacitor, MATERIALS.capacitor, STROKES.faint);
}

function drawRoutes() {
  const z = interposer.z1;
  for (const route of routes) {
    const level = heatLevel(route.heat);
    chipContext.beginPath();
    for (let lane = 0; lane < 5; lane += 1) {
      const y = route.cy - 0.32 + lane * 0.16;
      chipContext.moveTo(projectX(route.x0, y), projectY(route.x0, y, z));
      chipContext.lineTo(projectX(route.x1, y), projectY(route.x1, y, z));
    }
    chipContext.globalAlpha = level ? 0.35 + (level / HEAT_LEVELS) * 0.65 : 1;
    chipContext.strokeStyle = level ? STROKES.hotRoutes : STROKES.routes;
    chipContext.lineWidth = Math.max(1, pixelRatio * 0.6);
    chipContext.stroke();
  }
  chipContext.globalAlpha = 1;
}

function fillUnits(parts, ramp, z) {
  // Idle parts share one path; lit parts are filled individually by level.
  chipContext.beginPath();
  for (const part of parts) {
    if (heatLevel(part.heat) === 0) quadPath(part.x0, part.y0, part.x1, part.y1, z);
  }
  chipContext.fillStyle = ramp[0];
  chipContext.fill();
  for (const part of parts) {
    const level = heatLevel(part.heat);
    if (level === 0) continue;
    chipContext.beginPath();
    quadPath(part.x0, part.y0, part.x1, part.y1, z);
    chipContext.fillStyle = ramp[level];
    chipContext.fill();
  }
}

function drawUnitGlyphs(part, ramp, columns, rows, idleTone, z, idleAlternate = -1) {
  const level = heatLevel(part.heat);
  const tone = level === 0 ? idleTone : HEAT_TONE + level;
  const stepX = (part.x1 - part.x0) / columns;
  const stepY = (part.y1 - part.y0) / rows;
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const x = part.x0 + (column + 0.5) * stepX;
      const y = part.y0 + (row + 0.5) * stepY;
      const alternate = level === 0 && idleAlternate >= 0 && (column + row) % 2 === 1;
      drawGlyph(alternate ? idleAlternate : ramp[level], tone, projectX(x, y), projectY(x, y, z));
    }
  }
}

function drawDieSurface() {
  const z = die.z1;
  fillUnits(tiles, FILLS.tile, z);
  fillUnits(cacheSlices, FILLS.cache, z);
  fillUnits(ports, FILLS.port, z);
  fillUnits(switches, FILLS.port, z);

  chipContext.beginPath();
  for (const gpc of gpcs) quadPath(gpc.x0, gpc.y0, gpc.x1, gpc.y1, z);
  quadPath(die.x0 + 0.05, die.y0 + 0.05, die.x1 - 0.05, die.y1 - 0.05, z);
  chipContext.strokeStyle = STROKES.structure;
  chipContext.lineWidth = 1;
  chipContext.stroke();

  for (const tile of tiles) drawUnitGlyphs(tile, COMPUTE_RAMP, glyphColumns, glyphColumns, 2, z, COLON);
  for (const slice of cacheSlices) drawUnitGlyphs(slice, CACHE_RAMP, 1, 1, 2, z);
  for (const port of ports) drawUnitGlyphs(port, SIGNAL_RAMP, 1, 3, 2, z);
  drawUnitGlyphs(crossbar, SWITCH_RAMP, 1, 1, 3, z);
}

function drawStack(stack) {
  drawBox(stack, MATERIALS.memory, STROKES.edge);
  const level = heatLevel(stack.heat);
  if (level) {
    chipContext.beginPath();
    quadPath(stack.x0, stack.y0, stack.x1, stack.y1, stack.z1);
    chipContext.fillStyle = FILLS.memory[level];
    chipContext.fill();
  }

  // DRAM strata on the two visible faces: a base die and a stack of layers.
  const layers = scale / pixelRatio >= 60 ? 4 : 2;
  chipContext.beginPath();
  for (let layer = 1; layer <= layers; layer += 1) {
    const z = stack.z0 + ((stack.z1 - stack.z0) * layer) / (layers + 1);
    chipContext.moveTo(projectX(stack.x0, stack.y1), projectY(stack.x0, stack.y1, z));
    chipContext.lineTo(projectX(stack.x0, stack.y0), projectY(stack.x0, stack.y0, z));
    chipContext.lineTo(projectX(stack.x1, stack.y0), projectY(stack.x1, stack.y0, z));
  }
  chipContext.strokeStyle = STROKES.faint;
  chipContext.lineWidth = 1;
  chipContext.stroke();

  const lattice = glyphColumns + 2;
  drawUnitGlyphs(stack, SIGNAL_RAMP, lattice, lattice, 1, stack.z1);
}

function updateHeat(now) {
  const lightOn = light.amount > 0.002;
  const inverseRadius = 1 / (LIGHT_RADIUS * LIGHT_RADIUS);
  for (const part of units) {
    let heat = 0;
    if (lightOn) {
      const dx = part.cx - light.x;
      const dy = part.cy - light.y;
      const falloff = 1 - (dx * dx + dy * dy) * inverseRadius;
      if (falloff > 0) heat = falloff * falloff * light.amount * LIGHT_PEAK;
    }

    // Clicks travel as mesh hops (Manhattan distance), then out through the
    // PHYs and interposer routes into the HBM stacks.
    for (const wave of waves) {
      if (!wave.active) continue;
      const front = ((now - wave.startedAt) / 1000) * WAVE_SPEED;
      const lead = Math.abs(part.portX - wave.x) + Math.abs(part.portY - wave.y) + part.delay - front;
      const pulse = lead > 0
        ? Math.max(0, 1 - lead / WAVE_EDGE) ** 2
        : Math.exp(lead / WAVE_TAIL);
      if (pulse > heat) heat = pulse;
    }
    part.heat = heat;
  }
}

function drawChip(now) {
  chipContext.setTransform(1, 0, 0, 1, 0, 0);
  chipContext.clearRect(0, 0, chipCanvas.width, chipCanvas.height);
  chipContext.lineJoin = "round";
  chipContext.lineCap = "round";
  updateHeat(now);

  drawGroundShadow();
  drawPins();
  drawBox(substrate, MATERIALS.substrate, STROKES.silhouette);
  drawSubstrateSurface();
  drawCapacitors(backCapacitors);
  drawBox(interposer, MATERIALS.interposer, STROKES.edge);
  drawRoutes();
  for (const part of raisedParts) {
    if (part === die) {
      drawBox(die, MATERIALS.die, STROKES.silhouette);
      drawDieSurface();
    } else {
      drawStack(part);
    }
  }
  drawCapacitors(frontCapacitors);
}

function easeToward(current, target, amount, epsilon) {
  const next = current + (target - current) * amount;
  return Math.abs(target - next) < epsilon ? target : next;
}

// Advances eased state; returns true while anything is still moving.
function stepChip(delta, now) {
  const cameraAmount = 1 - Math.exp(-delta / CAMERA_EASE);
  const lightAmount = 1 - Math.exp(-delta / LIGHT_EASE);
  stepMotion(delta);
  const targetX = pointer.inside ? (pointer.clientX / viewportWidth - 0.5) * 2 : motion.x;
  const targetY = pointer.inside ? (pointer.clientY / viewportHeight - 0.5) * 2 : motion.y;
  const clampedX = Math.max(-1, Math.min(1, targetX));
  const clampedY = Math.max(-1, Math.min(1, targetY));

  view.tiltX = easeToward(view.tiltX, clampedX, cameraAmount, 0.001);
  view.tiltY = easeToward(view.tiltY, clampedY, cameraAmount, 0.001);
  view.relight = easeToward(view.relight, clampedX, cameraAmount, 0.001);
  applyTilt();

  unproject(pointer.clientX * pixelRatio, pointer.clientY * pixelRatio, die.z1, lightTarget);
  if (light.amount < 0.01) {
    light.x = lightTarget.x;
    light.y = lightTarget.y;
  } else {
    light.x = easeToward(light.x, lightTarget.x, lightAmount, 0.001);
    light.y = easeToward(light.y, lightTarget.y, lightAmount, 0.001);
  }
  light.amount = easeToward(light.amount, pointer.inside ? 1 : 0, lightAmount, 0.003);

  let waving = false;
  for (const wave of waves) {
    if (!wave.active) continue;
    if (((now - wave.startedAt) / 1000) * WAVE_SPEED > WAVE_REACH + WAVE_TAIL * 6) wave.active = false;
    else waving = true;
  }

  return waving
    || motion.restX !== motion.rawX
    || motion.restY !== motion.rawY
    || view.tiltX !== clampedX
    || view.tiltY !== clampedY
    || view.relight !== clampedX
    || light.x !== lightTarget.x
    || light.y !== lightTarget.y
    || light.amount !== (pointer.inside ? 1 : 0);
}

// Frames run only while the pointer response or a wave is still moving.
function renderChipFrame(now) {
  frameRequest = 0;
  const delta = Math.min(0.05, Math.max(0, (now - lastTick) / 1000));
  lastTick = now;
  const moving = stepChip(delta, now);
  drawChip(now);
  if (moving) frameRequest = requestAnimationFrame(renderChipFrame);
}

function requestChipFrame() {
  if (frameRequest) return;
  lastTick = performance.now();
  frameRequest = requestAnimationFrame(renderChipFrame);
}

function startWave(clientX, clientY) {
  applyTilt();
  const origin = unproject(clientX * pixelRatio, clientY * pixelRatio, die.z1, waveOrigin);
  const wave = waves[nextWave];
  nextWave = (nextWave + 1) % waves.length;
  wave.x = Math.max(die.x0, Math.min(die.x1, origin.x));
  wave.y = Math.max(die.y0, Math.min(die.y1, origin.y));
  wave.startedAt = performance.now();
  wave.active = true;
}

function releasePointer() {
  pointer.inside = false;
  requestChipFrame();
}

window.addEventListener("pointermove", (event) => {
  pointer.clientX = event.clientX;
  pointer.clientY = event.clientY;
  pointer.inside = true;
  requestChipFrame();
}, { passive: true });

window.addEventListener("pointerdown", (event) => {
  pointer.clientX = event.clientX;
  pointer.clientY = event.clientY;
  pointer.inside = true;
  startWave(event.clientX, event.clientY);
  requestChipFrame();
}, { passive: true });

for (const type of ["pointerup", "pointercancel"]) {
  window.addEventListener(type, (event) => {
    if (event.pointerType !== "mouse") releasePointer();
  }, { passive: true });
}

document.addEventListener("pointerout", (event) => {
  if (!event.relatedTarget) releasePointer();
});
window.addEventListener("blur", releasePointer);

function wrapDegrees(angle) {
  return ((((angle + 180) % 360) + 360) % 360) - 180;
}

// Device orientation mapped to the screen's current rotation: x rolls the
// right edge down, y tips the top edge up. Tilt is measured from a resting
// angle that slowly follows the phone.
function readOrientation(event) {
  if (event.beta === null || event.gamma === null) return;
  const rotation = screen.orientation?.angle ?? window.orientation ?? 0;
  let x = event.gamma;
  let y = event.beta;
  switch (((Math.round(rotation / 90) % 4) + 4) % 4) {
    case 1:
      x = event.beta;
      y = -event.gamma;
      break;
    case 2:
      x = -event.gamma;
      y = -event.beta;
      break;
    case 3:
      x = -event.beta;
      y = event.gamma;
      break;
  }

  if (motion.ready) {
    const stepX = wrapDegrees(x - motion.rawX);
    const stepY = wrapDegrees(y - motion.rawY);
    // Ignore sensor jitter so a phone lying still lets the chip come to rest.
    if (Math.abs(stepX) + Math.abs(stepY) < 0.15) return;
    // Near upright the angles can flip; start again from the new reading.
    if (Math.abs(stepX) > 45 || Math.abs(stepY) > 45) motion.ready = false;
  }
  if (!motion.ready) {
    motion.restX = x;
    motion.restY = y;
    motion.ready = true;
  }
  motion.rawX = x;
  motion.rawY = y;
  requestChipFrame();
}

function easeAngle(current, target, amount) {
  const difference = wrapDegrees(target - current);
  return Math.abs(difference) < 0.05 ? target : current + difference * amount;
}

// Tilt is the phone's movement away from its resting angle, which follows the
// phone over MOTION_RECENTER seconds; this runs per frame so it settles even
// when the sensor goes quiet.
function stepMotion(delta) {
  if (!motion.ready) return;
  const follow = 1 - Math.exp(-delta / MOTION_RECENTER);
  motion.restX = easeAngle(motion.restX, motion.rawX, follow);
  motion.restY = easeAngle(motion.restY, motion.rawY, follow);
  motion.x = Math.max(-1, Math.min(1, wrapDegrees(motion.rawX - motion.restX) / MOTION_RANGE));
  motion.y = Math.max(-1, Math.min(1, wrapDegrees(motion.rawY - motion.restY) / MOTION_RANGE));
}

function resetOrientation() {
  motion.ready = false;
  motion.x = 0;
  motion.y = 0;
  requestChipFrame();
}

function listenForOrientation() {
  window.addEventListener("deviceorientation", readOrientation);
  window.addEventListener("orientationchange", resetOrientation);
}

// iOS only allows motion access after the visitor taps, so the first tap on
// the page (outside links) asks for it.
function askForMotionOnTap() {
  let asking = false;
  const askForMotion = (event) => {
    if (asking || event.target.closest?.("a")) return;
    asking = true;
    DeviceOrientationEvent.requestPermission()
      .then((state) => {
        window.removeEventListener("touchend", askForMotion);
        window.removeEventListener("click", askForMotion);
        if (state === "granted") listenForOrientation();
      })
      .catch(() => {
        asking = false;
      });
  };
  window.addEventListener("touchend", askForMotion, { passive: true });
  window.addEventListener("click", askForMotion);
}

// Listening is harmless where access has not been granted yet: no events arrive.
if (window.DeviceOrientationEvent) listenForOrientation();
if (typeof window.DeviceOrientationEvent?.requestPermission === "function" && navigator.maxTouchPoints > 0) {
  askForMotionOnTap();
}

window.addEventListener("resize", () => {
  resizeChipCanvas();
  requestChipFrame();
});

resizeChipCanvas();
requestChipFrame();
document.fonts?.load('500 16px "Geist Mono"').then(() => {
  resizeChipCanvas();
  requestChipFrame();
});
