// buildings.js: catalog, placement rules and the occupied-cell map.
// Add a building by adding one entry to TYPES; the toolbar and validation pick it up.
const BOX = new THREE.BoxGeometry(1, 1, 1);
const ROOF = new THREE.ConeGeometry(0.7071, 1, 4).rotateY(Math.PI / 4);   // square pyramid, 1x1 base
const lambert = c => new THREE.MeshLambertMaterial({ color: c });
const MAT = { road: lambert(0x5b6068), wall: lambert(0xeadfc2), roof: lambert(0xb5523b), door: lambert(0x5a3b2a) };

function part(geo, mat, sx, sy, sz, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  return m;
}

// Geometry and materials are shared by every instance, so cost scales with draw calls, not memory.
export const TYPES = {
  road: {
    name: 'Road', cost: 5,
    make() {
      const g = new THREE.Group();
      g.add(part(BOX, MAT.road, 0.98, 0.06, 0.98, 0, 0.03, 0));
      return g;
    }
  },
  house: {
    name: 'House', cost: 20,
    make() {
      const g = new THREE.Group();
      g.add(part(BOX, MAT.wall, 0.64, 0.42, 0.54, 0, 0.21, 0));
      g.add(part(ROOF, MAT.roof, 0.8, 0.36, 0.7, 0, 0.6, 0));
      g.add(part(BOX, MAT.door, 0.14, 0.22, 0.02, 0, 0.11, 0.27));
      return g;
    }
  }
};

export class Buildings {
  constructor(scene, grid) {
    this.scene = scene;
    this.grid = grid;
    this.cells = new Map();   // "cx,cz" -> { type, cx, cz, object }
  }

  at(cx, cz) { return this.cells.get(cx + ',' + cz) || null; }
  isFree(cx, cz) { return this.grid.inBounds(cx, cz) && !this.at(cx, cz); }

  // '' when the placement is allowed, otherwise a short message for the player.
  check(type, cx, cz, gold) {
    const t = TYPES[type];
    if (!t) return 'Pick a tool first.';
    if (!this.grid.inBounds(cx, cz)) return 'That is outside your kingdom.';
    if (this.at(cx, cz)) return 'That cell is taken.';
    if (gold < t.cost) return 'You need $' + t.cost + ' for a ' + t.name + '.';
    return '';
  }

  // Validates, charges the treasury ({ gold }), builds and registers. Returns { ok, reason }.
  place(type, cx, cz, treasury) {
    const reason = this.check(type, cx, cz, treasury.gold);
    if (reason) return { ok: false, reason: reason };

    treasury.gold -= TYPES[type].cost;
    const obj = TYPES[type].make(), p = this.grid.toWorld(cx, cz);
    obj.position.set(p.x, 0, p.z);
    obj.updateMatrixWorld(true);
    obj.traverse(o => { o.matrixAutoUpdate = false; });   // static: skip per-frame matrix work
    this.scene.add(obj);
    this.cells.set(cx + ',' + cz, { type: type, cx: cx, cz: cz, object: obj });
    return { ok: true, reason: '' };
  }
}
