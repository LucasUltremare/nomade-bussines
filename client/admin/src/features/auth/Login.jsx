import { useEffect, useState } from "react";
import { api, API } from "../../api/client.js";
import { useT, LANGS } from "../../i18n/index.jsx";
import { LogoMark } from "../../components/Logo.jsx";

/* ══════════════════════════════════════════════════════════
   LOGIN — duas colunas: o que é à esquerda, a entrada à direita.
   Dois jeitos de entrar: e-mail + senha (ADMIN_SENHA, instalação
   caseira) e Google (GOOGLE_CLIENT_ID). O servidor diz quais existem.
   ══════════════════════════════════════════════════════════ */
export function Login({ error }) {
  const { t, lang, setLang } = useT();
  const [modos, setModos] = useState(null); // { google, senha }
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erroForm, setErroForm] = useState("");
  const [voando, setVoando] = useState(false);
  const titulo = t("login.title").split("\n");
  const erroUrl = error ? (t(`login.err.${error}`) === `login.err.${error}` ? t("login.err.generic") : t(`login.err.${error}`)) : null;

  useEffect(() => {
    fetch(`${API}/api/auth/modos`).then((r) => r.json()).then(setModos).catch(() => setModos({ google: true, senha: false }));
  }, []);

  const entrar = async (e) => {
    e.preventDefault();
    setVoando(true); setErroForm("");
    try {
      const r = await fetch(`${API}/api/auth/senha`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, senha }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "generic");
      api.setToken(d.token);
      window.location.replace("/");
    } catch (err) {
      setErroForm(err.message === "credenciais" ? t("login.err.credenciais") : err.message.startsWith("Muitas") ? err.message : t("login.err.generic"));
      setVoando(false);
    }
  };

  return (
    <div className="lg">
      <div className="lg__left">
        <div className="lg__brand"><LogoMark size={22} /> nomade <span>business</span></div>
        <div className="lg__hero">
          <h1 className="lg__title">
            {titulo.map((l, i) => <span key={i} className={i === titulo.length - 1 ? "lg__title-em" : ""}>{l}</span>)}
          </h1>
          <p className="lg__sub">{t("login.sub")}</p>
        </div>
        <ul className="lg__list">
          {["a", "b", "c"].map((k) => <li key={k}>{t(`login.list.${k}`)}</li>)}
        </ul>
      </div>

      <div className="lg__right">
        <div className="lg__langs">
          {LANGS.map((l) => <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>{l}</button>)}
        </div>
        <div className="lg__card">
          {(erroUrl || erroForm) && <div className="lg__error">{erroForm || erroUrl}</div>}

          {modos?.senha && (
            <form className="lg__form" onSubmit={entrar}>
              <label><span>{t("login.email")}</span><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
              <label><span>{t("login.password")}</span><input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required /></label>
              <button type="submit" className="lg__google" disabled={voando}>{voando ? "…" : t("login.enter")}</button>
            </form>
          )}

          {modos?.senha && modos?.google && <div className="lg__or">{t("login.or")}</div>}

          {modos?.google && (
            <a href={`${API}/api/auth/google`} className={`lg__google${modos.senha ? " lg__google--ghost" : ""}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4c-.2 1.2-.9 2.3-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z" opacity=".95"/>
                <path fill="currentColor" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6C4.8 19.8 8.2 22 12 22z" opacity=".75"/>
                <path fill="currentColor" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1C2.4 8.8 2 10.4 2 12s.4 3.2 1.1 4.6L6.4 14z" opacity=".55"/>
                <path fill="currentColor" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9C17 3 14.7 2 12 2 8.2 2 4.8 4.2 3.1 7.4L6.4 10C7.2 7.8 9.4 6 12 6z" opacity=".85"/>
              </svg>
              {t("login.google")}
            </a>
          )}

          {modos && !modos.google && !modos.senha && <p className="lg__foot">{t("login.none")}</p>}
          <p className="lg__foot">{t("login.foot")}</p>
        </div>
      </div>
    </div>
  );
}
