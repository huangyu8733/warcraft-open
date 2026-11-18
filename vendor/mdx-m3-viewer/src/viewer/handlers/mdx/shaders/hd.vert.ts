
import boneTexture from '../../shaders/bonetexture.glsl';
import transforms from './transforms.glsl';

const shader = `
uniform mat4 u_VP;
uniform mat4 u_MV;
uniform vec3 u_eyePos;
uniform vec3 u_lightPos;
uniform float u_layerAlpha;
uniform bool u_hasBones;

attribute vec3 a_position;
attribute vec3 a_normal;
attribute vec2 a_uv;
attribute vec4 a_tangent;

// OpenWar3: static doodad instancing. The same model drawn N times in one call carries its
// matrix as four vertex attributes (one per column) instead of the u_instance uniform.
#ifdef OW3_INSTANCED
attribute vec4 a_instance0;
attribute vec4 a_instance1;
attribute vec4 a_instance2;
attribute vec4 a_instance3;
#endif

varying vec2 v_uv;
varying float v_layerAlpha;
varying vec3 v_lightDir;
varying vec3 v_eyeVec;
varying vec3 v_eyeT;
varying vec3 v_normal;
// varying vec3 v_lightDirWorld;

#if defined(ONLY_TANGENTS)
varying vec3 v_tangent;
#endif

${boneTexture}
${transforms}

vec3 TBN(vec3 vector, vec3 tangent, vec3 binormal, vec3 normal) {
  return vec3(dot(vector, tangent), dot(vector, binormal), dot(vector, normal));
}

// OpenWar3 (issue #161): see sd.vert.ts — the instance's own matrix, identity unless this
// instance is wearing a skeleton shared by a bucket of its own kind. In the instanced variant
// it is assembled per vertex instead (see a_instance0..3 above).
#ifndef OW3_INSTANCED
uniform mat4 u_instance;
#endif

void main() {
  vec3 position = a_position;
  vec3 normal = a_normal;
  vec3 tangent = a_tangent.xyz;

  // Re-orthogonalize the tangent in case it wasnt normalized.
  // See "One last thing" at https://learnopengl.com/Advanced-Lighting/Normal-Mapping
  tangent = normalize(tangent - dot(tangent, normal) * normal);

  vec3 binormal = cross(normal, tangent) * a_tangent.w;

  if (u_hasBones) {
    #ifdef SKIN
      transformSkin(position, normal, tangent, binormal);
    #else
      transformVertexGroupsHD(position, normal, tangent, binormal);
    #endif
  }

  // OpenWar3: the instanced variant reads the matrix off the vertex stream; otherwise it is the
  // issue #161 uniform, identity unless this instance wears a shared skeleton.
#ifdef OW3_INSTANCED
  mat4 u_instance = mat4(a_instance0, a_instance1, a_instance2, a_instance3);
#endif

  // OpenWar3 (issue #161): identity unless this instance wears a shared skeleton, in which case
  // its bones are in its own space and this is what puts the body where it stands.
  position = (u_instance * vec4(position, 1.0)).xyz;
  mat3 ow3Instance = mat3(u_instance);
  normal = normalize(ow3Instance * normal);
  tangent = normalize(ow3Instance * tangent);
  binormal = normalize(ow3Instance * binormal);

  vec3 position_mv = vec3(u_MV * vec4(position, 1));

  mat3 mv = mat3(u_MV);
  vec3 t = normalize(mv * tangent);
  vec3 b = normalize(mv * binormal);
  vec3 n = normalize(mv * normal);

  v_eyeVec = normalize(u_eyePos - position_mv);

  // OpenWar3: the PBR specular term needs the eye direction in TANGENT space, alongside
  // v_lightDir. In view space the eye sits at the origin, so -position_mv is the view ray; this
  // is correct for the perspective/orthographic cameras the viewer uses, unlike u_eyePos, which
  // the engine passes in world space.
  v_eyeT = normalize(TBN(normalize(-position_mv), t, b, n));

  vec3 lightDir = normalize(u_lightPos - position_mv);
  v_lightDir = normalize(TBN(lightDir, t, b, n));
  
  v_uv = a_uv;
  v_layerAlpha = u_layerAlpha;

  v_normal = normal;
  // v_lightDirWorld = normalize(lightDir);

  #if defined(ONLY_TANGENTS)
  v_tangent = tangent;
  #endif

  gl_Position = u_VP * vec4(position, 1.0);
}
`;

export default shader;
