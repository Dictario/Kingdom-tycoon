// main.js: renderer, world, HUD, and the wiring between Grid, Buildings and Input.
// Plain ES6 on purpose (no ?. or ??) so it runs on older browsers. THREE and THREE.OrbitControls are globals.
import { Grid } from './grid.js';
import { Buildings, TYPES } from './buildings.js';
import { Input, Keys, Pad } from './input.js';
import { Player } from './player.js';

const SIZE = 40;                       // playable cells per side
const SKY = 0x9fd3f5;
const treasury = { gold: 100 };
const $ = id => document.getElementById(id);
let tool = null;                       // null = explore, otherwise a key of TYPES
let dirty = true;                      // render on demand flag
let hintTimer = 0;
let walking = false;                   // Walk mode: orbit controls off, avatar + chase camera on
let orbitOffset = null;                // camera offset from its target, restored when leaving Walk mode
let gameTime = 0;                      // Tracks progression for day/night cycle

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
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;     // Manual shadow map management for performance
renderer.shadowMap.needsUpdate = true;
canvas.addEventListener('webglcontextrestored', () => { dirty = true; renderer.shadowMap.needsUpdate = true; });

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 70, 260);

// Soft sky/ground fill and dynamic sun
const hemiLight = new THREE.HemisphereLight(0xbfdcff, 0x5b7a3f, 0.6);
scene.add(hemiLight);

const sun = new THREE.DirectionalLight(0xfff1d6, 1.15);
sun.position.set(-32, 32, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);        // ~0.03 world units per texel; use 1024 on weak GPUs
const R = SIZE * 0.7, sc = sun.shadow.camera;   // fit the shadow frustum to the whole kingdom
sc.left = sc.bottom = -R;
sc.right = sc.top = R;
sc.near = 1;
sc.far = 120;
sc.updateProjectionMatrix();
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.03;
scene.add(sun);

const camera = new THREE.PerspectiveCamera(50, 1, 1, 600);
camera.position.set(18, 17, 22);

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

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1000, 1000).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ map: grass, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
);
ground.receiveShadow = true;
scene.add(ground);

/* ---------- camera controls ---------- */
const controls = new THREE.OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.2;              
controls.rotateSpeed = 0.7;
controls.zoomSpeed = 0.8;
controls.panSpeed = 0.8;
controls.screenSpacePanning = false;       
controls.minDistance = 8;
controls.maxDistance = 50;
controls.minPolarAngle = 0.2;              
controls.maxPolarAngle = 1.3;              
controls.addEventListener('change', () => { dirty = true; });

const lim = SIZE / 2, before = new THREE.Vector3(), shift = new THREE.Vector3();
function clampTarget() {                
  before.copy(controls.target);
  controls.target.x = Math.max(-lim, Math.min(lim, controls.target.x));
  controls.target.z = Math.max(-lim, Math.min(lim, controls.target.z));
  controls.target.y = 0;
  camera.position.add(shift.subVectors(controls.target, before));
}

/* ---------- Phase 2 systems ---------- */
const grid = new Grid(scene, SIZE);
const buildings = new Buildings(scene, grid);
const player = new Player(scene, buildings, SIZE);
const keys = new Keys();
const pad = new Pad($('pad'), $('knob'));
const input = new Input({
  canvas: canvas, camera: camera, grid: grid,
  active: () => tool !== null,
  walking: () => walking,
  onLook: (dx, dy) => player.look(dx, dy),
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
  renderer.shadowMap.needsUpdate = true;   
  updateHud();
  say('');
  showCursor(cell);                     
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

/* ---------- Walk / Inspect mode ---------- */
const walkBtn = document.createElement('button');
walkBtn.type = 'button';
walkBtn.onclick = () => setWalk(!walking);
$('toolbar').insertBefore(walkBtn, $('toolbar').firstChild);   // first in the strip; not in `buttons`, so hotkeys 1-7 stay put

function paintWalkBtn() {
  walkBtn.innerHTML = '<span class="n">' + (walking ? 'Inspect' : 'Walk') + '</span><span class="p">' + (walking ? 'Orbit view' : 'Stroll') + '</span>';
  walkBtn.classList.toggle('on', walking);
  buttons.forEach(b => { if (b.id === null) b.el.classList.toggle('on', !walking); });   // Explore is not "on" while walking
}
paintWalkBtn();

const touchy = () => (window.matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
function placePad() {                  // sit the joystick just above the footer, whatever height the footer has
  const top = document.querySelector('footer').getBoundingClientRect().top;
  $('pad').style.bottom = Math.max(0, window.innerHeight - top + 14) + 'px';
}

function setWalk(on) {
  if (on === walking) return;
  if (on) {
    setTool(null);                     // closes the grid and any armed tool
    orbitOffset = camera.position.clone().sub(controls.target);
    walking = true;
    controls.enabled = false;          // OrbitControls off: Walk mode drives the camera
    player.spawn(controls.target.x, controls.target.z, Math.atan2(orbitOffset.x, orbitOffset.z));
    player.show(camera);
    $('pad').hidden = !touchy();       // the joystick only appears on touch devices
    if (!$('pad').hidden) placePad();
  } else {
    walking = false;
    player.hide(camera);
    controls.enabled = true;
    controls.target.set(player.x, 0, player.z);                // Inspect resumes from where you stood
    camera.position.copy(controls.target).add(orbitOffset);
    pad.release();
    $('pad').hidden = true;
  }
  paintWalkBtn();
  input.reset();
  say('');
  dirty = true;
}

function updateHud() {
  $('gold').textContent = '$' + Math.floor(treasury.gold).toLocaleString();
  buttons.forEach(b => b.el.classList.toggle('poor', !!TYPES[b.id] && treasury.gold < TYPES[b.id].cost));
}

function say(msg, bad) {
  const el = $('hint');
  clearTimeout(hintTimer);
  el.textContent = msg || (walking
    ? 'Walk: W A S D or the joystick to move, drag to look, Shift to run. Tab or Inspect to go back.'
    : tool
    ? 'Build a ' + TYPES[tool].name + ' for $' + TYPES[tool].cost + '. Touch: drag to aim, release to place. Mouse: click. Two fingers move the camera.'
    : 'Pick a tool below. Drag to orbit, pinch to zoom, two fingers or right-drag to pan.');
  el.className = 'card' + (bad ? ' bad' : '');
  if (walking && !$('pad').hidden) placePad();
  if (msg) hintTimer = setTimeout(() => say(''), 1800);
}

function setTool(id) {
  if (walking) setWalk(false);         // picking any tool leaves Walk mode
  tool = id;
  grid.setActive(tool !== null);        
  controls.touches.ONE = tool ? -1 : THREE.TOUCH.ROTATE;
  buttons.forEach(b => b.el.classList.toggle('on', b.id === tool));
  input.reset();
  say('');
  dirty = true;
}

addEventListener('keydown', e => {
  const n = +e.key;
  if (e.key === 'Escape') setTool(null);
  else if (e.key === 'Tab') { e.preventDefault(); setWalk(!walking); }
  else if (n >= 1 && n <= buttons.length) buttons[n - 1].el.click();
});

/* ---------- run ---------- */
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);        
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  dirty = true;
  if (walking && !$('pad').hidden) placePad();
}
addEventListener('resize', resize);
resize();
updateHud();
setTool(null);

let lastT = performance.now();
(function frame() {
  requestAnimationFrame(frame);
  const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  // --- GRADUAL 5-STAGE DAY/NIGHT CYCLE LOGIC ---
  gameTime += 0.0003; // Controls cycle speed
  const timeProgress = (gameTime % 1) * Math.PI * 2;
  
  const sunDistance = 45;
  const sunX = Math.cos(timeProgress) * sunDistance;
  const sunY = Math.sin(timeProgress) * sunDistance;
  const sunZ = Math.sin(timeProgress * 0.5) * 15;

  sun.position.set(sunX, Math.max(-10, sunY), sunZ);
  renderer.shadowMap.needsUpdate = true; // Refresh shadows dynamically as sun moves

  const normH = sunY / sunDistance; // Ranges from -1 (midnight) to +1 (noon)

  // Torches: 0 by day, ramping to 1 across golden hour and dusk (normH 0.2 -> -0.1)
  const night = Math.min(1, Math.max(0, (0.2 - normH) / 0.3));
  buildings.update(night, now * 0.001, walking ? player : controls.target);   // torch lights follow whoever is moving
  const skyCol = new THREE.Color();
  const fogCol = new THREE.Color();
  const ambCol = new THREE.Color();

  if (normH > 0.35) {
    // Noon / Bright Day
    skyCol.setHex(0x9fd3f5);
    fogCol.setHex(0x9fd3f5);
    ambCol.setHex(0xbfdcff);
    sun.intensity = 1.15;
  } else if (normH > 0.05 && normH <= 0.35) {
    // Morning / Evening Golden Hour
    skyCol.setHex(0xffaa55);
    fogCol.setHex(0xffbb77);
    ambCol.setHex(0xffcc88);
    sun.intensity = 0.85;
  } else if (normH >= -0.1 && normH <= 0.05) {
    // Dawn / Dusk Sunset Horizon
    skyCol.setHex(0xaa4444);
    fogCol.setHex(0x883344);
    ambCol.setHex(0x773344);
    sun.intensity = 0.4;
  } else {
    // Night
    skyCol.setHex(0x0b0b1a);
    fogCol.setHex(0x0b0b1a);
    ambCol.setHex(0x222244);
    sun.intensity = 0.15;
  }

  scene.background.lerp(skyCol, 0.05);
  scene.fog.color.lerp(fogCol, 0.05);
  hemiLight.color.lerp(ambCol, 0.05);
  // ---------------------------------------------

  if (walking) {
    const k = keys.axis();
    player.turn(keys.turn() * 2 * dt);
    player.update(dt, Math.max(-1, Math.min(1, k.x + pad.x)), Math.max(-1, Math.min(1, k.y + pad.y)), keys.run);
    player.follow(camera, dt);
  } else controls.update();                    
  if (!walking) clampTarget();
  
  // Forces continuous rendering to support smooth lighting transitions
  dirty = true; 
  if (dirty) { dirty = false; renderer.render(scene, camera); }
})();
