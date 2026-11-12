import { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { Icon } from "../../components/Icon.jsx";
import { useT } from "../../i18n/index.jsx";
import "./config.css";

/* ══════════════════════════════════════════════════════════
   ESTE COMPUTADOR — o que funciona nesta instalação.
   O servidor testa (GET /api/office/ambiente) e manda um código
   por item; o texto mora em i18n/mod/ambiente.js. Usado em
   Ajustes e como passo do onboarding quando roda local.
   ══════════════════════════════════════════════════════════ */

const ORDEM = { nao: 0, aviso: 1, ok: 2, off: 3 };

export const buscarAmbiente = (refazer = false) =>
  fetch(`/api/office/ambiente${refazer ? "?refazer=1" : ""}`, { headers: { Authorization: `Bearer ${api.token()}` } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

export function AmbienteLista({ inicial = null, cls = "" }) {
  const { t } = useT();
  const [amb, setAmb] = useState(inicial);
  const [testando, setTestando] = useState(!inicial);

  const testar = (refazer) => { setTestando(true); buscarAmbiente(refazer).then((a) => { if (a) setAmb(a); setTestando(false); }); };
  useEffect(() => { if (!inicial) testar(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // texto do item; códigos de rede (dns, certificado…) são comuns a todos
  const texto = (it) => {
    const k = `amb.${it.id}.${it.motivo}`;
    const s = t(k, it);
    return s === k ? t(`amb.net.${it.motivo}`, it) : s;
  };

  if (!amb) return <p className="amb-vazio">{testando ? t("amb.testing") : t("amb.fail")}</p>;
  const itens = [...amb.itens].sort((a, b) => ORDEM[a.estado] - ORDEM[b.estado]);

  return (
    <div className={`amb ${cls}`}>
      <ul className="amb-lista">
        {itens.map((it) => (
          <li key={it.id} className={`amb-it amb-it--${it.estado}`}>
            <span className="amb-dot" aria-hidden="true" />
            <div className="amb-b">
              <div className="amb-h"><b>{t(`amb.${it.id}`)}</b><span className="amb-tag">{t(`amb.e.${it.estado}`)}</span></div>
              <p>{texto(it)}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="amb-foot">
        <button type="button" className="amb-again" onClick={() => testar(true)} disabled={testando}>
          <Icon name="refresh" size={12} /> {testando ? t("amb.testing") : t("amb.again")}
        </button>
        {amb.proxy && <span>{t("amb.proxy")}</span>}
      </div>
    </div>
  );
}
