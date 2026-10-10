// Glass padlock hero: physically based glass body (transmission + clearcoat + iridescence),
// polished chrome shackle, glowing keyhole inside, studio-lit via a PMREM environment.
// The animated light field behind it is an opaque shader plane so the glass refracts it.
window.FX = (function () {
  const has3D = () => !!window.THREE;
  const STATE_COL = { idle: [0x3b5bdb, 0x7c3aed, 0x0ea5a4, 0x9db9ff], scan: [0x4c6ef5, 0x9b5cf6, 0x22b8cf, 0xc4b5fd], ok: [0x12b886, 0x2f9e44, 0x3bc9db, 0x7dffc0], lock: [0xe03131, 0xc2255c, 0x7b1e3a, 0xff7c8c] };

  function roundedRect(w, h, r) {
    const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  function keyholeShape() {
    const s = new THREE.Shape();
    s.moveTo(-0.1, -0.42); s.lineTo(0.1, -0.42); s.lineTo(0.07, -0.05);
    s.absarc(0, 0.08, 0.17, -Math.PI / 2 + 0.42, Math.PI * 1.5 - 0.42, false);
    s.lineTo(-0.1, -0.42);
    return s;
  }
  function studioEnv(renderer) {
    const pm = new THREE.PMREMGenerator(renderer);
    const sc = new THREE.Scene();
    sc.add(new THREE.Mesh(new THREE.BoxGeometry(24, 24, 24), new THREE.MeshBasicMaterial({ color: 0x07080d, side: THREE.BackSide })));
    const panel = (w, h, color, k, pos) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(pos[0], pos[1], pos[2]); m.lookAt(0, 0, 0); sc.add(m);
    };
    panel(10, 3, 0xffffff, 5, [0, 9, 2]);        // overhead softbox
    panel(3, 9, 0xc7d6ff, 3, [-10, 1, 4]);      // cool key, left
    panel(3, 9, 0xe0ccff, 2.4, [10, 0, -1]);    // violet rim, right
    panel(12, 2, 0x9ff0e6, 1.1, [0, -7, 6]);    // teal floor bounce
    panel(5, 5, 0xffffff, 1.6, [2, 3, -10]);    // back fill
    panel(1.2, 6, 0xffffff, 6, [-5, 2, 9]);     // strip light for the long specular streak
    const tex = pm.fromScene(sc, 0.015).texture; pm.dispose();
    return tex;
  }
  function lightField() {
    const u = { t: { value: 0 }, c1: { value: new THREE.Color(0x3b5bdb) }, c2: { value: new THREE.Color(0x7c3aed) }, c3: { value: new THREE.Color(0x0ea5a4) }, aspect: { value: 1 } };
    const m = new THREE.ShaderMaterial({
      uniforms: u, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        uniform float t; uniform vec3 c1; uniform vec3 c2; uniform vec3 c3; uniform float aspect; varying vec2 vUv;
        float blob(vec2 p, vec2 c, float r){ float d = length(p - c); return exp(-d*d / (r*r)); }
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        void main(){
          vec2 p = vUv - 0.5; p.x *= aspect;
          vec3 col = vec3(0.02, 0.023, 0.04);
          col += c1 * 0.55 * blob(p, vec2(-0.45*aspect + 0.12*sin(t*0.13), 0.32 + 0.08*cos(t*0.11)), 0.42);
          col += c2 * 0.45 * blob(p, vec2(0.42*aspect + 0.1*cos(t*0.09), 0.05 + 0.12*sin(t*0.12)), 0.40);
          col += c3 * 0.35 * blob(p, vec2(0.05 + 0.18*sin(t*0.07), -0.48 + 0.06*cos(t*0.1)), 0.38);
          col *= 1.0 - 0.55 * length(vUv - 0.5);
          col += (hash(vUv * 900.0 + t) - 0.5) / 255.0 * 2.0;
          gl_FragColor = vec4(col, 1.0);
        }`
    });
    return { m, u };
  }

  // layout: function(w, h) -> { x, y, size } as fractions of the visible area (x,y in -0.5..0.5, size of height)
  function lock(canvas, layout) {
    const stub = { setState() {}, setOpen() {}, snap() {}, pause() {}, resume() {} };
    if (!has3D()) return stub;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { return stub; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.outputEncoding = THREE.sRGBEncoding;
    const scene = new THREE.Scene();
    scene.environment = studioEnv(renderer);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0, 10);

    const field = lightField();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), field.m);
    bg.position.z = -8; scene.add(bg);

    const root = new THREE.Group(); scene.add(root);
    const lockG = new THREE.Group(); root.add(lockG);

    const bodyGeo = new THREE.ExtrudeGeometry(roundedRect(2.3, 1.85, 0.46), { depth: 0.85, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.18, bevelSegments: 12, curveSegments: 40 });
    bodyGeo.center();
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0.04, transmission: 1, thickness: 1.2, ior: 1.52,
      attenuationColor: new THREE.Color(0xcfdcff), attenuationDistance: 2.6, clearcoat: 1, clearcoatRoughness: 0.03,
      iridescence: 0.45, iridescenceIOR: 1.35, iridescenceThicknessRange: [120, 420], specularIntensity: 1, envMapIntensity: 1.5
    });
    const body = new THREE.Mesh(bodyGeo, glass); body.position.y = -0.62; lockG.add(body);

    const keyMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9db9ff), toneMapped: false });
    const keyGeo = new THREE.ExtrudeGeometry(keyholeShape(), { depth: 0.18, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 4, curveSegments: 24 });
    keyGeo.center();
    const key = new THREE.Mesh(keyGeo, keyMat); key.position.set(0, -0.68, 0.05); lockG.add(key);
    const gc = document.createElement('canvas'); gc.width = gc.height = 128;
    const gx = gc.getContext('2d'); const gg = gx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gg.addColorStop(0, 'rgba(255,255,255,0.9)'); gg.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
    gx.fillStyle = gg; gx.fillRect(0, 0, 128, 128);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), color: 0x9db9ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    halo.scale.set(1.9, 1.9, 1); halo.position.set(0, -0.68, 0.3); lockG.add(halo);

    const chrome = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 3.2 });
    const R = 0.66, tube = 0.165, legTop = 0.85, legLen = 0.95;
    const pivot = new THREE.Group(); pivot.position.x = R; lockG.add(pivot);
    const shackle = new THREE.Group(); shackle.position.x = -R; pivot.add(shackle);
    const arc = new THREE.Mesh(new THREE.TorusGeometry(R, tube, 40, 120, Math.PI), chrome); arc.position.y = legTop; shackle.add(arc);
    [-R, R].forEach(x => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(tube, tube, legLen, 40), chrome);
      leg.position.set(x, legTop - legLen / 2, 0); shackle.add(leg);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(tube, 32, 16), chrome); cap.position.set(x, legTop - legLen, 0); shackle.add(cap);
    });

    // soft contact shadow
    const sc = document.createElement('canvas'); sc.width = sc.height = 128;
    const g = sc.getContext('2d'); const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
    shadow.position.set(0, -1.95, -0.2); shadow.rotation.x = -Math.PI / 2.4; root.add(shadow);

    let running = true, px = 0, py = 0, open = 0, openTarget = 0, punch = 0, state = 'idle', t0 = performance.now(), last = t0;
    const cols = STATE_COL.idle.map(c => new THREE.Color(c));
    const tgt = STATE_COL.idle.map(c => new THREE.Color(c));
    window.addEventListener('pointermove', e => { px = e.clientX / window.innerWidth - 0.5; py = e.clientY / window.innerHeight - 0.5; });
    window.addEventListener('deviceorientation', e => { if (e.gamma != null) { px = Math.max(-0.5, Math.min(0.5, e.gamma / 60)); py = Math.max(-0.5, Math.min(0.5, (e.beta - 45) / 80)); } });

    function resize() {
      const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      const vh = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
      const vw = vh * camera.aspect;
      const L = layout ? layout(w, h) : { x: 0, y: 0, size: 0.5 };
      tpos.set(L.x * vw, L.y * vh, 0);
      tscale = (L.size * vh) / 3.2;
      if (first) { root.position.copy(tpos); root.scale.setScalar(tscale); first = false; }
      const bh = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (camera.position.z - bg.position.z);
      bg.scale.set(bh * camera.aspect * 1.02, bh * 1.02, 1);
      field.u.aspect.value = camera.aspect;
    }
    const tpos = new THREE.Vector3(); let tscale = 1, first = true;
    window.addEventListener('resize', resize); resize();

    function frame(now) {
      if (!running) return;
      requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const t = (now - t0) / 1000;
      field.u.t.value = t * (state === 'scan' ? 4 : 1);
      for (let i = 0; i < 4; i++) cols[i].lerp(tgt[i], 0.05);
      field.u.c1.value.copy(cols[0]); field.u.c2.value.copy(cols[1]); field.u.c3.value.copy(cols[2]);
      const pulse = state === 'scan' ? 0.75 + Math.sin(t * 10) * 0.25 : state === 'lock' ? 0.8 + Math.sin(t * 6) * 0.3 : 0.9 + Math.sin(t * 1.6) * 0.08;
      keyMat.color.copy(cols[3]).multiplyScalar(0.55 + pulse * 0.6);
      halo.material.color.copy(cols[3]); halo.material.opacity = 0.35 + pulse * 0.4;
      open += (openTarget - open) * Math.min(1, dt * 7);
      pivot.position.y = open * 0.5;
      pivot.rotation.y = -open * 1.15;
      punch *= 0.9;
      lockG.scale.setScalar(1 + punch * 0.06);
      const sway = state === 'lock' ? Math.sin(t * 30) * 0.02 * Math.max(0, Math.sin(t * 2)) : 0;
      root.rotation.y += ((px * 0.7 + Math.sin(t * 0.35) * 0.18 + sway) - root.rotation.y) * 0.05;
      root.rotation.x += ((py * 0.35 + 0.08) - root.rotation.x) * 0.05;
      root.position.lerp(tpos, Math.min(1, dt * 4));
      root.scale.setScalar(root.scale.x + (tscale - root.scale.x) * Math.min(1, dt * 4));
      lockG.position.y = Math.sin(t * 1.1) * 0.06;
      shadow.material.opacity = 0.8 - lockG.position.y * 2;
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);

    return {
      setState(s) { state = s; (STATE_COL[s] || STATE_COL.idle).forEach((c, i) => tgt[i].set(c)); },
      setOpen(o) { openTarget = o ? 1 : 0; },
      snap() { openTarget = 0; punch = 1; },
      relayout: resize,
      pause() { running = false; },
      resume() { if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); } }
    };
  }

  return { lock, has3D };
})();
