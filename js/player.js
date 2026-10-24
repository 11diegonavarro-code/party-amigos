// Física de las gominolas (cápsula dinámica de Rapier) e IA de los bots.
import { SLIME_Y } from './course.js';

export const RADIUS = 0.42, HALF = 0.48, FOOT = HALF + RADIUS;
const RUN = 6.4, ACC_GROUND = 50, ACC_AIR = 16, JUMP = 7.4, GRAVITY_SCALE = 2;
const DIVE = 11, DIVE_UP = 1.6; // desde el suelo, plancha rasante (pasa por debajo de la barra alta)
const ZERO = { x: 0, y: 0, z: 0 };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const UPRIGHT = { x: 0, y: 0, z: 0, w: 1 };
// Tumbado boca abajo mirando hacia yaw: lleva el eje de la cápsula (y) a la dirección del salto
const lyingQuat = yaw => { const s = Math.SQRT1_2; return { x: Math.cos(yaw) * s, y: 0, z: -Math.sin(yaw) * s, w: s }; };

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
      groundCollider: null, groundColliders: [], groundY: null, cp: 0, finished: false, events: [],
      grabbing: null, grabbedBy: null, // grabbedBy(): posición de quien nos agarra (o null)
    });
  }

  get pos() { return this.body.translation(); }
  get vel() { return this.body.linvel(); }
  get busy() { return ['tumble', 'fallen', 'dive', 'slide', 'getup'].includes(this.state); }

  setState(s) { if (this.state !== s) { this.state = s; this.stateT = 0; } }

  // Antes del paso de física. inp: { mx, mz } dirección en el mundo (|m| ≤ 1), jump, dive (pulsados)
  control(inp, dt) {
    const v = this.body.linvel();
    this.stateT += dt;
    if (inp.jump) this.jumpBuf = 0.15; else this.jumpBuf = Math.max(0, this.jumpBuf - dt);
    const pv = this.grounded ? this.platformVel : ZERO;
    let nx = v.x, ny = v.y, nz = v.z;

    switch (this.state) {
      case 'tumble':
      case 'fallen':
        this.expected = null;
        return;
      case 'dive': // en el aire: la inercia manda
        this.expected = { x: v.x, z: v.z };
        return;
      case 'slide': // deslizándose boca abajo: frena poco a poco
      case 'getup': {
        if (this.grounded) {
          const f = Math.exp(-(this.state === 'slide' ? 2.4 : 12) * dt);
          nx = pv.x + (v.x - pv.x) * f; nz = pv.z + (v.z - pv.z) * f;
        }
        this.body.setLinvel({ x: nx, y: ny, z: nz }, true);
        this.expected = { x: nx, z: nz };
        return;
      }
    }

    const moving = Math.hypot(inp.mx, inp.mz) > 0.2;
    // Agarrar frena a los dos; al agarrado además le arrastra quien le agarra
    const held = this.grabbedBy?.();
    const mul = (inp.speed ?? 1) * (held ? 0.3 : 1) * (this.grabbing ? 0.6 : 1);
    let wantX = inp.mx * RUN * mul + pv.x, wantZ = inp.mz * RUN * mul + pv.z;
    if (held) {
      const p = this.body.translation(), gx = held.x - p.x, gz = held.z - p.z, gd = Math.hypot(gx, gz);
      if (gd > 1.2) { wantX += (gx / gd) * 2.6; wantZ += (gz / gd) * 2.6; }
    }
    const acc = (this.grounded ? ACC_GROUND : ACC_AIR) * dt;
    const dx = wantX - v.x, dz = wantZ - v.z, d = Math.hypot(dx, dz);
    if (d > acc) { nx = v.x + (dx / d) * acc; nz = v.z + (dz / d) * acc; } else { nx = wantX; nz = wantZ; }
    if (moving) this.yaw += wrap(Math.atan2(inp.mx, inp.mz) - this.yaw) * Math.min(1, dt * 12);

    if (this.jumpBuf > 0 && (this.grounded || this.coyote > 0) && !held && !this.grabbing) {
      ny = JUMP + Math.max(0, pv.y || 0);
      this.jumpBuf = 0; this.coyote = 0; this.grounded = false;
      this.setState('air');
      this.events.push('jump');
    }
    if (inp.dive) {
      // Plancha: hacia donde empujas (o hacia donde miras), tumbado boca abajo
      if (moving) this.yaw = Math.atan2(inp.mx, inp.mz);
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      nx = fx * DIVE + pv.x * 0.5; nz = fz * DIVE + pv.z * 0.5;
      ny = this.grounded ? DIVE_UP : Math.max(ny, 1.2);
      // Desde el suelo se tumba a ras de suelo; en el aire, donde está
      if (this.grounded && this.groundY != null) { const p = this.body.translation(); this.body.setTranslation({ x: p.x, y: this.groundY + RADIUS + 0.04, z: p.z }, true); }
      this.grounded = false;
      this.grabbing = null;
      this.body.setRotation(lyingQuat(this.yaw), true);
      this.setState('dive');
      this.events.push('dive');
    }
    this.body.setLinvel({ x: nx, y: ny, z: nz }, true);
    this.expected = { x: nx, z: nz };
  }

  // Después del paso de física: suelo, golpes, estados y caídas a la baba
  post(dt, course) {
    const R = this.R, p = this.body.translation(), v = this.body.linvel();
    // Cinco rayos (centro y cuatro alrededor) para no "colarse" por las juntas entre baldosas
    let hit = null, ray = null;
    this.groundColliders = [];
    for (const [ox, oz] of [[0, 0], [0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25]]) {
      const r = new R.Ray({ x: p.x + ox, y: p.y, z: p.z + oz }, { x: 0, y: -1, z: 0 });
      const h = this.world.castRay(r, FOOT + 0.15, true, undefined, undefined, undefined, this.body);
      if (!h) continue;
      this.groundColliders.push(h.collider);
      if (!hit || h.timeOfImpact < hit.timeOfImpact - 0.05) { hit = h; ray = r; }
    }
    this.grounded = !!hit && v.y < 5;
    this.groundY = hit ? p.y - hit.timeOfImpact : null;
    this.groundCollider = hit ? hit.collider : null;
    this.platformVel = ZERO;
    if (hit) {
      const surface = course.surfaceVel(hit.collider), pb = hit.collider.parent();
      if (surface) this.platformVel = surface;
      else if (pb && !pb.isFixed()) this.platformVel = pb.velocityAtPoint(ray.pointAt(hit.timeOfImpact));
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
        if (this.grounded && this.stateT > 0.12) this.setState('slide');
        break;
      case 'slide': {
        const rel = Math.hypot(v.x - this.platformVel.x, v.z - this.platformVel.z);
        if (this.grounded && (this.stateT > 0.6 || rel < 1.2)) this.standUp();
        break;
      }
      case 'getup':
        if (this.stateT > 0.3) this.setState('idle');
        break;
      case 'fallen':
      case 'celebrate':
        break;
      default:
        if (!this.grounded) this.setState('air');
        else this.setState(Math.hypot(v.x - this.platformVel.x, v.z - this.platformVel.z) > 0.8 ? 'run' : 'idle');
    }

    if (p.y < SLIME_Y + 1 && this.state !== 'fallen') { this.setState('fallen'); this.events.push('splash'); }
    if (this.state === 'fallen' && this.stateT > 0.9 && !course.noRespawn) this.respawn(course);

    for (let i = this.cp + 1; i < course.checkpoints.length; i++) if (p.z > course.checkpoints[i].z - 1 && p.y > course.checkpoints[i].y - 1) { this.cp = i; this.events.push('checkpoint'); }
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
    this.body.setRotation(UPRIGHT, true);
    this.body.setAngvel(ZERO, true);
    this.body.setEnabledRotations(false, false, false, true);
    if (this.groundY != null) this.body.setTranslation({ x: p.x, y: this.groundY + FOOT + 0.03, z: p.z }, true);
    this.setState('getup');
  }

  respawn(course) {
    const c = course.checkpoints[this.cp];
    this.body.setTranslation({ x: (Math.random() - 0.5) * 2 * c.w, y: c.y + FOOT + 0.6, z: c.z + (Math.random() - 0.5) * 1.5 }, true);
    this.body.setLinvel(ZERO, true);
    this.body.setAngvel(ZERO, true);
    this.body.setRotation(UPRIGHT, true);
    this.body.setEnabledRotations(false, false, false, true);
    this.yaw = 0;
    this.setState('air');
  }

  celebrate() { this.setState('celebrate'); }

  // Gominolas remotas: seguir la posición recibida por la red
  follow(p, q) {
    this.body.setNextKinematicTranslation(p);
    if (q) this.body.setNextKinematicRotation(q);
  }

  destroy() { this.world.removeRigidBody(this.body); }
}

// ---------- IA ----------
// mem guarda lo que el bot "sabe": carril preferido, puerta elegida, puertas falsas descubiertas, si está atascado…
export function newBotMemory(skill) {
  return { skill, lane: (Math.random() - 0.5) * 6, door: null, fake: new Set(), stuckT: 0, lastZ: 0, jumpCd: 0, diveArmed: false };
}

export function botInput(bean, course, t, mem, dt) {
  const p = bean.pos, v = bean.vel;
  const inp = { mx: 0, mz: 0, jump: false, dive: false, speed: 0.86 + mem.skill * 0.14 };
  if (bean.finished) { inp.speed = 0; return inp; }
  // Al caer a la baba se reaparece más atrás: olvidar lo avanzado para no creer que está atascado
  if (bean.state === 'fallen') { mem.lastZ = -1e9; mem.stuckT = 0; mem.diveArmed = false; return inp; }
  mem.jumpCd -= dt;

  // Cada sección sabe cómo se supera: hacia dónde ir, cuándo saltar o esperar
  const plan = { tx: mem.lane, tz: p.z + 8, jump: false, dive: false, wait: false, longGap: false, noStuck: false };
  course.sectionAt(p.z)?.ai?.(plan, { p, v, t, mem, bean, grounded: bean.grounded, dt });

  // Atasco: si no avanza, salta y cambia de carril (y si estaba ante una puerta, la apunta como falsa)
  if (p.z > mem.lastZ + 0.6) { mem.lastZ = p.z; mem.stuckT = 0; } else if (!plan.wait && !plan.noStuck) mem.stuckT += dt;
  if (mem.stuckT > 1.4) {
    if (mem.door) mem.fake.add(mem.door);
    mem.door = null;
    mem.lane = (Math.random() - 0.5) * 8;
    mem.stuckT = 0.6;
    plan.jump = true;
  }
  if (plan.jump && bean.grounded && mem.jumpCd <= 0) { inp.jump = true; mem.jumpCd = 0.5; }
  // En el aire tras saltar un hueco largo: plancha al llegar arriba para llegar más lejos
  if (mem.diveArmed && !bean.grounded && bean.state === 'air' && v.y < 1.2) { inp.dive = true; mem.diveArmed = false; }
  if (bean.grounded && bean.state !== 'air') mem.diveArmed = false;
  if (plan.speed) inp.speed *= plan.speed;
  if (plan.wait && bean.grounded) return inp;

  const dx = plan.tx - p.x, dz = plan.tz - p.z, l = Math.hypot(dx, dz) || 1;
  inp.mx = dx / l; inp.mz = dz / l;
  if (plan.dive && bean.grounded && !bean.busy) inp.dive = true;

  // Hueco justo delante: salta en el borde (y arma la plancha si el hueco es largo)
  const hs = Math.hypot(v.x, v.z);
  if (bean.grounded && mem.jumpCd <= 0 && hs > 3) {
    const R = bean.R, ahead = { x: p.x + (v.x / hs) * 0.7, y: p.y, z: p.z + (v.z / hs) * 0.7 };
    const hit = bean.world.castRay(new R.Ray(ahead, { x: 0, y: -1, z: 0 }), 6, true, undefined, undefined, undefined, bean.body);
    if (!hit && Math.random() < 0.55 + mem.skill * 0.45) {
      inp.jump = true; mem.jumpCd = 0.6;
      mem.diveArmed = plan.longGap && Math.random() < 0.5 + mem.skill * 0.5;
    }
  }
  if (Math.random() < 0.0015) inp.jump = true; // saltitos sin motivo, como los humanos
  return inp;
}
