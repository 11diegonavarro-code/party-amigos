// Partículas con un pool reutilizable: salpicaduras de baba, confeti y polvo.
import * as THREE from 'three';

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class FX {
  constructor(scene, count = 400) {
    const tex = dotTexture();
    this.pool = Array.from({ length: count }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      s.visible = false;
      scene.add(s);
      return { s, life: 0, max: 1, v: new THREE.Vector3(), g: 0, size: 1, spin: 0 };
    });
    this.i = 0;
  }

  emit(x, y, z, { color = 0xffffff, n = 10, speed = 4, up = 4, size = 0.3, life = 1, gravity = 12, spread = 0.3 } = {}) {
    const col = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const p = this.pool[this.i = (this.i + 1) % this.pool.length];
      p.s.position.set(x + (Math.random() - 0.5) * spread, y, z + (Math.random() - 0.5) * spread);
      const a = Math.random() * Math.PI * 2, sp = speed * (0.4 + Math.random() * 0.6);
      p.v.set(Math.cos(a) * sp, up * (0.5 + Math.random() * 0.8), Math.sin(a) * sp);
      p.g = gravity; p.life = p.max = life * (0.7 + Math.random() * 0.6); p.size = size * (0.6 + Math.random() * 0.8);
      p.s.material.color.copy(typeof color === 'function' ? color(col) : col.set(color));
      p.s.scale.setScalar(p.size);
      p.s.visible = true;
    }
  }

  splash(x, y, z) { this.emit(x, y, z, { color: 0xff4fa8, n: 26, speed: 5, up: 8, size: 0.45, life: 1.2, gravity: 18 }); }
  confetti(x, y, z) { this.emit(x, y, z, { color: c => c.setHSL(Math.random(), 0.9, 0.6), n: 40, speed: 6, up: 9, size: 0.22, life: 2.2, gravity: 6, spread: 1.5 }); }
  dust(x, y, z) { this.emit(x, y, z, { color: 0xffffff, n: 6, speed: 1.5, up: 1, size: 0.35, life: 0.5, gravity: 0 }); }

  update(dt) {
    for (const p of this.pool) {
      if (!p.s.visible) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      p.v.y -= p.g * dt;
      p.s.position.addScaledVector(p.v, dt);
      p.s.material.opacity = Math.min(1, p.life / p.max * 2);
    }
  }
}
