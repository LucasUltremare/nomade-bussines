import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client.js";
import { getSocket } from "../lib/socket.js";

/* Aviso do SISTEMA (fora da aba). Duas armadilhas cobertas aqui:

   1. `new Notification()` é construtor ilegal dentro de PWA instalado no
      Android — lá só existe registration.showNotification().
   2. Com push ligado o servidor JÁ manda o aviso; disparar um local também
      faria a mesma coisa aparecer duas vezes. Então o local só entra quando
      NÃO há assinatura de push — ele é o plano B, não o caminho normal.

   E nada dispara com a aba à vista: aí o sininho já dá o recado. */
/* Sem cache de propósito: a pessoa pode ligar o push no meio da sessão, e um
   valor guardado deixaria o aviso duplicado (ou ausente) até o próximo load. */
async function temPush() {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
    const reg = await navigator.serviceWorker.ready;
    return !!(await reg.pushManager.getSubscription());
  } catch { return false; }
}

async function avisarNoSistema(notif) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;
  if (await temPush()) return;
  const opts = {
    body: notif.body || "",
    tag: notif.taskId ? `task:${notif.taskId}` : `notif:${notif._id}`,
    data: { url: notif.taskId ? `/?tab=tasks&task=${notif.taskId}&board=${notif.boardId || ""}` : "/" },
  };
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg) { await reg.showNotification(notif.title, opts); return; }
  } catch { /* cai no construtor abaixo */ }
  try { new Notification(notif.title, opts); } catch {}
}

// Hook de notificações — carrega + escuta novas em tempo real
export function useNotifications(myEmail) {
  const [notifs, setNotifs] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const reload = useCallback(async () => {
    if (!myEmail) return;
    try {
      const list = await api.get("/api/admin/notifications");
      setNotifs(list);
      setUnreadCount(list.filter(n => !n.read).length);
    } catch (e) { console.warn("notif reload failed", e); }
  }, [myEmail]);

  useEffect(() => { reload(); }, [reload]);

  // socket listener pra notif:<email>
  useEffect(() => {
    if (!myEmail) return;
    const sock = getSocket();
    if (!sock) return;
    const channel = `notif:${myEmail}`;
    const onNew = (notif) => {
      setNotifs(prev => [notif, ...prev].slice(0, 50));
      setUnreadCount(c => c + 1);
      avisarNoSistema(notif);
    };
    sock.on(channel, onNew);
    return () => { sock.off(channel, onNew); };
  }, [myEmail]);

  const markRead = async (id) => {
    setNotifs(prev => prev.map(n => n._id === id ? { ...n, read: true } : n));
    setUnreadCount(c => Math.max(0, c - 1));
    try { await api.patch(`/api/admin/notifications/${id}/read`, {}); } catch {}
  };
  const markAllRead = async () => {
    setNotifs(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
    try { await api.post("/api/admin/notifications/read-all", {}); } catch {}
  };
  const remove = async (id) => {
    setNotifs(prev => prev.filter(n => n._id !== id));
    try { await api.del(`/api/admin/notifications/${id}`); } catch {}
  };

  return { notifs, unreadCount, reload, markRead, markAllRead, remove };
}
