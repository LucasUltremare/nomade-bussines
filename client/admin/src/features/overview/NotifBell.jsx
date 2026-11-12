import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../components/Icon.jsx";
import { useT, localeOf } from "../../i18n/index.jsx";
import { useNotifications } from "../../hooks/useNotifications.js";
import { PushRow } from "../../components/AppInstall.jsx";

/* ══════════════════════════════════════════════════════════
   NOTIF BELL — sininho com dropdown em portal
   
   Usa React Portal + position:fixed pra escapar de qualquer
   stacking context do pai (especialmente backdrop-filter do kanban).
   ══════════════════════════════════════════════════════════ */

export function NotifBell({ me, onOpenTask }) {
  const { t, lang } = useT();
  const { notifs, unreadCount, markRead, markAllRead, remove } = useNotifications(me?.email);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef(null);
  const dropdownRef = useRef(null);

  // Calcula posição do dropdown a partir do botão sininho (coords viewport)
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 8,
      right: Math.max(16, window.innerWidth - rect.right), // garante 16px da borda
    });
  }, [open]);

  // Fechar ao clicar fora (considera btn + dropdown)
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  // Reposiciona se a janela rolar/resize enquanto aberto
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (!btnRef.current) return;
      const rect = btnRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 8,
        right: Math.max(16, window.innerWidth - rect.right),
      });
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true); // true: capture, pega scroll de containers
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  const fmtTime = (d) => {
    const dt = new Date(d);
    const now = new Date();
    const diff = (now - dt) / 1000;
    if (diff < 60) return t("time.now");
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    return dt.toLocaleDateString(localeOf(lang), { day: "2-digit", month: "short" });
  };

  const iconForType = (t) => {
    if (t === "mention") return "at";
    if (t === "assigned") return "tasks";
    if (t === "comment") return "comment";
    if (t === "reply") return "comment";
    return "bell";
  };

  const onClickNotif = async (n) => {
    if (!n.read) await markRead(n._id);
    setOpen(false);
    if (n.taskId && onOpenTask) onOpenTask(n.taskId, n.boardId);
  };

  const dropdown = open && (
    <div
      ref={dropdownRef}
      className="notif-dropdown notif-dropdown--portal"
      style={{ top: pos.top, right: pos.right }}
    >
      <div className="notif-dropdown-head">
        <span className="notif-dropdown-title">{t("notif.title")}</span>
        {unreadCount > 0 && (
          <button className="notif-mark-all" onClick={markAllRead}>{t("notif.mark_all")}</button>
        )}
      </div>
      <div className="notif-dropdown-list">
        {notifs.length === 0 ? (
          <div className="notif-dropdown-empty">
            <Icon name="bell" size={24} />
            <p>{t("notif.empty")}</p>
          </div>
        ) : (
          notifs.map(n => (
            <div key={n._id} className={`notif-item ${!n.read ? "notif-item--unread" : ""}`} onClick={() => onClickNotif(n)}>
              <div className="notif-item-icon"><Icon name={iconForType(n.type)} size={13} /></div>
              <div className="notif-item-body">
                <div className="notif-item-title">{n.title}</div>
                {n.body && <div className="notif-item-text">{n.body}</div>}
                <div className="notif-item-meta">
                  {n.actorName && <span>{n.actorName}</span>}
                  <span>· {fmtTime(n.createdAt)}</span>
                </div>
              </div>
              <button className="notif-item-x" onClick={e => { e.stopPropagation(); remove(n._id); }}>
                <Icon name="close" size={11} />
              </button>
            </div>
          ))
        )}
      </div>
      {/* Ligar o push mora aqui: é onde a pessoa está quando pensa em avisos. */}
      <PushRow compacto />
    </div>
  );

  return (
    <div className="notif-bell">
      <button ref={btnRef} className="notif-bell-btn" onClick={() => setOpen(!open)} title={t("notif.title")}>
        <Icon name="bell" size={18} />
        {unreadCount > 0 && (
          <span className="notif-bell-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
        )}
      </button>
      {dropdown && createPortal(dropdown, document.body)}
    </div>
  );
}