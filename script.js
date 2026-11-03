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
// Earth as it really is right now, with every airliner in the sky over it,
// drawn as a fine character grid. Every object sits at its own depth. The
// camera drifts sideways through the stars; scrolling up flies it toward
// whatever is under the cursor, and scrolling down retraces the way home,
// then pulls out further.
//
// Each frame the CPU fills two overlays with small moving things (stars,
// planets and meteors behind; planes and their routes in front), one WebGL
// pass shades every character cell (the star, black hole, moon, Earth and
// Milky Way) between them, picking its glyph and colour, and a second pass
// stamps each cell's glyph from a glyph sheet in that colour.
const space = document.querySelector("#space");
const gl = space.getContext("webgl", { alpha: false, antialias: false });
const glyphSheet = document.createElement("canvas");
const calmTargets = [".intro h1", ".intro p", ".contributions", ".socials"].map((selector) => document.querySelector(selector));

// Glyphs from empty to dense; a cell's brightness picks its glyph and colour.
const RAMP = " .,:;-=+*x%#@";
// Every glyph on the sheet: the ramp, then letters and marks for labels and
// planes. The last is a space that, unlike the first, blanks its cell in the
// foreground.
const GLYPHS = `${RAMP}ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789[]·•o~^_/\\'<>v `;
const WAVE_GLYPH = GLYPHS.indexOf("~");
const BLANK_GLYPH = GLYPHS.length - 1;
// Planes, drawn in characters over 5×3 cells at the nearest of eight
// headings: north, then clockwise. Their spaces leave the cells beneath be.
const PLANE_SPRITES = [
  ["  ^  ", "_/+\\_", " '+' "],
  [" \\ />", "  X  ", " / \\ "],
  [" \\   ", "+=+=>", " /   "],
  [" \\ / ", "  X  ", " / \\>"],
  [" .+. ", "-\\+/-", "  v  "],
  [" \\ / ", "  X  ", "</ \\ "],
  ["   / ", "<=+=+", "   \\ "],
  ["<\\ / ", "  X  ", " / \\ "],
].map((rows) => rows.map((row) => [...row].map((character) => GLYPHS.indexOf(character))));
const LEVELS = 32;
const SKY_PALETTE = 0;
const WATER_PALETTE = 1;
const PLANE_PALETTE = 2;
const HOLE_PALETTE = 3;
const MILKY_PALETTE = 4;
const ROUTE_PALETTE = 5;
// An overlay cell in this palette blacks out what is behind it: a planet's
// night side crossing the face of the star.
const SILHOUETTE = 7;
const PALETTES = [
  // Sky and star: deep space red through orange to white-hot.
  [[0, 8, 2, 1], [0.2, 74, 20, 7], [0.45, 176, 64, 22], [0.7, 242, 134, 62], [0.88, 255, 204, 146], [1, 255, 246, 228]],
  // Ocean: deep blue through cyan to white surf.
  [[0, 2, 6, 18], [0.25, 8, 34, 96], [0.5, 22, 92, 186], [0.72, 54, 168, 230], [0.88, 150, 218, 248], [1, 238, 250, 255]],
  // Planes: dim amber through gold to white.
  [[0, 12, 6, 0], [0.25, 104, 58, 8], [0.5, 214, 138, 30], [0.72, 255, 196, 72], [0.88, 255, 226, 150], [1, 255, 248, 228]],
  // Black hole: deep purple through violet and lavender to white.
  [[0, 6, 2, 14], [0.25, 46, 14, 92], [0.5, 112, 50, 196], [0.72, 176, 122, 244], [0.88, 222, 196, 255], [1, 255, 252, 255]],
  // Milky Way, moon and labels: cool, pale grey.
  [[0, 3, 3, 6], [0.1, 18, 20, 32], [0.2, 42, 46, 66], [0.35, 100, 106, 136], [0.6, 192, 198, 218], [1, 255, 255, 255]],
  // Flight paths: bright neon blue.
  [[0, 0, 8, 16], [0.3, 0, 60, 110], [0.55, 0, 150, 230], [0.75, 60, 210, 255], [0.9, 150, 240, 255], [1, 235, 253, 255]],
];
// A cell's byte holds its palette in the top three bits and brightness in the low five.
const PALETTE_SHIFT = 5;
const LEVEL_MASK = 31;
// The Milky Way repeats every this many screen widths as the camera drifts.
const MILKY_SPAN = 2.5;
const MARGIN = 18;
const RAY_COUNT = 12;
const RAD = Math.PI / 180;

// Depths. The camera starts at depth 0, where everything appears at its
// composed size; flying a distance d toward something at depth Z makes it
// Z / (Z - d) times bigger, so near things grow and slide away much faster
// than far ones.
const DEPTH = { earth: 2, moon: 3.5, hole: 6, sun: 9, loner: 30 };
const STAR_NEAR = 10;
const STAR_FAR = 80;
// Flying straight at something stops once it is this many times its composed
// size, and things flown past fade out between these sizes.
const CLOSEST = { earth: 6, moon: 6, hole: 8, sun: 7 };
const FADE = { earth: [7, 10], moon: [7, 11], hole: [10, 16], sun: [9, 14] };
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
let foreground = new Uint8Array(0);
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
// swells and settles. travel is in cells.
const drift = { speed: 0, travel: 0 };
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
// The Earth: which point of it faces us (the latitude and longitude at the
// centre of its disc, in radians), how fast that is turning (radians per
// second), and a drag in progress. Points on it are unit vectors with x
// toward 0° 0°, y toward 0° 90°E and z toward the North Pole.
const globe = { lat: 0, lon: 0, spinLat: 0, spinLon: 0, drag: null };
// Left alone, the camera circles the Earth once every this many seconds,
// the way the ground turns beneath the Sun.
const GLOBE_TURN = 1200;
// The screen's axes on the Earth (east, north and toward the camera, as
// columns, for the shader), and the direction of the Sun in screen space.
const globeMatrix = new Float32Array(9);
const sunView = new Float32Array(3);
// The Earth's map (earth.jpg): NASA's Blue Marble above its Earth at Night
// city lights, both public domain, the lights stored as their square root.
const earthMap = new Image();
let earthReady = 0;
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

// Composition from the starting point: the star sits beside the text column,
// and the whole Earth fills the room the text leaves free, to its left in
// wide windows and below it in tall ones.
function composeScene() {
  const W = viewWidth;
  const H = viewHeight;
  const rects = calmTargets.map((element) => element.getBoundingClientRect());
  if (W >= H * 1.1) {
    const room = Math.min(...rects.map((rect) => rect.left)) - W * 0.02;
    const r = Math.max(H * 0.14, Math.min(room * 0.44, H * 0.36));
    home.sun = { x: W * 0.74, y: H * 0.27, r: Math.min(W, H) * 0.045 };
    home.hole = { x: W * 0.1, y: H * 0.12, r: Math.min(W, H) * 0.016 };
    home.moon = { x: W * 0.85, y: H * 0.72, r: Math.min(W, H) * 0.068 };
    home.earth = { x: Math.max(room / 2, r + W * 0.01), y: H * 0.56, r };
    // A lone distant planet, glowing red off to the right.
    home.loner = { x: W * 0.95, y: H * 0.47, r: cellW * 1.6 };
  } else {
    const below = Math.max(...rects.map((rect) => rect.bottom)) + 14;
    const r = clamp((H - below) / 2 - 6, W * 0.22, W * 0.4);
    home.sun = { x: W * 0.72, y: H * 0.075, r: W * 0.055 };
    home.hole = { x: W * 0.22, y: H * 0.085, r: W * 0.026 };
    home.moon = { x: W * 0.47, y: H * 0.19, r: W * 0.075 };
    home.earth = { x: W / 2, y: below + r, r };
    home.loner = { x: W * 0.09, y: H * 0.33, r: cellW * 1.6 };
  }
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

// ── the Earth ─────────────────────────────────────────────────────────────

// Where the Sun is overhead at a moment (ms since 1970), as a point on the
// Earth: the usual low-precision solar position, good to about 0.01°.
function sunOverhead(ms) {
  const days = ms / 86400000 - 10957.5;
  const anomaly = (357.529 + 0.98560028 * days) * RAD;
  const along = (280.459 + 0.98564736 * days + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * RAD;
  const tilt = (23.439 - 3.6e-7 * days) * RAD;
  const declination = Math.asin(Math.sin(tilt) * Math.sin(along));
  const ascension = Math.atan2(Math.cos(tilt) * Math.sin(along), Math.cos(along));
  const longitude = ascension - (280.46061837 + 360.98564736629 * days) * RAD;
  return [Math.cos(declination) * Math.cos(longitude), Math.cos(declination) * Math.sin(longitude), Math.sin(declination)];
}

// The Earth starts with its morning side to us, so it is lit from the right
// like the star beside it, with the night and its city lights coming round
// on the left.
function faceSun() {
  const [x, y] = sunOverhead(Date.now());
  globe.lat = 18 * RAD;
  globe.lon = Math.atan2(y, x) - 50 * RAD;
}

// Left alone, the Earth turns slowly eastward, and holds still while a
// flight's card is open; let go of a drag and it coasts, then settles back.
function turnGlobe(dt) {
  if (!globe.drag) {
    const settle = 1 - Math.exp(-dt / 0.6);
    const idle = picked ? 0 : (-Math.PI * 2) / GLOBE_TURN;
    globe.spinLon += (idle - globe.spinLon) * settle;
    globe.spinLat -= globe.spinLat * settle;
    globe.lon += globe.spinLon * dt;
    globe.lat = clamp(globe.lat + globe.spinLat * dt, -1.3, 1.3);
  }
  const cosLat = Math.cos(globe.lat);
  const sinLat = Math.sin(globe.lat);
  const cosLon = Math.cos(globe.lon);
  const sinLon = Math.sin(globe.lon);
  globeMatrix.set([-sinLon, cosLon, 0, -sinLat * cosLon, -sinLat * sinLon, cosLat, cosLat * cosLon, cosLat * sinLon, sinLat]);
  const [x, y, z] = sunOverhead(Date.now());
  for (let axis = 0; axis < 3; axis++) {
    const m = axis * 3;
    sunView[axis] = globeMatrix[m] * x + globeMatrix[m + 1] * y + globeMatrix[m + 2] * z;
  }
}

// Where a point on the Earth appears on screen, and how squarely it faces the
// camera (0 at the limb, below 0 round the back).
const onGlobe = { x: 0, y: 0, facing: 0 };
function projectGlobe(x, y, z) {
  const m = globeMatrix;
  const earth = seen.earth;
  onGlobe.x = earth.x + (m[0] * x + m[1] * y + m[2] * z) * earth.r;
  onGlobe.y = earth.y - (m[3] * x + m[4] * y + m[5] * z) * earth.r;
  onGlobe.facing = m[6] * x + m[7] * y + m[8] * z;
  return onGlobe;
}

function onEarth(x, y) {
  const earth = seen.earth;
  return earth.visible && earthReady > 0.5 && Math.hypot(x - earth.x, y - earth.y) < earth.r;
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
  plotCell(cellColumn(x), cellRow(y), lum, palette);
}

function cellColumn(x) {
  return Math.floor(((x + MARGIN) * pixelRatio) / cellPxW);
}

function cellRow(y) {
  return Math.floor(((y + MARGIN) * pixelRatio) / cellPxH);
}

// The foreground overlay lies over everything, even the Earth: two bytes a
// cell, palette and level as above, then a glyph from the sheet (0 picks one
// from the ramp by brightness). Brighter things win a cell, unless forced,
// and a forced cell is kept clear of planes.
function plotNear(x, y, lum, palette, glyph = 0, force = false) {
  const c = cellColumn(x);
  const r = cellRow(y);
  if (c < 0 || r < 0 || c >= cols || r >= rows || lum <= 0) return;
  const i = (r * cols + c) * 2;
  const level = Math.max(1, Math.min(LEVEL_MASK, (lum * LEVEL_MASK + 0.5) | 0));
  if (force || level >= (foreground[i] & LEVEL_MASK)) {
    foreground[i] = (palette << PALETTE_SHIFT) | level;
    foreground[i + 1] = glyph;
  }
  if (force) taken[i / 2] = 1;
}

// A line of text in the foreground, one letter a cell with a blank cell
// either side, starting at x (or ending there, to the left).
function plotLabel(x, y, text, lum, palette, leftward = false) {
  const step = cellPxW / pixelRatio;
  const start = leftward ? x - (text.length + 1) * step : x;
  for (let k = -1; k <= text.length; k++) {
    const glyph = k < 0 || k === text.length ? BLANK_GLYPH : GLYPHS.indexOf(text[k]);
    if (glyph > 0) plotNear(start + (k + 0.5) * step, y, lum, palette, glyph, true);
  }
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

// ── live flights ──────────────────────────────────────────────────────────

// Every aircraft in the air that adsb.lol's receivers can hear, refreshed
// every five minutes by a GitHub Action (update-flights.yml) as
// {"time": unix s, "planes": [[hex, callsign, lat, lon, altitude ft,
// ground speed kt, track°, climb ft/min, type, registration, age s], ...]}.
const FLIGHTS_URL = "https://raw.githubusercontent.com/maxmanolov/maxmanolov.github.io/flights/flights.json";
const FLIGHTS_REFRESH = 150000;
// Each plane flies on along its track from its last report for at most
// FLIGHT_COAST seconds, then holds there, so a late update leaves it near
// where it was; after FLIGHT_STALE seconds without news it is dropped.
const FLIGHT_COAST = 1200;
const FLIGHT_STALE = 7200;
// Airlines, routes and aircraft, looked up when a plane is picked.
const ADSBDB_URL = "https://api.adsbdb.com/v0/";
const EARTH_KM = 6371;
// How far one knot carries a plane in a second, in radians around the Earth.
const KNOT = 1.852 / 3600 / EARTH_KM;
const DOT_GLYPH = GLYPHS.indexOf("·");
const BULLET_GLYPH = GLYPHS.indexOf("•");
const AIRPORT_GLYPH = GLYPHS.indexOf("o");
// How far (px) outside a plane's characters a click or tap still picks it.
const MOUSE_REACH = 3;
const TOUCH_REACH = 12;

let flights = null;
// The cells already covered by a plane this frame.
let taken = new Uint8Array(0);
// The plane whose card is open (a copy of its last report, with what was
// looked up about it), and the plane under the mouse.
let picked = null;
let hovered = -1;
// Where the mouse is, so the plane under it stays current as the Earth turns.
let mouse = null;
const lookups = new Map();

async function loadFlights() {
  try {
    const response = await fetch(FLIGHTS_URL, { cache: "no-cache" });
    if (response.ok) setFlights(await response.json());
  } catch {
    // No flights this time; the next refresh tries again.
  }
}

function unitVector(lat, lon) {
  const cosLat = Math.cos(lat * RAD);
  return [cosLat * Math.cos(lon * RAD), cosLat * Math.sin(lon * RAD), Math.sin(lat * RAD)];
}

function setFlights(data) {
  const planes = Array.isArray(data?.planes) ? data.planes : [];
  const count = planes.length;
  const next = {
    time: data.time,
    count,
    hex: [],
    callsign: [],
    type: [],
    registration: [],
    altitude: new Float32Array(count),
    speed: new Float32Array(count),
    track: new Float32Array(count),
    climb: new Float32Array(count),
    reported: new Float64Array(count),
    // Where each plane was and which way it was flying when last heard, and
    // where it is and which way it heads now (unit vectors).
    fix: new Float32Array(count * 3),
    course: new Float32Array(count * 3),
    at: new Float32Array(count * 3),
    toward: new Float32Array(count * 3),
    live: new Uint8Array(count),
    // Whether each was drawn last frame, which is what can be picked.
    shown: new Uint8Array(count),
    moved: 0,
  };
  planes.forEach(([hex, callsign, lat, lon, altitude, speed, track, climb, type, registration, age], k) => {
    next.hex.push(hex);
    next.callsign.push(callsign);
    next.type.push(type);
    next.registration.push(registration);
    next.altitude[k] = altitude;
    next.speed[k] = speed;
    next.track[k] = track;
    next.climb[k] = climb;
    next.reported[k] = data.time - age;
    const sinLat = Math.sin(lat * RAD);
    const cosLat = Math.cos(lat * RAD);
    const sinLon = Math.sin(lon * RAD);
    const cosLon = Math.cos(lon * RAD);
    const north = Math.cos(track * RAD);
    const east = Math.sin(track * RAD);
    next.fix.set([cosLat * cosLon, cosLat * sinLon, sinLat], k * 3);
    next.course.set([-sinLat * cosLon * north - sinLon * east, -sinLat * sinLon * north + cosLon * east, cosLat * north], k * 3);
  });
  flights = next;
  hovered = -1;
  moveFlights();
  const k = picked ? next.hex.indexOf(picked.hex) : -1;
  if (k >= 0) {
    Object.assign(picked, reportOf(k));
    picked.route = routeFor(picked);
  }
}

// A copy of one plane's last report.
function reportOf(k) {
  const f = flights;
  const i = k * 3;
  return {
    hex: f.hex[k],
    callsign: f.callsign[k],
    type: f.type[k],
    registration: f.registration[k],
    altitude: f.altitude[k],
    speed: f.speed[k],
    track: f.track[k],
    climb: f.climb[k],
    reported: f.reported[k],
    fix: f.fix.slice(i, i + 3),
    course: f.course.slice(i, i + 3),
    at: f.at.slice(i, i + 3),
    toward: f.toward.slice(i, i + 3),
  };
}

// Carries a plane on along its great circle for `elapsed` seconds from its
// report, writing where it is and which way it heads now.
function advance(fix, course, i, speed, elapsed, at, toward, o) {
  const angle = speed * KNOT * Math.max(0, elapsed);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (let axis = 0; axis < 3; axis++) {
    at[o + axis] = fix[i + axis] * c + course[i + axis] * s;
    toward[o + axis] = course[i + axis] * c - fix[i + axis] * s;
  }
}

// Planes move well under a pixel a frame, so their positions are worked out
// afresh only a few times a second.
function moveFlights() {
  const f = flights;
  const now = Date.now() / 1000;
  f.moved = now;
  for (let k = 0; k < f.count; k++) {
    const elapsed = now - f.reported[k];
    // A plane low down and descending has most likely landed by now.
    const landed = f.climb[k] < -250 && f.altitude[k] + (f.climb[k] * elapsed) / 60 < 0;
    f.live[k] = elapsed < FLIGHT_STALE && !landed ? 1 : 0;
    advance(f.fix, f.course, k * 3, f.speed[k], Math.min(elapsed, FLIGHT_COAST), f.at, f.toward, k * 3);
  }
  if (picked) advance(picked.fix, picked.course, 0, picked.speed, Math.min(now - picked.reported, FLIGHT_COAST), picked.at, picked.toward, 0);
}

// The plane on show whose characters a point on screen falls on (or within
// reach, px, of them), nearest its middle; or -1.
function planeAt(x, y, reach) {
  const earth = seen.earth;
  const halfWidth = (2.5 * cellPxW) / pixelRatio + reach;
  const halfHeight = (1.5 * cellPxH) / pixelRatio + reach;
  if (!flights || !earth.visible || earthReady < 0.5 || Math.hypot(x - earth.x, y - earth.y) > earth.r + halfWidth) return -1;
  let best = -1;
  let nearest = Infinity;
  for (let k = 0; k < flights.count; k++) {
    if (!flights.shown[k]) continue;
    const i = k * 3;
    const point = projectGlobe(flights.at[i], flights.at[i + 1], flights.at[i + 2]);
    const centre = snapPlane(point.x, point.y);
    const dx = x - centre.x;
    const dy = y - centre.y;
    if (Math.abs(dx) > halfWidth || Math.abs(dy) > halfHeight || dx * dx + dy * dy >= nearest) continue;
    best = k;
    nearest = dx * dx + dy * dy;
  }
  return best;
}

// The route filed under the plane's callsign, if where it is and where it is
// heading bear it out: route databases go stale as flight numbers move
// between legs.
function routeFor(plane) {
  const route = plane.info?.flightroute;
  if (!route?.origin || !route?.destination) return null;
  const from = unitVector(route.origin.latitude, route.origin.longitude);
  const to = unitVector(route.destination.latitude, route.destination.longitude);
  const total = arcBetween(from, to);
  const flown = arcBetween(from, plane.at);
  const left = arcBetween(plane.at, to);
  if (flown + left > total * 1.12 + 250 / EARTH_KM) return null;
  const heading = plane.toward[0] * to[0] + plane.toward[1] * to[1] + plane.toward[2] * to[2];
  if (Math.min(flown, left) > 300 / EARTH_KM && heading < 0) return null;
  return { from, to, origin: route.origin, destination: route.destination };
}

function arcBetween(a, b) {
  return Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1));
}

// A dotted great circle between two points on the Earth.
function drawArc(a, b, lum, palette, glyph) {
  const angle = arcBetween(a, b);
  const sin = Math.sin(angle);
  if (sin < 1e-6) return;
  const steps = Math.min(2000, Math.ceil((angle * seen.earth.r) / (cellW * 0.8)));
  for (let s = 0; s <= steps; s++) {
    const wa = Math.sin((1 - s / steps) * angle) / sin;
    const wb = Math.sin((s / steps) * angle) / sin;
    const point = projectGlobe(a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb);
    if (point.facing > 0) plotNear(point.x, point.y, lum * (0.55 + 0.45 * point.facing), palette, glyph, true);
  }
}

// An airport: a ring, and its code beside it on the side away from the
// middle of the Earth.
function drawAirport(place, code, lum) {
  const point = projectGlobe(place[0], place[1], place[2]);
  if (point.facing < 0.05) return;
  const x = point.x;
  const y = point.y;
  const outward = x >= seen.earth.x;
  const step = cellPxW / pixelRatio;
  plotNear(x, y, lum, MILKY_PALETTE, AIRPORT_GLYPH, true);
  plotLabel(outward ? x + step * 0.5 : x - step * 0.5, y, code, lum * 0.85, MILKY_PALETTE, !outward);
}

// Draws a plane in characters over the cells around (x, y), at the nearest
// of eight headings to its heading on screen (radians clockwise from up).
// Unless forced, it is left out where it would touch a plane already drawn,
// so busy skies thin out until the camera flies in close.
function plotPlane(x, y, heading, lum, palette, force) {
  const { c0, r0 } = snapPlane(x, y);
  if (!force) {
    for (let r = Math.max(0, r0); r < Math.min(rows, r0 + 3); r++) {
      for (let c = Math.max(0, c0 - 1); c < Math.min(cols, c0 + 6); c++) {
        if (taken[r * cols + c]) return false;
      }
    }
  }
  const sprite = PLANE_SPRITES[(Math.round(heading / (Math.PI / 4)) % 8 + 8) % 8];
  const level = Math.max(1, Math.min(LEVEL_MASK, (lum * LEVEL_MASK + 0.5) | 0));
  for (let r = r0; r < r0 + 3; r++) {
    for (let c = c0; c < c0 + 5; c++) {
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const i = r * cols + c;
      const glyph = sprite[r - r0][c - c0];
      taken[i] = 1;
      if (glyph === 0) continue;
      foreground[i * 2] = (palette << PALETTE_SHIFT) | level;
      foreground[i * 2 + 1] = glyph;
    }
  }
  return true;
}

// The middle of a plane's 5×3 characters drawn around (x, y), snapped to
// the grid, and the cell at their top left.
const snapped = { x: 0, y: 0, c0: 0, r0: 0 };
function snapPlane(x, y) {
  snapped.c0 = Math.round(((x + MARGIN) * pixelRatio) / cellPxW - 2.5);
  snapped.r0 = Math.round(((y + MARGIN) * pixelRatio) / cellPxH - 1.5);
  snapped.x = ((snapped.c0 + 2.5) * cellPxW) / pixelRatio - MARGIN;
  snapped.y = ((snapped.r0 + 1.5) * cellPxH) / pixelRatio - MARGIN;
  return snapped;
}

// Which way a plane heads on screen, as radians clockwise from up.
function screenHeading(toward, i) {
  const m = globeMatrix;
  const dx = m[0] * toward[i] + m[1] * toward[i + 1] + m[2] * toward[i + 2];
  const dy = m[3] * toward[i] + m[4] * toward[i + 1] + m[5] * toward[i + 2];
  return Math.atan2(dx, dy);
}

// The planes on the near side of the Earth, each drawn in gold characters
// pointing the way it flies. The picked one is white, bracketed and named,
// with its route in neon blue: solid from where it took off, dotted on to
// where it lands.
function drawFlights(t) {
  const earth = seen.earth;
  if (!flights || !earth.visible || earthReady === 0) return;
  if (Date.now() / 1000 - flights.moved > 0.25) {
    moveFlights();
    if (mouse && !globe.drag) {
      hovered = planeAt(mouse.x, mouse.y, MOUSE_REACH);
      pointAt(mouse.x, mouse.y);
    }
  }
  const f = flights;
  const fade = earth.fade * earthReady;
  const step = cellPxW / pixelRatio;
  const reach = 3 * step;
  taken.fill(0);
  f.shown.fill(0);
  const route = picked?.route;
  // The route, and the picked and hovered planes, first, so no other plane
  // covers them.
  if (route) {
    drawArc(route.from, picked.at, 0.95 * fade, ROUTE_PALETTE, BULLET_GLYPH);
    drawArc(picked.at, route.to, 0.85 * fade, ROUTE_PALETTE, DOT_GLYPH);
    drawAirport(route.from, route.origin.iata_code || route.origin.icao_code || "", 0.95 * fade);
    drawAirport(route.to, route.destination.iata_code || route.destination.icao_code || "", 0.95 * fade);
  }
  if (picked) {
    const point = projectGlobe(picked.at[0], picked.at[1], picked.at[2]);
    if (point.facing > 0) {
      const pulse = 0.75 + 0.25 * Math.sin(t * 5);
      plotPlane(point.x, point.y, screenHeading(picked.toward, 0), fade, MILKY_PALETTE, true);
      const { x, y } = snapPlane(point.x, point.y);
      plotNear(x - reach, y, pulse * fade, MILKY_PALETTE, GLYPHS.indexOf("["), true);
      plotNear(x + reach, y, pulse * fade, MILKY_PALETTE, GLYPHS.indexOf("]"), true);
      plotLabel(x + reach + step, y, picked.callsign || picked.hex.toUpperCase(), 0.95 * fade, MILKY_PALETTE);
      placeCard(x, y);
    }
  }
  if (hovered >= 0 && f.live[hovered] && f.hex[hovered] !== picked?.hex) {
    const i = hovered * 3;
    const point = projectGlobe(f.at[i], f.at[i + 1], f.at[i + 2]);
    if (point.facing > 0.06) {
      plotPlane(point.x, point.y, screenHeading(f.toward, i), fade, MILKY_PALETTE, true);
      const { x, y } = snapPlane(point.x, point.y);
      plotLabel(x + reach, y, f.callsign[hovered] || f.hex[hovered].toUpperCase(), 0.9 * fade, MILKY_PALETTE);
      f.shown[hovered] = 1;
    }
  }
  for (let k = 0; k < f.count; k++) {
    if (!f.live[k] || k === hovered) continue;
    if (picked && f.hex[k] === picked.hex) {
      f.shown[k] = 1;
      continue;
    }
    const i = k * 3;
    const point = projectGlobe(f.at[i], f.at[i + 1], f.at[i + 2]);
    if (point.facing < 0.06) continue;
    const x = point.x;
    const y = point.y;
    if (x < -MARGIN || y < -MARGIN || x > viewWidth + MARGIN || y > viewHeight + MARGIN) continue;
    if (plotPlane(x, y, screenHeading(f.toward, i), 0.86 * fade, PLANE_PALETTE, false)) f.shown[k] = 1;
  }
}

function pickPlane(k) {
  picked = { ...reportOf(k), info: null, route: null, looking: true };
  hovered = -1;
  // Which way it is heading on screen as it is picked, to keep the card
  // behind it.
  const heading = screenHeading(picked.toward, 0);
  picked.ahead = { dx: Math.sin(heading), dy: -Math.cos(heading) };
  renderCard();
  flightCard.hidden = false;
  const point = projectGlobe(picked.at[0], picked.at[1], picked.at[2]);
  const { x, y } = snapPlane(point.x, point.y);
  placeCard(x, y);
  lookUp(picked);
}

function closeCard() {
  picked = null;
  flightCard.hidden = true;
}

function lookUp(plane) {
  const key = `${plane.hex} ${plane.callsign}`;
  if (!lookups.has(key)) {
    const get = (path) => fetch(ADSBDB_URL + path)
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => (body && typeof body.response === "object" ? body.response : null))
      .catch(() => null);
    // Without a known route, the airline still shows in the callsign's prefix.
    const prefix = /^([A-Z]{3})\d/.exec(plane.callsign)?.[1];
    lookups.set(key, Promise.all([
      get(`aircraft/${encodeURIComponent(plane.hex)}`),
      plane.callsign ? get(`callsign/${encodeURIComponent(plane.callsign)}`) : null,
    ]).then(async ([aircraft, route]) => ({
      aircraft: aircraft?.aircraft ?? null,
      flightroute: route?.flightroute ?? null,
      airline: route?.flightroute?.airline ?? (prefix ? (await get(`airline/${prefix}`))?.[0] : null) ?? null,
    })));
  }
  lookups.get(key).then((info) => {
    plane.info = info;
    plane.looking = false;
    plane.route = routeFor(plane);
    if (picked === plane) renderCard();
  });
}

// ── the flight card ───────────────────────────────────────────────────────

const flightCard = document.querySelector(".flight");
const flightArt = flightCard.querySelector(".flight-art");
const flightSummary = flightCard.querySelector(".flight-summary");
// Characters between the frame's margins.
const CARD_WIDTH = 36;
const imperial = /^en-(US|GB|LR|MM)$/i.test(navigator.language || "");
// A 3×5 pixel font (M, N and W wider) for the big airport codes, drawn two
// pixel rows to a line with half blocks.
const BIG_FONT = {
  A: ".#.|#.#|###|#.#|#.#", B: "##.|#.#|##.|#.#|##.", C: ".##|#..|#..|#..|.##", D: "##.|#.#|#.#|#.#|##.",
  E: "###|#..|##.|#..|###", F: "###|#..|##.|#..|#..", G: ".##|#..|#.#|#.#|.##", H: "#.#|#.#|###|#.#|#.#",
  I: "###|.#.|.#.|.#.|###", J: "..#|..#|..#|#.#|.#.", K: "#.#|#.#|##.|#.#|#.#", L: "#..|#..|#..|#..|###",
  M: "#...#|##.##|#.#.#|#...#|#...#", N: "#..#|##.#|#.##|#..#|#..#", O: ".#.|#.#|#.#|#.#|.#.",
  P: "##.|#.#|##.|#..|#..", Q: ".#.|#.#|#.#|##.|.##", R: "##.|#.#|##.|#.#|#.#", S: ".##|#..|.#.|..#|##.",
  T: "###|.#.|.#.|.#.|.#.", U: "#.#|#.#|#.#|#.#|###", V: "#.#|#.#|#.#|#.#|.#.", W: "#...#|#...#|#.#.#|##.##|#...#",
  X: "#.#|#.#|.#.|#.#|#.#", Y: "#.#|#.#|.#.|.#.|.#.", Z: "###|..#|.#.|#..|###",
  0: "###|#.#|#.#|#.#|###", 1: ".#.|##.|.#.|.#.|###", 2: "##.|..#|.#.|#..|###", 3: "##.|..#|.#.|..#|##.",
  4: "#.#|#.#|###|..#|..#", 5: "###|#..|##.|..#|##.", 6: ".##|#..|###|#.#|###", 7: "###|..#|.#.|.#.|.#.",
  8: "###|#.#|###|#.#|###", 9: "###|#.#|###|..#|##.",
};

function bigLines(text) {
  const lines = ["", "", ""];
  [...text].forEach((character, index) => {
    const pixels = (BIG_FONT[character] || "...|...|...|...|...").split("|");
    for (let line = 0; line < 3; line++) {
      let row = index ? " " : "";
      for (let x = 0; x < pixels[0].length; x++) {
        const top = pixels[line * 2][x] === "#";
        const bottom = pixels[line * 2 + 1]?.[x] === "#";
        row += top && bottom ? "█" : top ? "▀" : bottom ? "▄" : " ";
      }
      lines[line] += row;
    }
  });
  return lines;
}

// Names for the commonest ICAO type codes, for when the lookup has none.
const AIRCRAFT = {
  A19N: "Airbus A319neo", A20N: "Airbus A320neo", A21N: "Airbus A321neo", A318: "Airbus A318", A319: "Airbus A319",
  A320: "Airbus A320", A321: "Airbus A321", A332: "Airbus A330-200", A333: "Airbus A330-300", A339: "Airbus A330-900",
  A343: "Airbus A340-300", A346: "Airbus A340-600", A359: "Airbus A350-900", A35K: "Airbus A350-1000",
  A388: "Airbus A380", BCS1: "Airbus A220-100", BCS3: "Airbus A220-300", B712: "Boeing 717", B737: "Boeing 737-700",
  B738: "Boeing 737-800", B739: "Boeing 737-900", B37M: "Boeing 737 MAX 7", B38M: "Boeing 737 MAX 8",
  B39M: "Boeing 737 MAX 9", B3XM: "Boeing 737 MAX 10", B744: "Boeing 747-400", B748: "Boeing 747-8",
  B752: "Boeing 757-200", B753: "Boeing 757-300", B762: "Boeing 767-200", B763: "Boeing 767-300",
  B764: "Boeing 767-400", B772: "Boeing 777-200", B77L: "Boeing 777-200LR", B773: "Boeing 777-300",
  B77W: "Boeing 777-300ER", B788: "Boeing 787-8", B789: "Boeing 787-9", B78X: "Boeing 787-10",
  E170: "Embraer 170", E75L: "Embraer 175", E75S: "Embraer 175", E190: "Embraer 190", E195: "Embraer 195",
  E290: "Embraer E190-E2", E295: "Embraer E195-E2", CRJ2: "Bombardier CRJ200", CRJ7: "Bombardier CRJ700",
  CRJ9: "Bombardier CRJ900", CRJX: "Bombardier CRJ1000", DH8D: "De Havilland Dash 8-400", AT72: "ATR 72",
  AT75: "ATR 72-500", AT76: "ATR 72-600", C172: "Cessna 172", C208: "Cessna Caravan", PC12: "Pilatus PC-12",
};

function fit(text, width) {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

function distanceText(radians) {
  const km = radians * EARTH_KM;
  return imperial ? `${Math.round(km * 0.621371).toLocaleString()} mi` : `${Math.round(km).toLocaleString()} km`;
}

function speedText(knots) {
  return imperial ? `${Math.round(knots * 1.15078).toLocaleString()} mph` : `${Math.round(knots * 1.852).toLocaleString()} km/h`;
}

function compass(degrees) {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(degrees / 45) % 8];
}

function clockText(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// The card pops up beside the picked plane, behind it so the way ahead stays
// in view: on the side it came from if there is room, else above or below,
// else ahead. It follows the plane as the Earth turns or the camera flies.
function placeCard(x, y) {
  const margin = 12;
  const width = flightCard.offsetWidth;
  const height = flightCard.offsetHeight;
  // Clear of the plane and its brackets.
  const clear = (3.5 * cellPxW) / pixelRatio + 10;
  const { dx, dy } = picked.ahead;
  const beside = (right) => [right ? x + clear : x - clear - width, y - height / 2, true];
  const across = (below) => [x - width / 2, below ? y + clear : y - clear - height, false];
  const spots = [beside(dx < 0), across(dy < 0), beside(dx >= 0), across(dy >= 0)];
  let [left, top] = spots.find(([left, top, sideways]) => (sideways
    ? left >= margin && left + width <= viewWidth - margin
    : top >= margin && top + height <= viewHeight - margin)) ?? spots[0];
  left = clamp(left, margin, viewWidth - width - margin);
  top = clamp(top, margin, viewHeight - height - margin);
  flightCard.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

function ageText(seconds) {
  const minutes = Math.floor(seconds / 60);
  return minutes < 1 ? "seen just now" : `seen ${minutes} min ago`;
}

// The card is drawn in characters, like everything else: a box-drawn frame
// around lines of styled runs, each run a [text, style] pair.
function renderCard() {
  const plane = picked;
  if (!plane) return;
  const now = Date.now();
  const airline = plane.info?.airline;
  const aircraft = plane.info?.aircraft;
  const route = plane.route;
  const lines = [];
  const add = (...runs) => lines.push(runs);
  const spread = (left, right, leftStyle = "", rightStyle = "") => {
    const room = CARD_WIDTH - right.length - 1;
    add([fit(left, room).padEnd(CARD_WIDTH - right.length), leftStyle], [right, rightStyle]);
  };
  const callsign = plane.callsign || plane.hex.toUpperCase();
  // The flight number, when the airline has a two-character IATA code.
  const iata = /^([A-Z]{2}|[A-Z]\d|\d[A-Z])(\d{1,4}[A-Z]?)$/.exec(plane.info?.flightroute?.callsign_iata || "");
  const number = iata ? `${iata[1]} ${iata[2]}` : "";
  const model = aircraft ? `${aircraft.manufacturer} ${aircraft.type}` : AIRCRAFT[plane.type] || plane.type;
  const registration = aircraft?.registration || plane.registration;
  const name = airline?.name || model || "Unknown aircraft";
  if (airline) {
    spread(name.toUpperCase(), number, "bright", "dim");
    add([fit([model, registration].filter(Boolean).join(" · "), CARD_WIDTH), "dim"]);
  } else {
    spread(name.toUpperCase(), registration, "bright", "dim");
  }
  add([""]);

  const state = plane.climb > 500 ? "CLIMBING" : plane.climb < -500 ? "DESCENDING" : "CRUISING";
  const altitude = `${Math.round(plane.altitude).toLocaleString()} ft`;
  const from = (route && (route.origin.iata_code || route.origin.icao_code)) || "";
  const to = (route && (route.destination.iata_code || route.destination.icao_code)) || "";
  const codes = [bigLines(from), bigLines(to)];
  const middle = CARD_WIDTH - codes[0][0].length - codes[1][0].length;
  let summary;
  if (route) {
    const flown = arcBetween(route.from, plane.at);
    const left = arcBetween(plane.at, route.to);
    const progress = clamp(flown / (flown + left || 1), 0, 1);
    if (middle >= 4) {
      for (let line = 0; line < 3; line++) {
        const arrow = line === 1 ? `${"─".repeat(Math.max(0, middle - 5))}›`.padStart(middle - 2).padEnd(middle) : " ".repeat(middle);
        add([codes[0][line], "bright"], [arrow, "dim"], [codes[1][line], "bright"]);
      }
    } else {
      spread(from, to, "bright", "bright");
    }
    spread(route.origin.municipality || route.origin.name || "", route.destination.municipality || route.destination.name || "", "dim", "dim");
    add([""]);
    const done = Math.round(progress * (CARD_WIDTH - 1));
    add(["━".repeat(done), "gold"], ["+", "gold"], ["─".repeat(CARD_WIDTH - 1 - done), "faint"]);
    spread(`${distanceText(flown)} flown`, `${distanceText(left)} to go`, "dim", "dim");
    add([""]);
    const lands = now + ((left * EARTH_KM) / (Math.max(plane.speed, 120) * 1.852)) * 3600000;
    spread(`• ${state}`, `lands ~${clockText(lands)}`, "live");
    summary = `${name} ${number || callsign} from ${route.origin.municipality || from} to ${route.destination.municipality || to}, ${Math.round(progress * 100)}% of the way there, ${state.toLowerCase()} at ${altitude}, landing around ${clockText(lands)}.`;
  } else {
    for (const line of bigLines(callsign)) add([fit(line, CARD_WIDTH), "bright"]);
    add([plane.looking ? "looking up its route…" : "route unknown", "dim"]);
    add([""]);
    spread(`• ${state}`, "", "live");
    summary = `${name} ${callsign}, ${state.toLowerCase()} at ${altitude}.`;
  }
  add([""]);
  const climb = Math.abs(plane.climb) > 250 ? `${plane.climb > 0 ? "↑" : "↓"} ${Math.abs(Math.round(plane.climb / 10) * 10).toLocaleString()} ft/min  ` : "";
  spread("altitude", `${climb}${altitude}`, "dim");
  spread("speed", speedText(plane.speed), "dim");
  spread("heading", `${String(Math.round(plane.track) % 360).padStart(3, "0")}° ${compass(plane.track)}`, "dim");
  if (!route) {
    const lat = Math.asin(clamp(plane.at[2], -1, 1)) / RAD;
    const lon = Math.atan2(plane.at[1], plane.at[0]) / RAD;
    spread("position", `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`, "dim");
  }
  add([""]);
  spread("", ageText(now / 1000 - plane.reported), "", "faint");

  // The top edge carries the callsign, and leaves a gap for the close button.
  const title = ` ${callsign} `;
  const frame = (text) => [text, "frame"];
  const rows = [[frame(`╭─${title}${"─".repeat(CARD_WIDTH - 5 - title.length)}     ─╮`)]];
  rows.push([frame("│ "), [" ".repeat(CARD_WIDTH)], frame(" │")]);
  for (const runs of lines) {
    const length = runs.reduce((total, [text]) => total + text.length, 0);
    rows.push([frame("│ "), ...runs, [" ".repeat(Math.max(0, CARD_WIDTH - length))], frame(" │")]);
  }
  rows.push([frame(`╰${"─".repeat(CARD_WIDTH + 2)}╯`)]);
  flightArt.replaceChildren(...rows.map((runs) => {
    const row = document.createElement("div");
    for (const [text, style] of runs) {
      const run = document.createElement("span");
      if (style) run.className = style;
      run.textContent = text;
      row.append(run);
    }
    return row;
  }));
  flightSummary.textContent = summary;
}

flightCard.querySelector(".flight-close").addEventListener("click", closeCard);
// The frame and big letters come from the font's box-drawing subset; fetch it
// before the first card needs it.
document.fonts?.load('500 12px "Geist Mono"', "╭█");
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && picked) closeCard();
});
setInterval(() => {
  if (picked) renderCard();
}, 1000);

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

// A palette's colour at a brightness from 0 to 1.
function paletteColor(palette, lum) {
  let k = 1;
  while (k < palette.length - 1 && lum > palette[k][0]) k++;
  const [t0, r0, g0, b0] = palette[k - 1];
  const [t1, r1, g1, b1] = palette[k];
  const f = clamp((lum - t0) / (t1 - t0), 0, 1);
  return [Math.round(r0 + (r1 - r0) * f), Math.round(g0 + (g1 - g0) * f), Math.round(b0 + (b1 - b0) * f)];
}

// Every palette at every level, a row each, for the shader to look up.
const paletteData = new Uint8Array(LEVELS * PALETTES.length * 4);
PALETTES.forEach((palette, row) => {
  for (let level = 0; level < LEVELS; level++) {
    paletteData.set([...paletteColor(palette, level / (LEVELS - 1)), 255], (row * LEVELS + level) * 4);
  }
});

// The ramp glyph for a brightness level.
function rampGlyph(level) {
  return Math.round(Math.pow(level / LEVEL_MASK, 0.8) * (RAMP.length - 1));
}

function glyphFont() {
  return `500 ${Math.round(cellPxH * 0.92)}px "Geist Mono", ui-monospace, monospace`;
}

// Every glyph once, in white, in a row; each cell tints its own.
function buildGlyphSheet() {
  glyphSheet.width = cellPxW * GLYPHS.length;
  glyphSheet.height = cellPxH;
  const g = glyphSheet.getContext("2d");
  g.font = glyphFont();
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#fff";
  for (let k = 1; k < GLYPHS.length; k++) g.fillText(GLYPHS[k], (k + 0.5) * cellPxW, cellPxH * 0.5 + 0.5);
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
  foreground = new Uint8Array(cells * 2);
  taken = new Uint8Array(cells);
  seedStars();
  projectScene();
  if (gpu) uploadScene();
  else drawStaticFrame();
}

// ── WebGL ─────────────────────────────────────────────────────────────────

const VERTEX_SHADER = `
attribute vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }`;

// Seam-free texture lookups on the Earth need screen-space derivatives.
const DERIVATIVES = Boolean(gl?.getExtension("OES_standard_derivatives"));

// Pass 1: one fragment per character cell. Shades the star, black hole, moon,
// Earth and Milky Way for that cell, merges the CPU's overlays in depth order,
// and writes the cell's colour, its glyph, and whether it lies in front.
const SCENE_SHADER = `${DERIVATIVES ? "#extension GL_OES_standard_derivatives : enable\n#define DERIVATIVES" : ""}
precision highp float;
uniform sampler2D overlay;
uniform sampler2D foreground;
uniform sampler2D calmMap;
uniform sampler2D milky;
uniform sampler2D palettes;
uniform sampler2D earthMap;
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
uniform mat3 globe;
uniform vec3 sunView;
uniform float milkyWidth;
uniform float milkyOffset;

const float TOP = ${LEVEL_MASK}.0;
const float DISK_TILT = ${DISK_TILT};
const float DISK_SQUASH = ${DISK_SQUASH};
const float DISK_INNER = ${DISK_INNER};
const float DISK_OUTER = ${DISK_OUTER};
const float SHADOW = ${SHADOW};

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
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
      palette = ${MILKY_PALETTE}.0;
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
        palette = ${HOLE_PALETTE}.0;
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
    palette = inHole ? ${HOLE_PALETTE}.0 : overPalette;
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
        palette = ${MILKY_PALETTE}.0;
        front = 1.0;
      }
    }
  }

  // The Earth, nearest of all, as it looks right now: NASA's Blue Marble by
  // day and its city lights by night, split where the Sun is really setting,
  // with the Sun glinting off the sea and a thin blue rim of air.
  bool direct = false;
  bool waves = false;
  vec3 tint = vec3(0.0);
  if (earth.z > 0.0) {
    vec2 e = (p - earth.xy) / earth.z;
    e.y = -e.y;
    float ed2 = dot(e, e);
    // Looked up for every cell, inside the disc or not, so the texture's
    // mipmap level comes out right along the limb.
    vec3 n = vec3(e, sqrt(max(0.0, 1.0 - ed2)));
    vec3 q = globe * n;
    float u = atan(q.y, q.x) / 6.2831853 + 0.5;
#ifdef DERIVATIVES
    // Across the date line u jumps from 1 to 0; counted from the other side
    // it runs on smoothly, so switch to that only where u jumps (elsewhere
    // the two are equally smooth, and flipping between them would blur).
    float wrapped = fract(u + 0.5) - 0.5;
    if (fwidth(u) > fwidth(wrapped) + 0.01) u = wrapped;
#endif
    // Day on the top half of the map, night lights on the bottom.
    float v = clamp(0.25 - asin(clamp(q.z, -1.0, 1.0)) / 6.2831853, 0.001, 0.499);
    vec3 ground = texture2D(earthMap, vec2(u, v)).rgb;
    float lights = min(1.0, 2.4 * texture2D(earthMap, vec2(u, v + 0.5)).g);
    if (ed2 <= 1.0) {
      float sunUp = dot(n, sunView);
      float day = smoothstep(-0.1, 0.12, sunUp);
      float light = 0.6 + 0.4 * sqrt(max(sunUp, 0.0));
      float sea = smoothstep(0.02, 0.08, ground.b - max(ground.r, ground.g));
      float glint = sea * pow(max(dot(reflect(-sunView, n), vec3(0.0, 0.0, 1.0)), 0.0), 60.0);
      // By day, land is dense and coloured as it really is; the sea is
      // sparser, blue, and drawn in waves.
      float landLum = (0.55 + 0.45 * sqrt(dot(ground, vec3(0.3, 0.59, 0.11)))) * light;
      float dayLum = mix(landLum, (0.36 + 0.22 * glint) * light, sea);
      vec3 landTint = pow(ground / max(max(ground.r, ground.g), max(ground.b, 0.04)), vec3(1.4));
      vec3 dayTint = mix(landTint, mix(vec3(0.12, 0.38, 1.0), vec3(0.8, 0.92, 1.0), glint * 0.7), sea);
      waves = sea * day > 0.5;
      // By night, dim blue with the land a little lighter, and city lights.
      float nightLum = 0.08 + 0.09 * (1.0 - sea) + 0.6 * lights;
      vec3 nightTint = mix(mix(vec3(0.28, 0.4, 0.9), vec3(0.5, 0.55, 0.75), 1.0 - sea), vec3(1.0, 0.6, 0.26), smoothstep(0.05, 0.3, lights));
      // The air: the limb glows blue, most where sunlight passes through it.
      float air = pow(1.0 - n.z, 4.0) * (0.12 + 0.6 * smoothstep(-0.25, 0.3, sunUp));
      float earthLevel = quantize((mix(nightLum, dayLum, day) + air) * earth.w);
      if (earth.w >= 0.999 || earthLevel >= level) {
        level = earthLevel;
        tint = mix(mix(nightTint, dayTint, day), vec3(0.45, 0.72, 1.0), clamp(air * 2.0, 0.0, 1.0));
        direct = true;
        front = 1.0;
      }
    } else if ((sqrt(ed2) - 1.0) * earth.z < 24.0) {
      // Outside, a soft halo of air, on the sunlit side.
      float ed = sqrt(ed2);
      float lit = smoothstep(-0.35, 0.45, dot(vec3(e / ed, 0.0), sunView));
      float glowLevel = quantize(exp(-(ed - 1.0) * earth.z / 5.0) * (0.15 + 0.55 * lit) * earth.w);
      if (glowLevel > level) {
        level = glowLevel;
        palette = ${WATER_PALETTE}.0;
      }
    }
  }

  // The foreground overlay: planes, routes and labels, over everything.
  vec4 near = texture2D(foreground, uv);
  float nearValue = floor(near.r * 255.0 + 0.5);
  float nearPalette = floor(nearValue / 32.0);
  float nearLevel = nearValue - nearPalette * 32.0;
  float glyph = -1.0;
  if (nearLevel > 0.0) {
    level = nearLevel;
    palette = nearPalette;
    direct = false;
    front = 1.0;
    float nearGlyph = floor(near.a * 255.0 + 0.5);
    if (nearGlyph > 0.0) glyph = nearGlyph;
  }

  // The scene steps back under the text.
  level = floor(level * texture2D(calmMap, uv).r + 0.5);
  vec3 color = direct
    ? tint * (0.45 + 0.55 * level / TOP)
    : texture2D(palettes, vec2((level + 0.5) / ${LEVELS}.0, (palette + 0.5) / ${PALETTES.length}.0)).rgb;
  if (glyph < 0.0 || level < 1.0) glyph = floor(pow(level / TOP, 0.8) * ${RAMP.length - 1}.0 + 0.5);
  // The sea by day is drawn in waves.
  if (direct && waves && glyph >= 4.0 && glyph <= 8.0) glyph = ${WAVE_GLYPH}.0;
  gl_FragColor = vec4(color, (glyph + front * 64.0) / 255.0);
}`;

// Pass 2: every screen pixel finds its cell and stamps that cell's glyph in
// its colour, over a soft bloom around the star (except behind things in front).
const GLYPH_SHADER = `
precision highp float;
uniform sampler2D cells;
uniform sampler2D glyphs;
uniform vec2 grid;
uniform vec2 cell;
uniform vec2 origin;
uniform vec4 sun;
uniform float height;

void main() {
  vec2 p = vec2(gl_FragCoord.x, height - gl_FragCoord.y);
  vec2 g = (p - origin) / cell;
  vec2 index = floor(g);
  vec4 texel = texture2D(cells, (index + 0.5) / grid);
  float code = floor(texel.a * 255.0 + 0.5);
  float front = step(64.0, code);
  vec2 local = g - index;
  float ink = texture2D(glyphs, vec2((code - front * 64.0 + local.x) / ${GLYPHS.length}.0, local.y)).a;
  vec3 color = vec3(0.0);
  if (front < 0.5 && sun.z > 0.0) {
    float d = distance(p, sun.xy) / sun.z;
    color = (vec3(1.0, 0.55, 0.24) * 0.3 * exp(-d / 2.6) + vec3(1.0, 0.84, 0.63) * 0.45 * exp(-d / 0.55)) * sun.w;
  }
  gl_FragColor = vec4(mix(color, texel.rgb, ink), 1.0);
}`;

const SCENE_UNIFORMS = [
  "overlay", "foreground", "calmMap", "milky", "palettes", "earthMap", "grid", "cellSize", "margin", "time", "viewWidth",
  "sun", "flicker", "rays", "transit", "hole", "ringWidth", "moon", "moonLight", "earth", "globe", "sunView",
  "milkyWidth", "milkyOffset",
];
const GLYPH_UNIFORMS = ["cells", "glyphs", "grid", "cell", "origin", "sun", "height"];

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

// Texture units: the scene pass reads 0–2 and 5–7 (the overlay, calm map and
// Milky Way; the foreground, palettes and Earth) and draws into the cells
// texture, which the glyph pass reads from unit 3 alongside the glyph sheet on 4.
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
    gl.uniform1i(scene.uniforms.foreground, 5);
    gl.uniform1i(scene.uniforms.palettes, 6);
    gl.uniform1i(scene.uniforms.earthMap, 7);
    gl.useProgram(glyph.program);
    gl.uniform1i(glyph.uniforms.cells, 3);
    gl.uniform1i(glyph.uniforms.glyphs, 4);
    const textures = {
      overlay: makeTexture(), calm: makeTexture(), milky: makeTexture(), cells: makeTexture(), glyphs: makeTexture(),
      foreground: makeTexture(), palettes: makeTexture(), earth: makeTexture(),
    };
    uploadTexture(6, textures.palettes, gl.RGBA, LEVELS, PALETTES.length, paletteData);
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
  uploadTexture(5, t.foreground, gl.LUMINANCE_ALPHA, cols, rows, foreground);
  gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.cells, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// The Earth's map, mipmapped so it stays smooth however small it is drawn,
// and repeating sideways for the seam-free lookup across the date line.
function uploadEarth() {
  gl.activeTexture(gl.TEXTURE7);
  gl.bindTexture(gl.TEXTURE_2D, gpu.textures.earth);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, earthMap);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
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

function render(t) {
  const { sun, hole, moon, earth } = seen;
  const textures = gpu.textures;
  // Pass 1: shade every cell into the cells texture.
  const s = gpu.scene.uniforms;
  gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.framebuffer);
  gl.viewport(0, 0, cols, rows);
  gl.useProgram(gpu.scene.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, textures.overlay);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.LUMINANCE, gl.UNSIGNED_BYTE, overlay);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, textures.calm);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, textures.milky);
  gl.activeTexture(gl.TEXTURE5);
  gl.bindTexture(gl.TEXTURE_2D, textures.foreground);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, foreground);
  gl.activeTexture(gl.TEXTURE6);
  gl.bindTexture(gl.TEXTURE_2D, textures.palettes);
  gl.activeTexture(gl.TEXTURE7);
  gl.bindTexture(gl.TEXTURE_2D, textures.earth);
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
  gl.uniform4f(s.earth, earth.x, earth.y, earth.visible && earthReady > 0 ? earth.r : 0, earth.fade * earthReady);
  gl.uniformMatrix3fv(s.globe, false, globeMatrix);
  gl.uniform3fv(s.sunView, sunView);
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
  gl.bindTexture(gl.TEXTURE_2D, textures.cells);
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, textures.glyphs);
  gl.uniform2f(g.grid, cols, rows);
  gl.uniform2f(g.cell, cellPxW, cellPxH);
  gl.uniform2f(g.origin, -MARGIN * ratio, -MARGIN * ratio);
  gl.uniform4f(g.sun, sun.x * ratio, sun.y * ratio, sun.visible ? sun.r * ratio : 0, sun.fade);
  gl.uniform1f(g.height, space.height);
  drawQuad(gpu.glyph.corner);
}

function drawFrame(now) {
  requestAnimationFrame(drawFrame);
  const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
  lastFrame = now;
  const t = now / 1000;
  // Inertia: the drift eases toward a cruising speed that slowly swells and
  // settles, and never reverses.
  const cruise = CRUISE * (1 + 0.25 * Math.sin(t * 0.13) + 0.1 * Math.sin(t * 0.051 + 1.7));
  drift.speed += (cruise - drift.speed) * (1 - Math.exp(-dt / 2.5));
  drift.travel += drift.speed * dt;
  // The Earth fades in once its map has loaded.
  if (earthReady > 0) earthReady = Math.min(1, earthReady + dt / 0.8);
  fly(dt);
  returnHome(dt);
  projectScene();
  turnGlobe(dt);

  overlay.fill(0);
  foreground.fill(0);
  drawStars(t, dt);
  drawLoner();
  drawPlanets(t);
  drawInfall(dt);
  drawMeteors(dt);
  drawFlights(t);
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
  g.font = glyphFont();
  g.textAlign = "center";
  g.textBaseline = "middle";
  const origin = -MARGIN * pixelRatio;
  for (let i = 0; i < cols * rows; i++) {
    const level = overlay[i] & LEVEL_MASK;
    if (level < 2) continue;
    g.fillStyle = `rgb(${paletteColor(PALETTES[overlay[i] >> PALETTE_SHIFT], level / LEVEL_MASK).join(", ")})`;
    g.fillText(RAMP[rampGlyph(level)], origin + ((i % cols) + 0.5) * cellPxW, origin + (((i / cols) | 0) + 0.5) * cellPxH + 0.5);
  }
}

function scheduleBuild() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(buildScene, 150);
}

// A tap or click on a plane opens its card, and on the rest of the Earth
// closes it; anywhere else it launches a shooting star toward the black
// hole, aimed a little off-centre so it falls in on a spiral, speeding up as
// it nears it.
function tap(x, y, reach) {
  const k = planeAt(x, y, reach);
  if (k >= 0) {
    pickPlane(k);
    return;
  }
  if (onEarth(x, y)) {
    closeCard();
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

// Dragging turns the Earth under the pointer, and it remembers how fast it
// was turning so it can coast on when let go.
function dragGlobe(x, y, time) {
  const drag = globe.drag;
  const r = Math.max(seen.earth.r, 1);
  const lon = -(x - drag.x) / r;
  const lat = (y - drag.y) / r;
  const dt = Math.max(0.008, (time - drag.time) / 1000);
  globe.lon += lon;
  globe.lat = clamp(globe.lat + lat, -1.3, 1.3);
  globe.spinLon = clamp(globe.spinLon * 0.4 + (lon / dt) * 0.6, -3, 3);
  globe.spinLat = clamp(globe.spinLat * 0.4 + (lat / dt) * 0.6, -3, 3);
  drag.x = x;
  drag.y = y;
  drag.time = time;
}

function letGo(time) {
  // Held still before letting go: no coasting.
  if (globe.drag && time - globe.drag.time > 80) {
    globe.spinLon = 0;
    globe.spinLat = 0;
  }
  globe.drag = null;
}

function pointAt(x, y) {
  document.documentElement.style.cursor = hovered >= 0 ? "pointer" : onEarth(x, y) ? "grab" : "";
}

// A press that barely moves counts as a tap, so swipes don't launch meteors.
// With a mouse, pressing on the Earth and dragging turns it.
let press = null;
window.addEventListener("pointerdown", (event) => {
  press = null;
  if (event.target.closest?.("a, button, .flight")) return;
  press = { x: event.clientX, y: event.clientY, time: event.timeStamp };
  if (event.pointerType === "mouse" && event.button === 0 && onEarth(event.clientX, event.clientY)) {
    // Not a text selection.
    event.preventDefault();
    globe.drag = { x: event.clientX, y: event.clientY, time: event.timeStamp };
    globe.spinLon = 0;
    globe.spinLat = 0;
    document.documentElement.style.cursor = "grabbing";
  }
});
window.addEventListener("pointermove", (event) => {
  if (event.pointerType !== "mouse") return;
  mouse = { x: event.clientX, y: event.clientY };
  if (globe.drag) {
    dragGlobe(event.clientX, event.clientY, event.timeStamp);
    return;
  }
  hovered = planeAt(event.clientX, event.clientY, MOUSE_REACH);
  pointAt(event.clientX, event.clientY);
}, { passive: true });
window.addEventListener("pointerup", (event) => {
  const start = press;
  press = null;
  if (event.pointerType === "mouse" && globe.drag) {
    letGo(event.timeStamp);
    pointAt(event.clientX, event.clientY);
  }
  if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12 || event.timeStamp - start.time > 600) return;
  tap(event.clientX, event.clientY, event.pointerType === "mouse" ? MOUSE_REACH : TOUCH_REACH);
}, { passive: true });

// Scrolling flies the camera: up toward the point under the cursor, down back
// the way it came. On touch screens the scrolling gestures do the same:
// dragging down (scrolling up) flies toward where the finger went down. A
// sideways swipe that starts on the Earth turns it instead.
window.addEventListener("wheel", (event) => {
  if (event.ctrlKey) return;
  const px = -event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewHeight : 1);
  if (px > 0) {
    thrust.aimX = event.clientX;
    thrust.aimY = event.clientY;
  }
  push(px);
}, { passive: true });
let touch = null;
window.addEventListener("touchstart", (event) => {
  const point = event.touches[0];
  touch = null;
  if (!point || event.target.closest?.(".flight")) return;
  const earth = onEarth(point.clientX, point.clientY) && !event.target.closest?.("a, button");
  touch = { x: point.clientX, y: point.clientY, mode: earth ? "undecided" : "fly" };
  thrust.aimX = point.clientX;
  thrust.aimY = point.clientY;
}, { passive: true });
window.addEventListener("touchmove", (event) => {
  const point = event.touches[0];
  if (!point || !touch) return;
  if (touch.mode === "undecided") {
    if (Math.hypot(point.clientX - touch.x, point.clientY - touch.y) < 8) return;
    touch.mode = Math.abs(point.clientX - touch.x) > Math.abs(point.clientY - touch.y) ? "turn" : "fly";
    if (touch.mode === "turn") globe.drag = { x: touch.x, y: touch.y, time: event.timeStamp };
  }
  if (touch.mode === "turn") dragGlobe(point.clientX, point.clientY, event.timeStamp);
  else push((point.clientY - touch.y) * 1.2);
  touch.x = point.clientX;
  touch.y = point.clientY;
}, { passive: true });
for (const type of ["touchend", "touchcancel"]) {
  window.addEventListener(type, (event) => {
    if (touch?.mode === "turn") letGo(event.timeStamp);
    touch = null;
  }, { passive: true });
}
document.documentElement.addEventListener("mouseleave", () => {
  mouse = null;
  hovered = -1;
});
window.addEventListener("resize", scheduleBuild);
document.fonts?.ready.then(buildScene);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && gpu) loadFlights();
});

gpu = setupGpu();
faceSun();
turnGlobe(0);
buildScene();
if (gpu) {
  earthMap.addEventListener("load", () => {
    uploadEarth();
    earthReady = Math.max(earthReady, 0.001);
  });
  earthMap.src = "earth.jpg";
  loadFlights();
  setInterval(() => {
    if (!document.hidden) loadFlights();
  }, FLIGHTS_REFRESH);
  requestAnimationFrame(drawFrame);
}
