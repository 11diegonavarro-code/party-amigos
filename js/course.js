// Recorrido «Carrera Gominola»: geometría visual + física (Rapier) + obstáculos movidos por el reloj común.
// Todo lo aleatorio (puertas falsas, bolas) sale de una semilla del anfitrión para que todos vean lo mismo.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const SLIME_Y = -7;

// Generador con semilla (mulberry32)
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COL = { sky: 0x7cc7ff, lilac: 0xb9a2ff, pink: 0xff6fb5, yellow: 0xffd23f, orange: 0xff8f3d, mint: 0x5fe0a8, blue: 0x3d7bff, red: 0xff4b5c, white: 0xf7f7fb };

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#dcdce4';
  for (let i = -128; i < 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 - 128, 128); g.lineTo(i - 128, 128); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function caneTexture(a, b) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = a; g.fillRect(0, 0, 64, 256);
  g.fillStyle = b;
  for (let y = -64; y < 320; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(64, y + 32); g.lineTo(64, y + 64); g.lineTo(0, y + 32); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 32, y * 32, 32, 32); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const STRIPES = stripeTexture();
const candy = (color, map) => new THREE.MeshPhysicalMaterial({ color, map: map || null, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.8 });
const quatY = a => { const h = a / 2; return { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) }; };
const quatZ = a => { const h = a / 2; return { x: 0, y: 0, z: Math.sin(h), w: Math.cos(h) }; };

export class Course {
  constructor(scene, R, world) {
    Object.assign(this, { scene, R, world });
    this.group = new THREE.Group();
    scene.add(this.group);
    this.kin = []; // obstáculos cinemáticos: { body, mesh, at(t) -> { p, q } }
    this.doorWalls = []; this.discs = []; this.hammers = []; this.seesaws = []; this.balls = [];
    this.checkpoints = [
      { z: 8, y: 0, w: 9 }, { z: 66, y: 0, w: 3 }, { z: 118.5, y: 0, w: 3 }, { z: 155.1, y: 0, w: 3 }, { z: 192.6, y: 0, w: 6 },
    ];
    this.finishZ = 238;
    this.finishY = 7;
    this.ramp = { z0: 196.6, z1: 232.6, y1: 9, halfW: 7 };
    this.build();
  }

  // ---------- Piezas ----------
  box(x, y, z, hx, hy, hz, color, { rot = null, radius = 0.35, collide = true, striped = true } = {}) {
    const geo = new RoundedBoxGeometry(hx * 2, hy * 2, hz * 2, 3, Math.min(radius, hx, hy, hz));
    let mat = candy(color);
    if (striped) {
      mat.map = STRIPES.clone();
      mat.map.repeat.set(Math.max(1, hx / 2), Math.max(1, hz / 2));
      mat.map.needsUpdate = true;
    }
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rot) m.quaternion.copy(rot);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
    if (collide) {
      const desc = this.R.RigidBodyDesc.fixed().setTranslation(x, y, z);
      if (rot) desc.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
      const body = this.world.createRigidBody(desc);
      this.world.createCollider(this.R.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.8), body);
      m.userData.body = body;
    }
    return m;
  }

  disc(x, y, z, r, hh, color) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, hh * 2, 64), candy(color));
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.3, 10, 64).rotateX(Math.PI / 2), candy(COL.white));
    ring.position.set(x, y + hh, z);
    this.group.add(ring);
    const body = this.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(x, y, z));
    this.world.createCollider(this.R.ColliderDesc.cylinder(hh, r).setFriction(0.8), body);
  }

  // Barra giratoria horizontal (de lado a lado del disco)
  sweeper(cx, y, cz, len, speed, phase, colors) {
    const R = this.R;
    const body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(cx, y, cz));
    this.world.createCollider(R.ColliderDesc.cuboid(len, 0.32, 0.32).setFriction(0.3), body);
    const tex = caneTexture(colors[0], colors[1]);
    tex.repeat.set(1, len / 1.5);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, len * 2, 20).rotateZ(Math.PI / 2), candy(0xffffff, tex));
    mesh.castShadow = true;
    this.group.add(mesh);
    const at = t => ({ p: { x: cx, y, z: cz }, q: quatY(speed * t + phase) });
    this.kin.push({ body, mesh, at });
    return { y, speed, phase, len };
  }

  hammer(z, phase) {
    const R = this.R, PY = 9.5, L = 7.6, AMP = 1.05, W = 1.7;
    const body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, PY - L, z));
    this.world.createCollider(R.ColliderDesc.cuboid(1.0, 0.9, 1.3).setFriction(0.3), body);
    const pivot = new THREE.Group();
    pivot.position.set(0, PY, z);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, L, 12).translate(0, -L / 2, 0), candy(0xd0d4dc));
    const head = new THREE.Mesh(new RoundedBoxGeometry(2, 1.8, 2.6, 3, 0.35), candy(COL.red));
    head.position.y = -L;
    const band = new THREE.Mesh(new RoundedBoxGeometry(2.08, 0.5, 2.68, 2, 0.2), candy(COL.yellow));
    band.position.y = -L;
    for (const m of [arm, head, band]) { m.castShadow = true; pivot.add(m); }
    this.group.add(pivot);
    // Pórtico
    for (const s of [-1, 1]) this.box(s * 8.2, 4.2, z, 0.35, 5.6, 0.35, COL.white, { striped: false, collide: false });
    this.box(0, 9.9, z, 8.6, 0.35, 0.35, COL.white, { striped: false, collide: false });
    const angle = t => AMP * Math.sin(W * t + phase);
    const at = t => { const a = angle(t); return { p: { x: L * Math.sin(a), y: PY - L * Math.cos(a), z }, q: quatZ(a) }; };
    this.kin.push({ body, mesh: pivot, at, pivotMode: true, angle });
    const h = { z, headX: t => L * Math.sin(angle(t)), headY: t => PY - L * Math.cos(angle(t)) };
    this.hammers.push(h);
  }

  seesaw(cz) {
    const R = this.R, y = -0.35;
    const pivotBody = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, y, cz));
    const board = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0, y, cz).setAngularDamping(1.2).setCanSleep(false));
    this.world.createCollider(R.ColliderDesc.cuboid(5, 0.35, 6).setDensity(2).setFriction(0.8), board);
    const joint = this.world.createImpulseJoint(R.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), pivotBody, board, true);
    joint.setLimits(-0.42, 0.42);
    joint.configureMotorPosition(0, 3500, 900); // vuelve solo a la horizontal
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(10, 0.7, 12, 3, 0.3), candy(COL.yellow, STRIPES));
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.4, 7, 16).translate(0, -3.5, 0), candy(COL.orange));
    stand.position.set(0, y, cz);
    this.group.add(stand);
    this.seesaws.push({ board, mesh, z0: cz - 6, z1: cz + 6 });
  }

  // ---------- Construcción ----------
  build() {
    // Salida
    this.box(0, -1, 10, 12, 1, 10, COL.sky);
    this.box(0, 1.5, -0.3, 12.6, 2.5, 0.3, COL.pink, { striped: false });
    for (const s of [-1, 1]) this.box(s * 12.3, 1.5, 10, 0.3, 2.5, 10, COL.pink, { striped: false });

    // 1) Puertas: tres muros con seis puertas; solo la mitad se pueden romper
    this.box(0, -1, 41, 12, 1, 21, COL.lilac);
    for (const s of [-1, 1]) this.box(s * 12.3, 2.5, 41, 0.3, 3.5, 21, COL.pink, { striped: false });
    const doorMat = candy(COL.blue);
    const emblem = new THREE.MeshPhysicalMaterial({ color: COL.yellow, roughness: 0.3, clearcoat: 1 });
    for (const wz of [30, 42, 54]) {
      const wall = { z: wz, doors: [] };
      const x0 = -11.9;
      for (let i = 0; i <= 6; i++) this.box(x0 + 0.2 + i * 3.9, 2.5, wz, 0.2, 2.5, 0.35, COL.white, { striped: false, radius: 0.15 });
      this.box(0, 4.4, wz, 12, 0.6, 0.35, COL.white, { striped: false, radius: 0.2 });
      for (let i = 0; i < 6; i++) {
        const x = x0 + 0.4 + 1.75 + i * 3.9;
        const g = new THREE.Group();
        g.position.set(x, 0, wz);
        const panel = new THREE.Mesh(new RoundedBoxGeometry(3.4, 3.7, 0.4, 2, 0.15).translate(0, 1.85, 0), doorMat);
        const star = new THREE.Mesh(new THREE.CircleGeometry(0.55, 5), emblem);
        star.position.set(0, 2, -0.21);
        star.rotation.y = Math.PI;
        const star2 = star.clone(); star2.position.z = 0.21; star2.rotation.y = 0;
        panel.castShadow = true;
        g.add(panel, star, star2);
        this.group.add(g);
        const body = this.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(x, 1.85, wz));
        const collider = this.world.createCollider(this.R.ColliderDesc.cuboid(1.7, 1.85, 0.2).setFriction(0.5), body);
        wall.doors.push({ x, mesh: g, collider, real: false, broken: false, fall: 0 });
      }
      this.doorWalls.push(wall);
    }

    // 2) Barredoras sobre dos discos
    this.box(0, -1, 66, 4, 1, 4, COL.mint);
    this.disc(0, -1, 80, 11, 1, COL.sky);
    this.box(0, -1, 92, 3, 1, 2, COL.mint);
    this.disc(0, -1, 105, 11, 1, COL.lilac);
    this.box(0, -1, 118.5, 4, 1, 2.5, COL.mint);
    for (const cz of [80, 105]) {
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 3, 24), candy(COL.white));
      hub.position.set(0, 1.5, cz);
      hub.castShadow = true;
      this.group.add(hub);
      const hb = this.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(0, 1.5, cz));
      this.world.createCollider(this.R.ColliderDesc.cylinder(1.5, 1.3), hb);
    }
    this.discs.push({ z: 80, r: 11, bars: [this.sweeper(0, 0.55, 80, 10.6, 1.15, 0, ['#ff4b5c', '#ffffff'])] });
    this.discs.push({
      z: 105, r: 11, bars: [
        this.sweeper(0, 0.55, 105, 10.6, -1.45, 0.6, ['#3d7bff', '#ffffff']),
        this.sweeper(0, 2.3, 105, 10.6, 0.85, 2.2, ['#ffd23f', '#ff8f3d']), // alta: solo golpea si saltas cuando pasa
      ],
    });

    // 3) Balancines sobre la baba
    this.seesaw(127.4);
    this.box(0, -1, 136.3, 3, 1, 2.5, COL.mint);
    this.seesaw(145.2);
    this.box(0, -1, 155.1, 4, 1, 3.5, COL.mint);

    // 4) Puente estrecho con martillos
    this.box(0, -1, 173.6, 2.2, 1, 15, COL.pink);
    [163, 169, 175, 181].forEach((z, k) => this.hammer(z, k * 1.3));

    // 5) Rampa con bolas rodando y la meta arriba
    this.box(0, -1, 192.6, 8, 1, 4, COL.mint);
    const { z0, z1, y1, halfW } = this.ramp, len = Math.hypot(z1 - z0, y1), a = Math.atan2(y1, z1 - z0);
    const rq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -a);
    this.box(0, y1 / 2 - Math.cos(a), (z0 + z1) / 2 + Math.sin(a), halfW, 1, len / 2, COL.sky, { rot: rq, radius: 0.3 });
    for (const [x, z] of [[-3, 206], [3, 212], [0, 219], [-4, 225], [4, 225]]) {
      const y = this.rampY(z);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.6, 20), candy(COL.orange));
      m.position.set(x, y + 1, z);
      m.castShadow = true;
      this.group.add(m);
      const b = this.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(x, y + 1, z));
      this.world.createCollider(this.R.ColliderDesc.cylinder(1.3, 0.9), b);
    }
    this.box(0, 8, 241.6, 9, 1, 9, COL.yellow);
    for (const s of [-1, 1]) this.box(s * 9.3, 10.5, 241.6, 0.3, 1.5, 9, COL.pink, { striped: false });
    this.box(0, 10.5, 250.9, 9.6, 1.5, 0.3, COL.pink, { striped: false });

    // Arco de meta
    const chk = checkerTexture();
    for (const s of [-1, 1]) this.box(s * 8.2, 12.5, this.finishZ, 0.5, 3.5, 0.5, COL.white, { striped: false, collide: false });
    const banner = new THREE.Mesh(new RoundedBoxGeometry(17, 1.6, 0.5, 2, 0.2), new THREE.MeshPhysicalMaterial({ map: chk, roughness: 0.4, clearcoat: 0.5 }));
    banner.position.set(0, 16.2, this.finishZ);
    this.group.add(banner);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(18, 1.2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: chk, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
    line.position.set(0, 9.02, this.finishZ);
    this.group.add(line);

    this.ballGeo = new THREE.SphereGeometry(1.4, 28, 20);
    this.ballMats = [COL.red, COL.blue, COL.mint, COL.purple || 0x9b6bff].map(c => candy(c, STRIPES));
  }

  rampY(z) { return ((z - this.ramp.z0) / (this.ramp.z1 - this.ramp.z0)) * this.ramp.y1; }

  // ---------- Estado de cada ronda ----------
  reset(seed) {
    const r = rng(seed);
    for (const wall of this.doorWalls) {
      const order = [0, 1, 2, 3, 4, 5].sort(() => r() - 0.5);
      wall.doors.forEach((d, i) => {
        d.real = order.indexOf(i) < 3;
        d.broken = false; d.fall = 0;
        d.collider.setEnabled(true);
        d.mesh.visible = true;
        d.mesh.rotation.set(0, 0, 0);
      });
    }
    for (const b of this.balls) { this.world.removeRigidBody(b.body); b.mesh.removeFromParent(); }
    this.balls = [];
    this.ballRng = rng(seed ^ 0x5bd1e995);
    this.nextBall = 0;
    for (const s of this.seesaws) { s.board.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true); s.board.setAngvel({ x: 0, y: 0, z: 0 }, true); }
  }

  // Puerta tocada por una gominola en pos (o null)
  doorAt(p) {
    for (let w = 0; w < this.doorWalls.length; w++) {
      const wall = this.doorWalls[w];
      if (Math.abs(p.z - wall.z) > 1.05 || p.y > 4) continue;
      for (let d = 0; d < wall.doors.length; d++) {
        const door = wall.doors[d];
        if (!door.broken && Math.abs(p.x - door.x) < 1.95) return { w, d, door };
      }
    }
    return null;
  }

  breakDoor(w, d) {
    const door = this.doorWalls[w]?.doors[d];
    if (!door || door.broken || !door.real) return false;
    door.broken = true;
    door.collider.setEnabled(false);
    return true;
  }

  // Antes de cada paso de física: posición de los obstáculos para el instante t y bolas programadas
  stepKinematics(t) {
    for (const k of this.kin) {
      const s = k.at(t);
      k.body.setNextKinematicTranslation(s.p);
      k.body.setNextKinematicRotation(s.q);
    }
    // Bolas: misma secuencia en todos los clientes (semilla + reloj común)
    if (t > 0) {
      while (this.nextBall < t) {
        const lanes = [-4.5, -1.5, 1.5, 4.5];
        this.spawnBall(lanes[Math.floor(this.ballRng() * 4)], this.ballRng());
        this.nextBall += 1.1 + this.ballRng() * 0.6;
      }
    }
    this.balls = this.balls.filter(b => {
      const p = b.body.translation();
      if (p.y > -12 && p.z > 180) return true;
      this.world.removeRigidBody(b.body);
      b.mesh.removeFromParent();
      return false;
    });
  }

  spawnBall(x, k) {
    if (this.balls.length > 16) return;
    const R = this.R;
    const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, this.ramp.y1 + 2.6, this.ramp.z1 - 1.5).setLinvel(0, 0, -2).setCcdEnabled(true));
    this.world.createCollider(R.ColliderDesc.ball(1.4).setDensity(28).setRestitution(0.25).setFriction(0.6), body);
    const mesh = new THREE.Mesh(this.ballGeo, this.ballMats[Math.floor(k * this.ballMats.length) % this.ballMats.length]);
    mesh.castShadow = true;
    this.group.add(mesh);
    this.balls.push({ body, mesh });
  }

  // Después de la física y en cada fotograma: mover las mallas
  syncVisuals(t, dt) {
    for (const k of this.kin) {
      if (k.pivotMode) { k.mesh.rotation.z = k.angle(t); continue; }
      const s = k.at(t);
      k.mesh.position.set(s.p.x, s.p.y, s.p.z);
      k.mesh.quaternion.set(s.q.x, s.q.y, s.q.z, s.q.w);
    }
    for (const s of this.seesaws) {
      const p = s.board.translation(), q = s.board.rotation();
      s.mesh.position.set(p.x, p.y, p.z);
      s.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
    for (const b of this.balls) {
      const p = b.body.translation(), q = b.body.rotation();
      b.mesh.position.set(p.x, p.y, p.z);
      b.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
    for (const wall of this.doorWalls) for (const d of wall.doors) {
      if (!d.broken || !d.mesh.visible) continue;
      d.fall += dt;
      d.mesh.rotation.x = Math.min(Math.PI / 2, d.fall * d.fall * 9);
      if (d.fall > 2.5) d.mesh.visible = false;
    }
  }
}
