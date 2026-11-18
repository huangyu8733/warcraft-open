import boneTexture from '../../shaders/bonetexture.glsl';
import transforms from './transforms.glsl';

const shader = `
uniform mat4 u_VP;
uniform vec3 u_lightPos;
uniform vec4 u_vertexColor;
uniform vec4 u_geosetColor;
uniform float u_layerAlpha;
uniform vec2 u_uvTrans;
uniform vec2 u_uvRot;
uniform float u_uvScale;
uniform bool u_hasBones;
// OpenWar3 (issue #161): the instance's own world matrix, applied AFTER skinning. Identity for
// everything drawn the old way — an instance's bone matrices are world space already. In Low
// Performance Mode's shared-skeleton path they are the INSTANCE's space instead, because a pose
// can only be shared by a crowd if it carries no position, and this is what puts each body back
// where it stands. See mdx/modelinstance.ts.
uniform mat4 u_instance;

attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec2 a_uv;

varying vec2 v_uv;
varying vec3 v_normal;
varying vec4 v_color;
varying vec4 v_uvTransRot;
varying float v_uvScale;
varying vec3 v_lightDir;
varying vec3 v_worldPos; // OpenWar3: world-space position for distance fog (see sd.frag)
// OpenWar3: WC3's own lighting, which is Direct3D's FIXED-FUNCTION pipeline — traced off the real
// client (docs/lighting.md): evaluated per VERTEX, the light at each one is the sum of
// diffuse · max(N·L, 0) / (a0 + a1·d + a2·d²) out to the light's range, clamped, and the triangle
// interpolates the answer. u_ffpEnabled is 0 for every scene that has not asked for it.
#define MAX_FFP 8
uniform float u_ffpEnabled;
uniform vec3 u_ffpEmissive;
uniform vec3 u_ffpLightPos[MAX_FFP];
uniform vec3 u_ffpLightColor[MAX_FFP];
uniform vec4 u_ffpAtten; // (a0, a1, a2, range)
varying vec3 v_ffpLight;

${boneTexture}
${transforms}

void main() {
  vec3 position = a_position;
  vec3 normal = a_normal;

  if (u_hasBones) {
    #ifdef SKIN
      vec3 tangent = vec3(0.0);
      vec3 binormal = vec3(0.0);
      transformSkin(position, normal, tangent, binormal);
    #else
      transformVertexGroups(position, normal);
    #endif
  }

  // OpenWar3 (issue #161): identity unless this instance wears a shared skeleton.
  position = (u_instance * vec4(position, 1.0)).xyz;
  normal = normalize(mat3(u_instance) * normal);

  v_uv = a_uv;
  v_normal = normal;
  // OpenWar3: only the RGB of the instance tint belongs here. The instance's ALPHA
  // is the whole-unit transparency (Wind Walk, Banish, SetUnitVertexColor) and is
  // applied in sd.frag as u_instanceAlpha, AFTER the 1-bit alpha test — folding it
  // in here would drag a filterMode-1 texel under the 0.75 cutoff and discard the
  // fragment, making a faded unit vanish instead of ghosting.
  v_color = vec4(u_vertexColor.rgb, 1.0) * u_geosetColor.bgra * vec4(1.0, 1.0, 1.0, u_layerAlpha);
  v_uvTransRot = vec4(u_uvTrans, u_uvRot);
  v_uvScale = u_uvScale;
  v_lightDir = normalize(u_lightPos - position);
  v_worldPos = position; // world space (skinned above; gl_Position needs no model matrix)

  v_ffpLight = vec3(1.0);
  if (u_ffpEnabled > 0.5) {
    vec3 light = u_ffpEmissive;
    for (int i = 0; i < MAX_FFP; i++) {
      vec3 toLight = u_ffpLightPos[i] - position;
      float dist = length(toLight);
      if (dist <= u_ffpAtten.w) {
        float atten = 1.0 / (u_ffpAtten.x + u_ffpAtten.y * dist + u_ffpAtten.z * dist * dist);
        light += u_ffpLightColor[i] * (atten * max(dot(normal, toLight / max(dist, 0.001)), 0.0));
      }
    }
    v_ffpLight = clamp(light, 0.0, 1.0);
  }

  gl_Position = u_VP * vec4(position, 1.0);
}
`;

export default shader;
