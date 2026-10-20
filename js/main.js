// Game State & Economy
let gold = 150;
let taxRate = 0;
let currentTool = 'inspect';
const gridOccupancy = {}; 
const animatedObjects = []; // Stores objects like windmill sails
const smokeParticles = [];  // Stores chimney smoke elements
const citizens = [];        // Stores wandering citizen entities

const COSTS = { road: 5, house: 20, farm: 35, windmill: 50, castle: 100 };
const REFUNDS = { road: 3, house: 12, farm: 20, windmill: 30, castle: 60 };
const TAXES = { house: 2, farm: 4, windmill: 8, castle: 25 };

let scene, camera, renderer, controls;
let raycaster, mouse;
let terrainPlane, placementCursor;
let sunLight, ambientLight;
let gameTime = 0; // Tracks day/night cycle

function init() {
  // 1. Scene & Atmospheric Sky Fog Setup
  scene = new THREE.Scene();
  const skyColor = new THREE.Color(0xaaccff);
  scene.background = skyColor;
  scene.fog = new THREE.FogExp2(0xaaccff, 0.01);

  // 2. Camera & Renderer
  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(15, 12, 18);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  // 3. Touch OrbitControls
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI / 2.25;
  controls.minDistance = 5;
  controls.maxDistance = 60;

  // 4. Dynamic Lighting (Day/Night capable)
  ambientLight = new THREE.AmbientLight(0xfff5ea, 0.7);
  scene.add(ambientLight);

  sunLight = new THREE.DirectionalLight(0xfffaed, 1.2);
  sunLight.position.set(30, 40, 20);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 1024;
  sunLight.shadow.mapSize.height = 1024;
  scene.add(sunLight);

  // 5. Grassland Ground Plane & River
  const terrainGeo = new THREE.PlaneGeometry(150, 150);
  const terrainMat = new THREE.MeshStandardMaterial({ color: 0x5dae49, roughness: 0.8 });
  terrainPlane = new THREE.Mesh(terrainGeo, terrainMat);
  terrainPlane.rotation.x = -Math.PI / 2;
  terrainPlane.receiveShadow = true;
  scene.add(terrainPlane);

  // Add a procedural River strip across the land
  const riverGeo = new THREE.PlaneGeometry(6, 150);
  const riverMat = new THREE.MeshStandardMaterial({ color: 0x3388cc, roughness: 0.2, metalness: 0.1 });
  const river = new THREE.Mesh(riverGeo, riverMat);
  river.rotation.x = -Math.PI / 2;
  river.position.set(10, 0.01, 0);
  scene.add(river);

  // 6. Placement Cursor
  const cursorGeo = new THREE.PlaneGeometry(1, 1);
  const cursorMat = new THREE.MeshBasicMaterial({ color: 0xffeb3b, side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
  placementCursor = new THREE.Mesh(cursorGeo, cursorMat);
  placementCursor.rotation.x = -Math.PI / 2;
  placementCursor.position.y = 0.03;
  placementCursor.visible = false;
  scene.add(placementCursor);

  // 7. Raycasting & Events
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);

  setupUI();
  spawnEnvironmentProps();
  spawnCitizens();
  loadKingdomState();

  // Timers
  setInterval(economyTick, 1000);
  setInterval(saveKingdomState, 5000); // Auto-save every 5 seconds

  animate();
}

// Environment Trees & Rocks
function spawnEnvironmentProps() {
  const treeTrunkGeo = new THREE.CylinderGeometry(0.1, 0.15, 0.8, 5);
  const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033 });
  const treeLeavesGeo = new THREE.ConeGeometry(0.8, 1.8, 5);
  const treeLeavesMat = new THREE.MeshStandardMaterial({ color: 0x2e6f40 });

  for (let i = 0; i < 35; i++) {
    const rx = Math.floor(Math.random() * 40 - 20) + 0.5;
    const rz = Math.floor(Math.random() * 40 - 20) + 0.5;
    // Avoid river path
    if (rx > 6 && rx < 14) continue;
    const key = `${rx},${rz}`;

    if (!gridOccupancy[key]) {
      const treeGroup = new THREE.Group();
      const trunk = new THREE.Mesh(treeTrunkGeo, treeTrunkMat);
      trunk.position.y = 0.4;
      trunk.castShadow = true;
      treeGroup.add(trunk);

      const leaves = new THREE.Mesh(treeLeavesGeo, treeLeavesMat);
      leaves.position.y = 1.3;
      leaves.castShadow = true;
      treeGroup.add(leaves);

      treeGroup.position.set(rx, 0, rz);
      scene.add(treeGroup);
      gridOccupancy[key] = treeGroup;
    }
  }
}

// Spawn Wandering Villagers (Citizens)
function spawnCitizens() {
  const citizenMat = new THREE.MeshStandardMaterial({ color: 0xcc3333 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffdbac });

  for (let i = 0; i < 5; i++) {
    const citizenGroup = new THREE.Group();
    
    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.1), citizenMat);
    body.position.y = 0.2;
    citizenGroup.add(body);

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), headMat);
    head.position.y = 0.4;
    citizenGroup.add(head);

    const startX = (Math.random() * 10) - 5;
    const startZ = (Math.random() * 10) - 5;
    citizenGroup.position.set(startX, 0, startZ);

    scene.add(citizenGroup);
    citizens.push({
      mesh: citizenGroup,
      angle: Math.random() * Math.PI * 2,
      speed: 0.02 + Math.random() * 0.01
    });
  }
}

// Built-in Audio Feedback Generator
function playSound(type) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'build') {
      osc.frequency.setValueAtTime(440, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.1);
    } else if (type === 'sell') {
      osc.frequency.setValueAtTime(300, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(150, audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
    }
  } catch (e) {
    // Audio context restricted until user interacts
  }
}

function setupUI() {
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentTool = e.target.dataset.tool;
      placementCursor.visible = (currentTool !== 'inspect');
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
    placementCursor.position.set(pos.x, 0.03, pos.z);
    placementCursor.visible = true;
  }
}

function onPointerDown(e) {
  if (e.target.tagName === 'BUTTON') return;
  const pos = getGridPosition(e);
  if (!pos) return;

  if (COSTS[currentTool]) {
    placeBuilding(pos, currentTool);
  } else if (currentTool === 'sell') {
    sellBuilding(pos);
  }
}

function placeBuilding(pos, type, freeBuild = false) {
  if (gridOccupancy[pos.key]) return;
  if (!freeBuild && gold < COSTS[type]) return;

  if (!freeBuild) gold -= COSTS[type];
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
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.5, 0.78), new THREE.MeshStandardMaterial({ color: 0xddc090 }));
    body.position.y = 0.25;
    body.castShadow = true;
    group.add(body);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.65, 0.45, 4), new THREE.MeshStandardMaterial({ color: 0xaa3322 }));
    roof.position.y = 0.7;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);

    // Chimney & Smoke
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.3, 0.15), new THREE.MeshStandardMaterial({ color: 0x555555 }));
    chimney.position.set(0.2, 0.75, 0.2);
    group.add(chimney);

    const smoke = new THREE.Mesh(new THREE.SphereGeometry(0.08, 4, 4), new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.6 }));
    smoke.position.set(pos.x + 0.2, 1.2, pos.z + 0.2);
    scene.add(smoke);
    smokeParticles.push({ mesh: smoke, baseY: 1.2, x: pos.x + 0.2, z: pos.z + 0.2 });

    group.position.set(pos.x, 0, pos.z);
    mesh = group;
  } else if (type === 'farm') {
    const group = new THREE.Group();
    const soil = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.9), new THREE.MeshStandardMaterial({ color: 0x4a2e12 }));
    soil.position.y = 0.025;
    group.add(soil);

    for (let i = -0.3; i <= 0.3; i += 0.2) {
      const crop = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: 0x77aa33 }));
      crop.position.set(0, 0.08, i);
      group.add(crop);
    }
    group.position.set(pos.x, 0, pos.z);
    mesh = group;
  } else if (type === 'windmill') {
    const group = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 1.2, 6), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
    tower.position.y = 0.6;
    tower.castShadow = true;
    group.add(tower);

    const sailHub = new THREE.Group();
    sailHub.position.set(0, 1.0, 0.25);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
    for (let b = 0; b < 4; b++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.02), bladeMat);
      blade.position.y = 0.35;
      blade.rotation.z = (b * Math.PI) / 2;
      sailHub.add(blade);
    }
    group.add(sailHub);
    animatedObjects.push({ obj: sailHub, type: 'spin' });

    group.position.set(pos.x, 0, pos.z);
    mesh = group;
  } else if (type === 'castle') {
    const group = new THREE.Group();
    const keep = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.8), new THREE.MeshStandardMaterial({ color: 0x888899 }));
    keep.position.y = 0.6;
    keep.castShadow = true;
    group.add(keep);

    // Towers on corners
    [-0.3, 0.3].forEach(ox => {
      [-0.3, 0.3].forEach(oz => {
        const twr = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.5, 6), new THREE.MeshStandardMaterial({ color: 0x777788 }));
        twr.position.set(ox, 0.75, oz);
        twr.castShadow = true;
        group.add(twr);
      });
    });

    group.position.set(pos.x, 0, pos.z);
    mesh = group;
  }

  mesh.userData = { type: type };
  scene.add(mesh);
  gridOccupancy[pos.key] = mesh;

  if (!freeBuild) playSound('build');
  recalculateTaxes();
  updateHUD();
}

function sellBuilding(pos) {
  const mesh = gridOccupancy[pos.key];
  if (!mesh) return;

  const type = mesh.userData.type;
  if (type) {
    gold += (REFUNDS[type] || 0);
  }

  scene.remove(mesh);
  delete gridOccupancy[pos.key];

  playSound('sell');
  recalculateTaxes();
  updateHUD();
}

function recalculateTaxes() {
  taxRate = 0;
  Object.values(gridOccupancy).forEach(mesh => {
    if (mesh.userData && TAXES[mesh.userData.type]) {
      taxRate += TAXES[mesh.userData.type];
    }
  });
}

function economyTick() {
  if (taxRate > 0) {
    gold += taxRate;
    updateHUD();
  }
}

// LocalStorage Save System
function saveKingdomState() {
  const saveData = {
    gold: gold,
    buildings: []
  };

  Object.entries(gridOccupancy).forEach(([key, mesh]) => {
    if (mesh.userData && mesh.userData.type) {
      const [x, z] = key.split(',').map(Number);
      saveData.buildings.push({ x, z, type: mesh.userData.type });
    }
  });

  localStorage.setItem('kingdom_save_data', JSON.stringify(saveData));
}

function loadKingdomState() {
  const saved = localStorage.getItem('kingdom_save_data');
  if (!saved) return;

  try {
    const data = JSON.parse(saved);
    gold = data.gold || 150;
    if (data.buildings) {
      data.buildings.forEach(b => {
        placeBuilding({ x: b.x, z: b.z, key: `${b.x},${b.z}` }, b.type, true);
      });
    }
  } catch (err) {
    console.error("Could not load save data:", err);
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);

  // 1. Day / Night Cycle Progression
  gameTime += 0.001;
  const cycle = Math.sin(gameTime);
  if (sunLight && ambientLight) {
    sunLight.intensity = Math.max(0.1, cycle * 1.2);
    if (cycle > 0) {
      scene.background.setHex(0xaaccff);
      scene.fog.color.setHex(0xaaccff);
    } else {
      scene.background.setHex(0x111122);
      scene.fog.color.setHex(0x111122);
    }
  }

  // 2. Animate Windmills
  animatedObjects.forEach(item => {
    if (item.type === 'spin') {
      item.obj.rotation.z += 0.03;
    }
  });

  // 3. Animate Chimney Smoke
  smokeParticles.forEach(p => {
    p.mesh.position.y += 0.004;
    p.mesh.scale.addScalar(0.001);
    if (p.mesh.position.y > 2.0) {
      p.mesh.position.y = p.baseY;
      p.mesh.scale.set(1, 1, 1);
    }
  });

  // 4. Animate Citizens Wandering
  citizens.forEach(c => {
    c.mesh.position.x += Math.cos(c.angle) * c.speed;
    c.mesh.position.z += Math.sin(c.angle) * c.speed;
    if (Math.random() < 0.02) c.angle += (Math.random() - 0.5) * 2;
    // Boundary check
    if (Math.abs(c.mesh.position.x) > 20 || Math.abs(c.mesh.position.z) > 20) {
      c.angle += Math.PI;
    }
  });

  controls.update();
  renderer.render(scene, camera);
}

window.onload = init;
  
