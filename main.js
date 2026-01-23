import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * Clickable naming convention:
 *   Any object named "kumoclick_*" (Blender Object name) becomes clickable.
 * Behavior:
 *   Hover -> highlight
 *   Click -> smoothly zoom to fit object, then open modal
 */

const CLICK_PREFIX = "kumoclick_";

const canvas = document.getElementById("c");
canvas.focus();

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202020);

const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 5000);

// ===== Lighting =====
scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 2.2));
scene.add(new THREE.AmbientLight(0xffffff, 0.35));

const key = new THREE.DirectionalLight(0xffffff, 1.2);
key.position.set(5, 10, 5);
scene.add(key);

const fill1 = new THREE.DirectionalLight(0xffffff, 0.55);
fill1.position.set(-6, 6, -6);
scene.add(fill1);

const fill2 = new THREE.DirectionalLight(0xffffff, 0.35);
fill2.position.set(6, 4, -10);
scene.add(fill2);

// ===== OrbitControls (damping only) =====
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.enableZoom = false;
controls.enableRotate = false;
renderer.domElement.style.touchAction = "none";

// ===== Modal =====
const modalBackdrop = document.getElementById("modalBackdrop");
const modalClose = document.getElementById("modalClose");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");

function openModal({ title, html }) {
  modalTitle.textContent = title || "Info";
  modalBody.innerHTML = html || "";
  modalBackdrop.classList.add("is-open");
  modalBackdrop.setAttribute("aria-hidden", "false");
}

function closeModal() {
  modalBackdrop.classList.remove("is-open");
  modalBackdrop.setAttribute("aria-hidden", "true");
}

modalClose.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeModal();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

// ===== Standing / bounds (XZ clamp only) =====
const EYE_HEIGHT = 1.6;
const FLOOR_PADDING = 0.05;
const WALL_PADDING = 0.20;

let FLOOR_Y = 0;
let ROOM_MIN_X = -Infinity, ROOM_MAX_X = Infinity;
let ROOM_MIN_Z = -Infinity, ROOM_MAX_Z = Infinity;
let roomLoaded = false;

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function boundsAreFinite() {
  return (
    Number.isFinite(FLOOR_Y) &&
    Number.isFinite(ROOM_MIN_X) && Number.isFinite(ROOM_MAX_X) &&
    Number.isFinite(ROOM_MIN_Z) && Number.isFinite(ROOM_MAX_Z)
  );
}

// Keep the user at standing height only when not focusing
function lockStandingHeight() {
  const y = FLOOR_Y + FLOOR_PADDING + EYE_HEIGHT;
  camera.position.y = y;
}

// Clamp only XZ (let Y move freely during focus to center objects)
function clampToRoomXZ() {
  if (!roomLoaded || !boundsAreFinite()) return;

  camera.position.x = clamp(camera.position.x, ROOM_MIN_X, ROOM_MAX_X);
  camera.position.z = clamp(camera.position.z, ROOM_MIN_Z, ROOM_MAX_Z);

  controls.target.x = clamp(controls.target.x, ROOM_MIN_X, ROOM_MAX_X);
  controls.target.z = clamp(controls.target.z, ROOM_MIN_Z, ROOM_MAX_Z);
}

function computeBoundsRobust(root) {
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root);
  if (!box.isEmpty()) return box;

  const fallback = new THREE.Box3();
  const temp = new THREE.Box3();

  root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
    temp.copy(obj.geometry.boundingBox);
    temp.applyMatrix4(obj.matrixWorld);
    fallback.union(temp);
  });

  return fallback;
}

// ===== Look + movement (your existing scheme) =====
let yaw = 0;
let pitch = 0;
const MAX_PITCH = Math.PI * 0.49;
const LOOK_DISTANCE = 1.0;

// Sensitivity
const YAW_SENS_WHEEL  = 0.0022;
const WALK_SENS_WHEEL = 0.0025;
const DRAG_SENS_YAW   = 0.0040;
const DRAG_SENS_PITCH = 0.0040;

function getForwardXZFromYaw() {
  return new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
}

function getLookDirFromYawPitch() {
  const cosP = Math.cos(pitch);
  return new THREE.Vector3(
    Math.sin(yaw) * cosP,
    Math.sin(pitch),
    -Math.cos(yaw) * cosP
  ).normalize();
}

function updateLookTargetFromYawPitch() {
  const dir = getLookDirFromYawPitch();
  controls.target.copy(camera.position).addScaledVector(dir, LOOK_DISTANCE);
}

// Drag to look
let dragging = false;
let lastX = 0, lastY = 0;

renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());

renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  renderer.domElement.setPointerCapture(e.pointerId);
});

renderer.domElement.addEventListener("pointermove", (e) => {
  if (!dragging || !roomLoaded || focus.active) return;

  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;

  yaw += -dx * DRAG_SENS_YAW;
  pitch += -dy * DRAG_SENS_PITCH;
  pitch = clamp(pitch, -MAX_PITCH, MAX_PITCH);

  updateLookTargetFromYawPitch();
});

function endDrag(e) {
  dragging = false;
  try { renderer.domElement.releasePointerCapture(e.pointerId); } catch {}
}
renderer.domElement.addEventListener("pointerup", endDrag);
renderer.domElement.addEventListener("pointercancel", endDrag);

// Wheel: horiz = yaw, vertical = walk (reversed: scroll up forward)
renderer.domElement.addEventListener("wheel", (e) => {
  if (e.ctrlKey) { e.preventDefault(); return; } // swallow pinch
  e.preventDefault();
  if (!roomLoaded || focus.active) return;

  yaw += -e.deltaX * YAW_SENS_WHEEL;

  // REVERSED: scroll UP => forward, scroll DOWN => backward
  const step = (-e.deltaY) * WALK_SENS_WHEEL;

  camera.position.addScaledVector(getForwardXZFromYaw(), step);

  lockStandingHeight();
  updateLookTargetFromYawPitch();
  clampToRoomXZ();
}, { passive: false });

// Keyboard WASD
const keys = new Set();
window.addEventListener("keydown", (e) => {
  if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key)) e.preventDefault();
  keys.add(e.key);
}, { passive: false });
window.addEventListener("keyup", (e) => keys.delete(e.key));

function getMoveInput() {
  const forward = (keys.has("w") || keys.has("W") || keys.has("ArrowUp")) ? 1 : 0;
  const back    = (keys.has("s") || keys.has("S") || keys.has("ArrowDown")) ? 1 : 0;
  const left    = (keys.has("a") || keys.has("A") || keys.has("ArrowLeft")) ? 1 : 0;
  const right   = (keys.has("d") || keys.has("D") || keys.has("ArrowRight")) ? 1 : 0;
  return { forward, back, left, right, sprint: keys.has("Shift") };
}

const WALK_SPEED = 1.25;
const SPRINT_MULT = 2.0;

// ===== Clickables + Hover highlight =====
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();

// We raycast against meshes, but we want the "root" named kumoclick_*
const clickableMeshes = [];
const clickableRoots = new Set();

let hoveredRoot = null;

// Store original emissive settings so we can restore
const highlightState = new WeakMap(); // mesh -> { material, emissiveHex, emissiveIntensity, colorHex }

function isClickableName(name) {
  return typeof name === "string" && name.toLowerCase().startsWith(CLICK_PREFIX);
}

function findClickableRoot(obj) {
  let cur = obj;
  while (cur) {
    if (isClickableName(cur.name)) return cur;
    cur = cur.parent;
  }
  return null;
}

function collectMeshesUnder(root, out = []) {
  root.traverse((o) => { if (o.isMesh) out.push(o); });
  return out;
}

function applyHoverHighlight(root, on) {
  if (!root) return;

  // highlight all meshes under the clickable root
  const meshes = collectMeshesUnder(root);

  for (const mesh of meshes) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;

      // Save original once
      if (on && !highlightState.has(mat)) {
        highlightState.set(mat, {
          hasEmissive: !!mat.emissive,
          emissiveHex: mat.emissive ? mat.emissive.getHex() : null,
          emissiveIntensity: typeof mat.emissiveIntensity === "number" ? mat.emissiveIntensity : null,
          colorHex: mat.color ? mat.color.getHex() : null
        });
      }

      if (on) {
        // Prefer emissive highlight if available; fallback to brightening color
        if (mat.emissive) {
          mat.emissive.setHex(0x2a7fff);
          mat.emissiveIntensity = 0.9;
        } else if (mat.color) {
          mat.color.offsetHSL(0, 0, 0.15);
        }
        mat.needsUpdate = true;
      } else {
        // Restore
        const saved = highlightState.get(mat);
        if (!saved) continue;

        if (saved.hasEmissive && mat.emissive) {
          mat.emissive.setHex(saved.emissiveHex ?? 0x000000);
          if (saved.emissiveIntensity !== null) mat.emissiveIntensity = saved.emissiveIntensity;
        } else if (mat.color && saved.colorHex !== null) {
          mat.color.setHex(saved.colorHex);
        }
        mat.needsUpdate = true;
      }
    }
  }
}

function setHoveredRoot(newRoot) {
  if (newRoot === hoveredRoot) return;

  // remove old highlight
  if (hoveredRoot) applyHoverHighlight(hoveredRoot, false);

  hoveredRoot = newRoot;

  // add new highlight
  if (hoveredRoot) applyHoverHighlight(hoveredRoot, true);
}

function updateMouseNDCFromEvent(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouseNDC.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
}

renderer.domElement.addEventListener("pointermove", (e) => {
  if (!roomLoaded || focus.active) return;

  updateMouseNDCFromEvent(e);
  raycaster.setFromCamera(mouseNDC, camera);

  const hits = raycaster.intersectObjects(clickableMeshes, true);
  if (!hits.length) {
    setHoveredRoot(null);
    return;
  }

  const hit = hits[0].object;
  const root = findClickableRoot(hit);
  setHoveredRoot(root);
});

// ===== Smooth focus (zoom-to-fit) =====
const focus = {
  active: false,
  t: 0,
  dur: 0.55,
  fromPos: new THREE.Vector3(),
  fromTarget: new THREE.Vector3(),
  toPos: new THREE.Vector3(),
  toTarget: new THREE.Vector3(),
  openModalOnDone: null, // { title, html }
};

function easeInOutCubic(x) {
  return x < 0.5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3) / 2;
}

function fitCameraToObject(root) {
  // Compute world box
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return null;

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  // Compute distance to fit in view (accounts for aspect)
  const halfSizeY = size.y * 0.5;
  const halfSizeX = size.x * 0.5;
  const halfSizeZ = size.z * 0.5;

  const maxHalf = Math.max(halfSizeX, halfSizeY, halfSizeZ);
  const radius = maxHalf * 1.15; // padding

  const fov = THREE.MathUtils.degToRad(camera.fov);
  const aspect = camera.aspect;

  // Fit sphere in vertical + horizontal fov
  const distV = radius / Math.sin(fov / 2);
  const fovH = 2 * Math.atan(Math.tan(fov / 2) * aspect);
  const distH = radius / Math.sin(fovH / 2);
  const dist = Math.max(distV, distH);

  // Move camera along current view direction (so it "zooms" from where you are)
  const viewDir = new THREE.Vector3();
  camera.getWorldDirection(viewDir); // forward
  viewDir.normalize();

  const desiredPos = new THREE.Vector3().copy(center).addScaledVector(viewDir, -dist);
  const desiredTarget = center.clone();

  return { desiredPos, desiredTarget, center, box, size };
}

function startFocus(root, modalPayload) {
  const fit = fitCameraToObject(root);
  if (!fit) return;

  focus.active = true;
  focus.t = 0;

  focus.fromPos.copy(camera.position);
  focus.fromTarget.copy(controls.target);

  focus.toPos.copy(fit.desiredPos);
  focus.toTarget.copy(fit.desiredTarget);

  focus.openModalOnDone = modalPayload || null;

  // also clear hover highlight once focusing begins
  setHoveredRoot(null);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Click detection (avoid triggering on drag)
let clickDownPos = { x: 0, y: 0 };
let clickDownTime = 0;

renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  clickDownPos = { x: e.clientX, y: e.clientY };
  clickDownTime = performance.now();
});

renderer.domElement.addEventListener("pointerup", (e) => {
  if (e.button !== 0) return;
  if (!roomLoaded || focus.active) return;
  if (modalBackdrop.classList.contains("is-open")) return;

  const dist = Math.hypot(e.clientX - clickDownPos.x, e.clientY - clickDownPos.y);
  const dt = performance.now() - clickDownTime;
  if (dist > 6 || dt > 450) return;

  updateMouseNDCFromEvent(e);
  raycaster.setFromCamera(mouseNDC, camera);

  const hits = raycaster.intersectObjects(clickableMeshes, true);
  if (!hits.length) return;

  const root = findClickableRoot(hits[0].object);
  if (!root) return;

  const slug = root.name.substring(CLICK_PREFIX.length);

  // Start focus, then open modal when focus finishes
  startFocus(root, {
    title: slug || "Object",
    html: `
      <p><b>Clicked:</b> <code>${escapeHtml(root.name)}</code></p>
      <p><b>Slug:</b> <code>${escapeHtml(slug)}</code></p>
      <p>This is placeholder content. Later you can fetch WordPress content by slug.</p>
      <p><code>/wp-json/...</code> using slug <code>${escapeHtml(slug)}</code></p>
    `
  });
});

// ===== Load GLB =====
const loader = new GLTFLoader();

loader.load(
  "./kumo-room.glb",
  (gltf) => {
    const room = gltf.scene;
    scene.add(room);

    // Ensure interior walls render
    room.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        obj.material.side = THREE.DoubleSide;
        obj.material.needsUpdate = true;
      }
    });

    // Bounds: compute before recenter
    const preBox = computeBoundsRobust(room);
    if (preBox.isEmpty()) {
      console.error("Bounds are empty — no mesh geometry exported in the GLB.");
      return;
    }

    // Center room at origin
    const preCenter = new THREE.Vector3();
    preBox.getCenter(preCenter);
    room.position.sub(preCenter);
    room.updateMatrixWorld(true);

    const box = computeBoundsRobust(room);
    const size = new THREE.Vector3();
    box.getSize(size);

    FLOOR_Y = box.min.y;

    ROOM_MIN_X = box.min.x + WALL_PADDING;
    ROOM_MAX_X = box.max.x - WALL_PADDING;
    ROOM_MIN_Z = box.min.z + WALL_PADDING;
    ROOM_MAX_Z = box.max.z - WALL_PADDING;

    // Start at center
    const y = FLOOR_Y + FLOOR_PADDING + EYE_HEIGHT;
    yaw = 0;
    pitch = 0;

    camera.position.set(0, y, 0.8);
    updateLookTargetFromYawPitch();

    camera.near = 0.01;
    camera.far = Math.max(2000, size.length() * 10);
    camera.updateProjectionMatrix();

    // Collect clickables: any object whose name starts with kumoclick_
    room.traverse((obj) => {
      if (isClickableName(obj.name)) {
        clickableRoots.add(obj);
      }
    });

    // For raycasting, collect meshes under each clickable root
    clickableMeshes.length = 0;
    for (const root of clickableRoots) {
      collectMeshesUnder(root, clickableMeshes);
    }

    console.log("GLB loaded ✅");
    console.log("Clickable roots:", [...clickableRoots].map(o => o.name));
    console.log("Clickable mesh count:", clickableMeshes.length);

    roomLoaded = true;
    lockStandingHeight();
    clampToRoomXZ();
    controls.update();
  },
  undefined,
  (err) => console.error("GLB load error:", err)
);

// ===== Resize =====
function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize, { passive: true });
resize();

// ===== Animate =====
const clock = new THREE.Clock();

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (roomLoaded && boundsAreFinite()) {
    // Focus animation has priority
    if (focus.active) {
      focus.t += dt / focus.dur;
      const a = easeInOutCubic(Math.min(1, focus.t));

      camera.position.lerpVectors(focus.fromPos, focus.toPos, a);
      controls.target.lerpVectors(focus.fromTarget, focus.toTarget, a);

      // Keep within room in XZ (don’t let it fly out)
      clampToRoomXZ();

      if (focus.t >= 1) {
        focus.active = false;

        if (focus.openModalOnDone) {
          openModal(focus.openModalOnDone);
        }
      }
    } else {
      // Keyboard walk
      const input = getMoveInput();
      const moveZ = (input.forward - input.back);
      const moveX = (input.right - input.left);

      if (moveZ !== 0 || moveX !== 0) {
        const dirForward = getForwardXZFromYaw();
        const dirRight = new THREE.Vector3().crossVectors(dirForward, new THREE.Vector3(0, 1, 0)).normalize();
        const speed = WALK_SPEED * (input.sprint ? SPRINT_MULT : 1);

        const move = new THREE.Vector3();
        move.addScaledVector(dirForward, moveZ * speed * dt);
        move.addScaledVector(dirRight,   moveX * speed * dt);

        camera.position.add(move);
      }

      lockStandingHeight();
      updateLookTargetFromYawPitch();
      clampToRoomXZ();
    }
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
