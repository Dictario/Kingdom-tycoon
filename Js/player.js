// player.js: Walk mode. A low-poly avatar, collision-aware walking on the y = 0 ground, and a chase camera.
// Scale: one grid cell is one world unit and a house wall is 0.42 tall, so the avatar is about 0.38 tall.
const R = 0.1;                    // body radius for collision
const SPEED = 1.3, RUN = 1.9;     // world units per second
const DIST = 2.2, HEAD = 0.26;    // chase-camera distance, and the height it looks at
const NEAR = 0.25;                // near plane while walking (the orbit view uses 1)

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CAP = new THREE.ConeGeometry(0.5, 1, 6);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Player {
  constructor(scene, buildings, size) {
    this.scene = scene;
    this.buildings = buildings;
    this.lim = size / 2 - R - 0.02;                  // stay inside the kingdom
    this.x = 0;
    this.z = 0;
    this.yaw = 0;                                    // the camera sits behind the player at (sin yaw, cos yaw)
    this.pitch = 0.35;
    this.heading = 0;                                // which way the avatar faces
    this.phase = 0;                                  // stride phase
    this.amp = 0;                                    // stride strength, eases to 0 when standing
    this.avatar = null;                              // built on first use
    this.near0 = 1;
  }

  ensure() {
    if (this.avatar) return;
    const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0 });
    const skin = mat(0xf0c9a0), tunic = mat(0xb5523b), pants = mat(0x3d4f7a);
    const cap = mat(0x2f6f3a), pack = mat(0x7a5230), dark = mat(0x2a211c);
    const avatar = new THREE.Group(), body = new THREE.Group();   // body bobs; the outer group stays on the ground
    const part = (parent, geo, m, sx, sy, sz, x, y, z) => {
      const o = new THREE.Mesh(geo, m);
      o.scale.set(sx, sy, sz);
      o.position.set(x, y, z);
      o.castShadow = true;
      o.receiveShadow = true;
      parent.add(o);
    };
    const joint = (x, y) => { const p = new THREE.Group(); p.position.set(x, y, 0); body.add(p); return p; };

    this.legL = joint(-0.035, 0.1);
    this.legR = joint(0.035, 0.1);
    this.armL = joint(-0.105, 0.22);
    this.armR = joint(0.105, 0.22);
    part(this.legL, BOX, pants, 0.055, 0.1, 0.06, 0, -0.05, 0);
    part(this.legR, BOX, pants, 0.055, 0.1, 0.06, 0, -0.05, 0);
    part(this.armL, BOX, tunic, 0.045, 0.11, 0.055, 0, -0.05, 0);
    part(this.armR, BOX, tunic, 0.045, 0.11, 0.055, 0, -0.05, 0);
    part(body, BOX, tunic, 0.16, 0.13, 0.09, 0, 0.165, 0);                 // torso
    part(body, BOX, skin, 0.1, 0.09, 0.09, 0, 0.275, 0);                   // head
    part(body, BOX, dark, 0.015, 0.015, 0.01, -0.025, 0.285, 0.046);       // eyes: the face looks toward +z
    part(body, BOX, dark, 0.015, 0.015, 0.01, 0.025, 0.285, 0.046);
    part(body, CAP, cap, 0.13, 0.07, 0.13, 0, 0.355, 0);
    part(body, BOX, pack, 0.1, 0.1, 0.045, 0, 0.17, -0.068);               // backpack: the chase camera sees the back
    avatar.add(body);
    this.scene.add(avatar);
    this.body = body;
    this.avatar = avatar;
  }

  // Stand at (x, z), nudged clear of buildings. yaw = the orbit camera's heading, so the view carries over.
  spawn(x, z, yaw) {
    const p = this.buildings.freeSpot(x, z, R);
    this.x = clamp(p.x, -this.lim, this.lim);
    this.z = clamp(p.z, -this.lim, this.lim);
    if (yaw !== undefined) {
      this.yaw = yaw;
      this.heading = yaw + Math.PI;                  // start facing away from the camera
    }
  }

  look(dx, dy) {                                     // drag in pixels: right turns right, down tilts the view down
    this.yaw -= dx * 0.006;
    this.pitch = clamp(this.pitch + dy * 0.004, 0.12, 1.0);
  }

  turn(rad) { this.yaw += rad; }                     // keyboard turning, positive = left

  // Move one axis at a time so a blocked axis slides along the obstacle instead of stopping dead.
  step(dx, dz) {
    const b = this.buildings;
    let x = clamp(this.x + dx, -this.lim, this.lim);
    if (b.blocked(x, this.z, R)) x = this.x;
    let z = clamp(this.z + dz, -this.lim, this.lim);
    if (b.blocked(x, z, R)) z = this.z;
    this.x = x;
    this.z = z;
  }

  // mx = strafe right (-1..1), my = forward (-1..1), relative to the camera. dt in seconds.
  update(dt, mx, my, run) {
    this.ensure();
    let l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; l = 1; }          // diagonals are no faster
    if (l > 0.001 && dt > 0) {
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw), v = (run ? RUN : SPEED) * dt;
      const dx = (mx * c - my * s) * v, dz = (-mx * s - my * c) * v;   // right = (c, -s), forward = (-s, -c)
      this.step(dx, dz);
      const d = Math.atan2(dx, dz) - this.heading;
      this.heading += Math.atan2(Math.sin(d), Math.cos(d)) * (1 - Math.exp(-dt * 14));   // shortest turn
      this.phase += dt * (run ? 15 : 10);
    }
    this.amp += ((l > 0.001 ? 1 : 0) - this.amp) * (1 - Math.exp(-dt * 12));
    const sw = Math.sin(this.phase) * 0.9 * this.amp;
    this.legL.rotation.x = sw;
    this.legR.rotation.x = -sw;
    this.armL.rotation.x = -sw;
    this.armR.rotation.x = sw;
    this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.012 * this.amp;
    this.avatar.position.set(this.x, 0, this.z);     // ground clamp: the avatar's y is always 0
    this.avatar.rotation.y = this.heading;
  }

  // Chase camera: behind the player, pulled in when a building would be in the way, then eased toward that spot.
  follow(camera, dt) {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const hx = Math.sin(this.yaw) * cp * DIST, hz = Math.cos(this.yaw) * cp * DIST, hy = sp * DIST;
    let k = 1;
    while (k > 0.35 && this.buildings.blocked(this.x + hx * k, this.z + hz * k, 0.12, HEAD + hy * k)) k -= 0.13;
    const a = 1 - Math.exp(-dt * 12), p = camera.position;
    p.x += (this.x + hx * k - p.x) * a;
    p.y += (HEAD + hy * k - p.y) * a;
    p.z += (this.z + hz * k - p.z) * a;
    camera.lookAt(this.x, HEAD, this.z);
  }

  show(camera) {
    this.ensure();
    this.near0 = camera.near;
    camera.near = NEAR;                              // the orbit view's near plane of 1 would clip houses beside the avatar
    camera.updateProjectionMatrix();
    this.avatar.visible = true;
    this.update(0, 0, 0, false);
    this.follow(camera, 10);                         // snap into place instead of gliding in from the orbit view
  }

  hide(camera) {
    camera.near = this.near0;
    camera.updateProjectionMatrix();
    if (this.avatar) this.avatar.visible = false;
  }
}
