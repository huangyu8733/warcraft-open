"use client";

import { useEffect, useState } from "react";
import type { Messages } from "@/i18n/dictionaries/zh";

/**
 * 顶栏的「关闭浏览器手势」说明。
 *
 * 浏览器把双指侧滑 / 鼠标侧键当作后退前进，和 RTS 的拖框选冲突；这个设置改在浏览器里，
 * 网页没法替用户关，所以给一份分步说明。弹窗可用右上角 ×、底部按钮、Esc 或点击遮罩关闭。
 */
export function BrowserGestureHelp({ dict }: { dict: Messages }) {
  const [open, setOpen] = useState(false);
  const t = dict.gestureHelp;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="topbar-play-help"
        title={t.label}
        aria-label={t.label}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        ?
      </button>
      {open ? (
        <div className="gesture-modal" onClick={() => setOpen(false)}>
          <div
            className="gesture-modal__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gesture-help-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="gesture-modal__head">
              <h2 id="gesture-help-title">{t.title}</h2>
              <button
                type="button"
                className="gesture-modal__close"
                aria-label={dict.common.close}
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            <p>{t.intro}</p>
            <h3>{t.chrome}</h3>
            <ol>
              {t.chromeSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="gesture-modal__note">{t.edgeNote}</p>
            <h3>{t.firefox}</h3>
            <ol>
              {t.firefoxSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <div className="gesture-modal__foot">
              <button type="button" className="btn btn--primary" onClick={() => setOpen(false)}>
                {t.close}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
