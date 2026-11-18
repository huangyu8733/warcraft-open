import { el } from "./screen";

export interface ConfirmDialogOptions {
  title: string;
  text: string;
  cancelLabel: string;
  confirmLabel: string;
  onCancel?: () => void;
  onConfirm: () => void;
}

/**
 * 3.0's compact confirm plate, shared by every HD prompt: chains, four corner gears, the wood
 * itself carrying heading, message and the two answers (plain to back out, blue to confirm).
 * Options' save/reset/art prompts and the profile page's delete prompt must look identical.
 */
export function confirmDialog(host: HTMLElement, opts: ConfirmDialogOptions): void {
  const scrim = el("div", "hd-modal-scrim hd-modal-scrim-top");
  const box = el("div", "hd-panel hd-modal hd-modal-unsaved");
  box.appendChild(el("span", "hd-chain hd-chain-left"));
  box.appendChild(el("span", "hd-chain hd-chain-right"));
  // The frame's chained corner brackets (`Common\wc3_frame_static_cornergears`), one per corner.
  for (const corner of ["tl", "tr", "bl", "br"]) {
    box.appendChild(el("span", `hd-corner hd-corner-${corner}`));
  }
  box.appendChild(el("h2", "", opts.title));
  box.appendChild(el("p", "hd-modal-text", opts.text));
  const actions = el("div", "hd-modal-actions");
  const close = (): void => {
    scrim.remove();
  };
  const cancel = el("button", "", opts.cancelLabel);
  cancel.type = "button";
  cancel.onclick = (): void => {
    close();
    opts.onCancel?.();
  };
  const confirm = el("button", "primary", opts.confirmLabel);
  confirm.type = "button";
  confirm.onclick = (): void => {
    close();
    opts.onConfirm();
  };
  actions.append(cancel, confirm);
  box.appendChild(actions);
  scrim.onclick = (ev): void => {
    if (ev.target === scrim) {
      close();
      opts.onCancel?.();
    }
  };
  scrim.addEventListener("keydown", (ev): void => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      close();
      opts.onCancel?.();
    }
  });
  scrim.appendChild(box);
  host.appendChild(scrim);
  confirm.focus();
}
