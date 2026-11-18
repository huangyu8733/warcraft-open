const shader = `
uniform mat4 u_VP;
uniform sampler2D u_heightMap;
uniform vec2 u_pixel;
uniform vec2 u_centerOffset;

attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec2 a_uv;
attribute vec3 a_instancePosition;
attribute float a_instanceTexture;

varying vec3 v_normal;
varying vec2 v_uv;
varying float v_texture;
varying vec3 v_position;

// OpenWar3: the RAW ground height (no cliff layers) at a point in corner coordinates,
// bilinear between the four corners around it. The stock shader blended the four corners of
// the ONE tile the instance is anchored on by the vertex's offset from it, which extrapolates
// for a ramp: CliffTrans models span two tiles (x down to -256, y up to 256), so their far
// half was lifted along the near tile's slope instead of reading the tile it stands on.
float groundAt(vec2 c) {
  vec2 halfPixel = u_pixel * 0.5;
  vec2 f = floor(c);
  vec2 t = c - f;
  float bottomLeft = texture2D(u_heightMap, f * u_pixel + halfPixel).a;
  float bottomRight = texture2D(u_heightMap, (f + vec2(1.0, 0.0)) * u_pixel + halfPixel).a;
  float topLeft = texture2D(u_heightMap, (f + vec2(0.0, 1.0)) * u_pixel + halfPixel).a;
  float topRight = texture2D(u_heightMap, (f + vec2(1.0, 1.0)) * u_pixel + halfPixel).a;
  return mix(mix(bottomLeft, bottomRight, t.x), mix(topLeft, topRight, t.x), t.y);
}

// OpenWar3: is this model-space coordinate on a multiple of step (within a world unit)?
bool onGrid(float v, float step) {
  return abs(v - floor(v / step + 0.5) * step) < 1.0;
}

void main() {
  // The vertex in corner coordinates (one unit per terrain cell). Cliff and ramp instances
  // are translation-only and anchored on a cell corner, so this is exact on the grid.
  vec2 cell = (a_instancePosition.xy + a_position.xy - u_centerOffset.xy) / 128.0;
  float height = groundAt(cell);

  // OpenWar3: where the mesh MEETS the ground, light it as the ground. A cliff or ramp model
  // carries smoothed normals, so the vertex it shares with the grass leans towards its own
  // slope or wall (a ramp's flat border sits ~25 degrees off vertical), while the ground beside
  // it is lit straight up — under a low sun that is half the brightness, a hard line along every
  // ramp and a dark lip along every cliff. A vertex on a cell edge (model x or y on the 128
  // grid) at a ground level (z on a half layer: the ramp entrance is +0.5) takes the normal
  // the ground pass computes there, from the same raw heights. The idea is Warsmash's
  // (TerrainShaders.Cliffs swaps in the terrain slope on edge vertices) — studied, not lifted.
  // nz > 0.6 keeps the CREASES: a census of all 253 stock cliff/ramp models puts every vertex
  // where a natural cliff or a ramp meets the ground at nz >= 0.6 and every wall vertex on
  // those lines under 0.3, while City cliffs split their vertices on purpose (walls at 0,
  // bevels at 0.45) and must keep their hard edges.
  vec3 normal = a_normal;
  if (normal.z > 0.6 && (onGrid(a_position.x, 128.0) || onGrid(a_position.y, 128.0)) && onGrid(a_position.z, 64.0)) {
    float hL = groundAt(cell - vec2(1.0, 0.0));
    float hR = groundAt(cell + vec2(1.0, 0.0));
    float hD = groundAt(cell - vec2(0.0, 1.0));
    float hU = groundAt(cell + vec2(0.0, 1.0));
    normal = vec3(hL - hR, hD - hU, 2.0);
  }

  v_normal = normal;
  v_uv = a_uv;
  v_texture = a_instanceTexture;
  v_position = a_position + vec3(a_instancePosition.xy, a_instancePosition.z + height * 128.0);

  gl_Position = u_VP * vec4(v_position, 1.0);
}
`;

export default shader;
