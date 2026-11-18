import precision from '../../shaders/precision.glsl';

const shader = `
// #extension GL_OES_standard_derivatives : enable

${precision}

uniform sampler2D u_texture1;
uniform sampler2D u_texture2;

// OpenWar3: fog of war. Cliff faces are batched instanced models drawn in the terrain
// pass, so our ground-veil mesh can't cover their overhang — instead we dim them here.
// u_fogTexture is a per-corner brightness mask (1=in sight, 0.5=explored, 0=unexplored)
// built by FogOverlay; u_fogParams maps world XY → mask UV (originX, originY, invSpanX,
// invSpanY). u_fogEnabled is 0 when no fog is installed, keeping stock behaviour.
uniform sampler2D u_fogTexture;
uniform vec4 u_fogParams;
uniform float u_fogEnabled;

// OpenWar3: the map's baked shadow layer (war3map.shd; src/render/terrainShadowOverlay.ts)
// for the same reason as the fog above. That layer is a decal laid on the GROUND's corner
// grid, and a cliff or ramp tile has no ground: its quad is a plane slanting from the low
// corners to the high ones, which slices through the cliff model and paints whatever part of
// the rock happens to be behind it — the hard dark wedges along cliffs. The overlay now skips
// those cells and the cliff darkens itself here: u_shdParams maps world XY to mask UV
// (originX, originY, invSpanX, invSpanY), u_shdStrength is the overlay's own strength.
uniform sampler2D u_shdTexture;
uniform vec4 u_shdParams;
uniform float u_shdStrength;
uniform float u_shdEnabled;

// OpenWar3: day/night cycle, from the tileset's Environment\DNC\*Terrain.mdx light —
// the same values the ground pass gets, so a cliff face and the grass on top of it
// darken together. See ground.frag. Cliff instances are translation-only, so a_normal
// is already world space.
uniform float u_dncEnabled;
uniform vec3 u_dncAmbient;
uniform vec3 u_dncDiffuse;
uniform vec3 u_dncLightDir;

// OpenWar3: linear distance fog (environment haze; src/render/fog.ts). Reuses the
// cliff's world position (v_position). Distinct from the fog-of-war mask above.
uniform float u_distFogEnabled;
uniform float u_distFogStart;
uniform float u_distFogEnd;
uniform vec3 u_distFogColor;
uniform vec3 u_distFogEye;
uniform vec3 u_distFogDir; // view axis — the fog distance is a DEPTH (see the SD shader)

varying vec3 v_normal;
varying vec2 v_uv;
varying float v_texture;
varying vec3 v_position;

// const vec3 lightDirection = normalize(vec3(-0.3, -0.3, 0.25));

vec4 sample(float texture, vec2 uv) {
  // int(0.0) == 0 is not always true.
  int i = int(texture + 0.1);

  if (i == 0) {
    return texture2D(u_texture1, uv);
  } else {
    return texture2D(u_texture2, uv);
  }
}

void main() {
  vec4 color = sample(v_texture, v_uv);

  // vec3 faceNormal = cross(dFdx(v_position), dFdy(v_position));
  // vec3 normal = normalize((faceNormal + v_normal) * 0.5);

  // color *= clamp(dot(normal, lightDirection) + 0.45, 0.1, 1.0);

  // OpenWar3: day/night shading (ambient + diffuse*N·L), before the fog dimming.
  if (u_dncEnabled > 0.5) {
    vec3 n = normalize(v_normal);
    float ndotl = max(dot(n, u_dncLightDir), 0.0);
    // A cliff WALL hardly answers the sun. Sampled per wall on 1.30.4 (Booty Bay, noon light), a
    // face the sun hits square and one it misses are both about 0.3 of the texture, where the full
    // N.L took them to 1.0 and to 0.17 either side of one tile seam. These two numbers are that
    // fit; no file states them. What meets the grass (n.z high) stays lit as the ground is.
    ndotl = mix(0.16 + 0.07 * ndotl, ndotl, smoothstep(0.35, 0.75, n.z));
    color.rgb *= clamp(u_dncAmbient + u_dncDiffuse * ndotl, 0.0, 1.0);
  }

  // OpenWar3: atmospheric distance fog (haze), before the fog-of-war dimming.
  if (u_distFogEnabled > 0.5) {
    float f = clamp((u_distFogEnd - dot(u_distFogEye - v_position, u_distFogDir)) / (u_distFogEnd - u_distFogStart), 0.0, 1.0);
    color.rgb = mix(u_distFogColor, color.rgb, f);
  }

  // OpenWar3: the baked shadow, the way the overlay blends it over the ground (black at
  // mask * strength) — after the haze, as the overlay is drawn after the ground's haze.
  if (u_shdEnabled > 0.5) {
    vec2 shdUv = (v_position.xy - u_shdParams.xy) * u_shdParams.zw;
    color.rgb *= 1.0 - texture2D(u_shdTexture, shdUv).a * u_shdStrength;
  }

  // OpenWar3: dim the cliff by the fog-of-war brightness at this fragment's world XY.
  if (u_fogEnabled > 0.5) {
    vec2 fogUv = (v_position.xy - u_fogParams.xy) * u_fogParams.zw;
    float lit = texture2D(u_fogTexture, fogUv).r;
    // The same result as FogOverlay's veil on the ground beside this tile: FoggedTerrain
    // (170,16,16,32) in the remembered range, running to black past it. Dimming alone left every
    // cliff and ramp tile plain dark green against blue-grey ground, with a hard line at each cell.
    vec3 fogged = vec3(16.0, 16.0, 32.0) / 255.0 * clamp(lit * 3.0, 0.0, 1.0);
    color.rgb = color.rgb * lit + fogged * (1.0 - lit);
  }

  gl_FragColor = color;
}
`;

export default shader;
