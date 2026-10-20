// Contribution data lives in contributions.json, refreshed daily by the
// update-contributions workflow from GitHub's contribution calendar.
const graph = document.querySelector("#graph");
const monthRow = document.querySelector(".months");
const contributionSummary = document.querySelector("#contribution-summary");
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });

function renderContributions({ total, days }) {
  const weeks = Math.ceil(days.length / 7);
  graph.parentElement.style.setProperty("--weeks", weeks);
  contributionSummary.textContent = `${total.toLocaleString("en-US")} contributions in the last three months`;

  const cells = days.map(([isoDate, count, level]) => {
    const cell = document.createElement("span");
    const label = `${count} contribution${count === 1 ? "" : "s"} on ${dateFormatter.format(new Date(`${isoDate}T00:00:00Z`))}`;
    cell.className = "day";
    cell.dataset.level = level;
    cell.title = label;
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("aria-label", label);
    return cell;
  });
  graph.replaceChildren(...cells);

  // A month label sits over the first week that starts in that month, skipping
  // one that would crowd the next label.
  const labels = [];
  let previousMonth = -1;
  for (let week = 0; week < weeks; week++) {
    const date = new Date(`${days[week * 7][0]}T00:00:00Z`);
    if (date.getUTCMonth() !== previousMonth) labels.push({ week, date });
    previousMonth = date.getUTCMonth();
  }
  if (labels.length > 1 && labels[1].week - labels[0].week < 3) labels.shift();
  monthRow.replaceChildren(...labels.map(({ week, date }, index) => {
    const span = document.createElement("span");
    const next = labels[index + 1]?.week ?? weeks;
    span.textContent = monthFormatter.format(date);
    span.style.gridColumn = `${week + 1} / ${next + 1}`;
    return span;
  }));

  // The card changed size, so the background re-measures what it should dim.
  window.dispatchEvent(new Event("resize"));
}

fetch("contributions.json", { cache: "no-cache" })
  .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
  .then(renderContributions)
  .catch(() => {
    contributionSummary.textContent = "Contribution activity over the last three months";
  });

// ASCII exoplanet: a red star flaring over the cratered limb of a planet, drawn
// as a fine character grid where every glyph is redrawn each frame. Per-cell
// inputs (surface normals, terrain, ray membership, starlight) are computed once
// per resize; each frame the CPU re-lights every cell into a byte per cell, and
// one WebGL shader stamps all the glyphs at once from a pre-tinted glyph sheet.
const space = document.querySelector("#space");
const gl = space.getContext("webgl", { alpha: false, antialias: false });
const glyphSheet = document.createElement("canvas");
const calmTargets = [".intro h1", ".intro p", ".contributions", ".socials"].map((selector) => document.querySelector(selector));

// Glyphs from empty to dense; a cell's brightness picks its glyph and colour.
const RAMP = " .,:;-=+*x%#@";
const LEVELS = 64;
// Brightness → colour, from deep space red through orange to white-hot.
const PALETTE = [
  [0, 8, 2, 1],
  [0.2, 74, 20, 7],
  [0.45, 176, 64, 22],
  [0.7, 242, 134, 62],
  [0.88, 255, 204, 146],
  [1, 255, 246, 228],
];
const MARGIN = 18;
const RAY_COUNT = 12;
const SKY = 1;
const GROUND = 2;

let viewWidth = 0;
let viewHeight = 0;
let pixelRatio = 1;
let cellW = 4;
let cellH = 6;
let cellPxW = 8;
let cellPxH = 12;
let cols = 0;
let rows = 0;
let sun = { x: 0, y: 0, r: 1 };
let hole = { x: 0, y: 0, r: 1 };
let planet = { x: 0, y: 0, r: 1 };
let skyLevels = new Uint8Array(0);
let groundLevels = new Uint8Array(0);
let gpu = null;
let renderTimer = 0;
let lastFrame = 0;
const parallax = { x: 0, y: 0, targetX: 0, targetY: 0 };
const meteors = [];
// Stars slowly drawn into the black hole, spiralling in and stretching out.
const infall = Array.from({ length: 34 }, () => spawnInfall({}, true));

function spawnInfall(star, scattered) {
  star.radius = 6 + Math.random() * 9;
  star.angle = Math.random() * Math.PI * 2;
  star.age = scattered ? Math.random() * 40 : 0;
  star.brightness = 0.45 + Math.random() * 0.5;
  // Spread the starting radius when the page loads, so they are not in sync.
  if (scattered) star.radius = 2 + Math.random() * 13;
  return star;
}

// Per-cell scene data.
let kind = new Uint8Array(0);
let calm = new Float32Array(0);
let skyBase = new Float32Array(0);
// Black hole cells: 1 horizon, 2 accretion disk or lensed arc (rotates), 3 photon ring.
let holeKind = new Uint8Array(0);
let holeAngle = new Float32Array(0);
let holeRadius = new Float32Array(0);
let rayId = new Int8Array(0);
let rayLight = new Float32Array(0);
let twinkle = new Float32Array(0);
let normalX = new Float32Array(0);
let normalY = new Float32Array(0);
let normalZ = new Float32Array(0);
let terrain = new Float32Array(0);
let falloff = new Float32Array(0);
let rimGlow = new Float32Array(0);
let cellX = new Float32Array(0);
let cellY = new Float32Array(0);
const rayPulse = new Float32Array(RAY_COUNT);

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

function hash(a, b, c) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = (x - xi) * (x - xi) * (3 - 2 * (x - xi));
  const v = (y - yi) * (y - yi) * (3 - 2 * (y - yi));
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, seed) {
  let sum = 0;
  let amplitude = 0.5;
  for (let octave = 0; octave < 5; octave++) {
    sum += amplitude * noise(x, y, seed + octave);
    x *= 2.03;
    y *= 2.03;
    amplitude *= 0.5;
  }
  return sum / 0.97;
}

function circleThrough(ax, ay, bx, by, cx, cy) {
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  return { x: ux, y: uy, r: Math.hypot(ax - ux, ay - uy) };
}

// Composition: the star sits beside the text column, the planet rises from the
// lower left (landscape) or across the bottom (portrait).
function composeScene() {
  const W = viewWidth;
  const H = viewHeight;
  if (W >= H * 1.1) {
    sun = { x: W * 0.74, y: H * 0.27, r: Math.min(W, H) * 0.045 };
    hole = { x: W * 0.16, y: H * 0.17, r: Math.min(W, H) * 0.034 };
    planet = circleThrough(-W * 0.02, H * 0.44, W * 0.27, H * 0.64, W * 0.56, H * 1.06);
  } else {
    sun = { x: W * 0.72, y: H * 0.075, r: W * 0.055 };
    hole = { x: W * 0.22, y: H * 0.085, r: W * 0.052 };
    planet = circleThrough(-W * 0.05, H * 0.72, W * 0.45, H * 0.8, W * 1.05, H * 1.02);
  }
}

// Rays: a fixed fan of spikes with their own lengths, like a camera's flare.
const RAYS = Array.from({ length: RAY_COUNT }, (_, k) => ({
  angle: (k / RAY_COUNT) * Math.PI * 2 + (hash(k, 3, 5) - 0.5) * 0.4,
  length: 5 + hash(k, 7, 5) * 12,
  strength: 0.25 + hash(k, 11, 5) * 0.35,
  speed: 0.6 + hash(k, 13, 5) * 1.4,
}));

// The black hole's disk is tilted toward us: in disk coordinates a point sits
// at radius rho (in horizon radii) and angle phi, seen squashed by DISK_SQUASH.
const DISK_TILT = -0.32;
const DISK_SQUASH = 0.21;
const DISK_INNER = 1.5;
const DISK_OUTER = 4.2;
// The shadow: a ring of empty sky around the horizon where no starlight escapes.
const SHADOW = 2.7;

// Classifies one sky cell against the black hole; returns true when it is part
// of the hole (horizon, ring, disk, lensed arcs, shadow) and fully described here.
function describeHole(i, x, y) {
  const dx = (x - hole.x) / hole.r;
  const dy = (y - hole.y) / hole.r;
  const d = Math.hypot(dx, dy);
  holeKind[i] = 0;
  if (d > DISK_OUTER + 0.5) return false;
  const ax = dx * Math.cos(DISK_TILT) + dy * Math.sin(DISK_TILT);
  const ay = -dx * Math.sin(DISK_TILT) + dy * Math.cos(DISK_TILT);
  const rho = Math.hypot(ax, ay / DISK_SQUASH);
  const onDisk = rho >= DISK_INNER && rho <= DISK_OUTER;
  // Doppler beaming: the side swinging toward us (left) is brighter.
  const beaming = 0.75 - 0.25 * (ax / Math.max(rho, 0.001));
  // White-hot at the inner edge, fading quickly to dim orange gas.
  const diskLight = (0.3 + 1.2 * Math.exp(-(rho - DISK_INNER) / 1.1)) * beaming;
  holeAngle[i] = Math.atan2(ay / DISK_SQUASH, ax);
  holeRadius[i] = rho;
  if (onDisk && ay >= 0) {
    // Near half of the disk, passing in front of the horizon.
    holeKind[i] = 2;
    skyBase[i] = diskLight;
    return true;
  }
  if (d < 1) {
    holeKind[i] = 1;
    skyBase[i] = 0;
    return true;
  }
  if (Math.abs(d - 1.06) < 0.05) {
    // The photon ring: a fine bright line, not an outline.
    holeKind[i] = 3;
    holeAngle[i] = Math.atan2(dy, dx);
    skyBase[i] = 0.8;
    return true;
  }
  // Lensed images of the far disk: a bold band wrapping over the top of the
  // horizon and a thinner, fainter one tucked under the bottom.
  const above = ay < 0;
  const bandOuter = above ? 2.35 : 1.55;
  if (d > 1.1 && d < bandOuter) {
    const width = above ? 0.6 : 0.22;
    const peak = above ? 1.6 : 0.95;
    holeKind[i] = 2;
    holeAngle[i] = Math.atan2(dy, dx) * 2;
    holeRadius[i] = 1.6 + (d - 1.1);
    skyBase[i] = peak * Math.exp(-(d - 1.18) / width) * (0.75 - 0.25 * (dx / d));
    return true;
  }
  if (onDisk) {
    // Far half of the disk, behind the horizon.
    holeKind[i] = 2;
    skyBase[i] = diskLight * 0.9;
    return true;
  }
  if (d < SHADOW) {
    holeKind[i] = 1;
    skyBase[i] = 0;
    return true;
  }
  return false;
}

// Static sky light for one cell; the strongest ray is stored separately so it can pulse.
function describeSky(i, x, y, c, r) {
  if (describeHole(i, x, y)) {
    rayId[i] = -1;
    rayLight[i] = 0;
    twinkle[i] = 0;
    return;
  }
  const dx = x - sun.x;
  const dy = y - sun.y;
  const d = Math.hypot(dx, dy) / sun.r;
  rayId[i] = -1;
  rayLight[i] = 0;
  if (d <= 1) {
    skyBase[i] = 1;
    return;
  }
  let lum = Math.exp(-(d - 1) * 2.2) * 0.55 + 0.12 / (d * d);
  const angle = Math.atan2(dy, dx);
  for (let k = 0; k < RAY_COUNT; k++) {
    const ray = RAYS[k];
    const spread = Math.cos(angle - ray.angle);
    if (spread < 0.995) continue;
    const light = Math.pow(spread, 3000) * ray.strength * Math.exp(-(d - 1) / ray.length);
    if (light > rayLight[i]) {
      rayLight[i] = light;
      rayId[i] = k;
    }
  }
  lum += Math.exp(-Math.abs(dy) / (sun.r * 0.12)) * Math.exp(-Math.abs(dx) / (viewWidth * 0.45)) * 0.45;
  for (let k = 0; k < 5; k++) {
    const px = sun.x + sun.r * (2.2 + k * 1.9 + hash(k, 1, 9) * 0.8);
    const py = sun.y + sun.r * (0.55 + k * 0.33);
    const pd = Math.hypot(x - px, y - py);
    if (pd < cellW * 1.6) lum += 0.75 * (1 - pd / (cellW * 1.6));
  }
  const loner = Math.hypot(x - viewWidth * 0.09, y - viewHeight * 0.33);
  if (loner < cellW * 1.6) lum += 0.7 * (1 - loner / (cellW * 1.6));
  // Starlight near the black hole is lensed: each cell shows the star that
  // sits closer to the hole, as if bent around it, plus a faint warm haze.
  let starC = c;
  let starR = r;
  const hx = x - hole.x;
  const hy = y - hole.y;
  const hd = Math.hypot(hx, hy);
  if (hd < hole.r * 10) {
    const einstein = (hole.r * 2.3) ** 2;
    const source = hd - einstein / hd;
    const sx = hole.x + (hx / hd) * source;
    const sy = hole.y + (hy / hd) * source;
    starC = Math.floor(((sx + MARGIN) * pixelRatio) / cellPxW);
    starR = Math.floor(((sy + MARGIN) * pixelRatio) / cellPxH);
    lum += 0.08 * Math.exp(-(hd / hole.r - SHADOW) / 1.6);
  }
  const star = hash(starC, starR, 17);
  twinkle[i] = 0;
  if (star > 0.9965) {
    lum = Math.max(lum, 0.35 + (star - 0.9965) * 170);
    twinkle[i] = 1 + hash(starC, starR, 29) * 6;
  }
  skyBase[i] = Math.min(lum, 1);
}

// Static surface description for one planet cell; lighting happens per frame.
function describeGround(i, x, y) {
  const dx = x - planet.x;
  const dy = y - planet.y;
  const dist = Math.hypot(dx, dy);
  if (dist > planet.r) {
    // Atmosphere just outside the limb: store its outward normal and distance.
    normalX[i] = dx / dist;
    normalY[i] = dy / dist;
    normalZ[i] = 0;
    falloff[i] = 0;
    rimGlow[i] = Math.exp(-(dist - planet.r) / 7) * 0.75;
    terrain[i] = 0;
    return;
  }
  const nx = dx / planet.r;
  const ny = dy / planet.r;
  normalX[i] = nx;
  normalY[i] = ny;
  normalZ[i] = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  const depth = planet.r - dist;
  const along = Math.atan2(dy, dx) * planet.r;
  const u = along / 46;
  const v = Math.pow(depth, 0.8) / 16;
  const ground = fbm(u, v, 3);
  const ridges = 1 - Math.abs(fbm(u * 1.7 + 4, v * 1.7, 11) * 2 - 1);
  const craters = Math.max(0, 0.62 - noise(u * 0.55, v * 0.55, 23)) * 1.6;
  terrain[i] = clamp(0.2 + 0.9 * ground + 0.4 * ridges * ridges - 0.6 * craters, 0, 1.3);
  falloff[i] = 0.3 + 0.7 * Math.exp(-depth / (planet.r * 0.38));
  rimGlow[i] = Math.exp(-depth / 5) * 0.6;
}

function calmAt(x, y, rects) {
  let distance = Infinity;
  for (const rect of rects) {
    const dx = Math.max(rect.left - 8 - x, 0, x - rect.right - 8);
    const dy = Math.max(rect.top - 8 - y, 0, y - rect.bottom - 8);
    distance = Math.min(distance, Math.hypot(dx, dy));
  }
  return 0.38 + 0.62 * clamp(distance / 32, 0, 1);
}

// One pre-tinted glyph per brightness level, so each cell is a single blit.
function buildGlyphSheet() {
  glyphSheet.width = cellPxW * LEVELS;
  glyphSheet.height = cellPxH;
  const g = glyphSheet.getContext("2d");
  g.font = `500 ${Math.round(cellPxH * 0.92)}px "Geist Mono", ui-monospace, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let level = 1; level < LEVELS; level++) {
    const lum = level / (LEVELS - 1);
    const glyph = RAMP[Math.round(Math.pow(lum, 0.8) * (RAMP.length - 1))];
    if (glyph === " ") continue;
    let k = 1;
    while (k < PALETTE.length - 1 && lum > PALETTE[k][0]) k++;
    const [t0, r0, g0, b0] = PALETTE[k - 1];
    const [t1, r1, g1, b1] = PALETTE[k];
    const f = clamp((lum - t0) / (t1 - t0), 0, 1);
    g.fillStyle = `rgb(${Math.round(r0 + (r1 - r0) * f)}, ${Math.round(g0 + (g1 - g0) * f)}, ${Math.round(b0 + (b1 - b0) * f)})`;
    g.fillText(glyph, (level + 0.5) * cellPxW, cellPxH / 2 + 0.5);
  }
}

function buildScene() {
  viewWidth = window.innerWidth;
  viewHeight = window.innerHeight;
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  cellW = clamp(Math.round(viewWidth / 360), 3, 5);
  cellH = Math.round(cellW * 1.5);
  cellPxW = Math.max(1, Math.round(cellW * pixelRatio));
  cellPxH = Math.max(1, Math.round(cellH * pixelRatio));
  space.width = Math.round(viewWidth * pixelRatio);
  space.height = Math.round(viewHeight * pixelRatio);
  // The grid overhangs the screen so parallax never exposes an edge.
  cols = Math.ceil(((viewWidth + MARGIN * 2) * pixelRatio) / cellPxW);
  rows = Math.ceil(((viewHeight + MARGIN * 2) * pixelRatio) / cellPxH);
  composeScene();
  buildGlyphSheet();

  const cells = cols * rows;
  kind = new Uint8Array(cells);
  calm = new Float32Array(cells);
  skyBase = new Float32Array(cells);
  holeKind = new Uint8Array(cells);
  holeAngle = new Float32Array(cells);
  holeRadius = new Float32Array(cells);
  rayId = new Int8Array(cells);
  rayLight = new Float32Array(cells);
  twinkle = new Float32Array(cells);
  normalX = new Float32Array(cells);
  normalY = new Float32Array(cells);
  normalZ = new Float32Array(cells);
  terrain = new Float32Array(cells);
  falloff = new Float32Array(cells);
  rimGlow = new Float32Array(cells);
  cellX = new Float32Array(cells);
  cellY = new Float32Array(cells);

  const rects = calmTargets.map((element) => element.getBoundingClientRect());
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = ((c + 0.5) * cellPxW) / pixelRatio - MARGIN;
      const y = ((r + 0.5) * cellPxH) / pixelRatio - MARGIN;
      cellX[i] = x;
      cellY[i] = y;
      calm[i] = calmAt(x, y, rects);
      const dist = Math.hypot(x - planet.x, y - planet.y);
      if (dist <= planet.r + 30) {
        kind[i] = GROUND;
        describeGround(i, x, y);
      }
      if (dist > planet.r) {
        kind[i] |= SKY;
        describeSky(i, x, y, c, r);
      }
    }
  }

  skyLevels = new Uint8Array(cells);
  groundLevels = new Uint8Array(cells);
  if (gpu) uploadGlyphSheet();
  else drawStaticFrame();
}

// Re-lights every cell for time t into skyLevels / groundLevels (one byte each).
function lightCells(t, dt) {
  for (let k = 0; k < RAY_COUNT; k++) {
    rayPulse[k] = 0.65 + 0.35 * Math.sin(t * RAYS[k].speed + k * 1.7) + 0.15 * Math.sin(t * 7.3 + k);
  }
  const flicker = 0.94 + 0.04 * Math.sin(t * 2.1) + 0.02 * Math.sin(t * 9.7);
  // The transiting planet, crossing the face of the star every 50 s.
  const transitX = sun.x + sun.r * (-1.5 + ((t / 50) % 1) * 3);
  const transitY = sun.y - sun.r * 0.32;
  const transitR2 = (sun.r * 0.14) ** 2;
  // The light swings slightly with the pointer, re-lighting the whole surface.
  let lightX = sun.x - planet.x + parallax.x * planet.r * 0.08;
  let lightY = sun.y - planet.y + parallax.y * planet.r * 0.05;
  const lightLength = Math.hypot(lightX, lightY);
  lightX /= lightLength;
  lightY /= lightLength;
  const lightZ = -0.25;
  const lightNorm = Math.hypot(lightX, lightY, lightZ);
  const glint = t * 0.6;
  const top = LEVELS - 1;
  const cells = cols * rows;

  for (let i = 0; i < cells; i++) {
    let skyLevel = 0;
    if (kind[i] & SKY) {
      let lum = skyBase[i];
      if (holeKind[i] === 2) {
        // Keplerian swirl: inner material laps the outer, streaks drift round.
        const spin = t * (2.4 / Math.pow(holeRadius[i], 1.5));
        lum *= 0.8 + 0.2 * Math.sin(holeAngle[i] * 4 + holeRadius[i] * 2.5 - spin * 4);
      } else if (holeKind[i] === 3) {
        lum = skyBase[i] * (0.85 + 0.15 * Math.sin(t * 3 + holeAngle[i] * 3));
      } else if (holeKind[i] === 1) {
        lum = 0;
      } else if (lum >= 1) {
        const tx = cellX[i] - transitX;
        const ty = cellY[i] - transitY;
        lum = tx * tx + ty * ty < transitR2 ? 0 : flicker;
      } else {
        const ray = rayId[i];
        if (ray >= 0) lum += rayLight[i] * rayPulse[ray];
        if (twinkle[i]) lum *= 0.55 + 0.45 * Math.sin(t * 1.7 + twinkle[i]);
      }
      skyLevel = (Math.min(1, lum * calm[i]) * top + 0.5) | 0;
    }
    skyLevels[i] = skyLevel;

    let groundLevel = 0;
    if (kind[i] & GROUND) {
      const facing = (normalX[i] * lightX + normalY[i] * lightY + normalZ[i] * lightZ) / lightNorm;
      let lum;
      if (falloff[i] === 0) {
        lum = rimGlow[i] * (0.25 + 0.75 * Math.max(0, normalX[i] * lightX + normalY[i] * lightY));
      } else {
        const lit = facing > 0 ? Math.pow(facing, 1.1) : 0;
        // Slow glints drift over the high ground.
        const sparkle = terrain[i] > 1 ? 0.12 * Math.max(0, Math.sin(glint + cellX[i] * 0.05 + cellY[i] * 0.03)) : 0;
        lum = 0.04 + 1.05 * lit * falloff[i] * (terrain[i] + sparkle) + rimGlow[i] * (0.3 + 0.7 * Math.max(0, facing));
      }
      groundLevel = (Math.min(1, lum * calm[i]) * top + 0.5) | 0;
    }
    groundLevels[i] = groundLevel;
  }

  // Infalling stars: slow far out, faster and flatter as they near the disk,
  // stretched into a short streak along their path at the end.
  for (const star of infall) {
    star.age += dt;
    const rr = star.radius;
    star.radius -= dt * (0.06 + 0.9 / Math.pow(rr, 1.6));
    star.angle += dt * (0.12 + 1.6 / Math.pow(rr, 1.5));
    if (star.radius < 1.25) {
      spawnInfall(star, false);
      continue;
    }
    const flatten = 1 - 0.75 * clamp((6 - rr) / 5, 0, 1);
    const fadeIn = Math.min(1, star.age / 3);
    const lum = star.brightness * fadeIn * (0.7 + 0.3 * clamp((4 - rr) / 3, 0, 1));
    const tail = rr < 3.2 ? 3 : 1;
    for (let k = 0; k < tail; k++) {
      const angle = star.angle - k * 0.08;
      const px = Math.cos(angle) * star.radius;
      const py = Math.sin(angle) * star.radius * flatten;
      const x = hole.x + (px * Math.cos(DISK_TILT) - py * Math.sin(DISK_TILT)) * hole.r;
      const y = hole.y + (px * Math.sin(DISK_TILT) + py * Math.cos(DISK_TILT)) * hole.r;
      const c = Math.floor(((x + MARGIN) * pixelRatio) / cellPxW);
      const r = Math.floor(((y + MARGIN) * pixelRatio) / cellPxH);
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const i = r * cols + c;
      if (holeKind[i] === 1 && (y - hole.y) ** 2 + (x - hole.x) ** 2 < hole.r * hole.r) continue;
      skyLevels[i] = Math.max(skyLevels[i], (lum * (1 - k * 0.3) * calm[i] * top) | 0);
    }
  }

  // Meteors launched by clicks: a bright head and a fading tail of cells.
  for (let k = meteors.length - 1; k >= 0; k--) {
    const meteor = meteors[k];
    meteor.age += dt;
    if (meteor.age > 1.2) {
      meteors.splice(k, 1);
      continue;
    }
    for (let s = 0; s < 60; s++) {
      const age = meteor.age - s * 0.004;
      if (age < 0) break;
      const fade = (1 - s / 60) * (1 - meteor.age / 1.2);
      const x = meteor.x + meteor.vx * age + parallax.x * 4 + MARGIN;
      const y = meteor.y + meteor.vy * age + parallax.y * 3 + MARGIN;
      const c = Math.floor((x * pixelRatio) / cellPxW);
      const r = Math.floor((y * pixelRatio) / cellPxH);
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const i = r * cols + c;
      skyLevels[i] = Math.max(skyLevels[i], (fade * top) | 0);
    }
  }
}

// ── WebGL: one full-screen shader draws every glyph ───────────────────────

const VERTEX_SHADER = `
attribute vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }`;

const FRAGMENT_SHADER = `
precision highp float;
uniform sampler2D skyCells;
uniform sampler2D groundCells;
uniform sampler2D glyphs;
uniform vec2 grid;
uniform vec2 cell;
uniform vec2 skyOrigin;
uniform vec2 groundOrigin;
uniform vec3 planet;
uniform vec3 sun;
uniform float height;
uniform float levels;

vec4 glyphAt(vec2 p, vec2 origin, sampler2D cells, out float level) {
  vec2 g = (p - origin) / cell;
  vec2 index = floor(g);
  level = floor(texture2D(cells, (index + 0.5) / grid).r * 255.0 + 0.5);
  vec2 local = g - index;
  return texture2D(glyphs, vec2((level + local.x) / levels, local.y));
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, height - gl_FragCoord.y);
  float d = distance(p, sun.xy) / sun.z;
  // Soft bloom around the star, under the glyphs.
  vec3 color = vec3(1.0, 0.55, 0.24) * 0.3 * exp(-d / 2.6) + vec3(1.0, 0.84, 0.63) * 0.45 * exp(-d / 0.55);
  float skyLevel;
  float groundLevel;
  vec4 skyGlyph = glyphAt(p, skyOrigin, skyCells, skyLevel);
  vec4 groundGlyph = glyphAt(p, groundOrigin, groundCells, groundLevel);
  if (distance(p, planet.xy) < planet.z) {
    color = mix(vec3(0.0), groundGlyph.rgb, groundGlyph.a);
  } else {
    vec4 glyph = groundLevel > skyLevel ? groundGlyph : skyGlyph;
    color = mix(color, glyph.rgb, glyph.a);
  }
  gl_FragColor = vec4(color, 1.0);
}`;

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

function makeTexture() {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function setupGpu() {
  if (!gl) return null;
  try {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const corner = gl.getAttribLocation(program, "corner");
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const uniforms = {};
    for (const name of ["skyCells", "groundCells", "glyphs", "grid", "cell", "skyOrigin", "groundOrigin", "planet", "sun", "height", "levels"]) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    const textures = { sky: makeTexture(), ground: makeTexture(), glyphs: makeTexture() };
    gl.uniform1i(uniforms.skyCells, 0);
    gl.uniform1i(uniforms.groundCells, 1);
    gl.uniform1i(uniforms.glyphs, 2);
    return { uniforms, textures };
  } catch {
    return null;
  }
}

function uploadGlyphSheet() {
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, gpu.textures.glyphs);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, glyphSheet);
  for (const [unit, texture, data] of [[0, gpu.textures.sky, skyLevels], [1, gpu.textures.ground, groundLevels]]) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, cols, rows, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, data);
  }
}

function drawFrame(now) {
  requestAnimationFrame(drawFrame);
  const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
  lastFrame = now;
  parallax.x += (parallax.targetX - parallax.x) * Math.min(1, dt * 5);
  parallax.y += (parallax.targetY - parallax.y) * Math.min(1, dt * 5);
  lightCells(now / 1000, dt);

  const ratio = pixelRatio;
  const skyX = -parallax.x * 4;
  const skyY = -parallax.y * 3;
  const groundX = -parallax.x * 14;
  const groundY = -parallax.y * 10;
  const u = gpu.uniforms;
  gl.viewport(0, 0, space.width, space.height);
  for (const [unit, texture, data] of [[0, gpu.textures.sky, skyLevels], [1, gpu.textures.ground, groundLevels]]) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.LUMINANCE, gl.UNSIGNED_BYTE, data);
  }
  gl.uniform2f(u.grid, cols, rows);
  gl.uniform2f(u.cell, cellPxW, cellPxH);
  gl.uniform2f(u.skyOrigin, Math.round((skyX - MARGIN) * ratio), Math.round((skyY - MARGIN) * ratio));
  gl.uniform2f(u.groundOrigin, Math.round((groundX - MARGIN) * ratio), Math.round((groundY - MARGIN) * ratio));
  gl.uniform3f(u.planet, (planet.x + groundX) * ratio, (planet.y + groundY) * ratio, planet.r * ratio);
  gl.uniform3f(u.sun, (sun.x + skyX) * ratio, (sun.y + skyY) * ratio, sun.r * ratio);
  gl.uniform1f(u.height, space.height);
  gl.uniform1f(u.levels, LEVELS);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// Without WebGL, one still frame is drawn on a 2D canvas instead.
function drawStaticFrame() {
  const g = space.getContext("2d");
  if (!g) return;
  lightCells(0, 0);
  g.fillStyle = "#000";
  g.fillRect(0, 0, space.width, space.height);
  const ox = -MARGIN * pixelRatio;
  for (let i = 0; i < cols * rows; i++) {
    const level = Math.max(skyLevels[i], groundLevels[i]);
    if (level < 2) continue;
    g.drawImage(glyphSheet, level * cellPxW, 0, cellPxW, cellPxH,
      ox + (i % cols) * cellPxW, ox + ((i / cols) | 0) * cellPxH, cellPxW, cellPxH);
  }
}

function scheduleBuild() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(buildScene, 150);
}

function aim(x, y) {
  parallax.targetX = clamp((x / viewWidth - 0.5) * 2, -1, 1);
  parallax.targetY = clamp((y / viewHeight - 0.5) * 2, -1, 1);
}

window.addEventListener("pointermove", (event) => aim(event.clientX, event.clientY), { passive: true });
window.addEventListener("pointerdown", (event) => {
  aim(event.clientX, event.clientY);
  // A shooting star streaks away from the click, down toward the planet.
  const speed = Math.max(viewWidth, viewHeight) * 0.65;
  const angle = Math.PI * 0.82 + (Math.random() - 0.5) * 0.4;
  meteors.push({ x: event.clientX, y: event.clientY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, age: 0 });
}, { passive: true });
window.addEventListener("touchmove", (event) => {
  const touch = event.touches[0];
  if (touch) aim(touch.clientX, touch.clientY);
}, { passive: true });
document.addEventListener("pointerout", (event) => {
  if (!event.relatedTarget) aim(viewWidth / 2, viewHeight / 2);
});
window.addEventListener("resize", scheduleBuild);
document.fonts?.ready.then(buildScene);

gpu = setupGpu();
buildScene();
if (gpu) requestAnimationFrame(drawFrame);
