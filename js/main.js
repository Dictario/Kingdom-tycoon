// Game State
let gold = 100;
let taxRate = 0;
let currentTool = 'inspect';
const gridOccupancy = {};

const COSTS = { road: 5, house: 20 };
const REFUNDS = { road: 3, house: 12 };
const TAXES = { house: 2 };

let scene, camera, renderer, controls;
let raycaster, mouse;
let terrainPlane, placementCursor;

function init() {
  // 1. Scene & Atmospheric Fog Setup
  scene = new THREE.Scene();
  const skyColor = new THREE.Color(0xaaccff);
  scene.background = skyColor;
  scene.fog = new THREE.FogExp2(0xaaccff, 0.012); // Blurs edges into the distance

  // 2. Camera & Renderer
  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(15, 12, 18);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; // Enables real-time 3D shadows
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  // 3. Touch OrbitControls
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2.25; 
  controls.minDistance = 5;
  controls.maxDistance = 50;

  // 4. Warm Sun & Environmental Lighting
  const ambientLight = new THREE.AmbientLight(0xfff5ea, 0.7);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0xfffaed, 1.2);
  sunLight.position.set(30, 40, 20);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 1024;
  sunLight.shadow.mapSize.height = 1024;
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = 100;
  const d = 30;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  scene.add(sunLight);

  // 5. Stylized Grassland Ground Plane
  const terrainGeo = new THREE.PlaneGeometry(150, 150);
  const terrainMat = new THREE.MeshStandardMaterial({ 
    color: 0x5dae49, 
    roughness: 0.8,
    metalness: 0.1 
  });
  terrainPlane = new THREE.Mesh(terrainGeo, terrainMat);
  terrainPlane.rotation.x = -Math.PI / 2;
  terrainPlane.receiveShadow = true;
  scene.add(terrainPlane);

  // 6. Spawn Initial Nature Details (Trees & Boulders)
  spawnEnvironmentProps();

  // 7. Grid Cursor Highlight
  const cursorGeo = new THREE.PlaneGeometry(1, 1);
  const cursorMat = new THREE.MeshBasicMaterial({ color: 0xffeb3b, side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
  placementCursor = new THREE.Mesh(cursorGeo, cursorMat);
  placementCursor.rotation.x = -Math.PI / 2;
  placementCursor.position.y = 0.02;
  placementCursor.visible = false;
  scene.add(placementCursor);

  // 8. Raycasting & Events
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);

  setupUI();
  setInterval(economyTick, 1000);
  animate();
}

// Environment Generation: Trees & Rocks
function spawnEnvironmentProps() {
  const treeTrunkGeo = new THREE.CylinderGeometry(0.1, 0.15, 0.8, 5);
  const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
  const treeLeavesGeo = new THREE.ConeGeometry(0.8, 1.8, 5);
  const treeLeavesMat = new THREE.MeshStandardMaterial({ color: 0x2e6f40, roughness: 0.8 });

  const rockGeo = new THREE.DodecahedronGeometry(0.4, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9 });

  // Scatter props across the landscape
  for (let i = 0; i < 40; i++) {
    const rx = (Math.floor(Math.random() * 40) - 20) + 0.5;
    const rz = (Math.floor(Math.random() * 40) - 20) + 0.5;
    const key = `${rx},${rz}`;

    if (!gridOccupancy[key]) {
      const propGroup = new THREE.Group();

      if (Math.random() > 0.3) {
        // Tree
        const trunk = new THREE.Mesh(treeTrunkGeo, treeTrunkMat);
        trunk.position.y = 0.4;
        trunk.castShadow = true;
        propGroup.add(trunk);

        const leaves = new THREE.Mesh(treeLeavesGeo, treeLeavesMat);
        leaves.position.y = 1.3;
        leaves.castShadow = true;
        propGroup.add(leaves);
      } else {
        // Rock
        const rock = new THREE.Mesh(rockGeo, rockMat);
        rock.position.y = 0.2;
        rock.rotation.set(Math.random(), Math.random(), Math.random());
        rock.castShadow = true;
        propGroup.add(rock);
      }

      propGroup.position.set(rx, 0, rz);
      scene.add(propGroup);
      gridOccupancy[key] = propGroup; // Mark space as occupied
    }
  }
}

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
    placementCursor.position.set(pos.x, 0.02, pos.z);
    placementCursor.visible = true;
  }
}

function onPointerDown(e) {
  if (e.target.tagName === 'BUTTON') return;
  const pos = getGridPosition(e);
  if (!pos) return;

  if (currentTool === 'road' || currentTool === 'house') {
    placeBuilding(pos, currentTool);
  } else if (currentTool === 'sell') {
    sellBuilding(pos);
  }
}

function placeBuilding(pos, type) {
  if (gridOccupancy[pos.key]) return;
  const cost = COSTS[type];
  if (gold < cost) return;

  gold -= cost;
  let mesh;

  if (type === 'road') {
    const geo = new THREE.PlaneGeometry(0.95, 0.95);
    const mat = new THREE.MeshStandardMaterial({ color: 0x665544, roughness: 0.9 });
    mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, 0.01, pos.z);
    mesh.receiveShadow = true;
  } else if (type === 'house') {
    const group = new THREE.Group();

    // Base Stone Foundation
    const baseGeo = new THREE.BoxGeometry(0.82, 0.2, 0.82);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.9 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.1;
    base.castShadow = true;
    group.add(base);

    // Timber Body
    const bodyGeo = new THREE.BoxGeometry(0.78, 0.5, 0.78);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xddc090, roughness: 0.7 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.45;
    body.castShadow = true;
    group.add(body);

    // Tiled Roof
    const roofGeo = new THREE.ConeGeometry(0.65, 0.45, 4);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xaa3322, roughness: 0.6 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = 0.9;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);

    // Door Detail
    const doorGeo = new THREE.BoxGeometry(0.2, 0.3, 0.05);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x4a2e12 });
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(0, 0.35, 0.4);
    group.add(door);

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
  gold += (REFUNDS[type] || 0);

  scene.remove(mesh);
  delete gridOccupancy[pos.key];

  recalculateTaxes();
  updateHUD();
}

function recalculateTaxes() {
  taxRate = 0;
  Object.values(gridOccupancy).forEach(mesh => {
    if (mesh.userData && mesh.userData.type === 'house') {
      taxRate += TAXES.house;
    }
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
