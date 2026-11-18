import Scene from '../../scene';
import Shader from '../../gl/shader';
import Texture from '../../texture';
import MdxModel from './model';
import MdxModelInstance from './modelinstance';
import Material, { HdSlot } from './material';
import Layer from './layer';
import mdxHandler, { MdxHandlerObject, hdLiteEnabled } from './handler';
import { SkinningType } from './batch';

// OpenWar3 (issue #161): what `u_instance` says when the bones are already world space.
const OW3_IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/**
 * A group of batches that are going to be rendered together.
 */
export default class BatchGroup {
  model: MdxModel;
  skinningType: SkinningType;
  isHd: boolean;
  objects: number[] = [];

  // OpenWar3 (P2-2): the per-instance matrix buffer `renderInstanced` uploads into.
  private ow3MatrixBuffer: WebGLBuffer | null = null;
  private ow3MatrixData = new Float32Array(0);

  constructor(model: MdxModel, skinningType: SkinningType, isHd: boolean) {
    this.model = model;
    this.skinningType = skinningType;
    this.isHd = isHd;
  }

  /**
   * OpenWar3: the SCENE's uniforms — camera, lights, fog, boundary mask — for this program.
   *
   * Pulled out of `render()` so the instanced path (`renderInstanced`, P2-2) writes exactly the
   * same values once per (shader, scene, frame). A uniform lives on the PROGRAM, so writing it
   * once instead of per instance leaves the GPU state identical; the stamp carries the scene as
   * well as the frame because one viewer draws several (the glue screens have four).
   */
  private bindSceneUniforms(shader: Shader, scene: Scene): void {
    const viewer = this.model.viewer;
    const gl = viewer.gl;
    const camera = scene.camera;
    const uniforms = shader.uniforms;
    const isHd = this.isHd;

    if (shader.ow3Scene !== scene || shader.ow3Frame !== viewer.frame || viewer.ow3HoistUniforms === false) {
      shader.ow3Scene = scene;
      shader.ow3Frame = viewer.frame;

      gl.uniformMatrix4fv(uniforms['u_VP'], false, camera.viewProjectionMatrix);
      gl.uniform3fv(uniforms['u_lightPos'], scene.lightPosition);

      // OpenWar3: the scene's day/night light for models (Environment\DNC\*Unit.mdx).
      // Only the SD shader declares these; on HD/other shaders the lookup misses and
      // the uniform call is a no-op. Scenes without a cycle keep dncEnabled = 0.
      const dncUnit = scene.dncUnit;

      if (scene.dncEnabled && dncUnit) {
        gl.uniform1f(uniforms['u_dncEnabled'], 1);
        gl.uniform3fv(uniforms['u_dncAmbient'], dncUnit.ambient);
        gl.uniform3fv(uniforms['u_dncDiffuse'], dncUnit.diffuse);
        gl.uniform3fv(uniforms['u_dncLightDir'], dncUnit.direction);
      } else {
        gl.uniform1f(uniforms['u_dncEnabled'], 0);
      }

      // OpenWar3: the fixed-function lighting path (scene.ffp; see sd.vert).
      const ffp = scene.ffp;

      if (ffp) {
        gl.uniform1f(uniforms['u_ffpEnabled'], 1);
        gl.uniform1f(uniforms['u_ffpLit'], 1);
        gl.uniform3fv(uniforms['u_ffpEmissive'], ffp.emissive);
        gl.uniform3fv(uniforms['u_ffpLightPos[0]'], ffp.positions);
        gl.uniform3fv(uniforms['u_ffpLightColor[0]'], ffp.colors);
        gl.uniform4fv(uniforms['u_ffpAtten'], ffp.atten);
        gl.uniform1f(uniforms['u_lodBias'], ffp.lodBias);
      } else {
        gl.uniform1f(uniforms['u_ffpEnabled'], 0);
        gl.uniform1f(uniforms['u_ffpLit'], 0);
        gl.uniform1f(uniforms['u_lodBias'], 0);
      }

      // OpenWar3: scene distance fog (src/render/fog.ts → scene.distFog). Same no-op
      // rule as dnc: only the SD shader declares these uniforms.
      const distFog = scene.distFog;

      if (distFog && distFog.enabled) {
        gl.uniform1f(uniforms['u_distFogEnabled'], 1);
        gl.uniform1f(uniforms['u_distFogFlags'], distFog.honourFlags ? 1 : 0);
        gl.uniform1f(uniforms['u_distFogStart'], distFog.start);
        gl.uniform1f(uniforms['u_distFogEnd'], distFog.end);
        gl.uniform3fv(uniforms['u_distFogColor'], distFog.color);
        gl.uniform3fv(uniforms['u_distFogEye'], camera.location);
        // The camera's +Z axis in world space — which points BACKWARD, away from what
        // the camera looks at (gl-matrix lookAt convention). The shaders take the fog
        // distance along it, so `eye - fragment` projects to a POSITIVE depth. See the
        // u_distFogDir note in the SD fragment shader.
        gl.uniform3fv(uniforms['u_distFogDir'], camera.directionZ);
      } else {
        gl.uniform1f(uniforms['u_distFogEnabled'], 0);
      }

      // OpenWar3: the unplayable area's OBJECT tint (issue #117; see sd.frag). Same no-op
      // rule as dnc/distFog. Texture unit 14 is free in this pipeline -- SD uses 0, HD 0..5,
      // and the bone texture 15 -- and the active unit is put back to 0 afterwards, because
      // the overlays we draw after the world bind their textures without naming one.
      const boundaryMask = scene.boundaryMask;

      if (boundaryMask) {
        gl.uniform1f(uniforms['u_boundaryEnabled'], 1);
        gl.activeTexture(gl.TEXTURE0 + 14);
        gl.bindTexture(gl.TEXTURE_2D, boundaryMask.texture);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(uniforms['u_boundaryTexture'], 14);
        gl.uniform4fv(uniforms['u_boundaryParams'], boundaryMask.params);
        gl.uniform3fv(uniforms['u_boundaryLit'], boundaryMask.lit);
        gl.uniform3fv(uniforms['u_boundaryFogged'], boundaryMask.fogged);
      } else {
        gl.uniform1f(uniforms['u_boundaryEnabled'], 0);
      }

      if (isHd) {
        // The sampler slots never change, and the view matrix and eye are the camera's --
        // all of them scene-wide, so they ride in here rather than being re-stated per
        // instance below. The BLEND/DEPTH state does not: the SD path changes it per batch,
        // so an HD group has to restate it every time it draws.
        gl.uniform1i(uniforms['u_diffuseMap'], 0);
        gl.uniform1i(uniforms['u_normalsMap'], 1);
        gl.uniform1i(uniforms['u_ormMap'], 2);
        gl.uniform1i(uniforms['u_emissiveMap'], 3);
        gl.uniform1i(uniforms['u_teamColorMap'], 4);
        gl.uniform1i(uniforms['u_environmentMap'], 5);
        gl.uniformMatrix4fv(uniforms['u_MV'], false, camera.viewMatrix);
        gl.uniform3fv(uniforms['u_eyePos'], camera.location);
      }
    }
  }

  render(instance: MdxModelInstance): void {
    const scene = <Scene>instance.scene;
    const textureOverrides = instance.textureOverrides;
    const layerAlphas = instance.layerAlphas;
    const model = this.model;
    const textures = model.textures;
    const batches = model.batches;
    const viewer = model.viewer;
    const mdxCache = <MdxHandlerObject>viewer.sharedCache.get('mdx');
    const gl = viewer.gl;
    const webgl = viewer.webgl;
    const skinningType = this.skinningType;
    const isHd = this.isHd;
    const teamColors = mdxCache.teamColors;
    const teamGlows = mdxCache.teamGlows;
    const shader = mdxHandler.getBatchShader(viewer, skinningType, isHd);
    // OpenWar3: HD-lite (Low Performance Mode) binds three maps instead of six -- the shader
    // has no normal / emissive / environment sampler, and a unit whose program does not declare
    // the sampler costs nothing to leave unbound (only ACTIVE samplers are validated at draw).
    const lite = isHd && hdLiteEnabled();

    shader.use();

    const uniforms = shader.uniforms;

    this.bindSceneUniforms(shader, scene);

    // ---- and from here it is the INSTANCE's ------------------------------------------
    // OpenWar3 (issue #161): in Low Performance Mode an instance may be wearing a skeleton a
    // whole bucket of its own kind shares — one texture, filled once by whoever composed it.
    // Those matrices are in the INSTANCE's own space, and `u_instance` is what puts them in
    // the world; an instance composing for itself sends the identity and is unchanged.
    const boneTexture = instance.ow3SharedTexture || instance.boneTexture;

    if (uniforms['u_instance']) {
      gl.uniformMatrix4fv(uniforms['u_instance'], false, instance.ow3LocalPose === true ? (instance.worldMatrix as Float32Array) : OW3_IDENTITY);
    }

    // Instances of models with no bones don't have a bone texture.
    if (boneTexture) {
      boneTexture.bind(15);
      // …and put the ACTIVE unit back to 0. `bind` leaves it at 15, and the boundary
      // block above used to be what restored it -- it no longer runs every instance, and
      // the SD path can leave here without binding anything (a fully faded instance
      // returns early). What comes after the world are our own overlay passes, which bind
      // their textures without naming a unit and would land on 15.
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1f(uniforms['u_hasBones'], 1);
      gl.uniform1i(uniforms['u_boneMap'], 15);
      gl.uniform1f(uniforms['u_vectorSize'], 1 / boneTexture.width);
      gl.uniform1f(uniforms['u_rowSize'], 1);
    } else {
      gl.uniform1f(uniforms['u_hasBones'], 0);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, model.arrayBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, model.elementBuffer);

    if (isHd) {
      // The samplers, u_MV and u_eyePos are hoisted above. BLEND / depth state is NOT
      // set once for the whole group: an HD material can be transparent (waterfall and
      // fountain sheets, glows), and Reforged keeps that in the LAYS layer's filter
      // mode exactly as SD does. Forcing blend off + depth writes here drew every HD
      // water plane as an opaque rectangle.
      gl.enable(gl.DEPTH_TEST);

      for (const index of this.objects) {
        const batch = batches[index];
        const geoset = batch.geoset;
        const material = <Material>batch.material;

        // Per-material GL state from the diffuse layer: blend function, culling,
        // depth test and depth writes (OpenWar3: the HD path used to skip all of it).
        material.layers[0].bind(shader, 1);

        // OpenWar3: a v1000 HD material carries six LAYS (diffuse, normal, ORM, emissive,
        // team colour, environment); a DE/v1100 one carries a single layer whose texture
        // list names those same six by SLOT. model.ts exposes the second shape as
        // `hdSlots`, so this destructuring is unchanged for both.
        const hdLayers = material.hdSlots || material.layers;
        const [diffuseLayer, normalsLayer, ormLayer, emissiveLayer, teamColorLayer, environmentMapLayer] = hdLayers;
        const layerAlpha = layerAlphas[diffuseLayer.index];

        if (layerAlpha > 0) {
          gl.uniform1f(uniforms['u_layerAlpha'], layerAlpha);
          gl.uniform1f(uniforms['u_filterMode'], diffuseLayer.filterMode);

          const diffuseId = diffuseLayer.textureId;
          const normalsId = normalsLayer?.textureId;
          const ormId = ormLayer?.textureId;
          const emissiveId = emissiveLayer?.textureId;
          const teamColorId = teamColorLayer?.textureId;
          const environmentMapId = environmentMapLayer?.textureId;
          const anyTexture = textures.find(Boolean);
          const diffuseTexture = textures[diffuseId] || anyTexture;

          if (!diffuseTexture) continue; // a material with no texture at all cannot be drawn

          const normalsTexture = textures[normalsId] || diffuseTexture;
          const ormTexture = textures[ormId] || diffuseTexture;
          const emissiveTexture = textures[emissiveId] || diffuseTexture;
          let teamColorTexture = textures[teamColorId] || diffuseTexture;
          const environmentMapTexture = textures[environmentMapId] || diffuseTexture;

          // OpenWar3: a slot is authored data only if it is NOT one model.ts filled and
          // it is not the very resource the diffuse slot uses. A DE tree lists
          // replaceable id 31 three times (diffuse/normal/ORM) and all three resolve to
          // `LordaeronSummerTree_Diffuse.dds`; reading that alpha as ORM made tcFactor
          // 1, so the team-colour swatch multiplied every canopy (red trees on Booty
          // Bay). Say "no normal / no ORM" for those instead of feeding the shader a
          // diffuse map as if it were one.
          const authored = (layer: Layer | HdSlot | undefined, texture: Texture | null | undefined): boolean => !!layer && (layer as HdSlot).synthetic !== true && !!texture && texture !== diffuseTexture.texture;

          gl.uniform1f(uniforms['u_hasNormals'], authored(normalsLayer, normalsTexture.texture) ? 1 : 0);
          gl.uniform1f(uniforms['u_hasOrm'], authored(ormLayer, ormTexture.texture) ? 1 : 0);

          // OpenWar3: an instance with NO team colour (a doodad, `teamColor === -1`)
          // or a swatch index the install does not ship has no `teamColors` entry.
          // The stock code assigned it anyway and the next `.texture` threw inside
          // the frame callback, which took the whole render loop down. Keep the
          // material's own team-colour texture when there is no swatch to swap in.
          const teamSwatch = teamColors[instance.teamColor] || teamColors[0];

          if (teamSwatch && (teamColorTexture.replaceableId === 0 || teamColorTexture.replaceableId === 1)) {
            teamColorTexture = teamSwatch;
          }

          const actualDiffuseTexture = textureOverrides.get(diffuseId) || diffuseTexture.texture;
          const actualNormalsTexture = textureOverrides.get(normalsId) || normalsTexture.texture;
          const actualOrmTexture = textureOverrides.get(ormId) || ormTexture.texture;
          const actualEmissiveTexture = textureOverrides.get(emissiveId) || emissiveTexture.texture;
          const actualTeamColorTexture = textureOverrides.get(teamColorId) || teamColorTexture.texture;
          const actualEnvironmentMapTexture = textureOverrides.get(environmentMapId) || environmentMapTexture.texture;

          webgl.bindTextureAndWrap(actualDiffuseTexture, 0, diffuseTexture.wrapS, diffuseTexture.wrapT);
          webgl.bindTextureAndWrap(actualOrmTexture, 2, ormTexture.wrapS, ormTexture.wrapT);
          webgl.bindTextureAndWrap(actualTeamColorTexture, 4, teamColorTexture.wrapS, teamColorTexture.wrapT);

          if (!lite) {
            webgl.bindTextureAndWrap(actualNormalsTexture, 1, normalsTexture.wrapS, normalsTexture.wrapT);
            webgl.bindTextureAndWrap(actualEmissiveTexture, 3, emissiveTexture.wrapS, emissiveTexture.wrapT);
            webgl.bindTextureAndWrap(actualEnvironmentMapTexture, 5, environmentMapTexture.wrapS, environmentMapTexture.wrapT);
          }

          geoset.bindHd(shader, batch.skinningType, diffuseLayer.coordId);
          geoset.render();
        }
      }
    } else {
      const geosetColors = instance.geosetColors;
      const layerTextures = instance.layerTextures;
      const uvAnims = instance.uvAnims;

      gl.uniform4fv(uniforms['u_vertexColor'], instance.vertexColor);
      gl.uniform1i(uniforms['u_texture'], 0);

      // OpenWar3: whole-instance transparency (issue #66). The alpha of the
      // instance tint is a fade over the entire model rather than a per-layer
      // one, so it rides its own uniform — see sd.frag/sd.vert.
      const instanceAlpha = instance.vertexColor[3];

      gl.uniform1f(uniforms['u_instanceAlpha'], instanceAlpha);

      if (instanceAlpha < 0.01) {
        return; // fully transparent — nothing to draw
      }

      for (const object of this.objects) {
        const batch = batches[object];
        const geoset = batch.geoset;
        const layer = batch.layer;
        const geosetIndex = geoset.index;
        const layerIndex = layer.index;
        const geosetColor = geosetColors[geosetIndex];
        const layerAlpha = layerAlphas[layerIndex];

        if (geosetColor[3] > 0.01 && layerAlpha > 0.01) {
          const textureIndex = layerTextures[layerIndex];
          const layerTexture = textures[textureIndex];
          const uvAnim = uvAnims[layerIndex];

          gl.uniform4fv(uniforms['u_geosetColor'], geosetColor);

          gl.uniform1f(uniforms['u_layerAlpha'], layerAlpha);
          gl.uniform1f(uniforms['u_unshaded'], layer.unshaded);

          gl.uniform2f(uniforms['u_uvTrans'], uvAnim[0], uvAnim[1]);
          gl.uniform2f(uniforms['u_uvRot'], uvAnim[2], uvAnim[3]);
          gl.uniform1f(uniforms['u_uvScale'], uvAnim[4]);

          layer.bind(shader, instanceAlpha);

          let texture: Texture | null | undefined = textureOverrides.get(textureIndex);

          if (!texture) {
            const replaceable = layerTexture.replaceableId;
            let mdxTexture;

            if (replaceable === 1) {
              mdxTexture = teamColors[instance.teamColor];
            } else if (replaceable === 2) {
              mdxTexture = teamGlows[instance.teamColor];
            } else {
              mdxTexture = layerTexture;
            }

            if (mdxTexture) {
              texture = mdxTexture.texture;
            }
          }

          webgl.bindTextureAndWrap(texture, 0, layerTexture.wrapS, layerTexture.wrapT);

          if (skinningType === SkinningType.ExtendedVertexGroups) {
            geoset.bindExtended(shader, layer.coordId);
          } else {
            geoset.bind(shader, layer.coordId);
          }

          geoset.render();
        }
      }
    }
  }

  /**
   * OpenWar3 (P2-2): draw this group once for a whole bucket of static doodads.
   *
   * Every instance in `instances` is the same MODEL and wears a shared skeleton whose bones are
   * in INSTANCE space (`ow3SharedTexture`), so only one world matrix differs per instance. The
   * caller (`Scene.renderOpaque`) has also bucketed by `ow3InstKey`, which means the six maps,
   * the team colour and the layer alphas resolve identically — the material state below is
   * therefore written once and the geometry drawn `instances.length` times.
   *
   * The matrix rides four `vec4` vertex attributes with a divisor of 1 (see the OW3_INSTANCED
   * variant of hd.vert.ts). Attribute divisor state is GLOBAL, so it is put back to 0 and the
   * four arrays are disabled before returning.
   */
  renderInstanced(instances: MdxModelInstance[]): void {
    const count = instances.length;

    if (!this.isHd || count === 0) {
      return;
    }

    const model = this.model;
    const viewer = model.viewer;
    const webgl = viewer.webgl;
    const gl = viewer.gl;
    const instancedArrays = <ANGLE_instanced_arrays>webgl.extensions['ANGLE_instanced_arrays'];
    const scene = <Scene>instances[0].scene;
    const textures = model.textures;
    const batches = model.batches;
    const skinningType = this.skinningType;
    const teamColors = (<MdxHandlerObject>viewer.sharedCache.get('mdx')).teamColors;
    const shader = mdxHandler.getBatchShader(viewer, skinningType, true, true);
    const uniforms = shader.uniforms;
    const attribs = shader.attribs;
    const lite = hdLiteEnabled();
    // Scene only buckets instances whose ow3InstancedStatic() is true, which requires this.
    const boneTexture = instances[0].ow3SharedTexture;
    const reference = instances[0];
    const textureOverrides = reference.textureOverrides;
    const layerAlphas = reference.layerAlphas;

    if (!instancedArrays) {
      return;
    }

    shader.use();
    this.bindSceneUniforms(shader, scene);

    if (boneTexture) {
      boneTexture.bind(15);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1f(uniforms['u_hasBones'], 1);
      gl.uniform1i(uniforms['u_boneMap'], 15);
      gl.uniform1f(uniforms['u_vectorSize'], 1 / boneTexture.width);
      gl.uniform1f(uniforms['u_rowSize'], 1);
    } else {
      gl.uniform1f(uniforms['u_hasBones'], 0);
    }

    // One world matrix per instance, in bucket order.
    let data = this.ow3MatrixData;

    if (data.length < count * 16) {
      data = this.ow3MatrixData = new Float32Array(count * 16);
    }

    for (let i = 0; i < count; i++) {
      data.set(<Float32Array>instances[i].worldMatrix, i * 16);
    }

    if (this.ow3MatrixBuffer === null) {
      this.ow3MatrixBuffer = <WebGLBuffer>gl.createBuffer();
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.ow3MatrixBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * 16), gl.DYNAMIC_DRAW);

    const locations: number[] = [];

    for (let i = 0; i < 4; i++) {
      const location = attribs['a_instance' + i];

      if (location === undefined) {
        continue;
      }

      locations.push(location);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 64, i * 16);
      instancedArrays.vertexAttribDivisorANGLE(location, 1);
    }

    // `geoset.bindHd` points the geometry attribs at whatever ARRAY_BUFFER is bound, so the
    // model's buffer has to come back after the matrix buffer above.
    gl.bindBuffer(gl.ARRAY_BUFFER, model.arrayBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, model.elementBuffer);

    gl.enable(gl.DEPTH_TEST);

    for (const index of this.objects) {
      const batch = batches[index];
      const geoset = batch.geoset;
      const material = <Material>batch.material;

      material.layers[0].bind(shader, 1);

      const hdLayers = material.hdSlots || material.layers;
      const [diffuseLayer, normalsLayer, ormLayer, emissiveLayer, teamColorLayer, environmentMapLayer] = hdLayers;
      const layerAlpha = layerAlphas[diffuseLayer.index];

      if (layerAlpha <= 0) {
        continue;
      }

      gl.uniform1f(uniforms['u_layerAlpha'], layerAlpha);
      gl.uniform1f(uniforms['u_filterMode'], diffuseLayer.filterMode);

      const diffuseId = diffuseLayer.textureId;
      const normalsId = normalsLayer?.textureId;
      const ormId = ormLayer?.textureId;
      const emissiveId = emissiveLayer?.textureId;
      const teamColorId = teamColorLayer?.textureId;
      const environmentMapId = environmentMapLayer?.textureId;
      const anyTexture = textures.find(Boolean);
      const diffuseTexture = textures[diffuseId] || anyTexture;

      if (!diffuseTexture) {
        continue; // a material with no texture at all cannot be drawn
      }

      const normalsTexture = textures[normalsId] || diffuseTexture;
      const ormTexture = textures[ormId] || diffuseTexture;
      const emissiveTexture = textures[emissiveId] || diffuseTexture;
      let teamColorTexture = textures[teamColorId] || diffuseTexture;
      const environmentMapTexture = textures[environmentMapId] || diffuseTexture;

      const authored = (layer: Layer | HdSlot | undefined, texture: Texture | null | undefined): boolean => !!layer && (layer as HdSlot).synthetic !== true && !!texture && texture !== diffuseTexture.texture;

      gl.uniform1f(uniforms['u_hasNormals'], authored(normalsLayer, normalsTexture.texture) ? 1 : 0);
      gl.uniform1f(uniforms['u_hasOrm'], authored(ormLayer, ormTexture.texture) ? 1 : 0);

      const teamSwatch = teamColors[reference.teamColor] || teamColors[0];

      if (teamSwatch && (teamColorTexture.replaceableId === 0 || teamColorTexture.replaceableId === 1)) {
        teamColorTexture = teamSwatch;
      }

      const actualDiffuseTexture = textureOverrides.get(diffuseId) || diffuseTexture.texture;
      const actualNormalsTexture = textureOverrides.get(normalsId) || normalsTexture.texture;
      const actualOrmTexture = textureOverrides.get(ormId) || ormTexture.texture;
      const actualEmissiveTexture = textureOverrides.get(emissiveId) || emissiveTexture.texture;
      const actualTeamColorTexture = textureOverrides.get(teamColorId) || teamColorTexture.texture;
      const actualEnvironmentMapTexture = textureOverrides.get(environmentMapId) || environmentMapTexture.texture;

      webgl.bindTextureAndWrap(actualDiffuseTexture, 0, diffuseTexture.wrapS, diffuseTexture.wrapT);
      webgl.bindTextureAndWrap(actualOrmTexture, 2, ormTexture.wrapS, ormTexture.wrapT);
      webgl.bindTextureAndWrap(actualTeamColorTexture, 4, teamColorTexture.wrapS, teamColorTexture.wrapT);

      if (!lite) {
        webgl.bindTextureAndWrap(actualNormalsTexture, 1, normalsTexture.wrapS, normalsTexture.wrapT);
        webgl.bindTextureAndWrap(actualEmissiveTexture, 3, emissiveTexture.wrapS, emissiveTexture.wrapT);
        webgl.bindTextureAndWrap(actualEnvironmentMapTexture, 5, environmentMapTexture.wrapS, environmentMapTexture.wrapT);
      }

      geoset.bindHd(shader, batch.skinningType, diffuseLayer.coordId);
      geoset.renderInstanced(count);
    }

    for (const location of locations) {
      instancedArrays.vertexAttribDivisorANGLE(location, 0);
      gl.disableVertexAttribArray(location);
    }
  }
}
