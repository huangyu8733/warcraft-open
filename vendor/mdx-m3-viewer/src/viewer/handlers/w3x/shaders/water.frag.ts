import precision from '../../shaders/precision.glsl';

const shader = `
${precision}

uniform sampler2D u_waterTexture;

// OpenWar3: day/night cycle, the same terrain light the ground and cliffs take.
// The water sheet is flat, so its normal is world +Z and N·L collapses to the
// sun direction's z. Alpha (the shore fade from Water.slk) must not be dimmed.
uniform float u_dncEnabled;
uniform vec3 u_dncAmbient;
uniform vec3 u_dncDiffuse;
uniform vec3 u_dncLightDir;

// OpenWar3: linear distance fog (environment haze; src/render/fog.ts).
uniform float u_distFogEnabled;
uniform float u_distFogStart;
uniform float u_distFogEnd;
uniform vec3 u_distFogColor;
uniform vec3 u_distFogEye;
uniform vec3 u_distFogDir; // view axis — the fog distance is a DEPTH (see the SD shader)

// OpenWar3: fog of war. The water sheet is drawn at the WATER level, which on a shore or a
// deep channel sits ABOVE the ground — so FogOverlay's veil mesh, which hugs the terrain,
// passes underneath it and the sea stayed lit through pitch-black unexplored map. Dim it
// here instead, exactly as the cliff faces are (cliffs.frag). Same mask, same mapping:
// u_fogTexture is per-corner brightness (1=in sight, 0.5=explored, 0=unexplored) and
// u_fogParams maps world XY → mask UV. u_fogEnabled 0 keeps stock behaviour.
uniform sampler2D u_fogTexture;
uniform vec4 u_fogParams;
uniform float u_fogEnabled;

varying vec2 v_uv;
varying vec4 v_color;
varying vec3 v_dfPos;

void main() {
  vec4 color = texture2D(u_waterTexture, v_uv) * v_color;

  if (u_dncEnabled > 0.5) {
    color.rgb *= clamp(u_dncAmbient + u_dncDiffuse * max(u_dncLightDir.z, 0.0), 0.0, 1.0);
  }

  // Atmospheric haze — mix rgb only (keep the shore-fade alpha intact).
  if (u_distFogEnabled > 0.5) {
    float f = clamp((u_distFogEnd - dot(u_distFogEye - v_dfPos, u_distFogDir)) / (u_distFogEnd - u_distFogStart), 0.0, 1.0);
    color.rgb = mix(u_distFogColor, color.rgb, f);
  }

  // Fog of war, last — over unexplored ground this takes the sea to black, which is what
  // the veil has already done to the shore beside it. RGB only, like the haze above: the
  // alpha is Water.slk's shore fade and dimming it would eat the coastline.
  if (u_fogEnabled > 0.5) {
    vec2 fogUv = (v_dfPos.xy - u_fogParams.xy) * u_fogParams.zw;
    color.rgb *= texture2D(u_fogTexture, fogUv).r;
  }

  gl_FragColor = color;
}
`;

export default shader;
