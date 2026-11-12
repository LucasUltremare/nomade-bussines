import { useEffect, useRef, useState, useCallback, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon.jsx";
import { useT } from "../i18n/index.jsx";

/* ═══════════════════════════════════════════════════════════
   UI — primitivos do admin.

   Estes componentes existem para matar três duplicações que
   hoje estão espalhadas pelo código:
     · a tab bar copiada em Reports, Orçamento, Pagamentos,
       Briefings e Deals
     · os 9 blocos <style> ad-hoc que reinventam input/botão/chip
     · os confirm()/alert() nativos misturados com KBDialog
   ═══════════════════════════════════════════════════════════ */

const cx = (...c) => c.filter(Boolean).join(" ");

/* ─────────────────────────── BOTÃO ─────────────────────── */
export function Button({
  variant = "secondary", size, icon, iconRight, loading, disabled,
  block, children, className, ...rest
}) {
  const iconOnly = !children && (icon || iconRight);
  return (
    <button
      className={cx(
        "ui-btn", `ui-btn--${variant}`,
        size && `ui-btn--${size}`,
        block && "ui-btn--block",
        iconOnly && "ui-btn--icon",
        className
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <span className="ui-btn__spinner" /> : icon && <Icon name={icon} size={14} />}
      {children}
      {iconRight && !loading && <Icon name={iconRight} size={14} />}
    </button>
  );
}

/* ─────────────────────────── CARD ──────────────────────── */
export function Card({ title, action, children, pad = true, interactive, className, ...rest }) {
  const hasHead = title || action;
  return (
    <div
      className={cx("ui-card", hasHead ? "ui-card--flush" : pad && "ui-card--pad", interactive && "ui-card--interactive", className)}
      {...rest}
    >
      {hasHead && (
        <div className="ui-card__head">
          {title && <div className="ui-card__title">{title}</div>}
          {action}
        </div>
      )}
      {hasHead ? <div className="ui-card__body">{children}</div> : children}
    </div>
  );
}

/* ────────────────────────── MÉTRICA ────────────────────── */
export function Metric({ label, value, hint, delta, accent = "var(--blue)" }) {
  return (
    <div className="ui-metric" style={{ "--accent": accent }}>
      <div className="ui-metric__label">{label}</div>
      <div className="ui-metric__value">{value ?? "—"}</div>
      {(hint || delta != null) && (
        <div className="ui-metric__foot">
          {delta != null && (
            <span className={cx("ui-metric__delta", delta >= 0 ? "ui-metric__delta--up" : "ui-metric__delta--down")}>
              {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%
            </span>
          )}
          {hint && <span>{hint}</span>}
        </div>
      )}
    </div>
  );
}

export const MetricGrid = ({ children }) => <div className="ui-metric-grid">{children}</div>;

/* ─────────────────────────── BADGE ─────────────────────── */
/* tone: neutral | ok | warn | danger | info | solid */
export function Badge({ tone = "neutral", dot, children }) {
  return (
    <span className={cx("ui-badge", tone !== "neutral" && `ui-badge--${tone}`)}>
      {dot && <span className="ui-badge__dot" />}
      {children}
    </span>
  );
}

export function Chip({ active, onRemove, children, ...rest }) {
  const { t } = useT();
  return (
    <span className={cx("ui-chip", active && "ui-chip--active")} {...rest}>
      {children}
      {onRemove && (
        <button className="ui-chip__x" onClick={onRemove} aria-label={t("ui.remove")}>
          <Icon name="close" size={9} />
        </button>
      )}
    </span>
  );
}

export const Dot = ({ tone }) => <span className={cx("ui-dot", tone && `ui-dot--${tone}`)} />;

/* ──────────────────────────── TABS ─────────────────────── */
/* items: [{ id, label, count? }] — substitui as 5 tab bars copiadas */
export function Tabs({ items, value, onChange }) {
  return (
    <div className="ui-tabs" role="tablist">
      {items.map(t => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          className={cx("ui-tab", value === t.id && "ui-tab--active")}
          onClick={() => onChange(t.id)}
        >
          {t.icon && <Icon name={t.icon} size={14} />}
          {t.label}
          {t.count != null && <span className="ui-tab__count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented({ items, value, onChange }) {
  return (
    <div className="ui-segmented" role="group">
      {items.map(t => (
        <button
          key={t.id}
          className={cx("ui-segmented__item", value === t.id && "ui-segmented__item--active")}
          onClick={() => onChange(t.id)}
          aria-pressed={value === t.id}
        >
          {t.icon && <Icon name={t.icon} size={13} />}
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ────────────────────────── CAMPOS ─────────────────────── */
export function Field({ label, hint, error, children }) {
  return (
    <div className="ui-field">
      {label && <label className="ui-field__label">{label}</label>}
      {children}
      {error ? <span className="ui-field__error">{error}</span>
             : hint && <span className="ui-field__hint">{hint}</span>}
    </div>
  );
}

export function Input({ label, hint, error, textarea, value, onChange, ...rest }) {
  const Tag = textarea ? "textarea" : "input";
  const el = (
    <Tag
      className={cx(textarea ? "ui-textarea" : "ui-input", error && (textarea ? "ui-textarea--error" : "ui-input--error"))}
      value={value ?? ""}
      onChange={e => onChange?.(e.target.value)}
      {...rest}
    />
  );
  return label || hint || error ? <Field label={label} hint={hint} error={error}>{el}</Field> : el;
}

export function SearchInput({ value, onChange, placeholder, ...rest }) {
  const { t } = useT();
  return (
    <div className="ui-input-wrap">
      <Icon name="search" size={14} />
      <input className="ui-input" value={value ?? ""} onChange={e => onChange?.(e.target.value)} placeholder={placeholder ?? t("ui.search_ph")} {...rest} />
    </div>
  );
}

/* options: [{ value, label }] */
export function Select({ label, hint, error, options = [], value, onChange, placeholder, ...rest }) {
  const el = (
    <select className="ui-select" value={value ?? ""} onChange={e => onChange?.(e.target.value)} {...rest}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  return label || hint || error ? <Field label={label} hint={hint} error={error}>{el}</Field> : el;
}

export function Switch({ checked, onChange, label }) {
  return (
    <button type="button" className={cx("ui-switch", checked && "ui-switch--on")} onClick={() => onChange?.(!checked)} role="switch" aria-checked={!!checked}>
      <span className="ui-switch__track" />
      {label && <span style={{ fontSize: "var(--t-base)" }}>{label}</span>}
    </button>
  );
}

/* ────────────────────────── TABELA ─────────────────────── */
/* columns: [{ key, label, width?, align?, render? }] */
export function Table({ columns, rows, onRowClick, empty, rowKey = (r, i) => r._id || r.id || i }) {
  if (!rows?.length && empty) return empty;
  return (
    <div className={cx("ui-table", onRowClick && "ui-table--clickable")}>
      <table>
        <thead>
          <tr>{columns.map(c => (
            <th key={c.key} style={{ width: c.width, textAlign: c.align }}>{c.label}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map(c => (
                <td key={c.key} className={c.align === "right" ? "num" : undefined}>
                  {c.render ? c.render(r, i) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ────────────────────── ESTADO VAZIO ───────────────────── */
export function Empty({ icon = "list", title, children, action }) {
  return (
    <div className="ui-empty">
      <div className="ui-empty__icon"><Icon name={icon} size={18} /></div>
      {title && <div className="ui-empty__title">{title}</div>}
      {children && <p className="ui-empty__text">{children}</p>}
      {action}
    </div>
  );
}

/* ────────────────────────── MODAL ──────────────────────── */
export function Modal({ title, subtitle, onClose, children, footer, size }) {
  const { t } = useT();
  useEffect(() => {
    const h = e => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", h);
    // trava o scroll do body enquanto o modal está aberto
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", h);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div className="ui-backdrop" onClick={onClose}>
      <div
        className={cx("ui-modal", size && `ui-modal--${size}`)}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="ui-modal__head">
          <div>
            <h2 className="ui-modal__title">{title}</h2>
            {subtitle && <div className="ui-modal__sub">{subtitle}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label={t("common.close")}><Icon name="close" size={15} /></button>
        </div>
        <div className="ui-modal__body">{children}</div>
        {footer && <div className="ui-modal__foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/* ──────── CONFIRM — substitui o confirm() nativo ───────── */
export function Confirm({ title, children, confirmLabel, danger, onConfirm, onClose, loading }) {
  const { t } = useT();
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>{confirmLabel ?? t("common.confirm")}</Button>
      </>}
    >
      <p style={{ fontSize: "var(--t-base)", color: "var(--ink-soft)", lineHeight: "var(--lh-base)" }}>{children}</p>
    </Modal>
  );
}

/* ────────────────────────── TOAST ──────────────────────── */
const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);

  const dismiss = useCallback(id => setToasts(t => t.filter(x => x.id !== id)), []);

  const toast = useCallback((title, opts = {}) => {
    const id = ++seq.current;
    setToasts(t => [...t, { id, title, ...opts }]);
    if (opts.duration !== 0) setTimeout(() => dismiss(id), opts.duration || 4000);
    return id;
  }, [dismiss]);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      {createPortal(
        <div className="ui-toasts">
          {toasts.map(t => (
            <div key={t.id} className={cx("ui-toast", t.tone && `ui-toast--${t.tone}`)} onClick={() => dismiss(t.id)} role="status">
              <div className="ui-toast__body">
                <div className="ui-toast__title">{t.title}</div>
                {t.text && <div className="ui-toast__text">{t.text}</div>}
              </div>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastCtx.Provider>
  );
}

/* toast("Cliente salvo", { tone: "ok", text: "…" }) */
export const useToast = () => {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
};

/* ────────────────────────── DIVERSOS ───────────────────── */
export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export const Divider = () => <hr className="ui-divider" />;

export function Progress({ value = 0, tone }) {
  return (
    <div className="ui-progress">
      <div className={cx("ui-progress__bar", tone === "ok" && "ui-progress__bar--ok")} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export const Kbd = ({ children }) => <kbd className="ui-kbd">{children}</kbd>;

export const Note = ({ children }) => <div className="ui-note">{children}</div>;

export function Skeleton({ w = "100%", h = 14, style }) {
  return <div className="skeleton" style={{ width: w, height: h, ...style }} />;
}
