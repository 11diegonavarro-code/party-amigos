// Recorridos: cada mapa es una lista de secciones que se construyen una detrás de otra a lo largo de +z.
// Todo lo aleatorio (puertas falsas, bolas) sale de una semilla del anfitrión y todo lo que se mueve
// depende del reloj común, así que todos los jugadores ven lo mismo.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const SLIME_Y = -7;
const FOOT = 0.9; // de los pies al centro de una gominola

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTES = {
  pastel: { floor: [0x7cc7ff, 0xb9a2ff, 0x5fe0a8], wall: 0xff6fb5, trim: 0xf7f7fb, accent: [0xffd23f, 0xff8f3d, 0xff4b5c, 0x3d7bff], slime: 0xff3d9a },
  fabrica: { floor: [0xffc98b, 0xf4a259, 0xe9d8a6], wall: 0x8a5a3b, trim: 0xfff3e0, accent: [0x2ec4b6, 0xff595e, 0x6a4c93, 0x8ecae6], slime: 0xff8c1a },
  cumbre: { floor: [0xd6ecff, 0xc8b6ff, 0xa0e7e5], wall: 0x7aa5ff, trim: 0xffffff, accent: [0xff6fb5, 0xffd23f, 0x5fe0a8, 0x3d7bff], slime: 0x8a5cff },
};

// Barras de las barredoras: [altura sobre el suelo, velocidad de giro]
const LOW = 0.55, HIGH = 2.3;
export const MAPS = {
  gominola: {
    name: 'Carrera Gominola', palette: 'pastel', sections: [
      ['start'], ['doors', { rows: 3 }],
      ['sweepers', { discs: [[[LOW, 1.25]], [[LOW, -1.55], [HIGH, 0.9]]] }],
      ['gaps', { count: 4, gap: 3.2 }], ['seesaws', { count: 3 }], ['hammers', { count: 6, speed: 1.85 }],
      ['ballRamp', { len: 40, rise: 10, every: 1.0 }], ['finish'],
    ],
  },
  fabrica: {
    name: 'Fábrica de Caramelos', palette: 'fabrica', sections: [
      ['start'], ['conveyor', { len: 40, speed: 3 }], ['punchers', { count: 6 }], ['logs', { count: 3 }],
      ['doors', { rows: 2 }], ['tiles', { cols: 6, rows: 9 }], ['ballRamp', { len: 36, rise: 9, every: 0.85 }], ['finish'],
    ],
  },
  cumbre: {
    name: 'Cumbre Merengue', palette: 'cumbre', sections: [
      ['start'], ['gaps', { count: 6, gap: 3.6, moving: true }],
      ['sweepers', { discs: [[[LOW, 1.4], [LOW, -0.9]], [[LOW, -1.6], [HIGH, 1.0]], [[LOW, 1.9]]] }],
      ['logs', { count: 2 }], ['hammers', { count: 5, speed: 2.1, width: 3.4 }],
      ['gaps', { count: 4, gap: 5.4 }], ['tiles', { cols: 5, rows: 8 }],
      ['ballRamp', { len: 44, rise: 12, every: 0.8 }], ['finish'],
    ],
  },
};

// ---------- Texturas ----------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
const STRIPES = canvasTex(128, 128, g => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#dcdce4';
  for (let i = -128; i < 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 - 128, 128); g.lineTo(i - 128, 128); g.fill(); }
});
const BELT = canvasTex(64, 128, g => {
  g.fillStyle = '#3a3a44'; g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#ffd23f';
  for (let y = 0; y < 128; y += 32) { g.beginPath(); g.moveTo(8, y + 22); g.lineTo(32, y + 6); g.lineTo(56, y + 22); g.lineTo(56, y + 30); g.lineTo(32, y + 14); g.lineTo(8, y + 30); g.fill(); }
});
const caneTexture = (a, b) => canvasTex(64, 256, g => {
  g.fillStyle = a; g.fillRect(0, 0, 64, 256);
  g.fillStyle = b;
  for (let y = -64; y < 320; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(64, y + 32); g.lineTo(64, y + 64); g.lineTo(0, y + 32); g.fill(); }
});
const CHECKER = canvasTex(256, 64, g => { for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 32, y * 32, 32, 32); } });
const hex = c => '#' + new THREE.Color(c).getHexString();

const candy = (color, map) => new THREE.MeshPhysicalMaterial({ color, map: map || null, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.8 });
const quatY = a => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
const quatZ = a => ({ x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) });
const ID = { x: 0, y: 0, z: 0, w: 1 };

export class Course {
  constructor(scene, R, world) {
    Object.assign(this, { scene, R, world });
    this.group = null;
    this.emit = () => {}; // lo conecta main para enviar eventos por la red
  }

  // ---------- Carga de un mapa ----------
  load(mapId) {
    this.unload();
    const map = MAPS[mapId] || MAPS.gominola;
    Object.assign(this, {
      mapId: MAPS[mapId] ? mapId : 'gominola', map, pal: PALETTES[map.palette],
      group: new THREE.Group(), bodies: [], kin: [], sections: [], balls: [], surfaces: new Map(), tileByHandle: new Map(), checkpoints: [],
    });
    this.scene.add(this.group);
    let z = 0, y = 0;
    map.sections.forEach(([type, opts], index) => {
      const sec = { type, index, z0: z, y0: y };
      const end = this[type](sec, z, y, opts || {});
      sec.z1 = end.z; sec.y1 = end.y;
      if (sec.checkpoint) this.checkpoints.push(sec.checkpoint);
      this.sections.push(sec);
      z = end.z; y = end.y;
    });
    this.length = z;
  }

  unload() {
    if (!this.group) return;
    for (const b of [...this.bodies, ...this.balls.map(b => b.body)]) this.world.removeRigidBody(b);
    this.group.traverse(o => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      for (const m of [].concat(o.material)) { if (m.map && m.map !== STRIPES && m.map !== BELT && m.map !== CHECKER) m.map.dispose(); m.dispose(); }
    });
    this.group.removeFromParent();
    this.group = null;
  }

  sectionAt(z) {
    for (const s of this.sections) if (z < s.z1) return s;
    return this.sections[this.sections.length - 1];
  }

  // ---------- Piezas ----------
  track(desc) { const b = this.world.createRigidBody(desc); this.bodies.push(b); return b; }

  box(x, y, z, hx, hy, hz, color, { rot = null, radius = 0.35, collide = true, striped = true, kinematic = false, map = null } = {}) {
    const mat = candy(color);
    if (map) mat.map = map;
    else if (striped) { mat.map = STRIPES.clone(); mat.map.repeat.set(Math.max(1, hx / 2), Math.max(1, hz / 2)); mat.map.needsUpdate = true; }
    const m = new THREE.Mesh(new RoundedBoxGeometry(hx * 2, hy * 2, hz * 2, 3, Math.min(radius, hx, hy, hz)), mat);
    m.position.set(x, y, z);
    if (rot) m.quaternion.copy(rot);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
    let body = null, collider = null;
    if (collide) {
      const desc = (kinematic ? this.R.RigidBodyDesc.kinematicPositionBased() : this.R.RigidBodyDesc.fixed()).setTranslation(x, y, z);
      if (rot) desc.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
      body = this.track(desc);
      collider = this.world.createCollider(this.R.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.8), body);
    }
    return { mesh: m, body, collider };
  }

  pillar(x, y, z, r, h, color) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), candy(color));
    m.position.set(x, y + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
    const b = this.track(this.R.RigidBodyDesc.fixed().setTranslation(x, y + h / 2, z));
    this.world.createCollider(this.R.ColliderDesc.cylinder(h / 2, r), b);
  }

  walls(z0, z1, y, halfW, color, h = 3.5) {
    for (const s of [-1, 1]) this.box(s * (halfW + 0.3), y + h / 2 - 0.5, (z0 + z1) / 2, 0.3, h / 2 + 0.5, (z1 - z0) / 2, color, { striped: false });
  }

  // ---------- Secciones ----------
  start(sec, z, y) {
    const P = this.pal;
    this.box(0, y - 1, z + 10, 12, 1, 10, P.floor[0]);
    this.box(0, y + 1.5, z - 0.3, 12.6, 2.5, 0.3, P.wall, { striped: false });
    this.walls(z, z + 20, y, 12, P.wall, 4);
    sec.checkpoint = { z: z + 8, y, w: 9 };
    this.spawn = i => ({ x: -7.5 + (i % 6) * 3, y: y + FOOT + 0.05, z: z + 3.5 + Math.floor(i / 6) * 3 });
    return { z: z + 20, y };
  }

  doors(sec, z, y, { rows = 3 }) {
    const P = this.pal, len = rows * 12 + 6;
    this.box(0, y - 1, z + len / 2, 12, 1, len / 2, P.floor[1]);
    this.walls(z, z + len, y, 12, P.wall, 5);
    const doorMat = candy(P.accent[3]), emblem = new THREE.MeshPhysicalMaterial({ color: P.accent[0], roughness: 0.3, clearcoat: 1 });
    sec.walls = [];
    for (let r = 0; r < rows; r++) {
      const wz = z + 7 + r * 12, wall = { z: wz, doors: [] }, x0 = -11.9;
      for (let i = 0; i <= 6; i++) this.box(x0 + 0.2 + i * 3.9, y + 2.5, wz, 0.2, 2.5, 0.35, P.trim, { striped: false, radius: 0.15 });
      this.box(0, y + 4.4, wz, 12, 0.6, 0.35, P.trim, { striped: false, radius: 0.2 });
      for (let i = 0; i < 6; i++) {
        const x = x0 + 0.4 + 1.75 + i * 3.9, g = new THREE.Group();
        g.position.set(x, y, wz);
        const panel = new THREE.Mesh(new RoundedBoxGeometry(3.4, 3.7, 0.4, 2, 0.15).translate(0, 1.85, 0), doorMat);
        panel.castShadow = true;
        g.add(panel);
        for (const s of [-1, 1]) {
          const star = new THREE.Mesh(new THREE.CircleGeometry(0.55, 5), emblem);
          star.position.set(0, 2, s * 0.21);
          star.rotation.y = s > 0 ? 0 : Math.PI;
          g.add(star);
        }
        this.group.add(g);
        const body = this.track(this.R.RigidBodyDesc.fixed().setTranslation(x, y + 1.85, wz));
        const collider = this.world.createCollider(this.R.ColliderDesc.cuboid(1.7, 1.85, 0.2).setFriction(0.5), body);
        wall.doors.push({ x, mesh: g, collider, real: false, broken: false, fall: 0 });
      }
      sec.walls.push(wall);
    }
    const breakDoor = (w, d) => {
      const door = sec.walls[w]?.doors[d];
      if (!door || door.broken || !door.real) return false;
      door.broken = true;
      door.collider.setEnabled(false);
      return true;
    };
    sec.reset = r => {
      for (const wall of sec.walls) {
        const order = [0, 1, 2, 3, 4, 5].sort(() => r() - 0.5);
        wall.doors.forEach((d, i) => {
          Object.assign(d, { real: order.indexOf(i) < 3, broken: false, fall: 0 });
          d.collider.setEnabled(true);
          d.mesh.visible = true;
          d.mesh.rotation.set(0, 0, 0);
        });
      }
    };
    // Una gominola propia toca una puerta: si es de verdad, se rompe y se avisa al resto
    sec.touch = p => {
      for (let w = 0; w < sec.walls.length; w++) {
        const wall = sec.walls[w];
        if (Math.abs(p.z - wall.z) > 1.05 || p.y > y + 4) continue;
        for (let d = 0; d < wall.doors.length; d++) {
          const door = wall.doors[d];
          if (!door.broken && Math.abs(p.x - door.x) < 1.95 && breakDoor(w, d)) return { k: 'door', w, d, x: door.x, z: wall.z };
        }
      }
      return null;
    };
    sec.remote = e => (e.k === 'door' && breakDoor(e.w, e.d) ? { x: sec.walls[e.w].doors[e.d].x, z: sec.walls[e.w].z } : null);
    sec.sync = (t, dt) => {
      for (const wall of sec.walls) for (const d of wall.doors) {
        if (!d.broken || !d.mesh.visible) continue;
        d.fall += dt;
        d.mesh.rotation.x = Math.min(Math.PI / 2, d.fall * d.fall * 9);
        if (d.fall > 2.5) d.mesh.visible = false;
      }
    };
    sec.ai = (plan, c) => {
      const wall = sec.walls.find(w => w.z > c.p.z - 0.6);
      if (!wall) { plan.tx = c.mem.lane * 0.6; return; }
      const key = i => `${wall.z}:${i}`;
      if (!c.mem.door || !c.mem.door.startsWith(`${wall.z}:`)) {
        const options = wall.doors.map((d, i) => i).filter(i => !c.mem.fake.has(key(i)));
        const open = options.filter(i => wall.doors[i].broken); // si ve una abierta, mejor esa
        const pool = open.length && Math.random() < 0.85 ? open : options;
        c.mem.door = key(pool[Math.floor(Math.random() * pool.length)] ?? 0);
      }
      const door = wall.doors[+c.mem.door.split(':')[1]];
      plan.tx = door.x; plan.tz = wall.z + 2;
      plan.doorKey = c.mem.door;
    };
    sec.checkpoint = { z: z + 2, y, w: 8 };
    return { z: z + len, y };
  }

  sweeper(cx, y, cz, len, speed, phase, colors) {
    const R = this.R;
    const body = this.track(R.RigidBodyDesc.kinematicPositionBased().setTranslation(cx, y, cz));
    this.world.createCollider(R.ColliderDesc.cuboid(len, 0.32, 0.32).setFriction(0.3), body);
    const tex = caneTexture(colors[0], colors[1]);
    tex.repeat.set(1, len / 1.5);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, len * 2, 20).rotateZ(Math.PI / 2), candy(0xffffff, tex));
    mesh.castShadow = true;
    this.group.add(mesh);
    this.kin.push({ body, mesh, at: t => ({ p: { x: cx, y, z: cz }, q: quatY(speed * t + phase) }) });
    return { y, speed, phase };
  }

  sweepers(sec, z, y, { discs }) {
    const P = this.pal;
    this.box(0, y - 1, z + 3, 4, 1, 3, P.floor[2]);
    let cz = z + 6;
    sec.discs = [];
    discs.forEach((bars, k) => {
      const c = cz + 11;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 2, 64), candy(P.floor[k % 2]));
      m.position.set(0, y - 1, c);
      m.castShadow = true; m.receiveShadow = true;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(11, 0.3, 10, 64).rotateX(Math.PI / 2), candy(P.trim));
      ring.position.set(0, y, c);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 3, 24), candy(P.trim));
      hub.position.set(0, y + 1.5, c);
      hub.castShadow = true;
      this.group.add(m, ring, hub);
      const db = this.track(this.R.RigidBodyDesc.fixed().setTranslation(0, y - 1, c));
      this.world.createCollider(this.R.ColliderDesc.cylinder(1, 11).setFriction(0.8), db);
      this.world.createCollider(this.R.ColliderDesc.cylinder(1.5, 1.3).setTranslation(0, 2.5, 0), db);
      const cols = [[hex(P.accent[2]), '#ffffff'], [hex(P.accent[3]), '#ffffff'], [hex(P.accent[0]), hex(P.accent[1])]];
      const list = bars.map(([by, sp], j) => ({ ...this.sweeper(0, y + by, c, 10.6, sp, j * 1.7 + k, cols[(j + k) % 3]), y: by }));
      sec.discs.push({ z: c, r: 11, bars: list });
      cz += 22;
      this.box(0, y - 1, cz + 2, 3, 1, 2, P.floor[2]);
      cz += 4;
    });
    sec.ai = (plan, c) => {
      plan.tx = c.mem.lane * 0.5;
      for (const disc of sec.discs) {
        const dx = c.p.x, dz = c.p.z - disc.z, r = Math.hypot(dx, dz);
        if (r > disc.r + 0.5 || r < 1.6) continue;
        const phi = Math.atan2(dx, dz);
        let low = false, high = false;
        for (const bar of disc.bars) {
          // ángulo que le falta a la barra (una línea que pasa por el centro: periodo π) para llegar al bot
          let gap = ((phi - (bar.speed * c.t + bar.phase + Math.PI / 2)) * Math.sign(bar.speed)) % Math.PI;
          if (gap < 0) gap += Math.PI;
          const tHit = gap / Math.abs(bar.speed);
          if (bar.y < 1 && tHit < 0.22 + (1 - c.mem.skill) * 0.1) low = true;
          if (bar.y > 2 && (tHit < 0.6 || tHit > Math.PI / Math.abs(bar.speed) - 0.2)) high = true;
        }
        if (low && !high && c.grounded && Math.random() < 0.6 + c.mem.skill * 0.4) plan.jump = true;
      }
    };
    sec.checkpoint = { z: z + 3, y, w: 3 };
    return { z: cz, y };
  }

  gaps(sec, z, y, { count = 4, gap = 3.2, moving = false, size = 5 }) {
    const P = this.pal;
    this.box(0, y - 1, z + 3, 4, 1, 3, P.floor[0]);
    let cz = z + 6;
    sec.plats = [];
    for (let i = 0; i < count; i++) {
      cz += gap;
      const pz = cz + size / 2;
      const mov = moving && i % 2 === 0 ? { amp: 3.2, w: 0.85 + (i % 3) * 0.2, ph: i * 1.3 } : null;
      const color = P.accent[i % P.accent.length];
      if (mov) {
        const { mesh, body } = this.box(0, y - 0.6, pz, size / 2, 0.6, size / 2, color, { kinematic: true });
        this.kin.push({ body, mesh, at: t => ({ p: { x: mov.amp * Math.sin(mov.w * t + mov.ph), y: y - 0.6, z: pz }, q: ID }) });
      } else this.box(0, y - 0.6, pz, size / 2, 0.6, size / 2, color);
      sec.plats.push({ z0: cz, z1: cz + size, x: t => (mov ? mov.amp * Math.sin(mov.w * t + mov.ph) : 0), half: size / 2 });
      cz += size;
    }
    cz += gap;
    this.box(0, y - 1, cz + 3, 5, 1, 3, P.floor[0]);
    cz += 6;
    sec.ai = (plan, c) => {
      plan.longGap = gap > 4.4;
      const next = sec.plats.find(pl => pl.z1 > c.p.z + 0.8);
      if (!next) { plan.tx = 0; return; }
      const onIt = c.p.z > next.z0 - 0.2;
      const eta = onIt ? 0 : Math.max(0.2, (next.z0 - c.p.z) / 6.4);
      plan.tx = next.x(c.t + eta);
      plan.tz = next.z1;
      // Ante una plataforma móvil desalineada, espera en el borde
      if (!onIt && c.grounded && next.z0 - c.p.z < 2.4 && Math.abs(next.x(c.t + 0.75) - c.p.x) > next.half - 0.8) plan.wait = true;
    };
    sec.checkpoint = { z: z + 3, y, w: 3 };
    return { z: cz, y };
  }

  seesaws(sec, z, y, { count = 3 }) {
    const P = this.pal, R = this.R;
    this.box(0, y - 1, z + 2.5, 3, 1, 2.5, P.floor[2]);
    let cz = z + 5;
    sec.boards = [];
    for (let i = 0; i < count; i++) {
      cz += 0.4;
      const c = cz + 6, by = y - 0.35;
      const pivot = this.track(R.RigidBodyDesc.fixed().setTranslation(0, by, c));
      const board = this.track(R.RigidBodyDesc.dynamic().setTranslation(0, by, c).setAngularDamping(1.2).setCanSleep(false));
      this.world.createCollider(R.ColliderDesc.cuboid(5, 0.35, 6).setDensity(2).setFriction(0.8), board);
      const joint = this.world.createImpulseJoint(R.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), pivot, board, true);
      joint.setLimits(-0.42, 0.42);
      joint.configureMotorPosition(0, 3200, 850);
      const mesh = new THREE.Mesh(new RoundedBoxGeometry(10, 0.7, 12, 3, 0.3), candy(P.accent[i % 2], STRIPES));
      mesh.castShadow = true; mesh.receiveShadow = true;
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.4, 7, 16).translate(0, -3.5, 0), candy(P.accent[1]));
      stand.position.set(0, by, c);
      this.group.add(mesh, stand);
      sec.boards.push({ board, mesh });
      cz += 12.4;
      this.box(0, y - 1, cz + 2.5, 3, 1, 2.5, P.floor[2]);
      cz += 5;
    }
    sec.reset = () => { for (const s of sec.boards) { s.board.setRotation(ID, true); s.board.setAngvel({ x: 0, y: 0, z: 0 }, true); } };
    sec.sync = () => {
      for (const s of sec.boards) {
        const p = s.board.translation(), q = s.board.rotation();
        s.mesh.position.set(p.x, p.y, p.z);
        s.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      }
    };
    sec.ai = plan => { plan.tx = 0; };
    sec.checkpoint = { z: z + 2.5, y, w: 2 };
    return { z: cz, y };
  }

  hammer(z, y, phase, speed) {
    const R = this.R, P = this.pal, PY = y + 9.5, L = 7.6, AMP = 1.05;
    const body = this.track(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, PY - L, z));
    this.world.createCollider(R.ColliderDesc.cuboid(1.0, 0.9, 1.3).setFriction(0.3), body);
    const pivot = new THREE.Group();
    pivot.position.set(0, PY, z);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, L, 12).translate(0, -L / 2, 0), candy(0xd0d4dc));
    const head = new THREE.Mesh(new RoundedBoxGeometry(2, 1.8, 2.6, 3, 0.35), candy(P.accent[2]));
    head.position.y = -L;
    const band = new THREE.Mesh(new RoundedBoxGeometry(2.08, 0.5, 2.68, 2, 0.2), candy(P.accent[0]));
    band.position.y = -L;
    for (const m of [arm, head, band]) { m.castShadow = true; pivot.add(m); }
    this.group.add(pivot);
    for (const s of [-1, 1]) this.box(s * 8.2, y + 4.2, z, 0.35, 5.6, 0.35, P.trim, { striped: false, collide: false });
    this.box(0, y + 9.9, z, 8.6, 0.35, 0.35, P.trim, { striped: false, collide: false });
    const angle = t => AMP * Math.sin(speed * t + phase);
    this.kin.push({ body, mesh: pivot, pivotMode: true, angle, at: t => { const a = angle(t); return { p: { x: L * Math.sin(a), y: PY - L * Math.cos(a), z }, q: quatZ(a) }; } });
    return { z, headX: t => L * Math.sin(angle(t)) };
  }

  hammers(sec, z, y, { count = 6, speed = 1.7, width = 4.4 }) {
    const P = this.pal, len = count * 6 + 6;
    this.box(0, y - 1, z + 3, 4, 1, 3, P.floor[0]);
    this.box(0, y - 1, z + 6 + len / 2, width / 2, 1, len / 2, P.wall);
    sec.hammers = Array.from({ length: count }, (_, k) => this.hammer(z + 6 + 4 + k * 6, y, k * 1.3, speed));
    sec.ai = (plan, c) => {
      plan.tx = 0;
      const next = sec.hammers.find(h => h.z > c.p.z - 1.2);
      if (next && next.z - c.p.z < 3.2 && next.z - c.p.z > 1.6) {
        if (Math.abs(next.headX(c.t + 0.55)) < 3.1 || Math.abs(next.headX(c.t + 0.25)) < 3.1) plan.wait = true;
      }
    };
    sec.checkpoint = { z: z + 3, y, w: 2 };
    return { z: z + 6 + len, y };
  }

  ballRamp(sec, z, y, { len = 40, rise = 10, every = 1.0 }) {
    const P = this.pal, R = this.R;
    this.box(0, y - 1, z + 4, 8, 1, 4, P.floor[2]);
    const z0 = z + 8, z1 = z0 + len, y1 = y + rise, a = Math.atan2(rise, len), slope = Math.hypot(len, rise);
    const rq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -a);
    this.box(0, y + rise / 2 - Math.cos(a), (z0 + z1) / 2 + Math.sin(a), 7, 1, slope / 2, P.floor[0], { rot: rq, radius: 0.3 });
    const rampY = zz => y + ((zz - z0) / len) * rise;
    for (const [x, f] of [[-3, 0.22], [3, 0.36], [0, 0.5], [-4, 0.66], [4, 0.66], [-1.5, 0.82]]) {
      const zz = z0 + len * f;
      this.pillar(x, rampY(zz) - 0.4, zz, 0.9, 2.8, P.accent[1]);
    }
    this.box(0, y1 - 1, z1 + 2, 7, 1, 2, P.floor[1]);
    const geo = new THREE.SphereGeometry(1.4, 28, 20), mats = P.accent.map(col => candy(col, STRIPES));
    let next = 0, r = null;
    sec.reset = rr => { r = rr; next = 0; };
    sec.step = t => {
      while (t > 0 && r && next < t) {
        const lanes = [-4.5, -1.5, 1.5, 4.5], lane = lanes[Math.floor(r() * 4)], k = r();
        next += every * (0.85 + r() * 0.5);
        if (this.balls.length > 22) continue;
        const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(lane, y1 + 2.6, z1 - 1.5).setLinvel(0, 0, -2).setCcdEnabled(true));
        this.world.createCollider(R.ColliderDesc.ball(1.4).setDensity(28).setRestitution(0.25).setFriction(0.6), body);
        const mesh = new THREE.Mesh(geo, mats[Math.floor(k * mats.length) % mats.length]);
        mesh.castShadow = true;
        this.group.add(mesh);
        this.balls.push({ body, mesh, minZ: sec.z0 - 25 });
      }
    };
    sec.ai = (plan, c) => {
      plan.tx = c.mem.lane * 0.7;
      for (const b of this.balls) {
        const bp = b.body.translation();
        if (bp.z > c.p.z && bp.z - c.p.z < 9 && Math.abs(bp.x - c.p.x) < 2.2) c.mem.lane = bp.x > c.p.x ? Math.max(-5.5, c.p.x - 3) : Math.min(5.5, c.p.x + 3);
      }
    };
    sec.checkpoint = { z: z + 4, y, w: 6 };
    return { z: z1 + 4, y: y1 };
  }

  conveyor(sec, z, y, { len = 40, speed = 3 }) {
    const P = this.pal;
    this.box(0, y - 1, z + 2, 5, 1, 2, P.floor[0]);
    const tex = BELT.clone();
    tex.repeat.set(3, len / 3);
    tex.needsUpdate = true;
    const belt = this.box(0, y - 1, z + 4 + len / 2, 5, 1, len / 2, 0xffffff, { map: tex, radius: 0.2 });
    this.surfaces.set(belt.collider.handle, { x: 0, y: 0, z: -speed });
    sec.rows = [];
    for (let k = 0; 4 + 6 + k * 6 < len - 2; k++) {
      const rz = z + 4 + 6 + k * 6, gapX = [-3, 0, 3][(k * 7 + 1) % 3];
      for (const x of [-3, 0, 3]) if (x !== gapX) this.pillar(x, y, rz, 0.85, 2.2, P.accent[k % P.accent.length]);
      sec.rows.push({ z: rz, gapX });
    }
    this.box(0, y - 1, z + 4 + len + 2, 5, 1, 2, P.floor[0]);
    sec.sync = t => { tex.offset.y = (t * speed) / 3; };
    sec.ai = (plan, c) => {
      const row = sec.rows.find(r => r.z > c.p.z - 0.5);
      plan.tx = row ? row.gapX : 0;
    };
    sec.checkpoint = { z: z + 2, y, w: 3 };
    return { z: z + 4 + len + 4, y };
  }

  punchers(sec, z, y, { count = 6 }) {
    const P = this.pal, R = this.R, L = count * 6 + 4;
    this.box(0, y - 1, z + 2, 4, 1, 2, P.floor[0]);
    this.box(0, y - 1, z + 4 + L / 2, 4, 1, L / 2, P.floor[2]);
    sec.pistons = [];
    for (let k = 0; k < count; k++) {
      const pz = z + 4 + 4 + k * 6, side = k % 2 ? 1 : -1, period = 2.4 + (k % 3) * 0.3, ph = k * 0.7;
      // Golpe rápido (0,22 s), espera, y vuelve despacio
      const ext = t => {
        const u = (((t + ph) % period) + period) % period;
        return u < 0.22 ? (u / 0.22) * 5.4 : u < 0.6 ? 5.4 : u < 1.6 ? 5.4 * (1 - (u - 0.6)) : 0;
      };
      const restX = side * (4 + 1.3);
      const { mesh, body } = this.box(restX, y + 1.1, pz, 1.2, 1.1, 1.4, P.accent[k % P.accent.length], { kinematic: true, striped: false });
      this.box(side * 8.3, y + 1.1, pz, 1.8, 1.6, 1.9, P.wall, { striped: false });
      this.kin.push({ body, mesh, at: t => ({ p: { x: restX - side * ext(t), y: y + 1.1, z: pz }, q: ID }) });
      sec.pistons.push({ z: pz, side, ext });
    }
    this.box(0, y - 1, z + 4 + L + 2, 4, 1, 2, P.floor[0]);
    sec.ai = (plan, c) => {
      plan.tx = 0;
      const next = sec.pistons.find(pp => pp.z > c.p.z - 1.6);
      if (next && next.z - c.p.z < 3.4 && next.z - c.p.z > 2 && (next.ext(c.t + 0.4) > 1 || next.ext(c.t + 0.15) > 1)) plan.wait = true;
    };
    sec.checkpoint = { z: z + 2, y, w: 2 };
    return { z: z + 4 + L + 4, y };
  }

  logs(sec, z, y, { count = 3 }) {
    const P = this.pal, R = this.R;
    this.box(0, y - 1, z + 2, 4, 1, 2, P.floor[0]);
    let cz = z + 4;
    const rx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    for (let k = 0; k < count; k++) {
      cz += 0.3;
      const c = cz + 5, w = (k % 2 ? -1 : 1) * (0.75 + k * 0.1);
      const body = this.track(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, y - 1.6, c));
      this.world.createCollider(R.ColliderDesc.cylinder(5, 1.6).setRotation({ x: rx.x, y: rx.y, z: rx.z, w: rx.w }).setFriction(0.8), body);
      const tex = caneTexture(hex(P.accent[k % P.accent.length]), '#ffffff');
      tex.repeat.set(4, 2);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 10, 32).rotateX(Math.PI / 2), candy(0xffffff, tex));
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh);
      this.kin.push({ body, mesh, at: t => ({ p: { x: 0, y: y - 1.6, z: c }, q: quatZ(w * t) }) });
      cz += 10.3;
      this.box(0, y - 1, cz + 1.5, 3, 1, 1.5, P.floor[1]);
      cz += 3;
    }
    sec.ai = plan => { plan.tx = 0; };
    sec.checkpoint = { z: z + 2, y, w: 2 };
    return { z: cz, y };
  }

  tiles(sec, z, y, { cols = 6, rows = 9, size = 2.6 }) {
    const P = this.pal, R = this.R;
    this.box(0, y - 1, z + 2, (cols * size) / 2, 1, 2, P.floor[0]);
    const x0 = -(cols * size) / 2 + size / 2, z0 = z + 4 + size / 2;
    sec.tiles = [];
    const geo = new RoundedBoxGeometry(size - 0.16, 0.8, size - 0.16, 2, 0.12);
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const x = x0 + q * size, tz = z0 + r * size;
      const mesh = new THREE.Mesh(geo, candy(P.accent[(q + r) % P.accent.length]));
      mesh.position.set(x, y - 0.4, tz);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh);
      const body = this.track(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y - 0.4, tz));
      const collider = this.world.createCollider(R.ColliderDesc.cuboid(size / 2 - 0.08, 0.4, size / 2 - 0.08).setFriction(0.8), body);
      const tile = { x, z: tz, mesh, body, collider, state: 'ok', t0: 0, col: q, row: r };
      this.tileByHandle.set(collider.handle, { sec, i: sec.tiles.length });
      sec.tiles.push(tile);
    }
    const endZ = z0 + rows * size - size / 2;
    this.box(0, y - 1, endZ + 3, (cols * size) / 2, 1, 3, P.floor[0]);
    const shake = (i, t) => {
      const tile = sec.tiles[i];
      if (!tile || tile.state !== 'ok') return false;
      tile.state = 'shake'; tile.t0 = t;
      return true;
    };
    sec.step = t => {
      for (const tile of sec.tiles) {
        const u = t - tile.t0;
        if (tile.state === 'shake' && u > 0.75) tile.state = 'fall';
        if (tile.state === 'fall') {
          const d = (u - 0.75) ** 2 * 9;
          tile.body.setNextKinematicTranslation({ x: tile.x, y: y - 0.4 - d, z: tile.z });
          if (u > 1.7) { tile.state = 'gone'; tile.collider.setEnabled(false); tile.mesh.visible = false; }
        }
        if (tile.state === 'gone' && u > 7) {
          tile.state = 'ok';
          const home = { x: tile.x, y: y - 0.4, z: tile.z };
          tile.body.setTranslation(home, true); // teletransporte: sin velocidad que lance a nadie
          tile.body.setNextKinematicTranslation(home);
          tile.collider.setEnabled(true); tile.mesh.visible = true;
        }
      }
    };
    sec.sync = t => {
      for (const tile of sec.tiles) {
        if (tile.state === 'gone') continue;
        const p = tile.body.translation(), jitter = tile.state === 'shake' ? Math.sin(t * 60) * 0.05 : 0;
        tile.mesh.position.set(p.x + jitter, p.y, p.z);
      }
    };
    sec.reset = () => {
      for (const tile of sec.tiles) {
        tile.state = 'ok'; tile.t0 = 0;
        const home = { x: tile.x, y: y - 0.4, z: tile.z };
        tile.body.setTranslation(home, true);
        tile.body.setNextKinematicTranslation(home);
        tile.collider.setEnabled(true); tile.mesh.visible = true;
      }
    };
    sec.ground = (i, t) => (shake(i, t) ? { k: 'tile', i, t } : null);
    sec.remote = e => { if (e.k === 'tile') shake(e.i, e.t); return null; };
    sec.ai = (plan, c) => {
      // Busca una columna con baldosas sanas delante
      const ahead = sec.tiles.filter(tl => tl.z > c.p.z && tl.z - c.p.z < size * 2.2);
      const good = q => ahead.filter(tl => tl.col === q).every(tl => tl.state === 'ok');
      let col = Math.round((c.p.x - x0) / size);
      col = Math.max(0, Math.min(cols - 1, col));
      if (!good(col)) {
        for (const d of [1, -1, 2, -2, 3, -3]) if (col + d >= 0 && col + d < cols && good(col + d)) { col += d; break; }
      }
      plan.tx = x0 + col * size;
    };
    sec.checkpoint = { z: z + 2, y, w: 3 };
    return { z: endZ + 6, y };
  }

  finish(sec, z, y) {
    const P = this.pal;
    this.box(0, y - 1, z + 9, 9, 1, 9, P.accent[0]);
    for (const s of [-1, 1]) this.box(s * 9.3, y + 1.5, z + 9, 0.3, 1.5, 9, P.wall, { striped: false });
    this.box(0, y + 1.5, z + 18.3, 9.6, 1.5, 0.3, P.wall, { striped: false });
    this.finishZ = z + 5;
    this.finishY = y - 1.5;
    for (const s of [-1, 1]) this.box(s * 8.2, y + 3.5, this.finishZ, 0.5, 3.5, 0.5, P.trim, { striped: false, collide: false });
    const banner = new THREE.Mesh(new RoundedBoxGeometry(17, 1.6, 0.5, 2, 0.2), new THREE.MeshPhysicalMaterial({ map: CHECKER, roughness: 0.4, clearcoat: 0.5 }));
    banner.position.set(0, y + 7.2, this.finishZ);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(18, 1.2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: CHECKER, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
    line.position.set(0, y + 0.02, this.finishZ);
    this.group.add(banner, line);
    sec.ai = (plan) => { plan.tx = 0; plan.tz = this.finishZ + 4; };
    return { z: z + 18, y };
  }

  // ---------- Estado de cada ronda ----------
  reset(seed) {
    for (const b of this.balls) { this.world.removeRigidBody(b.body); b.mesh.removeFromParent(); }
    this.balls = [];
    for (const s of this.sections) s.reset?.(rng(seed + s.index * 7919));
  }

  // Antes de cada paso de física: posición de los obstáculos para el instante t
  stepKinematics(t) {
    for (const k of this.kin) {
      const s = k.at(t);
      k.body.setNextKinematicTranslation(s.p);
      k.body.setNextKinematicRotation(s.q);
    }
    for (const s of this.sections) s.step?.(t);
    this.balls = this.balls.filter(b => {
      const p = b.body.translation();
      if (p.y > SLIME_Y - 6 && p.z > b.minZ) return true;
      this.world.removeRigidBody(b.body);
      b.mesh.removeFromParent();
      return false;
    });
  }

  // Suelos que se mueven solos (cintas transportadoras)
  surfaceVel(collider) { return this.surfaces.get(collider.handle) || null; }

  // Una gominola propia toca algo con el cuerpo (puertas) o con los pies (baldosas): devuelve un evento para la red
  touch(p) {
    const sec = this.sectionAt(p.z), e = sec.touch?.(p);
    return e ? { ...e, s: sec.index } : null;
  }
  ground(collider, t) {
    const hit = this.tileByHandle.get(collider.handle), e = hit?.sec.ground(hit.i, t);
    return e ? { ...e, s: hit.sec.index } : null;
  }
  remote(e) { return this.sections[e.s]?.remote?.(e) || null; }

  // Mover las mallas (en cada fotograma)
  syncVisuals(t, dt) {
    for (const k of this.kin) {
      if (k.pivotMode) { k.mesh.rotation.z = k.angle(t); continue; }
      const s = k.at(t);
      k.mesh.position.set(s.p.x, s.p.y, s.p.z);
      k.mesh.quaternion.set(s.q.x, s.q.y, s.q.z, s.q.w);
    }
    for (const s of this.sections) s.sync?.(t, dt);
    for (const b of this.balls) {
      const p = b.body.translation(), q = b.body.rotation();
      b.mesh.position.set(p.x, p.y, p.z);
      b.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
  }
}
