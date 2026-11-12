/**
 * Point shaders (GLSL 3.0 through THREE.ShaderMaterial).
 * Render space is RTC (relative to a float64 project origin), so every value the GPU sees is
 * small and float32-safe. Absolute height for colouring = world.z + uOriginZ.
 */
export const pointVertex = /* glsl */ `
precision highp float;
precision highp int;

uniform float uPointSize;     // CSS px (fixed) or multiplier (adaptive)
uniform int   uSizeMode;      // 0 fixed, 1 adaptive (node spacing)
uniform float uSpacing;       // node spacing, m
uniform float uProjFactor;    // viewport height px / (2 tan(fov/2))
uniform float uPixelRatio;
uniform int   uColorMode;     // 0 rgb, 1 elevation, 2 intensity, 3 classification, 4 change dz
uniform float uOriginZ;
uniform vec2  uZRange;
uniform vec2  uIntensityRange;
uniform float uIntensityGamma;
uniform float uDzRange;
uniform float uHasDz;
uniform sampler2D uElevationMap;
uniform sampler2D uDivergingMap;
uniform vec3  uClassColors[16];
uniform int   uClipMode;      // 0 off, 1 keep slab only, 2 highlight slab
uniform vec3  uClipCenter;
uniform vec2  uClipAxis;      // unit vector along the section line (plan)
uniform float uClipHalfLength;
uniform float uClipHalfWidth;
uniform float uNodeSlot;

attribute vec3 color;
attribute float intensity;
attribute float classification;
attribute float dz;

varying vec3 vColor;
varying float vDim;
flat varying int vPickId;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vDim = 0.0;
  if (uClipMode > 0) {
    vec2 d = world.xy - uClipCenter.xy;
    float along = dot(d, uClipAxis);
    float across = dot(d, vec2(-uClipAxis.y, uClipAxis.x));
    bool inside = abs(along) <= uClipHalfLength && abs(across) <= uClipHalfWidth;
    if (!inside) {
      if (uClipMode == 1) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
      vDim = 1.0;
    }
  }
  vec4 mv = viewMatrix * world;
  gl_Position = projectionMatrix * mv;

  float size = uPointSize;
  if (uSizeMode == 1) {
    float depth = max(-mv.z, 0.01);
    size = uPointSize * uSpacing * uProjFactor / depth;
  }
  gl_PointSize = clamp(size, 1.0, 10.0) * uPixelRatio;

  if (uColorMode == 0) {
    vColor = color;
  } else if (uColorMode == 1) {
    float t = clamp((world.z + uOriginZ - uZRange.x) / max(uZRange.y - uZRange.x, 1e-6), 0.0, 1.0);
    vColor = texture(uElevationMap, vec2(t, 0.5)).rgb;
  } else if (uColorMode == 2) {
    float t = clamp((intensity * 65535.0 - uIntensityRange.x) / max(uIntensityRange.y - uIntensityRange.x, 1.0), 0.0, 1.0);
    vColor = vec3(pow(t, uIntensityGamma));
  } else if (uColorMode == 3) {
    vColor = uClassColors[int(classification) & 15];
  } else {
    if (uHasDz > 0.5) {
      float t = clamp(0.5 + dz / (2.0 * uDzRange), 0.0, 1.0);
      vColor = texture(uDivergingMap, vec2(t, 0.5)).rgb;
    } else {
      vColor = vec3(0.55);
    }
  }
  vPickId = (int(uNodeSlot) << 20) | gl_VertexID;
}
`;

export const pointFragment = /* glsl */ `
precision highp float;
precision highp int;
varying vec3 vColor;
varying float vDim;
flat varying int vPickId;
layout(location = 0) out highp vec4 outColor;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (dot(c, c) > 0.25) discard;
#ifdef PICK
  int id = vPickId;
  outColor = vec4(float((id >> 24) & 255), float((id >> 16) & 255), float((id >> 8) & 255), float(id & 255)) / 255.0;
#else
  vec3 col = vColor;
  if (vDim > 0.5) col = mix(col, vec3(0.12), 0.75);
  outColor = vec4(col, 1.0);
#endif
}
`;

/** Eye-Dome Lighting (Boucheny 2009): shades by log-depth differences to neighbours. */
export const edlVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const edlFragment = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uStrength;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;
layout(location = 0) out highp vec4 outColor;

float linearDepth(vec2 uv) {
  float d = texture(tDepth, uv).x;
  if (d >= 1.0) return 0.0;
  float z = d * 2.0 - 1.0;
  float lin = (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  return log2(lin);
}

void main() {
  vec4 col = texture(tColor, vUv);
  float d0 = linearDepth(vUv);
  if (d0 == 0.0) { outColor = col; return; }
  float sum = 0.0;
  vec2 offs[8] = vec2[8](vec2(1,0), vec2(-1,0), vec2(0,1), vec2(0,-1), vec2(1,1), vec2(-1,1), vec2(1,-1), vec2(-1,-1));
  for (int i = 0; i < 8; i++) {
    float d = linearDepth(vUv + offs[i] * uTexel * 1.5);
    sum += d == 0.0 ? 0.0 : max(0.0, d0 - d);
  }
  float shade = exp(-sum * 300.0 * uStrength / 8.0);
  outColor = vec4(col.rgb * shade, 1.0);
}
`;
