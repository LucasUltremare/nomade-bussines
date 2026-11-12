import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api/client.js";

/* ══════════════════════════════════════════════════════════════════════════
   PUSH — aviso que chega com o app fechado

   O sininho já existia, mas depende do socket: só toca com a aba aberta. Isto
   aqui é a outra metade — Web Push com VAPID, entregue pelo browser mesmo com
   o cockpit fechado. É o que faz o app instalado valer mais que o favorito.

   Degrada em silêncio: sem chave VAPID no servidor o estado vira
   'sem-servidor' e a UI simplesmente não oferece o botão. Nada quebra.
   ══════════════════════════════════════════════════════════════════════════ */

const suportado = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

/** VAPID vem em base64url; o PushManager quer bytes. */
function chaveParaBytes(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * estado:
 *   'checando'     — ainda perguntando pro servidor
 *   'indisponivel' — browser sem suporte (Safari < 16.4, iOS não instalado…)
 *   'sem-servidor' — sem VAPID configurado; push desligado do lado de lá
 *   'desligado'    — dá pra ligar
 *   'ligado'       — assinado
 *   'bloqueado'    — a pessoa negou a permissão; só resolve nas config. do site
 */
export function usePush() {
  const [estado, setEstado] = useState("checando");
  const [ocupado, setOcupado] = useState(false);
  const chaveRef = useRef(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!suportado()) { vivo && setEstado("indisponivel"); return; }
      try {
        const { ativo, chave } = await api.get("/api/admin/push/key");
        if (!vivo) return;
        if (!ativo || !chave) { setEstado("sem-servidor"); return; }
        chaveRef.current = chave;

        if (Notification.permission === "denied") { setEstado("bloqueado"); return; }

        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!vivo) return;

        if (sub && Notification.permission === "granted") {
          setEstado("ligado");
          // Reenvia a assinatura: o servidor pode ter perdido o registro (base
          // limpa, endpoint rodado). É upsert por endpoint, então é barato.
          api.post("/api/admin/push/subscribe", { subscription: sub.toJSON() }).catch(() => {});
        } else {
          setEstado("desligado");
        }
      } catch {
        vivo && setEstado("sem-servidor");
      }
    })();
    return () => { vivo = false; };
  }, []);

  const ativar = useCallback(async () => {
    if (!suportado() || !chaveRef.current) return false;
    setOcupado(true);
    try {
      // requestPermission precisa nascer de um gesto — por isso isto só é
      // chamado do onClick do botão, nunca de um efeito no mount.
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setEstado(perm === "denied" ? "bloqueado" : "desligado");
        return false;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true, // exigido pelo Chrome: todo push vira aviso visível
          applicationServerKey: chaveParaBytes(chaveRef.current),
        }));
      await api.post("/api/admin/push/subscribe", { subscription: sub.toJSON() });
      setEstado("ligado");
      return true;
    } catch (e) {
      console.warn("[push] falhou ao ativar:", e);
      setEstado("desligado");
      return false;
    } finally {
      setOcupado(false);
    }
  }, []);

  const desativar = useCallback(async () => {
    setOcupado(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.post("/api/admin/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe();
      }
      setEstado("desligado");
    } catch {
      /* deixa como está: melhor não mentir que desligou */
    } finally {
      setOcupado(false);
    }
  }, []);

  const testar = useCallback(() => api.post("/api/admin/push/test", {}), []);

  return { estado, ocupado, ativar, desativar, testar };
}
