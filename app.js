import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---------- 盤モデル ----------
// 原点は底面中央、正面は +Z。単位はメートル。
function buildPanel({ w, h, d, color }) {
  const group = new THREE.Group();
  group.name = 'panel';
  const body = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 });
  const door = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.96), roughness: 0.5, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2b2f33', roughness: 0.4, metalness: 0.5 });

  // 本体
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), body);
  box.position.y = h / 2;
  group.add(box);

  // 扉(正面の少し内側に一回り小さい板)
  const m = Math.min(0.025, w * 0.05, h * 0.05);
  const t = 0.004;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(w - 2 * m, h - 2 * m, t), door);
  plate.position.set(0, h / 2, d / 2 + t / 2);
  group.add(plate);

  // ハンドル(右側)
  const hh = Math.min(0.18, h * 0.2);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.025, hh, 0.03), dark);
  handle.position.set(w / 2 - m - 0.05, h * 0.5, d / 2 + t + 0.015);
  if (w > 0.15) group.add(handle);

  return group;
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

pRenderer.setAnimationLoop(() => {
  if (xrSession) return;
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
      const name = `usdz/panel_${Math.round(m.w * 1000)}x${Math.round(m.h * 1000)}x${Math.round(m.d * 1000)}_${m.color.slice(1)}.usdz`;
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
  scene.add(buildPanel(m));
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
function onSizeChange() {
  const s = readSize();
  const m = toMeters(s);
  if (previewPanel) pScene.remove(previewPanel);
  previewPanel = buildPanel(m);
  pScene.add(previewPanel);
  $('dims').textContent = `W${s.wmm} × H${s.hmm} × D${s.dmm} mm`;
  if (quickLook) {
    usdzUrl = null;
    updateArButton();
    clearTimeout(debounce);
    debounce = setTimeout(() => buildUsdz(m), 250);
  }
}
for (const id of ['w', 'h', 'd', 'color']) $(id).addEventListener('input', onSizeChange);
$('size-form').addEventListener('submit', (e) => e.preventDefault());

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
    hint.innerHTML = 'AR画面で床に照準が出たら「ここに置く」。写真・動画はダウンロード フォルダに保存され、Googleフォトのギャラリーから見られます。';
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

async function startXR() {
  const overlay = $('xr-overlay');
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'camera-access', 'light-estimation'],
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
  renderer.autoClear = true;

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

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.08, 0.1, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#ffffff' }),
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  const m = toMeters(readSize());
  const holder = new THREE.Group();
  holder.visible = false;
  holder.add(buildPanel(m));
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(m.w * 1.6, m.d * 1.6 + 0.2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: makeShadowTexture(), transparent: true, depthWrite: false }),
  );
  shadow.position.y = 0.001;
  holder.add(shadow);
  scene.add(holder);

  xr = { session, renderer, scene, camera, reticle, holder, camQuad, hitSource: null,
    cameraOk: false, photoPending: false, recorder: null, recCanvas: null, recCtx: null, pixels: null, frame: 0 };
  xrSession = session;

  await renderer.xr.setSession(session);
  overlay.hidden = false;
  $('setup').hidden = true;

  const viewerSpace = await session.requestReferenceSpace('viewer');
  xr.hitSource = await session.requestHitTestSource({ space: viewerSpace });

  const cameraFeature = session.enabledFeatures?.includes('camera-access');
  setCaptureEnabled(cameraFeature);

  session.addEventListener('end', endXR);
  // オーバーレイ上のタップを AR の select として扱わない
  overlay.addEventListener('beforexrselect', (e) => e.preventDefault());

  renderer.setAnimationLoop(onXRFrame);
}

function setCaptureEnabled(ok) {
  $('xr-photo').disabled = !ok;
  $('xr-rec').disabled = !ok;
  if (!ok) $('xr-msg').textContent = 'この端末はカメラ映像の取り込みに未対応です。撮影は端末のスクリーンショット/画面録画をお使いください';
}

function onXRFrame(time, frame) {
  const { renderer, scene, camera, reticle, holder, camQuad } = xr;
  const ref = renderer.xr.getReferenceSpace();
  const pose = frame.getViewerPose(ref);

  if (xr.hitSource) {
    const hits = frame.getHitTestResults(xr.hitSource);
    if (hits.length) {
      const p = hits[0].getPose(ref);
      reticle.visible = true;
      reticle.matrix.fromArray(p.transform.matrix);
      if (!holder.visible) $('xr-msg').textContent = '照準の位置に「ここに置く」で配置します';
    } else {
      reticle.visible = false;
    }
  }

  const xrCam = pose?.views[0]?.camera;
  const camTex = xrCam ? renderer.xr.getCameraTexture(xrCam) : null;
  camQuad.visible = !!camTex;
  if (camTex) camQuad.material.uniforms.map.value = camTex;

  renderer.render(scene, camera);

  if (camTex && (xr.photoPending || xr.recorder)) capture();
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

function toggleRecording() {
  const btn = $('xr-rec');
  if (xr.recorder) {
    xr.recorder.stop();
    return;
  }
  readFrame(); // キャンバスを初期化
  const mime = pickMime();
  const stream = xr.recCanvas.captureStream(30);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8e6 } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    const type = rec.mimeType || mime || 'video/webm';
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    save(new Blob(chunks, { type }), `panel_${stamp()}.${ext}`);
    xr.recorder = null;
    btn.textContent = '⏺ 録画';
    btn.classList.remove('rec-on');
  };
  rec.start(1000);
  xr.recorder = rec;
  btn.textContent = '⏹ 停止';
  btn.classList.add('rec-on');
}

function save(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  if (xr) $('xr-msg').textContent = `保存しました: ${name}`;
}

const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

function placePanel() {
  const { reticle, holder, renderer } = xr;
  if (!reticle.visible) return;
  const pos = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
  holder.position.copy(pos);
  // 正面(+Z)を端末に向ける
  const cam = renderer.xr.getCamera();
  const cp = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
  holder.rotation.set(0, Math.atan2(cp.x - pos.x, cp.z - pos.z), 0);
  holder.visible = true;
  $('xr-msg').textContent = '配置しました。回転・再配置・撮影ができます';
}

function endXR() {
  if (!xr) return;
  if (xr.recorder) xr.recorder.stop();
  xr.hitSource?.cancel?.();
  xr.renderer.setAnimationLoop(null);
  xr.renderer.dispose();
  xr = null;
  xrSession = null;
  $('xr-overlay').hidden = true;
  $('setup').hidden = false;
}

$('xr-place').addEventListener('click', () => xr && placePanel());
$('xr-rot-l').addEventListener('click', () => xr && (xr.holder.rotation.y += Math.PI / 12));
$('xr-rot-r').addEventListener('click', () => xr && (xr.holder.rotation.y -= Math.PI / 12));
$('xr-photo').addEventListener('click', () => xr && (xr.photoPending = true));
$('xr-rec').addEventListener('click', () => xr && toggleRecording());
$('xr-exit').addEventListener('click', () => xrSession?.end());

// ---------- 起動 ----------
onSizeChange();
fitPreview(toMeters(readSize()));
$('size-form').addEventListener('change', () => fitPreview(toMeters(readSize())));
await detectWebXR();
updateArButton();
