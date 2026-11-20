// Vue 3D : affichage de la pièce, des esquisses, sélection de faces et d'arêtes.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

// Sol : quadrillage qui s'estompe au loin et ombre douce sous la pièce.
const GROUND_VS = `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const GROUND_FS = `
varying vec3 vW;
uniform float uStep, uFade, uShadow, uSoft, uAlpha;
uniform vec2 uCenter, uHalf;
uniform vec3 uLine;
float grid(vec2 p, float s) { vec2 c = p / s; vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c); return 1.0 - min(min(g.x, g.y), 1.0); }
void main() {
  vec2 p = vW.xy;
  float fade = 1.0 - smoothstep(uFade * 0.3, uFade, length(p - uCenter));
  float a = max(grid(p, uStep) * 0.2, grid(p, uStep * 10.0) * 0.5) * fade * uAlpha;
  vec2 q = abs(p - uCenter) - uHalf;
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float sh = uShadow * (1.0 - smoothstep(-uSoft * 0.25, uSoft, sd));
  float alpha = a + sh * (1.0 - a);
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(uLine * a / alpha, alpha);
}`;

// arcs pour tourner : rayon et étendue (en unités de poignée, 1 = longueur d'une flèche)
const RING_R = 0.7, RING_A0 = 16 * Math.PI / 180, RING_A1 = 74 * Math.PI / 180;
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
    // souris : molette = zoom, clic molette (ou clic gauche) = tourner, Ctrl + molette cliquée ou clic droit glissé = déplacer
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    // lumière : ambiance douce (reflets d'un studio) + deux lampes qui suivent la caméra
    try { const pm = new THREE.PMREMGenerator(this.renderer); this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; this.scene.environmentIntensity = 0.32; pm.dispose(); } catch { /* sans reflets */ }
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, this.scene.environment ? 0.55 : 1.6));
    const d1 = new THREE.DirectionalLight(0xffffff, this.scene.environment ? 1.05 : 1.4); d1.position.set(1, -1.5, 2); this.camera.add(d1);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.4); d2.position.set(-2, 1, -1); this.camera.add(d2);
    this.scene.add(this.camera);
    this.part = new THREE.Group(); this.scene.add(this.part);
    this.overlay = new THREE.Group(); this.scene.add(this.overlay);
    this.helpers = new THREE.Group(); this.scene.add(this.helpers);
    this.mat = new THREE.MeshStandardMaterial({ color: 0xc3ccd7, metalness: 0.18, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide });
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
    this.handles = []; this.handleGroup = null; this.drag = null; this.tmpV = new THREE.Vector3();
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, vertexShader: GROUND_VS, fragmentShader: GROUND_FS,
      uniforms: { uStep: { value: 10 }, uFade: { value: 300 }, uShadow: { value: 0.2 }, uSoft: { value: 20 }, uAlpha: { value: 1 }, uCenter: { value: new THREE.Vector2() }, uHalf: { value: new THREE.Vector2() }, uLine: { value: new THREE.Color(0x6f7a89) } },
    }));
    this.ground.renderOrder = -1; this.scene.add(this.ground); this.shadowK = 0.2; this.updateGround();
    this.addAxes();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
    const el = this.renderer.domElement;
    // flèches à tirer : elles passent avant la rotation de la vue
    el.addEventListener("pointerdown", (e) => this.handleDown(e), true);
    el.addEventListener("pointermove", (e) => this.handleMove(e), true);
    el.addEventListener("pointerup", (e) => this.handleUp(e), true);
    el.addEventListener("pointercancel", (e) => this.handleUp(e), true);
    let down = null;
    el.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY, e.button]; });
    el.addEventListener("pointermove", (e) => this.onMove(e));
    el.addEventListener("pointerup", (e) => {
      if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) { if (down[2] === 2) this.onContext?.(e); else if (down[2] === 0) this.onClick(e); }
      down = null;
    });
    el.addEventListener("pointerleave", () => this.clearHover());
    this.sketchCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100000);
    this.sketchCam.add(d1.clone(), d2.clone()); this.scene.add(this.sketchCam);
    this.sketchView = null;
    const loop = () => {
      if (!this.sketchView) this.controls.update();
      // le sol disparaît pendant l'esquisse, et s'efface quand on regarde la pièce par-dessous
      const below = this.camera.position.z < this.ground.position.z;
      this.ground.visible = !this.sketchView;
      this.ground.material.uniforms.uAlpha.value = below ? 0.3 : 1; this.ground.material.uniforms.uShadow.value = below || !this.hasBox ? 0 : this.shadowK;
      if (this.handleGroup) {
        this.handleGroup.visible = !this.sketchView;
        const px = 2 * Math.tan(this.camera.fov * Math.PI / 360) / (this.renderer.domElement.clientHeight || 1); // taille d'un pixel à 1 mm de distance
        for (const g of this.handles) { g.getWorldPosition(this.tmpV); g.scale.setScalar(Math.max(1e-6, this.tmpV.distanceTo(this.camera.position) * px * 104)); }
      }
      this.renderer.render(this.scene, this.sketchView ? this.sketchCam : this.camera); this.updateCube(); requestAnimationFrame(loop);
    };
    loop();
  }
  // Place le sol sous la pièce (ou à Z = 0 quand il n'y a rien) et règle la taille des carreaux.
  updateGround(known) {
    const g = this.ground; if (!g) return;
    let box = known || null;
    if (!box && (this.mesh || this.asm?.size)) box = new THREE.Box3().setFromObject(this.part);
    if (box?.isEmpty()) box = null;
    const size = box ? Math.max(10, box.getSize(new THREE.Vector3()).length()) : 120;
    const c = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const u = g.material.uniforms;
    const step = Math.pow(10, Math.round(Math.log10(size / 14)));
    u.uStep.value = step; u.uFade.value = Math.max(size * 2.4, step * 14); u.uSoft.value = size * 0.18;
    u.uCenter.value.set(c.x, c.y);
    if (box) u.uHalf.value.set((box.max.x - box.min.x) / 2, (box.max.y - box.min.y) / 2); else u.uHalf.value.set(0, 0);
    this.hasBox = !!box;
    g.position.set(c.x, c.y, (box ? box.min.z : 0) - size * 0.0015); g.scale.setScalar(u.uFade.value * 2.2);
  }
  setTheme(dark) {
    this.dark = !!dark;
    this.ground.material.uniforms.uLine.value.set(dark ? 0xa9b8cc : 0x6f7a89);
    this.shadowK = dark ? 0.45 : 0.2;
    this.edgeMat.color.set(dark ? 0x0d1218 : 0x23272e);
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
    this.part.clear(); this.selFaceObj = null; this.asm = null; this.asmBox = null; this.data = data; this.faceMeshes = new Map(); this.edgeObjs = [];
    if (!data) { this.mesh = null; this.updateGround(); return; }
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
    this.refreshMarkers(); this.updateGround();
  }
  faceGeometry(faceId) {
    const g = this.data.faceGroups.find((x) => x.faceId === faceId); if (!g) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", this.geo.getAttribute("position"));
    geo.setAttribute("normal", this.geo.getAttribute("normal"));
    geo.setIndex(new THREE.BufferAttribute(this.data.triangles.slice(g.start, g.start + g.count), 1));
    return geo;
  }
  fit(dir, box) {
    const pb = this.printDown && this.mesh ? new THREE.Box3().setFromObject(this.part) : null;
    const bb = box ? box : pb ? [pb.min.toArray(), pb.max.toArray()] : this.data ? this.data.bb : this.asmBox ? [this.asmBox.min.toArray(), this.asmBox.max.toArray()] : [[-50, -50, 0], [50, 50, 50]];
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
  // Flèches à tirer dans la vue. Chaque poignée : { id, origin, dir, color } (flèche) ou { …, ring: true }
  // (arc pour tourner autour de dir). Pendant qu'on tire, onDrag(id, distance le long de la flèche ou
  // angle en degrés, "move" | "end", événement) renvoie la valeur retenue.
  setHandles(list, onDrag) {
    if (this.drag) return;
    if (this.handleGroup) { this.scene.remove(this.handleGroup); this.handleGroup.traverse((o) => o.geometry?.dispose()); }
    this.handles = []; this.handleGroup = null; this.onHandle = onDrag; this.hotHandle = null;
    if (!list?.length) return;
    this.handleGroup = new THREE.Group();
    const up = new THREE.Vector3(0, 1, 0);
    const rings = list.filter((hd) => hd.ring);
    for (const hd of list) {
      if (hd.ring) continue;
      const g = new THREE.Group(); g.position.set(...hd.origin);
      const dir = new THREE.Vector3(...hd.dir).normalize(); g.quaternion.setFromUnitVectors(up, dir);
      const mat = new THREE.MeshBasicMaterial({ color: hd.color ?? 0xc4552b, depthTest: false, transparent: true, opacity: 0.92 });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.74, 12), mat); shaft.position.y = 0.37;
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.115, 0.3, 24), mat); tip.position.y = 0.88;
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.0, 8), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 0.56;
      shaft.renderOrder = tip.renderOrder = 30;
      g.add(shaft, tip, hit); g.userData = { hd, mat, hit, dir, color: mat.color.getHex() };
      this.handleGroup.add(g); this.handles.push(g);
    }
    // arcs pour tourner : un quart de cercle autour de l'axe, à tirer comme un volant
    const zAxis = new THREE.Vector3(0, 0, 1);
    for (const hd of rings) {
      const g = new THREE.Group(); g.position.set(...hd.origin);
      const dir = new THREE.Vector3(...hd.dir).normalize();
      if (hd.u) { const u = new THREE.Vector3(...hd.u).normalize(); g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, new THREE.Vector3().crossVectors(dir, u), dir)); } // l'arc part de u
      else g.quaternion.setFromUnitVectors(zAxis, dir);
      const mat = new THREE.MeshBasicMaterial({ color: hd.color ?? 0xc4552b, depthTest: false, transparent: true, opacity: 0.92 });
      // l'arc laisse un peu de place de chaque côté, pour ne pas toucher les flèches
      const arc = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.024, 8, 36, RING_A1 - RING_A0), mat); arc.rotation.z = RING_A0; arc.renderOrder = 30;
      const ends = [RING_A0, RING_A1].map((a) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), mat); m.position.set(RING_R * Math.cos(a), RING_R * Math.sin(a), 0); m.renderOrder = 30; return m; });
      const hit = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.085, 6, 24, RING_A1 - RING_A0), new THREE.MeshBasicMaterial({ visible: false })); hit.rotation.z = RING_A0;
      g.add(arc, ...ends, hit); g.userData = { hd, mat, hit, dir, ring: true, color: mat.color.getHex() };
      this.handleGroup.add(g); this.handles.push(g);
    }
    this.scene.add(this.handleGroup);
  }
  handleAt(e) {
    if (!this.handles.length || this.sketchView) return null;
    this.ray(e);
    const hits = this.raycaster.intersectObjects(this.handles.map((g) => g.userData.hit), false);
    if (!hits.length) return null;
    // plusieurs poignées sous la souris : on garde celle dont le trait passe le plus près du pointeur
    const cands = [...new Set(hits.map((h) => h.object.parent))]; if (cands.length === 1) return cands[0];
    const ray = this.raycaster.ray; const P = new THREE.Vector3(); let best = null, bd = Infinity;
    for (const g of cands) {
      const o = g.getWorldPosition(new THREE.Vector3()); const sc = g.scale.x; let d = Infinity;
      if (g.userData.ring) {
        const u = new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion), v = new THREE.Vector3(0, 1, 0).applyQuaternion(g.quaternion);
        for (let i = 0; i <= 12; i++) { const a = RING_A0 + (RING_A1 - RING_A0) * i / 12; P.copy(o).addScaledVector(u, RING_R * sc * Math.cos(a)).addScaledVector(v, RING_R * sc * Math.sin(a)); d = Math.min(d, ray.distanceToPoint(P)); }
      } else for (let i = 0; i <= 10; i++) { P.copy(o).addScaledVector(g.userData.dir, sc * (0.06 + i / 10)); d = Math.min(d, ray.distanceToPoint(P)); }
      d /= sc; if (d < bd) { bd = d; best = g; }
    }
    return best;
  }
  // distance le long de la flèche du point le plus proche du rayon de la souris
  handleT(e, o, d) {
    this.ray(e); const P = this.raycaster.ray.origin, V = this.raycaster.ray.direction;
    const w = o.clone().sub(P); const b = d.dot(V), dd = d.dot(w), ee = V.dot(w); const den = 1 - b * b;
    return den < 1e-4 ? null : (b * ee - dd) / den;
  }
  handleDown(e) {
    if (e.button !== 0) return;
    const g = this.handleAt(e); if (!g) return;
    e.stopImmediatePropagation(); e.preventDefault();
    const o = g.getWorldPosition(new THREE.Vector3());
    if (g.userData.ring) {
      // volant : on suit la souris autour de l'axe. Vu de face, l'arc reste sous le pointeur ; vu par la
      // tranche, on suit la souris le long de la tangente, là où l'arc a été saisi.
      const dir = g.userData.dir; const R = RING_R * g.scale.x;
      const u = new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion), v = new THREE.Vector3(0, 1, 0).applyQuaternion(g.quaternion);
      const d = { g, o, ring: true, q0: g.quaternion.clone(), pid: e.pointerId, applied: 0, acc: 0, px: e.clientX, py: e.clientY };
      const angle = (ev) => {
        this.ray(ev); const ray = this.raycaster.ray; const den = ray.direction.dot(dir); if (Math.abs(den) < 1e-6) return null;
        const t = o.clone().sub(ray.origin).dot(dir) / den; if (t <= 0) return null;
        const q = ray.origin.clone().addScaledVector(ray.direction, t).sub(o); return Math.atan2(q.dot(v), q.dot(u)) * 180 / Math.PI;
      };
      this.ray(e);
      if (Math.abs(this.raycaster.ray.direction.dot(dir)) > 0.25 && angle(e) !== null) { d.angle = angle; d.a = angle(e); }
      else {
        const hitP = this.raycaster.intersectObject(g.userData.hit, false)[0]?.point; if (!hitP) return;
        const rad = hitP.clone().sub(o); rad.addScaledVector(dir, -rad.dot(dir)).setLength(R); // ramené sur le cercle
        const p0 = o.clone().add(rad); const tan = new THREE.Vector3().crossVectors(dir, rad).normalize();
        const r = this.renderer.domElement.getBoundingClientRect();
        const scr = (w) => { const q = w.clone().project(this.camera); return [(q.x + 1) / 2 * r.width, (1 - q.y) / 2 * r.height]; };
        const eps = R * 0.05; const a = scr(p0), b = scr(p0.clone().addScaledVector(tan, eps));
        const tx = b[0] - a[0], ty = b[1] - a[1]; const len = Math.hypot(tx, ty); if (len < 1e-6) return;
        Object.assign(d, { x0: e.clientX, y0: e.clientY, tx: tx / len, ty: ty / len, pxPerDeg: Math.max(0.35, (len / eps) * R * Math.PI / 180) });
      }
      this.drag = d;
    } else {
      const t0 = this.handleT(e, o, g.userData.dir);
      if (t0 === null) return;
      this.drag = { g, o, t0, pid: e.pointerId, applied: 0, px: e.clientX, py: e.clientY };
    }
    try { this.renderer.domElement.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    this.renderer.domElement.style.cursor = "grabbing";
  }
  handleMove(e) {
    if (this.drag) {
      e.stopImmediatePropagation();
      if (this.drag.ring) {
        const d = this.drag; let deg;
        if (d.angle) { const a = d.angle(e); if (a === null) return; d.acc += ((a - d.a + 540) % 360) - 180; d.a = a; deg = d.acc; } // tours complets possibles
        else deg = ((e.clientX - d.x0) * d.tx + (e.clientY - d.y0) * d.ty) / d.pxPerDeg;
        const applied = this.onHandle?.(d.g.userData.hd.id, deg, "move", e);
        d.applied = typeof applied === "number" ? applied : deg;
        d.g.quaternion.copy(d.q0).premultiply(new THREE.Quaternion().setFromAxisAngle(d.g.userData.dir, d.applied * Math.PI / 180));
        return;
      }
      const { g, o, t0 } = this.drag; const t = this.handleT(e, o, g.userData.dir); if (t === null) return;
      const applied = this.onHandle?.(g.userData.hd.id, t - t0, "move", e);
      this.drag.applied = typeof applied === "number" ? applied : t - t0;
      this.handleGroup.position.copy(g.userData.dir).multiplyScalar(this.drag.applied);
      return;
    }
    if (!this.handles.length) return;
    const g = e.buttons ? null : this.handleAt(e);
    if (g !== this.hotHandle) {
      if (this.hotHandle) this.hotHandle.userData.mat.color.setHex(this.hotHandle.userData.color);
      this.hotHandle = g; if (g) g.userData.mat.color.setHex(0xffb020);
      if (!this.pickMode) this.renderer.domElement.style.cursor = g ? "grab" : "";
      else if (g) this.renderer.domElement.style.cursor = "grab"; else this.renderer.domElement.style.cursor = "crosshair";
    }
    if (g) { e.stopImmediatePropagation(); this.clearHover(); }
  }
  handleUp(e) {
    if (!this.drag) return;
    e.stopImmediatePropagation();
    const d = this.drag; this.drag = null;
    try { this.renderer.domElement.releasePointerCapture(d.pid); } catch { /* déjà relâché */ }
    this.renderer.domElement.style.cursor = this.pickMode ? "crosshair" : "";
    // un simple clic sur une poignée (sans tirer) n'est pas un réglage : pendant un choix sur la pièce,
    // il va à la pièce qui est dessous
    if (!d.applied && Math.hypot(e.clientX - d.px, e.clientY - d.py) < 5) { this.onHandle?.(d.g.userData.hd.id, 0, "cancel", e); if (this.pickMode && e.type === "pointerup") this.onClick(e); return; }
    this.onHandle?.(d.g.userData.hd.id, d.applied, "end", e);
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
    return g ? { faceId: g.faceId, point: h.point.toArray(), info: this.data.faces[g.faceId] || null, normal: h.face ? h.face.normal.toArray() : null } : null;
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
    if (this.hoverObj) { (this.hoverParent || this.part).remove(this.hoverObj); this.hoverObj = null; this.hoverParent = null; }
    if (this.hoverEdge) { this.hoverEdge.material = this.edgeMat; this.hoverEdge = null; }
  }
  onMove(e) {
    if (!this.pickMode) return;
    this.clearHover();
    if (this.pickMode.kind === "measure") return;
    if (this.pickMode.kind === "region") { const h = this.hitRegion(e); for (const o of this.regionObjs) if (!o.userData.on) o.material.opacity = 0.12; if (h) { const o = this.regionObjs[h.region]; if (!o.userData.on) o.material.opacity = 0.3; } return; }
    if (this.pickMode.kind === "asm") {
      const h = this.asmHit(e);
      if (h && this.pickMode.filter?.(h) !== false) { const a = this.asm.get(h.comp); const g = a.data.faceGroups.find((x) => x.faceId === h.faceId); if (g) { const geo = new THREE.BufferGeometry(); geo.setAttribute("position", a.mesh.geometry.getAttribute("position")); geo.setIndex(new THREE.BufferAttribute(a.data.triangles.slice(g.start, g.start + g.count), 1)); this.hoverObj = new THREE.Mesh(geo, this.hoverMat); a.g.add(this.hoverObj); this.hoverParent = a.g; } }
      return;
    }
    if (this.pickMode.kind === "edge") {
      const h = this.hitEdge(e); if (h) { this.hoverEdge = h.obj; h.obj.material = this.edgeHot; }
    } else {
      const h = this.hitFace(e);
      if (h && (!this.pickMode.planarOnly || h.info?.plane)) {
        const geo = this.faceGeometry(h.faceId); if (geo) { this.hoverObj = new THREE.Mesh(geo, this.hoverMat); this.part.add(this.hoverObj); }
      }
    }
  }
  // Cube d'orientation (CSS 3D) : suit la caméra, un clic sur une face oriente la vue.
  mountCube(container, onPick) {
    const wrap = document.createElement("div"); wrap.className = "vcube";
    const cube = document.createElement("div"); cube.className = "vc"; wrap.append(cube);
    const F = [["Dessus", [0, 0, 1], "translateZ(36px)"], ["Dessous", [0, 0, -1], "rotateY(180deg) translateZ(36px)"],
      ["Face", [0, -1, 0], "rotateX(-90deg) translateZ(36px)"], ["Arrière", [0, 1, 0], "rotateZ(180deg) rotateX(-90deg) translateZ(36px)"],
      ["Droite", [1, 0, 0], "rotateZ(-90deg) rotateX(-90deg) translateZ(36px)"], ["Gauche", [-1, 0, 0], "rotateZ(90deg) rotateX(-90deg) translateZ(36px)"]];
    for (const [name, dir, tr] of F) {
      const f = document.createElement("button"); f.className = "vf"; f.textContent = name; f.style.transform = tr; f.title = "Vue de " + name.toLowerCase();
      f.addEventListener("click", () => onPick(dir)); cube.append(f);
    }
    container.prepend(wrap); this.cubeEl = cube;
    this._m = new THREE.Matrix4(); this._s = new THREE.Matrix4().makeScale(1, -1, 1);
  }
  updateCube() {
    if (!this.cubeEl || !this.cubeEl.isConnected) return;
    const cam = this.sketchView ? this.sketchCam : this.camera; cam.updateMatrixWorld();
    const m = this._m.extractRotation(cam.matrixWorldInverse).premultiply(this._s).multiply(this._s);
    const key = m.elements.map((v) => v.toFixed(4)).join(",");
    if (key !== this._cubeKey) { this._cubeKey = key; this.cubeEl.style.transform = `translateZ(-60px) matrix3d(${key})`; }
  }
  // Vue d'esquisse : caméra orthogonale face au plan, calée sur le zoom de l'éditeur 2D.
  // v = { pl: {origin,x,y,n}, cu, cv, zoom } (cu, cv = point du plan au centre de la vue ; zoom = pixels par mm)
  setSketchView(v) {
    this.sketchView = v || null;
    if (!v) return;
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1, c = this.sketchCam;
    c.left = -w / 2 / v.zoom; c.right = w / 2 / v.zoom; c.top = h / 2 / v.zoom; c.bottom = -h / 2 / v.zoom;
    const o = v.pl.origin, X = v.pl.x, Y = v.pl.y, N = v.pl.n;
    const P = [0, 1, 2].map((k) => o[k] + X[k] * v.cu + Y[k] * v.cv);
    const D = this.size * 4 + 1000;
    c.position.set(P[0] + N[0] * D, P[1] + N[1] * D, P[2] + N[2] * D);
    c.up.set(...Y); c.lookAt(P[0], P[1], P[2]);
    c.near = 0.1; c.far = D * 2; c.updateProjectionMatrix();
  }
  // Aperçu du résultat pendant une sélection (congé, coque…) : volume translucide par-dessus.
  setGhost(data) {
    if (this.ghost) { this.scene.remove(this.ghost); this.ghost.traverse((o) => o.geometry?.dispose()); this.ghost = null; }
    if (!data) return;
    const g = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(data.vertices, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(data.triangles, 1));
    this.ghostMat = this.ghostMat || new THREE.MeshStandardMaterial({ color: 0xe0874f, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.ghostEdge = this.ghostEdge || new THREE.LineBasicMaterial({ color: 0xb4461f, transparent: true, opacity: 0.9 });
    g.add(new THREE.Mesh(geo, this.ghostMat));
    const eg = new THREE.BufferGeometry(); eg.setAttribute("position", new THREE.BufferAttribute(data.lines, 3));
    g.add(new THREE.LineSegments(eg, this.ghostEdge));
    g.renderOrder = 2; this.ghost = g; this.scene.add(g);
  }
  // Zones d'une esquisse (contours qui se croisent) : on clique celles à extruder.
  setRegions(list, sel = []) {
    if (this.regionGroup) { this.scene.remove(this.regionGroup); this.regionGroup.traverse((o) => o.geometry?.dispose()); this.regionGroup = null; }
    this.regionObjs = [];
    if (!list) return;
    const g = new THREE.Group();
    list.forEach((tris, i) => {
      const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(tris, 3));
      const on = sel.includes(i);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: on ? 0xc4552b : 0x2f6fb5, transparent: true, opacity: on ? 0.55 : 0.12, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
      m.userData.region = i; m.userData.on = on; m.renderOrder = 8; g.add(m); this.regionObjs.push(m);
    });
    this.regionGroup = g; this.scene.add(g);
  }
  hitRegion(e) {
    if (!this.regionObjs?.length) return null;
    this.ray(e); const h = this.raycaster.intersectObjects(this.regionObjs)[0];
    return h ? { region: h.object.userData.region, point: h.point.toArray() } : null;
  }
  // Face mise en évidence (clic simple, hors outil).
  highlightFace(faceId) {
    if (this.selFaceObj) { this.part.remove(this.selFaceObj); this.selFaceObj = null; }
    if (faceId === null || faceId === undefined || !this.data) return;
    const geo = this.faceGeometry(faceId); if (!geo) return;
    this.selFaceObj = new THREE.Mesh(geo, this.selMat); this.part.add(this.selFaceObj);
  }
  onClick(e) {
    if (!this.pickMode) { this.onFreeClick?.(e); return; }
    if (this.pickMode.kind === "asm") { const h = this.asmHit(e); if (h) this.pickMode.onPick(h); return; }
    if (this.pickMode.kind === "measure") { const h = this.hitFace(e) || this.hitEdge(e); if (h) this.pickMode.onPick({ ...h, ...this.snapPoint(e, h.point) }); return; }
    if (this.pickMode.kind === "region") { const h = this.hitRegion(e); if (h) this.pickMode.onPick(h); return; }
    if (this.pickMode.kind === "edge") { const h = this.hitEdge(e); if (h) this.pickMode.onPick(h); }
    else { const h = this.hitFace(e); if (h) this.pickMode.onPick(h); }
  }
  // Plans de référence affichés comme des carrés translucides.
  setPlanes(list) {
    if (this.planeGroup) this.scene.remove(this.planeGroup);
    this.planeGroup = new THREE.Group();
    for (const p of list) {
      const s = p.size / 2; const o = new THREE.Vector3(...p.origin), x = new THREE.Vector3(...p.x).multiplyScalar(s), y = new THREE.Vector3(...p.y).multiplyScalar(s);
      const c = [o.clone().sub(x).sub(y), o.clone().add(x).sub(y), o.clone().add(x).add(y), o.clone().sub(x).add(y)];
      const g = new THREE.BufferGeometry().setFromPoints([c[0], c[1], c[2], c[0], c[2], c[3]]);
      const col = p.active ? 0xc4552b : 0x2f6fb5;
      this.planeGroup.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: p.active ? 0.18 : 0.08, side: THREE.DoubleSide, depthWrite: false })));
      this.planeGroup.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(c), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.7 })));
    }
    this.scene.add(this.planeGroup);
  }
  // Vue en coupe : plan de coupe perpendiculaire à un axe.
  setSection(sec) {
    this.renderer.localClippingEnabled = !!sec;
    const planes = sec ? [new THREE.Plane(new THREE.Vector3(...{ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[sec.axis]).multiplyScalar(sec.flip ? 1 : -1), sec.flip ? -sec.pos : sec.pos)] : [];
    for (const m of [this.mat, this.edgeMat, this.hoverMat, this.selMat, this.edgeHot, ...(this.asm ? [...this.asm.values()].map((a) => a.mat) : [])]) { m.clippingPlanes = planes; m.needsUpdate = true; }
    this.section = sec;
  }
  // Accroche aux extrémités d'arêtes (en pixels), pour la mesure.
  snapPoint(e, p) {
    if (!this.data) return { p, snapped: false };
    const r = this.renderer.domElement.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const L = this.data.lines; const v = new THREE.Vector3(); let best = null, bd = 12;
    const test = (i) => { v.set(L[i], L[i + 1], L[i + 2]); const q = v.clone().project(this.camera); const sx = (q.x + 1) / 2 * r.width, sy = (1 - q.y) / 2 * r.height; const d = Math.hypot(sx - mx, sy - my); if (d < bd && q.z < 1) { bd = d; best = v.toArray(); } };
    for (const g of this.data.edgeGroups) { test(g.start * 3); test((g.start + g.count - 1) * 3); }
    return best ? { p: best, snapped: true } : { p, snapped: false };
  }
  setMeasure(pts) {
    if (this.measureGroup) this.scene.remove(this.measureGroup);
    this.measureGroup = new THREE.Group();
    const r = this.size / 140;
    for (const p of pts) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ color: 0x1b8f5a, depthTest: false })); m.position.set(...p); m.renderOrder = 11; this.measureGroup.add(m); }
    if (pts.length === 2) this.measureGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(...p))), new THREE.LineBasicMaterial({ color: 0x1b8f5a, depthTest: false })));
    this.scene.add(this.measureGroup);
  }
  setCog(p) {
    if (this.cogObj) this.scene.remove(this.cogObj);
    this.cogObj = null; if (!p) return;
    const g = new THREE.Group(); const r = this.size / 90;
    g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color: 0x7a3fd1, depthTest: false })));
    for (const d of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...d).multiplyScalar(-r * 3), new THREE.Vector3(...d).multiplyScalar(r * 3)]), new THREE.LineBasicMaterial({ color: 0x7a3fd1, depthTest: false })));
    g.children.forEach((c) => (c.renderOrder = 12)); g.position.set(...p); this.cogObj = g; this.scene.add(g);
  }
  // ---------- Impression 3D : surplombs en couleur, pièce posée sur sa face d'appui ----------
  setPrintView(g) {
    const geo = this.geo; const data = this.data;
    if (!g || !geo || !data) {
      if (geo?.getAttribute("color")) geo.deleteAttribute("color");
      this.mat.vertexColors = false; this.mat.color.set(0xc3ccd7); this.mat.needsUpdate = true;
      this.part.quaternion.identity(); this.printDown = null; this.updateGround(); return;
    }
    const V = data.vertices, N = data.normals, n = V.length / 3;
    let maxD = -Infinity; for (let i = 0; i < n; i++) maxD = Math.max(maxD, V[i * 3] * g[0] + V[i * 3 + 1] * g[1] + V[i * 3 + 2] * g[2]);
    const tol = Math.max(0.01, this.size * 1e-4);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const c = N[i * 3] * g[0] + N[i * 3 + 1] * g[1] + N[i * 3 + 2] * g[2];
      const d = V[i * 3] * g[0] + V[i * 3 + 1] * g[1] + V[i * 3 + 2] * g[2];
      let rgb = [0.79, 0.82, 0.85];
      if (c > 0.99 && d > maxD - tol) rgb = [0.36, 0.72, 0.45]; // face posée sur le plateau
      else if (c > 0.7071) rgb = [0.86, 0.25, 0.22]; // surplomb > 45° : support nécessaire
      else if (c > 0.5) rgb = [0.93, 0.6, 0.25]; // limite
      col.set(rgb, i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.mat.vertexColors = true; this.mat.color.set(0xffffff); this.mat.needsUpdate = true;
    this.part.quaternion.setFromUnitVectors(new THREE.Vector3(...g), new THREE.Vector3(0, 0, -1));
    this.printDown = g; this.updateGround();
  }
  // ---------- Assemblage : un groupe par composant ----------
  setAssembly(list) {
    this.part.clear(); this.data = null; this.mesh = null; this.edgeObjs = [];
    this.asm = new Map();
    let box = new THREE.Box3();
    for (const c of list) {
      if (!c.data) continue;
      const g = new THREE.Group(); g.userData.id = c.id;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(c.data.vertices, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(c.data.normals, 3));
      geo.setIndex(new THREE.BufferAttribute(c.data.triangles, 1));
      const mat = this.mat.clone(); mat.color.set(c.color || "#c9d1da");
      const mesh = new THREE.Mesh(geo, mat); mesh.userData = { comp: c.id };
      const eg = new THREE.BufferGeometry(); eg.setAttribute("position", new THREE.BufferAttribute(c.data.lines, 3));
      const edges = new THREE.LineSegments(eg, this.edgeMat);
      g.add(mesh, edges);
      this.part.add(g);
      this.asm.set(c.id, { g, mesh, data: c.data, mat });
    }
    if (list.every((c) => c.rot)) this.updateAssembly(list);
    this.part.updateMatrixWorld(true);
    box.setFromObject(this.part);
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3()).length();
      this.size = Math.max(10, size); this.raycaster.params.Line.threshold = this.size / 150;
      this.asmBox = box;
    }
    this.updateGround(box);
  }
  updateAssembly(list) {
    if (!this.asm) return;
    for (const c of list) {
      const a = this.asm.get(c.id); if (!a) continue;
      const g = a.g; const D = Math.PI / 180;
      g.rotation.set(c.rot[0] * D, c.rot[1] * D, c.rot[2] * D, "ZYX");
      g.position.set(c.pos[0] + (c.explode?.[0] || 0), c.pos[1] + (c.explode?.[1] || 0), c.pos[2] + (c.explode?.[2] || 0));
      g.visible = !c.hidden;
      a.mat.color.set(c.selected ? "#e0874f" : (c.color || "#c9d1da"));
      a.mat.opacity = c.ghost ? 0.25 : 1; a.mat.transparent = !!c.ghost; a.mat.depthWrite = !c.ghost;
    }
    this.part.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.part);
    if (!box.isEmpty()) this.asmBox = box;
    this.updateGround(box);
  }
  asmHit(e) {
    if (!this.asm) return null;
    this.ray(e);
    const meshes = [...this.asm.values()].filter((a) => a.g.visible).map((a) => a.mesh);
    const h = this.raycaster.intersectObjects(meshes)[0]; if (!h) return null;
    const id = h.object.userData.comp; const a = this.asm.get(id);
    const idx = h.faceIndex * 3; const g = a.data.faceGroups.find((x) => idx >= x.start && idx < x.start + x.count);
    const local = a.g.worldToLocal(h.point.clone()).toArray();
    return { comp: id, faceId: g?.faceId, info: g ? a.data.faces[g.faceId] || null : null, point: h.point.toArray(), local };
  }
  fitBox(dir) {
    const b = this.asmBox; if (!b) return this.fit(dir);
    const save = this.data; this.data = { bb: [b.min.toArray(), b.max.toArray()] }; this.fit(dir); this.data = save;
  }
  snapshot() { return this.renderer.domElement.toDataURL("image/png"); }
  // Images de la pièce (PNG) sous plusieurs angles, sur fond clair : pour la montrer ou la publier.
  shots(dirs, w = 1600, h = 1200) {
    const r = this.renderer, cam = this.camera, u = this.ground.material.uniforms;
    const keep = { pos: cam.position.clone(), up: cam.up.clone(), target: this.controls.target.clone(), near: cam.near, far: cam.far, aspect: cam.aspect, size: r.getSize(new THREE.Vector2()), pr: r.getPixelRatio(), bg: this.scene.background, line: u.uLine.value.clone(), sh: u.uShadow.value, al: u.uAlpha.value };
    const hide = [this.helpers, this.overlay, this.planeGroup, this.ghost, this.regionGroup, this.measureGroup, this.cogObj].filter(Boolean); const vis = hide.map((o) => o.visible);
    hide.forEach((o) => { o.visible = false; });
    r.setPixelRatio(1); r.setSize(w, h, false); cam.aspect = w / h;
    this.scene.background = new THREE.Color(0xf4f1ec); u.uLine.value.set(0x6f7a89); u.uShadow.value = this.hasBox ? 0.2 : 0; u.uAlpha.value = 1; this.ground.visible = true;
    const out = [];
    try { for (const d of dirs) { this.fit(d); r.render(this.scene, cam); out.push(r.domElement.toDataURL("image/png")); } }
    finally {
      this.scene.background = keep.bg; u.uLine.value.copy(keep.line); u.uShadow.value = keep.sh; u.uAlpha.value = keep.al;
      r.setPixelRatio(keep.pr); r.setSize(keep.size.x, keep.size.y, false);
      cam.aspect = keep.aspect; cam.position.copy(keep.pos); cam.up.copy(keep.up); this.controls.target.copy(keep.target); cam.near = keep.near; cam.far = keep.far; cam.updateProjectionMatrix(); this.controls.update();
      hide.forEach((o, i) => { o.visible = vis[i]; });
    }
    return out;
  }
}
