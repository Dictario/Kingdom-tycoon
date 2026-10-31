// input.js: one pointer pipeline for mouse, touch and pen. Listens on the canvas only, so HUD touches never reach it.
//   Mouse: hover shows the cell, a click (no drag) places.
//   Touch: finger-down shows the cell, dragging re-aims it, lifting places. Drag off the map to cancel.
//   A second finger cancels the gesture (pinch / two-finger pan belongs to the camera).
export class Input {
  constructor(o) {
    this.canvas = o.canvas;
    this.camera = o.camera;
    this.grid = o.grid;
    this.active = o.active;       // () => is a tool armed?
    this.onHover = o.onHover;     // (cell | null) => void
    this.onPlace = o.onPlace;     // (cell) => void
    this.walking = o.walking || (() => false);   // () => in Walk mode? A drag then looks around instead of placing
    this.onLook = o.onLook || (() => {});        // (dx, dy) in pixels
    this.lookId = null;           // the pointer currently dragging the view
    this.last = null;

    this.ray = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);   // y = 0, no mesh needed
    this.ndc = new THREE.Vector2();
    this.pt = new THREE.Vector3();
    this.ids = new Set();         // pointers currently down on the canvas
    this.press = null;            // the single-pointer gesture in progress
    this.cell = null;             // last cell reported to onHover

    const c = this.canvas;
    c.addEventListener('pointerdown', e => this.down(e));
    c.addEventListener('pointermove', e => this.move(e));
    c.addEventListener('pointerup', e => this.up(e));
    c.addEventListener('pointercancel', e => this.cancel(e));
    c.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') this.setCell(null); });
  }

  // Screen point -> grid cell via a ray/plane intersection.
  cellAt(e) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    if (!this.ray.ray.intersectPlane(this.ground, this.pt)) return null;   // pointing at the sky
    return this.grid.snap(this.pt.x, this.pt.z);
  }

  setCell(cell) {
    const a = this.cell, same = (a === cell) || (a && cell && a.cx === cell.cx && a.cz === cell.cz);
    if (same) return;
    this.cell = cell;
    this.onHover(cell);
  }

  reset() { this.press = null; this.lookId = null; this.setCell(null); }

  down(e) {
    if (e.target !== this.canvas) return;
    if (this.walking()) {                            // Walk mode: the first pointer down drives the look drag
      if (this.lookId === null) {
        this.lookId = e.pointerId;
        this.last = [e.clientX, e.clientY];
        try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety */ }
      }
      return;
    }
    if (e.isPrimary) this.ids.clear();   // a primary pointer starts a fresh gesture, so a lost pointerup can't wedge input
    this.ids.add(e.pointerId);
    if (this.ids.size > 1) { this.press = null; this.setCell(null); return; }
    this.press = { x: e.clientX, y: e.clientY, button: e.button, moved: false };
    if (this.active()) this.setCell(this.cellAt(e));
  }

  move(e) {
    if (e.pointerId === this.lookId) {
      this.onLook(e.clientX - this.last[0], e.clientY - this.last[1]);
      this.last = [e.clientX, e.clientY];
      return;
    }
    if (this.walking()) return;
    const p = this.press, touch = e.pointerType !== 'mouse';
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) p.moved = true;
    if (!this.active()) return;
    if (!touch || p) this.setCell(this.cellAt(e));
  }

  up(e) {
    if (e.pointerId === this.lookId) { this.lookId = null; return; }
    if (this.walking()) return;
    this.ids.delete(e.pointerId);
    const p = this.press, touch = e.pointerType !== 'mouse';
    this.press = null;
    if (!p || !this.active()) return;
    const cell = this.cellAt(e);
    if (cell && (touch || (p.button === 0 && !p.moved))) this.onPlace(cell);
    if (touch) this.setCell(null);
  }

  cancel(e) {
    if (e.pointerId === this.lookId) this.lookId = null;
    this.ids.delete(e.pointerId);
    this.press = null;
    this.setCell(null);
  }
}

// Keys: held-key state for Walk mode. Uses physical key positions, so WASD works on any keyboard layout.
// Move: W A S D (and Up/Down arrows). Turn the camera: Q E or Left/Right arrows. Run: Shift.
export class Keys {
  constructor() {
    this.down = {};
    addEventListener('keydown', e => { this.down[e.code] = true; });
    addEventListener('keyup', e => { this.down[e.code] = false; });
    addEventListener('blur', () => { this.down = {}; });   // no stuck keys after alt-tab
  }
  axis() {                                           // x: right(+)/left(-), y: forward(+)/back(-)
    const d = this.down;
    return { x: (d.KeyD ? 1 : 0) - (d.KeyA ? 1 : 0), y: (d.KeyW || d.ArrowUp ? 1 : 0) - (d.KeyS || d.ArrowDown ? 1 : 0) };
  }
  turn() {                                           // positive = turn the view left
    const d = this.down;
    return (d.KeyQ || d.ArrowLeft ? 1 : 0) - (d.KeyE || d.ArrowRight ? 1 : 0);
  }
  get run() { return !!(this.down.ShiftLeft || this.down.ShiftRight); }
}

// Pad: on-screen joystick. x and y are -1..1 (y up = forward) with a small dead zone. One pointer at a time,
// so a second finger is free to drag the canvas and look around.
export class Pad {
  constructor(el, knob) {
    this.el = el;
    this.knob = knob;
    this.x = 0;
    this.y = 0;
    this.id = null;
    el.addEventListener('pointerdown', e => {
      if (this.id !== null) return;
      this.id = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety */ }
      this.move(e);
    });
    el.addEventListener('pointermove', e => { if (e.pointerId === this.id) this.move(e); });
    el.addEventListener('pointerup', e => { if (e.pointerId === this.id) this.release(); });
    el.addEventListener('pointercancel', e => { if (e.pointerId === this.id) this.release(); });
  }
  move(e) {
    const r = this.el.getBoundingClientRect(), max = r.width * 0.35;     // full deflection at 35% of the pad width
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy), m = Math.min(1, d / max), k = d > 0 ? Math.min(d, max) / d : 0;
    const f = m < 0.15 ? 0 : (m - 0.15) / 0.85;                          // dead zone, then rescale to 0..1
    this.x = d > 0 ? dx / d * f : 0;
    this.y = d > 0 ? -dy / d * f : 0;
    this.knob.style.transform = 'translate(' + dx * k + 'px,' + dy * k + 'px)';
  }
  release() {
    this.id = null;
    this.x = 0;
    this.y = 0;
    this.knob.style.transform = 'translate(0,0)';
  }
}
