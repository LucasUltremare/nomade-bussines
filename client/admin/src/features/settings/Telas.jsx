import { Icon } from "../../components/Icon.jsx";
import { useT } from "../../i18n/index.jsx";
import "./config.css";
import { NAV, FIXAS, LAYOUTS, layoutDe } from "../../lib/telas.js";
import { usePresenca } from "../../lib/presenca.js";

/* Quais telas a empresa usa. Três pontos de partida e, embaixo, a lista
   inteira pra ligar e desligar uma por uma. Usado no onboarding e em Ajustes. */
export function TelasEditor({ value, onChange }) {
  const { t } = useT();
  const ligadas = new Set(value || LAYOUTS.full);
  const layout = layoutDe([...ligadas]);
  const alternar = (id) => {
    const n = new Set(ligadas);
    n.has(id) ? n.delete(id) : n.add(id);
    onChange([...n]);
  };

  return (
    <div className="tl tl--pv">
      <div className="tl-main">
      <div className="tl-presets" role="radiogroup" aria-label={t("set.screens")}>
        {Object.keys(LAYOUTS).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={layout === k} className="tl-preset" onClick={() => onChange([...LAYOUTS[k]])}>
            <b>{t(`lay.${k}`)}</b>
            <span>{t(`lay.${k}_d`)}</span>
            <small>{t("lay.count", { n: LAYOUTS[k].length + FIXAS.length })}</small>
          </button>
        ))}
      </div>
      {layout === "custom" && <p className="tl-note">{t("lay.custom")}</p>}

      <div className="tl-groups">
        {NAV.map((g) => (
          <fieldset key={g.group} className="tl-group">
            <legend>{t(g.group)}</legend>
            {g.items.map((n) => {
              const fixa = FIXAS.includes(n.id);
              const on = fixa || ligadas.has(n.id);
              return (
                <label key={n.id} className={`tl-item${on ? " on" : ""}${fixa ? " fixa" : ""}`}>
                  <Icon name={n.icon} size={15} />
                  <span className="tl-item-t"><b>{t(n.label)}</b><small>{t(`tela.${n.id}`)}</small></span>
                  <input type="checkbox" checked={on} disabled={fixa} onChange={() => alternar(n.id)} />
                  <i className="tl-sw" aria-hidden="true" />
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
      </div>
      <TelasPrevia ligadas={ligadas} />
    </div>
  );
}

/* A barra lateral como vai ficar, mudando na hora: tela desligada é riscada,
   desfoca e sai; o resto sobe pra ocupar o lugar. */
function TelasPrevia({ ligadas }) {
  const { t } = useT();
  const ids = NAV.flatMap((g) => g.items.map((i) => i.id)).filter((id) => FIXAS.includes(id) || ligadas.has(id));
  const fase = usePresenca(ids);
  return (
    <aside className="tl-pv" aria-label={t("lay.preview")}>
      <div className="tl-pv-h"><span>{t("lay.preview")}</span><b key={ids.length} className="tl-pv-n">{ids.length}</b></div>
      {NAV.map((g) => {
        const itens = g.items.filter((n) => fase(n.id));
        if (!itens.length) return null;
        const gf = itens.some((n) => fase(n.id) !== "saindo") ? (itens.every((n) => fase(n.id) === "entrando") ? "entrando" : "in") : "saindo";
        return (
          <div className={`pz pz--${gf}`} key={g.group}>
            <div className="pz__in">
              <div className="tl-pv-g">
                <small>{t(g.group)}</small>
                {itens.map((n) => (
                  <div className={`pz pz--${fase(n.id)}`} key={n.id}>
                    <div className="pz__in"><div className="tl-pv-item"><Icon name={n.icon} size={13} /><span>{t(n.label)}</span></div></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </aside>
  );
}
