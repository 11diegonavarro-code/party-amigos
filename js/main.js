import * as THREE from 'three';
import RAPIER from 'rapier';
import { createWorld, QUALITY } from './world.js';
import { Course, MAPS } from './course.js';
import { buildBean, PATTERNS } from './bean.js';
import { Bean, botInput, newBotMemory, FOOT } from './player.js';
import { FX } from './fx.js';
import { Sound } from './audio.js';
import { Net } from './net.js';

const $ = id => document.getElementById(id);
const COLORS = ['#ff5ca8', '#3d8bff', '#2ed47a', '#ffd23f', '#9b6bff', '#ff8f3d', '#00c2d1', '#ff4b4b', '#f5f5f5', '#2d3142'];
const BOT_NAMES = ['Gomi', 'Pompón', 'Chuche', 'Regaliz', 'Nube', 'Pirueta', 'Burbuja', 'Gelatina', 'Piruleta', 'Caramelo', 'Malvavisco', 'Fresita', 'Bombón', 'Rosquilla', 'Turrón', 'Mazapán'];
const STATES = ['idle', 'run', 'air', 'dive', 'getup', 'tumble', 'fallen', 'celebrate', 'slide'];
const STEP = 1 / 60, TIME_LIMIT = 300, MAX = 16, COUNTDOWN = 4.5;
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
};
const cleanName = n => String(n || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 12) || 'Gominola';
const fmt = t => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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
  phase: 'menu', beans: [], seed: 1, startAt: 0, qualifyN: 1, ended: false,
  me: { name: store.get('pa-name', 'Gominola' + Math.floor(Math.random() * 90 + 10)), c1: store.get('pa-c1', COLORS[0]), c2: store.get('pa-c2', COLORS[3]), pattern: store.get('pa-pattern', 'lunares') },
  lobby: { players: [], bots: 9, racing: false, map: 'aleatorio' },
};
let player = null;
const raceTime = () => (net.hostNow() - game.startAt) / 1000;
const inRound = () => ['countdown', 'race', 'end'].includes(game.phase);

// Escaparate del menú: tu gominola girando en la salida
let showcase = null;
function rebuildShowcase() {
  showcase?.dispose();
  showcase = buildBean({ ...game.me, showLabel: false });
  world.scene.add(showcase.root);
}
rebuildShowcase();

// ---------- Gominolas ----------
const gridSlot = i => course.spawn(i);

function spawnBean(r, i) {
  const s = gridSlot(i);
  const isPlayer = !r.bot && r.owner === net.me;
  const owned = r.bot ? (!net.online || net.host) : isPlayer;
  const phys = new Bean(RAPIER, physics, { ...s, remote: !owned });
  const model = buildBean({ ...r, showLabel: !isPlayer });
  world.scene.add(model.root);
  return {
    ...r, owned, isPlayer, phys, model, buf: [], finishTime: null, wasGrounded: true,
    mem: r.bot ? newBotMemory(Math.random() * 0.8 + 0.2) : null,
    view: { x: s.x, y: s.y, z: s.z, q: null, yaw: 0, vx: 0, vy: 0, vz: 0, state: 'idle', grounded: true },
  };
}

function clearBeans() {
  for (const b of game.beans) { b.phys.destroy(); b.model.dispose(); }
  game.beans = [];
  player = null;
}

function startRound(roster, seed, startAt, map) {
  clearBeans();
  if (course.mapId !== map) { course.load(map); world.setSlime(course.pal.slime); }
  game.seed = seed;
  course.reset(seed);
  $('mapName').textContent = MAPS[course.mapId].name;
  big(MAPS[course.mapId].name, 1400);
  game.beans = roster.map(spawnBean);
  player = game.beans.find(b => b.isPlayer) || null;
  Object.assign(game, { startAt, phase: 'countdown', ended: false, qualifyN: roster.length === 1 ? 1 : Math.max(1, Math.ceil(roster.length * 0.6)) });
  showcase?.dispose(); showcase = null;
  cam.yaw = 0; cam.pitch = 0.3;
  hide('menu'); hide('lobby'); hide('results'); show('hud');
  $('touch').hidden = !isTouch;
  lastBeep = 99;
}

const progress = b => (b.finishTime != null ? 1e6 - b.finishTime : b.view.z);
const ranking = () => [...game.beans].sort((a, b) => progress(b) - progress(a));

// ---------- Entrada ----------
const keys = new Set();
let jumpPressed = false, divePressed = false;
const isTouch = matchMedia('(pointer: coarse)').matches;
const touch = { mx: 0, mz: 0, jump: false, dive: false, id: null, ox: 0, oy: 0, camId: null, cx: 0, cy: 0 };
const cam = { yaw: 0, pitch: 0.3, dist: 7.5 };

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!e.repeat && e.code === 'Space') jumpPressed = true;
  if (!e.repeat && ['ShiftLeft', 'ShiftRight', 'KeyE', 'ControlLeft'].includes(e.code)) divePressed = true;
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
renderer.domElement.addEventListener('click', () => { if (inRound() && !isTouch) renderer.domElement.requestPointerLock?.(); });
let dragging = false;
renderer.domElement.addEventListener('mousedown', e => { if (e.button === 2 || e.button === 0) dragging = true; });
addEventListener('mouseup', () => { dragging = false; });
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
      else if (touch.camId === null) { touch.camId = t.identifier; touch.cx = t.clientX; touch.cy = t.clientY; }
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
}

const gpPrev = {};
function readInput(dt) {
  let fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  let right = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const gp = navigator.getGamepads?.()[0];
  if (gp) {
    const dz = v => (Math.abs(v) > 0.15 ? v : 0);
    if (dz(gp.axes[0]) || dz(gp.axes[1])) { right = dz(gp.axes[0]); fwd = -dz(gp.axes[1]); }
    cam.yaw -= dz(gp.axes[2] ?? 0) * 2.6 * dt;
    cam.pitch = clamp(cam.pitch + dz(gp.axes[3] ?? 0) * 1.6 * dt, -0.2, 1.2);
    for (const [i, act] of [[0, 'jump'], [1, 'dive'], [2, 'dive']]) {
      const p = !!gp.buttons[i]?.pressed;
      if (p && !gpPrev[i]) { if (act === 'jump') jumpPressed = true; else divePressed = true; }
      gpPrev[i] = p;
    }
  }
  if (touch.id !== null) { right = touch.mx; fwd = -touch.mz; }
  const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw), rx = -Math.cos(cam.yaw), rz = Math.sin(cam.yaw);
  let mx = fx * fwd + rx * right, mz = fz * fwd + rz * right;
  const l = Math.hypot(mx, mz);
  if (l > 1) { mx /= l; mz /= l; }
  return { mx, mz };
}
const IDLE = { mx: 0, mz: 0, jump: false, dive: false };

// ---------- Simulación ----------
let acc = 0, simT = 0;
function simulate(dt, playerInp) {
  // El tiempo de la simulación sigue al reloj común: corrección suave y salto si se desvía mucho (PC lento, pestaña en pausa…)
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
      if (!b.owned) continue;
      b.phys.post(STEP, course);
      // Puertas que se rompen al tocarlas y baldosas que se caen al pisarlas: se avisa a los demás
      const ev = course.touch(b.phys.pos) || (b.phys.grounded && b.phys.groundCollider ? course.ground(b.phys.groundCollider, simT) : null);
      if (ev) { net.send({ t: 'cev', ...ev }); if (ev.k === 'door') onDoorBroken(ev); }
      handleEvents(b);
    }
    acc -= STEP; steps++;
  }
  if (steps === 4) acc = 0;
}

function onDoorBroken(e) {
  fx.dust(e.x, 1.5, e.z);
  if (player && Math.abs(player.view.z - e.z) < 25) sound.sfx('door');
}

function handleEvents(b) {
  for (const ev of b.phys.events) {
    const p = b.phys.pos;
    if (ev === 'splash') { fx.splash(p.x, -7, p.z); if (b.isPlayer) sound.sfx('splash'); }
    else if (ev === 'hit' && b.isPlayer) sound.sfx('hit');
    else if (ev === 'jump' && b.isPlayer) sound.sfx('jump');
    else if (ev === 'dive' && b.isPlayer) sound.sfx('dive');
    else if (ev === 'checkpoint' && b.isPlayer) { toast('Punto de control'); sound.sfx('checkpoint'); }
    else if (ev === 'finish' && game.phase !== 'end') {
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
    big(place <= game.qualifyN ? '¡CLASIFICADO!' : '¡Llegaste!', 2500);
  }
}

// ---------- Red ----------
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
function sendSnapshot() {
  const bs = game.beans.filter(b => b.owned).map(b => {
    const p = b.phys.pos, q = b.phys.body.rotation(), v = b.phys.vel;
    return [b.id, r2(p.x), r2(p.y), r2(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w), r2(v.x), r2(v.y), r2(v.z), r3(b.phys.yaw), STATES.indexOf(b.phys.state), b.phys.cp, b.phys.grounded ? 1 : 0];
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
  Object.assign(v, { q: l.q, vx: l.vx, vy: l.vy, vz: l.vz, state: l.state, grounded: l.grounded });
  b.phys.cp = l.cp;
}

net.on('join', m => {
  if (!net.host || game.lobby.players.length >= MAX) return;
  const used = new Set(game.lobby.players.map(p => p.c1));
  const c1 = COLORS.includes(m.c1) && !used.has(m.c1) ? m.c1 : COLORS.find(c => !used.has(c));
  const p = { pid: m.from, name: cleanName(m.name), c1, c2: COLORS.includes(m.c2) ? m.c2 : COLORS[3], pattern: PATTERNS.includes(m.pattern) ? m.pattern : 'liso' };
  game.lobby.players.push(p);
  toast(`${p.name} se ha unido`);
  broadcastLobby();
});
net.on('leave', m => {
  const p = game.lobby.players.find(p => p.pid === m.from);
  if (p) toast(`${p.name} se ha ido`);
  if (net.host) { game.lobby.players = game.lobby.players.filter(p => p.pid !== m.from); broadcastLobby(); }
  for (const b of game.beans.filter(b => b.owner === m.from && !b.bot)) { b.phys.destroy(); b.model.dispose(); }
  game.beans = game.beans.filter(b => b.owner !== m.from || b.bot);
});
net.on('lobby', m => { if (!net.host) { game.lobby = m.lobby; renderLobby(); } });
net.on('start', m => { if (!net.host) startRound(m.roster, m.seed, m.startAt, m.map); });
net.on('tolobby', () => { if (!net.host) showLobby(); });
net.on('st', m => {
  const now = performance.now();
  for (const e of m.bs || []) {
    const b = game.beans.find(x => x.id === e[0]);
    if (!b || b.owned) continue;
    b.buf.push({ t: now, x: e[1], y: e[2], z: e[3], q: { x: e[4], y: e[5], z: e[6], w: e[7] }, vx: e[8], vy: e[9], vz: e[10], yaw: e[11], state: STATES[e[12]] || 'idle', cp: e[13], grounded: !!e[14] });
    if (b.buf.length > 12) b.buf.shift();
  }
});
net.on('cev', m => { const r = course.remote(m); if (r && m.k === 'door') onDoorBroken(r); });
net.on('fin', m => {
  const b = game.beans.find(x => x.id === m.id);
  if (b && b.finishTime == null) { b.finishTime = m.time; onFinish(b); }
});
net.on('end', () => { if (!net.host) endRound(); });
net.on('hostgone', () => { goMenu(); setMsg('El anfitrión ha cerrado la sala.'); });

// ---------- Rondas ----------
function hostStart() {
  sound.init();
  const L = game.lobby;
  const humans = L.players.map(p => ({ id: 'p-' + p.pid, name: p.name, c1: p.c1, c2: p.c2, pattern: p.pattern, owner: p.pid, bot: false }));
  const nb = Math.max(0, Math.min(L.bots, MAX - humans.length));
  const bots = Array.from({ length: nb }, (_, i) => ({
    id: 'b' + i, name: BOT_NAMES[i % BOT_NAMES.length], owner: net.me, bot: true,
    c1: COLORS[(i * 3 + 1) % COLORS.length], c2: COLORS[(i * 7 + 4) % COLORS.length], pattern: PATTERNS[i % PATTERNS.length],
  }));
  const roster = [...humans, ...bots].sort(() => Math.random() - 0.5);
  const seed = Math.floor(Math.random() * 2 ** 31);
  const startAt = net.hostNow() + COUNTDOWN * 1000;
  // Mapa elegido en la sala, o uno al azar distinto del anterior
  const ids = Object.keys(MAPS);
  let map = L.map;
  if (!MAPS[map]) { const others = ids.filter(id => id !== game.map); map = others[Math.floor(Math.random() * others.length)]; }
  game.map = map;
  net.send({ t: 'start', roster, seed, startAt, map });
  startRound(roster, seed, startAt, map);
}

function endRound() {
  if (game.ended) return;
  game.ended = true;
  game.phase = 'end';
  if (player && player.finishTime == null) { sound.sfx('out'); big('ELIMINADO', 2000); }
  setTimeout(showResults, 1600);
}

function checkEnd() {
  if (game.ended || (net.online && !net.host) || game.phase !== 'race') return;
  const done = game.beans.filter(b => b.finishTime != null).length;
  if (done >= game.qualifyN || raceTime() > TIME_LIMIT || done === game.beans.length) {
    net.send({ t: 'end' });
    endRound();
  }
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

function swatches(boxId, key) {
  const box = $(boxId);
  box.innerHTML = '';
  for (const c of COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch' + (c === game.me[key] ? ' on' : '');
    b.style.background = c;
    b.title = c;
    b.onclick = () => { game.me[key] = c; store.set('pa-' + key, c); swatches(boxId, key); rebuildShowcase(); };
    box.appendChild(b);
  }
}
function patternButtons() {
  const box = $('patterns');
  box.innerHTML = '';
  for (const p of PATTERNS) {
    const b = document.createElement('button');
    b.textContent = p[0].toUpperCase() + p.slice(1);
    if (p === game.me.pattern) b.className = 'on';
    b.onclick = () => { game.me.pattern = p; store.set('pa-pattern', p); patternButtons(); rebuildShowcase(); };
    box.appendChild(b);
  }
}

function broadcastLobby() {
  game.lobby.racing = inRound();
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
  $('waitMsg').textContent = L.racing ? 'Hay una ronda en curso: entrarás en la siguiente.' : 'Esperando a que el anfitrión empiece…';
  $('bots').value = L.bots; $('botsVal').textContent = L.bots;
  $('mapSel').value = MAPS[L.map] ? L.map : 'aleatorio';
  $('mapInfo').textContent = hosting ? '' : `Mapa: ${MAPS[L.map]?.name || 'aleatorio'}`;
}
function showLobby() {
  clearBeans();
  game.phase = 'lobby';
  if (!showcase) rebuildShowcase();
  hide('menu'); hide('hud'); hide('results'); show('lobby');
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
  if (!showcase) rebuildShowcase();
  history.replaceState(null, '', location.pathname + location.search);
  hide('lobby'); hide('hud'); hide('results'); show('menu');
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
    await net.joinRoom(code, { name: game.me.name, c1: game.me.c1, c2: game.me.c2, pattern: game.me.pattern });
    setMsg('');
    toast(net.via === 'directa' ? 'Conectado' : 'Conectado (vía servidor)');
    game.lobby = { players: [], bots: 0, racing: false };
    showLobby();
  } catch (e) { setMsg(e.message || String(e)); }
}

function showResults() {
  const r = ranking();
  const qualified = r.filter(b => b.finishTime != null).slice(0, game.qualifyN);
  $('resTitle').textContent = player ? (qualified.includes(player) ? '¡Te has clasificado!' : 'Eliminado') : 'Resultados';
  const table = $('resTable');
  table.innerHTML = '';
  r.forEach((b, i) => {
    const tr = document.createElement('tr');
    if (b === player) tr.className = 'me';
    const q = qualified.includes(b);
    for (const text of [`${i + 1}º`, b.name + (b.bot ? ' 🤖' : ''), b.finishTime != null ? fmt(b.finishTime) : '—', q ? '✅ Clasificado' : '❌ Eliminado']) {
      const td = document.createElement('td'); td.textContent = text; tr.appendChild(td);
    }
    tr.firstChild.style.borderLeft = `4px solid ${b.c1}`;
    table.appendChild(tr);
  });
  const btns = $('resBtns');
  btns.innerHTML = '';
  const add = (text, fn, primary) => { const b = document.createElement('button'); b.textContent = text; if (primary) b.className = 'primary'; b.onclick = fn; btns.appendChild(b); };
  if (!net.online) { add('Otra ronda', hostStart, true); add('Ajustes', showLobby); add('Menú', goMenu); }
  else if (net.host) { add('Otra ronda', hostStart, true); add('Volver a la sala', () => { net.send({ t: 'tolobby' }); showLobby(); broadcastLobby(); }); }
  else add('Salir de la sala', goMenu);
  show('results');
  document.exitPointerLock?.();
}

$('name').value = game.me.name;
$('quality').value = quality;
$('quality').onchange = e => { store.set('pa-quality', e.target.value); location.reload(); };
swatches('colors1', 'c1'); swatches('colors2', 'c2'); patternButtons();
setupMenu();
$('btnSolo').onclick = () => {
  readMe(); net.close();
  game.lobby = { players: [{ pid: 'solo', ...game.me }], bots: 11, racing: false, map: game.lobby.map || 'aleatorio' };
  showLobby();
};
$('btnHost').onclick = async () => {
  readMe(); setMsg('Creando sala…');
  try {
    await net.createRoom();
    setMsg('');
    game.lobby = { players: [{ pid: 'H', ...game.me }], bots: 7, racing: false, map: 'aleatorio' };
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
$('btnStart').onclick = hostStart;

// ---------- Cámara ----------
const camPos = new THREE.Vector3(), camTarget = new THREE.Vector3(), tmp = new THREE.Vector3();
function followCamera(dt, b) {
  const v = b.view;
  tmp.set(v.x, v.y + 1.1, v.z);
  camTarget.lerp(tmp, 1 - Math.exp(-14 * dt));
  const cp = Math.cos(cam.pitch);
  const dir = new THREE.Vector3(-Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), -Math.cos(cam.yaw) * cp);
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
function menuCamera(dt) {
  orbit += dt * 0.25;
  const target = new THREE.Vector3(0, 1.2, 6);
  world.camera.position.set(Math.sin(orbit) * 5.5, 2.2, 6 + Math.cos(orbit) * 5.5);
  world.camera.lookAt(target);
  world.followSun(target);
}

// ---------- Resolución dinámica (igual que en Kart Amigos) ----------
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
  const done = game.beans.filter(b => b.finishTime != null).length;
  $('qual').textContent = `Clasificados ${Math.min(done, game.qualifyN)} / ${game.qualifyN}`;
  $('timer').textContent = fmt(TIME_LIMIT - Math.max(0, raceTime()));
  $('players-count').textContent = `${game.beans.length} gominolas`;
  if (player) $('place').textContent = player.finishTime != null ? '¡En la meta!' : `Vas ${ranking().indexOf(player) + 1}º`;
}

// ---------- Bucle ----------
let last = performance.now(), time = 0, sendT = 0;
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
    const inp = player && !player.finishTime && game.phase === 'race' ? readInput(dt) : (readInput(dt), IDLE);
    for (const b of game.beans) if (!b.owned) interpolateRemote(b, now);
    simulate(dt, inp);
    checkEnd();
    for (const b of game.beans) {
      if (b.owned) {
        const p = b.phys.pos, v = b.phys.vel, q = b.phys.body.rotation();
        Object.assign(b.view, { x: p.x + v.x * acc, y: p.y + v.y * acc, z: p.z + v.z * acc, q, yaw: b.phys.yaw, vx: v.x, vy: v.y, vz: v.z, state: b.phys.state, grounded: b.phys.grounded });
      }
      if (b.view.grounded && !b.wasGrounded && b.view.vy < -6) fx.dust(b.view.x, b.view.y - FOOT, b.view.z);
      b.wasGrounded = b.view.grounded;
      b.model.update(b.view, dt, time);
    }
    if (net.online && (sendT -= dt) <= 0) { sendT = 1 / 15; sendSnapshot(); }
    if (player) followCamera(dt, player);
    if ((hudT -= dt) <= 0) { hudT = 0.2; drawHud(); }
  } else {
    course.stepKinematics(time);
    physics.step();
    if (showcase) {
      showcase.root.rotation.y += dt * 0.6;
      showcase.update({ x: 0, y: FOOT, z: 6, yaw: 0, vx: 0, vy: 0, vz: 0, state: 'idle', grounded: true }, dt, time);
    }
    menuCamera(dt);
  }
  course.syncVisuals(inRound() ? simT + acc : time, dt);
  world.update(dt, time);
  fx.update(dt);
  world.render();
  requestAnimationFrame(frame);
}

// Compilar materiales antes de empezar para evitar tirones
{
  const tmpBean = buildBean({ c1: '#ff0000', c2: '#ffffff', pattern: 'rayas', name: 'x', showLabel: true });
  tmpBean.root.position.set(0, -50, 0);
  world.scene.add(tmpBean.root);
  const hidden = [];
  world.scene.traverse(o => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  await renderer.compileAsync(world.scene, world.camera).catch(() => {});
  for (const o of hidden) o.visible = false;
  tmpBean.dispose();
}
if (new URLSearchParams(location.search).has('debug')) window.partyDebug = { game, course, physics, world, ranking, newBotMemory, net };
hide('loading');
requestAnimationFrame(frame);
