// Física de las gominolas (cápsula dinámica de Rapier) e IA de los bots.
import { SLIME_Y } from './course.js';

export const RADIUS = 0.42, HALF = 0.48, FOOT = HALF + RADIUS;
const RUN = 6.4, ACC_GROUND = 50, ACC_AIR = 16, JUMP = 7.4, GRAVITY_SCALE = 2, DIVE = 9.5;
const ZERO = { x: 0, y: 0, z: 0 };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const yawQuat = a => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });

export class Bean {
  // remote = la controla otro jugador: cuerpo cinemático que solo seguimos
  constructor(R, world, { x, y, z, yaw = 0, remote = false }) {
    Object.assign(this, { R, world, remote });
    const desc = remote
      ? R.RigidBodyDesc.kinematicPositionBased()
      : R.RigidBodyDesc.dynamic().setGravityScale(GRAVITY_SCALE).setCcdEnabled(true).enabledRotations(false, false, false).setCanSleep(false);
    desc.setTranslation(x, y, z);
    this.body = world.createRigidBody(desc);
    this.collider = world.createCollider(
      R.ColliderDesc.capsule(HALF, RADIUS).setFriction(0).setFrictionCombineRule(R.CoefficientCombineRule.Min).setRestitution(0).setDensity(80),
      this.body,
    );
    Object.assign(this, {
      state: 'idle', stateT: 0, yaw, grounded: true, coyote: 0, jumpBuf: 0, platformVel: ZERO, expected: null,
      cp: 0, finished: false, events: [], fallT: 0,
    });
  }

  get pos() { return this.body.translation(); }
  get vel() { return this.body.linvel(); }

  setState(s) { if (this.state !== s) { this.state = s; this.stateT = 0; } }

  // Antes del paso de física. inp: { mx, mz } dirección en el mundo (|m| ≤ 1), jump, dive (pulsados en este fotograma)
  control(inp, dt) {
    const v = this.body.linvel();
    this.stateT += dt;
    if (inp.jump) this.jumpBuf = 0.15; else this.jumpBuf = Math.max(0, this.jumpBuf - dt);
    const busy = this.state === 'tumble' || this.state === 'getup' || this.state === 'dive' || this.state === 'fallen';
    let nx = v.x, ny = v.y, nz = v.z;
    const pv = this.grounded ? this.platformVel : ZERO;
    if (this.state === 'tumble' || this.state === 'fallen') {
      this.expected = null;
      return;
    }
    if (this.state === 'dive' || this.state === 'getup') {
      if (this.grounded) { // se arrastra por el suelo frenando
        const f = Math.exp(-(this.state === 'getup' ? 10 : 3) * dt);
        nx = pv.x + (v.x - pv.x) * f; nz = pv.z + (v.z - pv.z) * f;
      }
    } else {
      const wantX = inp.mx * RUN * (inp.speed ?? 1) + pv.x, wantZ = inp.mz * RUN * (inp.speed ?? 1) + pv.z;
      const acc = (this.grounded ? ACC_GROUND : ACC_AIR) * dt;
      const dx = wantX - v.x, dz = wantZ - v.z, d = Math.hypot(dx, dz);
      if (d > acc) { nx = v.x + (dx / d) * acc; nz = v.z + (dz / d) * acc; } else { nx = wantX; nz = wantZ; }
      if (Math.hypot(inp.mx, inp.mz) > 0.2) this.yaw += wrap(Math.atan2(inp.mx, inp.mz) - this.yaw) * Math.min(1, dt * 12);
    }
    if (!busy && this.jumpBuf > 0 && (this.grounded || this.coyote > 0)) {
      ny = JUMP + Math.max(0, pv.y || 0);
      this.jumpBuf = 0; this.coyote = 0; this.grounded = false;
      this.setState('air');
      this.events.push('jump');
    }
    if (!busy && inp.dive) {
      const dx = Math.sin(this.yaw), dz = Math.cos(this.yaw);
      nx = dx * DIVE; nz = dz * DIVE;
      ny = this.grounded ? 4 : Math.max(ny, 2.5);
      this.grounded = false;
      this.setState('dive');
      this.events.push('dive');
    }
    this.body.setLinvel({ x: nx, y: ny, z: nz }, true);
    this.expected = { x: nx, z: nz };
  }

  // Después del paso de física: suelo, golpes, estados y caídas a la baba
  post(dt, course) {
    const R = this.R, p = this.body.translation(), v = this.body.linvel();
    const ray = new R.Ray({ x: p.x, y: p.y, z: p.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, FOOT + 0.15, true, undefined, undefined, undefined, this.body);
    this.grounded = !!hit && v.y < 5;
    this.groundY = hit ? p.y - hit.timeOfImpact : null;
    this.platformVel = ZERO;
    if (hit) {
      const pb = hit.collider.parent();
      if (pb && !pb.isFixed()) this.platformVel = pb.velocityAtPoint(ray.pointAt(hit.timeOfImpact));
    }
    this.coyote = this.grounded ? 0.12 : Math.max(0, this.coyote - dt);

    // Golpe: hemos ganado mucha velocidad que no pedimos → tropiezo
    if (this.expected && this.state !== 'tumble' && this.state !== 'fallen') {
      const gx = v.x - this.expected.x, gz = v.z - this.expected.z;
      const gained = Math.hypot(v.x, v.z) - Math.hypot(this.expected.x, this.expected.z);
      if (Math.hypot(gx, gz) > 6 && gained > 3) this.tumble();
    }

    switch (this.state) {
      case 'tumble':
        if (this.stateT > 1.1 && (this.grounded || this.stateT > 2.6)) this.standUp();
        break;
      case 'dive':
        if (this.grounded && this.stateT > 0.25) this.setState('getup');
        break;
      case 'getup':
        if (this.stateT > 0.4) this.setState('idle');
        break;
      case 'fallen':
        break;
      case 'celebrate':
        break;
      default:
        if (!this.grounded) this.setState('air');
        else this.setState(Math.hypot(v.x - this.platformVel.x, v.z - this.platformVel.z) > 0.8 ? 'run' : 'idle');
    }

    // Caída a la baba: tras un momento reaparece en el último punto de control
    if (p.y < SLIME_Y + 1 && this.state !== 'fallen') { this.setState('fallen'); this.events.push('splash'); }
    if (this.state === 'fallen' && this.stateT > 0.9) this.respawn(course);

    // Puntos de control y meta
    for (let i = this.cp + 1; i < course.checkpoints.length; i++) if (p.z > course.checkpoints[i].z - 1 && p.y > -1) { this.cp = i; this.events.push('checkpoint'); }
    if (!this.finished && p.z > course.finishZ && p.y > course.finishY) { this.finished = true; this.events.push('finish'); }
  }

  tumble() {
    this.setState('tumble');
    this.body.setEnabledRotations(true, true, true, true);
    this.body.setAngvel({ x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 10 }, true);
    this.events.push('hit');
  }

  standUp() {
    const p = this.body.translation();
    this.body.setRotation(yawQuat(0), true);
    this.body.setAngvel(ZERO, true);
    this.body.setEnabledRotations(false, false, false, true);
    if (this.groundY != null) this.body.setTranslation({ x: p.x, y: this.groundY + FOOT + 0.03, z: p.z }, true);
    this.setState('getup');
  }

  respawn(course) {
    const c = course.checkpoints[this.cp];
    this.body.setTranslation({ x: c.x ?? (Math.random() - 0.5) * 2 * c.w, y: c.y + FOOT + 0.6, z: c.z + (Math.random() - 0.5) * 1.5 }, true);
    this.body.setLinvel(ZERO, true);
    this.body.setAngvel(ZERO, true);
    this.body.setRotation(yawQuat(0), true);
    this.body.setEnabledRotations(false, false, false, true);
    this.yaw = 0;
    this.setState('air');
  }

  celebrate() { this.setState('celebrate'); }

  // Para gominolas remotas: seguir la posición recibida por la red
  follow(p, q) {
    this.body.setNextKinematicTranslation(p);
    if (q) this.body.setNextKinematicRotation(q);
  }

  destroy() { this.world.removeRigidBody(this.body); }
}

// ---------- IA ----------
// mem guarda lo que el bot "sabe": carril preferido, puerta elegida, puertas falsas descubiertas, si está atascado…
export function newBotMemory(skill) {
  return { skill, lane: (Math.random() - 0.5) * 6, door: null, fake: new Set(), stuckT: 0, lastZ: 0, jumpCd: 0, think: 0, waitT: 0 };
}

export function botInput(bean, course, t, mem, dt) {
  const p = bean.pos, v = bean.vel;
  const inp = { mx: 0, mz: 0, jump: false, dive: false, speed: 0.86 + mem.skill * 0.14 };
  if (bean.finished) { inp.speed = 0; return inp; }
  mem.jumpCd -= dt;
  let tx = mem.lane, tz = p.z + 8;

  // Atasco: si no avanza, salta y cambia de carril (y si estaba ante una puerta, la apunta como falsa)
  if (p.z > mem.lastZ + 0.6) { mem.lastZ = p.z; mem.stuckT = 0; } else mem.stuckT += dt;
  if (mem.stuckT > 1.4) {
    if (mem.door) mem.fake.add(mem.door);
    mem.door = null;
    mem.lane = (Math.random() - 0.5) * 8;
    mem.stuckT = 0.6;
    if (mem.jumpCd <= 0) { inp.jump = true; mem.jumpCd = 0.8; }
  }

  // Puertas: elige una no descubierta como falsa y va hacia ella
  const wall = course.doorWalls.find(w => w.z > p.z - 0.6 && p.z > 18);
  if (wall && p.z < 62) {
    const key = d => `${wall.z}:${d}`;
    if (!mem.door || !mem.door.startsWith(`${wall.z}:`)) {
      const options = wall.doors.map((d, i) => i).filter(i => !mem.fake.has(key(i)) && !wall.doors[i].brokenFake);
      const open = options.filter(i => wall.doors[i].broken); // si ve una abierta, mejor esa
      const pool = open.length && Math.random() < 0.85 ? open : options;
      mem.door = key(pool[Math.floor(Math.random() * pool.length)] ?? 0);
    }
    const d = wall.doors[+mem.door.split(':')[1]];
    tx = d.x; tz = wall.z + 2;
  } else if (p.z >= 62 && p.z < 121) {
    tx = Math.abs(p.z - 92) < 3 ? 0 : mem.lane * 0.6;
    // Barredoras: salta la baja cuando está a punto de llegar, no saltes si pasa la alta
    for (const disc of course.discs) {
      const dx = p.x, dz = p.z - disc.z, r = Math.hypot(dx, dz);
      if (r > disc.r + 0.5 || r < 1.6) continue;
      const phi = Math.atan2(dx, dz);
      let low = false, high = false;
      for (const bar of disc.bars) {
        const a = bar.speed * t + bar.phase; // dirección de la barra (línea que pasa por el centro)
        // ángulo que le falta a la barra para llegar al bot, en el sentido de giro (la barra es una línea: periodo π)
        let gap = ((phi - (a + Math.PI / 2)) * Math.sign(bar.speed)) % Math.PI;
        if (gap < 0) gap += Math.PI;
        const tHit = gap / Math.abs(bar.speed);
        if (bar.y < 1 && tHit < 0.22 + (1 - mem.skill) * 0.1) low = true;
        if (bar.y > 2 && (tHit < 0.6 || tHit > Math.PI / Math.abs(bar.speed) - 0.2)) high = true;
      }
      if (low && !high && bean.grounded && mem.jumpCd <= 0 && Math.random() < 0.6 + mem.skill * 0.4) { inp.jump = true; mem.jumpCd = 0.5; }
    }
  } else if (p.z >= 121 && p.z < 158.6) {
    tx = 0; // balancines: por el centro para no volcar
  } else if (p.z >= 158.6 && p.z < 189) {
    tx = 0;
    // Martillos: espera si el siguiente va a pasar por el puente
    const next = course.hammers.find(h => h.z > p.z - 1.2);
    if (next && next.z - p.z < 3.2) {
      const soon = Math.abs(next.headX(t + 0.55)) < 3.1 || Math.abs(next.headX(t + 0.25)) < 3.1;
      if (soon && next.z - p.z > 1.6) mem.waitT = 0.15;
    }
  } else if (p.z >= 189 && p.z < course.ramp.z1) {
    tx = mem.lane * 0.7;
    for (const b of course.balls) {
      const bp = b.body.translation();
      if (bp.z > p.z && bp.z - p.z < 9 && Math.abs(bp.x - p.x) < 2.2) { mem.lane = bp.x > p.x ? Math.max(-5.5, p.x - 3) : Math.min(5.5, p.x + 3); }
    }
  } else if (p.z >= course.ramp.z1) {
    tx = 0; tz = course.finishZ + 4;
  } else {
    tx = mem.lane * 0.8;
  }

  if (mem.waitT > 0) { mem.waitT -= dt; return inp; }
  const dx = tx - p.x, dz = tz - p.z, l = Math.hypot(dx, dz) || 1;
  inp.mx = dx / l; inp.mz = dz / l;
  // Saltos de huecos: si no hay suelo delante, salta (si el bot es bueno)
  if (bean.grounded && mem.jumpCd <= 0 && Math.hypot(v.x, v.z) > 3) {
    const R = bean.R, ahead = { x: p.x + v.x * 0.25, y: p.y, z: p.z + v.z * 0.25 };
    const hit = bean.world.castRay(new R.Ray(ahead, { x: 0, y: -1, z: 0 }), 4, true, undefined, undefined, undefined, bean.body);
    if (!hit && Math.random() < 0.5 + mem.skill * 0.5) { inp.jump = true; mem.jumpCd = 0.6; }
  }
  if (Math.random() < 0.002) inp.jump = true; // saltitos sin motivo, como los humanos
  return inp;
}
