// grid.js: cell math, grid lines and the hover highlight. Everything here stays hidden until a tool is armed.
// Cell (cx, cz) is 0..size-1; the grid is centred on the world origin, 1 cell = 1 world unit.
export class Grid {
  constructor(scene, size) {
    this.size = size || 40;
    this.half = this.size / 2;

    this.lines = new THREE.GridHelper(this.size, this.size, 0xffffff, 0xffffff);
    this.lines.position.y = 0.02;
    this.lines.material.transparent = true;
    this.lines.material.opacity = 0.35;
    this.lines.visible = false;

    const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.fill = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false });
    this.edge = new THREE.LineBasicMaterial();
    this.cursor = new THREE.Mesh(quad, this.fill);
    this.cursor.add(new THREE.LineSegments(new THREE.EdgesGeometry(quad), this.edge));
    this.cursor.position.y = 0.03;
    this.cursor.visible = false;

    scene.add(this.lines, this.cursor);
  }

  inBounds(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.size && cz < this.size; }

  // World X/Z -> cell indices, or null outside the grid.
  snap(x, z) {
    const cx = Math.floor(x + this.half), cz = Math.floor(z + this.half);
    return this.inBounds(cx, cz) ? { cx: cx, cz: cz } : null;
  }

  // Cell indices -> world X/Z of the cell centre.
  toWorld(cx, cz) { return { x: cx - this.half + 0.5, z: cz - this.half + 0.5 }; }

  // Grid lines on/off (on only while a placement or demolish tool is armed).
  setActive(on) {
    this.lines.visible = on;
    if (!on) this.hide();
  }

  show(cx, cz, valid) {
    const p = this.toWorld(cx, cz);
    this.cursor.position.x = p.x;
    this.cursor.position.z = p.z;
    this.fill.color.set(valid ? 0x4dff7a : 0xff4d4d);
    this.edge.color.copy(this.fill.color);
    this.cursor.visible = true;
  }

  hide() { this.cursor.visible = false; }
}
