// Escena base: cielo HDRI, sol con sombras, mar de baba, decorado de fondo y posprocesado.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

export const QUALITY = {
  ultra: { hdr: '2k', shadow: 4096, shadowBox: 60, msaa: 4, post: true, maxRatio: 2, decor: 60 },
  alta: { hdr: '2k', shadow: 2048, shadowBox: 45, msaa: 0, post: true, maxRatio: 1.5, decor: 40 },
  baja: { hdr: '1k', shadow: 1024, shadowBox: 35, msaa: 0, post: false, maxRatio: 1, decor: 18 },
};

// Dirección del sol medida sobre el HDRI (kloofendal_48d_partly_cloudy_puresky)
export const SUN = new THREE.Vector3(0.5546, 0.742, 0.3767).normalize();
const HORIZON = new THREE.Color().setRGB(0.5, 0.56, 0.7);
const rand = (a, b) => a + Math.random() * (b - a);

class LightBloomPass extends UnrealBloomPass {
  setSize(w, h) { super.setSize(Math.max(2, w / 2), Math.max(2, h / 2)); } // a 1/4 de resolución: mucho más barato
}

// Olas de la baba: ondas con frecuencias enteras para que la textura se repita sin costuras
function waveNormals() {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S);
  const waves = [[2, 1, 0.7], [1, 3, 0.5], [4, -2, 0.3], [-3, 5, 0.2]].map(([kx, kz, a]) => ({ kx, kz, a, ph: Math.random() * 6.28 }));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let dx = 0, dz = 0;
    for (const w of waves) { const d = w.a * Math.cos((2 * Math.PI * (w.kx * x + w.kz * y)) / S + w.ph); dx += d * w.kx; dz += d * w.kz; }
    const nx = -dx * 0.08, nz = -dz * 0.08, l = Math.hypot(nx, nz, 1), i = (y * S + x) * 4;
    img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (nz / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export async function createWorld(renderer, qualityName, onProgress) {
  const Q = { ...(QUALITY[qualityName] || QUALITY.alta) };
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON, 140, 520);
  const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 3000);

  const manager = new THREE.LoadingManager();
  manager.onProgress = (url, loaded, total) => onProgress?.(loaded / total);
  const sky = await new Promise(res => new RGBELoader(manager).load(`assets/sky_${Q.hdr}.hdr`, t => { t.mapping = THREE.EquirectangularReflectionMapping; res(t); }, undefined, () => res(null)));
  const pmrem = new THREE.PMREMGenerator(renderer);
  if (sky) {
    scene.background = sky;
    scene.environment = pmrem.fromEquirectangular(sky).texture;
  } else {
    scene.background = new THREE.Color(0x9cc8f0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.2));
  }
  pmrem.dispose();

  const sun = new THREE.DirectionalLight(0xfff3e2, 2.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  Object.assign(sun.shadow.camera, { left: -Q.shadowBox, right: Q.shadowBox, top: Q.shadowBox, bottom: -Q.shadowBox, near: 1, far: 300 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // Mar de baba rosa con dos capas de olas
  const waves = waveNormals(), waves2 = waves.clone();
  waves.repeat.set(40, 40); waves2.repeat.set(97, 97); waves2.rotation = 0.6; waves2.needsUpdate = true;
  const slime = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({
    color: 0xff3d9a, roughness: 0.18, metalness: 0, emissive: 0x7a0b45, emissiveIntensity: 0.35,
    normalMap: waves, normalScale: new THREE.Vector2(0.35, 0.35), clearcoat: 1, clearcoatRoughness: 0.08,
    clearcoatNormalMap: waves2, clearcoatNormalScale: new THREE.Vector2(0.25, 0.25), envMapIntensity: 0.9,
  }));
  slime.position.y = -7;
  slime.receiveShadow = true;
  scene.add(slime);

  // Decorado: islas de golosinas y globos flotando alrededor del recorrido
  const decor = new THREE.Group();
  {
    const pastel = () => new THREE.Color().setHSL(Math.random(), rand(0.55, 0.85), rand(0.55, 0.72));
    const candy = c => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    const shapes = [
      new THREE.TorusGeometry(6, 2.6, 16, 40),
      new THREE.SphereGeometry(6, 28, 20),
      new THREE.CylinderGeometry(5, 7, 4, 24),
      new THREE.CapsuleGeometry(2.4, 9, 8, 16),
    ];
    for (let i = 0; i < Q.decor; i++) {
      const a = rand(0, Math.PI * 2), r = rand(70, 260);
      const m = new THREE.Mesh(shapes[i % shapes.length], candy(pastel()));
      m.position.set(Math.cos(a) * r, rand(-14, 40), 125 + Math.sin(a) * r * 1.4);
      m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      m.scale.setScalar(rand(0.8, 2.4));
      m.userData = { bob: rand(0, 6.28), spin: rand(-0.15, 0.15), y: m.position.y };
      decor.add(m);
    }
    const balloon = new THREE.SphereGeometry(1.5, 20, 16).scale(1, 1.2, 1);
    for (let i = 0; i < Q.decor; i++) {
      const m = new THREE.Mesh(balloon, candy(pastel()));
      m.position.set(rand(-90, 90), rand(8, 45), rand(-40, 300));
      if (Math.abs(m.position.x) < 20) m.position.x += Math.sign(m.position.x || 1) * 25;
      m.userData = { bob: rand(0, 6.28), spin: 0, y: m.position.y };
      decor.add(m);
    }
  }
  scene.add(decor);

  // Posprocesado (bloom ligero + FXAA + viñeta y un poco de saturación)
  let composer = null, fxaa = null;
  if (Q.post) {
    const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: Q.msaa });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new LightBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.25, 0.45, 1.0));
    composer.addPass(new OutputPass());
    if (!Q.msaa) { fxaa = new ShaderPass(FXAAShader); composer.addPass(fxaa); }
    composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main() {
          vec4 col = texture2D(tDiffuse, vUv);
          float l = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
          col.rgb = mix(vec3(l), col.rgb, 1.15);
          vec2 c = vUv - 0.5;
          col.rgb *= mix(0.78, 1.0, smoothstep(0.85, 0.3, length(c * vec2(1.0, 0.8))));
          gl_FragColor = col;
        }`,
    }));
  }

  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    const pr = renderer.getPixelRatio();
    if (composer) { composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight); }
    fxaa?.material.uniforms.resolution.value.set(1 / (innerWidth * pr), 1 / (innerHeight * pr));
  }
  resize();

  return {
    scene, camera, quality: Q, composer, resize,
    render: () => (composer ? composer.render() : renderer.render(scene, camera)),
    setPixelRatio(pr) { renderer.setPixelRatio(pr); resize(); },
    setSlime(color) {
      slime.material.color.set(color);
      slime.material.emissive.set(color).multiplyScalar(0.3);
    },
    followSun(target) {
      sun.position.copy(target).addScaledVector(SUN, 120);
      sun.target.position.copy(target);
      sun.target.updateMatrixWorld();
    },
    update(dt, time) {
      waves.offset.set(time * 0.01, time * 0.006);
      waves2.offset.set(-time * 0.013, time * 0.009);
      for (const m of decor.children) {
        m.position.y = m.userData.y + Math.sin(time * 0.6 + m.userData.bob) * 1.2;
        m.rotation.y += m.userData.spin * dt;
      }
    },
  };
}
