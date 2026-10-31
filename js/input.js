// input.js: clean pointer pipeline for movement, building placement, and smooth 360 look.
export class Input {
  constructor(o) {
    this.canvas = o.canvas;
    this.camera = o.camera;
    this.grid = o.grid;
    this.active = o.active;       
    this.onHover = o.onHover;     
    this.onPlace = o.onPlace;     

    this.ray = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);   
    this.ndc = new THREE.Vector2();
    this.pt = new THREE.Vector3();
    this.ids = new Set();         
    this.press = null;            
    this.cell = null;             

    // Walk Mode States
    this.keys = { w: false, a: false, s: false, d: false };
    this.lookDelta = { x: 0, y: 0, active: false };
    this.lastPointer = { x: 0, y: 0 };

    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));

    const c = this.canvas;
    c.addEventListener('pointerdown', e => this.down(e));
    c.addEventListener('pointermove', e => this.move(e));
    c.addEventListener('pointerup', e => this.up(e));
    c.addEventListener('pointercancel', e => this.cancel(e));
    c.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') this.setCell(null); });
  }

  onKey(e, isDown) {
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 'arrowup') this.keys.w = isDown;
    if (k === 'a' || k === 'arrowleft') this.keys.a = isDown;
    if (k === 's' || k === 'arrowdown') this.keys.s = isDown;
    if (k === 'd' || k === 'arrowright') this.keys.d = isDown;
  }

  cellAt(e) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    if (!this.ray.ray.intersectPlane(this.ground, this.pt)) return null;   
    return this.grid.snap(this.pt.x, this.pt.z);
  }

  setCell(cell) {
    const a = this.cell, same = (a === cell) || (a && cell && a.cx === cell.cx && a.cz === cell.cz);
    if (same) return;
    this.cell = cell;
    this.onHover(cell);
  }

  reset() { 
    this.press = null; 
    this.setCell(null); 
    this.lookDelta.active = false;
  }

  down(e) {
    if (e.target !== this.canvas) return;
    if (e.isPrimary) this.ids.clear();   
    this.ids.add(e.pointerId);

    // If in Walk mode (no placement tool active), start tracking drag-to-look
    if (!this.active()) {
      this.lookDelta.active = true;
      this.lastPointer.x = e.clientX;
      this.lastPointer.y = e.clientY;
    }

    if (this.ids.size > 1) { this.press = null; this.setCell(null); return; }
    this.press = { x: e.clientX, y: e.clientY, button: e.button, moved: false };
    if (this.active()) this.setCell(this.cellAt(e));
  }

  move(e) {
    const p = this.press, touch = e.pointerType !== 'mouse';
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) p.moved = true;

    // Smooth 360 look delta calculation for Walk Mode
    if (this.lookDelta.active && !this.active()) {
      this.lookDelta.x = (e.clientX - this.lastPointer.x) * 0.005;
      this.lookDelta.y = (e.clientY - this.lastPointer.y) * 0.005;
      this.lastPointer.x = e.clientX;
      this.lastPointer.y = e.clientY;
    } else {
      this.lookDelta.x = 0;
      this.lookDelta.y = 0;
    }

    if (!this.active()) return;
    if (!touch || p) this.setCell(this.cellAt(e));
  }

  up(e) {
    this.ids.delete(e.pointerId);
    const p = this.press, touch = e.pointerType !== 'mouse';
    this.press = null;
    this.lookDelta.active = false;
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;

    if (!p || !this.active()) return;
    const cell = this.cellAt(e);
    if (cell && (touch || (p.button === 0 && !p.moved))) this.onPlace(cell);
    if (touch) this.setCell(null);
  }

  cancel(e) {
    this.ids.delete(e.pointerId);
    this.press = null;
    this.lookDelta.active = false;
    this.setCell(null);
  }
}
