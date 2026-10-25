const FULLSCREEN_VERTEX = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
  // One triangle that covers the whole canvas.
  let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  var output: VertexOutput;
  output.position = vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
  output.uv = vec2f(corner.x, 1.0 - corner.y);
  return output;
}
`

/** Draws a browser-converted external texture as is. Used for SDR and for HDR frames the engine cannot read back. */
export const EXTERNAL_SHADER = /* wgsl */ `
${FULLSCREEN_VERTEX}

@group(0) @binding(0) var frameSampler: sampler;
@group(0) @binding(1) var frame: texture_external;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return vec4f(textureSampleBaseClampToEdge(frame, frameSampler, input.uv).rgb, 1.0);
}
`

/**
 * Converts raw YUV planes to the canvas. SDR frames only need YUV to R'G'B'.
 * HDR frames go from PQ or HLG to linear light, through BT.2390 tone mapping
 * on max(RGB) and the BT.2020 to BT.709 gamut, and are then sRGB encoded.
 * Dolby Vision profile 5 frames are first reshaped and converted from IPT to
 * BT.2020 with their RPU metadata, following libplacebo.
 */
export const PLANAR_SHADER = /* wgsl */ `
${FULLSCREEN_VERTEX}

struct Params {
  // Columns of the Y'CbCr to R'G'B' matrix.
  matrix0: vec4f,
  matrix1: vec4f,
  matrix2: vec4f,
  // y = (code - offset.x) * scale.x, c = (code - offset.y) * scale.y
  scale: vec2f,
  offset: vec2f,
  // 0 = PQ, 1 = HLG, 2 = SDR, 3 = Dolby Vision
  transfer: u32,
  // Source peak and SDR white in nits.
  sourcePeak: f32,
  sdrWhite: f32,
  convertGamut: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var lumaPlane: texture_2d<u32>;
@group(0) @binding(2) var cbPlane: texture_2d<u32>;
@group(0) @binding(3) var crPlane: texture_2d<u32>;
// Dolby Vision metadata in the layout frame_dovi in apps/web/wasm/ffmpeg_bridge.c writes.
@group(0) @binding(4) var<storage, read> dovi: array<f32>;

const DOVI_HEADER = 32u;
const DOVI_COMPONENT = 226u;
const DOVI_PIECE = 27u;

fn doviMatrix(start: u32) -> mat3x3f {
  return mat3x3f(
    vec3f(dovi[start], dovi[start + 3u], dovi[start + 6u]),
    vec3f(dovi[start + 1u], dovi[start + 4u], dovi[start + 7u]),
    vec3f(dovi[start + 2u], dovi[start + 5u], dovi[start + 8u]),
  );
}

// Maps one component through its piecewise polynomial or MMR reshaping curve.
fn doviReshape(signal: vec3f, component: u32) -> f32 {
  let base = DOVI_HEADER + component * DOVI_COMPONENT;
  let pivots = u32(dovi[base]);
  let value = signal[component];
  var piece = 0u;
  for (var index = 1u; index + 1u < pivots; index++) {
    if (value >= dovi[base + 1u + index]) {
      piece = index;
    }
  }
  let start = base + 10u + piece * DOVI_PIECE;
  var result = dovi[start + 1u] + value * (dovi[start + 2u] + value * dovi[start + 3u]);
  if (dovi[start] != 0.0) {
    // MMR terms: Y, Cb, Cr, their pairwise products, and their triple product, raised to each order.
    var terms = array<f32, 7>(
      signal.x, signal.y, signal.z,
      signal.x * signal.y, signal.x * signal.z, signal.y * signal.z,
      signal.x * signal.y * signal.z,
    );
    var power = terms;
    result = dovi[start + 5u];
    for (var order = 0u; order < u32(dovi[start + 4u]); order++) {
      for (var term = 0u; term < 7u; term++) {
        result += dovi[start + 6u + order * 7u + term] * power[term];
        power[term] *= terms[term];
      }
    }
  }
  return clamp(result, dovi[base + 1u], dovi[base + pivots]);
}

fn loadPlane(plane: texture_2d<u32>, uv: vec2f) -> f32 {
  // Bilinear filtering by hand, since integer textures cannot be sampled.
  let size = vec2f(textureDimensions(plane));
  let position = clamp(uv * size - 0.5, vec2f(0.0), size - 1.0);
  let base = vec2i(floor(position));
  let next = min(base + 1, vec2i(size) - 1);
  let weight = fract(position);
  let top = mix(f32(textureLoad(plane, base, 0).r), f32(textureLoad(plane, vec2i(next.x, base.y), 0).r), weight.x);
  let bottom = mix(f32(textureLoad(plane, vec2i(base.x, next.y), 0).r), f32(textureLoad(plane, next, 0).r), weight.x);
  return mix(top, bottom, weight.y);
}

const PQ_M1 = 0.1593017578125;
const PQ_M2 = 78.84375;
const PQ_C1 = 0.8359375;
const PQ_C2 = 18.8515625;
const PQ_C3 = 18.6875;

fn pqToNits(encoded: vec3f) -> vec3f {
  let power = pow(clamp(encoded, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / PQ_M2));
  return 10000.0 * pow(max(power - PQ_C1, vec3f(0.0)) / (PQ_C2 - PQ_C3 * power), vec3f(1.0 / PQ_M1));
}

fn nitsToPq(nits: f32) -> f32 {
  let normalized = pow(clamp(nits / 10000.0, 0.0, 1.0), PQ_M1);
  return pow((PQ_C1 + PQ_C2 * normalized) / (1.0 + PQ_C3 * normalized), PQ_M2);
}

fn pqToNitsScalar(encoded: f32) -> f32 {
  return pqToNits(vec3f(encoded)).x;
}

fn hlgToNits(encoded: vec3f) -> vec3f {
  // BT.2100 inverse OETF, then the OOTF for a 1000 nit display (system gamma 1.2).
  let a = 0.17883277;
  let b = 0.28466892;
  let c = 0.55991073;
  let e = clamp(encoded, vec3f(0.0), vec3f(1.0));
  let scene = select((exp((e - c) / a) + b) / 12.0, e * e / 3.0, e <= vec3f(0.5));
  let luminance = dot(scene, vec3f(0.2627, 0.6780, 0.0593));
  return 1000.0 * pow(max(luminance, 1e-6), 0.2) * scene;
}

// BT.2390 EETF in PQ space, mapping sourcePeak to sdrWhite.
fn toneMap(nits: f32) -> f32 {
  let sourcePq = nitsToPq(params.sourcePeak);
  let maxLuminance = nitsToPq(params.sdrWhite) / sourcePq;
  let e1 = nitsToPq(nits) / sourcePq;
  let kneeStart = 1.5 * maxLuminance - 0.5;
  var e2 = e1;
  if (e1 > kneeStart) {
    let t = (e1 - kneeStart) / (1.0 - kneeStart);
    let t2 = t * t;
    let t3 = t2 * t;
    e2 = (2.0 * t3 - 3.0 * t2 + 1.0) * kneeStart + (t3 - 2.0 * t2 + t) * (1.0 - kneeStart) + (-2.0 * t3 + 3.0 * t2) * maxLuminance;
  }
  return pqToNitsScalar(min(e2, 1.0) * sourcePq);
}

fn srgbEncode(value: vec3f) -> vec3f {
  let c = clamp(value, vec3f(0.0), vec3f(1.0));
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let y = (loadPlane(lumaPlane, input.uv) - params.offset.x) * params.scale.x;
  let cb = (loadPlane(cbPlane, input.uv) - params.offset.y) * params.scale.y;
  let cr = (loadPlane(crPlane, input.uv) - params.offset.y) * params.scale.y;
  let yuvToRgb = mat3x3f(params.matrix0.xyz, params.matrix1.xyz, params.matrix2.xyz);
  let encoded = yuvToRgb * vec3f(y, cb, cr);
  if (params.transfer == 2u) {
    return vec4f(clamp(encoded, vec3f(0.0), vec3f(1.0)), 1.0);
  }
  var nits = select(hlgToNits(encoded), pqToNits(encoded), params.transfer == 0u);
  if (params.transfer == 3u) {
    // Reshape, apply the RPU's YCbCr to nonlinear matrix, linearize PQ, then go to BT.2020.
    let signal = clamp(vec3f(y, cb, cr), vec3f(0.0), vec3f(1.0));
    let reshaped = vec3f(doviReshape(signal, 0u), doviReshape(signal, 1u), doviReshape(signal, 2u));
    let lms = pqToNits(doviMatrix(8u) * (reshaped - vec3f(dovi[4], dovi[5], dovi[6])));
    nits = max(doviMatrix(17u) * lms, vec3f(0.0));
  }

  let peak = max(max(nits.r, nits.g), nits.b);
  if (peak > 0.0 && params.sourcePeak > params.sdrWhite) {
    nits *= toneMap(peak) / peak;
  }
  var display = nits / params.sdrWhite;
  if (params.convertGamut == 1u) {
    display = mat3x3f(
      vec3f(1.6605, -0.1246, -0.0182),
      vec3f(-0.5876, 1.1329, -0.1006),
      vec3f(-0.0728, -0.0083, 1.1187),
    ) * display;
    // Pull out-of-gamut colors toward their luminance instead of hard clipping each channel.
    let luminance = dot(display, vec3f(0.2126, 0.7152, 0.0722));
    let lowest = min(min(display.r, display.g), display.b);
    if (lowest < 0.0) {
      display = mix(vec3f(luminance), display, luminance / max(luminance - lowest, 1e-6));
    }
  }
  return vec4f(srgbEncode(display), 1.0);
}
`
