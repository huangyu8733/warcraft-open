import precision from '../../shaders/precision.glsl';

const shader = `
${precision}

uniform sampler2D u_tilesets[15];

// OpenWar3: day/night cycle. The stock shader hard-coded a light direction and then
// commented the lighting out entirely, leaving the ground fullbright at every hour.
// These come from the tileset's Environment\DNC\*Terrain.mdx light, sampled at the
// current time of day (src/render/dayNight.ts): u_dncAmbient is ambColor*ambIntensity,
// u_dncDiffuse is color*intensity, u_dncLightDir points toward the sun. u_dncEnabled
// is 0 when no cycle is installed, which keeps the stock fullbright look.
uniform float u_dncEnabled;
uniform vec3 u_dncAmbient;
uniform vec3 u_dncDiffuse;
uniform vec3 u_dncLightDir;

// OpenWar3: linear distance fog (the WC3 environment haze; src/render/fog.ts). Set on
// the map render from the w3i fog settings. Distinct from fog-of-war (u_fog*).
uniform float u_distFogEnabled;
uniform float u_distFogStart;
uniform float u_distFogEnd;
uniform vec3 u_distFogColor;
uniform vec3 u_distFogEye;
uniform vec3 u_distFogDir; // view axis — the fog distance is a DEPTH (see the SD shader)

varying vec4 v_tilesets;
varying vec2 v_uv[4];
varying vec3 v_normal;
varying vec3 v_dfPos;

vec3 applyDistFog(vec3 rgb) {
  if (u_distFogEnabled < 0.5) return rgb;
  float f = clamp((u_distFogEnd - dot(u_distFogEye - v_dfPos, u_distFogDir)) / (u_distFogEnd - u_distFogStart), 0.0, 1.0);
  return mix(u_distFogColor, rgb, f);
}

vec4 sample(float tileset, vec2 uv) {
  // 1.0 - 1.0 == 0.0 is not always true.
  int i = int(tileset - 0.6);

  if (i == 0) {
    return texture2D(u_tilesets[0], uv);
  } else if (i == 1) {
    return texture2D(u_tilesets[1], uv);
  } else if (i == 2) {
    return texture2D(u_tilesets[2], uv);
  } else if (i == 3) {
    return texture2D(u_tilesets[3], uv);
  } else if (i == 4) {
    return texture2D(u_tilesets[4], uv);
  } else if (i == 5) {
    return texture2D(u_tilesets[5], uv);
  } else if (i == 6) {
    return texture2D(u_tilesets[6], uv);
  } else if (i == 7) {
    return texture2D(u_tilesets[7], uv);
  } else if (i == 8) {
    return texture2D(u_tilesets[8], uv);
  } else if (i == 9) {
    return texture2D(u_tilesets[9], uv);
  } else if (i == 10) {
    return texture2D(u_tilesets[10], uv);
  } else if (i == 11) {
    return texture2D(u_tilesets[11], uv);
  } else if (i == 12) {
    return texture2D(u_tilesets[12], uv);
  } else if (i == 13) {
    return texture2D(u_tilesets[13], uv);
  } else if (i == 14) {
    return texture2D(u_tilesets[14], uv);
  }
}

vec4 blend(vec4 color, float tileset, vec2 uv) {
  vec4 texel = sample(tileset, uv);

  return mix(color, texel, texel.a);
}

void main() {
  vec4 color = sample(v_tilesets[0], v_uv[0]);

  if (v_tilesets[1] > 0.5) {
    color = blend(color, v_tilesets[1], v_uv[1]);
  }

  if (v_tilesets[2] > 0.5) {
    color = blend(color, v_tilesets[2], v_uv[2]);
  }

  if (v_tilesets[3] > 0.5) {
    color = blend(color, v_tilesets[3], v_uv[3]);
  }

  // OpenWar3: WC3's fixed-function lighting — ambient + diffuse*N·L, clamped per
  // channel, modulating the texel. At noon that saturates to white (the ground reads
  // as its raw texture); at midnight Lordaeron's sun sinks to (0.80, 0.53, 0.31),
  // which is exactly the warm dim brown the real game paints.
  if (u_dncEnabled > 0.5) {
    float ndotl = max(dot(normalize(v_normal), u_dncLightDir), 0.0);
    color.rgb *= clamp(u_dncAmbient + u_dncDiffuse * ndotl, 0.0, 1.0);
  }

  gl_FragColor = vec4(applyDistFog(color.rgb), 1.0);
}
`;

export default shader;
