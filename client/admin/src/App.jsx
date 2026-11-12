import { useState, useEffect, useCallback } from "react";
import { api } from "./api/client.js";
import { getSocket, disconnectSocket } from "./lib/socket.js";
import { Login } from "./features/auth/Login.jsx";
import { setAcesso } from "./lib/acesso.js";
import { carregarTime } from "./lib/team.js";
import { Dashboard } from "./features/dashboard/Dashboard.jsx";
import { Onboarding } from "./features/onboarding/Onboarding.jsx";
import { ToastProvider } from "./components/ui.jsx";
import { atualizarAssimQuePuder } from "./lib/pwa.js";
import { LangProvider } from "./i18n/index.jsx";
import { useTheme } from "./hooks/useTheme.js";
import { setRegional } from "./lib/regional.js";

import "./styles/global.css";
import "./styles/kanban.css";
import "./styles/pwa.css";

/* ══════════════════════════════════
   Nomade Business — painel
   ══════════════════════════════════ */

export default function App() {
  const [user, setUser] = useState(null);
  const [empresa, setEmpresa] = useState(null); // config do onboarding (nome, idioma, horário…)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const theme = useTheme(empresa?.tema);

  const carregarEmpresa = useCallback(() => api.get("/api/admin/empresa").then((e) => { setRegional(e); setEmpresa(e); }).catch(() => setEmpresa({})), []);

  useEffect(() => {
    const url = new URL(window.location.href);
    // Token vem no fragment (#token=) pra não vazar em logs de proxy.
    // Fallback pra query (?token=) cobre links antigos durante a transição.
    const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
    const token = hash.get("token") || url.searchParams.get("token");
    const err = url.searchParams.get("error");
    if (token) { api.setToken(token); window.history.replaceState({}, "", "/"); }
    if (err) { setError(err); window.history.replaceState({}, "", "/"); }
    if (api.token()) {
      api.get("/api/auth/me")
        .then(async u => { setAcesso(u.acesso); await Promise.all([carregarTime(), carregarEmpresa()]); setUser(u); getSocket(); })
        .catch(() => api.clear())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [carregarEmpresa]);

  /* Deslogado, atualização de service worker entra sozinha. */
  useEffect(() => {
    if (loading || user) return;
    return atualizarAssimQuePuder();
  }, [loading, user]);

  const logout = () => { disconnectSocket(); api.clear(); setUser(null); };

  // onboarding: só sócio vê, e só enquanto a empresa não foi configurada
  const precisaOnboarding = user?.acesso?.socio && empresa && !empresa.onboarding?.feito;
  const [refazendo, setRefazendo] = useState(false);

  return (
    <LangProvider empresaLang={empresa?.idioma}>
      {loading ? (
        <div className="splash"><div className="spinner" /></div>
      ) : !user ? (
        <Login error={error} />
      ) : (precisaOnboarding || refazendo) ? (
        <Onboarding
          empresa={empresa}
          onDone={async () => { await carregarEmpresa(); setRefazendo(false); }}
        />
      ) : (
        <ToastProvider>
          <Dashboard
            user={user} empresa={empresa} theme={theme}
            onLogout={logout}
            onEmpresaChange={carregarEmpresa}
            onRerunOnboarding={() => setRefazendo(true)}
          />
        </ToastProvider>
      )}
    </LangProvider>
  );
}
