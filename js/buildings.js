// buildings.js: catalog, placement rules, occupied-cell map and torch lighting.
// Every building is 1-2 merged, vertex-coloured meshes (1-2 draw calls and 1-2 shadow draws) built once per
// variant and cached. Add a type by adding one entry to TYPES: the toolbar and placement checks pick it up.
const BOX = new THREE.BoxGeometry(1, 1, 1);
const PYR = new THREE.ConeGeometry(0.7071, 1, 4).rotateY(Math.PI / 4);   // square pyramid, 1x1 base
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
const BOWL = new THREE.CylinderGeometry(0.5, 0.3, 1, 8);                 // wider at the top
const FLAME_GEO = new THREE.ConeGeometry(0.5, 1, 5);
const GLOW_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

// Two shared materials; colour comes from vertex colours. Dielectrics only (metalness 0): with no
// environment map, metalness would just darken the albedo.
const MATTE = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
const SHEEN = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 });
const FLAME_MAT = new THREE.MeshBasicMaterial({ color: 0xffa63d });      // unlit, so flames stay bright by day too

function radial() {                                                      // soft round falloff for the ground glow
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
// Torch light on the ground. The terrain is vertex-lit, so a real point light cannot paint a pool on it;
// this additive decal does, at the cost of one tiny quad per torch (hidden by day).
const GLOW_MAT = new THREE.MeshBasicMaterial({ map: radial(), color: 0xff9a4d, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });

const POOL = 4;   // real point lights, shared by the torches nearest the camera focus; use 2 on weak phones

/* ---------- compound shapes: [geometry, colour, scale, position, rotation] merged into one geometry ---------- */
const mk = g => (c, s, p, r) => ({ g: g, c: c, s: s, p: p, r: r || [0, 0, 0] });
const B = mk(BOX), Y = mk(CYL), P = mk(PYR), U = mk(BOWL);

const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _q = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
function merge(parts) {
  const pos = [], nor = [], col = [];
  parts.forEach(d => {
    const g = d.g.toNonIndexed();
    _q.setFromEuler(_e.set(d.r[0], d.r[1], d.r[2]));
    g.applyMatrix4(_m.compose(_p.set(d.p[0], d.p[1], d.p[2]), _q, _s.set(d.s[0], d.s[1], d.s[2])));
    const ap = g.attributes.position.array, an = g.attributes.normal.array;
    _c.setHex(d.c);
    for (let i = 0; i < ap.length; i += 3) {
      pos.push(ap[i], ap[i + 1], ap[i + 2]);
      nor.push(an[i], an[i + 1], an[i + 2]);
      col.push(_c.r, _c.g, _c.b);
    }
    g.dispose();
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

// Walls join their neighbours: bit i of `mask` = a wall next door in direction DIRS[i] (N, E, S, W).
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const ARM_S = [[0.22, 0.34, 0.5], [0.5, 0.34, 0.22], [0.22, 0.34, 0.5], [0.5, 0.34, 0.22]];
const TOP_S = [[0.28, 0.05, 0.5], [0.5, 0.05, 0.28], [0.28, 0.05, 0.5], [0.5, 0.05, 0.28]];
const ARM_P = [[0, 0.17, -0.25], [0.25, 0.17, 0], [0, 0.17, 0.25], [-0.25, 0.17, 0]];

// Collision boxes for Walk mode: [offsetX, offsetZ, halfX, halfZ, height] in the cell frame. Roads have none, so
// they are walkable. Stalls and carts spin in quarter turns, so theirs are square. A wall's boxes follow its links.
const WALL_HIT = [];
for (let m = 0; m < 16; m++) {
  const h = [[0, 0, 0.2, 0.2, 0.56]];
  for (let i = 0; i < 4; i++) if (m & (1 << i)) h.push([ARM_P[i][0], ARM_P[i][2], ARM_S[i][0] / 2, ARM_S[i][2] / 2, 0.38]);
  WALL_HIT.push(h);
}

// shape(variant) -> { matte: [parts], sheen: [parts] }. Everything fits the 1x1 cell, front faces +z.
// cast: throws shadows (flat roads only receive). spin: quarter-turn by cell for variety.
// link: re-shapes with neighbours. onRoad: may also sit on a road tile. glow: torch with night light.
export const TYPES = {
  road: {
    name: 'Road', cost: 5,
    shape: () => ({ matte: [B(0x5b6068, [0.98, 0.06, 0.98], [0, 0.03, 0])] })
  },
  house: {
    name: 'House', cost: 20, cast: true, hit: [[0, 0, 0.34, 0.29, 0.78]],
    shape: () => ({
      matte: [B(0xeadfc2, [0.64, 0.42, 0.54], [0, 0.21, 0]), B(0x5a3b2a, [0.14, 0.22, 0.02], [0, 0.11, 0.27])],
      sheen: [P(0xb5523b, [0.8, 0.36, 0.7], [0, 0.6, 0])]
    })
  },
  wall: {
    name: 'Stone Wall', cost: 2, cast: true, link: true, hit: WALL_HIT, hitByMask: true,
    shape: mask => {
      const m = [B(0x8d8f93, [0.36, 0.5, 0.36], [0, 0.25, 0]), B(0xa7a9ad, [0.44, 0.06, 0.44], [0, 0.53, 0])];
      for (let i = 0; i < 4; i++) {
        if (!(mask & (1 << i))) continue;
        m.push(B(0x7f8185, ARM_S[i], ARM_P[i]));
        m.push(B(0x9a9ca0, TOP_S[i], [ARM_P[i][0], 0.365, ARM_P[i][2]]));
      }
      return { matte: m };
    }
  },
  stall: {
    name: 'Market Stall', cost: 15, cast: true, spin: true, hit: [[0, 0, 0.45, 0.45, 0.72]],
    shape: () => {
      const wood = 0x6b4a2f, m = [];
      [-0.4, 0.4].forEach(x => {
        m.push(B(wood, [0.06, 0.68, 0.06], [x, 0.34, -0.34]));                 // tall back posts
        m.push(B(wood, [0.06, 0.52, 0.06], [x, 0.26, 0.34]));                  // short front posts
      });
      [-0.36, -0.12, 0.12, 0.36].forEach((x, i) =>                             // striped canopy, sloping to the front
        m.push(B(i % 2 ? 0xf3ead2 : 0xc0392b, [0.24, 0.035, 0.86], [x, 0.62, 0], [0.2, 0, 0])));
      m.push(B(0xa8774a, [0.8, 0.26, 0.3], [0, 0.13, 0.14]));                  // counter
      [[-0.25, 0xd9534f], [-0.08, 0x7fc24a], [0.1, 0xf0c040], [0.27, 0xd9534f]].forEach((g, i) =>
        m.push(B(g[1], [0.1, 0.1, 0.1], [g[0], 0.31, 0.12 + (i % 2) * 0.04], [0, i * 0.5, 0])));   // goods
      m.push(B(0xb8884f, [0.24, 0.22, 0.24], [-0.27, 0.11, -0.2]));            // crates and a barrel at the back
      m.push(B(0xa0743f, [0.2, 0.2, 0.2], [0, 0.1, -0.22]));
      m.push(B(0xc79a5e, [0.16, 0.14, 0.16], [-0.27, 0.29, -0.2], [0, 0.5, 0]));
      m.push(Y(0x7a5230, [0.2, 0.26, 0.2], [0.28, 0.13, -0.2]));
      return { matte: m };
    }
  },
  cart: {
    name: 'Cart', cost: 10, cast: true, spin: true, onRoad: true, hit: [[0, 0, 0.36, 0.36, 0.53]],
    shape: () => {
      const bed = 0x8a5a33, m = [];
      m.push(B(bed, [0.56, 0.04, 0.4], [0, 0.25, -0.05]));                     // bed and boards
      m.push(B(bed, [0.56, 0.14, 0.03], [0, 0.32, -0.235]));
      m.push(B(bed, [0.56, 0.14, 0.03], [0, 0.32, 0.135]));
      m.push(B(0x7a4e2b, [0.03, 0.14, 0.4], [-0.265, 0.32, -0.05]));
      m.push(B(0x7a4e2b, [0.03, 0.14, 0.4], [0.265, 0.32, -0.05]));
      m.push(B(0xd8c27a, [0.46, 0.12, 0.3], [0, 0.33, -0.05]));                // hay, a sack and a crate
      m.push(B(0xcdbb9a, [0.16, 0.14, 0.14], [0.1, 0.46, -0.08], [0, 0.4, 0]));
      m.push(B(0xb8884f, [0.14, 0.12, 0.14], [-0.12, 0.45, -0.04], [0, 0.2, 0]));
      m.push(B(0x5a3b2a, [0.62, 0.03, 0.03], [0, 0.18, -0.05]));               // axle
      [-0.31, 0.31].forEach(x => {
        m.push(Y(0x3d2b1f, [0.36, 0.05, 0.36], [x, 0.18, -0.05], [0, 0, Math.PI / 2]));   // wheels
        m.push(Y(0xb8a37a, [0.1, 0.07, 0.1], [x, 0.18, -0.05], [0, 0, Math.PI / 2]));     // hubs
      });
      m.push(B(0x6b4a2f, [0.04, 0.04, 0.36], [-0.15, 0.24, 0.28]));            // pull handles
      m.push(B(0x6b4a2f, [0.04, 0.04, 0.36], [0.15, 0.24, 0.28]));
      return { matte: m };
    }
  },
  torch: {
    name: 'Torch', cost: 8, cast: true, glow: true, hit: [[0, 0, 0.14, 0.14, 0.66]],
    shape: () => ({
      matte: [
        Y(0x55575c, [0.28, 0.06, 0.28], [0, 0.03, 0]),                         // foot
        Y(0x6b4a2f, [0.12, 0.5, 0.12], [0, 0.25, 0]),                          // post
        U(0x34363b, [0.34, 0.14, 0.34], [0, 0.58, 0]),                         // iron brazier
        Y(0x7a2e12, [0.26, 0.02, 0.26], [0, 0.65, 0])                          // coals
      ]
    })
  }
};

/* ---------- model cache + mesh factory ---------- */
const cache = {};
function model(type, v) {
  const k = type + ':' + (v || 0);
  if (!cache[k]) {
    const d = TYPES[type].shape(v || 0);
    cache[k] = { matte: d.matte && merge(d.matte), sheen: d.sheen && merge(d.sheen) };
  }
  return cache[k];
}

function make(type) {
  const t = TYPES[type], m = model(type, 0), g = new THREE.Group();
  [[m.matte, MATTE], [m.sheen, SHEEN]].forEach(l => {
    if (!l[0]) return;
    const mesh = new THREE.Mesh(l[0], l[1]);
    mesh.castShadow = !!t.cast;
    mesh.receiveShadow = true;
    g.add(mesh);                                                               // children[0] is always the matte body
  });
  return g;
}

// Circle (x, z, r) against a building's collision boxes. y (optional) is the height of the body's lowest point.
function hits(rec, wx, wz, x, z, r, y) {
  const t = TYPES[rec.type], list = t.hit && (t.hitByMask ? t.hit[rec.mask || 0] : t.hit);
  if (!list) return false;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (y !== undefined && y > b[4]) continue;
    const nx = Math.max(wx + b[0] - b[2], Math.min(wx + b[0] + b[2], x));
    const nz = Math.max(wz + b[1] - b[3], Math.min(wz + b[1] + b[3], z));
    if ((x - nx) * (x - nx) + (z - nz) * (z - nz) < r * r) return true;
  }
  return false;
}

export class Buildings {
  constructor(scene, grid) {
    this.scene = scene;
    this.grid = grid;
    this.cells = new Map();     // "cx,cz" -> { type, cx, cz, object, prop? }  (prop = a cart parked on a road)
    this.torches = [];          // { x, z, glow }
    this.near = [];
    this.glowOn = false;
    this.lights = [];           // fixed pool, created before the first render so shaders compile once
    for (let i = 0; i < POOL; i++) {
      const L = new THREE.PointLight(0xff9a4d, 0, 8, 2);
      L.position.y = 1;
      scene.add(L);
      this.lights.push(L);
    }
  }

  at(cx, cz) { return this.cells.get(cx + ',' + cz) || null; }
  isFree(cx, cz) { return this.grid.inBounds(cx, cz) && !this.at(cx, cz); }

  // '' when the placement is allowed, otherwise a short message for the player.
  check(type, cx, cz, gold) {
    const t = TYPES[type];
    if (!t) return 'Pick a tool first.';
    if (!this.grid.inBounds(cx, cz)) return 'That is outside your kingdom.';
    const base = this.at(cx, cz);
    if (base && !(t.onRoad && base.type === 'road' && !base.prop)) return 'That cell is taken.';
    if (gold < t.cost) return 'You need $' + t.cost + ' for a ' + t.name + '.';
    return '';
  }

  // Validates, charges the treasury ({ gold }), builds and registers. Returns { ok, reason }.
  place(type, cx, cz, treasury) {
    const reason = this.check(type, cx, cz, treasury.gold);
    if (reason) return { ok: false, reason: reason };

    const t = TYPES[type], base = this.at(cx, cz), p = this.grid.toWorld(cx, cz), obj = make(type);
    treasury.gold -= t.cost;
    obj.position.set(p.x, base ? 0.06 : 0, p.z);                               // a cart on a road rides on the slab
    if (t.spin) obj.rotation.y = ((cx * 7 + cz * 13) % 4) * Math.PI / 2;
    const glow = t.glow ? this.addFlame(obj) : null;
    obj.updateMatrixWorld(true);
    obj.traverse(o => { o.matrixAutoUpdate = false; });                        // static: skip per-frame matrix work
    this.scene.add(obj);

    const rec = { type: type, cx: cx, cz: cz, object: obj };
    if (base) base.prop = rec; else this.cells.set(cx + ',' + cz, rec);
    if (glow) this.torches.push({ x: p.x, z: p.z, glow: glow });
    if (t.link) {
      this.relink(cx, cz);
      DIRS.forEach(d => this.relink(cx + d[0], cz + d[1]));
    }
    return { ok: true, reason: '' };
  }

  addFlame(obj) {
    const f = new THREE.Mesh(FLAME_GEO, FLAME_MAT);
    f.scale.set(0.2, 0.34, 0.2);
    f.position.set(0, 0.82, 0);
    const g = new THREE.Mesh(GLOW_GEO, GLOW_MAT);
    g.scale.set(4.4, 1, 4.4);
    g.position.set(0, 0.08, 0);                                                // above road slabs, below everything else
    g.visible = this.glowOn;
    obj.add(f, g);
    return g;
  }

  // Re-shape a wall to match which of its four neighbours are walls (16 cached shapes in total).
  relink(cx, cz) {
    const b = this.at(cx, cz);
    if (!b || !TYPES[b.type].link) return;
    let mask = 0;
    for (let i = 0; i < 4; i++) {
      const n = this.at(cx + DIRS[i][0], cz + DIRS[i][1]);
      if (n && n.type === b.type) mask |= 1 << i;
    }
    b.mask = mask;                                                             // collision follows the shape
    b.object.children[0].geometry = model(b.type, mask).matte;
  }

  // True if a body of radius r at world (x, z) touches a solid building. Optional y = height of the body's lowest
  // point, so a camera above a roof is not blocked by it. A cart parked on a road blocks; the bare road does not.
  blocked(x, z, r, y) {
    const half = this.grid.half, c0 = Math.floor(x + half), z0 = Math.floor(z + half);
    for (let cx = c0 - 1; cx <= c0 + 1; cx++) {
      for (let cz = z0 - 1; cz <= z0 + 1; cz++) {
        const rec = this.at(cx, cz);
        if (!rec) continue;
        const wx = cx - half + 0.5, wz = cz - half + 0.5;
        if (hits(rec, wx, wz, x, z, r, y) || (rec.prop && hits(rec.prop, wx, wz, x, z, r, y))) return true;
      }
    }
    return false;
  }

  // Nearest standing spot to (x, z) that is clear of buildings and inside the kingdom.
  freeSpot(x, z, r) {
    const lim = this.grid.half - r;
    for (let d = 0; d <= 5; d += 0.25) {
      for (let a = 0; a < (d ? 16 : 1); a++) {
        const px = x + Math.cos(a * Math.PI / 8) * d, pz = z + Math.sin(a * Math.PI / 8) * d;
        if (Math.abs(px) <= lim && Math.abs(pz) <= lim && !this.blocked(px, pz, r)) return { x: px, z: pz };
      }
    }
    return { x: x, z: z };
  }

  // Call once per frame. night: 0 (day) .. 1 (full dark); time in seconds; focus = { x, z } the camera looks at.
  // Flames always burn; the ground glow fades in with the night; the real lights follow the nearest torches.
  update(night, time, focus) {
    const fx = focus ? focus.x : 0, fz = focus ? focus.z : 0, T = this.torches, near = this.near;
    GLOW_MAT.opacity = night * (0.8 + 0.1 * Math.sin(time * 7));
    const on = night > 0.02;
    if (on !== this.glowOn) {
      this.glowOn = on;
      for (let i = 0; i < T.length; i++) T[i].glow.visible = on;
    }
    near.length = 0;
    for (let k = 0; on && k < POOL; k++) {
      let best = null, bd = Infinity;
      for (let i = 0; i < T.length; i++) {
        const d = (T[i].x - fx) * (T[i].x - fx) + (T[i].z - fz) * (T[i].z - fz);
        if (d < bd && near.indexOf(T[i]) < 0) { bd = d; best = T[i]; }
      }
      if (!best) break;
      near.push(best);
    }
    for (let i = 0; i < this.lights.length; i++) {
      const L = this.lights[i], t = near[i];
      if (t) { L.position.x = t.x; L.position.z = t.z; }
      L.intensity = t ? night * 1.7 * (0.88 + 0.12 * Math.sin(time * 11 + i * 2.1 + t.x)) : 0;
    }
  }
}
