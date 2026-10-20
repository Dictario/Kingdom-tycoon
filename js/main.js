import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Setup Scene, Camera, and Renderer
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // Daylight sky color

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(15, 15, 20);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // High efficiency on mobile
document.body.appendChild(renderer.domElement);

// Camera Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2.15; // Don't allow camera under ground

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
sunLight.position.set(20, 40, 20);
scene.add(sunLight);

// Endless Grass Terrain Plane
const terrainGeometry = new THREE.PlaneGeometry(200, 200);
const terrainMaterial = new THREE.MeshLambertMaterial({ color: 0x55aa44 });
const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
terrain.rotation.x = -Math.PI / 2;
scene.add(terrain);

// Dynamic Window Resizing
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Main Animation Loop
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

animate();
