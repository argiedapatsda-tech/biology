// Holo-table: real biological structures as holograms, one after another. The glowing particles of
// one specimen fly apart and rebuild the next (DNA -> hemoglobin -> virus -> neuron -> cell).
// Data: _holo/specimens.js (PDB 1BNA, 2HHB, 1A34, NeuroMorpho CSp0114-1, HoloCell model).
// Bundled to assets/holo-bg.js by _holo/build.mjs. API: BioBG.start({ level }), BioBG.setLevel(0..1).
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Vector3, ShaderMaterial, AdditiveBlending,
  Mesh, PlaneGeometry, CylinderGeometry, BufferGeometry, BufferAttribute, Float32BufferAttribute,
  Points, LineSegments, DoubleSide, MathUtils
} from 'three';
import { SPECIMENS } from './specimens.js';

const page = document.body.dataset.holo || 'home';
const HOLD = page === 'home' ? 11 : 16, MORPH = 2.6;          // seconds on show, seconds to rebuild
let renderer, scene, camera, root, spin, mats = [], t0 = 0, level = 1, target = 1, running = false, lastFrame = 0;
let points, lineObjs = [], specs = [], cur = 0, next = 0, phase = 'hold', phaseT = 0, caption = null;
const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
const DIM = page === 'student' ? 0.85 : page === 'teacher' ? 0.9 : 1;

// ---------------------------------------------------------------- data
function decode(s, Type) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Type(u.buffer); }
function loadSpecimens() {
  return SPECIMENS.map(s => {
    const q = decode(s.pos, Int16Array), cat = decode(s.cat, Uint8Array), size = decode(s.size, Uint8Array), lines = decode(s.lines, Uint16Array);
    const pos = new Float32Array(s.n * 3), col = new Float32Array(s.n * 3), sz = new Float32Array(s.n);
    for (let i = 0; i < s.n; i++) {
      pos[i * 3] = q[i * 3] / 3000; pos[i * 3 + 1] = q[i * 3 + 1] / 3000; pos[i * 3 + 2] = q[i * 3 + 2] / 3000;
      const c = s.pal[cat[i]] || [0.4, 0.85, 1]; col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      sz[i] = size[i] * 0.004;
    }
    return { ...s, P: pos, C: col, Z: sz, L: lines };
  });
}

const COMMON = /* glsl */`uniform float uTime; uniform float uLevel;`;

// ---------------------------------------------------------------- the particles (one set, morphing)
function particleMaterial() {
  return new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uLevel: { value: 1 }, uMix: { value: 0 }, uPx: { value: 1 }, uScan: { value: 0 }, uH: { value: 4 } },
    vertexShader: COMMON + /* glsl */`
      attribute vec3 aPosB; attribute vec3 aCol; attribute vec3 aColB; attribute float aSize; attribute float aSizeB; attribute float aSeed;
      uniform float uMix; uniform float uPx; uniform float uScan; uniform float uH;
      varying vec3 vCol; varying float vA; varying float vBand;
      void main() {
        // each particle leaves at its own moment, flies out on a curve and lands in the new shape
        float t = clamp(uMix * 1.5 - aSeed * 0.5, 0.0, 1.0);
        float e = t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
        vec3 mid = normalize(vec3(sin(aSeed * 91.0), cos(aSeed * 57.0) * 0.6, cos(aSeed * 33.0)) + 0.001) * (2.4 + aSeed * 2.2);
        vec3 p = mix(position, aPosB, e) + mid * sin(3.14159 * e) * 0.9;
        float s = mix(aSize, aSizeB, e);
        vCol = mix(aCol, aColB, e);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vBand = exp(-pow((p.y - uScan) / (uH * 0.06), 2.0));
        vA = step(0.0001, s) * (0.85 + 0.15 * sin(uTime * 2.0 + aSeed * 60.0));
        gl_PointSize = max(1.6, s * uPx * 820.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: COMMON + /* glsl */`
      varying vec3 vCol; varying float vA; varying float vBand;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0; float d = dot(c, c);
        if (d > 1.0 || vA <= 0.0) discard;
        float nz = sqrt(1.0 - d);
        float rim = pow(1.0 - nz, 2.0);                     // glass sphere: bright edge, clear middle
        float edge = smoothstep(1.0, 0.86, d);
        vec3 col = vCol * (0.22 + rim * 1.25) * edge + vec3(0.75, 0.95, 1.0) * vBand * 0.35 * edge;
        gl_FragColor = vec4(col * vA * uLevel, 1.0);
      }`
  });
}
function lineMaterial() {
  return new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uLevel: { value: 1 }, uShow: { value: 0 } },
    vertexShader: `attribute vec3 color; varying vec3 vC; varying float vY; void main() { vC = color; vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: COMMON + `uniform float uShow; varying vec3 vC; varying float vY;
      void main() { float pulse = 0.65 + 0.35 * sin(vY * 3.0 - uTime * 2.2); gl_FragColor = vec4(vC * 0.55 * pulse * uShow * uLevel, 1.0); }`
  });
}
function buildParticles() {
  const N = Math.max(...specs.map(s => s.n));
  const g = new BufferGeometry();
  const seed = new Float32Array(N);
  for (let i = 0; i < N; i++) seed[i] = Math.random();
  g.setAttribute('position', new BufferAttribute(new Float32Array(N * 3), 3));
  g.setAttribute('aPosB', new BufferAttribute(new Float32Array(N * 3), 3));
  g.setAttribute('aCol', new BufferAttribute(new Float32Array(N * 3), 3));
  g.setAttribute('aColB', new BufferAttribute(new Float32Array(N * 3), 3));
  g.setAttribute('aSize', new BufferAttribute(new Float32Array(N), 1));
  g.setAttribute('aSizeB', new BufferAttribute(new Float32Array(N), 1));
  g.setAttribute('aSeed', new BufferAttribute(seed, 1));
  const m = particleMaterial(); mats.push(m);
  points = new Points(g, m); points.frustumCulled = false;
  points.userData.N = N;
  return points;
}
// put specimen s into slot A (from) or B (to). Spare particles sit on the shape's own points, unseen.
function fill(slot, s, scatter) {
  const g = points.geometry, N = points.userData.N, A = slot === 'A';
  const P = g.attributes[A ? 'position' : 'aPosB'].array, C = g.attributes[A ? 'aCol' : 'aColB'].array, Z = g.attributes[A ? 'aSize' : 'aSizeB'].array;
  for (let i = 0; i < N; i++) {
    const j = i % s.n;
    if (scatter) {
      const a = Math.random() * 6.283, r = 3 + Math.random() * 5;
      P[i * 3] = Math.cos(a) * r; P[i * 3 + 1] = (Math.random() - .5) * 9; P[i * 3 + 2] = Math.sin(a) * r;
    } else { P[i * 3] = s.P[j * 3]; P[i * 3 + 1] = s.P[j * 3 + 1]; P[i * 3 + 2] = s.P[j * 3 + 2]; }
    C[i * 3] = s.C[j * 3]; C[i * 3 + 1] = s.C[j * 3 + 1]; C[i * 3 + 2] = s.C[j * 3 + 2];
    Z[i] = i < s.n ? s.Z[i] : 0;
  }
  for (const k of ['position', 'aPosB', 'aCol', 'aColB', 'aSize', 'aSizeB']) g.attributes[k].needsUpdate = true;
}
function buildLines(s) {
  if (!s.L.length) return null;
  const n = s.L.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const i = s.L[k];
    pos[k * 3] = s.P[i * 3]; pos[k * 3 + 1] = s.P[i * 3 + 1]; pos[k * 3 + 2] = s.P[i * 3 + 2];
    col[k * 3] = s.C[i * 3]; col[k * 3 + 1] = s.C[i * 3 + 1]; col[k * 3 + 2] = s.C[i * 3 + 2];
  }
  const g = new BufferGeometry(); g.setAttribute('position', new BufferAttribute(pos, 3)); g.setAttribute('color', new BufferAttribute(col, 3));
  const m = lineMaterial(); mats.push(m);
  const l = new LineSegments(g, m); l.frustumCulled = false; return l;
}

// ---------------------------------------------------------------- holo-table: base rings, beam, dust
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
        float T = uTime, v = 0.0;
        v += ring(r, 0.30, 0.006) * 0.9 + ring(r, 0.47, 0.004) * 0.6 + ring(r, 0.72, 0.003) * 0.5 + ring(r, 0.97, 0.004) * 0.7;
        v += ring(r, 0.56, 0.012) * step(0.5, fract((a + T * 0.25) * 18.0 / 6.2832)) * 0.75;
        v += ring(r, 0.84, 0.018) * step(0.0, sin(a * 3.0 - T * 0.4)) * step(0.35, fract((a - T * 0.4) * 3.0 / 6.2832)) * 0.55;
        v += step(0.82, fract(a * 72.0 / 6.2832)) * smoothstep(0.88, 0.9, r) * smoothstep(0.96, 0.94, r) * 0.5;
        v += step(0.9, fract(a * 12.0 / 6.2832)) * smoothstep(0.86, 0.87, r) * smoothstep(0.97, 0.96, r) * 0.7;
        v += exp(-r * r * 18.0) * 0.55 + exp(-r * 4.0) * 0.12;
        float boot = smoothstep(0.0, 1.0, (T * 0.9) - r);
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
        float h = vUv.y, fade = pow(1.0 - h, 1.6);
        float lines = 0.6 + 0.4 * step(0.5, fract(vUv.x * 60.0));
        float flow = 0.75 + 0.25 * sin(h * 40.0 - uTime * 2.0);
        gl_FragColor = vec4(vec3(0.25, 0.75, 1.0) * fade * (0.04 + edge * 0.14) * lines * flow * smoothstep(0.4, 1.4, uTime) * uLevel, 1.0);
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
        p.y = mod(p.y + uTime * (0.12 + aSeed * 0.25), 12.0) - 6.0;
        p.x += sin(uTime * 0.3 + aSeed * 30.0) * 0.15;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vA = (0.35 + 0.65 * abs(sin(uTime * (0.6 + aSeed) + aSeed * 40.0))) * smoothstep(6.0, 3.5, abs(p.y));
        gl_PointSize = uPx * (1.4 + aSeed * 2.4) * (14.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float uLevel; varying float vA; void main() { float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vec3(0.45, 0.85, 1.0) * pow(1.0 - d * 2.0, 2.0) * vA * 0.6 * uLevel, 1.0); }`
  });
}
function buildTable() {
  const g = new Group();
  const base = new Mesh(new PlaneGeometry(7.4, 7.4), baseMaterial()); mats.push(base.material);
  base.rotation.x = -Math.PI / 2; base.position.y = -5.0; g.add(base);
  const beam = new Mesh(new CylinderGeometry(2.0, 2.6, 9.6, 64, 1, true), beamMaterial()); mats.push(beam.material);
  beam.position.y = -0.2; g.add(beam);
  const N = 380, pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * 3.4; pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * 12 - 6; pos[i * 3 + 2] = Math.sin(a) * r; seed[i] = Math.random(); }
  const dg = new BufferGeometry(); dg.setAttribute('position', new Float32BufferAttribute(pos, 3)); dg.setAttribute('aSeed', new Float32BufferAttribute(seed, 1));
  const dust = new Points(dg, dustMaterial()); mats.push(dust.material); dust.frustumCulled = false; g.add(dust);
  return g;
}

// ---------------------------------------------------------------- caption under the table
function buildCaption() {
  const el = document.createElement('div'); el.className = 'holo-cap'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="hc-top"><span class="hc-n"></span><span class="hc-src"></span></div><b class="hc-name"></b><span class="hc-th"></span><p class="hc-note"></p><div class="hc-dots"></div>';
  document.body.appendChild(el);
  el.querySelector('.hc-dots').innerHTML = specs.map(() => '<i></i>').join('');
  return el;
}
function showCaption(i) {
  if (!caption) return;
  const s = specs[i];
  caption.classList.remove('in'); void caption.offsetWidth;
  caption.querySelector('.hc-n').textContent = String(i + 1).padStart(2, '0') + ' / ' + String(specs.length).padStart(2, '0');
  caption.querySelector('.hc-src').textContent = s.src;
  caption.querySelector('.hc-name').textContent = s.name;
  caption.querySelector('.hc-th').textContent = s.th;
  caption.querySelector('.hc-note').textContent = s.note;
  [...caption.querySelectorAll('.hc-dots i')].forEach((d, k) => d.classList.toggle('on', k === i));
  caption.classList.add('in');
}
const tmp = new Vector3();
function placeCaption() {
  if (!caption) return;
  caption.style.opacity = Math.min(1, level * 1.4);      // its place is set in CSS per page
}

// ---------------------------------------------------------------- show order
function setShow(i, fromScatter) {
  next = i;
  if (fromScatter) fill('A', specs[i], true);
  fill('B', specs[i]);
  points.material.uniforms.uMix.value = 0;
  phase = 'morph'; phaseT = 0;
  lineObjs.forEach(l => { if (l) l.visible = false; });
}
function finishMorph() {
  cur = next;
  fill('A', specs[cur]);
  points.material.uniforms.uMix.value = 0;
  phase = 'hold'; phaseT = 0;
  const l = lineObjs[cur]; if (l) { l.visible = true; l.material.uniforms.uShow.value = 0; }
  showCaption(cur);
}

// ---------------------------------------------------------------- layout per page
function layout() {
  const W = innerWidth, H = innerHeight, asp = W / H;
  renderer.setSize(W, H, false);
  camera.aspect = asp; camera.updateProjectionMatrix();
  const dist = 21, halfH = Math.tan(MathUtils.degToRad(camera.fov / 2)) * dist, halfW = halfH * asp;
  let x = 0, y = 0.9, s = 0.88;
  if (page === 'home') { if (asp > 1.05) { x = halfW * 0.44; y = 1.9; s = 0.8; } else { y = 2.6 + halfH * 0.18; s = asp < 0.6 ? 0.5 : 0.62; } }
  else if (page === 'teacher') { x = asp > 1.05 ? halfW * 0.6 : 0; s = 0.8; }
  else { s = asp > 1 ? 0.85 : 1.0; y = 1.0; }
  root.position.set(x, y, 0); root.scale.setScalar(s);
  camera.position.set(0, 1.6, dist); camera.lookAt(0, 0.6, 0);
}

function frame(now) {
  if (!running) return;
  requestAnimationFrame(frame);
  if (document.hidden) return;
  const cap = level < 0.5 ? 1000 / 24 : 1000 / 50;
  if (now - lastFrame < cap) return;
  const dt = Math.min(0.1, (now - (lastFrame || now)) / 1000); lastFrame = now;
  const t = (now - t0) / 1000;
  level += (target - level) * 0.06;
  phaseT += dt;
  if (phase === 'morph') {
    const m = Math.min(1, phaseT / MORPH);
    points.material.uniforms.uMix.value = m;
    if (m >= 1) finishMorph();
  } else if (specs.length > 1 && phaseT > HOLD) setShow((cur + 1) % specs.length);
  const l = lineObjs[cur];
  if (l && phase === 'hold') l.material.uniforms.uShow.value = Math.min(1, phaseT / 1.2);
  const scan = ((t * 0.5) % 2.4 - 1.2) * 4.2;
  for (const m of mats) { m.uniforms.uTime.value = t; m.uniforms.uLevel.value = level; if (m.uniforms.uScan) m.uniforms.uScan.value = scan; }
  spin.rotation.y = t * 0.18;
  mouse.sx += (mouse.x - mouse.sx) * 0.04; mouse.sy += (mouse.y - mouse.sy) * 0.04;
  root.rotation.y = mouse.sx * 0.2; root.rotation.x = mouse.sy * 0.05;
  renderer.render(scene, camera);
  placeCaption();
}

function start(opts) {
  if (renderer) return setLevel(opts && opts.level != null ? opts.level : 1);
  setLevel(opts && opts.level != null ? opts.level : 1); level = target;
  const cv = document.createElement('canvas'); cv.className = 'biobg holobg'; cv.setAttribute('aria-hidden', 'true');
  document.body.prepend(cv);
  try { renderer = new WebGLRenderer({ canvas: cv, antialias: true, alpha: false, powerPreference: page === 'student' ? 'low-power' : 'high-performance' }); }
  catch (e) { cv.remove(); renderer = null; return; }
  const ipad = /iPad|iPhone|Android/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, ipad ? 1.5 : 2));
  renderer.setClearColor(0x01040a, 1);
  scene = new Scene();
  camera = new PerspectiveCamera(32, 1, 0.1, 200);
  root = new Group(); scene.add(root);
  spin = new Group(); root.add(spin);
  specs = loadSpecimens();
  spin.add(buildParticles());
  lineObjs = specs.map(s => { const l = buildLines(s); if (l) { l.visible = false; spin.add(l); } return l; });
  root.add(buildTable());
  for (const m of mats) if (m.uniforms.uPx) m.uniforms.uPx.value = renderer.getPixelRatio();
  caption = buildCaption();
  // each page opens on a different specimen, building itself out of a cloud
  const first = { home: 0, teacher: 1, student: 2 }[page] || 0;
  cur = first; setShow(first, true);
  layout();
  addEventListener('resize', layout);
  addEventListener('pointermove', e => { mouse.x = e.clientX / innerWidth * 2 - 1; mouse.y = e.clientY / innerHeight * 2 - 1; }, { passive: true });
  t0 = performance.now(); running = true;
  requestAnimationFrame(frame);
  window.__holo = { renderer, specimens: specs.map(s => s.key), get current() { return specs[cur].key; }, get phase() { return phase; }, show: i => { fill('A', specs[cur]); setShow(i); } };
}
function setLevel(l) { target = Math.max(0, Math.min(1, Number(l) || 0)) * DIM; }

window.BioBG = { start, setLevel };
