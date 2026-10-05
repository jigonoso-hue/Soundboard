/* global DiceGeometry, Themes, prefs, Live */
// Dice: real 3D dice that tumble with physics (three.js draws them, cannon-es
// moves them), in a tray the size of the window. Matches the iPad app's
// DiceView.
//
// The tray opens from the toolbar (or the listener's stage). Pick dice, then
// click Roll (hold it to throw harder), or A / DA for a d20 with advantage or
// disadvantage. In a Live Session every roll shows on everyone's screen: each
// device throws the same dice in its own window, and as they come to rest the
// faces are renumbered so they land on the roller's real result. The roll log
// lists who rolled what.
import * as THREE from '../../node_modules/three/build/three.module.js';
import * as CANNON from '../../node_modules/cannon-es/dist/cannon-es.js';

const G = DiceGeometry;
const CAMERA_HEIGHT = 28;
const FOV = 30;
const GRAVITY = 60;
const SETTLE_FRAMES = 24;
const MAX_ROLL_MS = 9000;
const MAX_DICE = 40;
// The same sixteen colours as the iPad. In a Live Session no two people share one.
const DICE_COLORS = [
  ['Ruby', '#b3261e'], ['Sapphire', '#2a5bd7'], ['Jade', '#1f8a5b'], ['Amethyst', '#7b3fbf'],
  ['Amber', '#c47a12'], ['Onyx', '#1d1d24'], ['Ivory', '#e8e2d0'], ['Teal', '#0f8a8a'],
  ['Rose', '#d6457a'], ['Lime', '#7cb518'], ['Tangerine', '#e3611c'], ['Sky', '#4fb3e8'],
  ['Gold', '#d4a017'], ['Plum', '#5b2a6e'], ['Silver', '#9aa3ad'], ['Bronze', '#8a5a2b'],
];

// ---------------------------------------------------------------------------
// Faces: a texture per face, drawn on a canvas (the number, an inner bevel line).

const textures = new Map();

function inkFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? '#1b1b22' : '#fbf7ec';
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + amount * 255)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// texts: the number for the face, or (d4) one number per corner.
function faceTexture(kind, faceIndex, texts, color) {
  const key = `${kind}|${faceIndex}|${texts.join(',')}|${color}`;
  if (textures.has(key)) return textures.get(key);
  const die = G.build(kind);
  const face = die.faces[faceIndex];
  const uvs = G.faceUVs(die, face);
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const at = ([u, v]) => [u * size, (1 - v) * size];
  // Base colour with a soft light from the top left.
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, shade(color, 0.08));
  g.addColorStop(1, shade(color, -0.08));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // A bevel line just inside the edges.
  const cx = size / 2;
  const cy = size / 2;
  ctx.beginPath();
  uvs.forEach((uv, i) => {
    const [x, y] = at(uv);
    const ix = cx + (x - cx) * 0.9;
    const iy = cy + (y - cy) * 0.9;
    if (i) ctx.lineTo(ix, iy); else ctx.moveTo(ix, iy);
  });
  ctx.closePath();
  ctx.strokeStyle = shade(color, 0.16);
  ctx.lineWidth = 3;
  ctx.stroke();

  const ink = inkFor(color);
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const font = (px) => `700 ${px}px "Iowan Old Style", Palatino, Georgia, serif`;
  if (kind === 'd4') {
    // A number near each corner, its top towards the corner.
    texts.forEach((text, i) => {
      const [x, y] = at(uvs[i]);
      const px = cx + (x - cx) * 0.56;
      const py = cy + (y - cy) * 0.56;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.atan2(x - cx, cy - y));
      ctx.font = font(58);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    });
  } else {
    const text = texts[0];
    const px = { d6: 120, d8: 92, d10: 74, d10t: 62, d12: 92, d20: 74 }[kind] || 80;
    const y = kind === 'd8' || kind === 'd20' ? cy + 14 : (kind === 'd10' || kind === 'd10t' ? cy - 6 : cy);
    ctx.font = font(text.length > 1 ? px * 0.85 : px);
    ctx.fillText(text, cx, y);
    // Tell 6 from 9.
    if ((text === '6' || text === '9') && kind !== 'd6') {
      ctx.fillRect(cx - 18, y + px * 0.42, 36, 6);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  textures.set(key, texture);
  return texture;
}

const materialCache = new Map();
function material(kind, faceIndex, texts, color) {
  const key = `${kind}|${faceIndex}|${texts.join(',')}|${color}`;
  if (!materialCache.has(key)) {
    materialCache.set(key, new THREE.MeshStandardMaterial({
      map: faceTexture(kind, faceIndex, texts, color), roughness: 0.38, metalness: 0.08, transparent: true,
    }));
  }
  return materialCache.get(key);
}

// The materials for a die with numbers `values` (per face, or per corner on a d4).
function materialsFor(kind, values, color) {
  const die = G.build(kind);
  return die.faces.map((face, i) => {
    const texts = kind === 'd4'
      ? face.corners.map((corner) => String(values[corner]))
      : [G.label(kind, values[i])];
    return material(kind, i, texts, color);
  });
}

const geometryCache = new Map();
function geometry(kind) {
  if (geometryCache.has(kind)) return geometryCache.get(kind);
  const die = G.build(kind);
  const positions = [];
  const normals = [];
  const uvs = [];
  const geo = new THREE.BufferGeometry();
  let start = 0;
  die.faces.forEach((face, faceIndex) => {
    const corners = face.corners.map((i) => die.points[i]);
    const faceUVs = G.faceUVs(die, face);
    let count = 0;
    for (let k = 1; k < corners.length - 1; k++) {
      for (const j of [0, k, k + 1]) {
        positions.push(...corners[j]);
        normals.push(...face.normal);
        uvs.push(...faceUVs[j]);
        count++;
      }
    }
    geo.addGroup(start, count, faceIndex);
    start += count;
  });
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometryCache.set(kind, geo);
  return geo;
}

const shapeCache = new Map();
function shape(kind) {
  if (!shapeCache.has(kind)) {
    const die = G.build(kind);
    shapeCache.set(kind, new CANNON.ConvexPolyhedron({
      vertices: die.points.map((p) => new CANNON.Vec3(...p)),
      faces: die.faces.map((f) => f.corners),
    }));
  }
  return shapeCache.get(kind);
}

// ---------------------------------------------------------------------------
// Sound: a short click when dice hit something.

let audio = null;
let lastClack = 0;
function clack(strength) {
  const now = performance.now();
  if (now - lastClack < 35) return;
  lastClack = now;
  try {
    audio = audio || new AudioContext();
    const length = Math.floor(audio.sampleRate * 0.05);
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length * 0.12));
    const source = audio.createBufferSource();
    source.buffer = buffer;
    const filter = audio.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800 + Math.random() * 1600;
    filter.Q.value = 1.4;
    const gain = audio.createGain();
    gain.gain.value = Math.min(1, strength / 14) * 0.6 * (typeof prefs !== 'undefined' ? prefs.master : 1);
    source.connect(filter).connect(gain).connect(audio.destination);
    source.start();
  } catch { /* no sound */ }
}

// ---------------------------------------------------------------------------
// The scene: a floor the size of the window, walls at its edges, the dice.

class DiceScene {
  constructor(host) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    host.append(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 1, 100);
    this.camera.position.set(0, CAMERA_HEIGHT, 0.001);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-6, 20, -8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    sun.shadow.radius = 4;
    this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.35 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -GRAVITY, 0) });
    this.world.allowSleep = true;
    this.world.solver.iterations = 14;
    this.diceMaterial = new CANNON.Material('dice');
    const surface = new CANNON.Material('surface');
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.diceMaterial, surface, { friction: 0.25, restitution: 0.35 }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.diceMaterial, this.diceMaterial, { friction: 0.12, restitution: 0.45 }));
    this.surface = surface;
    const ground = new CANNON.Body({ mass: 0, material: surface, shape: new CANNON.Plane() });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(ground);
    this.walls = [];

    this.rolls = []; // { id, dice: [die], done, target, local, started, onDone, quietFrames }
    // Each person's dice only hit their own dice (and the tray), never someone else's.
    this.groups = new Map(); // owner -> collision group bit
    this.running = false;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
  }

  // The floor's half-width and half-depth visible on screen.
  extents() {
    const halfZ = CAMERA_HEIGHT * Math.tan((FOV / 2) * (Math.PI / 180));
    return { hx: halfZ * this.camera.aspect, hz: halfZ };
  }

  resize() {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const wall of this.walls) this.world.removeBody(wall);
    // Walls a little inside the screen's edges (dice are tall), and a lid.
    const { hx, hz } = this.extents();
    const inset = 1;
    const make = (x, z, rotY) => {
      const wall = new CANNON.Body({ mass: 0, material: this.surface, shape: new CANNON.Plane() });
      wall.position.set(x, 0, z);
      wall.quaternion.setFromEuler(0, rotY, 0);
      this.world.addBody(wall);
      return wall;
    };
    this.walls = [
      make(-hx + inset, 0, Math.PI / 2),
      make(hx - inset, 0, -Math.PI / 2),
      make(0, -hz + inset, 0),
      make(0, hz - inset, Math.PI),
    ];
    const lid = new CANNON.Body({ mass: 0, material: this.surface, shape: new CANNON.Plane() });
    lid.position.set(0, 12, 0);
    lid.quaternion.setFromEuler(Math.PI / 2, 0, 0);
    this.world.addBody(lid);
    this.walls.push(lid);
    this.render();
  }

  // Throws dice. spec: { id, color, kinds, dice: [{ p, h, v, w, q }], local, target, onDone }
  // p, v are fractions of the floor's half-size (so every screen gets the same throw).
  throw(spec) {
    // A new roll by the same person clears their last one.
    const owner = spec.owner;
    for (const roll of [...this.rolls]) if (roll.owner === owner) this.remove(roll);
    while (this.rolls.reduce((n, r) => n + r.dice.length, 0) + spec.kinds.length > MAX_DICE && this.rolls.length) this.remove(this.rolls[0]);
    const { hx, hz } = this.extents();
    const roll = { id: spec.id, owner, dice: [], done: false, target: spec.target || null, local: !!spec.local, started: performance.now(), onDone: spec.onDone, quietFrames: 0, nudges: 0 };
    spec.kinds.forEach((kind, i) => {
      const t = spec.dice[i];
      const values = G.defaultValues(kind);
      const mesh = new THREE.Mesh(geometry(kind), materialsFor(kind, values, spec.color));
      mesh.castShadow = true;
      this.scene.add(mesh);
      const group = this.groupFor(owner);
      const body = new CANNON.Body({
        mass: 1, material: this.diceMaterial, shape: shape(kind), angularDamping: 0.12, linearDamping: 0.05,
        collisionFilterGroup: group, collisionFilterMask: 1 | group,
      });
      body.sleepSpeedLimit = 0.15;
      body.sleepTimeLimit = 0.3;
      body.position.set(t.p[0] * (hx - 1.6), t.h, t.p[1] * (hz - 1.6));
      body.velocity.set(t.v[0] * hz, 0, t.v[1] * hz);
      body.angularVelocity.set(...t.w);
      body.quaternion.set(...t.q);
      body.addEventListener('collide', (e) => {
        const speed = Math.abs(e.contact.getImpactVelocityAlongNormal());
        if (speed > 2.5) clack(speed);
      });
      this.world.addBody(body);
      roll.dice.push({ kind, mesh, body, values, color: spec.color });
    });
    this.rolls.push(roll);
    this.start();
    return roll;
  }

  // A collision group of its own for each person rolling (bit 1 is the tray).
  groupFor(owner) {
    if (!this.groups.has(owner)) {
      const used = new Set(this.rolls.map((r) => this.groups.get(r.owner)));
      let bit = 2;
      for (let i = 1; i < 16; i++) { if (!used.has(1 << i)) { bit = 1 << i; break; } }
      this.groups.set(owner, bit);
    }
    return this.groups.get(owner);
  }

  remove(roll) {
    for (const die of roll.dice) {
      this.scene.remove(die.mesh);
      this.world.removeBody(die.body);
    }
    this.rolls = this.rolls.filter((r) => r !== roll);
  }

  clear() {
    for (const roll of [...this.rolls]) this.remove(roll);
    this.render();
  }

  // The result arrived for someone else's roll: land on it.
  setTarget(id, values) {
    const roll = this.rolls.find((r) => r.id === id);
    if (!roll) return;
    roll.target = values;
    if (roll.done) this.land(roll, true);
  }

  // Renumbers the remote dice so the faces now on top show the result. While
  // they're slowing down this happens out of sight on the sides that will land.
  land(roll, force) {
    if (!roll.target) return;
    roll.dice.forEach((die, i) => {
      const wanted = roll.target[i];
      if (wanted === undefined || wanted === null) return;
      const v = die.body.angularVelocity.length();
      if (!force && (v > 3 || die.body.velocity.length() > 3)) return;
      const q = die.body.quaternion;
      const { index } = G.top(die.kind, [q.x, q.y, q.z, q.w]);
      if (die.values[index] === wanted) return;
      die.values = G.relabel(die.kind, die.values, index, wanted);
      die.mesh.material = materialsFor(die.kind, die.values, die.color);
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.world.step(1 / 120, dt, 10);
      for (const roll of this.rolls) for (const die of roll.dice) {
        die.mesh.position.copy(die.body.position);
        die.mesh.quaternion.copy(die.body.quaternion);
      }
      this.check();
      this.render();
      if (this.rolls.some((r) => !r.done) || this.fading) requestAnimationFrame(tick);
      else this.running = false;
    };
    requestAnimationFrame(tick);
  }

  check() {
    const now = performance.now();
    for (const roll of this.rolls) {
      if (roll.done) continue;
      if (!roll.local) this.land(roll, false);
      const still = roll.dice.every((d) => d.body.sleepState === CANNON.Body.SLEEPING
        || (d.body.velocity.length() < 0.08 && d.body.angularVelocity.length() < 0.08));
      roll.quietFrames = still ? roll.quietFrames + 1 : 0;
      const timedOut = now - roll.started > MAX_ROLL_MS;
      if (roll.quietFrames < SETTLE_FRAMES && !timedOut) continue;
      if (roll.local && !timedOut && roll.nudges < 4) {
        // A die leaning on another or on a wall: give it a nudge.
        const cocked = roll.dice.filter((d) => {
          const q = d.body.quaternion;
          return !G.top(d.kind, [q.x, q.y, q.z, q.w]).flat;
        });
        if (cocked.length) {
          roll.nudges++;
          roll.quietFrames = 0;
          for (const d of cocked) {
            d.body.wakeUp();
            d.body.velocity.set((Math.random() - 0.5) * 3, 6, (Math.random() - 0.5) * 3);
            d.body.angularVelocity.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
          }
          continue;
        }
      }
      roll.done = true;
      if (roll.local) {
        const values = roll.dice.map((d) => {
          const q = d.body.quaternion;
          return G.read(d.kind, [q.x, q.y, q.z, q.w], d.values).value;
        });
        roll.onDone?.(values);
      } else {
        this.land(roll, true);
        roll.onDone?.(roll.target);
      }
    }
  }

  // Where a die sits on screen, in the layer's pixels.
  screenPosition(id, index) {
    const die = this.rolls.find((r) => r.id === id)?.dice[index];
    if (!die) return null;
    const v = die.mesh.position.clone().project(this.camera);
    return { x: (v.x + 1) / 2 * this.host.clientWidth, y: (1 - v.y) / 2 * this.host.clientHeight };
  }

  // Dims the d20 that didn't count in an advantage or disadvantage roll.
  dim(id, index) {
    const roll = this.rolls.find((r) => r.id === id);
    const die = roll?.dice[index];
    if (!die) return;
    die.mesh.material = die.mesh.material.map((m) => {
      const c = m.clone();
      c.opacity = 0.35;
      return c;
    });
    this.render();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

// ---------------------------------------------------------------------------
// The tray: the window-sized layer with the controls, the result banner and the log.

const $ = (sel) => document.querySelector(sel);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const SETTINGS_KEY = 'dice';
function loadSettings() {
  const defaults = { counts: { d20: 1 }, modifier: 0, color: DICE_COLORS[0][1] };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return defaults; }
}
const settings = loadSettings();
const save = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } };

const layer = el('section', 'dice-layer hidden');
layer.id = 'dice-layer';
layer.setAttribute('aria-label', 'Dice');
const canvasHost = el('div', 'dice-canvas');
const fxCanvas = el('canvas', 'dice-fx');
const banner = el('div', 'dice-banner hidden');
banner.id = 'dice-banner';
const ui = el('div', 'dice-ui');
const top = el('header', 'dice-top');
const logPanel = el('aside', 'dice-log hidden');
logPanel.id = 'dice-log';
layer.append(canvasHost, fxCanvas, banner, top, ui, logPanel);
document.body.append(layer);

let scene = null;
let mode = 'closed'; // closed | tray | watch
let watchTimer = null;
const log = []; // { id, by, title, detail, total, at, mine }
let nextId = 1;

function ensureScene() {
  if (!scene) scene = new DiceScene(canvasHost);
  return scene;
}

function setMode(next) {
  mode = next;
  layer.classList.toggle('hidden', next === 'closed');
  layer.classList.toggle('tray', next === 'tray');
  layer.classList.toggle('watch', next === 'watch');
  if (next !== 'closed') { ensureScene().resize(); }
  if (next === 'closed' && scene) scene.clear();
}

function open() {
  clearTimeout(watchTimer);
  setMode('tray');
  renderUI();
  renderLog();
}

function close() {
  setMode('closed');
  banner.classList.add('hidden');
}

// Someone else's roll while the tray is closed: the dice tumble over whatever
// is on screen, then fade away.
function watch() {
  if (mode === 'tray') return;
  clearTimeout(watchTimer);
  setMode('watch');
}
function endWatch(delay = 4500) {
  if (mode !== 'watch') return;
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => { if (mode === 'watch') { layer.classList.add('fading'); setTimeout(() => { layer.classList.remove('fading'); if (mode === 'watch') close(); }, 600); } }, delay);
}

function showBanner(entry) {
  banner.textContent = '';
  banner.append(el('div', 'dice-banner-who', `🎲 ${entry.by}`), el('div', 'dice-banner-title', entry.title), el('div', 'dice-banner-total', String(entry.total)), el('div', 'dice-banner-detail', entry.detail));
  banner.classList.remove('hidden');
  banner.classList.remove('pop');
  void banner.offsetWidth;
  banner.classList.add('pop');
}

function addLog(entry) {
  if (log.some((e) => e.id === entry.id)) return;
  log.unshift(entry);
  if (log.length > 100) log.pop();
  renderLog();
}

// ---- Throwing ----

// A random throw from the bottom of the screen towards the top, harder with strength (1–3).
function makeThrow(count, strength) {
  const rand = (a, b) => a + Math.random() * (b - a);
  const dice = [];
  for (let i = 0; i < count; i++) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 6.3), rand(0, 6.3), rand(0, 6.3)));
    dice.push({
      p: [rand(-0.7, 0.7), rand(0.55, 0.85)],
      h: rand(2, 4.5),
      v: [rand(-0.5, 0.5) * strength, -rand(1.1, 1.7) * strength],
      w: [rand(-1, 1) * 14 * strength, rand(-1, 1) * 14 * strength, rand(-1, 1) * 14 * strength],
      q: [q.x, q.y, q.z, q.w],
    });
  }
  return dice;
}

function myName() {
  if (typeof Live !== 'undefined' && Live.myName) return Live.myName();
  return 'You';
}

// In a Live Session: who has which colour ([{ peer, name, color }]) and which
// entry is this device. null when not in a session.
let sessionColors = null;
let myPeer = null;

function inSession() { return sessionColors !== null; }
function myColor() {
  if (!inSession()) return settings.color;
  return sessionColors.find((c) => c.peer === myPeer)?.color || null;
}
function takenBy(hex) {
  return inSession() ? sessionColors.find((c) => c.color === hex && c.peer !== myPeer) : null;
}

// The colour list from the session (or null when it ends). If you haven't a
// colour yet, ask for the one you used last, if it's free.
function setSessionColors(list, you) {
  const was = inSession();
  sessionColors = Array.isArray(list) ? list : null;
  myPeer = you || null;
  if (inSession() && !myColor() && !was && !takenBy(settings.color)) claim(settings.color);
  if (mode === 'tray') renderUI();
}

function claim(hex) {
  if (inSession()) { if (typeof Live !== 'undefined') Live.claimColor(hex); }
  settings.color = hex;
  save();
  renderUI();
}

// Rolls the chosen dice (or 2d20 for advantage / disadvantage).
function roll(rollMode = 'normal', strength = 1) {
  const { groups, kinds } = G.plan(settings.counts, rollMode);
  if (!kinds.length) return;
  const color = myColor();
  if (!color) {
    // Everyone needs their own colour, so the table can tell whose dice are whose.
    if (mode !== 'tray') open();
    // After this click has finished (a click elsewhere closes the picker).
    setTimeout(() => { colorsOpen = true; renderUI(); }, 0);
    layer.classList.add('need-color');
    setTimeout(() => layer.classList.remove('need-color'), 1600);
    return;
  }
  const id = `${Date.now().toString(36)}-${(nextId++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const start = {
    id, by: myName(), mode: rollMode, modifier: settings.modifier, groups, kinds,
    color, dice: makeThrow(kinds.length, strength),
  };
  mine.add(id);
  const s = ensureScene();
  if (mode === 'closed' || mode === 'watch') open();
  banner.classList.add('hidden');
  s.throw({
    id, owner: 'me', kinds, dice: start.dice, color: start.color, local: true,
    onDone: (values) => {
      const summary = G.summarize(start, values);
      const entry = { id, by: start.by, title: summary.title, detail: summary.detail, total: summary.total, at: Date.now(), mine: true };
      if (summary.kept !== null) dimDropped(id, start, summary);
      celebrate(id, start, summary);
      addLog(entry);
      showBanner(entry);
      if (typeof Live !== 'undefined') Live.rollResult({ id, values });
    },
  });
  if (typeof Live !== 'undefined') Live.rollStart(start);
}

// ---- Natural 1s and 20s ----

// The d20s that count: all of them, or the kept one with advantage / disadvantage.
function countedD20s(start, summary) {
  const dice = [];
  start.groups.forEach((g, i) => {
    if (g.type !== 'd20') return;
    if (summary.kept !== null && summary.scores.indexOf(summary.kept) !== i) return;
    dice.push({ index: g.dice[0], score: summary.scores[i] });
  });
  return dice;
}

// A skull and crossbones over a natural 1; fireworks over a natural 20.
function celebrate(id, start, summary) {
  for (const { index, score } of countedD20s(start, summary)) {
    if (score !== 1 && score !== 20) continue;
    const at = scene?.screenPosition(id, index);
    if (!at) continue;
    if (score === 1) skull(at); else fireworks(at);
  }
}

function skull(at) {
  const mark = el('div', 'dice-skull', '☠️');
  mark.style.left = `${at.x}px`;
  mark.style.top = `${at.y}px`;
  mark.setAttribute('aria-label', 'Natural 1');
  layer.append(mark);
  setTimeout(() => mark.remove(), 3200);
}

const sparks = [];
let fxFrame = 0;
function fireworks(at) {
  const colors = ['#fff6c8', '#ffd27a', '#ffffff', '#ffb347', '#9be7ff', '#ff9ecf'];
  // Three bursts: one at the die, two just around it.
  [[0, 0, 0], [-70, -50, 260], [80, -30, 520]].forEach(([dx, dy, delay]) => {
    setTimeout(() => {
      const color = colors[Math.floor(Math.random() * colors.length)];
      for (let i = 0; i < 42; i++) {
        const angle = (i / 42) * Math.PI * 2 + Math.random() * 0.2;
        const speed = 90 + Math.random() * 120;
        sparks.push({
          x: at.x + dx, y: at.y + dy - 40, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 40,
          life: 0, max: 1 + Math.random() * 0.5, color: Math.random() < 0.3 ? '#ffffff' : color, size: 1.5 + Math.random() * 1.8,
        });
      }
      if (!fxFrame) { last = performance.now(); fxFrame = requestAnimationFrame(drawSparks); }
    }, delay);
  });
}

let last = 0;
function drawSparks(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const w = layer.clientWidth;
  const h = layer.clientHeight;
  const scale = Math.min(2, window.devicePixelRatio || 1);
  if (fxCanvas.width !== Math.round(w * scale)) { fxCanvas.width = Math.round(w * scale); fxCanvas.height = Math.round(h * scale); }
  const ctx = fxCanvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i];
    p.life += dt;
    if (p.life > p.max) { sparks.splice(i, 1); continue; }
    p.vy += 140 * dt;
    p.vx *= 0.985;
    p.vy *= 0.985;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const fade = 1 - p.life / p.max;
    ctx.globalAlpha = fade;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.6 + fade * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (sparks.length) fxFrame = requestAnimationFrame(drawSparks);
  else { fxFrame = 0; ctx.clearRect(0, 0, w, h); }
}

function dimDropped(id, start, summary) {
  const keptIndex = summary.scores.indexOf(summary.kept);
  start.groups.forEach((g, i) => { if (i !== keptIndex) scene.dim(id, g.dice[0]); });
}

// ---- Rolls from the Live Session ----

const remote = new Map(); // id -> start message
const mine = new Set(); // this device's roll ids (the session echoes them back)

function remoteStart(msg) {
  if (!msg || !msg.id || mine.has(msg.id) || remote.has(msg.id) || log.some((e) => e.id === msg.id)) return;
  remote.set(msg.id, msg);
  if (remote.size > 50) remote.delete(remote.keys().next().value);
  watch();
  ensureScene().throw({
    id: msg.id, owner: msg.by || 'someone', kinds: msg.kinds, dice: msg.dice, color: msg.color || DICE_COLORS[1][1], local: false,
    onDone: (values) => finishRemote(msg.id, values),
  });
}

function remoteResult(msg) {
  const start = remote.get(msg.id);
  if (!start) return;
  start.values = msg.values;
  if (scene) scene.setTarget(msg.id, msg.values);
}

function finishRemote(id, values) {
  const start = remote.get(id);
  if (!start || !values || start.finished) return;
  start.finished = true;
  const summary = G.summarize(start, values);
  const entry = { id, by: start.by || 'Someone', title: summary.title, detail: summary.detail, total: summary.total, at: Date.now(), mine: false };
  if (summary.kept !== null) dimDropped(id, start, summary);
  celebrate(id, start, summary);
  addLog(entry);
  showBanner(entry);
  endWatch();
}

// A result can arrive after the dice have stopped: land them then.
function remoteResultLate(msg) {
  remoteResult(msg);
  const start = remote.get(msg.id);
  const rollObj = scene?.rolls.find((r) => r.id === msg.id);
  if (start && rollObj && rollObj.done) finishRemote(msg.id, msg.values);
}

// Rolls that happened before this device joined (no dice, just the log).
function setHistory(list) {
  for (const item of list || []) {
    if (!item || !item.id || log.some((e) => e.id === item.id)) continue;
    const start = { mode: item.mode, modifier: item.modifier, groups: item.groups };
    try {
      const summary = G.summarize(start, item.values);
      log.push({ id: item.id, by: item.by, title: summary.title, detail: summary.detail, total: summary.total, at: item.at || Date.now(), mine: false });
    } catch { /* skip */ }
  }
  log.sort((a, b) => b.at - a.at);
  renderLog();
}

function resetLog() {
  log.length = 0;
  remote.clear();
  renderLog();
}

// ---- Controls ----

let charge = null; // { started, timer }
let colorsOpen = false; // the colour picker is showing
document.addEventListener('click', () => { if (colorsOpen) { colorsOpen = false; renderUI(); } });

function renderUI() {
  top.textContent = '';
  top.append(el('div', 'dice-title', 'Dice'));
  // One swatch with your colour; click it to choose from all of them.
  const colors = el('div', 'dice-colors');
  const current = myColor();
  const currentName = DICE_COLORS.find(([, hex]) => hex === current)?.[0];
  const toggle = el('button', 'dice-color-current');
  toggle.type = 'button';
  toggle.title = current ? `Your dice: ${currentName}. Click to change.` : 'Pick your dice colour';
  toggle.setAttribute('aria-expanded', String(colorsOpen));
  const dot = el('span', 'dice-color-dot');
  if (current) dot.style.background = current; else dot.classList.add('none');
  toggle.append(dot, el('span', null, current ? currentName : 'Pick your dice colour'), el('span', 'dice-color-caret', colorsOpen ? '▴' : '▾'));
  toggle.addEventListener('click', (e) => { e.stopPropagation(); colorsOpen = !colorsOpen; renderUI(); });
  colors.append(toggle);
  if (colorsOpen) {
    const picker = el('div', 'dice-color-picker');
    picker.addEventListener('click', (e) => e.stopPropagation());
    for (const [name, hex] of DICE_COLORS) {
      const owner = takenBy(hex);
      const b = el('button', `dice-color${current === hex ? ' selected' : ''}${owner ? ' taken' : ''}`);
      b.type = 'button';
      b.title = owner ? `${name}: ${owner.name}'s dice` : `${name} dice`;
      b.style.background = hex;
      b.disabled = !!owner;
      b.addEventListener('click', () => { colorsOpen = false; claim(hex); });
      picker.append(b);
    }
    colors.append(picker);
  }
  const logButton = el('button', 'dice-pill', log.length ? `Log · ${log.length}` : 'Log');
  logButton.type = 'button';
  logButton.addEventListener('click', () => { logPanel.classList.toggle('hidden'); renderLog(); });
  const closeButton = el('button', 'dice-pill', 'Close');
  closeButton.type = 'button';
  closeButton.title = 'Close the dice (Esc)';
  closeButton.addEventListener('click', close);
  top.append(colors, el('span', 'spacer'), logButton, closeButton);

  ui.textContent = '';
  const pool = el('div', 'dice-pool');
  for (const type of G.TYPES) {
    const count = settings.counts[type] || 0;
    const b = el('button', `dice-type${count ? ' on' : ''}`);
    b.type = 'button';
    b.title = `Add a ${type} (right-click to remove one)`;
    b.append(el('span', 'dice-type-name', type));
    if (count) b.append(el('span', 'dice-count', String(count)));
    b.addEventListener('click', () => { settings.counts[type] = Math.min(10, count + 1); save(); renderUI(); });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); settings.counts[type] = Math.max(0, count - 1); save(); renderUI(); });
    pool.append(b);
  }
  const clear = el('button', 'dice-pill', 'Clear');
  clear.type = 'button';
  clear.addEventListener('click', () => { settings.counts = {}; save(); renderUI(); });
  pool.append(clear);

  const actions = el('div', 'dice-actions');
  const mod = el('div', 'dice-mod');
  const minus = el('button', 'dice-pill', '−');
  minus.type = 'button';
  minus.title = 'Lower the modifier';
  minus.addEventListener('click', () => { settings.modifier = Math.max(-30, settings.modifier - 1); save(); renderUI(); });
  const plus = el('button', 'dice-pill', '+');
  plus.type = 'button';
  plus.title = 'Raise the modifier';
  plus.addEventListener('click', () => { settings.modifier = Math.min(30, settings.modifier + 1); save(); renderUI(); });
  const value = el('span', 'dice-mod-value', settings.modifier > 0 ? `+${settings.modifier}` : String(settings.modifier));
  value.title = 'Modifier';
  mod.append(minus, value, plus);

  const adv = el('button', 'dice-adv', 'A');
  adv.type = 'button';
  adv.title = 'Advantage: roll two d20s and keep the higher';
  adv.addEventListener('click', () => roll('adv'));
  const dis = el('button', 'dice-dis', 'DA');
  dis.type = 'button';
  dis.title = 'Disadvantage: roll two d20s and keep the lower';
  dis.addEventListener('click', () => roll('dis'));

  const go = el('button', 'dice-roll');
  go.type = 'button';
  go.id = 'dice-roll';
  go.title = 'Click to roll, or hold to throw harder';
  const ring = el('span', 'dice-charge');
  go.append(ring, el('span', 'dice-roll-text', `Roll ${G.describe(settings.counts, settings.modifier)}`));
  go.disabled = !G.plan(settings.counts).kinds.length;
  // Hold to throw harder: strength grows from 1 to 3 over a second and a half.
  const begin = (e) => {
    if (go.disabled || e.button > 0) return;
    charge = { started: performance.now() };
    go.classList.add('charging');
    const grow = () => {
      if (!charge) return;
      const f = Math.min(1, (performance.now() - charge.started) / 1500);
      ring.style.setProperty('--charge', String(f));
      charge.frame = requestAnimationFrame(grow);
    };
    grow();
  };
  const release = () => {
    if (!charge) return;
    cancelAnimationFrame(charge.frame);
    const f = Math.min(1, (performance.now() - charge.started) / 1500);
    charge = null;
    go.classList.remove('charging');
    ring.style.setProperty('--charge', '0');
    roll('normal', 1 + 2 * f);
  };
  go.addEventListener('pointerdown', begin);
  go.addEventListener('pointerup', release);
  go.addEventListener('pointerleave', () => { if (charge) release(); });
  go.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); roll('normal', 1); } });

  actions.append(mod, adv, dis, go);
  ui.append(pool, actions);
}

function renderLog() {
  logPanel.textContent = '';
  logPanel.append(el('div', 'dice-log-title', 'Roll log'));
  if (!log.length) logPanel.append(el('p', 'dice-log-empty', 'No rolls yet.'));
  for (const entry of log) {
    const row = el('div', `dice-log-row${entry.mine ? ' mine' : ''}`);
    const head = el('div', 'dice-log-head');
    head.append(el('b', null, entry.by), el('span', 'dice-log-time', new Date(entry.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })));
    row.append(head, el('div', 'dice-log-what', entry.title), el('div', 'dice-log-detail', entry.detail));
    logPanel.append(row);
  }
  const button = top.querySelector('.dice-pill');
  if (button && mode === 'tray') button.textContent = log.length ? `Log · ${log.length}` : 'Log';
}

document.addEventListener('keydown', (e) => {
  if (mode === 'tray' && e.key === 'Escape' && !document.querySelector('dialog[open]')) { e.preventDefault(); close(); }
});

window.DiceTray = {
  open, close, roll, remoteStart, remoteResult: remoteResultLate, setHistory, resetLog, setSessionColors,
  preferredColor: () => settings.color,
  isOpen: () => mode === 'tray', log: () => log,
  // For trying the effects: DiceTray.effect(1 | 20).
  effect: (n) => { const at = { x: layer.clientWidth / 2, y: layer.clientHeight / 2 }; if (n === 1) skull(at); else fireworks(at); },
};
if (typeof Themes !== 'undefined') Themes.onChange(() => { /* the tray's backdrop is repainted by Themes */ });
window.dispatchEvent(new Event('dice-ready'));
