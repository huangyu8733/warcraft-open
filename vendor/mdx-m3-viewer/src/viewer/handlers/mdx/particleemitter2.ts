import ParticleEmitter2Object from './particleemitter2object';
import MdxModelInstance from './modelinstance';
import MdxNode from './node';
import MdxEmitter from './emitter';
import Particle2 from './particle2';

const emissionRateHeap = new Float32Array(1);

// OpenWar3: Options -> Video -> Particles (src/render/videoQuality.ts, VideoBridge).
//
// The emitter OBJECT has already multiplied the author's rate by SETTING_PARTICLES_HIGH = 2 --
// geometryemitterfuncs.ts records why: the game doubles emission at High, so the rate written
// into the MDX is the game's Medium. That stays where it is and this scales it, making High the
// doubled rate, Medium the authored one, and Low a quarter of it. Applied HERE, at the moment of
// emission, rather than to the object's stored rate, so a change on the Options screen shows in
// the scene behind it instead of waiting for the next model to load. Read through a global
// because this is vendored code our own modules cannot be imported into.
function ow3ParticleScale(): number {
  const ow3 = globalThis.__OW3_VIDEO__;

  return ow3 && typeof ow3.particleScale === 'number' ? ow3.particleScale : 1;
}

/**
 * An MDX particle emitter type 2.
 */
export default class ParticleEmitter2 extends MdxEmitter {
  node: MdxNode;
  lastEmissionKey = -1;

  constructor(instance: MdxModelInstance, emitterObject: ParticleEmitter2Object) {
    super(instance, emitterObject);

    this.node = instance.nodes[emitterObject.index];
  }

  updateEmission(dt: number): void {
    const instance = <MdxModelInstance>this.instance;

    if (instance.allowParticleSpawn) {
      const emitterObject = <ParticleEmitter2Object>this.emitterObject;
      const keyframe = emitterObject.getEmissionRate(emissionRateHeap, instance.sequence, instance.frame, instance.counter);
      const scale = ow3ParticleScale();

      if (emitterObject.squirt) {
        if (keyframe !== this.lastEmissionKey) {
          this.currentEmission += emissionRateHeap[0] * scale;
        }

        this.lastEmissionKey = keyframe;
      } else {
        this.currentEmission += emissionRateHeap[0] * dt * scale;
      }
    }
  }

  emit(): void {
    const emitterObject = <ParticleEmitter2Object>this.emitterObject;

    if (emitterObject.head) {
      this.emitObject(0);
    }

    if (emitterObject.tail) {
      this.emitObject(1);
    }
  }

  createObject(): Particle2 {
    return new Particle2(this);
  }
}
