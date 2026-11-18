import precision from '../../shaders/precision.glsl';

const shader = `
${precision}

#define EMITTER_PARTICLE2 0
#define EMITTER_RIBBON 1

uniform sampler2D u_texture;
uniform highp int u_emitter;
uniform float u_filterMode;

varying vec2 v_texcoord;
varying vec4 v_color;
varying float v_depth;
uniform float u_pFogOn;
uniform float u_pFogStart;
uniform float u_pFogEnd;
uniform vec3 u_pFogColor;

void main() {
  vec4 texel = texture2D(u_texture, v_texcoord);
  vec4 color = texel * v_color;

  // 1bit Alpha, used by ribbon emitters.
  if (u_emitter == EMITTER_RIBBON && u_filterMode == 1.0 && color.a < 0.75) {
    discard;
  }

  // "Close to 0 alpha"
  if (u_emitter == EMITTER_PARTICLE2 && (u_filterMode == 2.0 || u_filterMode == 3.0) && color.a < 0.02) {
    discard;
  }

  // Alpha key.
  if (u_emitter == EMITTER_PARTICLE2 && (u_filterMode == 4.0) && color.a < 0.75) {
    discard;
  }

  // OpenWar3: the scene's distance fog, for an emitter not flagged Unfogged. As on a model's
  // layers, the real client draws additive particles with fog OFF (traced, docs/lighting.md).
  if (u_pFogOn > 0.5) {
    float f = clamp((u_pFogEnd - v_depth) / (u_pFogEnd - u_pFogStart), 0.0, 1.0);
    if (u_filterMode == 0.0 || u_filterMode == 4.0) color.rgb = mix(u_pFogColor, color.rgb, f);
  }
  gl_FragColor = color;
}
`;

export default shader;
