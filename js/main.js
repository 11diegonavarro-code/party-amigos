import * as THREE from 'three';
import RAPIER from 'rapier';
import { createWorld, QUALITY } from './world.js';
import { Course, MAPS } from './course.js';
import { buildBean, PATTERNS, HATS, FACES } from './bean.js';
import { Bean, botInput, newBotMemory, FOOT } from './player.js';
import { FX } from './fx.js';
import { Sound } from './audio.js';
import { Net } from './net.js';

const $ = id => document.getElementById(id);
const COLORS = ['#ff5ca8', '#3d8bff', '#2ed47a', '#ffd23f', '#9b6bff', '#ff8f3d', '#00c2d1', '#ff4b4b', '#f5f5f5', '#2d3142'];
const BOT_NAMES = ['Gomi', 'Pompón', 'Chuche', 'Regaliz', 'Nube', 'Pirueta', 'Burbuja', 'Gelatina', 'Piruleta', 'Caramelo', 'Malvavisco', 'Fresita', 'Bombón', 'Rosquilla', 'Turrón', 'Mazapán'];
const STATES = ['idle', 'run', 'air', 'dive', 'getup', 'tumble', 'fallen', 'celebrate', 'slide'];
const STEP = 1 / 60, MAX = 16, COUNTDOWN = 4.5, BETWEEN = 7;
const RACE_MAPS = Object.keys(MAPS).filter(k => MAPS[k].kind === 'race');
const SURVIVAL_MAPS = Object.keys(MAPS).filter(k => MAPS[k].kind === 'survival');
const FINAL_MAPS = Object.keys(MAPS).filter(k => MAPS[k].kind.startsWith('final'));
const pick = a => a[Math.floor(Math.random() * a.length)];
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
};
const cleanName = n => String(n || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 12) || 'Gominola';
const fmt = t => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const HAT_IDS = HATS.map(h => h[0]), FACE_IDS = FACES.map(f => f[0]);

// ---------- Motor ----------
const savedQ = store.get('pa-quality', 'alta');
const quality = QUALITY[savedQ] ? savedQ : 'alta';
const renderer = new THREE.WebGLRenderer({ antialias: quality === 'baja', powerPreference: 'high-performance' });
let pixelRatio = Math.min(devicePixelRatio, QUALITY[quality].maxRatio);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);
const world = await createWorld(renderer, quality, p => { $('loadPct').textContent = `${Math.round(p * 100)}%`; });
addEventListener('resize', world.resize);
await RAPIER.init();
const physics = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
physics.timestep = STEP;
const course = new Course(world.scene, RAPIER, physics);
course.load('gominola');
course.reset(1);
world.setSlime(course.pal.slime);
const fx = new FX(world.scene, quality === 'baja' ? 220 : 420);
const net = new Net();
const sound = new Sound();

const game = {
  phase: 'menu', beans: [], seed: 1, startAt: 0, qualifyN: 1, ended: false, kind: 'race', round: 0, inShow: false, map: null,
  show: null, // solo en el anfitrión: { participants, remaining, round }
  qualified: new Set(),
  crowns: +store.get('pa-crowns', 0) || 0,
  me: {
    name: store.get('pa-name', 'Gominola' + Math.floor(Math.random() * 90 + 10)),
    c1: store.get('pa-c1', COLORS[0]), c2: store.get('pa-c2', COLORS[3]), pattern: store.get('pa-pattern', 'lunares'),
    hat: store.get('pa-hat', 'nada'), face: store.get('pa-face', 'normal'),
  },
  lobby: { players: [], bots: 9, racing: false, map: 'aleatorio', mode: 'show' },
};
if (game.me.hat === 'corona' && !game.crowns) game.me.hat = 'nada';
let player = null, spectating = null;
const raceTime = () => (net.hostNow() - game.startAt) / 1000;
const inRound = () => ['countdown', 'race', 'end'].includes(game.phase);
const active = () => game.beans.filter(b => !b.out);

// Escaparate del menú: tu gominola girando en la salida
let showcase = null;
function rebuildShowcase() {
  showcase?.dispose();
  showcase = buildBean({ ...game.me, showLabel: false });
  world.scene.add(showcase.root);
}

// ---------- Gominolas ----------
function spawnBean(r, i) {
  const s = course.spawn(i);
  const isPlayer = !r.bot && r.owner === net.me;
  const owned = r.bot ? (!net.online || net.host) : isPlayer;
  const phys = new Bean(RAPIER, physics, { ...s, remote: !owned });
  const model = buildBean({ ...r, showLabel: !isPlayer });
  world.scene.add(model.root);
  return {
    ...r, owned, isPlayer, phys, model, buf: [], finishTime: null, out: false, outTime: null, wasGrounded: true,
    grabTarget: null, grabT: 0, grabCd: 0, grabbedT: 0,
    mem: r.bot ? newBotMemory(Math.random() * 0.8 + 0.2) : null,
    view: { x: s.x, y: s.y, z: s.z, q: null, yaw: 0, vx: 0, vy: 0, vz: 0, state: 'idle', grounded: true, grabbing: false, grabbed: false },
  };
}

function clearBeans() {
  for (const b of game.beans) { b.phys.destroy(); b.model.dispose(); }
  game.beans = [];
  player = null;
  spectating = null;
  crownBean?.dispose(); crownBean = null;
}

// m: { roster, seed, startAt, map, qualifyN, round, show }
function startRound(m) {
  clearBeans();
  if (course.mapId !== m.map) { course.load(m.map); world.setSlime(course.pal.slime); }
  course.reset(m.seed);
  Object.assign(game, {
    seed: m.seed, startAt: m.startAt, phase: 'countdown', ended: false, kind: course.kind, qualifyN: m.qualifyN || 1,
    round: m.round || 0, inShow: !!m.show, map: m.map, qualified: new Set(),
  });
  game.beans = m.roster.map(spawnBean);
  player = game.beans.find(b => b.isPlayer) || null;
  showcase?.dispose(); showcase = null;
  cam.yaw = 0; cam.pitch = 0.3;
  hide('menu'); hide('lobby'); hide('results'); hide('crown'); show('hud');
  $('touch').hidden = !isTouch || !player;
  const name = MAPS[course.mapId].name;
  $('mapName').textContent = (game.round ? `Ronda ${game.round} · ` : '') + name;
  big(game.round ? `Ronda ${game.round}\n${name}` : name, 1500);
  $('place').textContent = '';
  if (!player) startSpectating();
  updateSpectateHud();
  lastBeep = 99;
}

const progress = b => (b.finishTime != null ? 1e6 - b.finishTime : b.view.z);
const ranking = () => [...game.beans].sort((a, b) => progress(b) - progress(a));

// ---------- Entrada ----------
const keys = new Set();
let jumpPressed = false, divePressed = false, mouseGrab = false, touchGrab = false;
const isTouch = matchMedia('(pointer: coarse)').matches;
const touch = { mx: 0, mz: 0, id: null, ox: 0, oy: 0, camId: null, cx: 0, cy: 0 };
const cam = { yaw: 0, pitch: 0.3, dist: 7.5 };
const watching = () => !player || player.out || (player.finishTime != null && raceTime() - player.finishTime > 3);

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!e.repeat && e.code === 'Space') jumpPressed = true;
  if (!e.repeat && ['ShiftLeft', 'ShiftRight', 'KeyE', 'ControlLeft'].includes(e.code)) divePressed = true;
  if (!e.repeat && inRound() && watching() && (e.code === 'ArrowRight' || e.code === 'ArrowLeft')) cycleSpectate(e.code === 'ArrowRight' ? 1 : -1);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouseGrab = false; });
renderer.domElement.addEventListener('click', () => {
  if (!inRound() || isTouch) return;
  if (watching() && document.pointerLockElement !== renderer.domElement) cycleSpectate(1);
  renderer.domElement.requestPointerLock?.();
});
let dragging = false;
renderer.domElement.addEventListener('mousedown', e => {
  dragging = true;
  if (e.button === 0 && document.pointerLockElement === renderer.domElement) mouseGrab = true;
});
addEventListener('mouseup', () => { dragging = false; mouseGrab = false; });
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  if (document.pointerLockElement === renderer.domElement || (dragging && inRound())) {
    cam.yaw -= e.movementX * 0.0028;
    cam.pitch = clamp(cam.pitch + e.movementY * 0.0022, -0.2, 1.2);
  }
});

if (isTouch) {
  const el = renderer.domElement;
  el.addEventListener('touchstart', e => {
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth / 2 && touch.id === null) { touch.id = t.identifier; touch.ox = t.clientX; touch.oy = t.clientY; }
      else if (touch.camId === null) { touch.camId = t.identifier; touch.cx = t.clientX; touch.cy = t.clientY; if (watching()) cycleSpectate(1); }
    }
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === touch.id) {
        const dx = (t.clientX - touch.ox) / 50, dy = (t.clientY - touch.oy) / 50, l = Math.hypot(dx, dy);
        touch.mx = l > 1 ? dx / l : dx; touch.mz = l > 1 ? dy / l : dy;
      } else if (t.identifier === touch.camId) {
        cam.yaw -= (t.clientX - touch.cx) * 0.006; cam.pitch = clamp(cam.pitch + (t.clientY - touch.cy) * 0.004, -0.2, 1.2);
        touch.cx = t.clientX; touch.cy = t.clientY;
      }
    }
  }, { passive: true });
  el.addEventListener('touchend', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === touch.id) { touch.id = null; touch.mx = touch.mz = 0; }
      if (t.identifier === touch.camId) touch.camId = null;
    }
  });
  $('tJump').addEventListener('touchstart', e => { e.preventDefault(); jumpPressed = true; }, { passive: false });
  $('tDive').addEventListener('touchstart', e => { e.preventDefault(); divePressed = true; }, { passive: false });
  $('tGrab').addEventListener('touchstart', e => { e.preventDefault(); touchGrab = true; }, { passive: false });
  $('tGrab').addEventListener('touchend', e => { e.preventDefault(); touchGrab = false; }, { passive: false });
}

const gpPrev = {};
let gpGrab = false;
function readInput(dt) {
  let fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  let right = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const gp = navigator.getGamepads?.()[0];
  gpGrab = false;
  if (gp) {
    const dz = v => (Math.abs(v) > 0.15 ? v : 0);
    if (dz(gp.axes[0]) || dz(gp.axes[1])) { right = dz(gp.axes[0]); fwd = -dz(gp.axes[1]); }
    cam.yaw -= dz(gp.axes[2] ?? 0) * 2.6 * dt;
    cam.pitch = clamp(cam.pitch + dz(gp.axes[3] ?? 0) * 1.6 * dt, -0.2, 1.2);
    for (const [i, act] of [[0, 'jump'], [1, 'dive'], [2, 'dive'], [15, 'next'], [14, 'prev']]) {
      const p = !!gp.buttons[i]?.pressed;
      if (p && !gpPrev[i]) {
        if (act === 'jump') jumpPressed = true;
        else if (act === 'dive') divePressed = true;
        else if (watching()) cycleSpectate(act === 'next' ? 1 : -1);
      }
      gpPrev[i] = p;
    }
    gpGrab = (gp.buttons[7]?.value ?? 0) > 0.4 || !!gp.buttons[5]?.pressed;
  }
  if (touch.id !== null) { right = touch.mx; fwd = -touch.mz; }
  const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw), rx = -Math.cos(cam.yaw), rz = Math.sin(cam.yaw);
  let mx = fx * fwd + rx * right, mz = fz * fwd + rz * right;
  const l = Math.hypot(mx, mz);
  if (l > 1) { mx /= l; mz /= l; }
  return { mx, mz };
}
const grabHeld = () => keys.has('KeyF') || mouseGrab || touchGrab || gpGrab;
const IDLE = { mx: 0, mz: 0, jump: false, dive: false };

// ---------- Simulación ----------
let acc = 0, simT = 0;
function simulate(dt, playerInp) {
  // El tiempo de la simulación sigue al reloj común: corrección suave y salto si se desvía mucho
  const rt = raceTime();
  if (Math.abs(simT - rt) > 0.1) simT = rt;
  else simT += (rt - simT) * 0.1;
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 4) {
    simT += STEP;
    course.stepKinematics(simT);
    const racing = simT > 0 && game.phase !== 'end';
    for (const b of game.beans) {
      if (b.out) continue;
      if (!b.owned) { b.phys.follow({ x: b.view.x, y: b.view.y, z: b.view.z }, b.view.q); continue; }
      let inp = IDLE;
      if (racing && !b.finishTime) {
        if (b.bot) inp = botInput(b.phys, course, simT, b.mem, STEP);
        else if (b.isPlayer) { inp = { ...playerInp, jump: jumpPressed, dive: divePressed }; jumpPressed = divePressed = false; }
      }
      b.phys.control(inp, STEP);
    }
    physics.step();
    for (const b of game.beans) {
      if (!b.owned || b.out) continue;
      b.phys.post(STEP, course);
      // Puertas que se rompen al tocarlas y baldosas que se caen al pisarlas (solo con la ronda en marcha): se avisa a los demás
      if (racing) {
        const evs = [course.touch(b.phys.pos)];
        if (b.phys.grounded && b.phys.groundCollider) evs.push(course.ground(b.phys.groundCollider, simT)); // solo la baldosa bajo el centro
        for (const ev of evs) if (ev) { net.send({ t: 'cev', ...ev }); if (ev.k === 'door') onDoorBroken(ev); }
      }
      // Final de la corona: gana quien la toque
      if (course.crown && b.finishTime == null && game.phase === 'race') {
        const p = b.phys.pos, c = course.crown;
        if (Math.hypot(p.x - c.x, p.z - c.z) < 1.5 && Math.abs(p.y - c.y) < 1.4) b.phys.events.push('finish');
      }
      handleEvents(b);
    }
    acc -= STEP; steps++;
  }
  if (steps === 4) acc = 0;
}

function onDoorBroken(e) {
  fx.dust(e.x, 1.5, e.z);
  if (focus() && Math.abs(focus().view.z - e.z) < 25) sound.sfx('door');
}

function handleEvents(b) {
  for (const ev of b.phys.events) {
    const p = b.phys.pos;
    if (ev === 'splash') {
      fx.splash(p.x, -7, p.z);
      if (b.isPlayer) sound.sfx('splash');
      if (course.noRespawn && game.phase === 'race') eliminate(b, true);
    } else if (ev === 'hit' && b.isPlayer) sound.sfx('hit');
    else if (ev === 'jump' && b.isPlayer) sound.sfx('jump');
    else if (ev === 'dive' && b.isPlayer) sound.sfx('dive');
    else if (ev === 'checkpoint' && b.isPlayer) { toast('Punto de control'); sound.sfx('checkpoint'); }
    else if (ev === 'finish' && game.phase !== 'end' && b.finishTime == null) {
      b.finishTime = raceTime();
      b.phys.celebrate();
      net.send({ t: 'fin', id: b.id, time: b.finishTime });
      onFinish(b);
    }
  }
  b.phys.events.length = 0;
}

function onFinish(b) {
  fx.confetti(b.view.x, b.view.y + 1, b.view.z);
  const place = game.beans.filter(x => x.finishTime != null).length;
  if (b.isPlayer) {
    sound.sfx('finish');
    big(game.kind === 'final-race' ? '👑 ¡LA CORONA!' : place <= game.qualifyN ? '¡CLASIFICADO!' : '¡Llegaste!', 2500);
  }
}

// Eliminado en supervivencia: desaparece de la ronda
function eliminate(b, local) {
  if (b.out) return;
  b.out = true;
  b.outTime = b.outTime ?? raceTime();
  if (b.grabTarget) releaseGrab(b);
  b.phys.body.setEnabled(false);
  b.model.root.visible = false;
  if (local) net.send({ t: 'out', id: b.id, time: b.outTime });
  if (b.isPlayer) {
    sound.sfx('out');
    big('¡ELIMINADO!', 2200);
    $('touch').hidden = true;
    setTimeout(() => { if (player?.out) { startSpectating(); updateSpectateHud(); } }, 1600);
  }
  if (spectating === b) startSpectating();
}

// ---------- Agarrar ----------
function setGrabbed(target, grabber, on) {
  if (target.owned) {
    target.phys.grabbedBy = on ? () => (grabber.out ? null : grabber.view) : null;
    target.grabbedT = 0;
  } else net.send({ t: 'grab', id: target.id, by: grabber.id, on });
}
function releaseGrab(b) {
  if (b.grabTarget) setGrabbed(b.grabTarget, b, false);
  b.grabTarget = null;
  b.phys.grabbing = null;
  b.grabCd = 0.7;
}
function updateGrabs(dt) {
  if (game.phase !== 'race') return;
  for (const b of game.beans) {
    if (!b.owned || b.out) continue;
    // Seguridad: nadie se queda agarrado más de 3 s
    if (b.phys.grabbedBy && (b.grabbedT += dt) > 3) b.phys.grabbedBy = null;
    b.grabCd -= dt;
    let wants = false;
    if (b.isPlayer) wants = grabHeld() && b.finishTime == null;
    else if (b.bot && b.finishTime == null) {
      b.mem.grabWant = (b.mem.grabWant ?? 0) - dt;
      wants = b.mem.grabWant > 0;
    }
    const v = b.view, fx0 = Math.sin(v.yaw), fz0 = Math.cos(v.yaw);
    if (!b.grabTarget) {
      if (b.phys.busy || b.grabCd > 0) continue;
      let best = null, bd = 1.4;
      for (const o of game.beans) {
        if (o === b || o.out || o.finishTime != null) continue;
        const dx = o.view.x - v.x, dz = o.view.z - v.z, d = Math.hypot(dx, dz);
        if (d < bd && Math.abs(o.view.y - v.y) < 1.2 && (dx * fx0 + dz * fz0) / (d || 1) > 0.45) { best = o; bd = d; }
      }
      // Los bots agarran de vez en cuando a quien tienen delante
      if (best && b.bot && Math.random() < 0.003 * b.mem.skill) { b.mem.grabWant = 0.8 + Math.random() * 1.2; wants = true; }
      if (best && wants) {
        b.grabTarget = best; b.grabT = 0; b.phys.grabbing = best.id;
        setGrabbed(best, b, true);
      }
    } else {
      const o = b.grabTarget, d = Math.hypot(o.view.x - v.x, o.view.z - v.z);
      b.grabT += dt;
      if (!wants || o.out || d > 2.3 || b.grabT > 2.5 || b.phys.busy) releaseGrab(b);
    }
  }
}

// ---------- Red ----------
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
function sendSnapshot() {
  const bs = game.beans.filter(b => b.owned && !b.out).map(b => {
    const p = b.phys.pos, q = b.phys.body.rotation(), v = b.phys.vel;
    const flags = (b.phys.grabbing ? 1 : 0) | (b.phys.grabbedBy ? 2 : 0);
    return [b.id, r2(p.x), r2(p.y), r2(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w), r2(v.x), r2(v.y), r2(v.z), r3(b.phys.yaw), STATES.indexOf(b.phys.state), b.phys.cp, b.phys.grounded ? 1 : 0, flags];
  });
  if (bs.length) net.send({ t: 'st', bs });
}

function interpolateRemote(b, now) {
  const buf = b.buf;
  if (!buf.length) return;
  const rt = now - 130;
  while (buf.length > 2 && buf[1].t <= rt) buf.shift();
  const a = buf[0], c = buf[1] && rt >= a.t ? buf[1] : null, l = buf[buf.length - 1], v = b.view;
  if (c) {
    const f = Math.min(1, (rt - a.t) / Math.max(1, c.t - a.t));
    v.x = a.x + (c.x - a.x) * f; v.y = a.y + (c.y - a.y) * f; v.z = a.z + (c.z - a.z) * f;
    v.yaw = a.yaw + Math.atan2(Math.sin(c.yaw - a.yaw), Math.cos(c.yaw - a.yaw)) * f;
  } else {
    const e = Math.max(0, Math.min(0.2, (rt - l.t) / 1000));
    v.x = l.x + l.vx * e; v.y = l.y + l.vy * e; v.z = l.z + l.vz * e; v.yaw = l.yaw;
  }
  Object.assign(v, { q: l.q, vx: l.vx, vy: l.vy, vz: l.vz, state: l.state, grounded: l.grounded, grabbing: !!(l.flags & 1), grabbed: !!(l.flags & 2) });
  b.phys.cp = l.cp;
}

const findBean = id => game.beans.find(x => x.id === id);
net.on('join', m => {
  if (!net.host || game.lobby.players.length >= MAX) return;
  const used = new Set(game.lobby.players.map(p => p.c1));
  const c1 = COLORS.includes(m.c1) && !used.has(m.c1) ? m.c1 : COLORS.find(c => !used.has(c));
  const p = {
    pid: m.from, name: cleanName(m.name), c1, c2: COLORS.includes(m.c2) ? m.c2 : COLORS[3],
    pattern: PATTERNS.includes(m.pattern) ? m.pattern : 'liso', hat: HAT_IDS.includes(m.hat) ? m.hat : 'nada', face: FACE_IDS.includes(m.face) ? m.face : 'normal',
  };
  game.lobby.players.push(p);
  toast(`${p.name} se ha unido`);
  broadcastLobby();
});
net.on('leave', m => {
  const p = game.lobby.players.find(p => p.pid === m.from);
  if (p) toast(`${p.name} se ha ido`);
  if (net.host) {
    game.lobby.players = game.lobby.players.filter(p => p.pid !== m.from);
    if (game.show) game.show.remaining.delete('p-' + m.from);
    broadcastLobby();
  }
  for (const b of game.beans.filter(b => b.owner === m.from && !b.bot)) eliminate(b, false);
});
net.on('lobby', m => { if (!net.host) { game.lobby = m.lobby; renderLobby(); } });
net.on('start', m => { if (!net.host) startRound(m); });
net.on('tolobby', () => { if (!net.host) showLobby(); });
net.on('st', m => {
  const now = performance.now();
  for (const e of m.bs || []) {
    const b = findBean(e[0]);
    if (!b || b.owned || b.out) continue;
    b.buf.push({ t: now, x: e[1], y: e[2], z: e[3], q: { x: e[4], y: e[5], z: e[6], w: e[7] }, vx: e[8], vy: e[9], vz: e[10], yaw: e[11], state: STATES[e[12]] || 'idle', cp: e[13], grounded: !!e[14], flags: e[15] || 0 });
    if (b.buf.length > 12) b.buf.shift();
  }
});
net.on('cev', m => { const r = course.remote(m); if (r && m.k === 'door') onDoorBroken(r); });
net.on('fin', m => {
  const b = findBean(m.id);
  if (b && b.finishTime == null) { b.finishTime = m.time; onFinish(b); }
});
net.on('out', m => { const b = findBean(m.id); if (b && !b.out) { b.outTime = m.time; eliminate(b, false); } });
net.on('grab', m => {
  const t = findBean(m.id), g = findBean(m.by);
  if (t && t.owned) { t.phys.grabbedBy = m.on && g ? () => (g.out ? null : g.view) : null; t.grabbedT = 0; }
});
net.on('end', m => { if (!net.host) endRound(m); });
net.on('crown', m => { if (!net.host) showCrown(m.winner); });
net.on('hostgone', () => { goMenu(); setMsg('El anfitrión ha cerrado la sala.'); });

// ---------- Show y rondas (las decide el anfitrión) ----------
function participants() {
  const L = game.lobby;
  const humans = L.players.map(p => ({ id: 'p-' + p.pid, name: p.name, c1: p.c1, c2: p.c2, pattern: p.pattern, hat: p.hat, face: p.face, owner: p.pid, bot: false }));
  const nb = Math.max(0, Math.min(L.bots, MAX - humans.length));
  const bots = Array.from({ length: nb }, (_, i) => ({
    id: 'b' + i, name: BOT_NAMES[i % BOT_NAMES.length], owner: net.me, bot: true,
    c1: COLORS[(i * 3 + 1) % COLORS.length], c2: COLORS[(i * 7 + 4) % COLORS.length], pattern: PATTERNS[i % PATTERNS.length],
    hat: HAT_IDS[1 + (i % (HAT_IDS.length - 2))], face: FACE_IDS[i % FACE_IDS.length],
  }));
  return [...humans, ...bots].sort(() => Math.random() - 0.5);
}

function qualifyFor(kind, n) {
  if (kind.startsWith('final') || n <= 1) return 1;
  return Math.max(1, Math.min(n - 1, Math.ceil(n * (kind === 'survival' ? 0.5 : 0.6))));
}

function hostStart() {
  sound.init();
  const all = participants(), L = game.lobby;
  if (L.mode === 'show') {
    game.show = { participants: all, remaining: new Set(all.map(p => p.id)), round: 0 };
    nextShowRound();
  } else {
    game.show = null;
    const map = MAPS[L.map] ? L.map : pick(RACE_MAPS.filter(k => k !== game.map));
    launch({ roster: all, map, qualifyN: qualifyFor(MAPS[map].kind, all.length), round: 0, show: false });
  }
}

// Carrera → supervivencia → carrera… y la final cuando quedan 4 o menos
function nextShowRound() {
  const S = game.show;
  S.round++;
  const roster = S.participants.filter(p => S.remaining.has(p.id));
  const n = roster.length;
  let map;
  if (n <= 4 || S.round >= 5) map = n === 1 ? 'corona' : pick(FINAL_MAPS);
  else if (S.round % 2 === 0) map = pick(SURVIVAL_MAPS);
  else map = pick(RACE_MAPS.filter(k => k !== game.map));
  launch({ roster, map, qualifyN: qualifyFor(MAPS[map].kind, n), round: S.round, show: true });
}

function launch(m) {
  m.seed = Math.floor(Math.random() * 2 ** 31);
  m.startAt = net.hostNow() + COUNTDOWN * 1000;
  net.send({ t: 'start', ...m });
  startRound(m);
}

function checkEnd() {
  if (game.ended || (net.online && !net.host) || game.phase !== 'race') return;
  const all = game.beans, alive = active(), done = all.filter(b => b.finishTime != null);
  const timeUp = raceTime() > course.timeLimit;
  const over = {
    race: done.length >= game.qualifyN || alive.every(b => b.finishTime != null),
    survival: alive.length <= game.qualifyN,
    final: alive.length <= 1,
    'final-race': done.length >= 1,
  }[game.kind] || timeUp;
  if (over || timeUp) hostEndRound();
}

function computeQualified() {
  const all = game.beans, alive = active();
  const finishers = all.filter(b => b.finishTime != null).sort((a, b) => a.finishTime - b.finishTime);
  const byProgress = [...alive].sort((a, b) => progress(b) - progress(a));
  if (game.kind === 'race') return (finishers.length ? finishers.slice(0, game.qualifyN) : byProgress.slice(0, Math.max(1, Math.ceil(all.length * 0.3)))).map(b => b.id);
  if (game.kind === 'final-race') return (finishers.length ? finishers : byProgress).slice(0, 1).map(b => b.id);
  // Supervivencia y final: los que siguen en pie (en la final, el que está más arriba); si no queda nadie, los últimos en caer
  let left = alive;
  if (game.kind === 'final' && left.length > 1) left = [...left].sort((a, b) => b.view.y - a.view.y).slice(0, 1);
  if (!left.length) left = [...all].sort((a, b) => (b.outTime ?? 0) - (a.outTime ?? 0)).slice(0, game.kind === 'final' ? 1 : game.qualifyN);
  return left.map(b => b.id);
}

function hostEndRound() {
  const final = game.kind.startsWith('final');
  const msg = { t: 'end', qualified: computeQualified(), show: !!game.show, final };
  net.send(msg);
  endRound(msg);
  if (!game.show) return;
  const S = game.show;
  setTimeout(() => {
    if (game.show !== S || game.phase !== 'end') return; // el anfitrión ha salido del show
    if (final || msg.qualified.length <= 1) {
      game.show = null;
      net.send({ t: 'crown', winner: msg.qualified[0] ?? null });
      showCrown(msg.qualified[0] ?? null);
    } else {
      S.remaining = new Set(msg.qualified);
      nextShowRound();
    }
  }, BETWEEN * 1000);
}

function endRound(msg) {
  if (game.ended) return;
  game.ended = true;
  game.phase = 'end';
  game.qualified = new Set(msg.qualified);
  game.endMsg = msg;
  for (const b of game.beans) if (b.grabTarget) releaseGrab(b);
  if (player && !player.out && !game.qualified.has(player.id)) { sound.sfx('out'); big('ELIMINADO', 2000); }
  setTimeout(() => showResults(msg), 1500);
}

// ---------- Interfaz ----------
const show = id => { $(id).hidden = false; }, hide = id => { $(id).hidden = true; };
const setMsg = t => { $('menuMsg').textContent = t; };
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
}
let bigT = null;
function big(text, ms) {
  $('center').textContent = text;
  clearTimeout(bigT);
  bigT = setTimeout(() => { if ($('center').textContent === text) $('center').textContent = ''; }, ms);
}

function optionButtons(boxId, list, key, locked = () => false) {
  const box = $(boxId);
  box.innerHTML = '';
  for (const [id, label] of list) {
    const b = document.createElement('button');
    const lock = locked(id);
    b.textContent = lock ? `🔒 ${label}` : label;
    b.disabled = lock;
    if (lock) b.title = 'Gana un show para desbloquearla';
    if (id === game.me[key]) b.className = 'on';
    b.onclick = () => { game.me[key] = id; store.set('pa-' + key, id); optionButtons(boxId, list, key, locked); rebuildShowcase(); };
    box.appendChild(b);
  }
}
function customizationUI() {
  for (const [box, key] of [['colors1', 'c1'], ['colors2', 'c2']]) {
    const el = $(box);
    el.innerHTML = '';
    for (const c of COLORS) {
      const b = document.createElement('button');
      b.className = 'swatch' + (c === game.me[key] ? ' on' : '');
      b.style.background = c;
      b.title = c;
      b.onclick = () => { game.me[key] = c; store.set('pa-' + key, c); customizationUI(); rebuildShowcase(); };
      el.appendChild(b);
    }
  }
  optionButtons('patterns', PATTERNS.map(p => [p, p[0].toUpperCase() + p.slice(1)]), 'pattern');
  optionButtons('hats', HATS, 'hat', id => id === 'corona' && !game.crowns);
  optionButtons('faces', FACES, 'face');
  $('crownCount').textContent = game.crowns ? `👑 × ${game.crowns}` : '';
}

function broadcastLobby() {
  game.lobby.racing = inRound() || game.phase === 'crown';
  net.send({ t: 'lobby', lobby: game.lobby });
  renderLobby();
}
function renderLobby() {
  const L = game.lobby, ul = $('players');
  ul.innerHTML = '';
  for (const p of L.players) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot'; dot.style.background = p.c1;
    li.append(dot, document.createTextNode(p.name + (p.pid === 'H' ? ' (anfitrión)' : '') + (p.pid === net.me ? ' — tú' : '')));
    ul.appendChild(li);
  }
  const hosting = !net.online || net.host;
  $('hostOpts').hidden = !hosting;
  $('waitMsg').hidden = hosting;
  $('waitMsg').textContent = L.racing ? 'Hay un show en curso: verás la siguiente ronda.' : 'Esperando a que el anfitrión empiece…';
  $('bots').value = L.bots; $('botsVal').textContent = L.bots;
  $('modeSel').value = L.mode;
  $('mapRow').hidden = L.mode === 'show';
  $('mapSel').value = MAPS[L.map] ? L.map : 'aleatorio';
  $('btnStart').textContent = L.mode === 'show' ? '¡Empezar el show!' : '¡Empezar ronda!';
  $('mapInfo').textContent = hosting ? '' : L.mode === 'show' ? 'Modo: show con eliminatorias' : `Mapa: ${MAPS[L.map]?.name || 'aleatorio'}`;
}
function showLobby() {
  clearBeans();
  game.phase = 'lobby';
  game.show = null;
  if (!showcase) rebuildShowcase();
  if (course.mapId !== 'gominola' || course.kind !== 'race') { course.load('gominola'); course.reset(1); world.setSlime(course.pal.slime); }
  hide('menu'); hide('hud'); hide('results'); hide('crown'); show('lobby');
  $('touch').hidden = true;
  $('linkBox').hidden = !net.online;
  $('lobbyTitle').textContent = net.online ? `Sala ${net.code}` : 'Partida contra bots';
  if (net.online) $('link').value = `${location.origin}${location.pathname}#${net.code}`;
  renderLobby();
}
function goMenu() {
  net.close();
  clearBeans();
  game.phase = 'menu';
  game.show = null;
  if (!showcase) rebuildShowcase();
  if (course.mapId !== 'gominola') { course.load('gominola'); course.reset(1); world.setSlime(course.pal.slime); }
  history.replaceState(null, '', location.pathname + location.search);
  hide('lobby'); hide('hud'); hide('results'); hide('crown'); show('menu');
  $('touch').hidden = true;
  setupMenu();
}
function setupMenu() {
  const code = location.hash.slice(1).toUpperCase();
  const valid = /^[A-Z0-9]{5}$/.test(code);
  $('joinBox').hidden = !valid;
  $('joinCode').textContent = valid ? code : '';
}
function readMe() {
  game.me.name = cleanName($('name').value);
  store.set('pa-name', game.me.name);
  sound.init();
}
async function join(code) {
  readMe();
  setMsg('Conectando… (puede tardar unos segundos)');
  try {
    await net.joinRoom(code, { ...game.me });
    setMsg('');
    toast(net.via === 'directa' ? 'Conectado' : 'Conectado (vía servidor)');
    game.lobby = { players: [], bots: 0, racing: false, map: 'aleatorio', mode: 'show' };
    showLobby();
  } catch (e) { setMsg(e.message || String(e)); }
}

let nextTimer = null;
function showResults(msg) {
  const q = game.qualified;
  const all = game.beans;
  const order = [...all].sort((a, b) => (q.has(b.id) - q.has(a.id)) || progress(b) - progress(a));
  const meQ = player && q.has(player.id);
  const label = game.kind === 'race' ? 'Clasificado' : game.kind.startsWith('final') ? 'Ganador' : 'Superviviente';
  $('resTitle').textContent = msg.final
    ? `👑 Gana ${findBean(msg.qualified[0])?.name ?? '—'}`
    : player ? (meQ ? '¡Te has clasificado!' : '¡Eliminado!') : `Ronda ${game.round || ''} terminada`;
  const table = $('resTable');
  table.innerHTML = '';
  order.forEach((b, i) => {
    const tr = document.createElement('tr');
    if (b === player) tr.className = 'me';
    const ok = q.has(b.id);
    for (const text of [`${i + 1}º`, b.name + (b.bot ? ' 🤖' : ''), b.finishTime != null ? fmt(b.finishTime) : '—', ok ? `✅ ${label}` : '❌ Eliminado']) {
      const td = document.createElement('td'); td.textContent = text; tr.appendChild(td);
    }
    tr.firstChild.style.borderLeft = `4px solid ${b.c1}`;
    table.appendChild(tr);
  });
  const btns = $('resBtns');
  btns.innerHTML = '';
  clearInterval(nextTimer);
  if (msg.show) {
    // En un show la siguiente ronda empieza sola
    let left = BETWEEN - 1.5;
    const tick = () => { $('resNext').textContent = msg.final ? `La corona en ${Math.max(0, Math.ceil(left))} s…` : `Siguiente ronda en ${Math.max(0, Math.ceil(left))} s…`; left -= 1; };
    tick();
    nextTimer = setInterval(tick, 1000);
    if (!net.online || net.host) addButton('Terminar show', () => { game.show = null; showLobby(); if (net.online) { net.send({ t: 'tolobby' }); broadcastLobby(); } });
    else addButton('Salir de la sala', goMenu);
  } else {
    $('resNext').textContent = '';
    if (!net.online) { addButton('Otra ronda', hostStart, true); addButton('Ajustes', showLobby); addButton('Menú', goMenu); }
    else if (net.host) { addButton('Otra ronda', hostStart, true); addButton('Volver a la sala', () => { net.send({ t: 'tolobby' }); showLobby(); broadcastLobby(); }); }
    else addButton('Salir de la sala', goMenu);
  }
  show('results');
  document.exitPointerLock?.();
}
function addButton(text, fn, primary, box = 'resBtns') {
  const b = document.createElement('button');
  b.textContent = text;
  if (primary) b.className = 'primary';
  b.onclick = fn;
  $(box).appendChild(b);
}

// ---------- Corona ----------
let crownBean = null, crownAt = null;
function showCrown(winnerId) {
  clearInterval(nextTimer);
  const w = findBean(winnerId);
  game.phase = 'crown';
  hide('results'); hide('hud'); show('crown');
  $('touch').hidden = true;
  $('crownName').textContent = w ? `¡${w.name} gana la corona!` : 'Nadie se lleva la corona';
  crownBean?.dispose();
  crownAt = w ? { x: w.view.x, y: Math.max(w.view.y, -4), z: w.view.z } : { x: 0, y: FOOT, z: 6 };
  for (const b of game.beans) b.model.root.visible = false;
  if (w) {
    crownBean = buildBean({ ...w, hat: 'corona', showLabel: false });
    // Pedestal dorado bajo el ganador
    const podium = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.8, 32), new THREE.MeshPhysicalMaterial({ color: 0xffc23d, metalness: 1, roughness: 0.25 }));
    podium.position.y = -FOOT - 0.4;
    podium.receiveShadow = true;
    crownBean.root.add(podium);
    world.scene.add(crownBean.root);
  }
  if (w?.isPlayer) {
    game.crowns++;
    store.set('pa-crowns', game.crowns);
    customizationUI();
    $('crownSub').textContent = game.crowns === 1 ? '¡Has desbloqueado el sombrero de corona!' : `Llevas ${game.crowns} coronas`;
  } else $('crownSub').textContent = '';
  sound.sfx('finish');
  $('crownBtns').innerHTML = '';
  if (!net.online || net.host) {
    addButton('Otro show', hostStart, true, 'crownBtns');
    addButton('Volver a la sala', () => { showLobby(); if (net.online) { net.send({ t: 'tolobby' }); broadcastLobby(); } }, false, 'crownBtns');
  } else addButton('Salir de la sala', goMenu, false, 'crownBtns');
  document.exitPointerLock?.();
}

$('name').value = game.me.name;
$('quality').value = quality;
$('quality').onchange = e => { store.set('pa-quality', e.target.value); location.reload(); };
customizationUI();
rebuildShowcase();
setupMenu();
$('btnSolo').onclick = () => {
  readMe(); net.close();
  game.lobby = { players: [{ pid: 'solo', ...game.me }], bots: 11, racing: false, map: game.lobby.map || 'aleatorio', mode: game.lobby.mode || 'show' };
  showLobby();
};
$('btnHost').onclick = async () => {
  readMe(); setMsg('Creando sala…');
  try {
    await net.createRoom();
    setMsg('');
    game.lobby = { players: [{ pid: 'H', ...game.me }], bots: 7, racing: false, map: 'aleatorio', mode: 'show' };
    history.replaceState(null, '', `#${net.code}`);
    showLobby();
  } catch (e) { setMsg('No se pudo crear la sala: ' + (e.message || e)); }
};
$('btnJoin').onclick = () => join(location.hash.slice(1).toUpperCase());
$('btnCode').onclick = () => { const c = $('codeInput').value.trim().toUpperCase(); if (/^[A-Z0-9]{5}$/.test(c)) join(c); else setMsg('El código tiene 5 letras o números.'); };
$('btnCopy').onclick = async () => {
  try { await navigator.clipboard.writeText($('link').value); } catch { $('link').select(); document.execCommand('copy'); }
  toast('Enlace copiado');
};
$('btnLeave').onclick = goMenu;
$('bots').oninput = e => { game.lobby.bots = +e.target.value; broadcastLobby(); };
$('mapSel').onchange = e => { game.lobby.map = e.target.value; broadcastLobby(); };
$('modeSel').onchange = e => { game.lobby.mode = e.target.value; broadcastLobby(); };
$('btnStart').onclick = hostStart;

// ---------- Cámara ----------
const focus = () => (player && !player.out && !watching() ? player : spectating && !spectating.out ? spectating : player && !player.out ? player : active()[0]);
function startSpectating() {
  const list = active().filter(b => b !== player);
  spectating = list.find(b => b.finishTime == null) || list[0] || null;
}
function cycleSpectate(d) {
  const list = active().filter(b => b !== player);
  if (!list.length) return;
  const i = list.indexOf(spectating);
  spectating = list[(i + d + list.length) % list.length];
  updateSpectateHud();
}
function updateSpectateHud() {
  const on = inRound() && watching() && spectating && !spectating.out;
  $('spectate').hidden = !on;
  if (on) $('spectate').textContent = `Mirando a ${spectating.name} · ← → o clic para cambiar`;
}

const camPos = new THREE.Vector3(), camTarget = new THREE.Vector3(), tmp = new THREE.Vector3(), dir = new THREE.Vector3();
function followCamera(dt, b) {
  const v = b.view;
  tmp.set(v.x, v.y + 1.1, v.z);
  camTarget.lerp(tmp, 1 - Math.exp(-14 * dt));
  const cp = Math.cos(cam.pitch);
  dir.set(-Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), -Math.cos(cam.yaw) * cp);
  // Que la cámara no se meta dentro de muros o puertas
  let dist = cam.dist;
  const hit = physics.castRay(new RAPIER.Ray({ x: camTarget.x, y: camTarget.y, z: camTarget.z }, { x: dir.x, y: dir.y, z: dir.z }), cam.dist, true, undefined, undefined, undefined, b.phys.body);
  if (hit && hit.collider.parent()?.isFixed()) dist = Math.max(1.5, hit.timeOfImpact - 0.3);
  camPos.copy(camTarget).addScaledVector(dir, dist);
  world.camera.position.copy(camPos);
  world.camera.lookAt(camTarget);
  world.followSun(camTarget);
}
let orbit = 0;
function orbitCamera(dt, target, r, h) {
  orbit += dt * 0.25;
  world.camera.position.set(target.x + Math.sin(orbit) * r, target.y + h, target.z + Math.cos(orbit) * r);
  world.camera.lookAt(target);
  world.followSun(target);
}

// ---------- Resolución dinámica ----------
let perfT = 0, perfN = 0, perfSlow = 0, warmup = 3, lastPhase = '';
function adaptResolution(raw) {
  if (game.phase !== lastPhase) { lastPhase = game.phase; warmup = 3; perfT = perfN = perfSlow = 0; }
  if (raw > 0.25 || window.partyDebug?.noAdapt) return;
  if ((warmup -= raw) > 0) return;
  perfT += raw; perfN++;
  if (raw > 0.02) perfSlow++;
  if (perfT < 1.5) return;
  const slow = perfSlow / perfN;
  perfT = perfN = perfSlow = 0;
  const max = Math.min(devicePixelRatio, world.quality.maxRatio), min = Math.max(0.5, max * 0.5);
  let next = pixelRatio;
  if (slow > 0.12) next = Math.max(min, pixelRatio * 0.9);
  else if (slow < 0.03 && pixelRatio < max) next = Math.min(max, pixelRatio * 1.05);
  if (Math.abs(next - pixelRatio) > 0.01) { pixelRatio = next; world.setPixelRatio(pixelRatio); }
}

// ---------- HUD ----------
let lastBeep = 99, hudT = 0;
function drawHud() {
  const alive = active().length, done = game.beans.filter(b => b.finishTime != null).length;
  $('qual').textContent = {
    race: `Clasificados ${Math.min(done, game.qualifyN)} / ${game.qualifyN}`,
    survival: `Quedan ${alive} · se salvan ${game.qualifyN}`,
    final: `FINAL · Quedan ${alive}`,
    'final-race': 'FINAL · ¡Coge la corona! 👑',
  }[game.kind];
  $('timer').textContent = fmt(course.timeLimit - Math.max(0, raceTime()));
  $('players-count').textContent = `${game.beans.length} gominolas`;
  if (player && !player.out && game.kind === 'race') $('place').textContent = player.finishTime != null ? '¡En la meta!' : `Vas ${ranking().indexOf(player) + 1}º`;
  else $('place').textContent = '';
  updateSpectateHud();
}

// ---------- Bucle ----------
let last = performance.now(), time = 0, sendT = 0, confettiT = 0;
function frame(now) {
  const raw = (now - last) / 1000, dt = Math.min(0.05, raw);
  last = now; time += dt;
  adaptResolution(raw);

  if (inRound()) {
    const rt = raceTime();
    if (game.phase === 'countdown') {
      const n = Math.ceil(-rt);
      if (n !== lastBeep && n <= 3 && n >= 1) { lastBeep = n; big(String(n), 900); sound.sfx('beep'); }
      if (rt >= 0) { game.phase = 'race'; big('¡YA!', 900); sound.sfx('go'); }
      jumpPressed = divePressed = false; // nada de saltos guardados antes de la salida
    }
    const inp = player && !player.out && !player.finishTime && game.phase === 'race' ? readInput(dt) : (readInput(dt), IDLE);
    for (const b of game.beans) if (!b.owned && !b.out) interpolateRemote(b, now);
    updateGrabs(dt);
    course.beanPositions = active().map(b => b.view); // para que la IA de las arenas evite las aglomeraciones
    simulate(dt, inp);
    checkEnd();
    for (const b of game.beans) {
      if (b.out) continue;
      if (b.owned) {
        const p = b.phys.pos, v = b.phys.vel, q = b.phys.body.rotation();
        Object.assign(b.view, {
          x: p.x + v.x * acc, y: p.y + v.y * acc, z: p.z + v.z * acc, q, yaw: b.phys.yaw, vx: v.x, vy: v.y, vz: v.z,
          state: b.phys.state, grounded: b.phys.grounded, grabbing: !!b.phys.grabbing, grabbed: !!b.phys.grabbedBy,
        });
      }
      if (b.view.grounded && !b.wasGrounded && b.view.vy < -6) fx.dust(b.view.x, b.view.y - FOOT, b.view.z);
      b.wasGrounded = b.view.grounded;
      b.model.update(b.view, dt, time);
    }
    if (net.online && (sendT -= dt) <= 0) { sendT = 1 / 15; sendSnapshot(); }
    if (spectating?.out) startSpectating();
    const f = focus();
    if (f) followCamera(dt, f);
    if ((hudT -= dt) <= 0) { hudT = 0.2; drawHud(); }
    course.syncVisuals(simT + acc, dt);
  } else {
    course.stepKinematics(time);
    physics.step();
    if (game.phase === 'crown') {
      if (crownBean) crownBean.update({ ...crownAt, yaw: Math.sin(time) * 0.5, vx: 0, vy: 0, vz: 0, state: 'celebrate', grounded: true }, dt, time);
      if ((confettiT -= dt) <= 0) { confettiT = 0.7; fx.confetti(crownAt.x + (Math.random() - 0.5) * 3, crownAt.y + 2, crownAt.z + (Math.random() - 0.5) * 3); }
      orbitCamera(dt, new THREE.Vector3(crownAt.x, crownAt.y + 0.6, crownAt.z), 4.2, 1.4);
    } else {
      if (showcase) {
        showcase.root.rotation.y += dt * 0.6;
        showcase.update({ x: 0, y: FOOT, z: 6, yaw: 0, vx: 0, vy: 0, vz: 0, state: 'idle', grounded: true }, dt, time);
      }
      orbitCamera(dt, new THREE.Vector3(0, 1.2, 6), 5.5, 1);
    }
    course.syncVisuals(time, dt);
  }
  world.update(dt, time);
  fx.update(dt);
  world.render();
  requestAnimationFrame(frame);
}

// Compilar materiales antes de empezar para evitar tirones
{
  const tmpBeans = HATS.map(([hat], i) => buildBean({ c1: '#ff0000', c2: '#ffffff', pattern: 'rayas', name: 'x', showLabel: true, hat, face: FACE_IDS[i % FACE_IDS.length] }));
  for (const t of tmpBeans) { t.root.position.set(0, -50, 0); world.scene.add(t.root); }
  const hidden = [];
  world.scene.traverse(o => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  await renderer.compileAsync(world.scene, world.camera).catch(() => {});
  for (const o of hidden) o.visible = false;
  for (const t of tmpBeans) t.dispose();
}
if (new URLSearchParams(location.search).has('debug')) window.partyDebug = { game, course, physics, world, ranking, newBotMemory, net };
hide('loading');
requestAnimationFrame(frame);
