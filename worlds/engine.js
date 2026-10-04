/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ICELAND 3D WORLD ENGINE · worlds/engine.js   (ES module · three@0.160.0)
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  QUICK START — copy worlds/_template.html, then:
 *
 *    <script type="importmap">{"imports":{
 *      "three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
 *      "three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script>
 *    <link rel="stylesheet" href="world.css">
 *    <script type="module">
 *      import * as THREE from 'three';
 *      import { createWorld, helpers } from './engine.js';
 *      const H = (x, z) => helpers.fbm(x * 0.02, z * 0.02) * 4;      // ground height
 *      const w = await createWorld({ title: '雪原', subtitle: 'Snowfield', heightAt: H,
 *                                    timeOfDay: 'night', bloom: { strength: 0.7 } });
 *      w.scene.add(helpers.createTerrain({ size: 260, heightFn: H, color: 0xe8f0f7 }));
 *      w.scene.add(helpers.createAurora(), helpers.createStars(3000));
 *      w.scene.add(helpers.createRocks({ count: 30, radius: 50 }));    // auto colliders
 *      w.onUpdate((dt, t) => { ... });                                 // per-frame hook
 *      w.start();                                                      // fades loading screen
 *    </script>
 *
 *  Coordinates: Y is up, 1 unit ≈ 1 metre. The player is ~1.6 units tall.
 *  The ground is defined ONLY by `heightAt(x,z)`; build your visible terrain mesh
 *  from the same function (helpers.createTerrain({heightFn})) so feet match.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  createWorld(options) → Promise<World>
 * ────────────────────────────────────────────────────────────────────────────
 *  title         string    Big title (HUD card + loading screen).             default '冰島'
 *  subtitle      string    Small line under the title.                        default ''
 *  backHref      string    "← 回到行程" link.                       default '../index.html#worlds'
 *  timeOfDay     'day'|'dusk'|'night'   Picks lights, sky, exposure, player lantern.  default 'day'
 *  background    hex       Clear colour + default fog/horizon colour.         default 0x8fb3c9
 *  fog           {color, near, far} | {color, density} (FogExp2) | false.
 *                default {color: background, near: 40, far: 260}
 *  sky           false | {top, horizon, bottom, sunColor, glow}. Gradient sky dome that
 *                follows the camera. horizon defaults to the fog colour (seamless).
 *  sun           {color, intensity, dir:[x,y,z]}  override key light (moon at night).
 *  hemi          {sky, ground, intensity}          override hemisphere fill light.
 *  exposure      number   tone-mapping exposure (day 1.0 / dusk 1.05 / night 1.2)
 *  spawn         {x, z, yaw?}  player start; yaw = facing (radians, 0 = +Z).  default {x:0,z:0}
 *  boundsRadius  number   player cannot walk further than this from boundsCenter. default 80
 *  boundsCenter  {x, z}                                                        default {x:0,z:0}
 *  heightAt      (x,z)=>y ground height function.                            default ()=>0
 *  water         {level, slow=0.55, maxDepth=0.85}  wading: below `level` the player
 *                slows down and never sinks deeper than maxDepth (chest height).
 *  bloom         {strength=0.6, radius=0.6, threshold=0.8} | null   (UnrealBloomPass)
 *  hints         string[]  world-specific hint chips shown after the control hints.
 *  info          [{at:{x,z}, radius=4, title, text, img?, marker=true}]   proximity cards;
 *                marker draws a floating glowing orb + ground ring at the spot.
 *  camera        {distance=7.5, minDistance=3, maxDistance=16, pitch=0.32, fov=50, intro=true}
 *  player        {walk=4.4, run=8.4, jump=8.6, light: bool (auto at night), colors:{...}}
 *                colors: sweater, yoke, pattern, beanie, pom, pants, boots, skin, hair, pack.
 *  shadows       bool  (default true)
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  World (returned object)
 * ────────────────────────────────────────────────────────────────────────────
 *  THREE, scene, camera, renderer, composer (or null), bloomPass (or null)
 *  sun (DirectionalLight, shadow follows player), hemi (HemisphereLight), sky (Mesh|null)
 *  player        THREE.Group at the feet. Extra fields: .velocity (Vector3), .onGround,
 *                .inWater, .speed, .teleport(x, z, yaw?)
 *  onUpdate(fn(dt, elapsed))   per-frame callback, returns an unsubscribe function.
 *  addCollider(x)  x = {x, z, r, top?} | Object3D (bounding box → circle) | array.
 *                  With `top`, the collider is a platform: walk/jump onto it if your
 *                  feet are within 0.5 of the top, otherwise it is a wall. Returns x.
 *  setHeightFn(fn)   replace the ground function at runtime.
 *  heightAt(x,z)     current ground function.  groundAt(x,z) also counts platforms.
 *  addInfo(zone)     add an info zone after creation (same shape as options.info[i]).
 *  toast(text)       brief glass toast in the middle-top of the screen.
 *  add(...objects)   = scene.add
 *  start()           compiles shaders, fades the loading screen, runs the intro camera.
 *  elapsed           seconds since start() (getter).
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  helpers  (all return regular THREE objects; add them to w.scene yourself)
 * ────────────────────────────────────────────────────────────────────────────
 *  ANIMATION: every animated helper is driven automatically by the engine (a shared
 *  time uniform + an internal updater list). You never have to call update yourself.
 *  Each still exposes `.update(dt, t)` (a no-op-safe method) for consistency.
 *
 *  noise2D(x, z) → [-1,1]  smooth gradient noise.     fbm(x, z, octaves=5) → ~[-1,1]
 *  ridged(x, z, octaves=5) → [0,1] sharp ridges (mountains).   rand(seed) → ()=>[0,1)
 *  lerp(a,b,t)  smoothstep(e0,e1,x)  clamp(x,a,b)
 *
 *  createTerrain({size=200, width, depth, segments=160, heightFn=world.heightAt,
 *                 color=0xdfe8ef, colorFn:(x,y,z,slopeY)=>hex|Color, roughness=0.95,
 *                 flatShading=false, noiseTint=0.05}) → Mesh (receives shadows)
 *  createSky({top, horizon, bottom, sunDir:Vector3, sunColor, glow, moon}) → Mesh
 *       (createWorld already adds one; use options.sky to style it)
 *  createStars(count=2500, {radius=1500, size=1.8, milkyWay=true}) → Points (follows camera)
 *  createAurora({count=3, distance=150, height=70, y=40, span=1.6, direction=0,
 *                colors:['#38ff9c','#2fe0c0','#b38cff'], intensity=1, speed=1, sway=12})
 *       → Group of curtains around the camera. direction = yaw (0 = towards -Z).
 *  createWater({size=200 | width,depth | radius, segments=128, level=0, color=0x4fb6c9,
 *               deepColor=0x0d3b4f, waveAmp=0.12, waveScale=1, speed=1, opacity=0.92,
 *               roughness=0.12, glow=0, reflect=0.55, sparkle=0.35}) → Mesh at y=level
 *       glow = milky self-illumination (Blue Lagoon ≈ 0.35).
 *  createSteam({count=160, area=20 | radius, center={x,z}, y=0, sources:[{x,z,r,y?}],
 *               height=7, size=3.2, color=0xffffff, opacity=0.22, speed=1, spread=1.6,
 *               wind=[0.25,0.05]}) → Mesh (instanced billboards)
 *  createSnow({count=3500, area=70, height=34, speed=1.6, size=0.11, color=0xffffff,
 *              opacity=0.9, sway=0.7}) → Points (wraps around the camera forever)
 *  createParticles({...same as createSnow, rise=false}) generic drifting particles
 *       (rise:true = embers / bubbles going up).
 *  createRocks({count=20, radius=40, center={x,z}, minSize=0.5, maxSize=2.2,
 *               color=0x3b3f45, seed=7, avoid:[{x,z,r}], positions:[{x,z,s}],
 *               squash=0.7, sink=0.25, collide=true, heightFn}) → InstancedMesh
 *       Small rocks become climbable platforms; colliders auto-registered.
 *  createBasaltColumns({center={x,z}, radius=6 | width,depth, colRadius=0.45,
 *               minH=0.6, maxH=4, heightFn:(lx,lz,d01,rnd)=>h, color=0x2b2d31,
 *               seed=3, rotation=0, collide=true}) → InstancedMesh of hexagonal prisms
 *       Each column is a platform collider (staircase you can climb/jump on).
 *  createIce({size=2, seed=1, color=0xbfeaff, stretch=[1,0.75,1], detail=1,
 *             emissive=0x0b4a6a, opacity=1}) → Mesh  (glossy faceted iceberg/ice chunk)
 *  createWaterfall({x=0, z=0, top=10, bottom=0, width=4, color=0xeaf6ff, rotation=0,
 *             speed=1, mist=true}) → Group (scrolling streak sheet + mist + foam)
 *  createGlow({color=0xffd9a0, size=2, opacity=0.9}) → Sprite (additive soft glow)
 *  addRim(material, color=0x9fd8ff, strength=0.6, power=2.5) → material (fresnel rim light)
 *  softTexture() → CanvasTexture (radial soft dot, cached)
 * ════════════════════════════════════════════════════════════════════════════
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export { THREE };

/* Shared state used by helpers (time uniform, current world, per-frame updaters). */
const SHARED = {
  time: { value: 0 },
  pxScale: { value: 900 },       // device px per world unit at distance 1 (for Points)
  pixelRatio: { value: 1 },
  horizon: { value: new THREE.Color(0x8fb3c9) },
  world: null,                    // internal world (heightAt, camera, colliders...)
  updaters: new Set(),            // fn(dt, t, camera)
};
const EASE = (t) => 1 - Math.pow(1 - t, 3);

/* ═════════════════════════════ math & noise ═════════════════════════════ */
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/** Seeded RNG (mulberry32). rand(42)() → [0,1) */
export function rand(seed = 1) {
  let a = (seed * 2654435761) >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PERM = new Uint8Array(512);
(() => {
  const r = rand(1337); const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();
const GX = [1, -1, 1, -1, 1.4, -1.4, 0, 0], GZ = [1, 1, -1, -1, 0, 0, 1.4, -1.4];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** 2D gradient (Perlin) noise, smooth, roughly in [-1, 1]. */
export function noise2D(x, z) {
  const X = Math.floor(x), Z = Math.floor(z);
  const xf = x - X, zf = z - Z, xi = X & 255, zi = Z & 255;
  const u = fade(xf), v = fade(zf);
  const g = (h, dx, dz) => GX[h & 7] * dx + GZ[h & 7] * dz;
  const aa = PERM[PERM[xi] + zi], ab = PERM[PERM[xi] + zi + 1];
  const ba = PERM[PERM[xi + 1] + zi], bb = PERM[PERM[xi + 1] + zi + 1];
  const x1 = lerp(g(aa, xf, zf), g(ba, xf - 1, zf), u);
  const x2 = lerp(g(ab, xf, zf - 1), g(bb, xf - 1, zf - 1), u);
  return clamp(lerp(x1, x2, v) * 1.1, -1, 1);
}

/** Fractal brownian motion of noise2D, ~[-1, 1]. Use small frequencies: fbm(x*0.02, z*0.02). */
export function fbm(x, z, octaves = 5, lacunarity = 2.0, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise2D(x * f + i * 17.3, z * f - i * 9.1) * amp;
    norm += amp; amp *= gain; f *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal, [0, 1] — sharp crests for mountains/lava fields. */
export function ridged(x, z, octaves = 5) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2D(x * f + i * 31.7, z * f + i * 11.3));
    sum += n * n * amp; norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}

let _softTex = null;
/** Cached radial soft-dot texture (white, alpha falloff). */
export function softTexture() {
  if (_softTex) return _softTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  _softTex = new THREE.CanvasTexture(c);
  _softTex.colorSpace = THREE.SRGBColorSpace;
  return _softTex;
}

/** Adds a fresnel rim light to any built-in lit material (Standard/Physical/Lambert/Phong). */
export function addRim(material, color = 0x9fd8ff, strength = 0.6, power = 2.5) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uRimColor = { value: new THREE.Color(color) };
    sh.uniforms.uRimStrength = { value: strength };
    sh.uniforms.uRimPower = { value: power };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor; uniform float uRimStrength; uniform float uRimPower;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { float rimF = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), uRimPower);
          totalEmissiveRadiance += uRimColor * rimF * uRimStrength; }`);
  };
  material.customProgramCacheKey = () => 'rim' + power.toFixed(2);
  return material;
}

/** Standard fog-aware uniforms for custom ShaderMaterials (keeps shared refs intact). */
function fogUniforms(extra) {
  return Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), extra);
}
function registerUpdater(obj, fn) {
  SHARED.updaters.add(fn);
  obj.update = obj.update || (() => {});
  obj.addEventListener?.('removed', () => SHARED.updaters.delete(fn));
  return obj;
}
const worldHeight = (x, z) => (SHARED.world ? SHARED.world.heightAt(x, z) : 0);

/* ═════════════════════════════ sky / stars / aurora ═════════════════════════════ */

/** Gradient sky dome with sun/moon glow. Follows the camera automatically. */
export function createSky({ top = 0x2f5f9a, horizon = 0x8fb3c9, bottom = null, sunDir = new THREE.Vector3(0.5, 0.6, 0.3),
  sunColor = 0xffe2b0, glow = 0.35, moon = false, sunSize = 1, radius = 2000 } = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(top) }, uHorizon: { value: new THREE.Color(horizon) },
      uBottom: { value: new THREE.Color(bottom ?? horizon) }, uSunDir: { value: sunDir.clone().normalize() },
      uSunColor: { value: new THREE.Color(sunColor) }, uGlow: { value: glow },
      uCos: { value: Math.cos(0.022 * sunSize) }, uMoon: { value: moon ? 1 : 0 },
    },
    vertexShader: /* glsl */`varying vec3 vDir;
      void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform vec3 uTop, uHorizon, uBottom, uSunDir, uSunColor; uniform float uGlow, uCos, uMoon;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.9, h), 0.55))
                           : mix(uHorizon, uBottom, smoothstep(0.0, -0.3, h));
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSunColor * (pow(s, 5.0) * uGlow * 0.45 + pow(s, 60.0) * uGlow * 0.9);
        float disc = smoothstep(uCos - 0.00012, uCos + 0.00006, s);
        col += uSunColor * disc * mix(4.0, 1.4, uMoon);
        col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
  sky.renderOrder = -1000; sky.frustumCulled = false; sky.name = 'sky';
  return registerUpdater(sky, (dt, t, cam) => { if (cam) sky.position.copy(cam.position); });
}

/** Twinkling star field on the upper hemisphere (+ optional Milky Way band). Follows camera. */
export function createStars(count = 2500, opts = {}) {
  if (typeof count === 'object') { opts = count; count = opts.count ?? 2500; }
  const { radius = 1500, size = 1.8, milkyWay = true, seed = 11 } = opts;
  const r = rand(seed);
  const pos = new Float32Array(count * 3), aS = new Float32Array(count * 2), col = new Float32Array(count * 3);
  const band = new THREE.Vector3(0.35, 0.25, -1).normalize();      // band great-circle axis
  const tmp = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3();
  u.set(0, 1, 0).cross(band).normalize(); v.copy(band).cross(u).normalize();
  const tints = [[1, 1, 1], [0.8, 0.88, 1], [1, 0.92, 0.8], [0.75, 0.95, 1]];
  for (let i = 0; i < count; i++) {
    if (milkyWay && r() < 0.38) {
      const a = r() * Math.PI * 2, off = (r() + r() + r() - 1.5) * 0.22;
      tmp.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a)).addScaledVector(band, off).normalize();
    } else {
      tmp.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
      if (tmp.lengthSq() > 1 || tmp.lengthSq() < 0.01) { i--; continue; }
      tmp.normalize();
    }
    if (tmp.y < 0) tmp.y = -tmp.y;
    tmp.y = tmp.y * 0.96 + 0.04;
    tmp.normalize().multiplyScalar(radius);
    pos.set([tmp.x, tmp.y, tmp.z], i * 3);
    const big = r() < 0.04 ? 2.2 : 1;
    aS[i * 2] = (0.4 + Math.pow(r(), 3) * 1.6) * big; aS[i * 2 + 1] = r() * 100;
    const t = tints[Math.floor(r() * tints.length)]; col.set(t, i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aS', new THREE.BufferAttribute(aS, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: SHARED.time, uPR: SHARED.pixelRatio, uSize: { value: size } },
    vertexShader: /* glsl */`uniform float uTime, uPR, uSize; attribute vec2 aS; attribute vec3 color;
      varying float vA; varying vec3 vC;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 0.65 + 0.35 * sin(uTime * (1.2 + fract(aS.y) * 2.5) + aS.y);
        vA = tw * smoothstep(0.0, 0.18, normalize(position).y);
        vC = color;
        gl_PointSize = max(1.0, aS.x * uSize * uPR);
      }`,
    fragmentShader: /* glsl */`varying float vA; varying vec3 vC;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vC * a * vA * 1.4, 1.0);
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.renderOrder = -999; pts.name = 'stars';
  return registerUpdater(pts, (dt, t, cam) => { if (cam) pts.position.copy(cam.position); });
}

/** Aurora borealis: several animated curtains on an arc around the camera. */
export function createAurora({ count = 3, distance = 150, height = 70, y = 40, span = 1.6, direction = 0,
  colors = ['#38ff9c', '#2fe0c0', '#b38cff'], intensity = 1, speed = 1, sway = 12, follow = true, seed = 5 } = {}) {
  const group = new THREE.Group(); group.name = 'aurora';
  const r = rand(seed);
  const cA = new THREE.Color(colors[0]), cB = new THREE.Color(colors[1] ?? colors[0]), cC = new THREE.Color(colors[2] ?? colors[1] ?? colors[0]);
  const vert = /* glsl */`uniform float uTime, uR, uSpan, uOff, uH, uY, uSway, uSeed, uSpeed;
    varying vec2 vUv;
    void main(){
      vUv = uv;
      float t = uTime * uSpeed;
      float a = (uv.x - 0.5) * uSpan + uOff;
      float wob = sin(uv.x * 7.0 + t * 0.12 + uSeed) * uSway + sin(uv.x * 19.0 - t * 0.25 + uSeed * 2.0) * uSway * 0.3;
      float rr = uR + wob + uv.y * uH * 0.3;
      vec3 p = vec3(sin(a) * rr, uY + uv.y * uH, -cos(a) * rr);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`;
  const frag = /* glsl */`uniform float uTime, uSeed, uIntensity, uSpeed; uniform vec3 uColA, uColB, uColC;
    varying vec2 vUv;
    float h1(float n){ return fract(sin(n) * 43758.5453123); }
    float n1(float x){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
    void main(){
      float t = uTime * uSpeed;
      float x = vUv.x * 60.0 + uSeed * 13.0;
      float rays = n1(x * 0.7 + t * 0.35) * 0.55 + n1(x * 2.3 - t * 0.6) * 0.3 + n1(x * 6.1 + t * 1.1) * 0.15;
      rays = smoothstep(0.22, 0.95, rays);
      rays *= 0.6 + 0.4 * (0.5 + 0.5 * sin(vUv.x * 40.0 + t * 0.5 + uSeed));
      float edge = 0.04 + 0.12 * n1(vUv.x * 8.0 + t * 0.2 + uSeed);
      float bottom = smoothstep(edge, edge + 0.08, vUv.y);
      float top = 1.0 - smoothstep(0.25, 1.0, vUv.y);
      float side = smoothstep(0.0, 0.18, vUv.x) * (1.0 - smoothstep(0.82, 1.0, vUv.x));
      float pulse = 0.72 + 0.28 * sin(t * 0.4 + uSeed * 3.0);
      vec3 col = mix(uColA, uColB, smoothstep(0.15, 0.6, vUv.y));
      col = mix(col, uColC, smoothstep(0.45, 1.0, vUv.y));
      float edgeGlow = 1.0 + 1.6 * exp(-max(vUv.y - edge, 0.0) * 22.0);
      float a = rays * bottom * top * side * uIntensity * pulse;
      gl_FragColor = vec4(col * edgeGlow * a, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  for (let i = 0; i < count; i++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: SHARED.time, uSpeed: { value: speed }, uSeed: { value: r() * 50 },
        uR: { value: distance + i * 28 + r() * 10 }, uSpan: { value: span * (0.75 + r() * 0.5) },
        uOff: { value: (r() - 0.5) * 1.1 }, uH: { value: height * (0.8 + r() * 0.5) }, uY: { value: y + i * 6 + r() * 8 },
        uSway: { value: sway }, uIntensity: { value: intensity * (i === 0 ? 1.15 : 0.75 + r() * 0.3) },
        uColA: { value: cA }, uColB: { value: cB }, uColC: { value: cC },
      },
      vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 220, 1).translate(0.5, 0.5, 0), mat);
    m.frustumCulled = false; m.renderOrder = -998;
    group.add(m);
  }
  group.rotation.y = direction;
  group.setIntensity = (k) => group.children.forEach((m) => { m.material.uniforms.uIntensity.value = k; });
  return registerUpdater(group, (dt, t, cam) => { if (follow && cam) group.position.set(cam.position.x, 0, cam.position.z); });
}

/* ═════════════════════════════ water / steam / particles ═════════════════════════════ */

/** Animated water surface (lit, fogged, receives shadows). Positioned at y = level. */
export function createWater({ size = 200, width, depth, radius, segments = 128, level = 0, color = 0x4fb6c9,
  deepColor = 0x0d3b4f, waveAmp = 0.12, waveScale = 1, speed = 1, opacity = 0.92, roughness = 0.12,
  glow = 0, reflect = 0.55, sparkle = 0.35 } = {}) {
  let geo;
  if (radius) geo = new THREE.RingGeometry(0.01, radius, 96, Math.max(8, Math.round(segments / 4)));
  else geo = new THREE.PlaneGeometry(width ?? size, depth ?? size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color, roughness, metalness: 0.0, transparent: opacity < 1, opacity, depthWrite: true,
  });
  const U = {
    uTime: SHARED.time, uAmp: { value: waveAmp }, uScale: { value: waveScale }, uSpeed: { value: speed },
    uDeep: { value: new THREE.Color(deepColor) }, uGlow: { value: glow }, uReflect: { value: reflect },
    uSparkle: { value: sparkle }, uSky: SHARED.horizon,
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', /* glsl */`#include <common>
        uniform float uTime, uAmp, uScale, uSpeed; varying vec3 vWPos;
        float wv(vec2 p){ float t = uTime * uSpeed; p *= uScale;
          return sin(p.x * 0.35 + t * 1.1) * 0.5 + sin(p.y * 0.42 - t * 0.9) * 0.35
               + sin((p.x + p.y) * 0.8 + t * 1.7) * 0.18 + sin((p.x * 0.6 - p.y) * 1.7 - t * 2.3) * 0.08; }`)
      .replace('#include <beginnormal_vertex>', /* glsl */`
        vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
        float hC = wv(wp0.xz) * uAmp;
        float hX = wv(wp0.xz + vec2(0.15, 0.0)) * uAmp;
        float hZ = wv(wp0.xz + vec2(0.0, 0.15)) * uAmp;
        vec3 objectNormal = normalize(vec3(-(hX - hC) / 0.15, 1.0, -(hZ - hC) / 0.15));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif`)
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position); transformed.y += hC; vWPos = wp0 + vec3(0.0, hC, 0.0);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uDeep, uSky; uniform float uGlow, uReflect, uSparkle, uTime; varying vec3 vWPos;')
      .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
        { vec3 V = normalize(vViewPosition);
          float fr = pow(1.0 - clamp(dot(V, normal), 0.0, 1.0), 4.0);
          vec3 base = diffuseColor.rgb;
          diffuseColor.rgb = mix(base, uDeep, (1.0 - fr) * 0.45);
          totalEmissiveRadiance += base * uGlow + uSky * fr * uReflect;
          float sp = pow(max(0.0, sin(vWPos.x * 3.1 + uTime * 1.9) * sin(vWPos.z * 2.7 - uTime * 1.6)), 60.0);
          totalEmissiveRadiance += vec3(1.0) * sp * uSparkle * (0.3 + fr); }`);
  };
  mat.customProgramCacheKey = () => 'iceland-water';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = level; mesh.receiveShadow = true; mesh.name = 'water';
  mesh.userData.level = level; mesh.update = () => {};
  return mesh;
}

/** Rising, fading steam puffs (instanced camera-facing billboards). */
export function createSteam({ count = 160, area = 20, radius, center = { x: 0, z: 0 }, y = 0, sources = null, height = 7,
  size = 3.2, color = 0xffffff, opacity = 0.22, speed = 1, spread = 1.6, wind = [0.25, 0.05], seed = 21 } = {}) {
  const r = rand(seed);
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index; geo.setAttribute('position', base.getAttribute('position')); geo.setAttribute('uv', base.getAttribute('uv'));
  const aBase = new Float32Array(count * 3), aSeed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    let x, z, yy = y;
    if (sources && sources.length) {
      const s = sources[Math.floor(r() * sources.length)]; const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (s.r ?? 2);
      x = s.x + Math.cos(a) * d; z = s.z + Math.sin(a) * d; if (s.y !== undefined) yy = s.y;
    } else if (radius) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius; x = center.x + Math.cos(a) * d; z = center.z + Math.sin(a) * d;
    } else {
      const w = Array.isArray(area) ? area[0] : area, dd = Array.isArray(area) ? area[1] : area;
      x = center.x + (r() - 0.5) * w; z = center.z + (r() - 0.5) * dd;
    }
    aBase.set([x, yy, z], i * 3); aSeed.set([r(), 0.6 + r() * 0.8, 0.6 + r() * 0.8, r()], i * 4);
  }
  geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(aBase, 3));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 4));
  geo.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    uniforms: fogUniforms({
      uTime: SHARED.time, uHeight: { value: height }, uSize: { value: size }, uSpeed: { value: speed },
      uSpread: { value: spread }, uWind: { value: new THREE.Vector2(wind[0], wind[1]) },
      uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uMap: { value: softTexture() },
    }),
    vertexShader: /* glsl */`uniform float uTime, uHeight, uSize, uSpeed, uSpread; uniform vec2 uWind;
      attribute vec3 aBase; attribute vec4 aSeed; varying float vA; varying vec2 vUv;
      #include <fog_pars_vertex>
      void main(){
        float life = fract(uTime * uSpeed * 0.07 * aSeed.y + aSeed.x);
        vec3 c = aBase;
        c.y += life * uHeight;
        c.x += sin(uTime * 0.5 + aSeed.x * 6.28) * uSpread * life + uWind.x * life * uHeight;
        c.z += cos(uTime * 0.4 + aSeed.w * 6.28) * uSpread * life + uWind.y * life * uHeight;
        vec4 mvPosition = modelViewMatrix * vec4(c, 1.0);
        float s = uSize * aSeed.z * (0.35 + life * 1.3);
        float rot = aSeed.w * 6.28 + uTime * 0.1 * (aSeed.x - 0.5);
        vec2 q = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * position.xy;
        mvPosition.xy += q * s;
        gl_Position = projectionMatrix * mvPosition;
        vA = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.4, 1.0, life));
        vUv = uv;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`uniform vec3 uColor; uniform float uOpacity; uniform sampler2D uMap;
      varying float vA; varying vec2 vUv;
      #include <fog_pars_fragment>
      void main(){
        float a = texture2D(uMap, vUv).a * vA * uOpacity;
        gl_FragColor = vec4(uColor, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true, depthWrite: false, fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 10; mesh.name = 'steam'; mesh.update = () => {};
  return mesh;
}

/** Generic drifting particles that wrap around the camera (snow by default). */
export function createParticles({ count = 3500, area = 70, height = 34, speed = 1.6, size = 0.11, color = 0xffffff,
  opacity = 0.9, sway = 0.7, rise = false, seed = 31, blending = 'normal' } = {}) {
  const r = rand(seed);
  const pos = new Float32Array(count * 3), aSeed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    pos.set([r() * area, r() * height, r() * area], i * 3);
    aSeed.set([r(), r(), r(), r()], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 4));
  const center = new THREE.Vector3();
  const mat = new THREE.ShaderMaterial({
    uniforms: fogUniforms({
      uTime: SHARED.time, uPx: SHARED.pxScale, uArea: { value: area }, uHeight: { value: height },
      uSpeed: { value: speed }, uSize: { value: size }, uSway: { value: sway }, uDir: { value: rise ? -1 : 1 },
      uCenter: { value: center }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity },
    }),
    vertexShader: /* glsl */`uniform float uTime, uPx, uArea, uHeight, uSpeed, uSize, uSway, uDir; uniform vec3 uCenter;
      attribute vec4 aSeed; varying float vA;
      #include <fog_pars_vertex>
      void main(){
        float t = uTime;
        vec3 p = position;
        p.y -= t * uSpeed * (0.6 + 0.8 * aSeed.x) * uDir;
        p.x += sin(t * 0.7 + aSeed.y * 6.28) * uSway;
        p.z += cos(t * 0.6 + aSeed.z * 6.28) * uSway;
        float hA = uArea * 0.5;
        vec3 o = vec3(uCenter.x - hA, uCenter.y - uHeight * 0.4, uCenter.z - hA);
        vec3 w = o + vec3(mod(p.x - o.x, uArea), mod(p.y - o.y, uHeight), mod(p.z - o.z, uArea));
        vec4 mvPosition = modelViewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = max(1.5, uSize * (0.6 + 0.8 * aSeed.w) * uPx / -mvPosition.z);
        vec3 rel = w - o;
        float edge = min(min(rel.x, uArea - rel.x), min(rel.z, uArea - rel.z)) / (uArea * 0.15);
        float vEdge = min(rel.y, uHeight - rel.y) / (uHeight * 0.1);
        vA = clamp(min(edge, vEdge), 0.0, 1.0);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`uniform vec3 uColor; uniform float uOpacity; varying float vA;
      #include <fog_pars_fragment>
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.1, d) * vA * uOpacity;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true, depthWrite: false, fog: true,
    blending: blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.renderOrder = 20; pts.name = 'particles';
  return registerUpdater(pts, (dt, t, cam) => { if (cam) center.copy(cam.position); });
}

/** Falling snow around the camera. Same options as createParticles. */
export function createSnow(opts = {}) {
  return createParticles(Object.assign({ count: 3500, area: 70, height: 34, speed: 1.6, size: 0.11, sway: 0.7 }, opts));
}

/* ═════════════════════════════ terrain / rocks / basalt / ice ═════════════════════════════ */

const toColor = (c, out) => (c && c.isColor ? out.copy(c) : Array.isArray(c) ? out.setRGB(c[0], c[1], c[2]) : out.set(c));

/** Heightfield terrain mesh built from heightFn (defaults to the world's heightAt). */
export function createTerrain({ size = 200, width, depth, segments = 160, heightFn, color = 0xdfe8ef, colorFn = null,
  roughness = 0.95, metalness = 0, flatShading = false, noiseTint = 0.05, center = { x: 0, z: 0 } } = {}) {
  const hf = heightFn || worldHeight;
  const W = width ?? size, D = depth ?? size;
  const sx = Math.max(2, Math.round(segments * (W / Math.max(W, D)))), sz = Math.max(2, Math.round(segments * (D / Math.max(W, D))));
  const geo = new THREE.PlaneGeometry(W, D, sx, sz);
  geo.rotateX(-Math.PI / 2);
  geo.translate(center.x, 0, center.z);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, hf(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const n = geo.attributes.normal, cols = new Float32Array(p.count * 3);
  const c = new THREE.Color(), base = new THREE.Color(color);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ny = n.getY(i);
    if (colorFn) toColor(colorFn(x, y, z, ny), c);
    else { c.copy(base).multiplyScalar(0.82 + 0.18 * smoothstep(0.55, 0.95, ny)); }
    if (noiseTint) c.multiplyScalar(1 + noise2D(x * 0.15, z * 0.15) * noiseTint);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness, flatShading });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true; mesh.name = 'terrain';
  return mesh;
}

function rockGeometry(seed = 0, detail = 1) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + 0.28 * noise2D(v.x * 1.4 + seed * 3.1 + v.y, v.z * 1.4 - v.y * 0.9 + seed) + 0.1 * noise2D(v.x * 4 + seed, v.z * 4 + v.y * 3);
    v.multiplyScalar(k); p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Scattered low-poly rocks (InstancedMesh). Colliders auto-registered with the world (platforms). */
export function createRocks({ count = 20, radius = 40, center = { x: 0, z: 0 }, minSize = 0.5, maxSize = 2.2, color = 0x3b3f45,
  seed = 7, avoid = [], positions = null, squash = 0.7, sink = 0.25, collide = true, heightFn, roughness = 0.9, snowCap = 0 } = {}) {
  const hf = heightFn || worldHeight;
  const r = rand(seed);
  const list = [];
  const sp = SHARED.world?.spawn;
  const avoidAll = sp ? [...avoid, { x: sp.x, z: sp.z, r: 3.5 }] : avoid;
  if (positions) positions.forEach((q) => list.push({ x: q.x, z: q.z, s: q.s ?? lerp(minSize, maxSize, r()) }));
  else {
    let guard = 0;
    while (list.length < count && guard++ < count * 40) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius;
      const x = center.x + Math.cos(a) * d, z = center.z + Math.sin(a) * d;
      if (avoidAll.some((o) => (x - o.x) ** 2 + (z - o.z) ** 2 < (o.r ?? 2) ** 2)) continue;
      list.push({ x, z, s: lerp(minSize, maxSize, Math.pow(r(), 1.6)) });
    }
  }
  const geo = rockGeometry(seed, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, flatShading: true });
  if (snowCap > 0) {
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vUp;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n#ifdef USE_INSTANCING\nvUp = normalize((modelMatrix * instanceMatrix * vec4(objectNormal, 0.0)).xyz).y;\n#else\nvUp = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz).y;\n#endif');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vUp;')
        .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93,0.96,1.0), smoothstep(${(1 - snowCap).toFixed(2)}, ${(1 - snowCap + 0.15).toFixed(2)}, vUp));`);
    };
    mat.customProgramCacheKey = () => 'rock-snow' + snowCap;
  }
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), t = new THREE.Vector3();
  const base = new THREE.Color(color), c = new THREE.Color();
  const colliders = [];
  list.forEach((it, i) => {
    const y = hf(it.x, it.z);
    e.set((r() - 0.5) * 0.5, r() * Math.PI * 2, (r() - 0.5) * 0.5); q.setFromEuler(e);
    s.set(it.s * (0.8 + r() * 0.5), it.s * squash * (0.7 + r() * 0.5), it.s * (0.8 + r() * 0.5));
    t.set(it.x, y + s.y * (1 - sink) - s.y * 0.35, it.z);
    m4.compose(t, q, s); mesh.setMatrixAt(i, m4);
    c.copy(base).multiplyScalar(0.8 + r() * 0.4); mesh.setColorAt(i, c);
    colliders.push({ x: it.x, z: it.z, r: Math.max(s.x, s.z) * 0.85, top: t.y + s.y * 0.85 });
  });
  mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'rocks';
  mesh.userData.colliders = colliders;
  if (collide && SHARED.world) SHARED.world.addCollider(colliders);
  return mesh;
}

/** Hexagonal basalt columns packed in a circle or rectangle. Every column is a climbable platform. */
export function createBasaltColumns({ center = { x: 0, z: 0 }, x, z, radius = 6, width, depth, colRadius = 0.45, minH = 0.6,
  maxH = 4, heightFn = null, color = 0x2b2d31, seed = 3, rotation = 0, collide = true, groundFn, gap = 0.04 } = {}) {
  const cx = x ?? center.x, cz = z ?? center.z;
  const gf = groundFn || worldHeight;
  const r = rand(seed);
  const R = colRadius, dx = R * Math.sqrt(3), dz = R * 1.5;
  const rect = width !== undefined && depth !== undefined;
  const ext = rect ? Math.max(width, depth) : radius * 2;
  const cells = [];
  const cosR = Math.cos(rotation), sinR = Math.sin(rotation);
  for (let row = -Math.ceil(ext / dz); row <= Math.ceil(ext / dz); row++) {
    for (let col = -Math.ceil(ext / dx); col <= Math.ceil(ext / dx); col++) {
      const lx = col * dx + (row & 1 ? dx / 2 : 0), lz = row * dz;
      let d01;
      if (rect) { if (Math.abs(lx) > width / 2 || Math.abs(lz) > depth / 2) continue; d01 = Math.max(Math.abs(lx) / (width / 2), Math.abs(lz) / (depth / 2)); }
      else { const d = Math.hypot(lx, lz); if (d > radius) continue; d01 = d / radius; }
      let h;
      if (heightFn) h = heightFn(lx, lz, d01, r);
      else {
        const nn = 0.5 + 0.5 * noise2D(lx * 0.35 + seed, lz * 0.35 - seed);
        h = lerp(minH, maxH, clamp(nn * (1 - d01 * 0.55) + (r() - 0.5) * 0.18, 0, 1));
      }
      if (h <= 0.02) continue;
      const wx = cx + lx * cosR + lz * sinR, wz = cz - lx * sinR + lz * cosR;
      cells.push({ x: wx, z: wz, h });
    }
  }
  let geo = new THREE.CylinderGeometry(R * (1 - gap), R * (1 - gap), 1, 6, 1).toNonIndexed();
  geo.translate(0, 0.5, 0); geo.computeVertexNormals();
  const p = geo.attributes.position, n = geo.attributes.normal, vc = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = n.getY(i) > 0.5 ? 1.55 : 0.62 + 0.38 * p.getY(i);
    vc.set([k, k, k], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(vc, 3));
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.82, metalness: 0.05, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, cells.length));
  mesh.count = cells.length;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
  const s = new THREE.Vector3(), t = new THREE.Vector3(), base = new THREE.Color(color), c = new THREE.Color();
  const colliders = [];
  cells.forEach((cl, i) => {
    const g = gf(cl.x, cl.z) - 0.3;
    t.set(cl.x, g, cl.z); s.set(1, cl.h + 0.3, 1);
    m4.compose(t, q, s); mesh.setMatrixAt(i, m4);
    c.copy(base).multiplyScalar(0.85 + r() * 0.3); mesh.setColorAt(i, c);
    colliders.push({ x: cl.x, z: cl.z, r: R * 0.92, top: g + cl.h + 0.3 });
  });
  mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'basalt';
  mesh.userData.colliders = colliders;
  if (collide && SHARED.world) SHARED.world.addCollider(colliders);
  return mesh;
}

/** Glossy faceted ice chunk / iceberg. Scale/position it yourself. */
export function createIce({ size = 2, seed = 1, color = 0xbfeaff, stretch = [1, 0.75, 1], detail = 1, emissive = 0x0b4a6a,
  emissiveIntensity = 0.45, opacity = 1, roughness = 0.12 } = {}) {
  const geo = rockGeometry(seed + 100, detail);
  geo.scale(stretch[0] * size, stretch[1] * size, stretch[2] * size);
  geo.computeVertexNormals();
  const mat = new THREE.MeshPhysicalMaterial({
    color, roughness, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, emissive, emissiveIntensity,
    flatShading: true, transparent: opacity < 1, opacity, sheen: 0.4, sheenColor: new THREE.Color(0xdff7ff),
  });
  addRim(mat, 0xbff4ff, 0.55, 2.2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'ice';
  return mesh;
}

/** Waterfall: scrolling streaked sheet + foam pool + mist. */
export function createWaterfall({ x = 0, z = 0, top = 10, bottom = 0, width = 4, color = 0xeaf6ff, rotation = 0,
  speed = 1, mist = true, curve = 0.6 } = {}) {
  const g = new THREE.Group(); g.position.set(x, bottom, z); g.rotation.y = rotation; g.name = 'waterfall';
  const H = top - bottom;
  const geo = new THREE.PlaneGeometry(width, H, 8, 24);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const yy = p.getY(i) / H + 0.5; p.setZ(i, Math.pow(1 - yy, 2) * curve * 2); p.setY(i, p.getY(i) + H / 2); }
  const mat = new THREE.ShaderMaterial({
    uniforms: fogUniforms({ uTime: SHARED.time, uSpeed: { value: speed }, uColor: { value: new THREE.Color(color) }, uH: { value: H } }),
    vertexShader: /* glsl */`varying vec2 vUv;
      #include <fog_pars_vertex>
      void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`uniform float uTime, uSpeed, uH; uniform vec3 uColor; varying vec2 vUv;
      #include <fog_pars_fragment>
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        float t = uTime * uSpeed;
        vec2 q = vec2(vUv.x * 18.0, vUv.y * uH * 0.35 + t * 2.4);
        float s = n(q) * 0.6 + n(q * vec2(2.3, 1.7) + 3.0) * 0.4;
        float streak = smoothstep(0.35, 0.85, s);
        float side = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
        float a = (0.45 + 0.55 * streak) * side * smoothstep(1.0, 0.96, vUv.y);
        gl_FragColor = vec4(uColor * (0.85 + 0.35 * streak), a * 0.92);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
  });
  const sheet = new THREE.Mesh(geo, mat); sheet.renderOrder = 5; g.add(sheet);
  const foam = createWater({ radius: width * 1.3, level: 0.05, color: 0xdff3ff, deepColor: 0x6fa9c4, waveAmp: 0.06, waveScale: 4, speed: 3, opacity: 0.85, glow: 0.25 });
  foam.position.z = curve * 2; g.add(foam);
  if (mist) {
    const m = createSteam({ count: 70, sources: [{ x: 0, z: curve * 2, r: width * 0.6 }], height: H * 0.45, size: width * 0.9, opacity: 0.28, speed: 2.2, spread: 1.2, wind: [0, 0.15] });
    g.add(m);
  }
  g.update = () => {};
  return g;
}

/** Additive soft glow sprite (lamps, magic orbs, distant lights). */
export function createGlow({ color = 0xffd9a0, size = 2, opacity = 0.9 } = {}) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTexture(), color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(size); s.name = 'glow';
  return s;
}

/* ═════════════════════════════ the traveler (player character) ═════════════════════════════ */
const DEFAULT_LOOK = {
  sweater: '#c8303c', yoke: '#f5eddc', pattern: '#23335e', beanie: '#f2b636', pom: '#fff6e6',
  pants: '#2b3552', boots: '#5a3a26', skin: '#f6cfb0', hair: '#5b3a26', pack: '#2f7f86', roll: '#c4552d',
};

function sweaterTexture(c) {
  const W = 512, H = 512, P = 32;                      // 16 pattern repeats around the body
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = c.sweater; g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.09; g.strokeStyle = '#000'; g.lineWidth = 1.5;   // knit stitches
  for (let y = 0; y < H; y += 7) for (let x = 0; x < W; x += 8) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 4, y + 5); g.lineTo(x + 8, y); g.stroke(); }
  g.globalAlpha = 1;
  // canvas top = neck (v = 1). Yoke band:
  g.fillStyle = c.yoke; g.fillRect(0, 0, W, H * 0.36);
  g.fillStyle = c.pattern;                                            // navy zigzag
  for (let x = 0; x < W; x += P) { g.beginPath(); g.moveTo(x, H * 0.07); g.lineTo(x + P, H * 0.07); g.lineTo(x + P / 2, H * 0.14); g.fill(); }
  g.fillRect(0, H * 0.055, W, H * 0.018);
  g.fillStyle = c.sweater;                                            // red diamonds
  for (let x = 0; x < W; x += P) { const cx = x + P / 2, cy = H * 0.215; g.beginPath(); g.moveTo(cx, cy - H * 0.05); g.lineTo(cx + P * 0.36, cy); g.lineTo(cx, cy + H * 0.05); g.lineTo(cx - P * 0.36, cy); g.fill(); }
  g.fillStyle = c.yoke;
  for (let x = 0; x < W; x += P) { g.beginPath(); g.arc(x + P / 2, H * 0.215, P * 0.09, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = c.pattern;
  for (let x = 0; x < W; x += P) { g.beginPath(); g.arc(x, H * 0.215, P * 0.1, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = c.sweater;                                            // jagged lower edge
  for (let x = 0; x < W; x += P / 2) { g.beginPath(); g.moveTo(x, H * 0.365); g.lineTo(x + P / 2, H * 0.365); g.lineTo(x + P / 4, H * 0.3); g.fill(); }
  g.fillStyle = c.yoke;                                               // dotted line + hem
  for (let x = 0; x < W; x += P / 2) g.fillRect(x + P / 4 - 3, H * 0.41, 6, 6);
  g.fillRect(0, H * 0.88, W, H * 0.035); g.fillRect(0, H * 0.95, W, H * 0.05);
  g.fillStyle = c.pattern;
  for (let x = 0; x < W; x += P / 2) g.fillRect(x + P / 4 - 3, H * 0.893, 6, 6);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function ribTexture(color) {
  const cv = document.createElement('canvas'); cv.width = 16; cv.height = 4;
  const g = cv.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 16, 4);
  g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, 0, 5, 4);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(28, 1);
  return t;
}

/** Builds the stylized traveler. Returns { root, update(dt, t, state), wave() }. Origin = feet. */
function createTraveler(colors = {}) {
  const c = Object.assign({}, DEFAULT_LOOK, colors);
  const M = (color, extra = {}) => addRim(new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.82 }, extra)), 0xcfe9ff, 0.28, 2.6);
  const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m; };

  const root = new THREE.Group(); root.name = 'player';
  const rig = new THREE.Group(); root.add(rig);

  // legs
  const hipY = 0.43, mPants = M(c.pants), mBoot = M(c.boots, { roughness: 0.6 });
  const legs = [-1, 1].map((s) => {
    const g = new THREE.Group(); g.position.set(0.14 * s, hipY, 0);
    g.add(mesh(new THREE.CapsuleGeometry(0.105, 0.16, 4, 12), mPants, 0, -0.16, 0));
    const boot = mesh(new THREE.SphereGeometry(0.135, 18, 12), mBoot, 0, -0.34, 0.035); boot.scale.set(1, 0.72, 1.35); g.add(boot);
    rig.add(g); return g;
  });

  // torso (lathe, evenly spaced so the sweater texture maps cleanly)
  const prof = new THREE.SplineCurve([[0, 0], [0.26, 0.01], [0.355, 0.07], [0.385, 0.2], [0.39, 0.35], [0.37, 0.5], [0.33, 0.6], [0.25, 0.67], [0.15, 0.7]]
    .map(([x, y]) => new THREE.Vector2(x, y)));
  const torsoGeo = new THREE.LatheGeometry(prof.getSpacedPoints(48), 40);
  const torso = mesh(torsoGeo, M(0xffffff, { map: sweaterTexture(c), roughness: 0.95 }), 0, 0.32, 0);
  rig.add(torso);
  const collar = mesh(new THREE.TorusGeometry(0.15, 0.045, 10, 28), M(c.yoke, { roughness: 1 }), 0, 1.0, 0);
  collar.rotation.x = Math.PI / 2; rig.add(collar);

  // arms
  const mSleeve = M(c.sweater, { roughness: 0.95 }), mCuff = M(c.yoke, { roughness: 1 }), mMitt = M(c.beanie);
  const arms = [-1, 1].map((s) => {
    const g = new THREE.Group(); g.position.set(0.34 * s, 0.86, 0);
    g.add(mesh(new THREE.CapsuleGeometry(0.085, 0.24, 4, 12), mSleeve, 0, -0.18, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.096, 0.096, 0.06, 16), mCuff, 0, -0.33, 0));
    g.add(mesh(new THREE.SphereGeometry(0.1, 16, 12), mMitt, 0, -0.42, 0.01));
    g.rotation.z = 0.16 * s; rig.add(g); return g;
  });

  // backpack
  const pack = new THREE.Group(); pack.position.set(0, 0.7, -0.43); rig.add(pack);
  const mPack = M(c.pack, { roughness: 0.75 }), mPackD = M(new THREE.Color(c.pack).multiplyScalar(0.72), { roughness: 0.75 });
  pack.add(mesh(new RoundedBoxGeometry(0.5, 0.56, 0.22, 3, 0.07), mPack));
  pack.add(mesh(new RoundedBoxGeometry(0.53, 0.2, 0.25, 2, 0.06), mPackD, 0, 0.2, -0.005));
  pack.add(mesh(new RoundedBoxGeometry(0.32, 0.2, 0.08, 2, 0.03), mPackD, 0, -0.1, -0.13));
  const roll = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.6, 18), M(c.roll, { roughness: 0.9 }), 0, 0.37, 0.02);
  roll.rotation.z = Math.PI / 2; pack.add(roll);
  [-0.15, 0.15].forEach((x) => pack.add(mesh(new THREE.BoxGeometry(0.05, 0.08, 0.02), mCuff, x, 0.14, -0.13)));

  // head
  const head = new THREE.Group(); head.position.set(0, 1.0, 0); rig.add(head);
  const mSkin = M(c.skin, { roughness: 0.7 });
  const skull = mesh(new THREE.SphereGeometry(0.34, 32, 24), mSkin, 0, 0.31, 0); skull.scale.set(1, 0.94, 0.96); head.add(skull);
  const hair = mesh(new THREE.SphereGeometry(0.352, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.6), M(c.hair, { roughness: 0.9 }), 0, 0.31, -0.01);
  hair.rotation.x = -0.55; head.add(hair);
  const mEye = new THREE.MeshStandardMaterial({ color: 0x1a1412, roughness: 0.3 });
  const mWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyes = [-1, 1].map((s) => {
    const e = mesh(new THREE.SphereGeometry(0.046, 16, 12), mEye, 0.12 * s, 0.3, 0.3); e.scale.set(0.85, 1.15, 0.55); e.castShadow = false;
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), mWhite); hl.position.set(0.012, 0.016, 0.036); e.add(hl);
    head.add(e); return e;
  });
  const mBlush = new THREE.MeshBasicMaterial({ color: 0xff8a95, transparent: true, opacity: 0.45, depthWrite: false });
  [-1, 1].forEach((s) => {
    const b = new THREE.Mesh(new THREE.CircleGeometry(0.052, 20), mBlush);
    const dir = new THREE.Vector3(0.2 * s, -0.09, 0.27).normalize();
    b.position.copy(dir).multiplyScalar(0.337).add(new THREE.Vector3(0, 0.31, 0));
    b.lookAt(b.position.clone().add(dir)); head.add(b);
  });
  head.add(mesh(new THREE.SphereGeometry(0.03, 10, 8), M(new THREE.Color(c.skin).multiplyScalar(0.92)), 0, 0.255, 0.335));
  const smile = mesh(new THREE.TorusGeometry(0.045, 0.011, 6, 16, Math.PI), mEye, 0, 0.2, 0.315);
  smile.rotation.z = Math.PI; smile.rotation.x = -0.25; smile.castShadow = false; head.add(smile);

  // beanie + pom-pom
  const beanie = new THREE.Group(); beanie.position.set(0, 0.31, 0); beanie.rotation.x = -0.16; head.add(beanie);
  const dome = mesh(new THREE.SphereGeometry(0.37, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), M(0xffffff, { map: ribTexture(c.beanie), roughness: 0.95 }), 0, 0.05, 0);
  dome.scale.set(1, 1.12, 1); beanie.add(dome);
  const cuff = mesh(new THREE.TorusGeometry(0.355, 0.075, 12, 40), M(new THREE.Color(c.beanie).multiplyScalar(0.85), { roughness: 1 }), 0, 0.06, 0);
  cuff.rotation.x = Math.PI / 2; cuff.scale.set(1, 1, 0.95); beanie.add(cuff);
  const pomG = new THREE.Group(); pomG.position.set(0, 0.47, 0); beanie.add(pomG);
  pomG.add(mesh(new THREE.IcosahedronGeometry(0.115, 1), M(c.pom, { roughness: 1, flatShading: true }), 0, 0.06, 0));

  // blob contact shadow (soft, always under the feet)
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: softTexture(), color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  blob.renderOrder = 2; root.add(blob);

  // ── animation state ──
  const A = { phase: 0, blinkT: 2.5, blink: 0, sq: 1, sqV: 0, pomY: 0, pomV: 0, tilt: 0, tiltV: 0, wave: 0, idle: 0, look: 0, lastSpeed: 0 };
  const L = (obj, key, target, k) => { obj[key] += (target - obj[key]) * k; };

  function update(dt, t, st) {
    const k = 1 - Math.exp(-14 * dt);
    const m = clamp(st.speed / 4.4, 0, 2);
    const amp = Math.min(m, 1.25);
    if (m > 0.04) A.phase += dt * (5.2 + st.speed * 1.25);
    const sw = Math.sin(A.phase), breath = Math.sin(t * 2.4);
    A.idle = m < 0.05 && st.onGround ? A.idle + dt : 0;
    A.look = A.idle > 4 ? Math.sin((A.idle - 4) * 0.7) * 0.5 : 0;
    A.wave = Math.max(0, A.wave - dt);

    let lL = sw * 0.8 * amp, lR = -sw * 0.8 * amp, aLx = -sw * 0.75 * amp, aRx = sw * 0.75 * amp;
    let aLz = -(0.16 + breath * 0.02), aRz = 0.16 + breath * 0.02, lean = 0.05 * amp + (st.run ? 0.12 : 0) * amp, bob = (1 - Math.abs(sw)) * 0.055 * amp;
    if (st.inWater) { aLz -= 0.45; aRz += 0.45; aLx *= 0.5; aRx *= 0.5; lean *= 0.5; bob += Math.sin(t * 2.2) * 0.02; }
    if (!st.onGround) { lL = -0.6; lR = 0.35; aLx = -0.35; aRx = -0.35; aLz = -1.2; aRz = 1.2; lean = -0.04; bob = 0; }
    let headZ = 0;
    if (A.wave > 0 && m < 0.2 && st.onGround) { aRz = 2.65 + Math.sin(t * 13) * 0.28; aRx = -0.1; headZ = 0.12; }

    L(legs[0].rotation, 'x', lL, k); L(legs[1].rotation, 'x', lR, k);
    L(arms[0].rotation, 'x', aLx, k); L(arms[1].rotation, 'x', aRx, k);
    L(arms[0].rotation, 'z', aLz, k); L(arms[1].rotation, 'z', aRz, k);
    L(rig.rotation, 'x', lean, k); L(rig.rotation, 'y', sw * 0.07 * amp, k);
    L(head.rotation, 'y', -sw * 0.05 * amp + A.look, k * 0.5); L(head.rotation, 'z', headZ, k * 0.5);
    L(head.rotation, 'x', -lean * 0.6, k);
    rig.position.y += (bob - rig.position.y) * k;
    const br = m < 0.05 ? breath : 0;
    torso.scale.set(1 + br * 0.012, 1 + br * 0.02, 1 + br * 0.012);

    // squash & stretch spring
    if (st.jumped) A.sqV += 3.2;
    if (st.landed) { A.sqV -= clamp(st.landed * 0.28, 1.2, 4.5); A.pomV -= clamp(st.landed * 0.2, 0.6, 3); }
    A.sqV += ((1 - A.sq) * 190 - A.sqV * 13) * dt; A.sq = clamp(A.sq + A.sqV * dt, 0.68, 1.3);
    const inv = 1 / Math.sqrt(A.sq); rig.scale.set(inv, A.sq, inv);

    // pom-pom bounce + beanie tilt from acceleration
    const acc = (st.speed - A.lastSpeed) / Math.max(dt, 1e-3); A.lastSpeed = st.speed;
    A.pomV += (-A.pomY * 220 - A.pomV * 9) * dt + (st.jumped ? -2 : 0); A.pomY += A.pomV * dt;
    pomG.position.y = 0.47 + clamp(A.pomY, -0.08, 0.08); pomG.scale.y = 1 - clamp(A.pomY, -0.08, 0.08) * 2;
    A.tiltV += ((clamp(-acc * 0.012, -0.3, 0.3) - m * 0.06 - A.tilt) * 120 - A.tiltV * 9) * dt; A.tilt += A.tiltV * dt;
    beanie.rotation.x = -0.16 + A.tilt;

    // blink
    A.blinkT -= dt; if (A.blinkT <= 0) { A.blink = 0.14; A.blinkT = 2 + Math.random() * 3.5; }
    A.blink = Math.max(0, A.blink - dt);
    const ey = A.blink > 0 ? 0.12 : 1.15; eyes.forEach((e) => { e.scale.y += (ey - e.scale.y) * Math.min(1, dt * 40); });

    // contact shadow sticks to the ground
    const hgt = Math.max(0, st.heightAboveGround || 0);
    blob.position.y = -hgt + 0.03;
    const bs = clamp(1 - hgt * 0.25, 0.4, 1); blob.scale.set(bs, 1, bs); blob.material.opacity = 0.38 * bs;
  }
  return { root, update, wave: (d = 1.8) => { A.wave = d; } };
}

/* ═════════════════════════════ HUD (DOM, styled by world.css) ═════════════════════════════ */
const isTouch = () => (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }

const TIPS = ['按住 Shift 可以奔跑', '空白鍵跳躍，可以跳上石頭', '拖曳畫面旋轉視角', '試試「📷 拍照模式」', '靠近發光的光點，會有小故事'];

function buildHUD(o) {
  const body = document.body;
  body.classList.add('w-body');
  if (isTouch()) body.classList.add('w-touch');
  let loading = document.querySelector('.w-loading');
  if (!loading) { loading = el('div', 'w-loading'); body.appendChild(loading); }
  const tip = isTouch() ? '左下角搖桿移動，右下角按鈕跳躍' : TIPS[Math.floor(Math.random() * TIPS.length)];
  loading.innerHTML = `<div class="w-loading-inner"><div class="w-kicker">ICELAND · 3D WORLD</div>
    <h1 class="w-loading-title">${esc(o.title)}</h1><p class="w-loading-sub">${esc(o.subtitle)}</p>
    <div class="w-bar"><i></i></div><p class="w-loading-tip">${esc(tip)}</p></div>`;

  const hud = el('div', 'w-hud');
  hud.innerHTML = `
    <div class="w-title glass"><div class="w-kicker">3D 虛擬空間</div><h1>${esc(o.title)}</h1>${o.subtitle ? `<p>${esc(o.subtitle)}</p>` : ''}</div>
    <div class="w-actions">
      <a class="w-btn glass" href="${esc(o.backHref)}">← 回到行程</a>
      <button class="w-btn glass" type="button" data-act="photo">📷 拍照模式</button>
    </div>
    <div class="w-hints"></div>
    <div class="w-info glass" aria-live="polite"><div class="w-info-img"></div>
      <div class="w-info-body"><div class="w-kicker">你發現了</div><h3></h3><p></p></div></div>
    <div class="w-toast glass"></div>
    <div class="w-joy" aria-hidden="true"><div class="w-joy-knob"></div></div>
    <button class="w-jump glass" type="button" aria-label="跳躍">跳</button>`;
  body.appendChild(hud);
  body.appendChild(el('div', 'w-vignette'));
  const photoBar = el('div', 'w-photobar', `<button class="w-shutter" type="button" aria-label="拍照存檔"></button>
    <button class="w-btn glass" type="button" data-act="exit-photo">結束拍照</button>`);
  body.appendChild(photoBar);
  const flash = el('div', 'w-flash'); body.appendChild(flash);

  const hintsEl = hud.querySelector('.w-hints');
  const ctrl = isTouch()
    ? [['搖桿', '移動'], ['拖曳', '轉視角'], ['雙指', '縮放']]
    : [['WASD', '移動'], ['Shift', '奔跑'], ['空白鍵', '跳躍'], ['拖曳', '轉視角'], ['滾輪', '縮放']];
  ctrl.forEach(([k, label]) => hintsEl.appendChild(el('span', 'w-chip glass', `<kbd>${esc(k)}</kbd>${esc(label)}`)));
  (o.hints || []).forEach((h) => hintsEl.appendChild(el('span', 'w-chip w-chip-world glass', `<i></i>${esc(h)}`)));

  const bar = loading.querySelector('.w-bar i');
  const info = hud.querySelector('.w-info'), infoImg = info.querySelector('.w-info-img');
  const toastEl = hud.querySelector('.w-toast');
  let toastTimer = 0, hintsHidden = false, current = null;

  const api = {
    hud, loading, photoBar,
    joy: hud.querySelector('.w-joy'), knob: hud.querySelector('.w-joy-knob'), jump: hud.querySelector('.w-jump'),
    photoBtn: hud.querySelector('[data-act="photo"]'), exitBtn: photoBar.querySelector('[data-act="exit-photo"]'),
    shutter: photoBar.querySelector('.w-shutter'),
    setProgress(p) { bar.style.transform = `scaleX(${clamp(p, 0, 1)})`; },
    hideLoading() {
      api.setProgress(1);
      setTimeout(() => { loading.classList.add('w-done'); body.classList.add('w-ready'); }, 380);
      setTimeout(() => loading.remove(), 1700);
    },
    hideHints() { if (hintsHidden) return; hintsHidden = true; hintsEl.classList.add('w-hide'); },
    showInfo(z) {
      if (z === current) return; current = z;
      if (!z) { info.classList.remove('w-show'); return; }
      info.querySelector('h3').textContent = z.title || '';
      info.querySelector('p').textContent = z.text || '';
      info.querySelector('.w-kicker').textContent = z.kicker || '你發現了';
      if (z.img) { infoImg.style.backgroundImage = `url("${z.img}")`; info.classList.add('w-has-img'); } else info.classList.remove('w-has-img');
      info.classList.remove('w-show'); void info.offsetWidth; info.classList.add('w-show');
    },
    toast(text, ms = 2200) {
      toastEl.textContent = text; toastEl.classList.add('w-show');
      clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('w-show'), ms);
    },
    setPhoto(on) { body.classList.toggle('w-photo', on); },
    flash() { flash.classList.remove('w-go'); void flash.offsetWidth; flash.classList.add('w-go'); },
  };
  return api;
}

/* ═════════════════════════════ createWorld ═════════════════════════════ */
const TOD = {
  day: { bg: 0x8fb3c9, hemi: [0xdcecff, 0x7a6a5c, 1.15], sun: [0xfff1dc, 2.7, [0.55, 0.75, 0.35]], top: 0x3d74b8, exposure: 1.0, glow: 0.35, moon: false },
  dusk: { bg: 0xd59a86, hemi: [0xffc9a8, 0x3a2f45, 0.85], sun: [0xffa36b, 2.4, [-0.75, 0.22, -0.45]], top: 0x27365f, exposure: 1.05, glow: 0.9, moon: false },
  night: { bg: 0x0a1424, hemi: [0x5d7fbf, 0x0a0e18, 0.6], sun: [0xaecbff, 0.95, [0.35, 0.7, -0.6]], top: 0x01030a, exposure: 1.2, glow: 0.18, moon: true },
};
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const lerpAngle = (a, b, t) => a + wrapA(b - a) * t;

/**
 * Creates the renderer, scene, lights, sky, HUD, player and controls.
 * See the big comment at the top of this file for every option.
 * @returns {Promise<object>} World API
 */
export async function createWorld(opts = {}) {
  const tod = TOD[opts.timeOfDay] ? opts.timeOfDay : 'day';
  const P = TOD[tod];
  const o = Object.assign({
    title: '冰島', subtitle: '', backHref: '../index.html#worlds', background: P.bg, boundsRadius: 80,
    boundsCenter: { x: 0, z: 0 }, heightAt: () => 0, hints: [], info: [], shadows: true, bloom: null,
  }, opts);
  o.timeOfDay = tod;
  o.spawn = Object.assign({ x: 0, z: 0, yaw: Math.PI }, opts.spawn);
  o.camera = Object.assign({ distance: 7.5, minDistance: 3, maxDistance: 16, pitch: 0.32, fov: 50, intro: true }, opts.camera);
  o.player = Object.assign({ walk: 4.4, run: 8.4, jump: 8.6, light: tod === 'night' }, opts.player);
  o.water = opts.water ? Object.assign({ level: 0, slow: 0.55, maxDepth: 0.85 }, opts.water) : null;

  const hud = buildHUD(o);
  hud.setProgress(0.12);

  // renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = o.exposure ?? P.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = !!o.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'w-canvas';
  document.body.prepend(renderer.domElement);
  const canvas = renderer.domElement;

  // scene / fog / camera
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(o.background);
  let fogColor = new THREE.Color(o.background);
  if (o.fog !== false) {
    const f = Object.assign({ color: o.background, near: 40, far: tod === 'night' ? 320 : 260 }, o.fog || {});
    fogColor = new THREE.Color(f.color);
    scene.fog = f.density ? new THREE.FogExp2(f.color, f.density) : new THREE.Fog(f.color, f.near, f.far);
  }
  SHARED.horizon.value.copy(fogColor);
  const camera = new THREE.PerspectiveCamera(o.camera.fov, window.innerWidth / window.innerHeight, 0.1, 5000);

  // lights
  const hc = Object.assign({ sky: P.hemi[0], ground: P.hemi[1], intensity: P.hemi[2] }, o.hemi);
  const hemi = new THREE.HemisphereLight(hc.sky, hc.ground, hc.intensity); scene.add(hemi);
  const sc = Object.assign({ color: P.sun[0], intensity: P.sun[1], dir: P.sun[2] }, o.sun);
  const sunDir = new THREE.Vector3(...sc.dir).normalize();
  const sun = new THREE.DirectionalLight(sc.color, sc.intensity);
  sun.castShadow = !!o.shadows;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 220 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.035;
  scene.add(sun, sun.target);
  if (tod === 'night') { const fill = new THREE.DirectionalLight(0x58ffb0, 0.22); fill.position.set(0, 60, -100); scene.add(fill); }

  // sky dome
  let sky = null;
  if (o.sky !== false) {
    const s = Object.assign({ top: P.top, horizon: fogColor, bottom: null, sunColor: sc.color, glow: P.glow, moon: P.moon }, o.sky || {});
    sky = createSky({ top: s.top, horizon: s.horizon, bottom: s.bottom, sunDir, sunColor: s.sunColor, glow: s.glow, moon: s.moon });
    scene.add(sky);
  }

  // player
  const traveler = createTraveler(o.player.colors);
  const player = traveler.root;
  player.position.set(o.spawn.x, o.heightAt(o.spawn.x, o.spawn.z), o.spawn.z);
  player.rotation.y = o.spawn.yaw;
  player.velocity = new THREE.Vector3(); player.onGround = true; player.inWater = false; player.speed = 0;
  scene.add(player);
  if (o.player.light) {
    const lamp = new THREE.PointLight(0xffd6a8, 5, 10, 2); lamp.position.set(0, 2.4, 0.8); player.add(lamp);
  }

  // colliders & ground
  const colliders = [], colliderSet = new Set();
  const STEP = 0.5, PR = 0.36;
  function addCollider(x) {
    if (!x) return x;
    if (Array.isArray(x)) { x.forEach(addCollider); return x; }
    if (x.isObject3D) {
      if (x.userData && x.userData.colliders) { addCollider(x.userData.colliders); return x; }
      x.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(x), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      const col = { x: c.x, z: c.z, r: (Math.max(s.x, s.z) / 2) * 0.85, top: box.max.y };
      colliders.push(col); colliderSet.add(col); x.userData.collider = col; return x;
    }
    if (typeof x.x === 'number' && typeof x.z === 'number' && !colliderSet.has(x)) {
      if (x.r === undefined) x.r = 1;
      colliders.push(x); colliderSet.add(x);
    }
    return x;
  }
  function groundAt(x, z, fromY = Infinity) {
    let g = o.heightAt(x, z);
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (c.top === undefined || c.top <= g || c.top > fromY + STEP) continue;
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz < c.r * c.r) g = c.top;
    }
    return g;
  }

  // info zones + markers
  const zones = [], markers = [];
  function addInfo(z) {
    if (!z || !z.at) return z;
    z.radius = z.radius ?? 4; zones.push(z);
    if (z.marker !== false) {
      const g = new THREE.Group(); g.position.set(z.at.x, o.heightAt(z.at.x, z.at.z), z.at.z);
      const glow = createGlow({ color: 0x9ff3ff, size: 1.8, opacity: 0.85 });
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 56).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x9ff3ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.position.y = 0.06; g.add(glow, core, ring); scene.add(g);
      markers.push({ g, glow, core, ring, seed: Math.random() * 10, zone: z });
    }
    return z;
  }
  (o.info || []).forEach(addInfo);

  // water ripples pool
  const ripples = [];
  if (o.water) {
    const rg = new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false; m.renderOrder = 6; scene.add(m); ripples.push({ m, life: 1 });
    }
  }

  SHARED.world = { heightAt: (x, z) => o.heightAt(x, z), spawn: o.spawn, addCollider, camera };
  hud.setProgress(0.35);

  // optional bloom
  let composer = null, bloomPass = null;
  if (o.bloom) {
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/UnrealBloomPass.js'), import('three/addons/postprocessing/OutputPass.js')]);
      const b = Object.assign({ strength: 0.6, radius: 0.6, threshold: 0.8 }, o.bloom === true ? {} : o.bloom);
      const pr = renderer.getPixelRatio();
      const rt = new THREE.WebGLRenderTarget(window.innerWidth * pr, window.innerHeight * pr, { type: THREE.HalfFloatType, samples: 4 });
      composer = new EffectComposer(renderer, rt);
      composer.setPixelRatio(pr); composer.setSize(window.innerWidth, window.innerHeight);
      composer.addPass(new RenderPass(scene, camera));
      bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), b.strength, b.radius, b.threshold);
      composer.addPass(bloomPass);
      composer.addPass(new OutputPass());
    } catch (err) { console.warn('[engine] bloom unavailable', err); composer = null; bloomPass = null; }
  }
  hud.setProgress(0.6);

  // ── input ──
  const keys = new Set();
  const MOVE = { KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
  const inp = { joyX: 0, joyY: 0, joyOn: false, jumpQ: 0 };
  let started = false, firstInputDone = false, photo = false, captureQ = false, elapsed = 0, introT0 = -1;
  const firstInput = () => {
    if (!started || firstInputDone) return;
    firstInputDone = true; setTimeout(() => hud.hideHints(), 1400);
  };
  function togglePhoto(v) { photo = v ?? !photo; hud.setPhoto(photo); if (photo) hud.hideHints(); }
  window.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (MOVE[e.code] || e.code === 'Space') e.preventDefault();
    if (e.code === 'Space' && !e.repeat) inp.jumpQ = 0.18;
    if (e.code === 'KeyP' && !e.repeat) togglePhoto();
    if (e.code === 'Escape' && photo) togglePhoto(false);
    if (e.code === 'KeyR' && !e.repeat) { teleport(o.spawn.x, o.spawn.z, o.spawn.yaw); hud.toast('回到起點'); }
    keys.add(e.code); firstInput();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  const PMIN = -0.35, PMAX = 1.3;
  const cam = { yaw: o.spawn.yaw + Math.PI, pitch: o.camera.pitch, dist: o.camera.distance, lastDrag: -10 };
  cam.tYaw = cam.yaw; cam.tPitch = cam.pitch; cam.tDist = cam.dist;
  const ptrs = new Map(); let pinch0 = 0;
  const pdist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) pinch0 = pdist();
    canvas.classList.add('w-grabbing'); firstInput();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    if (ptrs.size === 1) {
      const s = e.pointerType === 'touch' ? 0.0075 : 0.0055;
      cam.tYaw -= (e.clientX - p.x) * s;
      cam.tPitch = clamp(cam.tPitch + (e.clientY - p.y) * s * 0.8, PMIN, PMAX);
      cam.lastDrag = elapsed;
    }
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 2) { const d = pdist(); if (pinch0 > 0 && d > 0) cam.tDist = clamp(cam.tDist * pinch0 / d, o.camera.minDistance, o.camera.maxDistance); pinch0 = d; }
  });
  const ptrUp = (e) => { ptrs.delete(e.pointerId); pinch0 = ptrs.size === 2 ? pdist() : 0; if (!ptrs.size) canvas.classList.remove('w-grabbing'); };
  canvas.addEventListener('pointerup', ptrUp); canvas.addEventListener('pointercancel', ptrUp);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.tDist = clamp(cam.tDist * Math.exp(e.deltaY * 0.0012), o.camera.minDistance, o.camera.maxDistance);
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // virtual joystick + jump button
  let joyId = null;
  const joyMove = (e) => {
    const r = hud.joy.getBoundingClientRect(), max = r.width * 0.36;
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy); if (d > max) { dx *= max / d; dy *= max / d; }
    hud.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    inp.joyX = dx / max; inp.joyY = -dy / max;
  };
  hud.joy.addEventListener('pointerdown', (e) => {
    e.preventDefault(); joyId = e.pointerId; hud.joy.setPointerCapture(e.pointerId);
    inp.joyOn = true; hud.joy.classList.add('w-active'); joyMove(e); firstInput();
  });
  hud.joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) joyMove(e); });
  const joyEnd = (e) => {
    if (e.pointerId !== joyId) return;
    joyId = null; inp.joyOn = false; inp.joyX = inp.joyY = 0; hud.knob.style.transform = ''; hud.joy.classList.remove('w-active');
  };
  hud.joy.addEventListener('pointerup', joyEnd); hud.joy.addEventListener('pointercancel', joyEnd);
  hud.jump.addEventListener('pointerdown', (e) => { e.preventDefault(); inp.jumpQ = 0.18; firstInput(); });
  hud.photoBtn.addEventListener('click', () => { hud.photoBtn.blur(); togglePhoto(true); });
  hud.exitBtn.addEventListener('click', () => { hud.exitBtn.blur(); togglePhoto(false); });
  hud.shutter.addEventListener('click', () => { hud.shutter.blur(); captureQ = true; });

  // ── physics / camera state ──
  const vel = player.velocity;
  let coyote = 0, rippleT = 0, faceTarget = player.rotation.y;
  const camTarget = new THREE.Vector3(player.position.x, player.position.y + 1.25, player.position.z);
  function teleport(x, z, yaw) {
    player.position.set(x, o.heightAt(x, z), z); vel.set(0, 0, 0);
    if (yaw !== undefined) { player.rotation.y = yaw; cam.tYaw = cam.yaw = yaw + Math.PI; }
    camTarget.set(x, player.position.y + 1.25, z);
  }
  player.teleport = teleport;

  function stepPlayer(dt) {
    const pos = player.position;
    let ix = inp.joyX, iy = inp.joyY;
    for (const code in MOVE) if (keys.has(code)) { ix += MOVE[code][0]; iy += MOVE[code][1]; }
    const len = Math.hypot(ix, iy); if (len > 1) { ix /= len; iy /= len; }
    const mag = Math.min(1, len);
    const running = keys.has('ShiftLeft') || keys.has('ShiftRight') || (inp.joyOn && mag > 0.92);
    const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
    const dx = -sy * iy + cy * ix, dz = -cy * iy - sy * ix;
    const W = o.water;
    const vmax = (running ? o.player.run : o.player.walk) * (player.inWater ? W.slow : 1);
    const a = 1 - Math.exp(-(player.onGround ? 11 : 3.2) * dt);
    vel.x += (dx * vmax - vel.x) * a; vel.z += (dz * vmax - vel.z) * a;
    let nx = pos.x + vel.x * dt, nz = pos.z + vel.z * dt;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (c.top !== undefined && pos.y + STEP >= c.top) continue;
      const ddx = nx - c.x, ddz = nz - c.z, rr = c.r + PR, d2 = ddx * ddx + ddz * ddz;
      if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1e-4; nx = c.x + (ddx / d) * rr; nz = c.z + (ddz / d) * rr; }
    }
    const bx = nx - o.boundsCenter.x, bz = nz - o.boundsCenter.z, bd = Math.hypot(bx, bz);
    if (bd > o.boundsRadius) { nx = o.boundsCenter.x + (bx / bd) * o.boundsRadius; nz = o.boundsCenter.z + (bz / bd) * o.boundsRadius; }
    pos.x = nx; pos.z = nz;
    const hs = Math.hypot(vel.x, vel.z);
    if (mag > 0.05 && hs > 0.25) faceTarget = Math.atan2(vel.x, vel.z);
    player.rotation.y = lerpAngle(player.rotation.y, faceTarget, 1 - Math.exp(-11 * dt));

    // vertical
    const solid = groundAt(pos.x, pos.z, pos.y);
    let ground = solid;
    if (W) ground = Math.max(ground, W.level - W.maxDepth);
    coyote = player.onGround ? 0.12 : coyote - dt;
    inp.jumpQ -= dt;
    let jumped = false, landed = 0;
    if (inp.jumpQ > 0 && coyote > 0) { vel.y = o.player.jump; player.onGround = false; coyote = 0; inp.jumpQ = 0; jumped = true; }
    vel.y -= 26 * dt;
    pos.y += vel.y * dt;
    if (pos.y <= ground) {
      if (!player.onGround && vel.y < -4) landed = -vel.y;
      pos.y = ground; vel.y = 0; player.onGround = true;
    } else if (player.onGround && vel.y <= 0 && pos.y - ground < STEP + 0.05) { pos.y = ground; vel.y = 0; }
    else player.onGround = false;
    player.inWater = !!W && solid < W.level - 0.15 && pos.y < W.level - 0.1;
    player.speed = hs;

    traveler.update(dt, elapsed, {
      speed: hs, run: running && hs > o.player.walk * 0.9, onGround: player.onGround, inWater: player.inWater,
      jumped, landed, heightAboveGround: player.inWater ? 99 : pos.y - solid,
    });

    // ripples
    if (W) {
      rippleT -= dt;
      if (player.inWater && rippleT <= 0) {
        rippleT = hs > 0.6 ? 0.26 : 1.3;
        const r = ripples.find((q) => q.life >= 1) || ripples[0];
        r.life = 0; r.m.visible = true; r.m.position.set(pos.x, W.level + 0.03, pos.z);
      }
      for (const r of ripples) {
        if (r.life >= 1) continue;
        r.life = Math.min(1, r.life + dt / 1.5);
        r.m.scale.setScalar(0.6 + r.life * 3.2); r.m.material.opacity = 0.45 * (1 - r.life);
        if (r.life >= 1) r.m.visible = false;
      }
    }
    return { iy, hs };
  }

  function stepCamera(dt, iy = 0, hs = 0) {
    if (hs > 1 && elapsed - cam.lastDrag > 1.5 && iy > 0.2) cam.tYaw = lerpAngle(cam.tYaw, player.rotation.y + Math.PI, dt * 0.9 * iy);
    const kr = 1 - Math.exp(-12 * dt);
    cam.yaw += (cam.tYaw - cam.yaw) * kr; cam.pitch += (cam.tPitch - cam.pitch) * kr;
    cam.dist += (cam.tDist - cam.dist) * (1 - Math.exp(-8 * dt));
    const pos = player.position;
    const kxz = 1 - Math.exp(-10 * dt), ky = 1 - Math.exp(-6 * dt);
    camTarget.x += (pos.x - camTarget.x) * kxz; camTarget.z += (pos.z - camTarget.z) * kxz;
    camTarget.y += (pos.y + 1.25 - camTarget.y) * ky;
    let yaw = cam.yaw, pitch = cam.pitch, dist = cam.dist;
    if (o.camera.intro && introT0 >= 0) {
      const e = EASE(clamp((elapsed - introT0) / 2.8, 0, 1));
      yaw += (1 - e) * 1.25; pitch = lerp(0.75, pitch, e); dist = lerp(Math.max(26, dist * 3), dist, e);
    } else if (o.camera.intro && !started) { yaw += 1.25; pitch = 0.75; dist = Math.max(26, dist * 3); }
    const cp = Math.cos(pitch);
    camera.position.set(camTarget.x + Math.sin(yaw) * cp * dist, camTarget.y + Math.sin(pitch) * dist, camTarget.z + Math.cos(yaw) * cp * dist);
    let minY = o.heightAt(camera.position.x, camera.position.z) + 0.45;
    if (o.water) minY = Math.max(minY, o.water.level + 0.3);
    if (camera.position.y < minY) camera.position.y = minY;
    camera.lookAt(camTarget.x, camTarget.y + Math.max(0, -pitch) * 2.5, camTarget.z);
    // shadow camera follows the player
    sun.position.copy(pos).addScaledVector(sunDir, 90); sun.target.position.copy(pos);
  }

  // ── loop ──
  const updates = [];
  const clock = new THREE.Clock(false);
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt; SHARED.time.value = elapsed;
    const { iy, hs } = stepPlayer(dt);
    stepCamera(dt, iy, hs);
    // info zones + markers
    const pos = player.position;
    let near = null, best = Infinity;
    for (const z of zones) { const d = Math.hypot(pos.x - z.at.x, pos.z - z.at.z); if (d < z.radius && d < best) { best = d; near = z; } }
    hud.showInfo(near);
    for (const m of markers) {
      const y = 2.2 + Math.sin(elapsed * 1.6 + m.seed) * 0.15;
      m.glow.position.y = m.core.position.y = y;
      const s = m.zone === near ? 2.6 : 1.8; m.glow.scale.x += (s - m.glow.scale.x) * 0.1; m.glow.scale.y = m.glow.scale.x;
      const life = (elapsed * 0.45 + m.seed) % 1;
      m.ring.scale.setScalar(0.5 + life * 1.7); m.ring.material.opacity = 0.55 * (1 - life);
    }
    for (const fn of SHARED.updaters) fn(dt, elapsed, camera);
    for (let i = 0; i < updates.length; i++) updates[i](dt, elapsed);
    if (composer) composer.render(dt); else renderer.render(scene, camera);
    if (captureQ) {
      captureQ = false; hud.flash();
      canvas.toBlob((b) => {
        if (!b) return;
        const a = document.createElement('a'); a.href = URL.createObjectURL(b);
        a.download = `iceland-${(o.subtitle || o.title).split(/[·|]/)[0].trim().replace(/\s+/g, '-').toLowerCase() || 'world'}.jpg`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        hud.toast('照片已儲存 ✓');
      }, 'image/jpeg', 0.92);
    }
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (composer) composer.setSize(w, h);
    SHARED.pixelRatio.value = renderer.getPixelRatio();
    SHARED.pxScale.value = (h * renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }
  window.addEventListener('resize', resize);
  resize();
  stepCamera(0);

  const world = {
    THREE, scene, camera, renderer, composer, bloomPass, sun, hemi, sky, player, options: o,
    get elapsed() { return elapsed; },
    onUpdate(fn) { updates.push(fn); return () => { const i = updates.indexOf(fn); if (i >= 0) updates.splice(i, 1); }; },
    addCollider,
    setHeightFn(fn) { o.heightAt = fn; },
    heightAt: (x, z) => o.heightAt(x, z),
    groundAt: (x, z) => groundAt(x, z),
    addInfo,
    toast: (t, ms) => hud.toast(t, ms),
    add: (...objs) => { scene.add(...objs); return objs[0]; },
    start() {
      if (started) return world;
      hud.setProgress(0.8);
      player.position.y = Math.max(player.position.y, groundAt(player.position.x, player.position.z));
      stepCamera(0);
      const go = () => {
        started = true;
        introT0 = 0.35;                       // hold the wide shot until the loading screen starts fading
        clock.start();
        renderer.setAnimationLoop(frame);
        requestAnimationFrame(() => {
          hud.hideLoading();
          setTimeout(() => traveler.wave(2.2), 1500);
          setTimeout(() => hud.hideHints(), 9000);
        });
      };
      const p = renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve(renderer.compile(scene, camera));
      Promise.resolve(p).catch(() => {}).then(() => { hud.setProgress(0.95); setTimeout(go, 120); });
      return world;
    },
  };
  return world;
}

/** Everything world authors need, in one object. */
export const helpers = {
  noise2D, fbm, ridged, rand, lerp, clamp, smoothstep, softTexture, addRim,
  createTerrain, createSky, createStars, createAurora, createWater, createSteam,
  createSnow, createParticles, createRocks, createBasaltColumns, createIce, createWaterfall, createGlow,
};
export default createWorld;
