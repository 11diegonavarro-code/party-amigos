// Gominola: modelo 3D y animación procedural a partir del estado físico.
import * as THREE from 'three';

export const PATTERNS = ['liso', 'rayas', 'lunares', 'mitad'];
export const HATS = [['nada', 'Nada'], ['fiesta', 'Fiesta'], ['gato', 'Gato'], ['antena', 'Antena'], ['lazo', 'Lazo'], ['vikingo', 'Vikingo'], ['corona', 'Corona']];
export const FACES = [['normal', 'Normal'], ['feliz', 'Contenta'], ['gafas', 'Gafas']];

function patternTexture(c1, c2, pattern) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = c1; g.fillRect(0, 0, 256, 256);
  g.fillStyle = c2;
  if (pattern === 'rayas') for (let y = 0; y < 256; y += 42) g.fillRect(0, y, 256, 16);
  else if (pattern === 'lunares') {
    for (let y = 16; y < 256; y += 40) for (let x = (y / 40) % 2 ? 20 : 0; x < 256; x += 40) { g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill(); }
  } else if (pattern === 'mitad') g.fillRect(0, 0, 256, 118); // en la cápsula, v=0 es abajo: la parte de abajo cambia de color
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function label(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 32px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = '#000a'; g.strokeText(text, 128, 32);
  g.fillStyle = '#fff'; g.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(2.4, 0.6, 1);
  s.position.y = 1.55;
  s.renderOrder = 10;
  return s;
}

const shadowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const white = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.2, clearcoat: 1 });
const black = new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.1, clearcoat: 1 });
const blushMat = new THREE.MeshBasicMaterial({ color: 0xff7aa8, transparent: true, opacity: 0.6 });
const gold = new THREE.MeshPhysicalMaterial({ color: 0xffc23d, metalness: 1, roughness: 0.22, emissive: 0x3a2400 });
const metal = new THREE.MeshPhysicalMaterial({ color: 0xb8bec8, metalness: 0.9, roughness: 0.3 });
const ivory = new THREE.MeshPhysicalMaterial({ color: 0xf3ead2, roughness: 0.5, clearcoat: 0.4 });
const lerp = (a, b, t) => a + (b - a) * t;

function stripedTexture(c1, c2) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = c1; g.fillRect(0, 0, 64, 64);
  g.fillStyle = c2;
  for (let y = 0; y < 64; y += 16) g.fillRect(0, y, 64, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Cara: ojos normales, contentos (^ ^) o con gafas de sol. Todo mirando hacia +z
function buildFace(pose, face, add) {
  if (face === 'feliz') {
    for (const s of [-1, 1]) {
      add(pose, new THREE.TorusGeometry(0.075, 0.02, 6, 16, Math.PI), black, s * 0.14, 0.4, 0.39);
      const blush = add(pose, new THREE.CircleGeometry(0.065, 16), blushMat, s * 0.24, 0.29, 0.37);
      blush.rotation.y = s * 0.55;
      blush.castShadow = false;
    }
    return;
  }
  for (const s of [-1, 1]) {
    const eye = add(pose, new THREE.SphereGeometry(0.12, 16, 12), white, s * 0.14, 0.43, 0.33);
    eye.scale.set(1, 1.15, 0.6);
    add(pose, new THREE.SphereGeometry(0.06, 12, 10), black, s * 0.13, 0.42, 0.405);
    add(pose, new THREE.SphereGeometry(0.018, 8, 6), white, s * 0.11, 0.46, 0.46);
  }
  if (face === 'gafas') {
    for (const s of [-1, 1]) {
      const lens = add(pose, new THREE.SphereGeometry(0.135, 20, 12), black, s * 0.14, 0.43, 0.38);
      lens.scale.set(1.1, 0.8, 0.35);
    }
    add(pose, new THREE.CylinderGeometry(0.015, 0.015, 0.1, 6).rotateZ(Math.PI / 2), black, 0, 0.45, 0.43);
  }
}

// Sombreros, colocados sobre la cabeza (la cápsula termina en y = 0,9)
function buildHat(pose, hat, c1, c2, add) {
  if (!hat || hat === 'nada') return;
  const g = new THREE.Group();
  g.position.y = 0.84;
  pose.add(g);
  if (hat === 'fiesta') {
    const cone = add(g, new THREE.ConeGeometry(0.2, 0.55, 24), new THREE.MeshPhysicalMaterial({ map: stripedTexture(c2, '#ffffff'), roughness: 0.4, clearcoat: 0.6 }), 0.04, 0.3, 0);
    cone.rotation.z = -0.18;
    add(g, new THREE.SphereGeometry(0.075, 12, 10), white, 0.09, 0.58, 0);
  } else if (hat === 'gato') {
    const inner = new THREE.MeshPhysicalMaterial({ color: 0xff9ec4, roughness: 0.5 });
    const fur = new THREE.MeshPhysicalMaterial({ color: c1, roughness: 0.4, clearcoat: 0.5 });
    for (const s of [-1, 1]) {
      const ear = add(g, new THREE.ConeGeometry(0.13, 0.3, 4), fur, s * 0.21, 0.05, 0);
      ear.rotation.set(0, Math.PI / 4, -s * 0.38);
      const inEar = add(g, new THREE.ConeGeometry(0.075, 0.2, 4), inner, s * 0.205, 0.04, 0.04);
      inEar.rotation.set(0, Math.PI / 4, -s * 0.38);
    }
  } else if (hat === 'antena') {
    add(g, new THREE.CylinderGeometry(0.015, 0.015, 0.36, 6), metal, 0, 0.18, 0);
    add(g, new THREE.SphereGeometry(0.075, 14, 10), new THREE.MeshStandardMaterial({ color: 0xffe14d, emissive: 0xffc400, emissiveIntensity: 1.4 }), 0, 0.38, 0);
  } else if (hat === 'lazo') {
    const ribbon = new THREE.MeshPhysicalMaterial({ color: c2, roughness: 0.35, clearcoat: 0.8 });
    for (const s of [-1, 1]) {
      const loop = add(g, new THREE.ConeGeometry(0.1, 0.22, 16), ribbon, s * 0.13, 0.02, 0.05);
      loop.rotation.z = s * Math.PI / 2;
      loop.scale.set(1, 1, 0.55);
    }
    add(g, new THREE.SphereGeometry(0.055, 12, 10), ribbon, 0, 0.02, 0.05);
  } else if (hat === 'vikingo') {
    add(g, new THREE.SphereGeometry(0.44, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.6), metal, 0, -0.18, 0);
    for (const s of [-1, 1]) {
      const horn = add(g, new THREE.ConeGeometry(0.07, 0.34, 12), ivory, s * 0.38, 0.06, 0);
      horn.rotation.z = -s * 0.95;
    }
  } else if (hat === 'corona') {
    add(g, new THREE.CylinderGeometry(0.25, 0.23, 0.16, 28, 1, true), gold, 0, 0.06, 0).material.side = THREE.DoubleSide;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      add(g, new THREE.ConeGeometry(0.055, 0.16, 10), gold, Math.sin(a) * 0.24, 0.21, Math.cos(a) * 0.24);
      add(g, new THREE.SphereGeometry(0.03, 8, 6), gold, Math.sin(a) * 0.24, 0.3, Math.cos(a) * 0.24);
    }
    add(g, new THREE.SphereGeometry(0.04, 10, 8), new THREE.MeshPhysicalMaterial({ color: 0xff2a4a, roughness: 0.1, clearcoat: 1 }), 0, 0.06, 0.245);
  }
}

export function buildBean({ c1, c2, pattern, name, showLabel, hat = 'nada', face = 'normal' }) {
  const root = new THREE.Group(), orient = new THREE.Group(), pose = new THREE.Group();
  root.add(orient); orient.add(pose);
  const skin = new THREE.MeshPhysicalMaterial({ map: patternTexture(c1, c2, pattern), roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.2, envMapIntensity: 0.9 });
  const limb = new THREE.MeshPhysicalMaterial({ color: c1, roughness: 0.4, clearcoat: 0.6 });
  const add = (parent, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };

  add(pose, new THREE.CapsuleGeometry(0.42, 0.96, 10, 24), skin, 0, 0, 0);
  buildFace(pose, face, add);
  buildHat(pose, hat, c1, c2, add);
  // Brazos y piernas con pivote en el hombro y la cadera
  const joint = (x, y) => { const g = new THREE.Group(); g.position.set(x, y, 0); pose.add(g); return g; };
  const arms = [-1, 1].map(s => {
    const j = joint(s * 0.4, 0.05);
    add(j, new THREE.CapsuleGeometry(0.085, 0.24, 4, 10), limb, s * 0.03, -0.2, 0);
    return j;
  });
  const legs = [-1, 1].map(s => {
    const j = joint(s * 0.17, -0.72);
    add(j, new THREE.CapsuleGeometry(0.1, 0.12, 4, 10), limb, 0, -0.1, 0);
    const foot = add(j, new THREE.SphereGeometry(0.13, 12, 10), limb, 0, -0.2, 0.05);
    foot.scale.set(1, 0.6, 1.35);
    return j;
  });
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  blob.position.y = -0.88;
  root.add(blob);
  if (showLabel) root.add(label(name));

  let phase = 0;
  const yawQ = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), tmpQ = new THREE.Quaternion();

  return {
    root,
    // s: { x, y, z, q (cuaternión físico), yaw, vx, vy, vz, state, grounded }
    update(s, dt, time) {
      root.position.set(s.x, s.y, s.z);
      // Volteretas y plancha: la orientación la da la física (en la plancha, tumbado boca abajo)
      if ((s.state === 'tumble' || s.state === 'dive' || s.state === 'slide') && s.q) { tmpQ.set(s.q.x, s.q.y, s.q.z, s.q.w); orient.quaternion.slerp(tmpQ, Math.min(1, dt * 22)); }
      else { yawQ.setFromAxisAngle(up, s.yaw); orient.quaternion.slerp(yawQ, Math.min(1, dt * 14)); }
      blob.visible = s.grounded !== false;
      blob.position.y = s.state === 'dive' || s.state === 'slide' ? -0.4 : -0.88; // tumbado, el centro está más bajo

      const speed = Math.hypot(s.vx, s.vz);
      const k = Math.min(1, dt * 14);
      let la = 0, ra = 0, lz = 0, rz = 0, ll = 0, rl = 0, pitch = 0, bob = 0, squash = 1;
      if (s.state === 'run' || s.state === 'idle') {
        phase += dt * (3 + speed * 1.9);
        const amp = Math.min(1, speed / 5);
        ll = Math.sin(phase) * 0.8 * amp; rl = -ll;
        la = -Math.sin(phase) * 0.9 * amp; ra = -la;
        lz = -0.15; rz = 0.15;
        pitch = 0.12 * amp;
        bob = Math.abs(Math.sin(phase)) * 0.07 * amp + (1 - amp) * Math.sin(time * 2.2) * 0.015;
        squash = 1 + (1 - amp) * Math.sin(time * 2.2) * 0.015;
      } else if (s.state === 'air') {
        const flail = s.vy < -5 ? Math.sin(time * 22) * 0.4 : 0;
        lz = -2.3 + flail; rz = 2.3 - flail;
        ll = 0.5; rl = 0.3;
        squash = s.vy > 0 ? 1.06 : 0.98;
      } else if (s.state === 'dive' || s.state === 'slide') {
        // Brazos estirados por encima de la cabeza (que, tumbado, apuntan hacia delante) y piernas atrás
        lz = -2.9; rz = 2.9;
        ll = rl = s.state === 'slide' ? Math.sin(time * 18) * 0.25 : 0.3;
      } else if (s.state === 'getup') {
        pitch = 0.35;
        la = ra = -1.2;
      } else if (s.state === 'tumble' || s.state === 'fallen') {
        la = Math.sin(time * 17) * 1.5; ra = Math.cos(time * 15) * 1.5;
        lz = -1.2; rz = 1.2;
        ll = Math.sin(time * 13) * 0.9; rl = -ll;
      } else if (s.state === 'celebrate') {
        lz = -2.6 + Math.sin(time * 9) * 0.35; rz = 2.6 - Math.sin(time * 9 + 1) * 0.35;
        bob = Math.abs(Math.sin(time * 5)) * 0.35;
      }
      // Agarrando: brazos al frente. Agarrado: se revuelve
      if (s.grabbing && (s.state === 'run' || s.state === 'idle' || s.state === 'air')) { la = ra = -1.5; lz = -0.1; rz = 0.1; }
      else if (s.grabbed && (s.state === 'run' || s.state === 'idle')) { la = Math.sin(time * 20) * 1.2; ra = -la; lz = -0.9; rz = 0.9; }
      arms[0].rotation.x = lerp(arms[0].rotation.x, la, k); arms[1].rotation.x = lerp(arms[1].rotation.x, ra, k);
      arms[0].rotation.z = lerp(arms[0].rotation.z, lz, k); arms[1].rotation.z = lerp(arms[1].rotation.z, rz, k);
      legs[0].rotation.x = lerp(legs[0].rotation.x, ll, k); legs[1].rotation.x = lerp(legs[1].rotation.x, rl, k);
      pose.rotation.x = lerp(pose.rotation.x, pitch, Math.min(1, dt * 10));
      pose.position.y = lerp(pose.position.y, bob, k);
      pose.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    },
    dispose() { root.removeFromParent(); },
  };
}
