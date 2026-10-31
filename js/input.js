// input.js: pointer pipeline for mouse, touch, pen, keyboard, and virtual mobile joystick.
export class Input {
  constructor(o) {
    this.canvas = o.canvas;
    this.camera = o.camera;
    this.grid = o.grid;
    this.active = o.active;       // () => is a placement tool armed?
    this.onHover = o.onHover;     
    this.onPlace = o.onPlace;     

    this.ray = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);   
    this.ndc = new THREE.Vector2();
    this.pt = new THREE.Vector3();
    this.ids = new Set();         
    this.press = null;            
    this.cell = null;             

    // Movement Vectors for Walk Mode
    this.keys = { w: false, a: false, s: false, d: false };
    this.touchVector = { x: 0, y: 0, active: false };

    // Keyboard Listeners
    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));

    // Pointer Listeners on Canvas
    const c = this.canvas;
    c.addEventListener('pointerdown', e => this.down(e));
    c.addEventListener('pointermove', e => this.move(e));
    c.addEventListener('pointerup', e => this.up(e));
    c.addEventListener('pointercancel', e => this.cancel(e));
    c.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') this.setCell(null); });

    // Build Virtual Touch Joystick UI for Mobile
    this.createMobileJoystick();
  }

  // --- Virtual Joystick for Mobile Walk Mode ---
  createMobileJoystick() {
    if (document.getElementById('virtual-joystick')) return;

    const base = document.createElement('div');
    base.id = 'virtual-joystick';
    base.style.cssText = `
      position: fixed; bottom: 90px; left: 24px; width: 110px; height: 110px;
      background: rgba(0, 0, 0, 0.35); border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%; display: none; touch-action: none; z-index: 1000;
      pointer-events: auto; backdrop-filter: blur(4px);
    `;

    const knob = document.createElement('div');
    knob.id = 'joystick-knob';
    knob.style.cssText = `
      position: absolute; top: 30px; left: 30px; width: 46px; height: 46px;
      background: rgba(244, 201, 93, 0.85); border-radius: 50%;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4); pointer-events: none;
      transition: transform 0.05s ease-out;
    `;
    base.appendChild(knob);
    document.body.appendChild(base);

    let activeTouchId = null;
    const center = { x: 55, y: 55 };

    const handleTouch = (clientX, clientY) => {
      const rect = base.getBoundingClientRect();
      const touchX = clientX - rect.left - center.x;
      const touchY = clientY - rect.top - center.y;
      const dist = Math.hypot(touchX, touchY);
      const maxDist = 40;

      const clampDist = Math.min(dist, maxDist);
      const angle = Math.atan2(touchY, touchX);

      const knobX = Math.cos(angle) * clampDist;
      const knobY = Math.sin(angle) * clampDist;

      knob.style.transform = `translate(${knobX}px, ${knobY}px)`;

      this.touchVector.x = knobX / maxDist;
      this.touchVector.y = knobY / maxDist;
      this.touchVector.active = true;
    };

    base.addEventListener('pointerdown', e => {
      activeTouchId = e.pointerId;
      base.setPointerCapture(e.pointerId);
      handleTouch(e.clientX, e.clientY);
    });

    base.addEventListener('pointermove', e => {
      if (e.pointerId === activeTouchId) {
        handleTouch(e.clientX, e.clientY);
      }
    });

    const stopJoystick = e => {
      if (e.pointerId === activeTouchId) {
        activeTouchId = null;
        knob.style.transform = 'translate(0px, 0px)';
        this.touchVector.x = 0;
        this.touchVector.y = 0;
        this.touchVector.active = false;
      }
    };

    base.addEventListener('pointerup', stopJoystick);
    base.addEventListener('pointercancel', stopJoystick);
  }

  setJoystickVisible(visible) {
    const joy = document.getElementById('virtual-joystick');
    if (joy) joy.style.display = visible ? 'block' : 'none';
    if (!visible) {
      this.touchVector.active = false;
      this.touchVector.x = 0;
      this.touchVector.y = 0;
    }
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
  }

  down(e) {
    if (e.target !== this.canvas) return;
    if (e.isPrimary) this.ids.clear();   
    this.ids.add(e.pointerId);

    if (this.ids.size > 1) { this.press = null; this.setCell(null); return; }
    this.press = { x: e.clientX, y: e.clientY, button: e.button, moved: false };
    if (this.active()) this.setCell(this.cellAt(e));
  }

  move(e) {
    const p = this.press, touch = e.pointerType !== 'mouse';
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) p.moved = true;

    if (!this.active()) return;
    if (!touch || p) this.setCell(this.cellAt(e));
  }

  up(e) {
    this.ids.delete(e.pointerId);
    const p = this.press, touch = e.pointerType !== 'mouse';
    this.press = null;

    if (!p || !this.active()) return;
    const cell = this.cellAt(e);
    if (cell && (touch || (p.button === 0 && !p.moved))) this.onPlace(cell);
    if (touch) this.setCell(null);
  }

  cancel(e) {
    this.ids.delete(e.pointerId);
    this.press = null;
    this.setCell(null);
  }
}
