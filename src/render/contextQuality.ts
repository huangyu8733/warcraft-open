// "Anti-Aliasing" as a WebGL context attribute.
//
// The match renderer is the vendored viewer (mdx-m3-viewer), which calls
// `canvas.getContext("webgl2")` itself and takes no options from us. The context attribute is
// fixed for the lifetime of that context, so the only point at which the Options row can be
// honoured is the getContext call. One prototype patch, installed once at boot, injects the
// saved value into every WebGL context this page asks for; a change therefore reaches the NEXT
// load (the Options screen says so).

let installed = false;
let antialias = true;

/** Record the saved value. Safe to call before `installContextQuality`. */
export function applyContextQuality(options: { antialias?: boolean }): void {
  antialias = options.antialias !== false;
}

export function installContextQuality(): void {
  if (installed || typeof HTMLCanvasElement === "undefined") return;
  installed = true;
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: (type: string, attrs?: WebGLContextAttributes) => RenderingContext | null;
  };
  const original = proto.getContext;
  proto.getContext = function (this: HTMLCanvasElement, type: string, attrs?: WebGLContextAttributes): RenderingContext | null {
    if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") {
      return original.call(this, type, { ...(attrs ?? {}), antialias });
    }
    return original.call(this, type, attrs as never);
  } as typeof proto.getContext;
}
