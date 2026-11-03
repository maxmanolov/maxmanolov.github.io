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

// ASCII universe in 3D: a star with its planets, a black hole, a moon and the
// limb of an Earth-like planet, drawn as a fine character grid. Every object
// sits at its own depth. The camera drifts sideways through the stars, and
// scrolling flies it toward whatever is under the cursor; scrolling back
// retraces the way home, then pulls out further.
//
// Each frame the CPU fills an overlay with small moving things (stars,
// planets, meteors), one WebGL pass shades every character cell (the star,
// black hole, moon, planet and Milky Way) on top of it, and a second pass
// stamps each cell's glyph from a pre-tinted glyph sheet.
const space = document.querySelector("#space");
const gl = space.getContext("webgl", { alpha: false, antialias: false });
const glyphSheet = document.createElement("canvas");
const calmTargets = [".intro h1", ".intro p", ".contributions", ".socials"].map((selector) => document.querySelector(selector));

// Glyphs from empty to dense; a cell's brightness picks its glyph and colour.
const RAMP = " .,:;-=+*x%#@";
const LEVELS = 32;
const SKY_PALETTE = 0;
const WATER_PALETTE = 1;
const LAND_PALETTE = 2;
const HOLE_PALETTE = 3;
const MILKY_PALETTE = 4;
// An overlay cell in this palette blacks out what is behind it: a planet's
// night side crossing the face of the star.
const SILHOUETTE = 7;
const PALETTES = [
  // Sky and star: deep space red through orange to white-hot.
  [[0, 8, 2, 1], [0.2, 74, 20, 7], [0.45, 176, 64, 22], [0.7, 242, 134, 62], [0.88, 255, 204, 146], [1, 255, 246, 228]],
  // Ocean: deep blue through cyan to white surf.
  [[0, 2, 6, 18], [0.25, 8, 34, 96], [0.5, 22, 92, 186], [0.72, 54, 168, 230], [0.88, 150, 218, 248], [1, 238, 250, 255]],
  // Land: dark forest through bright green to pale highlands.
  [[0, 3, 10, 4], [0.25, 16, 62, 22], [0.5, 46, 132, 48], [0.72, 110, 190, 72], [0.88, 196, 222, 128], [1, 246, 250, 226]],
  // Black hole: deep purple through violet and lavender to white.
  [[0, 6, 2, 14], [0.25, 46, 14, 92], [0.5, 112, 50, 196], [0.72, 176, 122, 244], [0.88, 222, 196, 255], [1, 255, 252, 255]],
  // Milky Way and moon: cool, pale grey.
  [[0, 3, 3, 6], [0.1, 18, 20, 32], [0.2, 42, 46, 66], [0.35, 100, 106, 136], [0.6, 192, 198, 218], [1, 255, 255, 255]],
];
// A cell's byte holds its palette in the top three bits and brightness in the low five.
const PALETTE_SHIFT = 5;
const LEVEL_MASK = 31;
// The Milky Way repeats every this many screen widths as the camera drifts.
const MILKY_SPAN = 2.5;
// The planet's terrain height below which it is ocean (about 62% of it, like Earth).
const SEA_LEVEL = 0.857;
const MARGIN = 18;
const RAY_COUNT = 12;

// Depths. The camera starts at depth 0, where everything appears at its
// composed size; flying a distance d toward something at depth Z makes it
// Z / (Z - d) times bigger, so near things grow and slide away much faster
// than far ones.
const DEPTH = { earth: 2, moon: 3.5, hole: 6, sun: 9, loner: 30 };
const STAR_NEAR = 10;
const STAR_FAR = 80;
// Flying straight at something stops once it is this many times its composed
// size, and things flown past fade out between these sizes.
const CLOSEST = { earth: 4, moon: 6, hole: 8, sun: 7 };
const FADE = { earth: [5, 8], moon: [7, 11], hole: [10, 16], sun: [9, 14] };
// The camera goes no farther than just short of the star, and pulls back no
// more than this far behind where it started.
const FARTHEST = DEPTH.sun * (11 / 12);
const PULL_OUT = -6;
// Scrolling: thrust (depth units per second) per pixel scrolled, how long the
// thrust takes to die down (seconds), and its top speed.
const THRUST = 0.009;
const THRUST_DAMPING = 0.45;
const THRUST_MAX = 14;
// After flying off into empty space, with nothing in view for this long
// (seconds), the camera glides back home.
const LOST_DELAY = 2.5;
// At speed, a star streaks back along the path of its last this-many seconds.
const STREAK_TIME = 0.07;

let viewWidth = 0;
let viewHeight = 0;
let pixelRatio = 1;
let cellW = 4;
let cellH = 6;
let cellPxW = 8;
let cellPxH = 12;
let cols = 0;
let rows = 0;
// The focal length of the camera, in px.
let focal = 1;
// Where everything sits from the camera's starting point (x, y, r in px).
const home = {
  sun: { x: 0, y: 0, r: 1 },
  hole: { x: 0, y: 0, r: 1 },
  moon: { x: 0, y: 0, r: 1 },
  earth: { x: 0, y: 0, r: 1 },
  loner: { x: 0, y: 0, r: 1 },
};
// Where everything appears this frame.
const seen = {
  sun: { x: 0, y: 0, r: 0, scale: 1, fade: 1, visible: false },
  hole: { x: 0, y: 0, r: 0, scale: 1, fade: 1, visible: false },
  moon: { x: 0, y: 0, r: 0, scale: 1, fade: 1, visible: false },
  earth: { x: 0, y: 0, r: 0, scale: 1, fade: 1, visible: false },
};
let overlay = new Uint8Array(0);
let calmMap = new Uint8Array(0);
let milkyMap = new Uint8Array(0);
let milkyWidth = 1;
let gpu = null;
let renderTimer = 0;
let lastFrame = 0;
// The camera's position; scrolling moves it.
const camera = { x: 0, y: 0, z: 0 };
// Scroll thrust (depth units per second) and the screen point it flies toward.
const thrust = { speed: 0, aimX: 0, aimY: 0 };
// How long nothing has been in view, and whether the camera is gliding home.
const lost = { time: 0, homing: false };
// The sideways drift: it eases up from rest to a cruising speed that slowly
// swells and settles. travel is in cells; spin turns the planet.
const drift = { speed: 0, travel: 0, spin: 0 };
const CRUISE = 7;
// How fast a star 40 depth units away crosses the screen, in px/s per unit of drift speed.
const DRIFT_PX = 4;
const stars = [];
const meteors = [];
// A swallowed meteor takes this long to spiral in, winding this many extra turns.
const SPIRAL_TIME = 1.8;
const SPIRAL_TURNS = 1.5;
// Meteor flights are simulated in steps of this many seconds.
const METEOR_STEP = 1 / 240;
// Meteor fall strength (2G, in px³/s² on a 900 px tall screen): about 400 px/s
// at 1,000 px from the black hole, 2,000 px/s as it reaches the shadow.
const METEOR_PULL = 1.6e8;
// The star's planets: tiny worlds on a tilted orbital plane (sizes and orbits
// in star radii), revolving very slowly, with periods set by Kepler's third law.
const ORBIT_SQUASH = 0.3;
const ORBIT_DEPTH = Math.sqrt(1 - ORBIT_SQUASH * ORBIT_SQUASH);
const ORBIT_TILT = -0.12;
const PLANETS = [
  { orbit: 2, size: 0.1, palette: SKY_PALETTE, lum: 0.75, phase: 0.8 },
  { orbit: 2.8, size: 0.14, palette: SKY_PALETTE, lum: 1, phase: 2.6 },
  { orbit: 3.6, size: 0.14, palette: WATER_PALETTE, lum: 0.95, phase: 4.1 },
  { orbit: 4.4, size: 0.11, palette: SKY_PALETTE, lum: 0.68, phase: 5.5 },
  { orbit: 5.4, size: 0.28, palette: SKY_PALETTE, lum: 0.9, phase: 1.7, banded: true },
].map((world) => ({ ...world, period: 18 * Math.pow(world.orbit, 1.5) }));
// Earthquakes from clicks on the planet: an epicentre on its surface (a unit
// vector in the planet's own turning frame) and an age in seconds.
const quakes = [];
const QUAKE_LIFE = 1.8;
const shake = { x: 0, y: 0 };
// The planet turns about this axis, tilted toward the viewer.
const SPIN_AXIS = (() => {
  const axis = [0.3, -0.9, 0.3];
  const length = Math.hypot(...axis);
  return axis.map((value) => value / length);
})();
const spinMatrix = new Float32Array(9);
// Infall strength (in horizon radii and seconds) and the spin stars pick up.
const INFALL_PULL = 5;
const INFALL_SPIN = 10;
// Stars slowly drawn into the black hole, spiralling in and stretching out.
const infall = Array.from({ length: 34 }, () => spawnInfall({}, true));

function spawnInfall(star, scattered) {
  star.radius = 6 + Math.random() * 9;
  star.angle = Math.random() * Math.PI * 2;
  star.age = scattered ? Math.random() * 40 : 0;
  star.brightness = 0.45 + Math.random() * 0.5;
  star.fall = 0;
  // Spread the starting radius when the page loads, so they are not in sync.
  if (scattered) star.radius = 2 + Math.random() * 13;
  return star;
}

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

function hash(a, b, c) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Value noise that repeats every `period` units in x, so the Milky Way wraps seamlessly.
function wrappedNoise(x, y, seed, period) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const x0 = ((xi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const u = (x - xi) * (x - xi) * (3 - 2 * (x - xi));
  const v = (y - yi) * (y - yi) * (3 - 2 * (y - yi));
  const a = hash(x0, yi, seed);
  const b = hash(x1, yi, seed);
  const c = hash(x0, yi + 1, seed);
  const d = hash(x1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function wrappedFbm(x, y, seed, period) {
  let sum = 0;
  let amplitude = 0.5;
  for (let octave = 0; octave < 5; octave++) {
    sum += amplitude * wrappedNoise(x, y, seed + octave, period);
    x *= 2;
    y *= 2.03;
    period *= 2;
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

// Composition from the starting point: the star sits beside the text column,
// the planet rises from the lower left (landscape) or across the bottom (portrait).
function composeScene() {
  const W = viewWidth;
  const H = viewHeight;
  if (W >= H * 1.1) {
    home.sun = { x: W * 0.74, y: H * 0.27, r: Math.min(W, H) * 0.045 };
    home.hole = { x: W * 0.16, y: H * 0.17, r: Math.min(W, H) * 0.016 };
    home.moon = { x: W * 0.85, y: H * 0.72, r: Math.min(W, H) * 0.068 };
    home.earth = circleThrough(-W * 0.02, H * 0.44, W * 0.27, H * 0.64, W * 0.56, H * 1.06);
  } else {
    home.sun = { x: W * 0.72, y: H * 0.075, r: W * 0.055 };
    home.hole = { x: W * 0.22, y: H * 0.085, r: W * 0.026 };
    home.moon = { x: W * 0.47, y: H * 0.19, r: W * 0.075 };
    home.earth = circleThrough(-W * 0.05, H * 0.72, W * 0.45, H * 0.8, W * 1.05, H * 1.02);
  }
  // A lone distant planet, glowing red off to the left.
  home.loner = { x: W * 0.09, y: H * 0.33, r: cellW * 1.6 };
}

// Lowers the planet just enough that its limb passes below the card and the
// links, so the surface never runs behind them in short, wide windows.
function clearContent() {
  const earth = home.earth;
  let shift = 0;
  for (const element of calmTargets.slice(2)) {
    const rect = element.getBoundingClientRect();
    for (let x = rect.left; x <= rect.right; x += 4) {
      const across = x - earth.x;
      if (Math.abs(across) >= earth.r) continue;
      const limb = earth.y - Math.sqrt(earth.r * earth.r - across * across);
      shift = Math.max(shift, rect.bottom + 14 - limb);
    }
  }
  earth.y += shift;
}

// Rays: a fixed fan of spikes with their own lengths, like a camera's flare.
const RAYS = Array.from({ length: RAY_COUNT }, (_, k) => ({
  angle: (k / RAY_COUNT) * Math.PI * 2 + (hash(k, 3, 5) - 0.5) * 0.4,
  length: 5 + hash(k, 7, 5) * 12,
  strength: 0.25 + hash(k, 11, 5) * 0.35,
  speed: 0.6 + hash(k, 13, 5) * 1.4,
}));
const rayData = new Float32Array(RAY_COUNT * 4);

// The black hole's disk is tilted toward us and seen squashed; inside SHADOW
// (in horizon radii) no starlight escapes.
const DISK_TILT = -0.32;
const DISK_SQUASH = 0.21;
const DISK_INNER = 1.5;
const DISK_OUTER = 4.2;
const SHADOW = 2.7;

// ── the camera ────────────────────────────────────────────────────────────

// Projects an object from where it sits at the start onto the screen as seen
// from the camera now: its position, radius, how much bigger it looks than at
// the start, and how faded it is once flown past.
function project(start, depth, fade, out) {
  const ahead = depth - camera.z;
  out.visible = false;
  if (ahead <= 0.02) return out;
  const centreX = viewWidth / 2;
  const centreY = viewHeight / 2;
  const worldX = ((start.x - centreX) * depth) / focal;
  const worldY = ((start.y - centreY) * depth) / focal;
  out.scale = depth / ahead;
  out.x = centreX + (focal * (worldX - camera.x)) / ahead;
  out.y = centreY + (focal * (worldY - camera.y)) / ahead;
  out.r = start.r * out.scale;
  out.fade = fade ? clamp((fade[1] - out.scale) / (fade[1] - fade[0]), 0, 1) : 1;
  out.visible = out.fade > 0;
  return out;
}

// Projects a point in the world (x and y in depth units, as the camera sees
// them) onto the screen, with the px-per-unit scale there.
const projected = { x: 0, y: 0, scale: 0 };
function projectPoint(x, y, z) {
  const ahead = z - camera.z;
  if (ahead <= 0.02) return null;
  projected.scale = focal / ahead;
  projected.x = viewWidth / 2 + (x - camera.x) * projected.scale;
  projected.y = viewHeight / 2 + (y - camera.y) * projected.scale;
  return projected;
}

function projectScene() {
  project(home.sun, DEPTH.sun, FADE.sun, seen.sun);
  project(home.hole, DEPTH.hole, FADE.hole, seen.hole);
  project(home.moon, DEPTH.moon, FADE.moon, seen.moon);
  project(home.earth, DEPTH.earth, FADE.earth, seen.earth);
  seen.earth.x += shake.x;
  seen.earth.y += shake.y;
}

// Moves the camera by this frame's thrust. Forward flies along the line
// through the aimed-at point, so it stays put on screen while everything
// spreads away from it, and stops short of whatever is straight ahead.
// Backward retraces the line home, then pulls straight back.
function fly(dt) {
  if (Math.abs(thrust.speed) < 0.002) {
    thrust.speed = 0;
    return;
  }
  const step = thrust.speed * dt;
  thrust.speed *= Math.exp(-dt / THRUST_DAMPING);
  if (step > 0) {
    let limit = FARTHEST - camera.z;
    for (const name of ["earth", "moon", "hole", "sun"]) {
      const object = seen[name];
      if (!object.visible) continue;
      const reach = name === "hole" ? object.r * SHADOW : object.r;
      if (Math.hypot(thrust.aimX - object.x, thrust.aimY - object.y) > reach) continue;
      limit = Math.min(limit, DEPTH[name] * (1 - 1 / CLOSEST[name]) - camera.z);
    }
    const forward = Math.max(0, Math.min(step, limit));
    if (forward < step) thrust.speed = 0;
    camera.x += ((thrust.aimX - viewWidth / 2) / focal) * forward;
    camera.y += ((thrust.aimY - viewHeight / 2) / focal) * forward;
    camera.z += forward;
    return;
  }
  let back = -step;
  if (camera.z > 0) {
    const used = Math.min(back, camera.z);
    const keep = (camera.z - used) / camera.z;
    camera.x *= keep;
    camera.y *= keep;
    camera.z -= used;
    back -= used;
  }
  if (back > 0) {
    const z = Math.max(PULL_OUT, camera.z - back);
    if (z === PULL_OUT) thrust.speed = 0;
    const keep = Math.max(0, 1 - (camera.z - z));
    camera.x *= keep;
    camera.y *= keep;
    camera.z = z;
  }
}

function push(px) {
  thrust.speed = clamp(thrust.speed + px * THRUST, -THRUST_MAX, THRUST_MAX);
  lost.homing = false;
}

function inView(object) {
  return object.visible && object.x + object.r > 0 && object.x - object.r < viewWidth
    && object.y + object.r > 0 && object.y - object.r < viewHeight;
}

// Once nothing has been in view for a while, glide smoothly back home.
function returnHome(dt) {
  const empty = !(inView(seen.sun) || inView(seen.hole) || inView(seen.moon) || inView(seen.earth));
  lost.time = empty && Math.abs(thrust.speed) < 0.05 ? lost.time + dt : 0;
  if (lost.time > LOST_DELAY) lost.homing = true;
  if (!lost.homing) return;
  const keep = Math.exp(-dt / 0.9);
  camera.x *= keep;
  camera.y *= keep;
  camera.z *= keep;
  if (Math.hypot(camera.x, camera.y, camera.z) < 0.002) {
    camera.x = camera.y = camera.z = 0;
    lost.homing = false;
  }
}

// The planet's turn, as a rotation matrix (column-major, for the shader).
function updateSpin() {
  const angle = drift.spin;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const [x, y, z] = SPIN_AXIS;
  const t = 1 - c;
  // The rotation R = cI + s[a]× + t aaᵀ, stored column by column.
  spinMatrix.set([
    c + t * x * x, t * x * y + s * z, t * x * z - s * y,
    t * x * y - s * z, c + t * y * y, t * y * z + s * x,
    t * x * z + s * y, t * y * z - s * x, c + t * z * z,
  ]);
}

// A point on the planet's surface, from a screen-facing unit normal into the
// planet's own turning frame.
function toPlanetFrame(nx, ny, nz) {
  const m = spinMatrix;
  return [m[0] * nx + m[3] * ny + m[6] * nz, m[1] * nx + m[4] * ny + m[7] * nz, m[2] * nx + m[5] * ny + m[8] * nz];
}

// ── the overlay: small moving things, drawn on the CPU ───────────────────

function plotCell(c, r, lum, palette) {
  if (c < 0 || r < 0 || c >= cols || r >= rows || lum <= 0) return;
  const i = r * cols + c;
  const level = Math.min(LEVEL_MASK, (lum * LEVEL_MASK + 0.5) | 0);
  if (level > (overlay[i] & LEVEL_MASK) && overlay[i] >> PALETTE_SHIFT !== SILHOUETTE) {
    overlay[i] = (palette << PALETTE_SHIFT) | level;
  }
}

function plot(x, y, lum, palette = SKY_PALETTE) {
  plotCell(Math.floor(((x + MARGIN) * pixelRatio) / cellPxW), Math.floor(((y + MARGIN) * pixelRatio) / cellPxH), lum, palette);
}

// A star glides smoothly between cells by splitting its light across two.
function plotGliding(x, y, lum) {
  const column = ((x + MARGIN) * pixelRatio) / cellPxW - 0.5;
  const c = Math.floor(column);
  const blend = column - c;
  const r = Math.floor(((y + MARGIN) * pixelRatio) / cellPxH);
  plotCell(c, r, lum * (1 - blend), SKY_PALETTE);
  plotCell(c + 1, r, lum * blend, SKY_PALETTE);
}

function cellCentreX(c) {
  return ((c + 0.5) * cellPxW) / pixelRatio - MARGIN;
}

function cellCentreY(r) {
  return ((r + 0.5) * cellPxH) / pixelRatio - MARGIN;
}

// Whether a point falls in the black hole's shadow or accretion disk.
function inHole(x, y) {
  const hole = seen.hole;
  if (!hole.visible) return false;
  const dx = (x - hole.x) / hole.r;
  const dy = (y - hole.y) / hole.r;
  if (dx * dx + dy * dy < SHADOW * SHADOW) return true;
  const ax = dx * Math.cos(DISK_TILT) + dy * Math.sin(DISK_TILT);
  const ay = -dx * Math.sin(DISK_TILT) + dy * Math.cos(DISK_TILT);
  const rho = Math.hypot(ax, ay / DISK_SQUASH);
  return rho >= DISK_INNER && rho <= DISK_OUTER;
}

function onSun(x, y) {
  const sun = seen.sun;
  return sun.visible && Math.hypot(x - sun.x, y - sun.y) < sun.r;
}

function placeStar(star, ahead, fresh) {
  const x = -MARGIN + Math.random() * (viewWidth + MARGIN * 2);
  const y = -MARGIN + Math.random() * (viewHeight + MARGIN * 2);
  star.z = camera.z + ahead;
  star.x = camera.x + ((x - viewWidth / 2) * ahead) / focal;
  star.y = camera.y + ((y - viewHeight / 2) * ahead) / focal;
  star.brightness = 0.35 + Math.random() * 0.6;
  star.phase = Math.random() * Math.PI * 2;
  star.age = fresh ? 0 : 5;
  star.lastX = NaN;
  star.lastY = NaN;
  return star;
}

function seedStars() {
  stars.length = 0;
  const count = Math.round(cols * rows * 0.0046);
  for (let k = 0; k < count; k++) stars.push(placeStar({}, STAR_NEAR + Math.random() * (STAR_FAR - STAR_NEAR), false));
}

// The starfield: stars at many depths drift past (near ones faster), stream
// outward from wherever the camera flies, streak when it flies fast, and bend
// around the black hole.
function drawStars(t, dt) {
  const sideways = (drift.speed * DRIFT_PX * 40 * dt) / focal;
  const flying = Math.abs(thrust.speed) > 0.3;
  const hole = seen.hole;
  const einstein = 2.3 * hole.r;
  for (const star of stars) {
    star.age += dt;
    star.x -= sideways;
    const ahead = star.z - camera.z;
    if (ahead < 2) {
      placeStar(star, STAR_FAR * (0.6 + 0.4 * Math.random()), true);
      continue;
    }
    if (ahead > STAR_FAR * 1.4) {
      placeStar(star, STAR_NEAR + Math.random() * 20, true);
      continue;
    }
    const scale = focal / ahead;
    let x = viewWidth / 2 + (star.x - camera.x) * scale;
    let y = viewHeight / 2 + (star.y - camera.y) * scale;
    if (x < -MARGIN * 2 && !flying) {
      // Drifted off the left edge: come back in on the right.
      star.x += ((viewWidth + MARGIN * 4) * ahead) / focal;
      x += viewWidth + MARGIN * 4;
      star.lastX = NaN;
    } else if (x < -MARGIN * 2 || x > viewWidth + MARGIN * 3 || y < -MARGIN * 2 || y > viewHeight + MARGIN * 2) {
      placeStar(star, STAR_FAR * (0.6 + 0.4 * Math.random()), true);
      continue;
    }
    // Starlight near the black hole is bent outward around it.
    if (hole.visible) {
      const dx = x - hole.x;
      const dy = y - hole.y;
      const beta = Math.hypot(dx, dy) || 0.001;
      const theta = (beta + Math.sqrt(beta * beta + 4 * einstein * einstein)) / 2;
      x = hole.x + (dx / beta) * theta;
      y = hole.y + (dy / beta) * theta;
    }
    if (inHole(x, y) || onSun(x, y)) {
      star.lastX = NaN;
      continue;
    }
    const near = clamp(30 / ahead, 0.75, 1.5);
    const lum = Math.min(1, star.brightness * (0.6 + 0.4 * Math.sin(t * 1.7 + star.phase)) * Math.min(1, star.age / 0.6) * near);
    plotGliding(x, y, lum);
    // At speed, a star streaks back along its path.
    const moved = Math.hypot(x - star.lastX, y - star.lastY);
    if (dt > 0 && moved > 0 && moved < viewWidth * 0.4) {
      const streak = Math.min(220, (moved / dt) * STREAK_TIME);
      if (streak > cellW * 1.5) {
        const backX = ((star.lastX - x) / moved) * streak;
        const backY = ((star.lastY - y) / moved) * streak;
        const steps = Math.min(40, Math.ceil(streak / cellW));
        for (let s = 1; s <= steps; s++) {
          const f = s / steps;
          plot(x + backX * f, y + backY * f, lum * (1 - f) * 0.85);
        }
      }
    }
    star.lastX = x;
    star.lastY = y;
  }
}

// A lone distant planet glowing red, far behind everything near.
function drawLoner() {
  const point = projectPoint(
    ((home.loner.x - viewWidth / 2) * DEPTH.loner) / focal,
    ((home.loner.y - viewHeight / 2) * DEPTH.loner) / focal,
    DEPTH.loner,
  );
  if (!point) return;
  const x = point.x;
  const y = point.y;
  const radius = Math.max(cellW, home.loner.r * (point.scale * DEPTH.loner) / focal);
  const c0 = Math.floor(((x - radius + MARGIN) * pixelRatio) / cellPxW);
  const c1 = Math.floor(((x + radius + MARGIN) * pixelRatio) / cellPxW);
  const r0 = Math.floor(((y - radius + MARGIN) * pixelRatio) / cellPxH);
  const r1 = Math.floor(((y + radius + MARGIN) * pixelRatio) / cellPxH);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const d = Math.hypot(cellCentreX(c) - x, cellCentreY(r) - y);
      if (d < radius) plotCell(c, r, 0.7 * (1 - d / radius), SKY_PALETTE);
    }
  }
}

// The star's planets: each a small disc on a tilted orbit, lit on the side
// facing the star; hidden behind the star on the far half of its orbit and a
// dark silhouette against it on the near half.
function drawPlanets(t) {
  const sun = seen.sun;
  if (!sun.visible) return;
  const sunX = ((home.sun.x - viewWidth / 2) * DEPTH.sun) / focal;
  const sunY = ((home.sun.y - viewHeight / 2) * DEPTH.sun) / focal;
  const sunR = (home.sun.r * DEPTH.sun) / focal;
  for (const world of PLANETS) {
    const angle = world.phase + (t / world.period) * Math.PI * 2;
    const a = world.orbit * sunR;
    const ox = Math.cos(angle) * a;
    const oy = Math.sin(angle) * a * ORBIT_SQUASH;
    // The lower half of the orbit swings toward the camera.
    const oz = -Math.sin(angle) * a * ORBIT_DEPTH;
    const point = projectPoint(
      sunX + ox * Math.cos(ORBIT_TILT) - oy * Math.sin(ORBIT_TILT),
      sunY + ox * Math.sin(ORBIT_TILT) + oy * Math.cos(ORBIT_TILT),
      DEPTH.sun + oz,
    );
    if (!point) continue;
    const px = point.x;
    const py = point.y;
    const size = Math.max(world.size * sunR * point.scale, cellW * 0.8);
    const front = oz < 0;
    let toSunX = sun.x - px;
    let toSunY = sun.y - py;
    const toSun = Math.hypot(toSunX, toSunY) || 1;
    toSunX /= toSun;
    toSunY /= toSun;
    const c0 = Math.floor(((px - size + MARGIN) * pixelRatio) / cellPxW);
    const c1 = Math.floor(((px + size + MARGIN) * pixelRatio) / cellPxW);
    const r0 = Math.floor(((py - size + MARGIN) * pixelRatio) / cellPxH);
    const r1 = Math.floor(((py + size + MARGIN) * pixelRatio) / cellPxH);
    const centreC = Math.floor(((px + MARGIN) * pixelRatio) / cellPxW);
    const centreR = Math.floor(((py + MARGIN) * pixelRatio) / cellPxH);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const dx = cellCentreX(c) - px;
        const dy = cellCentreY(r) - py;
        // Tiny worlds still claim the one cell they sit in.
        if (Math.hypot(dx, dy) > size && !(c === centreC && r === centreR)) continue;
        if (onSun(cellCentreX(c), cellCentreY(r))) {
          if (front) overlay[r * cols + c] = SILHOUETTE << PALETTE_SHIFT;
          continue;
        }
        const lit = 0.6 + 0.4 * clamp((dx * toSunX + dy * toSunY) / size, -1, 1);
        const bands = world.banded ? 0.82 + 0.18 * Math.sin((dy / size) * 5) : 1;
        plotCell(c, r, world.lum * lit * bands * sun.fade, world.palette);
      }
    }
  }
}

// Infalling stars accelerate: gravity grows as 1/r² and keeps adding to their
// inward speed, and they spin faster as they fall (angular momentum), so they
// drift for a while far out, then whip in, flattening into the disk and
// stretching into a streak at the end. Positions are in horizon radii.
function drawInfall(dt) {
  const hole = seen.hole;
  for (const star of infall) {
    star.age += dt;
    const rr = star.radius;
    star.fall += (INFALL_PULL / (rr * rr)) * dt;
    star.radius -= (0.03 + star.fall) * dt;
    star.angle += (INFALL_SPIN / (rr * rr)) * dt;
    if (star.radius < 1.25) {
      spawnInfall(star, false);
      continue;
    }
    if (!hole.visible) continue;
    const flatten = 1 - 0.75 * clamp((6 - rr) / 5, 0, 1);
    const fadeIn = Math.min(1, star.age / 3);
    const lum = star.brightness * fadeIn * (0.7 + 0.3 * clamp((4 - rr) / 3, 0, 1)) * hole.fade;
    // The streak traces where the star was over the last fraction of a second,
    // so it lengthens as the star speeds up.
    const speed = 0.03 + star.fall;
    const tail = Math.min(6, 1 + Math.floor(speed * 2));
    for (let k = 0; k < tail; k++) {
      const back = k * 0.035;
      const radius = star.radius + speed * back;
      const angle = star.angle - (INFALL_SPIN / (radius * radius)) * back;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius * flatten;
      const x = hole.x + (px * Math.cos(DISK_TILT) - py * Math.sin(DISK_TILT)) * hole.r;
      const y = hole.y + (px * Math.sin(DISK_TILT) + py * Math.cos(DISK_TILT)) * hole.r;
      // Nothing shows in front of the horizon itself.
      if ((x - hole.x) ** 2 + (y - hole.y) ** 2 < hole.r * hole.r) continue;
      plot(x, y, lum * (1 - k / (tail + 1)));
    }
  }
}

// Where a meteor is `age` seconds after launch, in horizon radii from the
// black hole, and how big it still is (1 → 0). Before capture it replays its
// simulated fall; after, it circles the black hole on a tightening spiral,
// whirling faster as it falls, and shrinks into the centre.
const meteorPoint = { x: 0, y: 0, size: 1 };
function meteorAt(meteor, age) {
  if (meteor.capturedAt < 0 || age <= meteor.capturedAt) {
    const last = meteor.path.length / 2 - 1;
    const step = Math.min(last, Math.max(0, age / METEOR_STEP));
    const k = Math.min(last - 1, Math.floor(step));
    const blend = Math.max(0, step - k);
    meteorPoint.x = meteor.path[k * 2] + (meteor.path[k * 2 + 2] - meteor.path[k * 2]) * blend;
    meteorPoint.y = meteor.path[k * 2 + 1] + (meteor.path[k * 2 + 3] - meteor.path[k * 2 + 1]) * blend;
    meteorPoint.size = 1;
    return meteorPoint;
  }
  const progress = Math.min(1, (age - meteor.capturedAt) / SPIRAL_TIME);
  const radius = meteor.captureRadius * Math.pow(1 - progress, 1.4);
  const angle = meteor.captureAngle
    + meteor.spin * (meteor.entrySpin * (age - meteor.capturedAt) + SPIRAL_TURNS * Math.PI * 2 * progress * progress * progress);
  meteorPoint.x = Math.cos(angle) * radius;
  meteorPoint.y = Math.sin(angle) * radius;
  meteorPoint.size = 1 - progress;
  return meteorPoint;
}

// Flies a meteor toward the black hole. Its speed depends only on how close it
// is, √(2G/d), like something falling in from far away, so every meteor moves
// the same at the same distance: slow far out, faster and faster in. Gravity
// also bends its path. The flight is simulated once at launch (in px around
// the black hole as it looks now, stored in horizon radii so it follows the
// black hole as the camera moves); when it reaches the shadow it is captured
// and spirals in from there.
function launchMeteor(meteor) {
  const hole = seen.hole;
  // G scales with the screen and with how close the black hole looks, so a
  // fall looks the same on a phone, a desktop, and up close.
  const scale = (Math.min(viewWidth, viewHeight) / 900) * hole.scale;
  const twoG = METEOR_PULL * scale * scale * scale;
  const gravity = twoG / 2;
  const capture = hole.r * SHADOW;
  let x = meteor.x - hole.x;
  let y = meteor.y - hole.y;
  const path = [x / hole.r, y / hole.r];
  let vx = meteor.vx;
  let vy = meteor.vy;
  meteor.capturedAt = -1;
  for (let step = 1; step <= 5 / METEOR_STEP; step++) {
    const d = Math.hypot(x, y);
    if (d <= capture) {
      meteor.capturedAt = (step - 1) * METEOR_STEP;
      meteor.captureRadius = Math.max(0.5, d / hole.r);
      meteor.captureAngle = Math.atan2(y, x);
      // Circle the same way the meteor was already moving around the hole,
      // carrying on at the speed it arrived with.
      const cross = x * vy - y * vx;
      meteor.spin = cross >= 0 ? 1 : -1;
      meteor.entrySpin = Math.min(9, Math.abs(cross) / (d * d || 1));
      break;
    }
    const pull = gravity / (d * d * d);
    vx -= x * pull * METEOR_STEP;
    vy -= y * pull * METEOR_STEP;
    const speed = Math.sqrt(twoG / d) / (Math.hypot(vx, vy) || 1);
    vx *= speed;
    vy *= speed;
    x += vx * METEOR_STEP;
    y += vy * METEOR_STEP;
    path.push(x / hole.r, y / hole.r);
  }
  meteor.path = Float32Array.from(path);
}

// Meteors launched by clicks: a bright head and a fading tail of cells. One
// captured by the black hole spirals in and shrinks to nothing.
function drawMeteors(dt) {
  const hole = seen.hole;
  for (let k = meteors.length - 1; k >= 0; k--) {
    const meteor = meteors[k];
    meteor.age += dt;
    const life = meteor.capturedAt >= 0 ? meteor.capturedAt + SPIRAL_TIME : 1.2;
    if (meteor.age > life) {
      meteors.splice(k, 1);
      continue;
    }
    if (!hole.visible) continue;
    // Swallowed meteors keep their brightness until they shrink away.
    const remaining = meteor.capturedAt >= 0 ? 1 : 1 - meteor.age / 1.2;
    for (let s = 0; s < 60; s++) {
      const age = meteor.age - s * 0.004;
      if (age < 0) break;
      const point = meteorAt(meteor, age);
      const fade = (1 - s / 60) * remaining * point.size;
      if (fade <= 0.02) continue;
      plot(hole.x + point.x * hole.r, hole.y + point.y * hole.r, fade);
    }
  }
}

// ── building the scene for a window size ─────────────────────────────────

function calmAt(x, y, rects) {
  let distance = Infinity;
  for (const rect of rects) {
    const dx = Math.max(rect.left - 8 - x, 0, x - rect.right - 8);
    const dy = Math.max(rect.top - 8 - y, 0, y - rect.bottom - 8);
    distance = Math.min(distance, Math.hypot(dx, dy));
  }
  return 0.38 + 0.62 * clamp(distance / 32, 0, 1);
}

// One pre-tinted glyph per brightness level and palette, so each cell is a single lookup.
function buildGlyphSheet() {
  glyphSheet.width = cellPxW * LEVELS;
  glyphSheet.height = cellPxH * PALETTES.length;
  const g = glyphSheet.getContext("2d");
  g.font = `500 ${Math.round(cellPxH * 0.92)}px "Geist Mono", ui-monospace, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let level = 1; level < LEVELS; level++) {
    const lum = level / (LEVELS - 1);
    const glyph = RAMP[Math.round(Math.pow(lum, 0.8) * (RAMP.length - 1))];
    if (glyph === " ") continue;
    PALETTES.forEach((palette, row) => {
      let k = 1;
      while (k < palette.length - 1 && lum > palette[k][0]) k++;
      const [t0, r0, g0, b0] = palette[k - 1];
      const [t1, r1, g1, b1] = palette[k];
      const f = clamp((lum - t0) / (t1 - t0), 0, 1);
      g.fillStyle = `rgb(${Math.round(r0 + (r1 - r0) * f)}, ${Math.round(g0 + (g1 - g0) * f)}, ${Math.round(b0 + (b1 - b0) * f)})`;
      g.fillText(glyph, (level + 0.5) * cellPxW, (row + 0.5) * cellPxH + 0.5);
    });
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
  // The grid overhangs the screen a little on every side.
  cols = Math.ceil(((viewWidth + MARGIN * 2) * pixelRatio) / cellPxW);
  rows = Math.ceil(((viewHeight + MARGIN * 2) * pixelRatio) / cellPxH);
  focal = viewHeight;
  composeScene();
  clearContent();
  buildGlyphSheet();

  // How brightly each cell may shine: the scene steps back under the text.
  const cells = cols * rows;
  const rects = calmTargets.map((element) => element.getBoundingClientRect());
  calmMap = new Uint8Array(cells);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) calmMap[r * cols + c] = Math.round(calmAt(cellCentreX(c), cellCentreY(r), rects) * 255);
  }

  // The Milky Way arcs gently across the sky: a soft band of glow with a
  // darker dust lane down its middle, sprinkled with dense, dim stars.
  milkyWidth = 48 * Math.ceil((cols * MILKY_SPAN) / 48);
  milkyMap = new Uint8Array(milkyWidth * rows);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < milkyWidth; column++) {
      const phase = (column / milkyWidth) * Math.PI * 2;
      const centre = rows * (0.4 + 0.22 * Math.sin(phase));
      const across = (row - centre) / (rows * 0.11);
      const band = Math.exp(-across * across);
      const clouds = wrappedFbm(column / 40, row / 18, 83, milkyWidth / 40);
      const laneOffset = (across - 0.15) * 4;
      const lane = Math.exp(-laneOffset * laneOffset) * clamp((wrappedNoise(column / 30, row / 12, 89, milkyWidth / 30) - 0.35) * 2, 0, 1);
      const glow = band * (0.45 + 0.75 * clouds) * (1 - 0.7 * lane);
      const star = hash(column, row, 97) < 0.09 * band ? 0.22 + 0.22 * hash(column, row, 101) : 0;
      milkyMap[row * milkyWidth + column] = Math.round(Math.min(1, Math.max(glow * 0.2, star)) * 255);
    }
  }

  overlay = new Uint8Array(cells);
  seedStars();
  projectScene();
  if (gpu) uploadScene();
  else drawStaticFrame();
}

// ── WebGL ─────────────────────────────────────────────────────────────────

const VERTEX_SHADER = `
attribute vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }`;

// Pass 1: one fragment per character cell. Shades the star, black hole, moon,
// planet and Milky Way for that cell, merges the CPU's overlay in depth order,
// and writes the cell's palette and brightness level as one byte.
const SCENE_SHADER = `
precision highp float;
uniform sampler2D overlay;
uniform sampler2D calmMap;
uniform sampler2D milky;
uniform vec2 grid;
uniform vec2 cellSize;
uniform float margin;
uniform float time;
uniform float viewWidth;
uniform vec4 sun;
uniform float flicker;
uniform vec4 rays[${RAY_COUNT}];
uniform vec3 transit;
uniform vec4 hole;
uniform float ringWidth;
uniform vec4 moon;
uniform vec2 moonLight;
uniform vec4 earth;
uniform vec2 earthLight;
uniform float earthSize;
uniform mat3 spin;
uniform float terrainScale;
uniform vec4 quakes[4];
uniform float milkyWidth;
uniform float milkyOffset;

const float TOP = ${LEVEL_MASK}.0;
const float SEA_LEVEL = ${SEA_LEVEL};
const float DISK_TILT = ${DISK_TILT};
const float DISK_SQUASH = ${DISK_SQUASH};
const float DISK_INNER = ${DISK_INNER};
const float DISK_OUTER = ${DISK_OUTER};
const float SHADOW = ${SHADOW};
const float QUAKE_LIFE = ${QUAKE_LIFE};

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), u.x), mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
    mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), u.x), mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
    u.z);
}

float fbm2(vec2 p) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 5; octave++) {
    sum += amplitude * noise2(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    amplitude *= 0.5;
  }
  return sum / 0.97;
}

float fbm3(vec3 p) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 5; octave++) {
    sum += amplitude * noise3(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    amplitude *= 0.5;
  }
  return sum / 0.97;
}

// Continents, ridged highlands and crater basins on the planet's sphere.
float terrainAt(vec3 p) {
  float ground = fbm3(p);
  float ridges = 1.0 - abs(fbm3(p * 2.0 + 4.0) * 2.0 - 1.0);
  float craters = max(0.0, 0.62 - noise3(p * 0.5 + 23.0)) * 1.6;
  return clamp(0.2 + 0.9 * ground + 0.4 * ridges * ridges - 0.6 * craters, 0.0, 1.3);
}

float quantize(float lum) {
  return floor(clamp(lum, 0.0, 1.0) * TOP + 0.5);
}

// Keplerian swirl in the accretion disk: inner material laps the outer.
float swirl(float angle, float radius) {
  return 0.8 + 0.2 * sin(angle * 4.0 + radius * 2.5 - time * (2.4 / pow(radius, 1.5)) * 4.0);
}

void main() {
  vec2 index = floor(gl_FragCoord.xy);
  vec2 uv = (index + 0.5) / grid;
  vec2 p = (index + 0.5) * cellSize - margin;
  float palette = 0.0;
  float lum = 0.0;
  bool onSun = false;

  // The star: a white-hot disc with a dark planet in transit,
  // a soft glow, a fan of pulsing rays and a horizontal lens streak.
  if (sun.z > 0.0) {
    vec2 ds = p - sun.xy;
    float d = length(ds) / sun.z;
    if (d <= 1.0) {
      onSun = true;
      vec2 local = ds / sun.z;
      // White-hot from afar; up close its limb darkens and its surface churns.
      float detail = clamp((sun.z - 60.0) / 200.0, 0.0, 1.0);
      float limb = sqrt(1.0 - d * d);
      lum = flicker * mix(0.97 + 0.03 * limb, 0.84 + 0.16 * limb, detail) * (1.0 - detail * 0.12 * fbm2(local * 5.0 + time * 0.15));
      if (length(local - transit.xy) < transit.z) lum = 0.0;
    } else {
      lum = exp(-(d - 1.0) * 2.2) * 0.55 + 0.12 / (d * d);
      float angle = atan(ds.y, ds.x);
      float ray = 0.0;
      for (int k = 0; k < ${RAY_COUNT}; k++) {
        float spread = cos(angle - rays[k].x);
        if (spread > 0.995) ray = max(ray, pow(spread, 3000.0) * rays[k].z * exp(-(d - 1.0) / rays[k].y) * rays[k].w);
      }
      lum += ray + exp(-abs(ds.y) / (sun.z * 0.12)) * exp(-abs(ds.x) / (viewWidth * 0.45)) * 0.45;
    }
    lum *= sun.w;
  }

  // A faint warm haze around the black hole.
  vec2 hv = vec2(0.0);
  float hd = 1000.0;
  if (hole.z > 0.0) {
    hv = (p - hole.xy) / hole.z;
    hd = length(hv);
    if (!onSun && hd < 10.0) lum += 0.08 * exp(-(hd - SHADOW) / 1.6) * hole.w;
  }

  // The Milky Way, farthest of all.
  if (!onSun && lum < 0.4) {
    float column = mod(index.x + milkyOffset, milkyWidth);
    float left = floor(column);
    float right = mod(left + 1.0, milkyWidth);
    float a = texture2D(milky, vec2((left + 0.5) / milkyWidth, uv.y)).r;
    float b = texture2D(milky, vec2((right + 0.5) / milkyWidth, uv.y)).r;
    float glow = mix(a, b, column - left);
    if (glow > lum) {
      lum = glow;
      palette = 4.0;
    }
  }
  float level = quantize(lum);

  // The black hole: horizon, photon ring, tilted accretion disk, lensed arcs
  // of the far disk, and the dark shadow, all in horizon radii.
  bool inHole = false;
  if (hole.z > 0.0 && hd < DISK_OUTER + 0.5) {
    float c = cos(DISK_TILT);
    float s = sin(DISK_TILT);
    float ax = hv.x * c + hv.y * s;
    float ay = -hv.x * s + hv.y * c;
    float rho = length(vec2(ax, ay / DISK_SQUASH));
    bool onDisk = rho >= DISK_INNER && rho <= DISK_OUTER;
    // Doppler beaming: the side swinging toward us (left) is brighter.
    float beaming = 0.75 - 0.25 * (ax / max(rho, 0.001));
    // White-hot at the inner edge, fading quickly to dim gas.
    float diskLight = (0.3 + 1.2 * exp(-(rho - DISK_INNER) / 1.1)) * beaming;
    float diskAngle = atan(ay / DISK_SQUASH, ax);
    float light = -1.0;
    if (onDisk && ay >= 0.0) {
      light = diskLight * swirl(diskAngle, rho);
    } else if (hd < 1.0) {
      light = 0.0;
    } else if (abs(hd - 1.06) < ringWidth) {
      light = 0.8 * (0.85 + 0.15 * sin(time * 3.0 + atan(hv.y, hv.x) * 3.0));
    } else {
      bool above = ay < 0.0;
      if (hd > 1.1 && hd < (above ? 2.35 : 1.55)) {
        float width = above ? 0.6 : 0.22;
        float peak = above ? 1.6 : 0.95;
        light = peak * exp(-(hd - 1.18) / width) * (0.75 - 0.25 * (hv.x / hd)) * swirl(atan(hv.y, hv.x) * 2.0, 1.6 + hd - 1.1);
      } else if (onDisk) {
        light = diskLight * 0.9 * swirl(diskAngle, rho);
      } else if (hd < SHADOW) {
        light = 0.0;
      }
    }
    if (light >= 0.0) {
      float holeLevel = quantize(light * hole.w);
      if (hole.w >= 0.999 || holeLevel >= level) {
        inHole = true;
        level = holeLevel;
        palette = 3.0;
      }
    }
  }

  // The CPU's overlay: stars, the star's planets, infalling stars and meteors.
  float over = floor(texture2D(overlay, uv).r * 255.0 + 0.5);
  float overPalette = floor(over / 32.0);
  float overLevel = over - overPalette * 32.0;
  if (overPalette == ${SILHOUETTE}.0) {
    level = 0.0;
    palette = 0.0;
  } else if (overLevel > level) {
    level = overLevel;
    palette = inHole ? 3.0 : overPalette;
  }

  float front = 0.0;
  // The moon: grey and cratered, lit from the star's side with a little
  // earthshine on its night side.
  if (moon.z > 0.0) {
    vec2 m = (p - moon.xy) / moon.z;
    float m2 = dot(m, m);
    if (m2 <= 1.0) {
      float lambert = max(0.0, dot(vec3(m, sqrt(1.0 - m2)), vec3(moonLight, 1.3)) / sqrt(2.69));
      vec2 q = m * 3.2 + 7.0;
      float maria = clamp((fbm2(q * 0.6 + 11.3) - 0.5) * 3.0, 0.0, 1.0);
      float craters = pow(1.0 - abs(noise2(q * 2.2 + 12.7) * 2.0 - 1.0), 6.0);
      float surface = 0.82 - 0.32 * maria + 0.18 * craters;
      float moonLevel = quantize(min(0.95, 0.12 + 0.88 * pow(lambert, 0.9) * surface) * moon.w);
      if (moon.w >= 0.999 || moonLevel >= level) {
        level = moonLevel;
        palette = 4.0;
        front = 1.0;
      }
    }
  }

  // The planet, nearest of all: oceans and continents on a turning sphere, lit
  // from behind so its limb glows, with a thin atmosphere outside it.
  if (earth.z > 0.0) {
    vec2 e = (p - earth.xy) / earth.z;
    float ed = length(e);
    if (ed <= 1.0) {
      vec3 n = vec3(e, sqrt(max(0.0, 1.0 - ed * ed)));
      float facing = dot(n, normalize(vec3(earthLight, -0.25)));
      float lit = facing > 0.0 ? pow(facing, 1.1) : 0.0;
      float depth = 1.0 - ed;
      // Light falls off away from the sunlit rim, so the disc reads as a sphere.
      float falloff = 0.3 + 0.7 * exp(-depth / 0.38);
      float rim = exp(-depth * earthSize / 5.0) * 0.6;
      vec3 q = spin * n;
      vec3 qp = q * earthSize;
      float terrain = terrainAt(q * terrainScale);
      float glint = time * 0.6;
      float surface;
      float earthPalette = 1.0;
      if (terrain < SEA_LEVEL) {
        // Ocean: an even blue, lighter in the shallows, with slow glints.
        surface = 0.62 + 0.3 * (terrain / SEA_LEVEL) + 0.1 * max(0.0, sin(glint * 2.0 + qp.x * 0.09 - qp.y * 0.05));
      } else {
        // Land: brighter the higher it climbs, with glints on the peaks.
        earthPalette = 2.0;
        float sparkle = terrain > 1.0 ? 0.12 * max(0.0, sin(glint + qp.x * 0.05 + qp.y * 0.03)) : 0.0;
        surface = 0.5 + 0.8 * (terrain - SEA_LEVEL) + sparkle;
      }
      float earthLum = 0.04 + 1.05 * lit * falloff * surface + rim * (0.3 + 0.7 * max(0.0, facing));
      // Earthquakes: a flash at the epicentre and two flickering rings
      // spreading over the surface, fading with distance and time.
      for (int k = 0; k < 4; k++) {
        float age = quakes[k].w;
        if (age < 0.0) continue;
        float dist = acos(clamp(dot(q, quakes[k].xyz), -1.0, 1.0)) * earthSize;
        if (dist > 510.0) continue;
        float fade = pow(1.0 - age / QUAKE_LIFE, 1.5);
        float pWave = (dist - age * 380.0) / 7.0;
        float sWave = (dist - age * 230.0) / 11.0;
        float flick = 0.75 + 0.25 * sin(time * 40.0 + qp.x * 0.7 + qp.y * 0.5);
        float waves = (0.15 * exp(-pWave * pWave) + 0.4 * exp(-sWave * sWave) * flick) * exp(-dist / 170.0);
        earthLum += (waves + exp(-dist / 14.0) * exp(-age * 4.0) * 0.55) * fade;
      }
      float earthLevel = quantize(earthLum * earth.w);
      if (earth.w >= 0.999 || earthLevel >= level) {
        level = earthLevel;
        palette = earthPalette;
        front = 1.0;
      }
    } else if ((ed - 1.0) * earthSize < 30.0) {
      float glow = exp(-(ed - 1.0) * earthSize / 7.0) * 0.75 * (0.25 + 0.75 * max(0.0, dot(e / ed, earthLight)));
      float glowLevel = quantize(glow * earth.w);
      if (glowLevel > level) {
        level = glowLevel;
        palette = 1.0;
      }
    }
  }

  // The scene steps back under the text.
  level = floor(level * texture2D(calmMap, uv).r + 0.5);
  gl_FragColor = vec4((palette * 32.0 + level) / 255.0, front, 0.0, 1.0);
}`;

// Pass 2: every screen pixel finds its cell and stamps that cell's glyph,
// over a soft bloom around the star (except behind the moon and planet).
const GLYPH_SHADER = `
precision highp float;
uniform sampler2D cells;
uniform sampler2D glyphs;
uniform vec2 grid;
uniform vec2 cell;
uniform vec2 origin;
uniform vec4 sun;
uniform float height;
uniform float levels;
uniform float palettes;

void main() {
  vec2 p = vec2(gl_FragCoord.x, height - gl_FragCoord.y);
  vec2 g = (p - origin) / cell;
  vec2 index = floor(g);
  vec4 texel = texture2D(cells, (index + 0.5) / grid);
  float value = floor(texel.r * 255.0 + 0.5);
  float palette = floor(value / 32.0);
  float level = value - palette * 32.0;
  vec2 local = g - index;
  vec4 glyph = texture2D(glyphs, vec2((level + local.x) / levels, (palette + local.y) / palettes));
  vec3 color = vec3(0.0);
  if (texel.g < 0.5 && sun.z > 0.0) {
    float d = distance(p, sun.xy) / sun.z;
    color = (vec3(1.0, 0.55, 0.24) * 0.3 * exp(-d / 2.6) + vec3(1.0, 0.84, 0.63) * 0.45 * exp(-d / 0.55)) * sun.w;
  }
  gl_FragColor = vec4(mix(color, glyph.rgb, glyph.a), 1.0);
}`;

const SCENE_UNIFORMS = [
  "overlay", "calmMap", "milky", "grid", "cellSize", "margin", "time", "viewWidth", "sun", "flicker", "rays",
  "transit", "hole", "ringWidth", "moon", "moonLight", "earth", "earthLight", "earthSize", "spin", "terrainScale",
  "quakes", "milkyWidth", "milkyOffset",
];
const GLYPH_UNIFORMS = ["cells", "glyphs", "grid", "cell", "origin", "sun", "height", "levels", "palettes"];

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

function buildProgram(fragmentSource, names) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const uniforms = {};
  for (const name of names) uniforms[name] = gl.getUniformLocation(program, name);
  return { program, uniforms, corner: gl.getAttribLocation(program, "corner") };
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

// Texture units: the scene pass reads 0–2 and draws into the cells texture,
// which the glyph pass reads from unit 3 alongside the glyph sheet on 4.
function setupGpu() {
  if (!gl) return null;
  try {
    const scene = buildProgram(SCENE_SHADER, SCENE_UNIFORMS);
    const glyph = buildProgram(GLYPH_SHADER, GLYPH_UNIFORMS);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.useProgram(scene.program);
    gl.uniform1i(scene.uniforms.overlay, 0);
    gl.uniform1i(scene.uniforms.calmMap, 1);
    gl.uniform1i(scene.uniforms.milky, 2);
    gl.useProgram(glyph.program);
    gl.uniform1i(glyph.uniforms.cells, 3);
    gl.uniform1i(glyph.uniforms.glyphs, 4);
    const textures = { overlay: makeTexture(), calm: makeTexture(), milky: makeTexture(), cells: makeTexture(), glyphs: makeTexture() };
    return { scene, glyph, textures, framebuffer: gl.createFramebuffer() };
  } catch {
    return null;
  }
}

function uploadTexture(unit, texture, format, width, height, data) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (data instanceof HTMLCanvasElement) gl.texImage2D(gl.TEXTURE_2D, 0, format, format, gl.UNSIGNED_BYTE, data);
  else gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, gl.UNSIGNED_BYTE, data);
}

function uploadScene() {
  const t = gpu.textures;
  uploadTexture(0, t.overlay, gl.LUMINANCE, cols, rows, overlay);
  uploadTexture(1, t.calm, gl.LUMINANCE, cols, rows, calmMap);
  uploadTexture(2, t.milky, gl.LUMINANCE, milkyWidth, rows, milkyMap);
  uploadTexture(3, t.cells, gl.RGBA, cols, rows, null);
  uploadTexture(4, t.glyphs, gl.RGBA, 0, 0, glyphSheet);
  gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.cells, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function drawQuad(corner) {
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// The direction from one projected object to the star, on screen.
function lightFrom(object) {
  const sun = seen.sun.visible ? seen.sun : home.sun;
  const dx = sun.x - object.x;
  const dy = sun.y - object.y;
  const length = Math.hypot(dx, dy) || 1;
  return [dx / length, dy / length];
}

const quakeData = new Float32Array(16);
function render(t) {
  const { sun, hole, moon, earth } = seen;
  // Pass 1: shade every cell into the cells texture.
  const s = gpu.scene.uniforms;
  gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.framebuffer);
  gl.viewport(0, 0, cols, rows);
  gl.useProgram(gpu.scene.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, gpu.textures.overlay);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.LUMINANCE, gl.UNSIGNED_BYTE, overlay);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, gpu.textures.calm);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, gpu.textures.milky);
  gl.uniform2f(s.grid, cols, rows);
  gl.uniform2f(s.cellSize, cellPxW / pixelRatio, cellPxH / pixelRatio);
  gl.uniform1f(s.margin, MARGIN);
  gl.uniform1f(s.time, t);
  gl.uniform1f(s.viewWidth, viewWidth);
  gl.uniform4f(s.sun, sun.x, sun.y, sun.visible ? sun.r : 0, sun.fade);
  gl.uniform1f(s.flicker, 0.94 + 0.04 * Math.sin(t * 2.1) + 0.02 * Math.sin(t * 9.7));
  for (let k = 0; k < RAY_COUNT; k++) {
    const ray = RAYS[k];
    rayData.set([ray.angle, ray.length, ray.strength, 0.65 + 0.35 * Math.sin(t * ray.speed + k * 1.7) + 0.15 * Math.sin(t * 7.3 + k)], k * 4);
  }
  gl.uniform4fv(s.rays, rayData);
  // A small planet in transit, crossing the face of the star every 50 s.
  gl.uniform3f(s.transit, -1.5 + ((t / 50) % 1) * 3, -0.32, 0.14);
  gl.uniform4f(s.hole, hole.x, hole.y, hole.visible ? hole.r : 0, hole.fade);
  // At small sizes the photon ring stays at least one cell wide.
  gl.uniform1f(s.ringWidth, Math.max(0.05, (cellW * 0.6) / Math.max(hole.r, 0.001)));
  gl.uniform4f(s.moon, moon.x, moon.y, moon.visible ? moon.r : 0, moon.fade);
  gl.uniform2fv(s.moonLight, lightFrom(moon));
  gl.uniform4f(s.earth, earth.x, earth.y, earth.visible ? earth.r : 0, earth.fade);
  gl.uniform2fv(s.earthLight, lightFrom(earth));
  gl.uniform1f(s.earthSize, home.earth.r);
  gl.uniformMatrix3fv(s.spin, false, spinMatrix);
  gl.uniform1f(s.terrainScale, home.earth.r / 60);
  for (let k = 0; k < 4; k++) {
    const quake = quakes[k];
    quakeData.set(quake ? [quake.x, quake.y, quake.z, quake.age] : [0, 0, 1, -1], k * 4);
  }
  gl.uniform4fv(s.quakes, quakeData);
  gl.uniform1f(s.milkyWidth, milkyWidth);
  // The Milky Way is the farthest layer, so it drifts slowest of all.
  gl.uniform1f(s.milkyOffset, drift.travel * 0.25);
  drawQuad(gpu.scene.corner);

  // Pass 2: stamp the glyphs onto the screen.
  const g = gpu.glyph.uniforms;
  const ratio = pixelRatio;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, space.width, space.height);
  gl.useProgram(gpu.glyph.program);
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, gpu.textures.cells);
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, gpu.textures.glyphs);
  gl.uniform2f(g.grid, cols, rows);
  gl.uniform2f(g.cell, cellPxW, cellPxH);
  gl.uniform2f(g.origin, -MARGIN * ratio, -MARGIN * ratio);
  gl.uniform4f(g.sun, sun.x * ratio, sun.y * ratio, sun.visible ? sun.r * ratio : 0, sun.fade);
  gl.uniform1f(g.height, space.height);
  gl.uniform1f(g.levels, LEVELS);
  gl.uniform1f(g.palettes, PALETTES.length);
  drawQuad(gpu.glyph.corner);
}

function drawFrame(now) {
  requestAnimationFrame(drawFrame);
  const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
  lastFrame = now;
  const t = now / 1000;
  // Inertia: the drift eases toward a cruising speed that slowly swells and
  // settles, and never reverses; the planet turns in step with it.
  const cruise = CRUISE * (1 + 0.25 * Math.sin(t * 0.13) + 0.1 * Math.sin(t * 0.051 + 1.7));
  drift.speed += (cruise - drift.speed) * (1 - Math.exp(-dt / 2.5));
  drift.travel += drift.speed * dt;
  drift.spin += drift.speed * dt * 0.00125;
  updateSpin();
  // Quakes age out, and the planet jolts hardest right after one starts.
  let jolt = 0;
  for (let k = quakes.length - 1; k >= 0; k--) {
    quakes[k].age += dt;
    if (quakes[k].age > QUAKE_LIFE) quakes.splice(k, 1);
    else jolt = Math.max(jolt, 2.5 * Math.exp(-quakes[k].age * 6));
  }
  shake.x = (Math.random() * 2 - 1) * jolt;
  shake.y = (Math.random() * 2 - 1) * jolt * 0.7;
  fly(dt);
  returnHome(dt);
  projectScene();

  overlay.fill(0);
  drawStars(t, dt);
  drawLoner();
  drawPlanets(t);
  drawInfall(dt);
  drawMeteors(dt);
  render(t);
}

// Without WebGL, one still frame of the starfield is drawn on a 2D canvas instead.
function drawStaticFrame() {
  const g = space.getContext("2d");
  if (!g) return;
  overlay.fill(0);
  drawStars(0, 0);
  drawLoner();
  g.fillStyle = "#000";
  g.fillRect(0, 0, space.width, space.height);
  const ox = -MARGIN * pixelRatio;
  for (let i = 0; i < cols * rows; i++) {
    const level = overlay[i] & LEVEL_MASK;
    if (level < 2) continue;
    g.drawImage(glyphSheet, level * cellPxW, (overlay[i] >> PALETTE_SHIFT) * cellPxH, cellPxW, cellPxH,
      ox + (i % cols) * cellPxW, ox + ((i / cols) | 0) * cellPxH, cellPxW, cellPxH);
  }
}

function scheduleBuild() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(buildScene, 150);
}

// A tap or click: on the planet it sets off an earthquake; anywhere else it
// launches a shooting star toward the black hole, aimed a little off-centre
// so it falls in on a spiral, speeding up as it nears it.
function tap(x, y) {
  const earth = seen.earth;
  const nx = (x - earth.x) / earth.r;
  const ny = (y - earth.y) / earth.r;
  if (earth.visible && earth.fade > 0.5 && nx * nx + ny * ny < 1) {
    const [qx, qy, qz] = toPlanetFrame(nx, ny, Math.sqrt(1 - nx * nx - ny * ny));
    quakes.push({ x: qx, y: qy, z: qz, age: 0 });
    if (quakes.length > 4) quakes.shift();
    return;
  }
  const hole = seen.hole;
  if (!hole.visible) return;
  const aimAngle = Math.random() * Math.PI * 2;
  const dx = hole.x + Math.cos(aimAngle) * hole.r * 1.2 - x;
  const dy = hole.y + Math.sin(aimAngle) * hole.r * 1.2 - y;
  const distance = Math.hypot(dx, dy) || 1;
  const meteor = { x, y, vx: dx / distance, vy: dy / distance, age: 0 };
  launchMeteor(meteor);
  meteors.push(meteor);
}

// A press that barely moves counts as a tap, so swipes don't launch meteors.
let press = null;
window.addEventListener("pointerdown", (event) => {
  press = { x: event.clientX, y: event.clientY, time: event.timeStamp };
}, { passive: true });
window.addEventListener("pointerup", (event) => {
  const start = press;
  press = null;
  if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12 || event.timeStamp - start.time > 600) return;
  tap(event.clientX, event.clientY);
}, { passive: true });

// Scrolling flies the camera: down toward the point under the cursor, up back
// the way it came. On touch screens, swiping up flies toward where the finger
// went down.
window.addEventListener("wheel", (event) => {
  if (event.ctrlKey) return;
  const px = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewHeight : 1);
  if (px > 0) {
    thrust.aimX = event.clientX;
    thrust.aimY = event.clientY;
  }
  push(px);
}, { passive: true });
let touchY = null;
window.addEventListener("touchstart", (event) => {
  const touch = event.touches[0];
  if (!touch) return;
  touchY = touch.clientY;
  thrust.aimX = touch.clientX;
  thrust.aimY = touch.clientY;
}, { passive: true });
window.addEventListener("touchmove", (event) => {
  const touch = event.touches[0];
  if (!touch || touchY === null) return;
  push((touchY - touch.clientY) * 1.2);
  touchY = touch.clientY;
}, { passive: true });
window.addEventListener("touchend", () => {
  touchY = null;
}, { passive: true });
window.addEventListener("resize", scheduleBuild);
document.fonts?.ready.then(buildScene);

gpu = setupGpu();
updateSpin();
buildScene();
if (gpu) requestAnimationFrame(drawFrame);
