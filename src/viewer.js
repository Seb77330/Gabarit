// Vue 3D : affichage de la pièce, des esquisses, sélection de faces et d'arêtes.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export class Viewer {
  constructor(host) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(160, -220, 140);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.15;
    this.controls.screenSpacePanning = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
    const d1 = new THREE.DirectionalLight(0xffffff, 1.4); d1.position.set(1, -1.5, 2); this.camera.add(d1);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.5); d2.position.set(-2, 1, -1); this.camera.add(d2);
    this.scene.add(this.camera);
    this.part = new THREE.Group(); this.scene.add(this.part);
    this.overlay = new THREE.Group(); this.scene.add(this.overlay);
    this.helpers = new THREE.Group(); this.scene.add(this.helpers);
    this.mat = new THREE.MeshStandardMaterial({ color: 0xc9d1da, metalness: 0.1, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide });
    this.hoverMat = new THREE.MeshStandardMaterial({ color: 0xe0874f, metalness: 0.1, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: 0.5, polygonOffsetUnits: 0.5, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    this.selMat = this.hoverMat.clone(); this.selMat.color.set(0xc4552b); this.selMat.opacity = 0.95;
    this.edgeMat = new THREE.LineBasicMaterial({ color: 0x23272e });
    this.edgeHot = new THREE.LineBasicMaterial({ color: 0xd9541e, linewidth: 3 });
    this.edgeSel = new THREE.LineBasicMaterial({ color: 0xc4251b });
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.pickMode = null; // { kind: "face" | "edge" | "point", onPick }
    this.data = null; this.size = 100;
    this.markers = [];
    this.addAxes();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
    el.addEventListener("pointermove", (e) => this.onMove(e));
    el.addEventListener("pointerup", (e) => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) this.onClick(e); down = null; });
    el.addEventListener("pointerleave", () => this.clearHover());
    const loop = () => { this.controls.update(); this.renderer.render(this.scene, this.camera); requestAnimationFrame(loop); };
    loop();
  }
  resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false); this.renderer.domElement.style.width = w + "px"; this.renderer.domElement.style.height = h + "px";
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  addAxes() {
    this.helpers.clear();
    const s = this.size * 0.25;
    const mk = (dir, col) => {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(...dir).multiplyScalar(s)]);
      return new THREE.Line(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.8 }));
    };
    this.helpers.add(mk([1, 0, 0], 0xd23f3f), mk([0, 1, 0], 0x3d9a4a), mk([0, 0, 1], 0x3a6fd8));
  }
  setMesh(data) {
    this.part.clear(); this.data = data; this.faceMeshes = new Map(); this.edgeObjs = [];
    if (!data) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(data.vertices, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(data.triangles, 1));
    for (const g of data.faceGroups) geo.addGroup(g.start, g.count, 0);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.part.add(this.mesh);
    const L = data.lines;
    for (const g of data.edgeGroups) {
      const pts = L.slice(g.start * 3, (g.start + g.count) * 3);
      const eg = new THREE.BufferGeometry(); eg.setAttribute("position", new THREE.BufferAttribute(pts, 3));
      const ln = new THREE.LineSegments(eg, this.edgeMat); ln.userData = { edgeId: g.edgeId, pts };
      this.part.add(ln); this.edgeObjs.push(ln);
    }
    const [a, b] = data.bb;
    const size = Math.max(10, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    if (Math.abs(size - this.size) / this.size > 0.5) { this.size = size; this.addAxes(); }
    this.size = size;
    this.raycaster.params.Line.threshold = size / 150;
    this.refreshMarkers();
  }
  faceGeometry(faceId) {
    const g = this.data.faceGroups.find((x) => x.faceId === faceId); if (!g) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", this.geo.getAttribute("position"));
    geo.setAttribute("normal", this.geo.getAttribute("normal"));
    geo.setIndex(new THREE.BufferAttribute(this.data.triangles.slice(g.start, g.start + g.count), 1));
    return geo;
  }
  fit(dir) {
    const bb = this.data ? this.data.bb : [[-50, -50, 0], [50, 50, 50]];
    const c = new THREE.Vector3((bb[0][0] + bb[1][0]) / 2, (bb[0][1] + bb[1][1]) / 2, (bb[0][2] + bb[1][2]) / 2);
    const r = Math.max(10, Math.hypot(bb[1][0] - bb[0][0], bb[1][1] - bb[0][1], bb[1][2] - bb[0][2]) / 2);
    const v = dir ? new THREE.Vector3(...dir).normalize() : this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = r / Math.sin((this.camera.fov * Math.PI / 180) / 2) * 1.15;
    this.controls.target.copy(c);
    this.camera.position.copy(c.clone().add(v.multiplyScalar(dist)));
    if (dir && Math.abs(dir[2]) > 0.99) this.camera.up.set(0, dir[2] > 0 ? 1 : -1, 0); else this.camera.up.set(0, 0, 1);
    this.camera.near = dist / 100; this.camera.far = dist * 100; this.camera.updateProjectionMatrix();
    this.controls.update();
  }
  // Esquisses affichées en 3D (contours dans leur plan).
  setOverlay(list) {
    this.overlay.clear();
    for (const s of list) {
      const pts = [];
      for (const loop of s.loops) for (let i = 0; i < loop.length; i++) { pts.push(loop[i], loop[(i + 1) % loop.length]); }
      if (!pts.length) continue;
      const g = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p)));
      this.overlay.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: s.active ? 0xc4552b : 0x2f6fb5, depthTest: false, transparent: true, opacity: s.active ? 1 : 0.7 })));
    }
  }
  setMarkers(points, color = 0xc4251b) { this.markers = points.map((p) => ({ p, color })); this.refreshMarkers(); }
  refreshMarkers() {
    if (this.markerGroup) this.scene.remove(this.markerGroup);
    this.markerGroup = new THREE.Group();
    const r = this.size / 160;
    for (const m of this.markers) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ color: m.color, depthTest: false }));
      s.position.set(...m.p); s.renderOrder = 10; this.markerGroup.add(s);
    }
    this.scene.add(this.markerGroup);
  }
  setPick(mode) { this.pickMode = mode; this.clearHover(); this.renderer.domElement.style.cursor = mode ? "crosshair" : ""; }
  ray(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.mouse, this.camera);
  }
  hitFace(e) {
    if (!this.mesh) return null;
    this.ray(e);
    const h = this.raycaster.intersectObject(this.mesh)[0]; if (!h) return null;
    const idx = h.faceIndex * 3;
    const g = this.data.faceGroups.find((x) => idx >= x.start && idx < x.start + x.count);
    return g ? { faceId: g.faceId, point: h.point.toArray(), info: this.data.faces[g.faceId] || null } : null;
  }
  hitEdge(e) {
    if (!this.edgeObjs?.length) return null;
    this.ray(e);
    const hs = this.raycaster.intersectObjects(this.edgeObjs);
    if (!hs.length) return null;
    const faceHit = this.mesh ? this.raycaster.intersectObject(this.mesh)[0] : null;
    // garde l'arête visible (pas cachée derrière la pièce)
    const h = hs.find((x) => !faceHit || x.distance <= faceHit.distance + this.size / 200) || null;
    if (!h) return null;
    // point de l'arête le plus proche du clic, projeté sur la polyligne
    const pts = h.object.userData.pts; let best = null, bd = Infinity;
    const P = h.point; const a = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Vector3();
    for (let i = 0; i + 5 < pts.length + 0; i += 6) {
      a.set(pts[i], pts[i + 1], pts[i + 2]); b.set(pts[i + 3], pts[i + 4], pts[i + 5]);
      const ab = b.clone().sub(a); const t = Math.max(0, Math.min(1, P.clone().sub(a).dot(ab) / (ab.lengthSq() || 1)));
      q.copy(a).add(ab.multiplyScalar(t)); const d = q.distanceTo(P); if (d < bd) { bd = d; best = q.clone(); }
    }
    // point au milieu du segment touché pour éviter les extrémités ambiguës
    return { obj: h.object, point: (best || P).toArray() };
  }
  clearHover() {
    if (this.hoverObj) { this.part.remove(this.hoverObj); this.hoverObj = null; }
    if (this.hoverEdge) { this.hoverEdge.material = this.edgeMat; this.hoverEdge = null; }
  }
  onMove(e) {
    if (!this.pickMode) return;
    this.clearHover();
    if (this.pickMode.kind === "edge") {
      const h = this.hitEdge(e); if (h) { this.hoverEdge = h.obj; h.obj.material = this.edgeHot; }
    } else {
      const h = this.hitFace(e);
      if (h && (!this.pickMode.planarOnly || h.info?.plane)) {
        const geo = this.faceGeometry(h.faceId); if (geo) { this.hoverObj = new THREE.Mesh(geo, this.hoverMat); this.part.add(this.hoverObj); }
      }
    }
  }
  onClick(e) {
    if (!this.pickMode) return;
    if (this.pickMode.kind === "edge") { const h = this.hitEdge(e); if (h) this.pickMode.onPick(h); }
    else { const h = this.hitFace(e); if (h) this.pickMode.onPick(h); }
  }
  snapshot() { return this.renderer.domElement.toDataURL("image/png"); }
}
