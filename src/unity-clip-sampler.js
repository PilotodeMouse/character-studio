// Reimplementa a avaliacao de AnimationCurve do Unity (Hermite cubico entre
// keyframes, com in/out slope explicitos -- o mesmo formato usado pelos
// arquivos .anim/.prefab serializados em texto). Isso e o que da o valor de
// cada curva (rotationCurves/positionCurves) num tempo t qualquer.

function hermite(t0, v0, outSlope0, t1, v1, inSlope1, t) {
  const dt = t1 - t0;
  if (dt <= 0) return v0;
  const s = (t - t0) / dt;
  const m0 = outSlope0 * dt;
  const m1 = inSlope1 * dt;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return h00 * v0 + h10 * m0 + h01 * v1 + h11 * m1;
}

// Avalia uma curva (lista de keys ordenadas por time, cada uma com value{x,y,z,w?})
// no tempo t, componente a componente. Fora do intervalo, clampa (m_PostInfinity/
// m_PreInfinity = 2 = "clamp" nos clips exportados aqui).
function sampleCurve(keys, t, components) {
  if (!keys.length) return null;
  if (t <= keys[0].time) return pick(keys[0].value, components);
  const last = keys[keys.length - 1];
  if (t >= last.time) return pick(last.value, components);

  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].time < t) i++;
  const k0 = keys[i];
  const k1 = keys[i + 1];

  const out = {};
  for (const c of components) {
    out[c] = hermite(k0.time, k0.value[c], k0.outSlope[c], k1.time, k1.value[c], k1.inSlope[c], t);
  }
  return out;
}

function pick(value, components) {
  const out = {};
  for (const c of components) out[c] = value[c];
  return out;
}

const POS_COMPONENTS = ['x', 'y', 'z'];
const ROT_COMPONENTS = ['x', 'y', 'z', 'w'];

function normalizeQuat(q) {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) || 1;
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

// Amostra todas as curvas do clip no tempo t (segundos) e devolve
// Map<path, { position?: {x,y,z}, rotation?: {x,y,z,w} }>
function sampleClip(clip, t) {
  const out = new Map();
  for (const c of clip.rotationCurves) {
    const raw = sampleCurve(c.keys, t, ROT_COMPONENTS);
    if (!raw) continue;
    if (!out.has(c.path)) out.set(c.path, {});
    out.get(c.path).rotation = normalizeQuat(raw);
  }
  for (const c of clip.positionCurves) {
    const raw = sampleCurve(c.keys, t, POS_COMPONENTS);
    if (!raw) continue;
    if (!out.has(c.path)) out.set(c.path, {});
    out.get(c.path).position = raw;
  }
  return out;
}

module.exports = { sampleClip, sampleCurve, normalizeQuat };
