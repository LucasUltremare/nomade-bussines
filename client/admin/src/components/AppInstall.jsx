import { useState, useSyncExternalStore, useCallback } from "react";
import { Icon } from "./Icon.jsx";
import { useT } from "../i18n/index.jsx";
import { Modal, Button, useToast } from "./ui.jsx";
import { usePush } from "../hooks/usePush.js";
import {
  assinarPWA, estadoPWA, instalar, rodandoInstalado,
  ehIOS, ehSafari, aplicarAtualizacao,
} from "../lib/pwa.js";

/* ══════════════════════════════════════════════════════════════════════════
   INSTALAR — o cockpit como app

   O admin continua sendo o site de sempre; isto só acrescenta a porta de
   entrada instalada. Regra: o botão some assim que o app está instalado (nada
   pior que um "Instalar" dentro do app já instalado).
   ══════════════════════════════════════════════════════════════════════════ */

/* Seletores separados por valor: `useSyncExternalStore` compara por
   Object.is, então devolver o objeto inteiro remontaria a cada aviso. */
const usePodeInstalar = () => useSyncExternalStore(assinarPWA, () => estadoPWA().podeInstalar);
const useTemAtualizacao = () => useSyncExternalStore(assinarPWA, () => estadoPWA().temAtualizacao);

export function InstallButton() {
  const { t } = useT();
  const podeInstalar = usePodeInstalar();
  const [aberto, setAberto] = useState(false);
  const [instalado, setInstalado] = useState(rodandoInstalado);

  // iOS nunca dispara beforeinstallprompt — lá o botão abre o passo a passo.
  const iosPodeInstalar = ehIOS() && ehSafari() && !instalado;
  if (instalado || (!podeInstalar && !iosPodeInstalar)) return null;

  return (
    <>
      <button className="pwa-cta" onClick={() => setAberto(true)} title={t("pwa.install_title")}>
        <Icon name="install" size={14} />
        <span className="pwa-cta__txt">{t("pwa.install")}</span>
      </button>
      {aberto && (
        <InstallSheet
          onClose={() => setAberto(false)}
          onInstalado={() => { setInstalado(true); setAberto(false); }}
        />
      )}
    </>
  );
}

function InstallSheet({ onClose, onInstalado }) {
  const { t } = useT();
  const podeInstalar = usePodeInstalar();
  const toast = useToast();
  const [ocupado, setOcupado] = useState(false);
  const ios = ehIOS();

  const clicar = useCallback(async () => {
    setOcupado(true);
    const r = await instalar();
    setOcupado(false);
    if (r === "accepted") { toast(t("pwa.installed"), { tone: "ok", text: t("pwa.installed_text") }); onInstalado(); }
    else if (r === "indisponivel") toast(t("pwa.unavailable"), { tone: "warn" });
  }, [toast, onInstalado, t]);

  return (
    <Modal
      title={t("pwa.sheet_title")}
      subtitle={t("pwa.sheet_sub")}
      onClose={onClose}
      footer={
        !ios && (
          <>
            <Button variant="ghost" onClick={onClose}>{t("pwa.later")}</Button>
            <Button variant="primary" icon="install" loading={ocupado} disabled={!podeInstalar} onClick={clicar}>
              {t("pwa.install")}
            </Button>
          </>
        )
      }
    >
      <ul className="pwa-ganhos">
        <li><Icon name="play" size={13} /><div><b>{t("pwa.gain.open_t")}</b><span>{t("pwa.gain.open_s")}</span></div></li>
        <li><Icon name="bell" size={13} /><div><b>{t("pwa.gain.notify_t")}</b><span>{t("pwa.gain.notify_s")}</span></div></li>
        <li><Icon name="overview" size={13} /><div><b>{t("pwa.gain.full_t")}</b><span>{t("pwa.gain.full_s")}</span></div></li>
      </ul>

      {ios ? (
        <div className="pwa-ios">
          <div className="pwa-ios__head">
            <Icon name="shareIos" size={15} />
            <span>{t("pwa.ios.head")}</span>
          </div>
          <ol>
            <li>{t("pwa.ios.s1a")} <b>{t("pwa.ios.s1b")}</b> {t("pwa.ios.s1c")}</li>
            <li>{t("pwa.ios.s2a")} <b>{t("pwa.ios.s2b")}</b>.</li>
            <li>{t("pwa.ios.s3a")} <b>{t("pwa.ios.s3b")}</b>.</li>
          </ol>
          <p className="pwa-nota">{t("pwa.ios.note")}</p>
        </div>
      ) : !podeInstalar ? (
        <p className="pwa-nota">{t("pwa.no_prompt")}</p>
      ) : null}

      <div className="pwa-sep" />
      <PushRow />
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   AVISOS — a linha que liga o push. Vive no sino e dentro do sheet.
   ══════════════════════════════════════════════════════════════════════════ */
export function PushRow({ compacto }) {
  const { t } = useT();
  const { estado, ocupado, ativar, desativar, testar } = usePush();
  const toast = useToast();

  if (estado === "checando") return null;
  if (estado === "sem-servidor") return null; // push desligado no servidor: não promete o que não entrega

  if (estado === "indisponivel") {
    if (compacto) return null;
    return (
      <p className="pwa-nota">{t("push.unsupported")}</p>
    );
  }

  if (estado === "bloqueado") {
    return (
      <div className={`pwa-push${compacto ? " pwa-push--compacto" : ""}`}>
        <Icon name="bellOff" size={15} />
        <div className="pwa-push__txt">
          <b>{t("push.blocked_t")}</b>
          <span>{t("push.blocked_s")}</span>
        </div>
      </div>
    );
  }

  const ligado = estado === "ligado";
  return (
    <div className={`pwa-push${compacto ? " pwa-push--compacto" : ""}`}>
      <Icon name={ligado ? "bell" : "bellOff"} size={15} />
      <div className="pwa-push__txt">
        <b>{ligado ? t("push.on_t") : t("push.off_t")}</b>
        <span>{ligado ? t("push.on_s") : t("push.off_s")}</span>
      </div>
      <div className="pwa-push__acoes">
        {ligado && (
          <button
            className="pwa-push__link"
            onClick={() => testar()
              .then(() => toast(t("push.test_sent"), { tone: "ok", text: t("push.test_sent_s") }))
              .catch(() => toast(t("push.test_fail"), { tone: "danger" }))}
          >
            {t("push.test")}
          </button>
        )}
        <Button
          size="sm"
          variant={ligado ? "ghost" : "primary"}
          loading={ocupado}
          onClick={() => (ligado ? desativar() : ativar())}
        >
          {ligado ? t("push.disable") : t("push.enable")}
        </Button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   NOVA VERSÃO — deploy saiu enquanto a aba estava aberta

   Com service worker o app passa a poder ficar preso numa versão antiga; esta
   barra é o antídoto. Não recarrega sozinha: alguém pode estar no meio de um
   comentário.
   ══════════════════════════════════════════════════════════════════════════ */
export function UpdateBar() {
  const { t } = useT();
  const temAtualizacao = useTemAtualizacao();
  const [escondido, setEscondido] = useState(false);
  if (!temAtualizacao || escondido) return null;

  return (
    <div className="pwa-update" role="status">
      <Icon name="refresh" size={14} />
      <span>{t("pwa.update_available")}</span>
      <button className="pwa-update__btn" onClick={aplicarAtualizacao}>{t("pwa.update")}</button>
      <button className="pwa-update__x" onClick={() => setEscondido(true)} aria-label={t("pwa.update_later")}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
