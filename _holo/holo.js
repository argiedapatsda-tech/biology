// Holographic background: a real B-DNA molecule (atoms from PDB 1BNA) projected above a
// holo-table base, like a lab hologram. Bundled to assets/holo-bg.js by _holo/build.mjs.
// Same small API as before: BioBG.start({ level }), BioBG.setLevel(0..1).
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Color, Vector3, Matrix4, Quaternion,
  InstancedMesh, IcosahedronGeometry, InstancedBufferAttribute, ShaderMaterial, AdditiveBlending,
  CatmullRomCurve3, TubeGeometry, Mesh, PlaneGeometry, CylinderGeometry, BufferGeometry,
  Float32BufferAttribute, Points, DoubleSide, MathUtils
} from 'three';
import { DNA } from './dna_data.js';

const S = 0.1;                         // 1 Å = 0.1 scene units
const RADIUS = { 0: 1.70, 1: 1.55, 2: 1.52, 3: 1.80 };   // van der Waals radii: C N O P
const page = document.body.dataset.holo || 'home';
let renderer, scene, camera, root, helix, mats = [], clockStart = 0, level = 1, target = 1, running = false, lastFrame = 0;
let labels = null, mouse = { x: 0, y: 0, sx: 0, sy: 0 };

const COMMON = /* glsl */`
  uniform float uTime; uniform float uLevel;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
`;

function atomMaterial() {
  return new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uLevel: { value: 1 }, uScan: { value: 0 }, uHalf: { value: 4.1 } },
    vertexShader: COMMON + /* glsl */`
      attribute vec3 aScatter; attribute float aKind; attribute float aDelay;
      uniform float uScan; uniform float uHalf;
      varying vec3 vN; varying vec3 vV; varying float vKind; varying float vBand; varying float vIn;
      void main() {
        // assemble: every atom flies in from a scattered start to its real place
        float t = clamp((uTime - aDelay) / 1.6, 0.0, 1.0);
        float e = 1.0 - pow(1.0 - t, 3.0);
        vIn = t;
        vec4 local = instanceMatrix * vec4(position, 1.0);
        local.xyz += aScatter * (1.0 - e);
        vec4 wp = modelMatrix * local;
        vec4 mv = viewMatrix * wp;
        vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        vV = normalize(-mv.xyz);
        vKind = aKind;
        float y = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;      // height along the helix axis
        vBand = exp(-pow((y - uScan) / 0.45, 2.0));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: COMMON + /* glsl */`
      varying vec3 vN; varying vec3 vV; varying float vKind; varying float vBand; varying float vIn;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(f, 2.2);
        // backbone = holo cyan, bases = pale ice blue, phosphorus = warm gold
        vec3 c = vKind < 0.5 ? vec3(0.20, 0.72, 1.0) : vKind < 1.5 ? vec3(0.62, 0.93, 1.0) : vec3(1.0, 0.74, 0.32);
        float a = (0.10 + rim * 0.95) * (0.75 + 0.6 * vBand);
        vec3 col = c * a * 1.25 + vec3(0.7, 0.95, 1.0) * vBand * rim * 0.35;
        gl_FragColor = vec4(col * uLevel * smoothstep(0.0, 0.35, vIn), 1.0);
      }`
  });
}

function strandMaterial(color) {
  return new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uLevel: { value: 1 }, uColor: { value: new Color(color) } },
    vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: COMMON + /* glsl */`uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.5);
        // a pulse of light travelling along the backbone
        float p = fract(vUv.x * 3.0 - uTime * 0.12);
        float pulse = smoothstep(0.0, 0.04, p) * (1.0 - smoothstep(0.04, 0.22, p));
        float show = smoothstep(1.2, 2.4, uTime);
        gl_FragColor = vec4(uColor * (0.18 + rim * 0.55 + pulse * 0.9) * uLevel * show, 1.0);
      }`
  });
}

// the holo-table: a flat disc of rings, ticks and turning segments, drawn in a shader
function baseMaterial() {
  return new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
    uniforms: { uTime: { value: 0 }, uLevel: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: COMMON + /* glsl */`varying vec2 vUv;
      float ring(float r, float at, float w) { return smoothstep(w, 0.0, abs(r - at)); }
      void main() {
        vec2 p = vUv * 2.0 - 1.0; float r = length(p); float a = atan(p.y, p.x);
        if (r > 1.0) discard;
        float T = uTime;
        float v = 0.0;
        v += ring(r, 0.30, 0.006) * 0.9 + ring(r, 0.47, 0.004) * 0.6 + ring(r, 0.72, 0.003) * 0.5 + ring(r, 0.97, 0.004) * 0.7;
        // dashed ring turning one way, segmented arc the other way
        float d1 = step(0.5, fract((a + T * 0.25) * 18.0 / 6.2832)); v += ring(r, 0.56, 0.012) * d1 * 0.75;
        float arc = step(0.0, sin(a * 3.0 - T * 0.4)) * step(0.35, fract((a - T * 0.4) * 3.0 / 6.2832));
        v += ring(r, 0.84, 0.018) * arc * 0.55;
        // tick marks on the outer ring
        float tick = step(0.82, fract(a * 72.0 / 6.2832)) * smoothstep(0.88, 0.9, r) * smoothstep(0.96, 0.94, r);
        v += tick * 0.5;
        float major = step(0.9, fract(a * 12.0 / 6.2832)) * smoothstep(0.86, 0.87, r) * smoothstep(0.97, 0.96, r);
        v += major * 0.7;
        // glow under the molecule
        v += exp(-r * r * 18.0) * 0.55 + exp(-r * 4.0) * 0.12;
        float boot = smoothstep(0.0, 1.0, (T * 0.9) - r);   // rings light up from the centre outward
        vec3 col = mix(vec3(0.15, 0.62, 1.0), vec3(0.55, 0.92, 1.0), exp(-r * 3.0));
        gl_FragColor = vec4(col * v * boot * uLevel, 1.0);
      }`
  });
}

function beamMaterial() {
  return new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
    uniforms: { uTime: { value: 0 }, uLevel: { value: 1 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: COMMON + /* glsl */`varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        float edge = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        float h = vUv.y;                                     // 0 = base, 1 = top
        float fade = pow(1.0 - h, 1.6);
        float lines = 0.6 + 0.4 * step(0.5, fract(vUv.x * 60.0));
        float flow = 0.75 + 0.25 * sin(h * 40.0 - uTime * 2.0);
        float a = fade * (0.05 + edge * 0.16) * lines * flow * smoothstep(0.4, 1.4, uTime);
        gl_FragColor = vec4(vec3(0.25, 0.75, 1.0) * a * uLevel, 1.0);
      }`
  });
}

function dustMaterial() {
  return new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uLevel: { value: 1 }, uPx: { value: 1 } },
    vertexShader: COMMON + /* glsl */`attribute float aSeed; uniform float uPx; varying float vA;
      void main() {
        vec3 p = position;
        p.y = mod(p.y + uTime * (0.12 + aSeed * 0.25), 12.0) - 6.0;     // drift up and wrap
        p.x += sin(uTime * 0.3 + aSeed * 30.0) * 0.15;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = (0.35 + 0.65 * abs(sin(uTime * (0.6 + aSeed) + aSeed * 40.0))) * smoothstep(6.0, 3.5, abs(p.y));
        gl_PointSize = uPx * (1.4 + aSeed * 2.4) * (14.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: COMMON + `varying float vA; void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float g = pow(1.0 - d * 2.0, 2.0); gl_FragColor = vec4(vec3(0.45, 0.85, 1.0) * g * vA * 0.7 * uLevel, 1.0); }`
  });
}

function buildHelix() {
  const g = new Group();
  const n = DNA.n, P = DNA.pos;
  const geo = new IcosahedronGeometry(1, 2);
  const mat = atomMaterial(); mats.push(mat);
  const mesh = new InstancedMesh(geo, mat, n);
  const kind = new Float32Array(n), scatter = new Float32Array(n * 3), delay = new Float32Array(n);
  const m = new Matrix4(), q = new Quaternion(), sc = new Vector3(), v = new Vector3();
  const half = DNA.bp * DNA.rise * S / 2;
  for (let i = 0; i < n; i++) {
    v.set(P[i * 3] / 10 * S, P[i * 3 + 1] / 10 * S, P[i * 3 + 2] / 10 * S);
    const r = RADIUS[DNA.el[i]] * 0.48 * S;
    sc.set(r, r, r);
    m.compose(v, q, sc); mesh.setMatrixAt(i, m);
    kind[i] = DNA.el[i] === 3 ? 2 : DNA.role[i];
    // scattered start: out from the axis and spread in height
    const ang = Math.random() * Math.PI * 2, rad = 2 + Math.random() * 5;
    scatter[i * 3] = Math.cos(ang) * rad; scatter[i * 3 + 1] = Math.sin(ang) * rad; scatter[i * 3 + 2] = (Math.random() - .5) * 6;
    delay[i] = 0.15 + (v.z + half) / (half * 2) * 0.9 + Math.random() * 0.25;    // builds from the bottom up
  }
  geo.setAttribute('aKind', new InstancedBufferAttribute(kind, 1));
  geo.setAttribute('aScatter', new InstancedBufferAttribute(scatter, 3));
  geo.setAttribute('aDelay', new InstancedBufferAttribute(delay, 1));
  mesh.frustumCulled = false;
  g.add(mesh);
  // the two sugar-phosphate backbones as glowing ribbons through the phosphorus atoms
  for (const st of [0, 1]) {
    const pts = [];
    for (let i = 0; i < n; i++) if (DNA.el[i] === 3 && DNA.strand[i] === st) pts.push(new Vector3(P[i * 3] / 10 * S, P[i * 3 + 1] / 10 * S, P[i * 3 + 2] / 10 * S));
    pts.sort((a, b) => a.z - b.z);
    if (pts.length < 4) continue;
    const curve = new CatmullRomCurve3(pts);
    const sm = strandMaterial(st ? 0x58d8ff : 0x7fe3ff); mats.push(sm);
    const tube = new Mesh(new TubeGeometry(curve, pts.length * 8, 0.03, 6, false), sm);
    tube.frustumCulled = false;
    g.add(tube);
  }
  // the helix axis stands up (data z -> scene y)
  g.rotation.x = -Math.PI / 2;
  const wrap = new Group(); wrap.add(g);
  wrap.userData.half = half; wrap.userData.atoms = mesh;
  return wrap;
}

function buildTable(half) {
  const g = new Group();
  const base = new Mesh(new PlaneGeometry(7, 7), baseMaterial()); mats.push(base.material);
  base.rotation.x = -Math.PI / 2; base.position.y = -half - 0.9;
  g.add(base);
  const beam = new Mesh(new CylinderGeometry(1.9, 2.4, half * 2 + 1.6, 64, 1, true), beamMaterial()); mats.push(beam.material);
  beam.position.y = 0;
  g.add(beam);
  // dust in the beam
  const N = 420, pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 3.4;
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * 12 - 6; pos[i * 3 + 2] = Math.sin(a) * r; seed[i] = Math.random();
  }
  const dg = new BufferGeometry(); dg.setAttribute('position', new Float32BufferAttribute(pos, 3)); dg.setAttribute('aSeed', new Float32BufferAttribute(seed, 1));
  const dust = new Points(dg, dustMaterial()); mats.push(dust.material); dust.frustumCulled = false;
  g.add(dust);
  return g;
}

// ---------------------------------------------------------------- labels (home page only)
function buildLabels() {
  const host = document.createElement('div'); host.className = 'holo-labels'; host.setAttribute('aria-hidden', 'true');
  const items = [
    { t: 'B-DNA', s: 'real atom positions · PDB 1BNA', at: [0, 0.62, 0], side: -1 },
    { t: '3.4 nm per turn', s: '10.5 base pairs', at: [0, 0.12, 0], side: -1 }
  ];
  host.innerHTML = '<svg class="holo-lines"></svg>' + items.map(it => `<div class="holo-lab ${it.side > 0 ? 'r' : 'l'}"><b>${it.t}</b><span>${it.s}</span></div>`).join('');
  document.body.appendChild(host);
  return { host, items, els: [...host.querySelectorAll('.holo-lab')], svg: host.querySelector('svg') };
}
const tmp = new Vector3();
function placeLabels(t) {
  if (!labels) return;
  const W = innerWidth, H = innerHeight, half = helix.userData.half;
  const show = Math.min(1, Math.max(0, (t - 2.2) / .8)) * level;
  labels.host.style.opacity = show;
  if (show <= 0) return;
  let lines = '';
  labels.items.forEach((it, i) => {
    // anchor on the helix surface, facing the camera side
    tmp.set(it.side * 1.15, it.at[1] * half, 0); root.localToWorld(tmp); tmp.project(camera);
    const x = (tmp.x + 1) / 2 * W, y = (1 - tmp.y) / 2 * H;
    const lx = x + it.side * Math.min(170, W * .12), ly = y - 18;
    const el = labels.els[i];
    el.style.transform = `translate(${it.side > 0 ? lx + 8 : lx - 8 - el.offsetWidth}px, ${ly - el.offsetHeight / 2}px)`;
    lines += `<path d="M${x.toFixed(1)} ${y.toFixed(1)} L${(x + it.side * 22).toFixed(1)} ${ly.toFixed(1)} L${lx.toFixed(1)} ${ly.toFixed(1)}"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6"/>`;
  });
  labels.svg.innerHTML = lines;
}

// ---------------------------------------------------------------- layout per page
function layout() {
  const W = innerWidth, H = innerHeight, asp = W / H;
  renderer.setSize(W, H, false);
  camera.aspect = asp; camera.updateProjectionMatrix();
  const dist = 21, halfH = Math.tan(MathUtils.degToRad(camera.fov / 2)) * dist, halfW = halfH * asp;
  let x = 0, y = 0.2, s = 1;
  if (page === 'home') { if (asp > 1.05) { x = halfW * 0.44; y = 0.9; s = 0.88; } else { y = 1.6; s = 0.7; } }
  else if (page === 'teacher') { x = asp > 1.05 ? halfW * 0.62 : 0; y = 0.9; s = 0.9; }
  else { y = 0.2; s = asp > 1 ? 0.85 : 0.95; }
  root.position.set(x, y, 0); root.scale.setScalar(s);
  camera.position.set(0, 1.6, dist); camera.lookAt(0, 0.6, 0);
}

function frame(now) {
  if (!running) return;
  requestAnimationFrame(frame);
  if (document.hidden) return;
  // a calm frame rate: smooth on a laptop, easy on an iPad battery
  const cap = level < 0.5 ? 1000 / 20 : 1000 / 45;
  if (now - lastFrame < cap) return;
  lastFrame = now;
  const t = (now - clockStart) / 1000;
  level += (target - level) * 0.06;
  const half = helix.userData.half;
  const scan = ((t * 0.55) % 2.4 - 1.2) * half;           // a scan line sweeps up the molecule
  for (const m of mats) { m.uniforms.uTime.value = t; m.uniforms.uLevel.value = level; if (m.uniforms.uScan) m.uniforms.uScan.value = scan; }
  helix.rotation.y = t * 0.16;
  mouse.sx += (mouse.x - mouse.sx) * 0.04; mouse.sy += (mouse.y - mouse.sy) * 0.04;
  root.rotation.y = mouse.sx * 0.18; root.rotation.x = mouse.sy * 0.05;
  renderer.render(scene, camera);
  placeLabels(t);
}

function start(opts) {
  if (renderer) return setLevel(opts && opts.level != null ? opts.level : 1);
  setLevel(opts && opts.level != null ? opts.level : 1); level = target;
  const cv = document.createElement('canvas'); cv.className = 'biobg holobg'; cv.setAttribute('aria-hidden', 'true');
  document.body.prepend(cv);
  try {
    renderer = new WebGLRenderer({ canvas: cv, antialias: true, alpha: false, powerPreference: page === 'student' ? 'low-power' : 'high-performance' });
  } catch (e) { cv.remove(); renderer = null; return; }        // no WebGL: the CSS background stays
  const ipad = /iPad|iPhone|Android/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, ipad ? 1.25 : 1.5));
  renderer.setClearColor(0x01040a, 1);
  scene = new Scene();
  camera = new PerspectiveCamera(32, 1, 0.1, 200);
  root = new Group(); scene.add(root);
  helix = buildHelix(); root.add(helix);
  root.add(buildTable(helix.userData.half));
  for (const m of mats) if (m.uniforms.uPx) m.uniforms.uPx.value = renderer.getPixelRatio();
  if (page === 'home') labels = buildLabels();
  layout();
  addEventListener('resize', layout);
  addEventListener('pointermove', e => { mouse.x = e.clientX / innerWidth * 2 - 1; mouse.y = e.clientY / innerHeight * 2 - 1; }, { passive: true });
  clockStart = performance.now(); running = true;
  requestAnimationFrame(frame);
  window.__holo = { renderer, scene, atoms: DNA.n };
}
const DIM = page === 'student' ? 0.5 : page === 'teacher' ? 0.7 : 1;
function setLevel(l) { target = Math.max(0, Math.min(1, Number(l) || 0)) * DIM; }

window.BioBG = { start, setLevel };
