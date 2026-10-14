// layout JSON の anim（aiv-line-3d の scripts/sample_anim.js が書き出す動き）を、時刻から姿勢にする。
// frame = [cx,cy,cz,qx,qy,qz,qw,sx,sy,sz]（箱の中心 mm・向き・寸法 mm）、null は非表示。
//   cyc:true … 常にある部品。frames は1周期ぶんで、周期 P でつながる
//   spawn:s  … 周期ごとに現れるもの。s 秒に現れ、frames の長さだけ存在し、P ごとに繰り返す

export function parseAnim(a) {
  if (!a || !(a.period > 0) || !(a.dt > 0) || !Array.isArray(a.tracks)) return null;
  const fine = (f) => f === null || (Array.isArray(f) && f.length === 10 && f.every(Number.isFinite));
  const tracks = a.tracks.filter((t) => Array.isArray(t.frames) && t.frames.length && t.frames.every(fine) && (t.cyc || t.spawn >= 0));
  if (!tracks.length) return null;
  return { period: a.period, dt: a.dt, tracks };
}

// 同時に存在しうる数（spawn は周期をまたいで重なる）
export function instanceCount(anim, tr) {
  if (tr.cyc) return 1;
  return Math.ceil((tr.frames.length * anim.dt) / anim.period) + 1;
}

function slerp(out, a, b, u) {
  let d = a[3] * b[3] + a[4] * b[4] + a[5] * b[5] + a[6] * b[6], s = 1;
  if (d < 0) { d = -d; s = -1; }
  if (d > 0.9995) {
    for (let i = 0; i < 4; i++) out[i] = a[3 + i] + (s * b[3 + i] - a[3 + i]) * u;
  } else {
    const th = Math.acos(d), sa = Math.sin((1 - u) * th) / Math.sin(th), sb = (Math.sin(u * th) / Math.sin(th)) * s;
    for (let i = 0; i < 4; i++) out[i] = sa * a[3 + i] + sb * b[3 + i];
  }
  const n = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
  for (let i = 0; i < 4; i++) out[i] /= n;
}

// フレーム位置 x（小数）の姿勢。隣が非表示ならそのフレームの値を使い、両方が非表示なら null
function sample(frames, x, wrap, out) {
  const n = frames.length;
  let i = Math.floor(x), u = x - i;
  if (wrap) i = ((i % n) + n) % n;
  const a = frames[Math.min(Math.max(i, 0), n - 1)];
  const j = wrap ? (i + 1) % n : Math.min(i + 1, n - 1);
  const b = frames[j];
  if (!a && !b) return null;
  if (!a || !b || u < 1e-6) return a && (u < 0.5 || !b) ? a : b;
  for (let k = 0; k < 3; k++) out.pos[k] = a[k] + (b[k] - a[k]) * u;
  for (let k = 7; k < 10; k++) out.size[k - 7] = a[k] + (b[k] - a[k]) * u;
  slerp(out.q, a, b, u);
  return out;
}

// 時刻 t(秒)のトラックごとの姿勢を、visit(トラック番号, 何番目の複製か, pos, q, size | null) で渡す
export function poseAt(anim, t, visit) {
  const P = anim.period, dt = anim.dt;
  const tmp = { pos: [0, 0, 0], q: [0, 0, 0, 1], size: [0, 0, 0] };
  anim.tracks.forEach((tr, ti) => {
    const n = tr.frames.length;
    if (tr.cyc) {
      const x = (((t % P) + P) % P) / dt;
      emit(visit, ti, 0, sample(tr.frames, x, true, tmp), tmp);
      return;
    }
    const cnt = instanceCount(anim, tr), span = (n - 1) * dt;
    const k0 = Math.floor((t - tr.spawn - span) / P) + 1;      // 一番新しく消えた次の複製
    for (let c = 0; c < cnt; c++) {
      const age = t - tr.spawn - (k0 + c) * P;
      emit(visit, ti, c, age >= 0 && age <= span ? sample(tr.frames, age / dt, false, tmp) : null, tmp);
    }
  });
}

function emit(visit, ti, ci, s, tmp) {
  if (!s) return visit(ti, ci, null);
  if (Array.isArray(s)) return visit(ti, ci, s.slice(0, 3), s.slice(3, 7), s.slice(7, 10));   // 補間なしで返ってきたフレーム
  visit(ti, ci, tmp.pos, tmp.q, tmp.size);
}
