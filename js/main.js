// Game State
let gold = 100;
let taxRate = 0;
let currentTool = 'inspect'; // 'inspect', 'road', 'house', 'sell'
const gridOccupancy = {}; // Format: "x,z" => mesh reference

const COSTS = { road: 5, house: 20 };
const REFUNDS = { road: 3, house: 12 };
const TAXES = { house: 2 };

// Three.js Core Variables
let scene, camera, renderer, controls;
let raycaster, mouse;
let terrainPlane, placementCursor;

function init() {
  // 1. Scene Setup
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(10, 15, 15);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);

  // 2. Controls & Lighting
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2.1; // Stay above ground

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
  sunLight.position.set(20, 40, 20);
  scene.add(sunLight);

  // 3. Grassland Terrain (500x500 continuous ground)
  const terrainGeo = new THREE.PlaneGeometry(500, 500);
  const terrainMat = new THREE.MeshLambertMaterial({ color: 0x55aa55 });
  terrainPlane = new THREE.Mesh(terrainGeo, terrainMat);
  terrainPlane.rotation.x = -Math.PI / 2;
  scene.add(terrainPlane);

  // 4. Placement Grid Cursor (Hidden by default)
  const cursorGeo = new THREE.PlaneGeometry(1, 1);
  const cursorMat = new THREE.MeshBasicMaterial({ color: 0xffff00, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
  placementCursor = new THREE.Mesh(cursorGeo, cursorMat);
  placementCursor.rotation.x = -Math.PI / 2;
  placementCursor.position.y = 0.01; // Slightly above ground to prevent Z-fighting
  placementCursor.visible = false;
  scene.add(placementCursor);

  // 5. Raycasting Setup
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // 6. Event Listeners
  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);

  setupUI();
  
  // 7. Economy Loop (Every 1 Second)
  setInterval(economyTick, 1000);

  // 8. Render Loop
  animate();
}

// UI Handler
function setupUI() {
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentTool = e.target.dataset.tool;
      placementCursor.visible = (currentTool === 'road' || currentTool === 'house' || currentTool === 'sell');
    });
  });
}

function updateHUD() {
  document.getElementById('gold-val').innerText = gold;
  document.getElementById('tax-val').innerText = taxRate;
}

// Grid Raycasting
function getGridPosition(e) {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObject(terrainPlane);

  if (intersects.length > 0) {
    const point = intersects[0].point;
    const gridX = Math.floor(point.x) + 0.5;
    const gridZ = Math.floor(point.z) + 0.5;
    return { x: gridX, z: gridZ, key: `${gridX},${gridZ}` };
  }
  return null;
}

function onPointerMove(e) {
  if (currentTool === 'inspect') {
    placementCursor.visible = false;
    return;
  }
  const pos = getGridPosition(e);
  if (pos) {
    placementCursor.position.set(pos.x, 0.01, pos.z);
    placementCursor.visible = true;
  }
}

function onPointerDown(e) {
  // Avoid placing if interacting with UI buttons
  if (e.target.tagName === 'BUTTON') return;

  const pos = getGridPosition(e);
  if (!pos) return;

  if (currentTool === 'road' || currentTool === 'house') {
    placeBuilding(pos, currentTool);
  } else if (currentTool === 'sell') {
    sellBuilding(pos);
  }
}

// Building Logic
function placeBuilding(pos, type) {
  if (gridOccupancy[pos.key]) return; // Cell occupied
  const cost = COSTS[type];
  if (gold < cost) return; // Not enough gold

  gold -= cost;

  let mesh;
  if (type === 'road') {
    const geo = new THREE.PlaneGeometry(0.9, 0.9);
    const mat = new THREE.MeshLambertMaterial({ color: 0x444444 });
    mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, 0.02, pos.z);
  } else if (type === 'house') {
    const group = new THREE.Group();
    // Body
    const bodyGeo = new THREE.BoxGeometry(0.8, 0.6, 0.8);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xddccaa });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.3;
    group.add(body);
    // Roof
    const roofGeo = new THREE.ConeGeometry(0.65, 0.4, 4);
    const roofMat = new THREE.MeshLambertMaterial({ color: 0xaa3333 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = 0.8;
    roof.rotation.y = Math.PI / 4;
    group.add(roof);

    group.position.set(pos.x, 0, pos.z);
    mesh = group;
  }

  mesh.userData = { type: type };
  scene.add(mesh);
  gridOccupancy[pos.key] = mesh;

  recalculateTaxes();
  updateHUD();
}

function sellBuilding(pos) {
  const mesh = gridOccupancy[pos.key];
  if (!mesh) return;

  const type = mesh.userData.type;
  gold += REFUNDS[type];

  scene.remove(mesh);
  delete gridOccupancy[pos.key];

  recalculateTaxes();
  updateHUD();
}

function recalculateTaxes() {
  taxRate = 0;
  Object.values(gridOccupancy).forEach(mesh => {
    const type = mesh.userData.type;
    if (TAXES[type]) taxRate += TAXES[type];
  });
}

function economyTick() {
  if (taxRate > 0) {
    gold += taxRate;
    updateHUD();
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

window.onload = init;
