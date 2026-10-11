// Optional WebGL backdrop for the machine-select screen (stars, drifting wireframe solids and
// a perspective grid). Three.js is loaded on demand; when it is unavailable the CSS backdrop stays.

export async function startBackdrop(canvas) {
  let THREE;
  try { THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'); } catch { return null; }
  if (!canvas.isConnected) return null;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch { return null; }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05070f, 0.012);
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
  cam.position.set(0, 4, 40);

  const N = 2400, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 260; pos[i * 3 + 1] = (Math.random() - 0.5) * 150; pos[i * 3 + 2] = -Math.random() * 300 + 40; }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xbfd8ff, size: 0.55, transparent: true, opacity: 0.9, sizeAttenuation: true });
  scene.add(new THREE.Points(starGeo, starMat));

  const accent = new THREE.Color(0x3a8cff), target = new THREE.Color(0x3a8cff);
  const solids = [];
  const geos = [new THREE.IcosahedronGeometry(5, 0), new THREE.OctahedronGeometry(4, 0), new THREE.TorusKnotGeometry(3, 0.9, 64, 8), new THREE.BoxGeometry(5, 5, 5), new THREE.DodecahedronGeometry(4, 0), new THREE.TorusGeometry(4, 1.2, 8, 20)];
  for (let i = 0; i < 9; i++) {
    const mat = new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.28 });
    const m = new THREE.LineSegments(new THREE.WireframeGeometry(geos[i % geos.length]), mat);
    const a = (i / 9) * Math.PI * 2, r = 34 + (i % 3) * 14;
    m.position.set(Math.cos(a) * r, (i % 4) * 7 - 8, -30 - Math.sin(a) * 26 - (i % 2) * 20);
    m.userData = { rx: 0.1 + Math.random() * 0.3, ry: 0.1 + Math.random() * 0.3, ph: Math.random() * 6 };
    solids.push(m); scene.add(m);
  }
  const grid = new THREE.GridHelper(600, 90, 0x3a8cff, 0x16213f);
  grid.position.y = -22; grid.material.transparent = true; grid.material.opacity = 0.35;
  scene.add(grid);

  let raf = 0, alive = true, mx = 0, my = 0, warp = 0, last = performance.now();
  const onMove = e => { mx = (e.clientX / innerWidth - 0.5) * 2; my = (e.clientY / innerHeight - 0.5) * 2; };
  window.addEventListener('pointermove', onMove);
  const resize = () => { const w = canvas.clientWidth, hh = canvas.clientHeight; if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(hh * renderer.getPixelRatio())) { renderer.setSize(w, hh, false); cam.aspect = w / Math.max(1, hh); cam.updateProjectionMatrix(); } };
  const loop = now => {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    resize();
    accent.lerp(target, 0.04);
    const speed = 6 + warp * 420;
    const p = starGeo.attributes.position.array;
    for (let i = 2; i < p.length; i += 3) { p[i] += speed * dt; if (p[i] > 40) p[i] -= 300; }
    starGeo.attributes.position.needsUpdate = true;
    starMat.size = 0.55 + warp * 1.6;
    for (const s of solids) { s.rotation.x += s.userData.rx * dt; s.rotation.y += s.userData.ry * dt; s.position.y += Math.sin(now / 1400 + s.userData.ph) * 0.006; s.material.color.copy(accent); }
    grid.position.z = (grid.position.z + speed * dt * 0.6) % (600 / 90);
    grid.material.color.copy(accent);
    cam.position.x += (mx * 5 - cam.position.x) * 0.04;
    cam.position.y += (4 - my * 3 - cam.position.y) * 0.04;
    cam.fov = 60 + warp * 35; cam.updateProjectionMatrix();
    cam.lookAt(0, 0, -30);
    renderer.render(scene, cam);
  };
  raf = requestAnimationFrame(loop);
  return {
    tint(hex) { target.set(hex); },
    warp(on) { const t0 = performance.now(); const step = () => { if (!alive) return; warp = Math.min(1, (performance.now() - t0) / 700) * (on ? 1 : 0); if (on && warp < 1) requestAnimationFrame(step); }; step(); },
    stop() { alive = false; cancelAnimationFrame(raf); window.removeEventListener('pointermove', onMove); renderer.dispose(); },
  };
}
