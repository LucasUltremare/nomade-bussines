import { useCallback, useEffect, useState } from "react";

/* Tema: claro por padrão, do login em diante; escuro é opção.
   Ordem: escolha da pessoa → tema da empresa → claro.
   A chave mudou de nome junto com o padrão: quem tinha "dark" gravado da
   época em que escuro era o único jeito começa no claro e escolhe de novo. */
const KEY = "nomade_tema";
export const THEMES = ["light", "dark"];

const salvo = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const aplicarTema = (t) => document.documentElement.setAttribute("data-theme", t);

export function useTheme(empresaTema) {
  const [theme, setThemeRaw] = useState(() => salvo() || empresaTema || "light");
  useEffect(() => { if (empresaTema && !salvo() && THEMES.includes(empresaTema)) setThemeRaw(empresaTema); }, [empresaTema]);
  useEffect(() => { aplicarTema(theme); }, [theme]);
  const setTheme = useCallback((t) => {
    if (!THEMES.includes(t)) return;
    try { localStorage.setItem(KEY, t); } catch { /* privado */ }
    setThemeRaw(t);
  }, []);
  const toggle = useCallback(() => setTheme(theme === "dark" ? "light" : "dark"), [theme, setTheme]);
  return { theme, setTheme, toggle };
}
