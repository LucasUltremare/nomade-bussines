import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../../i18n/index.jsx";
import "./tour.css";

/* ══════════════════════════════════════════════════════════
   TOUR — o "como usar": escurece a tela, deixa um recorte em
   volta do lugar onde a pessoa clica e explica em uma frase.

   Cada passo aponta pra um elemento marcado com data-tour="…".
   Passo sem `alvo` vira um cartão no centro (abertura e fim).
   Passo cujo alvo não existe na tela (módulo desligado, sem
   permissão) é pulado — o tour acompanha o que a pessoa vê.
   ══════════════════════════════════════════════════════════ */

const KEY = "nomade_tour_visto";
export const tourVisto = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return true; } };
const marcarVisto = () => { try { localStorage.setItem(KEY, "1"); } catch { /* privado */ } };

const MOBILE = "(max-width: 900px)";
const FOLGA = 6;      // respiro em volta do alvo
const LARGURA = 320;  // do cartão
const alvoDe = (p) => (p.alvo ? document.querySelector(`[data-tour="${p.alvo}"]`) : null);

export function Tour({ passos, onClose, onMenu }) {
  const { t } = useT();
  // Só os passos que têm onde apontar. Filtra depois de montar: na primeira
  // abertura o tour nasce junto com o shell, e o menu ainda não está na página.
  const [lista, setLista] = useState([]);
  useEffect(() => { setLista(passos.filter((p) => !p.alvo || alvoDe(p))); }, [passos]);
  const [i, setI] = useState(0);
  const [caixa, setCaixa] = useState(null); // retângulo do alvo, ou null = centro
  const cartao = useRef(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const passo = lista[i];

  const fechar = useCallback(() => {
    marcarVisto(); onMenu?.(false);
    // o tour rolou o menu pra mostrar os itens de baixo: devolve pro topo
    document.querySelector(".sb__nav")?.scrollTo({ top: 0 });
    onClose();
  }, [onClose, onMenu]);
  const ir = useCallback((n) => { if (n >= lista.length) fechar(); else setI(Math.max(0, n)); }, [lista.length, fechar]);

  const medir = useCallback(() => {
    const el = passo && alvoDe(passo);
    if (!el) { setCaixa(null); return; }
    const r = el.getBoundingClientRect();
    setCaixa({ left: r.left - FOLGA, top: r.top - FOLGA, width: r.width + FOLGA * 2, height: r.height + FOLGA * 2 });
  }, [passo]);

  // no celular o menu é uma gaveta: abre pra mostrar os itens, fecha pro resto
  useEffect(() => {
    if (!passo) return;
    const mobile = window.matchMedia(MOBILE).matches;
    if (mobile) onMenu?.(!!passo.menu);
    const el = alvoDe(passo);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    medir();
    const depois = setTimeout(medir, mobile ? 320 : 60); // espera a gaveta deslizar
    return () => clearTimeout(depois);
  }, [passo, medir, onMenu]);

  useEffect(() => {
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", medir, true);
    return () => { window.removeEventListener("resize", medir); window.removeEventListener("scroll", medir, true); };
  }, [medir]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); fechar(); }
      if (e.key === "ArrowRight" || e.key === "Enter") ir(i + 1);
      if (e.key === "ArrowLeft") ir(i - 1);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [i, ir, fechar]);

  // cartão ao lado do alvo, do lado que couber; sem alvo, no centro
  useLayoutEffect(() => {
    const c = cartao.current; if (!c) return;
    const vw = window.innerWidth, vh = window.innerHeight, m = 12;
    const w = c.offsetWidth, h = c.offsetHeight;
    if (!caixa) { setPos({ left: (vw - w) / 2, top: Math.max(m, (vh - h) / 2) }); return; }
    const cabe = {
      right: caixa.left + caixa.width + m + w <= vw - m,
      left: caixa.left - m - w >= m,
      bottom: caixa.top + caixa.height + m + h <= vh - m,
      top: caixa.top - m - h >= m,
    };
    const lado = [passo.lado, "right", "bottom", "top", "left"].find((l) => l && cabe[l]) || "bottom";
    let left, top;
    if (lado === "right" || lado === "left") {
      left = lado === "right" ? caixa.left + caixa.width + m : caixa.left - m - w;
      top = caixa.top;
    } else {
      top = lado === "bottom" ? caixa.top + caixa.height + m : caixa.top - m - h;
      left = caixa.left;
    }
    setPos({ left: Math.min(Math.max(m, left), vw - w - m), top: Math.min(Math.max(m, top), vh - h - m) });
  }, [caixa, passo, i]);

  if (!passo) return null;
  const ultimo = i === lista.length - 1;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={t("tour.label")}>
      {caixa
        ? <div className="tour__furo" style={caixa} />
        : <div className="tour__veu" />}
      <div className="tour__card" ref={cartao} style={{ ...pos, width: LARGURA }} key={i}>
        <div className="tour__n">{t("tour.count", { n: i + 1, total: lista.length })}</div>
        <h2>{t(passo.titulo)}</h2>
        <p>{t(passo.texto)}</p>
        <div className="tour__acoes">
          {!ultimo && <button className="tour__pular" onClick={fechar}>{t("tour.skip")}</button>}
          <span />
          {i > 0 && <button className="tour__b" onClick={() => ir(i - 1)}>{t("tour.back")}</button>}
          <button className="tour__b tour__b--p" onClick={() => ir(i + 1)} autoFocus>{ultimo ? t("tour.done") : i === 0 ? t("tour.start") : t("tour.next")}</button>
        </div>
      </div>
    </div>
  );
}
