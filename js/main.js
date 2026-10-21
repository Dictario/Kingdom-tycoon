// main.js: renderer, world, HUD, and the wiring between Grid, Buildings and Input.
// Plain ES6 on purpose (no ?. or ??) so it runs on older browsers. THREE and THREE.OrbitControls are globals.
import { Grid } from './grid.js';
import { Buildings, TYPES } from './buildings.js';
import { Input } from './input.js';

const SIZE = 40;                       // playable cells per side
const SKY = 0x9fd3f5;
const treasury = { gold: 100 };
const $ = id => document.getElementById(id);
let tool = null;                       // null = explore, otherwise a key of TYPES
let dirty = true;                      // render on demand: idle frames cost almost nothing
let hintTimer = 0;

/* ---------- renderer, scene, camera ---------- */
const canvas = $('game');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: window.devicePixelRatio < 2, powerPreference: 'low-power' });
} catch (err) {
  $('hint').textContent = 'WebGL is not available in this browser.';
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
canvas.addEventListener('webglcontextrestored', () => { dirty = true; });

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 70, 260);
scene.add(new THREE.HemisphereLight(0xdff0ff, 0x4a6b36, 0.95));
const sun = new THREE.DirectionalLight(0xfff2d6, 0.8);
sun.position.set(30, 50, 20);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(50, 1, 1, 600);
camera.position.set(26, 24, 30);

/* ---------- endless grass (one small tiled texture) ---------- */
const tile = document.createElement('canvas');
tile.width = tile.height = 128;
const g2 = tile.getContext('2d');
g2.fillStyle = '#5aa347';
g2.fillRect(0, 0, 128, 128);
for (let i = 0; i < 500; i++) {
  g2.fillStyle = 'hsl(' + (90 + Math.random() * 30) + ',45%,' + (32 + Math.random() * 16) + '%)';
  g2.fillRect(Math.random() * 128 | 0, Math.random() * 128 | 0, 2, 2);
}
const grass = new THREE.CanvasTexture(tile);
grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
grass.repeat.set(125, 125);
grass.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
// polygonOffset pushes the ground back so grid lines and slabs never z-fight on low-precision depth buffers
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1000, 1000).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ map: grass, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
);
scene.add(ground);

/* ---------- camera controls ---------- */
const controls = new THREE.OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.minDistance = 6;
controls.maxDistance = 80;
controls.maxPolarAngle = Math.PI * 0.46;
controls.addEventListener('change', () => { dirty = true; });

const lim = SIZE / 2, before = new THREE.Vector3(), shift = new THREE.Vector3();
function clampTarget() {                // keep the camera focus over the kingdom
  before.copy(controls.target);
  controls.target.x = Math.max(-lim, Math.min(lim, controls.target.x));
  controls.target.z = Math.max(-lim, Math.min(lim, controls.target.z));
  controls.target.y = 0;
  camera.position.add(shift.subVectors(controls.target, before));
}

/* ---------- Phase 2 systems ---------- */
const grid = new Grid(scene, SIZE);
const buildings = new Buildings(scene, grid);
const input = new Input({
  canvas: canvas, camera: camera, grid: grid,
  active: () => tool !== null,
  onHover: showCursor,
  onPlace: place
});

function showCursor(cell) {
  dirty = true;
  if (!tool || !cell) { grid.hide(); return; }
  grid.show(cell.cx, cell.cz, buildings.check(tool, cell.cx, cell.cz, treasury.gold) === '');
}

function place(cell) {
  const res = buildings.place(tool, cell.cx, cell.cz, treasury);
  if (!res.ok) { say(res.reason, true); return; }
  dirty = true;
  updateHud();
  say('');
  showCursor(cell);                     // the cell is now occupied, so the highlight turns red
}

/* ---------- HUD ---------- */
const buttons = [];
function addButton(id, label, sub) {
  const el = document.createElement('button');
  el.type = 'button';
  el.innerHTML = '<span class="n">' + label + '</span><span class="p">' + sub + '</span>';
  el.onclick = () => setTool(id === tool ? null : id);
  $('toolbar').appendChild(el);
  buttons.push({ id: id, el: el });
}
addButton(null, 'Explore', 'Camera');
Object.keys(TYPES).forEach(id => addButton(id, TYPES[id].name, '$' + TYPES[id].cost));

function updateHud() {
  $('gold').textContent = '$' + Math.floor(treasury.gold).toLocaleString();
  buttons.forEach(b => b.el.classList.toggle('poor', !!TYPES[b.id] && treasury.gold < TYPES[b.id].cost));
}

function say(msg, bad) {
  const el = $('hint');
  clearTimeout(hintTimer);
  el.textContent = msg || (tool
    ? 'Build a ' + TYPES[tool].name + ' for $' + TYPES[tool].cost + '. Touch: drag to aim, release to place. Mouse: click. Two fingers move the camera.'
    : 'Pick a tool below. Drag to orbit, pinch to zoom, two fingers or right-drag to pan.');
  el.className = 'card' + (bad ? ' bad' : '');
  if (msg) hintTimer = setTimeout(() => say(''), 1800);
}

function setTool(id) {
  tool = id;
  grid.setActive(tool !== null);        // grid lines + highlight exist only while a tool is armed
  // Armed: one finger aims, two fingers drive the camera. Explore: one finger orbits.
  controls.touches.ONE = tool ? -1 : THREE.TOUCH.ROTATE;
  buttons.forEach(b => b.el.classList.toggle('on', b.id === tool));
  input.reset();
  say('');
  dirty = true;
}

addEventListener('keydown', e => {
  const n = +e.key;
  if (e.key === 'Escape') setTool(null);
  else if (n >= 1 && n <= buttons.length) buttons[n - 1].el.click();
});

/* ---------- run ---------- */
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);        // CSS sizes the canvas
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  dirty = true;
}
addEventListener('resize', resize);
resize();
updateHud();
setTool(null);

(function frame() {
  requestAnimationFrame(frame);
  controls.update();                    // fires 'change' (sets dirty) only when the camera moved
  clampTarget();
  if (dirty) { dirty = false; renderer.render(scene, camera); }
})();
