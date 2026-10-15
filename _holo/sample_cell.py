"""Samples the animal-cell model of the HoloCell project (Desktop/HTML/Biology/holo-cell, organelles built
to real proportions: nucleus + pores, rough/smooth ER, Golgi stack, mitochondria with cristae, centrioles,
lysosomes, vesicles) into a point cloud for the hologram.  Output: _holo/ref/cell_points.json
Run: python _holo/sample_cell.py"""
import asyncio, json, os, threading, functools, http.server
from playwright.async_api import async_playwright
HC = r'C:\Users\Windows 10\Desktop\HTML\Biology\holo-cell'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ref', 'cell_points.json')

JS = r"""(budget) => {
  const THREE = window.__THREE;
  const cell = window.__cell;
  if (!cell) return { err: 'no cell group', keys: Object.keys(window.app) };
  cell.updateMatrixWorld(true);
  const items = [];
  const col = m => {
    if (!m) return null; if (Array.isArray(m)) m = m[0];
    if (m.visible === false) return null;
    const c = m.color || (m.uniforms && (m.uniforms.uColor || m.uniforms.color || m.uniforms.uTint) && (m.uniforms.uColor || m.uniforms.color || m.uniforms.uTint).value);
    return c && c.isColor ? [c.r, c.g, c.b] : [0.6, 0.85, 1];
  };
  const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), m4 = new THREE.Matrix4(), w = new THREE.Matrix4();
  cell.traverse(o => {
    if (!o.visible) return;
    let p = o; while (p) { if (p.visible === false) return; p = p.parent; }
    const g = o.geometry; if (!g || !g.attributes || !g.attributes.position) return;
    const color = col(o.material); if (!color) return;
    const pos = g.attributes.position, idx = g.index;
    if (o.isInstancedMesh) {
      g.computeBoundingSphere();
      const r = g.boundingSphere.radius;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m4); w.multiplyMatrices(o.matrixWorld, m4); v.setFromMatrixPosition(w);
        items.push({ kind: 'inst', name: o.name || o.parent.name, color, p: [v.x, v.y, v.z], r });
      }
      return;
    }
    if (o.isLine || o.isLineSegments || o.isPoints) {
      const step = Math.max(1, Math.floor(pos.count / 400));
      for (let i = 0; i < pos.count; i += step) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); items.push({ kind: 'line', name: o.name || o.parent.name, color, p: [v.x, v.y, v.z] }); }
      return;
    }
    // surface: area-weighted samples
    const tri = idx ? idx.count / 3 : pos.count / 3, areas = []; let A = 0;
    for (let t = 0; t < tri; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
      const ar = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2; areas.push([ar, a.clone(), b.clone(), c.clone()]); A += ar;
    }
    items.push({ kind: 'surf', name: o.name || o.parent.name, color, area: A, tris: areas.map(x => [x[0], x[1].toArray(), x[2].toArray(), x[3].toArray()]) });
  });
  // budget split: surfaces by area^0.55, instances keep centres (capped), lines keep vertices
  const surfs = items.filter(i => i.kind === 'surf'), pts = [];
  items.filter(i => i.kind !== 'surf').forEach(i => pts.push([...i.p, ...i.color]));
  const left = Math.max(1000, budget - Math.min(pts.length, budget * 0.35));
  const wsum = surfs.reduce((s, x) => s + Math.pow(x.area, 0.55), 0);
  for (const s of surfs) {
    const k = Math.max(12, Math.round(left * Math.pow(s.area, 0.55) / wsum));
    const cum = []; let acc = 0; for (const t of s.tris) { acc += t[0]; cum.push(acc); }
    for (let j = 0; j < k; j++) {
      const r = Math.random() * acc; let lo = 0, hi = cum.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
      const t = s.tris[lo]; let u = Math.random(), q = Math.random(); if (u + q > 1) { u = 1 - u; q = 1 - q; }
      const x = t[1][0] + (t[2][0] - t[1][0]) * u + (t[3][0] - t[1][0]) * q, y = t[1][1] + (t[2][1] - t[1][1]) * u + (t[3][1] - t[1][1]) * q, z = t[1][2] + (t[2][2] - t[1][2]) * u + (t[3][2] - t[1][2]) * q;
      pts.push([x, y, z, ...s.color]);
    }
  }
  return { n: pts.length, surfaces: surfs.length, inst: items.filter(i => i.kind === 'inst').length, pts };
}"""

def serve():
    H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=HC); H.log_message = lambda *a: None
    s = http.server.ThreadingHTTPServer(('127.0.0.1', 8799), H); threading.Thread(target=s.serve_forever, daemon=True).start(); return s

async def main():
    srv = serve()
    async with async_playwright() as pw:
        br = await pw.chromium.launch(channel='chrome', headless=True, args=['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'])
        p = await br.new_page(viewport={'width': 800, 'height': 600})
        p.on('pageerror', lambda e: print('PAGEERROR', e))
        page_html = '''<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"../vendor/three/build/three.module.js","three/addons/":"../vendor/three/jsm/"}}</script></head><body>
<script type="module">
import * as THREE from 'three';
import { buildCell } from '../js/cellScene.js';
window.__THREE = THREE;
const c = buildCell(); window.__cell = c.group;
</script></body></html>'''
        await p.route('**/_qa/sample.html', lambda r: r.fulfill(status=200, content_type='text/html', body=page_html))
        await p.goto('http://127.0.0.1:8799/_qa/sample.html')
        await p.wait_for_function('!!window.__cell', timeout=90000)
        res = await p.evaluate(JS, 14000)
        if 'err' in res: print(res); return
        print('points', res['n'], 'surfaces', res['surfaces'], 'instances', res['inst'])
        json.dump(res['pts'], open(OUT, 'w'))
        await br.close()
    srv.shutdown()
asyncio.run(main())
