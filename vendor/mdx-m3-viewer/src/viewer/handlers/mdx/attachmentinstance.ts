import MdxModel from './model';
import MdxModelInstance from './modelinstance';
import Attachment from './attachment';

// Heap allocations needed for this module.
const visibilityHeap = new Float32Array(1);

/**
 * An attachment instance.
 */
export default class AttachmentInstance {
  instance: MdxModelInstance;
  attachment: Attachment;
  internalInstance: MdxModelInstance;
  // OpenWar3: the parent sequence the attached clip was last matched against (see ow3Sync).
  ow3ParentSeq = -2;
  ow3Seq = -1;

  constructor(instance: MdxModelInstance, attachment: Attachment) {
    const internalModel = <MdxModel>attachment.internalModel;
    const internalInstance = internalModel.addInstance();

    internalInstance.setSequenceLoopMode(2);
    internalInstance.dontInheritScaling = false;
    internalInstance.hide();
    internalInstance.setParent(instance.nodes[attachment.objectId]);

    this.instance = instance;
    this.attachment = attachment;
    this.internalInstance = internalInstance;
  }

  update(): void {
    const instance = this.instance;
    const internalInstance = this.internalInstance;

    if (instance.scene && instance.sequence !== -1) {
      this.attachment.getVisibility(visibilityHeap, instance.sequence, instance.frame, instance.counter);

      if (visibilityHeap[0] > 0.1) {
        // The parent instance might not actually be in a scene.
        // This happens if loading a local model, where loading is instant and adding to a scene always comes afterwards.
        // Therefore, do it here dynamically.
        instance.scene.addInstance(internalInstance);

        if (internalInstance.hidden()) {
          internalInstance.show();

          // Every time the attachment becomes visible again, restart its first sequence.
          internalInstance.setSequence(0);
        }

        this.ow3Sync();
      } else {
        internalInstance.hide();
      }
    }
  }

  /**
   * OpenWar3: an attached model whose clip has the PARENT's clip name plays ON THE PARENT's
   * clock — the parent's frame, mapped into its own clip.
   *
   * Every undead building is the case that matters: its "Birth" carries a `BirthLink`
   * attachment naming `SharedModels\UBirth.mdl`, and that model IS the summoning — the glyph,
   * the bone claws rising round it, the runes and the ribbons, over its own 60 s "Birth". The
   * building's own geosets stay hidden for the first five sixths of the clip, so the
   * attachment is all there is to see. Left on its own clock it ran at a fixed rate from
   * whenever it was last shown: it STOPPED while the building was out of view (an attached
   * instance is only advanced through its parent) while construction went on, never matched a
   * build time that is not 60 s (the parent is scrubbed to construction PROGRESS), and kept
   * going while a halted build stood still — so a building summoned off-screen came back as a
   * bare glyph at any point of its construction.
   *
   * Only a NAME match is slaved; an attached model without the parent's clip keeps the
   * viewer's own behaviour (its first sequence, looping on its own clock).
   */
  ow3Sync(): void {
    const instance = this.instance;
    const internalInstance = this.internalInstance;
    const parentSeq = instance.sequence;

    if (parentSeq !== this.ow3ParentSeq) {
      this.ow3ParentSeq = parentSeq;
      this.ow3Seq = -1;

      const parent = (<MdxModel>instance.model).sequences[parentSeq];

      if (parent) {
        const name = parent.name.trim().toLowerCase();
        const own = (<MdxModel>internalInstance.model).sequences;

        for (let i = 0; i < own.length; i++) {
          if (own[i].name.trim().toLowerCase() === name) {
            this.ow3Seq = i;
            break;
          }
        }
      }
    }

    if (this.ow3Seq < 0) {
      return;
    }

    if (internalInstance.sequence !== this.ow3Seq) {
      internalInstance.setSequence(this.ow3Seq);
    }

    const p = (<MdxModel>instance.model).sequences[parentSeq].interval;
    const a = (<MdxModel>internalInstance.model).sequences[this.ow3Seq].interval;
    const span = p[1] - p[0];
    const t = span > 0 ? Math.min(1, Math.max(0, (instance.frame - p[0]) / span)) : 0;

    internalInstance.frame = a[0] + t * (a[1] - a[0]);

    // …and its emitters run at the parent's rate, so a halted build's ribbons hold too.
    internalInstance.timeScale = instance.timeScale;
  }
}
