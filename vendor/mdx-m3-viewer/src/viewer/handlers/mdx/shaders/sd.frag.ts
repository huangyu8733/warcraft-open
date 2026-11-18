import precision from '../../shaders/precision.glsl';
import quatTransform from '../../shaders/quattransform.glsl';

const shader = `
${precision}

${quatTransform}

uniform sampler2D u_texture;
uniform float u_filterMode;
uniform bool u_unshaded;

// OpenWar3: whole-instance transparency — the alpha of the instance's vertex colour
// (issue #66), 1 = opaque. Kept out of v_color so the 1-bit alpha test below still
// sees the layer's own alpha; see sd.vert. Layers pick up matching blend state in
// mdx/layer.ts bind(), and a faded instance is drawn in the translucent pass
// (mdx/modelinstance.ts) so it blends over finished opaque geometry.
uniform float u_instanceAlpha;

// OpenWar3: day/night cycle, from the tileset's Environment\DNC\*Unit.mdx light
// (src/render/dayNight.ts). Same colours the terrain gets, but a higher ambient
// intensity — Blizzard authored units to sit flatter than the ground. u_dncEnabled
// is 0 for scenes with no cycle (the portrait bust, the HUD clock), which keeps
// mdx-m3-viewer's stock near-flat lambert below.
uniform float u_dncEnabled;
uniform vec3 u_dncAmbient;
uniform vec3 u_dncDiffuse;
uniform vec3 u_dncLightDir;


// OpenWar3: linear distance fog (src/render/fog.ts). Fragments fade toward
// u_distFogColor between u_distFogStart and u_distFogEnd world units from the eye —
// the WC3 environment/menu haze. Distinct from the fog-of-war uniforms in the terrain
// shaders (u_fog*). u_distFogEnabled is 0 for scenes with no fog (keeps stock output).
uniform float u_distFogEnabled;
uniform float u_distFogFlags; // OpenWar3: scene honours the layer's Unfogged flag
uniform float u_unfogged; // OpenWar3: the layer's own Unfogged flag (MDX layer flag 32)
uniform float u_distFogStart;
uniform float u_distFogEnd;
uniform vec3 u_distFogColor;
uniform vec3 u_distFogEye;
// The camera's BACKWARD axis in world space, so the fog distance is dot(eye - frag, dir):
// the fragment's DEPTH along the view axis, not its straight-line range from the eye.
//
// That is what WC3 measures. Its fog is Direct3D's, and D3D linear fog runs on the view-space
// z unless D3DRS_RANGEFOGENABLE is turned on — which defaults to FALSE, only ever applied to
// vertex fog, and which WC3 does not use. Radial range is the same number dead ahead and
// larger everywhere else, by 1/cos(angle off the axis): at 32° vertical FOV on a 16:9 frame
// that is ~17% too far in the corners, so a scene with fog on wore a dark vignette that the
// real client does not have, heaviest exactly where the eye notices it least justified.
// Distances near the screen centre are unchanged, which is why this reads as the haze being
// evened out rather than simply turned down.
uniform vec3 u_distFogDir;

// OpenWar3: the map's UNPLAYABLE area, as it applies to the things STANDING on the ground
// rather than to the ground itself (issue #117). UI\MiscData.txt [FogOfWar] keeps a pair of
// rows for exactly this: BoundaryObject = 255,0,0,0 (BlackMaskedObject to the byte) and
// FoggedBoundaryObject = 255,64,64,96 (FoggedObject to the byte). How they are APPLIED is not
// in the file — read as a flat replacement they made every border tree a cut-out the real
// client does not draw; see applyBoundaryTint for the modulate we use instead.
//
// u_boundaryTexture is FogOverlay's per-corner RGBA mask: B says the corner is unplayable and
// G carries the FOG-only brightness there (1 in sight, ~0.5 remembered, 0 never seen) — the
// R channel the terrain shaders read has already been flattened to near-black by the boundary
// itself, so it cannot answer which of the two rows applies. u_boundaryParams maps world XY to
// mask UV. u_boundaryEnabled is 0 off the map (menus, portrait busts) and while a cinematic
// holds EnableWorldFogBoundary(false).
uniform float u_boundaryEnabled;
uniform sampler2D u_boundaryTexture;
uniform vec4 u_boundaryParams;
uniform vec3 u_boundaryLit;    // BoundaryObject, rgb 0..1 — the never-seen black
uniform vec3 u_boundaryFogged; // FoggedBoundaryObject, rgb 0..1 — modulates, ×2

varying vec2 v_uv;
varying vec3 v_normal;
varying vec4 v_color;
varying vec4 v_uvTransRot;
varying float v_uvScale;
varying vec3 v_lightDir;
varying vec3 v_worldPos;
varying vec3 v_ffpLight; // OpenWar3: the fixed-function vertex light (see sd.vert)
uniform float u_ffpLit; // OpenWar3: same switch as the vertex shader's u_ffpEnabled
uniform float u_lodBias; // OpenWar3: D3DSAMP_MIPMAPLODBIAS, -0.5 in the real client

// Blend rgb toward the fog colour by camera distance. Additive layers (filterMode
// 3/4) fade to black instead — black is the additive identity, so distant glows just
// disappear rather than tint the scene with fog colour.
vec3 applyDistFog(vec3 rgb, float filterMode) {
  if (u_distFogEnabled < 0.5) return rgb;
  // OpenWar3: the real client turns D3D fog OFF for an Unfogged layer and for every additive one
  // (traced, docs/lighting.md) rather than fading it to black.
  if (u_distFogFlags > 0.5 && (u_unfogged > 0.5 || (filterMode >= 3.0 && filterMode <= 4.0))) return rgb;
  float dist = dot(u_distFogEye - v_worldPos, u_distFogDir); // view depth — see u_distFogDir
  float f = clamp((u_distFogEnd - dist) / (u_distFogEnd - u_distFogStart), 0.0, 1.0);
  if (filterMode >= 3.0 && filterMode <= 4.0) return rgb * f;
  return mix(u_distFogColor, rgb, f);
}

// Fade a fragment toward "not drawn" by the instance's transparency. Which channel
// carries that depends on the layer's blend equation — the same reasoning applyDistFog
// uses above. For the alpha-blended modes (0/1 forced to SRC_ALPHA blending by
// layer.ts, and 2) it's the alpha; for additive (3/4) black is the identity, so scale
// rgb; for modulate (5/6) the identity is white / mid-grey, so mix toward that.
vec4 applyInstanceAlpha(vec4 color, float filterMode) {
  if (u_instanceAlpha >= 1.0) return color;
  if (filterMode >= 3.0 && filterMode <= 4.0) color.rgb *= u_instanceAlpha;
  else if (filterMode == 5.0) color.rgb = mix(vec3(1.0), color.rgb, u_instanceAlpha);
  else if (filterMode == 6.0) color.rgb = mix(vec3(0.5), color.rgb, u_instanceAlpha);
  else color.a *= u_instanceAlpha;
  return color;
}

// Dim a fragment standing in the unplayable area with its [FogOfWar] object row. Sampled by
// world XY, so a flyer three hundred units up over the black is dimmed like anything else.
// Applied LAST, after lighting and distance fog, because it is not a shade of the model but
// the statement that the model is not somewhere anyone can play.
//
// How the row is APPLIED is ours, picked by eye against the real client (docs/unplayable-area.md
// §4): the rows are full-alpha, but read as a flat REPLACEMENT colour they turned every tree in
// the border into a lavender cut-out, where the game keeps the tree's shape and shading. So the
// row MODULATES, read the way a vertex colour is (×2, 128 neutral): FoggedBoundaryObject's
// 64,64,96 is the model at half brightness, pushed blue. In sight and remembered both take it —
// the in-sight row is BoundaryObject's flat black, and a tree inside our own vision going black
// beside one just outside it was the hard line along every edge — and NEVER SEEN is the black of
// BlackMaskedObject, which BoundaryObject is to the byte.
//
// The mask is LINEAR-filtered and the boundary is dilated onto the corner grid (boundaryCorners),
// so B ramps 0→1 across the one playable cell beside the border — the same one-tile fade the
// ground's own boundary floor takes. Weighting by it rather than cutting at 0.5 is what keeps a
// model that straddles the edge from being split by a straight line.
vec3 applyBoundaryTint(vec3 rgb, float filterMode) {
  if (u_boundaryEnabled < 0.5) return rgb;
  vec2 uv = (v_worldPos.xy - u_boundaryParams.xy) * u_boundaryParams.zw;
  vec4 mask = texture2D(u_boundaryTexture, uv);
  float w = smoothstep(0.0, 1.0, mask.b);
  if (w <= 0.0) return rgb; // not in (or beside) the unplayable area — leave it alone
  // Additive layers (3/4) have BLACK as their identity, so a glow inside the boundary has to
  // stop adding rather than add a tint — the same reasoning applyDistFog uses above.
  if (filterMode >= 3.0 && filterMode <= 4.0) return mix(rgb, vec3(0.0), w);
  // G is the fog-only brightness: 0 never seen, ~0.5 remembered, 1 in sight.
  float seen = smoothstep(0.0, 0.25, mask.g);
  vec3 dimmed = mix(u_boundaryLit, rgb * u_boundaryFogged * 2.0, seen);
  return mix(rgb, dimmed, w);
}

vec4 getDiffuseColor() {
  vec2 uv = v_uv;

  // Translation animation
  uv += v_uvTransRot.xy;

  // Rotation animation
  uv = quat_transform(v_uvTransRot.zw, uv - 0.5) + 0.5;

  // Scale animation
  uv = v_uvScale * (uv - 0.5) + 0.5;

  vec4 texel = texture2D(u_texture, uv, u_lodBias);
  vec4 color = texel * v_color;

  // 1bit Alpha
  if (u_filterMode == 1.0 && color.a < 0.75) {
    discard;
  }

  // "Close to 0 alpha"
  if (u_filterMode >= 5.0 && color.a < 0.02) {
    discard;
  }

  return applyInstanceAlpha(color, u_filterMode);
}

void onlyTexCoords() {
  gl_FragColor = vec4(v_uv, 0.0, 1.0);
}

void onlyNormals() {
  gl_FragColor = vec4(v_normal, 1.0);
}

void onlyDiffuse() {
  vec4 color = getDiffuseColor();
  color.rgb = applyBoundaryTint(applyDistFog(color.rgb, u_filterMode), u_filterMode);
  gl_FragColor = color;
}

void lambert() {
  vec4 color = getDiffuseColor();

  if (!u_unshaded) {
    if (u_ffpLit > 0.5) {
      color.rgb *= v_ffpLight;
    } else if (u_dncEnabled > 0.5) {
      // WC3's fixed-function lighting: ambient + diffuse*N·L, clamped per channel.
      // v_normal is already world space (the vertex shader skins into world space
      // and gl_Position needs no model matrix), so N·L is a plain world-space dot.
      float ndotl = max(dot(normalize(v_normal), u_dncLightDir), 0.0);
      color.rgb *= clamp(u_dncAmbient + u_dncDiffuse * ndotl, 0.0, 1.0);
    } else {
      float lambertFactor = clamp(dot(v_normal, v_lightDir), 0.0, 1.0);
      lambertFactor = clamp(lambertFactor + 0.7, 0.0, 1.0);

      color.rgb *= lambertFactor;
    }
  }

  color.rgb = applyBoundaryTint(applyDistFog(color.rgb, u_filterMode), u_filterMode);
  gl_FragColor = color;
}

void main() {
  #if defined(ONLY_DIFFUSE)
  onlyDiffuse();
  #elif defined(ONLY_TEXCOORDS)
  onlyTexCoords();
  #elif defined(ONLY_NORMALS)
  onlyNormals();
  #else
  lambert();
  #endif
}
`;

export default shader;
