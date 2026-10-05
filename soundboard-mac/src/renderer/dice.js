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
  if (kind === 'coin') {
    // A coin's flat faces: a raised ring and HEADS or TAILS; its edge is plain.
    if (face.value) {
      ctx.strokeStyle = shade(color, 0.22);
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = font(96);
      ctx.fillText(face.value === 1 ? '★' : '⚜', cx, cy - 18);
      fitText(ctx, texts[0].toUpperCase(), cx, cy + 62, size * 0.62, 40, font);
    }
  } else if (texts.some((t) => t.length > 3 || /[^0-9+−\-]/.test(t)) && kind !== 'd4') {
    // Words (custom dice): as large as fits, on up to two lines.
    const text = texts[0];
    const width = { d6: 0.74, d8: 0.5, d10: 0.42, d12: 0.6, d20: 0.46 }[kind] || 0.5;
    const y = kind === 'd8' || kind === 'd20' ? cy + 16 : (kind === 'd10' ? cy - 4 : cy);
    fitText(ctx, text, cx, y, size * width, { d6: 86, d8: 64, d10: 56, d12: 64, d20: 56 }[kind] || 56, font);
  } else if (kind === 'd4') {
    // A number near each corner, its top towards the corner.
    texts.forEach((text, i) => {
      const [x, y] = at(uvs[i]);
      const px = cx + (x - cx) * 0.56;
      const py = cy + (y - cy) * 0.56;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.atan2(x - cx, cy - y));
      // Words (a custom d4) shrink to fit.
      fitText(ctx, text, 0, 0, size * 0.3, 58, font);
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

// Writes text centred at (x, y), as large as fits in `width` (up to `px`), on
// one line or, if it has spaces, two.
function fitText(ctx, text, x, y, width, px, font) {
  if (!text) return;
  let size = px;
  ctx.font = font(size);
  let lines = [text];
  if (ctx.measureText(text).width > width && text.includes(' ')) {
    const words = text.split(' ');
    let best = [text];
    let bestWidth = Infinity;
    for (let i = 1; i < words.length; i++) {
      const pair = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
      const w = Math.max(...pair.map((l) => ctx.measureText(l).width));
      if (w < bestWidth) { bestWidth = w; best = pair; }
    }
    lines = best;
  }
  while (size > 16 && Math.max(...lines.map((l) => ctx.measureText(l).width)) > width) {
    size -= 2;
    ctx.font = font(size);
  }
  const step = size * 1.05;
  lines.forEach((line, i) => ctx.fillText(line, x, y + (i - (lines.length - 1) / 2) * step));
}

const materialCache = new Map();
function material(kind, faceIndex, texts, color) {
  const key = `${kind}|${faceIndex}|${texts.join(',')}|${color}`;
  if (!materialCache.has(key)) {
    const coin = kind === 'coin';
    materialCache.set(key, new THREE.MeshStandardMaterial({
      map: faceTexture(kind, faceIndex, texts, color),
      roughness: coin ? 0.32 : 0.38, metalness: coin ? 0.55 : 0.08, transparent: true,
    }));
  }
  return materialCache.get(key);
}

// The text on each face of a die showing numbers `values` (per face, or per
// corner on a d4). look: { custom: a custom die's words, blank: no numbers
// at all (someone else's hidden roll) }.
function faceTexts(kind, values, look = {}) {
  const die = G.build(kind);
  return die.faces.map((face, i) => {
    if (look.blank) return kind === 'd4' ? ['', '', ''] : [''];
    if (kind === 'd4') return face.corners.map((corner) => (look.custom ? G.customLabel(look.custom, values[corner]) : String(values[corner])));
    if (look.custom) return [G.customLabel(look.custom, values[i])];
    return [G.label(kind, values[i])];
  });
}

function materialsFor(kind, values, color, look) {
  return faceTexts(kind, values, look).map((texts, i) => material(kind, i, texts, color));
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
      const look = spec.looks?.[i] || {};
      const mesh = new THREE.Mesh(geometry(kind), materialsFor(kind, values, spec.color, look));
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
      roll.dice.push({ kind, mesh, body, values, color: spec.color, look });
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
      die.mesh.material = materialsFor(die.kind, die.values, die.color, die.look);
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
  const defaults = { counts: { d20: 1 }, modifier: 0, color: DICE_COLORS[0][1], customDice: [], initiativeModifier: 0 };
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
// The side panel: the roll log, statistics, custom dice, or the broadcaster's table.
const sidePanel = el('aside', 'dice-log hidden');
sidePanel.id = 'dice-log';
layer.append(canvasHost, fxCanvas, banner, top, ui, sidePanel);
document.body.append(layer);

let scene = null;
let mode = 'closed'; // closed | tray | watch
let watchTimer = null;
// { id, by, title, detail, total, at, mine, hidden, ask, d20s, nat20, nat1 }
const log = [];
let nextId = 1;
let panel = null; // which side panel is open: 'log' | 'stats' | 'custom' | a registered one
const panels = new Map(); // extra panels (the broadcaster's table): name -> { label, render, visible }
const resultHooks = new Set();
const naturalHooks = new Set();

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

function open(withPanel) {
  clearTimeout(watchTimer);
  setMode('tray');
  if (withPanel) panel = withPanel;
  renderUI();
  renderPanel();
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
  const words = entry.total === null || entry.total === undefined;
  banner.append(
    el('div', 'dice-banner-who', `🎲 ${entry.by}${entry.hidden ? ' · hidden' : ''}`),
    el('div', 'dice-banner-title', entry.title),
    el('div', `dice-banner-total${words ? ' words' : ''}`, words ? entry.detail : String(entry.total)),
  );
  if (!words) banner.append(el('div', 'dice-banner-detail', entry.detail));
  banner.classList.remove('hidden');
  banner.classList.remove('pop');
  void banner.offsetWidth;
  banner.classList.add('pop');
}

// A finished roll, for the log: its numbers plus what the statistics need.
function makeEntry(id, start, values, summary, mine) {
  const counted = G.countedD20s(start, values);
  return {
    id, by: start.by || 'Someone', title: summary.title, detail: summary.detail, total: summary.total,
    at: Date.now(), mine, hidden: !!start.hidden, ask: start.ask || null,
    d20s: G.d20s(start, values), nat20: counted.filter((v) => v === 20).length, nat1: counted.filter((v) => v === 1).length,
  };
}

function addLog(entry) {
  if (log.some((e) => e.id === entry.id)) return;
  log.unshift(entry);
  if (log.length > 200) log.pop();
  if (panel === 'log' || panel === 'stats') renderPanel();
  renderTopCounts();
}

function finished(id, start, values, summary, entry) {
  for (const hook of resultHooks) {
    try { hook({ id, start, values, summary, entry }); } catch (err) { console.error(err); }
  }
}

// ---- Custom dice ----

// Your own custom dice, the broadcaster's (in a session), then the ready-made ones.
let sharedCustom = [];
function allCustom() {
  const seen = new Set();
  const out = [];
  for (const def of [...settings.customDice, ...sharedCustom, ...G.PRESETS]) {
    if (!def || seen.has(def.id)) continue;
    seen.add(def.id);
    out.push(def);
  }
  return out;
}
function customById(id) { return allCustom().find((d) => d.id === id); }

// ---- Throwing ----

// A random throw from the bottom of the screen towards the top, harder with strength (1–3).
function makeThrow(kinds, strength) {
  const rand = (a, b) => a + Math.random() * (b - a);
  return kinds.map((kind) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 6.3), rand(0, 6.3), rand(0, 6.3)));
    // Coins flip end over end.
    const spin = kind === 'coin' ? [rand(18, 26) * (Math.random() < 0.5 ? -1 : 1), rand(-3, 3), rand(-4, 4)] : [rand(-1, 1) * 14, rand(-1, 1) * 14, rand(-1, 1) * 14];
    return {
      p: [rand(-0.7, 0.7), rand(0.55, 0.85)],
      h: rand(2, 4.5),
      v: [rand(-0.5, 0.5) * strength, -rand(1.1, 1.7) * strength],
      w: spin.map((x) => x * strength),
      q: [q.x, q.y, q.z, q.w],
    };
  });
}

// How each die of a roll looks: a custom die's words, or (someone else's
// hidden roll) no numbers at all.
function looksFor(start, blank) {
  const looks = start.kinds.map(() => (blank ? { blank: true } : {}));
  if (blank) return looks;
  const defs = new Map((start.custom || []).map((d) => [d.id, d]));
  for (const g of start.groups) {
    if (g.type === 'custom' && defs.has(g.die)) for (const i of g.dice) looks[i] = { custom: defs.get(g.die) };
  }
  return looks;
}

function myName() {
  if (typeof Live !== 'undefined' && Live.myName) return Live.myName();
  return 'You';
}
const hosting = () => typeof Live !== 'undefined' && Live.hosting && Live.hosting();

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
  if (!inSession()) { sharedCustom = []; hiddenArmed = false; }
  if (inSession() && !myColor() && !was && !takenBy(settings.color)) claim(settings.color);
  if (mode === 'tray') renderUI();
}

function claim(hex) {
  if (inSession()) { if (typeof Live !== 'undefined') Live.claimColor(hex); }
  settings.color = hex;
  save();
  renderUI();
}

// Hidden: the broadcaster's next roll shows everyone the dice but not the numbers.
let hiddenArmed = false;

// Rolls the chosen dice (or 2d20 for advantage / disadvantage).
// options: { counts, modifier, ask, by, owner, hidden } override the tray's own
// (a roll request, an enemy's initiative).
function roll(rollMode = 'normal', strength = 1, options = {}) {
  const counts = options.counts || settings.counts;
  const modifier = options.modifier ?? settings.modifier;
  const { groups, kinds, custom } = G.plan(counts, rollMode, allCustom());
  if (!kinds.length) return null;
  const color = myColor();
  if (!color) {
    // Everyone needs their own colour, so the table can tell whose dice are whose.
    if (mode !== 'tray') open();
    // After this click has finished (a click elsewhere closes the picker).
    setTimeout(() => { colorsOpen = true; renderUI(); }, 0);
    layer.classList.add('need-color');
    setTimeout(() => layer.classList.remove('need-color'), 1600);
    return null;
  }
  const hidden = !!(options.hidden ?? (hiddenArmed && hosting()));
  if (hiddenArmed && options.hidden === undefined) { hiddenArmed = false; }
  const id = `${Date.now().toString(36)}-${(nextId++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const start = {
    id, by: options.by || myName(), mode: rollMode, modifier, groups, kinds,
    color, dice: makeThrow(kinds, strength),
  };
  if (custom.length) start.custom = custom;
  if (options.ask) start.ask = options.ask;
  if (hidden) start.hidden = true;
  mine.add(id);
  const s = ensureScene();
  if (mode === 'closed' || mode === 'watch') open();
  banner.classList.add('hidden');
  s.throw({
    id, owner: options.owner || options.by || 'me', kinds, dice: start.dice, color, local: true, looks: looksFor(start, false),
    onDone: (values) => {
      const summary = G.summarize(start, values);
      const entry = makeEntry(id, start, values, summary, true);
      if (summary.kept !== null) dimDropped(id, start, summary);
      celebrate(id, start, summary);
      addLog(entry);
      showBanner(entry);
      if (typeof Live !== 'undefined') Live.rollResult({ id, values });
      finished(id, start, values, summary, entry);
    },
  });
  if (typeof Live !== 'undefined') Live.rollStart(start);
  renderUI();
  return id;
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
    if (at) { if (score === 1) skull(at); else fireworks(at); }
    if (!start.hidden) for (const hook of naturalHooks) { try { hook(score, start); } catch (err) { console.error(err); } }
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
    // The broadcaster's hidden roll: you see the dice, never the numbers.
    looks: looksFor(msg, !!msg.hidden),
    onDone: (values) => {
      if (msg.hidden) { endWatch(1500); return; }
      finishRemote(msg.id, values);
    },
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
  const entry = makeEntry(id, start, values, summary, false);
  if (summary.kept !== null) dimDropped(id, start, summary);
  celebrate(id, start, summary);
  addLog(entry);
  showBanner(entry);
  endWatch();
  finished(id, start, values, summary, entry);
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
    const start = { mode: item.mode, modifier: item.modifier, groups: item.groups, custom: item.custom, by: item.by, ask: item.ask };
    try {
      const entry = makeEntry(item.id, start, item.values, G.summarize(start, item.values), false);
      entry.at = item.at || Date.now();
      log.push(entry);
    } catch { /* skip */ }
  }
  log.sort((a, b) => b.at - a.at);
  renderPanel();
}

function resetLog() {
  log.length = 0;
  remote.clear();
  renderPanel();
}

// ---- Statistics ----

function statsView(title) {
  const box = el('div', 'dice-stats');
  if (title) box.append(el('div', 'dice-log-title', title));
  // Hidden rolls only count on the broadcaster's own device.
  const { people, luckiest, unluckiest } = G.stats(log);
  if (!people.length) { box.append(el('p', 'dice-log-empty', 'No rolls yet.')); return box; }
  if (luckiest) {
    const badges = el('div', 'dice-stats-badges');
    badges.append(el('div', 'dice-badge lucky', `🍀 Luckiest: ${luckiest}`), el('div', 'dice-badge unlucky', `🌧 Unluckiest: ${unluckiest}`));
    box.append(badges);
  }
  const table = el('table', 'dice-stats-table');
  const head = el('tr');
  for (const h of ['', 'Rolls', 'd20 avg', '20s', '1s']) head.append(el('th', null, h));
  table.append(head);
  for (const p of people) {
    const row = el('tr');
    row.append(el('td', 'who', p.name), el('td', null, String(p.rolls)), el('td', null, p.average === null ? '—' : String(p.average)),
      el('td', 'nat20', String(p.nat20)), el('td', 'nat1', String(p.nat1)));
    table.append(row);
  }
  box.append(table);
  return box;
}

// The end-of-session recap: everyone's numbers, the luckiest and unluckiest.
function showRecap() {
  if (!log.length) return;
  const overlay = el('div', 'dice-recap');
  const card = el('div', 'dice-recap-card');
  card.append(el('div', 'dice-recap-title', '🎲 Session recap'), statsView(null));
  const done = el('button', 'primary', 'Done');
  done.type = 'button';
  done.addEventListener('click', () => overlay.remove());
  card.append(done);
  overlay.append(card);
  document.body.append(overlay);
}

// ---- Panels ----

function togglePanel(name) {
  panel = panel === name ? null : name;
  renderUI();
  renderPanel();
}

function renderPanel() {
  sidePanel.classList.toggle('hidden', !panel || mode !== 'tray');
  sidePanel.classList.toggle('wide', panel !== 'log' && panel !== 'stats');
  sidePanel.textContent = '';
  if (!panel) return;
  if (panel === 'log') renderLog();
  else if (panel === 'stats') sidePanel.append(statsView('Statistics'));
  else if (panel === 'custom') renderCustom();
  else if (panels.has(panel)) panels.get(panel).render(sidePanel);
}

function renderLog() {
  sidePanel.append(el('div', 'dice-log-title', 'Roll log'));
  if (!log.length) sidePanel.append(el('p', 'dice-log-empty', 'No rolls yet.'));
  for (const entry of log) {
    const row = el('div', `dice-log-row${entry.mine ? ' mine' : ''}`);
    const head = el('div', 'dice-log-head');
    head.append(el('b', null, entry.by + (entry.hidden ? ' 🙈' : '')), el('span', 'dice-log-time', new Date(entry.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })));
    row.append(head, el('div', 'dice-log-what', entry.title), el('div', 'dice-log-detail', entry.detail));
    sidePanel.append(row);
  }
}

// Custom dice: yours (to edit), the broadcaster's and the ready-made ones.
let editing = null; // the custom die being edited
function renderCustom() {
  sidePanel.append(el('div', 'dice-log-title', 'Custom dice'));
  if (editing) { renderEditor(); return; }
  const add = el('button', 'dice-pill', '＋ New custom die');
  add.type = 'button';
  add.addEventListener('click', () => { editing = { id: `c-${Date.now().toString(36)}`, name: '', sides: 6, faces: ['', '', '', '', '', ''], isNew: true }; renderPanel(); });
  sidePanel.append(add);
  const section = (title, list, own) => {
    if (!list.length) return;
    sidePanel.append(el('div', 'dice-custom-head', title));
    for (const def of list) {
      const row = el('div', 'dice-custom-row');
      const info = el('div', 'dice-custom-info');
      info.append(el('b', null, `${def.name} · d${def.sides}`), el('span', 'dice-custom-faces', def.faces.map((f) => f || '—').join(' · ')));
      const count = settings.counts[`custom:${def.id}`] || 0;
      const plus = el('button', 'dice-pill', count ? `＋ (${count})` : '＋');
      plus.type = 'button';
      plus.title = `Add a ${def.name} die to your roll`;
      plus.addEventListener('click', () => { settings.counts[`custom:${def.id}`] = Math.min(10, count + 1); save(); renderUI(); renderPanel(); });
      row.append(info, plus);
      if (own) {
        const edit = el('button', 'dice-pill', 'Edit');
        edit.type = 'button';
        edit.addEventListener('click', () => { editing = { ...def, faces: [...def.faces] }; renderPanel(); });
        row.append(edit);
      }
      sidePanel.append(row);
    }
  };
  section(hosting() ? 'Your dice (shared with listeners)' : 'Your dice', settings.customDice, true);
  section("The broadcaster's dice", sharedCustom.filter((d) => !settings.customDice.some((m) => m.id === d.id)), false);
  section('Ready-made', G.PRESETS, false);
}

function renderEditor() {
  const form = el('div', 'dice-custom-editor');
  const name = el('input');
  name.placeholder = 'Name, e.g. Dinner';
  name.maxLength = 30;
  name.value = editing.name;
  name.addEventListener('input', () => { editing.name = name.value; });
  const sides = el('select');
  for (const n of G.CUSTOM_SIDES) {
    const o = el('option', null, `d${n} (${n} faces)`);
    o.value = String(n);
    sides.append(o);
  }
  sides.value = String(editing.sides);
  sides.addEventListener('change', () => {
    editing.sides = Number(sides.value);
    editing.faces = Array.from({ length: editing.sides }, (_, i) => editing.faces[i] || '');
    renderPanel();
  });
  form.append(el('label', 'dice-field', 'Name'), name, el('label', 'dice-field', 'Shape'), sides, el('label', 'dice-field', 'Faces'));
  const faces = el('div', 'dice-custom-face-inputs');
  editing.faces.forEach((text, i) => {
    const input = el('input');
    input.placeholder = `Face ${i + 1}`;
    input.maxLength = 24;
    input.value = text;
    input.addEventListener('input', () => { editing.faces[i] = input.value; });
    faces.append(input);
  });
  form.append(faces);
  const actions = el('div', 'dice-custom-actions');
  const saveButton = el('button', 'primary', 'Save');
  saveButton.type = 'button';
  saveButton.addEventListener('click', () => {
    const def = G.cleanCustom({ ...editing, name: editing.name.trim() || 'Custom' });
    if (!def) return;
    const i = settings.customDice.findIndex((d) => d.id === def.id);
    if (i >= 0) settings.customDice[i] = def; else settings.customDice.push(def);
    save();
    editing = null;
    shareCustom();
    renderPanel();
  });
  const cancel = el('button', 'dice-pill', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => { editing = null; renderPanel(); });
  actions.append(saveButton, cancel);
  if (!editing.isNew) {
    const del = el('button', 'dice-pill danger', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => {
      settings.customDice = settings.customDice.filter((d) => d.id !== editing.id);
      delete settings.counts[`custom:${editing.id}`];
      save();
      editing = null;
      shareCustom();
      renderUI();
      renderPanel();
    });
    actions.append(del);
  }
  form.append(actions);
  sidePanel.append(form);
}

// The broadcaster's custom dice go to listeners so they can roll them too.
function shareCustom() {
  if (hosting() && typeof Live !== 'undefined') Live.shareCustomDice(settings.customDice);
}

// ---- Controls ----

let charge = null; // { started, timer }
let colorsOpen = false; // the colour picker is showing
document.addEventListener('click', () => { if (colorsOpen) { colorsOpen = false; renderUI(); } });

function pill(text, title, onClick, extra = '') {
  const b = el('button', `dice-pill${extra ? ` ${extra}` : ''}`, text);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function renderTopCounts() {
  const button = top.querySelector('[data-panel="log"]');
  if (button) button.textContent = log.length ? `Log · ${log.length}` : 'Log';
}

function renderUI() {
  if (mode !== 'tray') return;
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
  top.append(colors, el('span', 'spacer'));
  // The pills scroll sideways in a narrow window rather than squashing.
  const pills = el('div', 'dice-top-pills');
  // The broadcaster's table tools (roll requests, initiative, who wins), grouped.
  const tools = el('div', 'dice-top-group');
  tools.setAttribute('aria-label', 'Table');
  for (const [name, p] of panels) {
    if (p.visible && !p.visible()) continue;
    const b = pill(p.label, p.title, () => togglePanel(name), panel === name ? 'on' : '');
    b.dataset.panel = name;
    tools.append(b);
  }
  if (tools.childNodes.length) pills.append(tools);
  for (const [name, label, title] of [['custom', 'Custom dice', 'Your own dice, the broadcaster\'s and ready-made ones'], ['stats', 'Stats', 'Everyone\'s rolls, averages and natural 20s and 1s'], ['log', log.length ? `Log · ${log.length}` : 'Log', 'Every roll: who rolled what']]) {
    const b = pill(label, title, () => togglePanel(name), panel === name ? 'on' : '');
    b.dataset.panel = name;
    pills.append(b);
  }
  pills.append(pill('Close', 'Close the dice (Esc)', close));
  top.append(pills);

  ui.textContent = '';
  const pool = el('div', 'dice-pool');
  const typeButton = (key, label, title) => {
    const count = settings.counts[key] || 0;
    const b = el('button', `dice-type${count ? ' on' : ''}`);
    b.type = 'button';
    b.title = title;
    b.append(el('span', 'dice-type-name', label));
    if (count) b.append(el('span', 'dice-count', String(count)));
    b.addEventListener('click', () => { settings.counts[key] = Math.min(10, count + 1); save(); renderUI(); });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); settings.counts[key] = Math.max(0, count - 1); save(); renderUI(); });
    return b;
  };
  for (const type of G.TYPES) {
    pool.append(type === 'coin' ? typeButton(type, 'Coin', 'Add a coin (right-click to remove one)') : typeButton(type, type, `Add a ${type} (right-click to remove one)`));
  }
  // Custom dice in the roll, with their counts.
  for (const def of allCustom()) {
    if ((settings.counts[`custom:${def.id}`] || 0) > 0) pool.append(typeButton(`custom:${def.id}`, def.name, `Add a ${def.name} die (right-click to remove one)`));
  }
  pool.append(pill('Clear', 'Take every die off the table', () => { settings.counts = {}; save(); renderUI(); }));

  const actions = el('div', 'dice-actions');
  const mod = el('div', 'dice-mod');
  const minus = pill('−', 'Lower the modifier', () => { settings.modifier = Math.max(-30, settings.modifier - 1); save(); renderUI(); });
  const plus = pill('+', 'Raise the modifier', () => { settings.modifier = Math.min(30, settings.modifier + 1); save(); renderUI(); });
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
  actions.append(mod, adv, dis);
  if (hosting()) {
    // Like Whisper and Emphasis: for the next roll only.
    const hide = el('button', `dice-hidden${hiddenArmed ? ' on' : ''}`, hiddenArmed ? '🙈 Hidden' : '🙈 Hide');
    hide.type = 'button';
    hide.title = 'Hidden: listeners see your next roll\'s dice but not the numbers';
    hide.setAttribute('aria-pressed', String(hiddenArmed));
    hide.addEventListener('click', () => { hiddenArmed = !hiddenArmed; renderUI(); });
    actions.append(hide);
  }

  const counts = settings.counts;
  const go = el('button', 'dice-roll');
  go.type = 'button';
  go.id = 'dice-roll';
  go.title = 'Click to roll, or hold to throw harder';
  const ring = el('span', 'dice-charge');
  go.append(ring, el('span', 'dice-roll-text', `Roll ${G.describe(counts, settings.modifier, allCustom())}`));
  go.disabled = !G.plan(counts, 'normal', allCustom()).kinds.length;
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

  actions.append(go);
  ui.append(pool, actions);
}

document.addEventListener('keydown', (e) => {
  if (mode === 'tray' && e.key === 'Escape' && !document.querySelector('dialog[open]')) { e.preventDefault(); close(); }
});

window.DiceTray = {
  open, close, roll, remoteStart, remoteResult: remoteResultLate, setHistory, resetLog, setSessionColors,
  preferredColor: () => settings.color,
  isOpen: () => mode === 'tray', log: () => log,
  // Every finished roll (yours and others'): hook({ id, start, values, summary, entry }).
  onResult: (hook) => resultHooks.add(hook),
  // A natural 20 or 1 that counts: hook(20 | 1, start).
  onNatural: (hook) => naturalHooks.add(hook),
  // Extra side panels (the broadcaster's table): { label, title, render(el), visible() }.
  addPanel: (name, p) => { panels.set(name, p); if (mode === 'tray') renderUI(); },
  showPanel: (name) => { open(name); },
  refreshPanel: () => { if (mode === 'tray') { renderUI(); renderPanel(); } },
  // The broadcaster's custom dice, shared in the session.
  setSharedCustom: (list) => { sharedCustom = Array.isArray(list) ? list : []; if (mode === 'tray') { renderUI(); renderPanel(); } },
  myCustomDice: () => settings.customDice,
  initiativeModifier: () => settings.initiativeModifier || 0,
  setInitiativeModifier: (n) => { settings.initiativeModifier = n; save(); },
  modifier: () => settings.modifier,
  showRecap,
  // For trying the effects: DiceTray.effect(1 | 20).
  effect: (n) => { const at = { x: layer.clientWidth / 2, y: layer.clientHeight / 2 }; if (n === 1) skull(at); else fireworks(at); },
};
if (typeof Themes !== 'undefined') Themes.onChange(() => { /* the tray's backdrop is repainted by Themes */ });
window.dispatchEvent(new Event('dice-ready'));
