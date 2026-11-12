import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { STRINGS } from "./strings.js";
import { localeDe } from "../lib/regional.js";

/* ══════════════════════════════════════════════════════════
   I18N — en · pt · es
   Ordem de resolução do idioma: escolha da pessoa (localStorage)
   → idioma da empresa (settings) → navegador → en.
   ══════════════════════════════════════════════════════════ */
export const LANGS = ["en", "pt", "es"];
const KEY = "nomade_lang";

const doNavegador = () => {
  const l = (typeof navigator !== "undefined" ? navigator.language : "en").slice(0, 2).toLowerCase();
  return LANGS.includes(l) ? l : "en";
};
const salva = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

const Ctx = createContext({ lang: "en", setLang: () => {}, t: (k) => k });

export function LangProvider({ empresaLang, children }) {
  const [lang, setLangRaw] = useState(() => salva() || empresaLang || doNavegador());
  // a empresa definiu o idioma depois do primeiro render (ex.: no onboarding) e
  // a pessoa ainda não escolheu o dela: segue a empresa
  useEffect(() => { if (empresaLang && !salva() && LANGS.includes(empresaLang)) setLangRaw(empresaLang); }, [empresaLang]);
  useEffect(() => { document.documentElement.lang = lang === "pt" ? "pt-BR" : lang; }, [lang]);

  const setLang = useCallback((l) => {
    if (!LANGS.includes(l)) return;
    try { localStorage.setItem(KEY, l); } catch { /* privado */ }
    setLangRaw(l);
  }, []);

  const t = useCallback((key, vars) => {
    const s = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useT = () => useContext(Ctx);

/* "há 3 min" / "3 min ago" — no idioma ativo */
export function useTimeAgo() {
  const { t } = useT();
  return (ts) => {
    const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
    if (m < 1) return t("time.now");
    if (m < 60) return t("time.min", { n: m });
    const h = Math.floor(m / 60);
    if (h < 24) return t("time.h", { n: h });
    const d = Math.floor(h / 24);
    return d === 1 ? t("time.yesterday") : t("time.d", { n: d });
  };
}

/* formato de número e data: idioma da tela + país da empresa */
export const localeOf = (lang) => localeDe(LANGS.includes(lang) ? lang : "en");
