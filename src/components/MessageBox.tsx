import { useCallback, useRef, useState } from "react";
import { WfButton } from "./controls";

/**
 * WinForms MessageBox reconstruction — same captions, icons and button sets
 * as the original app (MessageBoxButtons.OK / YesNo, icons 16=Error,
 * 48=Warning, 64=Information, 32=Question).
 */
export type MsgIcon = "error" | "warning" | "info" | "question";

interface MsgRequest {
  title: string;
  message: string;
  icon: MsgIcon;
  buttons: "ok" | "yesNo";
  resolve: (result: "ok" | "yes" | "no") => void;
}

function IconGlyph({ icon }: { icon: MsgIcon }) {
  // WinForms system icons drawn as flat SVGs
  if (icon === "error")
    return (
      <svg viewBox="0 0 32 32" className="icon" aria-hidden>
        <circle cx="16" cy="16" r="14" fill="#e81123" />
        <path d="M10 10 L22 22 M22 10 L10 22" stroke="#fff" strokeWidth="3" fill="none" />
      </svg>
    );
  if (icon === "warning")
    return (
      <svg viewBox="0 0 32 32" className="icon" aria-hidden>
        <path d="M16 3 30 28 H2 Z" fill="#ffd800" stroke="#9b8500" strokeWidth="1" />
        <rect x="14.5" y="11" width="3" height="9" fill="#1e1e1e" />
        <rect x="14.5" y="22.5" width="3" height="3" fill="#1e1e1e" />
      </svg>
    );
  if (icon === "question")
    return (
      <svg viewBox="0 0 32 32" className="icon" aria-hidden>
        <circle cx="16" cy="16" r="14" fill="#0078d7" />
        <text x="16" y="23" textAnchor="middle" fontSize="19" fill="#fff" fontFamily="Segoe UI, sans-serif">
          ?
        </text>
      </svg>
    );
  return (
    <svg viewBox="0 0 32 32" className="icon" aria-hidden>
      <circle cx="16" cy="16" r="14" fill="#0078d7" />
      <text x="16" y="23" textAnchor="middle" fontSize="18" fontStyle="italic" fill="#fff" fontFamily="Georgia, serif">
        i
      </text>
    </svg>
  );
}

function MessageBoxView({ req, onResult }: { req: MsgRequest; onResult: (r: "ok" | "yes" | "no") => void }) {
  return (
    <div className="wf-overlay" onMouseDown={(e) => e.target === e.currentTarget && onResult(req.buttons === "ok" ? "ok" : "no")}>
      <div className="wf-dialog" role="alertdialog" aria-label={req.title} style={{ maxWidth: "min(500px, 96vw)" }}>
        <div className="wf-dialog-title">
          <span>{req.title}</span>
          <button
            className="x"
            aria-label="Close"
            onClick={() => onResult(req.buttons === "ok" ? "ok" : "no")}
          >
            ✕
          </button>
        </div>
        <div className="wf-dialog-body" style={{ overflow: "visible" }}>
          <div className="wf-msgbox-content">
            <IconGlyph icon={req.icon} />
            <div className="text">{req.message}</div>
          </div>
          {req.buttons === "ok" ? (
            <div className="wf-msgbox-buttons">
              <WfButton className="default" autoFocus onClick={() => onResult("ok")}>
                OK
              </WfButton>
            </div>
          ) : (
            <div className="wf-msgbox-buttons">
              <WfButton className="default" autoFocus onClick={() => onResult("yes")}>
                Yes
              </WfButton>
              <WfButton onClick={() => onResult("no")}>No</WfButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Hook mirroring MessageBox.Show — returns promise-based helpers + the node to render. */
export function useMessageBox() {
  const [req, setReq] = useState<MsgRequest | null>(null);
  const counter = useRef(0);

  const show = useCallback(
    (message: string, title = "Error", icon: MsgIcon = "warning"): Promise<"ok"> =>
      new Promise<"ok">((resolve) => {
        counter.current++;
        setReq({ title, message, icon, buttons: "ok", resolve: () => resolve("ok") });
      }),
    [],
  );

  const confirm = useCallback(
    (message: string, title: string, icon: MsgIcon = "question"): Promise<boolean> =>
      new Promise((resolve) => {
        counter.current++;
        setReq({
          title,
          message,
          icon,
          buttons: "yesNo",
          resolve: (r) => resolve(r === "yes"),
        });
      }),
    [],
  );

  const node = req ? (
    <MessageBoxView
      key={counter.current}
      req={req}
      onResult={(r) => {
        setReq(null);
        req.resolve(r);
      }}
    />
  ) : null;

  return { show, confirm, messageBox: node };
}
