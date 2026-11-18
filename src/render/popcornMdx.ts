// The MDX handler with one extra thing remembered: a Reforged model's CORN (PopcornFX)
// emitters. mdx-m3-viewer's parser reads them (parsers/mdlx/model.js `particleEmittersPopcorn`)
// and its MDX resource then drops them on the floor, because it has no PopcornFX runtime —
// which is why the HD Wisp is an empty shell and every PKB-driven spell effect vanished.
//
// We parse the model into the SAME parser instance the stock model class consumes, so the
// emitter list survives at no extra cost, and remember it on the model. The PKB overlay
// (render/pkbOverlay.ts) reads `model.popcornEmitters` per instance.
//
// This is a drop-in for the stock handler: same load/update/emit surface, only `resource`
// points at our subclass, so the map viewer needs nothing else.

import mdxHandler from "mdx-m3-viewer/dist/cjs/viewer/handlers/mdx/handler";
import MdxModelCtor from "mdx-m3-viewer/dist/cjs/viewer/handlers/mdx/model";
import MdlxParser from "mdx-m3-viewer/dist/cjs/parsers/mdlx/model";
import War3MapViewerCtor from "mdx-m3-viewer/dist/cjs/viewer/handlers/w3x/viewer";

/** A CORN node: the particle file it names (`…\Wisp.pkfx`), the node it hangs from, and the
 *  animation-visibility guide that says WHICH sequences it plays in (`Always=Off,Attack=On`). */
export interface PopcornEmitter {
  objectId: number;
  path: string;
  /** The node's `animationVisiblityGuide` verbatim (the MDX field really is spelled that way).
   *  Empty when the model states none — then the effect always runs. */
  guide: string;
  /** The viewer-node index this effect hangs from, or -1 for the model root.
   *
   *  The MDX numbers CORN nodes among the object ids, but the viewer's `nodes` array has no
   *  entry for them (its object list is bones/lights/helpers/attachments/PREMs/PRE2s/RIBBs/
   *  events/collision shapes only). A raw `parentId` therefore indexes the WRONG node — in
   *  HeroFarSeer.mdx the CORNs are ids 235–239 among 249 objects, so every effect was anchored
   *  to a light or event node — and this field is that id remapped to the viewer's array. */
  parentNode: number;
}

interface ResourceData {
  viewer: unknown;
  fetchUrl: (url: string) => Promise<ArrayBuffer>;
  pathSolver: (src: unknown, params?: unknown) => unknown;
}

interface MdxModelLike {
  popcornEmitters?: PopcornEmitter[];
}

const MdxModel = MdxModelCtor as unknown as {
  new (bufferOrParser: unknown, resourceData: ResourceData): MdxModelLike;
};

/** The parsed-model class every model viewer in the app should use. */
export class PopcornMdxModel extends MdxModel {
  /** CORN emitters with a real path, in chunk order. Empty for classic models. */
  popcornEmitters: PopcornEmitter[] = [];
  /** The logical path of every MDX texture, by index — the HD water hook needs the sequence. */
  texturePaths: string[] = [];

  constructor(bufferOrParser: unknown, resourceData: ResourceData) {
    let parser = bufferOrParser as InstanceType<typeof MdlxParser>;
    if (!(parser instanceof MdlxParser)) {
      parser = new MdlxParser();
      parser.load(bufferOrParser as ArrayBuffer);
    }
    super(parser, resourceData);
    // `path` is "" for a placeholder node with no file; those are not effects.
    const popcorn = parser.particleEmittersPopcorn as unknown as (PopcornEmitter & {
      animationVisiblityGuide?: string;
      parentId?: number;
    })[];
    const cornIds = popcorn.map((e) => e.objectId).sort((a, b) => a - b);
    // Each skipped CORN id shifts every later object one slot in the instance's node array.
    const viewerNode = (objectId: number): number => {
      if (objectId < 0) return -1;
      let skipped = 0;
      for (const id of cornIds) {
        if (id >= objectId) break;
        skipped++;
      }
      return objectId - skipped;
    };
    this.popcornEmitters = popcorn
      .filter((e) => !!e.path)
      .map((e) => ({
        objectId: e.objectId,
        path: e.path,
        guide: e.animationVisiblityGuide ?? "",
        parentNode: viewerNode(e.parentId ?? -1),
      }));
    this.texturePaths = parser.textures.map((texture) => texture.path);
  }
}

/**
 * The MDX handler, with `resource` swapped for {@link PopcornMdxModel}. A fresh object (not a
 * mutation of the shared singleton) so the stock handler stays usable elsewhere; `addHandler`
 * dedupes only by identity, so callers must remove the stock one first (see OpenWar3Viewer).
 */
export const popcornMdxHandler = { ...mdxHandler, resource: PopcornMdxModel } as unknown as typeof mdxHandler;

type MapViewerBase = new (
  canvas: HTMLCanvasElement,
  solver: (src: unknown, params?: unknown) => unknown,
  isReforged: boolean,
) => {
  handlers: Set<unknown>;
  addHandler(handler: unknown, ...args: unknown[]): boolean;
};

/**
 * The map viewer with the stock MDX handler replaced. `War3MapViewer`'s constructor registers
 * the stock handler itself, and `addHandler` only dedupes by identity, so the stock entry has
 * to be removed before ours goes in — otherwise both handlers claim every model and the model
 * is parsed (and its emitters built) twice.
 */
export class OpenWar3Viewer extends (War3MapViewerCtor as unknown as MapViewerBase) {
  constructor(canvas: HTMLCanvasElement, solver: (src: unknown, params?: unknown) => unknown, isReforged: boolean) {
    super(canvas, solver, isReforged);
    this.handlers.delete(mdxHandler);
    this.addHandler(popcornMdxHandler, solver, isReforged);
  }
}
