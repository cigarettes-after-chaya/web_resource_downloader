import React, { useEffect, useRef } from "react";

/** WinForms Button */
export function WfButton({
  children,
  onClick,
  disabled,
  variant,
  style,
  className = "",
  title,
  autoFocus,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "danger";
  style?: React.CSSProperties;
  className?: string;
  title?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const cls =
    variant === "primary"
      ? "wf-btn wf-btn-primary"
      : variant === "danger"
        ? "wf-btn wf-btn-danger"
        : "wf-btn";
  return (
    <button
      ref={ref}
      type="button"
      className={`${cls} ${className}`}
      onClick={onClick}
      disabled={disabled}
      style={style}
      title={title}
    >
      {children}
    </button>
  );
}

/** WinForms CheckBox */
export function WfCheckbox({
  checked,
  onChange,
  label,
  disabled,
  style,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <label className={`wf-check${disabled ? " disabled" : ""}`} style={style}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="box">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2 6.5 5 9.5 10 2.5" />
        </svg>
      </span>
      <span>{label}</span>
    </label>
  );
}

/** WinForms NumericUpDown */
export function WfNumeric({
  value,
  onChange,
  min,
  max,
  disabled,
  width,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
  width?: number;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.trunc(v) || 0));
  return (
    <span className={`wf-num${disabled ? " disabled" : ""}`}>
      <input
        type="text"
        inputMode="numeric"
        value={String(value)}
        disabled={disabled}
        style={width ? { width } : undefined}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d-]/g, "");
          if (v === "") return onChange(min);
          onChange(clamp(parseInt(v, 10)));
        }}
        onBlur={(e) => onChange(clamp(parseInt(e.target.value, 10) || min))}
        aria-label="numeric value"
      />
      <span className="spin">
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => onChange(clamp(value + 1))}
          aria-label="increase"
        >
          ▲
        </button>
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => onChange(clamp(value - 1))}
          aria-label="decrease"
        >
          ▼
        </button>
      </span>
    </span>
  );
}

/** WinForms GroupBox */
export function WfGroupBox({
  title,
  children,
  style,
}: {
  title: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <fieldset className="wf-group" style={style}>
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

/** WinForms ComboBox (DropDownList style) */
export function WfCombo({
  items,
  selectedIndex,
  onChange,
  width,
  disabled,
}: {
  items: readonly string[];
  selectedIndex: number;
  onChange: (index: number) => void;
  width?: number | string;
  disabled?: boolean;
}) {
  return (
    <select
      className="wf-combo"
      style={{ width, height: 23, fontSize: 13 }}
      value={selectedIndex}
      disabled={disabled}
      onChange={(e) => onChange(parseInt(e.target.value, 10))}
    >
      {items.map((it, i) => (
        <option key={i} value={i}>
          {it}
        </option>
      ))}
    </select>
  );
}

/** WinForms TabControl */
export function WfTabs({
  tabs,
  active,
  onChange,
  children,
  className = "",
}: {
  tabs: string[];
  active: number;
  onChange: (i: number) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`wf-tabs ${className}`}>
      <div className="wf-tabstrip" role="tablist">
        {tabs.map((t, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={active === i}
            className={`wf-tab${active === i ? " active" : ""}`}
            onClick={() => onChange(i)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="wf-tabpage">{children}</div>
    </div>
  );
}

/** WinForms ListView (Details view, full-row select, grid lines) */
export interface LvColumn {
  title: string;
  width: number;
}
export interface LvRow {
  key: string | number;
  cells: React.ReactNode[];
  className?: string;
  data?: unknown;
}

export function WfListView({
  columns,
  rows,
  selectedKey,
  onSelect,
  onDoubleClick,
  emptyText,
}: {
  columns: LvColumn[];
  rows: LvRow[];
  selectedKey?: string | number | null;
  onSelect?: (row: LvRow | null) => void;
  onDoubleClick?: (row: LvRow) => void;
  emptyText?: string;
}) {
  return (
    <div
      className="wf-listview"
      tabIndex={0}
      onKeyDown={(e) => {
        if (!onSelect || rows.length === 0) return;
        const idx = rows.findIndex((r) => r.key === selectedKey);
        if (e.key === "ArrowDown") {
          e.preventDefault();
          onSelect(rows[Math.min(rows.length - 1, idx + 1)]);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          onSelect(rows[Math.max(0, idx - 1)]);
        } else if (e.key === "Enter" && idx >= 0 && onDoubleClick) {
          e.preventDefault();
          onDoubleClick(rows[idx]);
        }
      }}
    >
      <table>
        <colgroup>
          {columns.map((c, i) => (
            <col key={i} style={{ width: c.width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i}>{c.title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className="lv-empty" colSpan={columns.length}>
                {emptyText ?? ""}
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr
              key={r.key}
              className={`${r.className ?? ""}${selectedKey === r.key ? " selected" : ""}`}
              onClick={() => onSelect?.(r)}
              onDoubleClick={() => onDoubleClick?.(r)}
            >
              {r.cells.map((c, i) => (
                <td key={i}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Modal dialog frame matching the original Forms (title bar + close X) */
export function WfDialog({
  title,
  onClose,
  children,
  width,
  height,
  showClose = true,
}: {
  title: string;
  onClose?: () => void;
  children: React.ReactNode;
  width?: number;
  height?: number | string;
  showClose?: boolean;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div
      className="wf-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div
        className="wf-dialog"
        role="dialog"
        aria-label={title}
        style={{ width: width ? `min(${width}px, 100%)` : undefined, height }}
      >
        <div className="wf-dialog-title">
          <span>{title}</span>
          {showClose && onClose && (
            <button className="x" onClick={onClose} aria-label="Close" title="Close">
              ✕
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
