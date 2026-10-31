// main.js: renderer, world, HUD, day/night cycle, and touch-enabled walk mode avatar.
import { Grid } from './grid.js';
import { Buildings, TYPES } from './buildings.js';
import { Input } from './input.js';

const SIZE = 40;                       
const SKY = 0x9fd3f5;
const treasury = { gold: 100 };
const $ = id => document.getElementById(id);
let tool = null;                       
let dirty = true;                      
let hintTimer = 0;
let gameTime = 0;                      

// Walk mode player variables
let player = null;
const playerPos = new THREE.Vector3(0, 0.2, 0);
let playerAngle = 0;

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
renderer.shadowMap.autoUpdate = false;     
renderer.shadowMap.needsUpdate = true;
canvas.addEventListener('webglcontextrestored', () => { dirty = true; renderer.shadowMap.needsUpdate = true; });

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 70, 260);

const hemiLight = new THREE.HemisphereLight(0xbfdcff, 0x5b7a3f, 0.6);
scene.add(hemiLight);

const sun = new THREE.DirectionalLight(0xfff1d6, 1.15);
sun.position.set(-32, 32, 18);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);        
const R = SIZE * 0.7, sc = sun.shadow.camera;   
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

/* ---------- endless grass ---------- */
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

/* ---------- player avatar setup ---------- */
const playerGroup = new THREE.Group();
const bodyMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.3, 0.5, 0.15), 
  new THREE.MeshStandardMaterial({ color: 0x3366cc, roughness: 0.7 })
);
bodyMesh.position.y = 0.25;
bodyMesh.castShadow = true;
playerGroup.add(bodyMesh);

const headMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.12, 6, 6), 
  new THREE.MeshStandardMaterial({ color: 0xffdbac })
);
headMesh.position.y = 0.55;
playerGroup.add(headMesh);

playerGroup.position.copy(playerPos);
scene.add(playerGroup);
player = playerGroup;

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
const input = new Input({
  canvas: canvas, camera: camera, grid: grid,
  active: () => tool !== null && tool !== 'walk',
  onHover: showCursor,
  onPlace: place
});

function showCursor(cell) {
  dirty = true;
  if (!tool || tool === 'walk' || !cell) { grid.hide(); return; }
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

/* ---------- HUD & Toolbar ---------- */
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
addButton('walk', 'Walk Mode', 'Explore');
Object.keys(TYPES).forEach(id => addButton(id, TYPES[id].name, '$' + TYPES[id].cost));

function updateHud() {
  $('gold').textContent = '$' + Math.floor(treasury.gold).toLocaleString();
  buttons.forEach(b => b.el.classList.toggle('poor', !!TYPES[b.id] && treasury.gold < TYPES[b.id].cost));
}

function say(msg, bad) {
  const el = $('hint');
  clearTimeout(hintTimer);
  el.textContent = msg || (tool === 'walk'
    ? 'Walk Mode: WASD on keyboard or Drag your finger on mobile screen to walk.'
    : tool
    ? 'Build a ' + TYPES[tool].name + ' for $' + TYPES[tool].cost + '.'
    : 'Pick a tool below. Drag to orbit, pinch to zoom, two fingers or right-drag to pan.');
  el.className = 'card' + (bad ? ' bad' : '');
  if (msg) hintTimer = setTimeout(() => say(''), 2200);
}

function setTool(id) {
  tool = id;
  const isWalk = (tool === 'walk');
  
  grid.setActive(!isWalk && tool !== null);        
  controls.enabled = !isWalk; 
  
  controls.touches.ONE = tool ? -1 : THREE.TOUCH.ROTATE;
  buttons.forEach(b => b.el.classList.toggle('on', b.id === tool));
  input.reset();
  say('');
  dirty = true;
}

addEventListener('keydown', e => {
  if (e.key === 'Escape') setTool(null);
});

/* ---------- run ---------- */
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);        
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

  // --- WALK MODE MOVEMENT (KEYBOARD + MOBILE TOUCH STEERING) ---
  if (tool === 'walk' && player) {
    const moveSpeed = 0.08;
    const k = input.keys;
    const tv = input.touchVector;
    let dx = 0, dz = 0;

    if (k.w) dz -= 1;
    if (k.s) dz += 1;
    if (k.a) dx -= 1;
    if (k.d) dx += 1;

    // Merge mobile touch drag vector if active
    if (tv.active) {
      dx += tv.x;
      dz += tv.y;
    }

    if (Math.abs(dx) > 0.05 || Math.abs(dz) > 0.05) {
      const angle = Math.atan2(dx, dz);
      const nextX = playerPos.x + Math.sin(angle) * moveSpeed;
      const nextZ = playerPos.z + Math.cos(angle) * moveSpeed;

      const cellCoords = grid.snap(nextX, nextZ);
      let canMove = true;
      if (cellCoords) {
        const building = buildings.at(cellCoords.cx, cellCoords.cz);
        if (building && building.type !== 'road') {
          canMove = false;
        }
      } else {
        canMove = false;
      }

      if (canMove) {
        playerPos.x = nextX;
        playerPos.z = nextZ;
        playerAngle = angle;
      }

      player.position.copy(playerPos);
      player.rotation.y = playerAngle;
    }

    // Third-Person Camera Follow
    const targetCamX = playerPos.x - Math.sin(playerAngle) * 4;
    const targetCamZ = playerPos.z - Math.cos(playerAngle) * 4;
    camera.position.lerp(new THREE.Vector3(targetCamX, playerPos.y + 2.5, targetCamZ), 0.1);
    camera.lookAt(playerPos.x, playerPos.y + 0.5, playerPos.z);
    
    dirty = true;
  }
  // -------------------------------------------------------------

  // --- DAY/NIGHT CYCLE LOGIC ---
  gameTime += 0.0003; 
  const timeProgress = (gameTime % 1) * Math.PI * 2;
  
  const sunDistance = 45;
  const sunX = Math.cos(timeProgress) * sunDistance;
  const sunY = Math.sin(timeProgress) * sunDistance;
  const sunZ = Math.sin(timeProgress * 0.5) * 15;

  sun.position.set(sunX, Math.max(-10, sunY), sunZ);
  renderer.shadowMap.needsUpdate = true; 

  const normH = sunY / sunDistance; 
  const night = Math.min(1, Math.max(0, (0.2 - normH) / 0.3));
  buildings.update(night, performance.now() * 0.001, controls.target);

  const skyCol = new THREE.Color();
  const fogCol = new THREE.Color();
  const ambCol = new THREE.Color();

  if (normH > 0.35) {
    skyCol.setHex(0x9fd3f5);
    fogCol.setHex(0x9fd3f5);
    ambCol.setHex(0xbfdcff);
    sun.intensity = 1.15;
  } else if (normH > 0.05 && normH <= 0.35) {
    skyCol.setHex(0xffaa55);
    fogCol.setHex(0xffbb77);
    ambCol.setHex(0xffcc88);
    sun.intensity = 0.85;
  } else if (normH >= -0.1 && normH <= 0.05) {
    skyCol.setHex(0xaa4444);
    fogCol.setHex(0x883344);
    ambCol.setHex(0x773344);
    sun.intensity = 0.4;
  } else {
    skyCol.setHex(0x0b0b1a);
    fogCol.setHex(0x0b0b1a);
    ambCol.setHex(0x222244);
    sun.intensity = 0.15;
  }

  scene.background.lerp(skyCol, 0.05);
  scene.fog.color.lerp(fogCol, 0.05);
  hemiLight.color.lerp(ambCol, 0.05);
  // -----------------------------

  if (tool !== 'walk') {
    controls.update();                    
    clampTarget();
  }
  
  if (dirty) { dirty = false; renderer.render(scene, camera); }
})();
