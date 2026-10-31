// input.js: pointer pipeline with split-screen mobile controls (Left: Move, Right: Look, Center: Zoom).
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

    // Walk Mode Movement & Look Vectors
    this.keys = { w: false, a: false, s: false, d: false };
    this.touchVector = { x: 0, y: 0, active: false };
    this.lookDelta = { x: 0, active: false };
    this.zoomDelta = 0;

    window.addEventListener('keydown', e => this.onKey(e, true));
    window.addEventListener('keyup', e => this.onKey(e, false));

    const c = this.canvas;
    c.addEventListener('pointerdown', e => this.down(e));
    c.addEventListener('pointermove', e => this.move(e));
    c.addEventListener('pointerup', e => this.up(e));
    c.addEventListener('pointercancel', e => this.cancel(e));
    c.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') this.setCell(null); });

    this.setupSplitScreenUI();
  }

  setupSplitScreenUI() {
    if (document.getElementById('mobile-controls-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'mobile-controls-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; display: none; z-index: 1000;
    `;

    // Left joystick visual guide
    const leftZone = document.createElement('div');
    leftZone.id = 'joystick-base';
    leftZone.style.cssText = `
      position: absolute; bottom: 40px; left: 40px; width: 120px; height: 120px;
      background: rgba(0, 0, 0, 0.25); border: 2px solid rgba(255, 255, 255, 0.2);
      border-radius: 50%; pointer-events: auto; backdrop-filter: blur(4px);
    `;
    const knob = document.createElement('div');
    knob.id = 'joystick-knob';
    knob.style.cssText = `
      position: absolute; top: 35px; left: 35px; width: 50px; height: 50px;
      background: rgba(244, 201, 93, 0.85); border-radius: 50%;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4); pointer-events: none;
      transition: transform 0.05s ease-out;
    `;
    leftZone.appendChild(knob);
    overlay.appendChild(leftZone);

    // Right screen look indicator hint
    const rightHint = document.createElement('div');
    rightHint.id = 'right-look-hint';
    rightHint.style.cssText = `
      position: absolute; bottom: 40px; right: 40px; padding: 8px 14px;
      background: rgba(0,0,0,0.3); border-radius: 8px; font-size: 11px;
      color: rgba(255,255,255,0.7); pointer-events: none;
    `;
    rightHint.textContent = 'Drag here to look around';
    overlay.appendChild(rightHint);

    document.body.appendChild(overlay);

    // Handle Left Joystick Touch
    let moveTouchId = null;
    const center = { x: 60, y: 60 };
    leftZone.addEventListener('pointerdown', e => {
      moveTouchId = e.pointerId;
      leftZone.setPointerCapture(e.pointerId);
      this.updateJoystick(e, leftZone, knob, center);
    });
    leftZone.addEventListener('pointermove', e => {
      if (e.pointerId === moveTouchId) this.updateJoystick(e, leftZone, knob, center);
    });
    const endMove = e => {
      if (e.pointerId === moveTouchId) {
        moveTouchId = null;
        knob.style.transform = 'translate(0px, 0px)';
        this.touchVector.x = 0;
        this.touchVector.y = 0;
        this.touchVector.active = false;
      }
    };
    leftZone.addEventListener('pointerup', endMove);
    leftZone.addEventListener('pointercancel', endMove);
  }

  updateJoystick(e, base, knob, center) {
    const rect = base.getBoundingClientRect();
    const touchX = e.clientX - rect.left - center.x;
    const touchY = e.clientY - rect.top - center.y;
    const dist = Math.hypot(touchX, touchY);
    const maxDist = 45;
    const clampDist = Math.min(dist, maxDist);
    const angle = Math.atan2(touchY, touchX);

    const knobX = Math.cos(angle) * clampDist;
    const knobY = Math.sin(angle) * clampDist;
    knob.style.transform = `translate(${knobX}px, ${knobY}px)`;

    this.touchVector.x = knobX / maxDist;
    this.touchVector.y = knobY / maxDist;
    this.touchVector.active = true;
  }

  setControlsVisible(visible) {
    const overlay = document.getElementById('mobile-controls-overlay');
    if (overlay) overlay.style.display = visible ? 'block' : 'none';
    if (!visible) {
      this.touchVector.active = false;
      this.touchVector.x = 0;
      this.touchVector.y = 0;
      this.lookDelta.active = false;
      this.lookDelta.x = 0;
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

    // If in Walk mode and touching the right side of the screen, enable looking around
    if (e.pointerType === 'touch' && !this.active() && e.clientX > window.innerWidth * 0.45) {
      this.lookDelta.active = true;
      this.lookDelta.startX = e.clientX;
    }

    if (this.ids.size > 1) { this.press = null; this.setCell(null); return; }
    this.press = { x: e.clientX, y: e.clientY, button: e.button, moved: false };
    if (this.active()) this.setCell(this.cellAt(e));
  }

  move(e) {
    const p = this.press, touch = e.pointerType !== 'mouse';
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) p.moved = true;

    // Handle right-side screen drag for camera looking in Walk mode
    if (this.lookDelta.active && touch) {
      const deltaX = e.clientX - this.lookDelta.startX;
      this.lookDelta.x = deltaX * 0.005;
      this.lookDelta.startX = e.clientX;
    } else {
      this.lookDelta.x = 0;
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
