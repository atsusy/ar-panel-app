import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---------- 盤モデル ----------
// 原点は底面中央、正面は +Z。単位はメートル。
// 箱は中が空いた筐体(背板・側板・天板・底板)+取付板+前面の扉。
// 幅 900mm を超えると両開き。扉は userData.doors の pivot を回して開閉する。
const DOOR_OPEN_ANGLE = THREE.MathUtils.degToRad(105);

function buildPanel({ w, h, d, color }, doorsOpen = false) {
  const group = new THREE.Group();
  group.name = 'panel';
  const body = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 });
  const inner = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.8), roughness: 0.7, metalness: 0.05 });
  const plateMat = new THREE.MeshStandardMaterial({ color: '#e8e4d4', roughness: 0.6, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2b2f33', roughness: 0.4, metalness: 0.5 });

  const t = Math.min(0.015, w * 0.05, d * 0.1);       // 板厚
  const dt = Math.min(0.02, d * 0.15);               // 扉の厚み
  const cd = d - dt;                                  // 筐体の奥行(扉を除く)
  const cz = -d / 2 + cd / 2;                         // 筐体の中心 z
  const box = (bw, bh, bd, mat, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };

  // 筐体
  box(w, h, t, body, 0, h / 2, -d / 2 + t / 2);                       // 背板
  box(t, h, cd - t, body, -w / 2 + t / 2, h / 2, cz + t / 2);          // 左側板
  box(t, h, cd - t, body, w / 2 - t / 2, h / 2, cz + t / 2);           // 右側板
  box(w - 2 * t, t, cd - t, body, 0, h - t / 2, cz + t / 2);           // 天板
  box(w - 2 * t, t, cd - t, body, 0, t / 2, cz + t / 2);               // 底板
  // 内側の面(外板と色を変えて奥行きを分かりやすく)
  box(w - 2 * t, h - 2 * t, 0.002, inner, 0, h / 2, -d / 2 + t + 0.001);
  // 取付板
  const pm = Math.min(0.06, w * 0.08, h * 0.05);
  box(w - 2 * t - 2 * pm, h - 2 * t - 2 * pm, 0.003, plateMat, 0, h / 2, -d / 2 + t + Math.min(0.03, cd * 0.2));

  // 扉
  const gap = 0.002;
  const double = w > 0.9;
  const doors = [];
  const leaves = double ? [{ side: -1, width: w / 2 - gap * 1.5 }, { side: 1, width: w / 2 - gap * 1.5 }]
                        : [{ side: -1, width: w - gap * 2 }];
  const hh = Math.min(0.18, h * 0.2);
  for (const leaf of leaves) {
    // 蝶番は外側の縁。pivot を回すと扉が手前に開く
    const pivot = new THREE.Group();
    pivot.position.set(leaf.side * (w / 2 - gap), h / 2, d / 2 - dt);
    const dir = -leaf.side; // 蝶番から扉の先端へ向かう x の向き
    const panel = new THREE.Mesh(new THREE.BoxGeometry(leaf.width, h - gap * 2, dt), body);
    panel.position.set(dir * leaf.width / 2, 0, dt / 2);
    pivot.add(panel);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.025, hh, 0.03), dark);
    handle.position.set(dir * (leaf.width - Math.min(0.06, leaf.width * 0.15)), 0, dt + 0.015);
    if (leaf.width > 0.15) pivot.add(handle);
    group.add(pivot);
    const index = doors.length;
    panel.userData.door = index;
    handle.userData.door = index;
    doors.push({ pivot, sign: leaf.side < 0 ? -1 : 1, angle: 0 });
  }
  group.userData.doors = doors;
  setDoors(group, doorsOpen, true);
  return group;
}

// 扉の開閉。immediate でなければ目標角だけ設定し、animateDoors で動かす
function setDoors(panel, open, immediate = false) {
  panel.userData.doorsOpen = open;
  for (const door of panel.userData.doors) {
    door.target = open ? DOOR_OPEN_ANGLE : 0;
    if (immediate) {
      door.angle = door.target;
      door.pivot.rotation.y = door.sign * door.angle;
    }
  }
}

function animateDoors(panel, dt) {
  for (const door of panel.userData.doors) {
    const diff = door.target - door.angle;
    if (Math.abs(diff) < 1e-3) continue;
    const step = Math.sign(diff) * Math.min(Math.abs(diff), dt * 2.5); // 約 0.7 秒で全開
    door.angle += step;
    door.pivot.rotation.y = door.sign * door.angle;
  }
}

function readSize() {
  const mm = (id, def) => {
    const v = parseFloat($(id).value);
    return Number.isFinite(v) && v > 0 ? v : def;
  };
  return {
    wmm: mm('w', 800), hmm: mm('h', 1900), dmm: mm('d', 400),
    color: $('color').value,
  };
}
const toMeters = (s) => ({ w: s.wmm / 1000, h: s.hmm / 1000, d: s.dmm / 1000, color: s.color });

// ---------- プレビュー ----------
const pCanvas = $('preview');
const pRenderer = new THREE.WebGLRenderer({ canvas: pCanvas, antialias: true });
pRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const pScene = new THREE.Scene();
pScene.background = new THREE.Color('#dfe3e8');
pScene.add(new THREE.HemisphereLight('#ffffff', '#8a8f96', 2.0));
const sun = new THREE.DirectionalLight('#ffffff', 1.6);
sun.position.set(2, 4, 3);
pScene.add(sun);
const grid = new THREE.GridHelper(6, 12, '#8a939c', '#b7bec6'); // 0.5m 目盛
pScene.add(grid);
const pCamera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
const controls = new OrbitControls(pCamera, pCanvas);
controls.enableDamping = true;
let previewPanel = null;

function fitPreview(m) {
  const r = Math.max(m.w, m.h, m.d);
  controls.target.set(0, m.h / 2, 0);
  pCamera.position.set(r * 1.4, m.h * 0.8 + r * 0.3, r * 2.2);
  controls.update();
}

function resizePreview() {
  const { clientWidth: cw, clientHeight: ch } = pCanvas;
  pRenderer.setSize(cw, ch, false);
  pCamera.aspect = cw / ch;
  pCamera.updateProjectionMatrix();
}
new ResizeObserver(resizePreview).observe(pCanvas);

const pClock = new THREE.Clock();
pRenderer.setAnimationLoop(() => {
  const dt = pClock.getDelta();
  if (xrSession) return;
  if (previewPanel) animateDoors(previewPanel, dt);
  controls.update();
  pRenderer.render(pScene, pCamera);
});

// ---------- iOS: AR Quick Look ----------
// iOS の Chrome も中身は WebKit なので Quick Look を使う
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const quickLook = isIOS || document.createElement('a').relList?.supports?.('ar') === true;
let usdzUrl = null;
let usdzIsBlob = false;

// 生成した USDZ を Service Worker 経由で普通の URL として配る。
// blob: URL は iOS 版 Chrome の Quick Look で開けない場合があるための対策。
const swReady = ('serviceWorker' in navigator && 'caches' in window)
  ? navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).catch(() => null)
  : Promise.resolve(null);

async function publishUsdz(blob, m) {
  const reg = await swReady;
  if (reg && !navigator.serviceWorker.controller) {
    // 初回訪問時は制御下に入るまで少し待つ
    await new Promise((r) => {
      navigator.serviceWorker.addEventListener('controllerchange', r, { once: true });
      setTimeout(r, 2000);
    });
  }
  if (reg && navigator.serviceWorker.controller) {
    try {
      const name = `usdz/panel_${Math.round(m.w * 1000)}x${Math.round(m.h * 1000)}x${Math.round(m.d * 1000)}_${m.color.slice(1)}${doorsOpen ? '_open' : ''}.usdz`;
      const url = new URL(name, location.href).href;
      const cache = await caches.open('usdz');
      await cache.put(url, new Response(blob, { headers: { 'Content-Type': 'model/vnd.usdz+zip' } }));
      return { url, isBlob: false };
    } catch { /* blob にフォールバック */ }
  }
  return { url: URL.createObjectURL(blob), isBlob: true };
}
let usdzBuild = 0;

async function buildUsdz(m) {
  const id = ++usdzBuild;
  const scene = new THREE.Scene();
  scene.add(buildPanel(m, doorsOpen));
  const data = await new USDZExporter().parseAsync(scene, {
    quickLookCompatible: true,
    ar: { anchoring: { type: 'plane' }, planeAnchoring: { alignment: 'horizontal' } },
  });
  if (id !== usdzBuild) return; // 入力が変わった
  const published = await publishUsdz(new Blob([data], { type: 'model/vnd.usdz+zip' }), m);
  if (id !== usdzBuild) return;
  if (usdzUrl && usdzIsBlob) URL.revokeObjectURL(usdzUrl);
  usdzUrl = published.url;
  usdzIsBlob = published.isBlob;
  updateArButton();
}

function openQuickLook() {
  if (!usdzUrl) return;
  const a = document.createElement('a');
  a.rel = 'ar';
  // 実寸表示を保つためピンチでの拡大縮小を禁止
  a.href = `${usdzUrl}#allowsContentScaling=0`;
  a.appendChild(document.createElement('img')); // Quick Look は子 img が必要
  a.click();
}

// ---------- 入力変更 ----------
let debounce = 0;
let doorsOpen = false;
// 前回のサイズと塗装色を端末に記憶する
const STORE_KEY = 'ar-panel-settings';
function saveSettings(s) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ w: s.wmm, h: s.hmm, d: s.dmm, color: s.color }));
  } catch { /* 保存できない環境では記憶しない */ }
}
function restoreSettings() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!v) return;
    for (const k of ['w', 'h', 'd']) if (Number(v[k]) > 0) $(k).value = v[k];
    if (/^#[0-9a-f]{6}$/i.test(v.color)) $('color').value = v.color;
  } catch { /* 読めなければ既定値のまま */ }
}

function onSizeChange() {
  const s = readSize();
  saveSettings(s);
  const m = toMeters(s);
  if (previewPanel) pScene.remove(previewPanel);
  previewPanel = buildPanel(m, doorsOpen);
  pScene.add(previewPanel);
  $('dims').textContent = `W${s.wmm} × H${s.hmm} × D${s.dmm} mm`;
  if (quickLook) {
    usdzUrl = null;
    updateArButton();
    clearTimeout(debounce);
    debounce = setTimeout(() => buildUsdz(m), 250);
  }
}
for (const id of ['w', 'h', 'd', 'color']) {
  $(id).addEventListener('input', onSizeChange);
  $(id).addEventListener('change', onSizeChange);
}
// 塗装色の見本
function markSwatch() {
  const v = $('color').value.toLowerCase();
  let hit = false;
  for (const b of document.querySelectorAll('#swatches button')) {
    const on = b.dataset.color === v;
    b.classList.toggle('on', on);
    hit ||= on;
  }
  $('color').parentElement.classList.toggle('on', !hit);
}
for (const b of document.querySelectorAll('#swatches button')) {
  b.addEventListener('click', () => { $('color').value = b.dataset.color; markSwatch(); onSizeChange(); });
}
$('color').addEventListener('input', markSwatch);
$('size-form').addEventListener('submit', (e) => e.preventDefault());

// 扉の開閉(プレビュー)。iPhone の AR はこの状態で表示する
function toggleDoors() {
  doorsOpen = !doorsOpen;
  setDoors(previewPanel, doorsOpen);
  $('door-btn').textContent = doorsOpen ? '扉を閉じる' : '扉を開く';
  if (quickLook) {
    usdzUrl = null;
    updateArButton();
    clearTimeout(debounce);
    debounce = setTimeout(() => buildUsdz(toMeters(readSize())), 250);
  }
}
$('door-btn').addEventListener('click', toggleDoors);

// プレビューの扉をタップしても開閉
function hitDoor(raycaster, panel) {
  const hit = raycaster.intersectObject(panel, true).find((i) => i.object.userData.door !== undefined);
  return hit ? hit.object.userData.door : null;
}
let downAt = null;
pCanvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
pCanvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8 || performance.now() - downAt.t > 400) return;
  const r = pCanvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, pCamera);
  if (hitDoor(ray, previewPanel) !== null) toggleDoors();
});

// ---------- ボタン状態 ----------
let webxrAR = false;
function updateArButton() {
  const btn = $('ar-btn');
  const hint = $('hint');
  if (quickLook) {
    btn.disabled = !usdzUrl;
    btn.textContent = usdzUrl ? 'ARで置く(iPhone / iPad)' : 'モデル作成中…';
    hint.innerHTML = 'AR画面で床を映すと実寸で置かれます。<b>シャッターボタンで写真、長押しで動画</b>を撮影し、カメラロールに保存されます。';
  } else if (webxrAR) {
    btn.disabled = false;
    btn.textContent = 'ARで置く(Android)';
    hint.innerHTML = 'AR画面で床に出る白い丸を長押しすると盤を置けます。足元の輪をなぞると回転します。写真・動画はダウンロード フォルダに保存されます。';
  } else {
    btn.disabled = true;
    btn.textContent = 'この端末ではARを使えません';
    hint.innerHTML = 'iPhone(Safari)または ARCore 対応の Android(Chrome)で開いてください。HTTPS 配信が必要です。';
  }
}

$('ar-btn').addEventListener('click', () => {
  if (quickLook) openQuickLook();
  else if (webxrAR) startXR();
});

// ---------- Android: WebXR ----------
let xrSession = null;
let xr = null; // XR 用の状態一式

async function detectWebXR() {
  try {
    webxrAR = !!navigator.xr && await navigator.xr.isSessionSupported('immersive-ar');
  } catch { webxrAR = false; }
}

function makeShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.45)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const LONG_PRESS_MS = 600;

async function startXR() {
  const overlay = $('xr-overlay');
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'camera-access'],
      domOverlay: { root: overlay },
    });
  } catch (e) {
    alert('ARを開始できませんでした: ' + e.message);
    return;
  }

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { xrCompatible: true, alpha: true });
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, alpha: true });
  renderer.setPixelRatio(1);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(new THREE.HemisphereLight('#ffffff', '#777777', 2.2));
  const light = new THREE.DirectionalLight('#ffffff', 1.4);
  light.position.set(1, 3, 2);
  scene.add(light);

  // カメラ映像を背景として自前で描く(撮影時に映像ごと読み出すため)
  const camMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, flipY: { value: params.get('flip') === '1' ? 1 : 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }',
    fragmentShader: 'uniform sampler2D map; uniform float flipY; varying vec2 vUv;' +
      'void main(){ vec2 uv = vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, flipY)); gl_FragColor = texture2D(map, uv); }',
    depthTest: false, depthWrite: false,
  });
  const camQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), camMat);
  camQuad.frustumCulled = false;
  camQuad.renderOrder = -1;
  camQuad.visible = false;
  scene.add(camQuad);

  // 照準(白い丸)と、長押しの進み具合を示す塗りつぶし
  const reticle = new THREE.Group();
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  reticle.add(new THREE.Mesh(
    new THREE.RingGeometry(0.08, 0.1, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#ffffff' }),
  ));
  const progress = new THREE.Mesh(
    new THREE.CircleGeometry(0.08, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 }),
  );
  progress.visible = false;
  reticle.add(progress);
  scene.add(reticle);

  const m = toMeters(readSize());
  const holder = new THREE.Group();
  holder.visible = false;
  const panel = buildPanel(m, doorsOpen);
  holder.add(panel);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(m.w * 1.6, m.d * 1.6 + 0.2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: makeShadowTexture(), transparent: true, depthWrite: false }),
  );
  shadow.position.y = 0.001;
  holder.add(shadow);

  // 回転用の輪(盤の足元)。輪の上をなぞると回転する
  const ringR = Math.hypot(m.w, m.d) / 2 + 0.15;
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(ringR - 0.02, ringR + 0.02, 96).rotateX(-Math.PI / 2), ringMat);
  ring.position.y = 0.003;
  holder.add(ring);
  // 輪の上の矢印(回せることを示す)
  const arrowGeo = new THREE.ConeGeometry(0.045, 0.1, 3).rotateZ(-Math.PI / 2).rotateX(-Math.PI / 2);
  for (const a of [Math.PI / 2, -Math.PI / 2]) {
    const arrow = new THREE.Mesh(arrowGeo, ringMat);
    arrow.position.set(Math.sin(a) * ringR, 0.004, Math.cos(a) * ringR);
    arrow.rotation.y = a + (a > 0 ? 0 : Math.PI);
    holder.add(arrow);
  }
  scene.add(holder);

  xr = {
    session, renderer, scene, camera, reticle, progress, holder, panel, ring, ringR, camQuad, lastTime: 0,
    hitSource: null, touch: null, mode: 'photo',
    photoPending: false, recorder: null, recStart: 0, recTimer: 0,
    recCanvas: null, recCtx: null, pixels: null, frame: 0,
  };
  xrSession = session;

  await renderer.xr.setSession(session);
  overlay.hidden = false;
  $('setup').hidden = true;
  setMode('photo');

  const viewerSpace = await session.requestReferenceSpace('viewer');
  xr.hitSource = await session.requestHitTestSource({ space: viewerSpace });

  xr.cameraOk = !!session.enabledFeatures?.includes('camera-access');
  updateShutter();
  updateDoorButton();

  session.addEventListener('end', endXR);
  session.addEventListener('selectstart', onTouchStart);
  session.addEventListener('selectend', onTouchEnd);
  renderer.setAnimationLoop(onXRFrame);
}

// 画面タッチの光線と、高さ y の水平面との交点
function floorPoint(frame, inputSource, y) {
  const pose = frame.getPose(inputSource.targetRaySpace, xr.renderer.xr.getReferenceSpace());
  if (!pose) return null;
  const mat = new THREE.Matrix4().fromArray(pose.transform.matrix);
  const origin = new THREE.Vector3().setFromMatrixPosition(mat);
  const dir = new THREE.Vector3(0, 0, -1).transformDirection(mat);
  if (Math.abs(dir.y) < 1e-4) return null;
  const t = (y - origin.y) / dir.y;
  return t > 0 ? origin.addScaledVector(dir, t) : null;
}

function angleAround(center, p) {
  return Math.atan2(p.x - center.x, p.z - center.z);
}

// 画面タッチの光線を Raycaster に
function touchRay(frame, inputSource) {
  const pose = frame.getPose(inputSource.targetRaySpace, xr.renderer.xr.getReferenceSpace());
  if (!pose) return null;
  const mat = new THREE.Matrix4().fromArray(pose.transform.matrix);
  const origin = new THREE.Vector3().setFromMatrixPosition(mat);
  const dir = new THREE.Vector3(0, 0, -1).transformDirection(mat);
  return new THREE.Raycaster(origin, dir);
}

function onTouchStart(e) {
  const { holder, ringR } = xr;
  if (holder.visible) {
    const ray = touchRay(e.frame, e.inputSource);
    const hits = ray ? ray.intersectObject(xr.panel, true) : [];
    // 盤(扉を含む)を触ったらドラッグで移動
    if (hits.length) {
      xr.touch = {
        kind: 'move',
        source: e.inputSource, t0: performance.now(),
        p0: floorPoint(e.frame, e.inputSource, holder.position.y),
        pos0: holder.position.clone(),
      };
      return;
    }
    // 足元の輪の上を触ったときだけ回転
    const p = floorPoint(e.frame, e.inputSource, holder.position.y);
    if (p) {
      const d = Math.hypot(p.x - holder.position.x, p.z - holder.position.z);
      if (Math.abs(d - ringR) < 0.2) {
        xr.touch = { kind: 'rotate', source: e.inputSource, a0: angleAround(holder.position, p), r0: holder.rotation.y };
        xr.ring.material.opacity = 1;
        return;
      }
    }
  }
  // それ以外は長押しで白い丸の位置に置く
  xr.touch = { kind: 'press', source: e.inputSource, t0: performance.now() };
}

function onTouchEnd() {
  if (!xr) return;
  xr.touch = null;
  xr.progress.visible = false;
  xr.ring.material.opacity = 0.55;
}

function onXRFrame(time, frame) {
  const { renderer, scene, camera, reticle, holder, camQuad, touch } = xr;
  const ref = renderer.xr.getReferenceSpace();
  const pose = frame.getViewerPose(ref);
  const dt = xr.lastTime ? Math.min((time - xr.lastTime) / 1000, 0.1) : 0;
  xr.lastTime = time;
  animateDoors(xr.panel, dt);

  if (xr.hitSource) {
    const hits = frame.getHitTestResults(xr.hitSource);
    if (hits.length && touch?.kind !== 'rotate' && touch?.kind !== 'move') {
      reticle.visible = true;
      reticle.matrix.fromArray(hits[0].getPose(ref).transform.matrix);
    } else {
      reticle.visible = false;
    }
  }

  if (touch?.kind === 'press') {
    const k = (performance.now() - touch.t0) / LONG_PRESS_MS;
    xr.progress.visible = reticle.visible;
    xr.progress.scale.setScalar(Math.max(0.05, Math.min(k, 1)));
    if (k >= 1 && reticle.visible) {
      placePanel();
      xr.touch = { kind: 'done' };
      xr.progress.visible = false;
    }
  } else if (touch?.kind === 'move' && touch.p0) {
    const p = floorPoint(frame, touch.source, holder.position.y);
    if (p) holder.position.set(touch.pos0.x + p.x - touch.p0.x, touch.pos0.y, touch.pos0.z + p.z - touch.p0.z);
  } else if (touch?.kind === 'rotate') {
    const p = floorPoint(frame, touch.source, holder.position.y);
    if (p) holder.rotation.y = touch.r0 + (angleAround(holder.position, p) - touch.a0);
  }

  const xrCam = pose?.views[0]?.camera;
  const camTex = xrCam ? renderer.xr.getCameraTexture(xrCam) : null;
  camQuad.visible = !!camTex;
  if (camTex) camQuad.material.uniforms.map.value = camTex;

  // 撮影中は操作用の輪と照準を写さない
  const capturing = xr.photoPending || !!xr.recorder;
  const ringWasVisible = xr.ring.visible;
  const reticleWasVisible = reticle.visible;
  if (capturing) { xr.ring.visible = false; reticle.visible = false; }
  renderer.render(scene, camera);
  if (camTex && capturing) capture();
  xr.ring.visible = ringWasVisible;
  reticle.visible = reticleWasVisible;
}

function placePanel() {
  const { reticle, holder, renderer } = xr;
  const pos = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
  holder.position.copy(pos);
  // 正面(+Z)を端末に向ける
  const cp = new THREE.Vector3().setFromMatrixPosition(renderer.xr.getCamera().matrixWorld);
  holder.rotation.set(0, Math.atan2(cp.x - pos.x, cp.z - pos.z), 0);
  holder.visible = true;
  navigator.vibrate?.(30);
  updateShutter();
  updateDoorButton();
}

// XR フレームバッファを読み出して 2D キャンバスへ(上下反転)
function readFrame() {
  const { renderer } = xr;
  const rt = renderer.getRenderTarget();
  const w = rt ? rt.width : renderer.domElement.width;
  const h = rt ? rt.height : renderer.domElement.height;
  if (!xr.pixels || xr.pixels.length !== w * h * 4) xr.pixels = new Uint8Array(w * h * 4);
  if (rt) renderer.readRenderTargetPixels(rt, 0, 0, w, h, xr.pixels);
  else {
    const gl = renderer.getContext();
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, xr.pixels);
  }
  if (!xr.recCanvas) {
    xr.recCanvas = document.createElement('canvas');
    xr.recCtx = xr.recCanvas.getContext('2d');
    xr.tmpCanvas = document.createElement('canvas');
    xr.tmpCtx = xr.tmpCanvas.getContext('2d');
  }
  if (xr.recCanvas.width !== w || xr.recCanvas.height !== h) {
    xr.recCanvas.width = xr.tmpCanvas.width = w;
    xr.recCanvas.height = xr.tmpCanvas.height = h;
  }
  const img = new ImageData(new Uint8ClampedArray(xr.pixels.buffer), w, h);
  xr.tmpCtx.putImageData(img, 0, 0);
  const c = xr.recCtx;
  c.save();
  c.setTransform(1, 0, 0, -1, 0, h);
  c.drawImage(xr.tmpCanvas, 0, 0);
  c.restore();
}


function capture() {
  xr.frame++;
  if (xr.photoPending) {
    xr.photoPending = false;
    readFrame();
    xr.recCanvas.toBlob((b) => b && save(b, `panel_${stamp()}.jpg`), 'image/jpeg', 0.92);
    flash();
    return;
  }
  // 録画中は1フレームおきに取り込み(読み出し負荷を抑える)
  if (xr.frame % 2 === 0) readFrame();
}

function flash() {
  const f = $('xr-flash');
  f.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on')));
}

function pickMime() {
  for (const t of ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']) {
    if (window.MediaRecorder?.isTypeSupported?.(t)) return t;
  }
  return '';
}

function setMode(mode) {
  if (xr?.recorder) return;
  xr.mode = mode;
  for (const b of document.querySelectorAll('#xr-modes button')) b.classList.toggle('on', b.dataset.mode === mode);
  $('xr-shutter').className = `shutter ${mode}`;
}

function startRecording() {
  readFrame(); // キャンバスを初期化
  const mime = pickMime();
  const stream = xr.recCanvas.captureStream(30);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8e6 } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    const type = rec.mimeType || mime || 'video/webm';
    save(new Blob(chunks, { type }), `panel_${stamp()}.${type.includes('mp4') ? 'mp4' : 'webm'}`);
  };
  rec.start(1000);
  xr.recorder = rec;
  xr.recStart = performance.now();
  $('xr-shutter').classList.add('recording');
  $('xr-modes').classList.add('locked');
  const time = $('xr-rec-time');
  time.hidden = false;
  const tick = () => {
    const s = Math.floor((performance.now() - xr.recStart) / 1000);
    time.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  tick();
  xr.recTimer = setInterval(tick, 250);
}

function stopRecording() {
  if (!xr?.recorder) return;
  xr.recorder.stop();
  xr.recorder = null;
  clearInterval(xr.recTimer);
  $('xr-rec-time').hidden = true;
  $('xr-shutter').classList.remove('recording');
  $('xr-modes').classList.remove('locked');
}

// 盤を置くまで、またカメラ映像を取り込めない端末では撮影できない
function updateShutter() {
  $('xr-shutter').disabled = !(xr?.cameraOk && xr.holder.visible);
}

function onShutter() {
  if (!xr?.cameraOk || !xr.holder.visible) return;
  if (xr.mode === 'photo') xr.photoPending = true;
  else if (xr.recorder) stopRecording();
  else startRecording();
}

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 直前の撮影をサムネイルに表示
  const thumb = $('xr-thumb');
  if (blob.type.startsWith('image/')) {
    thumb.style.backgroundImage = `url(${url})`;
  } else if (xr?.recCanvas) {
    thumb.style.backgroundImage = `url(${xr.recCanvas.toDataURL('image/jpeg', 0.6)})`;
  }
  thumb.classList.add('has');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

function endXR() {
  if (!xr) return;
  stopRecording();
  xr.hitSource?.cancel?.();
  xr.renderer.setAnimationLoop(null);
  xr.renderer.dispose();
  xr = null;
  xrSession = null;
  $('xr-overlay').hidden = true;
  $('setup').hidden = false;
}

// ボタン上のタッチは AR の操作(長押し配置・回転)として扱わない
$('xr-overlay').addEventListener('beforexrselect', (e) => {
  if (e.target.closest?.('button')) e.preventDefault();
});
$('xr-shutter').addEventListener('click', onShutter);
for (const b of document.querySelectorAll('#xr-modes button')) b.addEventListener('click', () => xr && setMode(b.dataset.mode));
$('xr-exit').addEventListener('click', () => xrSession?.end());
$('xr-door').addEventListener('click', () => {
  if (!xr?.holder.visible) return;
  setDoors(xr.panel, !xr.panel.userData.doorsOpen);
  updateDoorButton();
});
function updateDoorButton() {
  const b = $('xr-door');
  const open = !!xr?.panel.userData.doorsOpen;
  b.disabled = !xr?.holder.visible;
  b.classList.toggle('open', open);
  b.setAttribute('aria-label', open ? '扉を閉じる' : '扉を開く');
}

// ---------- 起動 ----------
restoreSettings();
markSwatch();
onSizeChange();
fitPreview(toMeters(readSize()));
$('size-form').addEventListener('change', () => fitPreview(toMeters(readSize())));
await detectWebXR();
updateArButton();
