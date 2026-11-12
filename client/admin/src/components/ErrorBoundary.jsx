import { Component } from "react";
import { useT } from "../i18n/index.jsx";

/**
 * ErrorBoundary — impede que um erro em UM componente apague o admin inteiro.
 * Envolve a área de conteúdo: se a aba atual crashar, mostra um aviso com botão
 * de recarregar em vez de tela branca. `resetKey` (a aba atual) zera o estado de
 * erro ao trocar de aba, então um crash numa aba não trava as outras.
 */

/* Classe não usa hook: o texto da tela de erro mora neste componente de função.
   O boundary fica dentro do LangProvider, então useT resolve normalmente. */
function CrashScreen({ err }) {
  const { t } = useT();
  return (
    <div style={{
      maxWidth: 480, margin: "48px auto", padding: "var(--s-6)",
      border: "1px solid var(--danger-line)", borderRadius: "var(--r-lg)",
      background: "var(--danger-soft)", textAlign: "center",
    }}>
      <div style={{ fontFamily: "var(--heading)", fontWeight: 700, fontSize: "var(--t-lg)", color: "var(--ink)", marginBottom: "var(--s-2)" }}>
        {t("ui.err.title")}
      </div>
      <p style={{ fontSize: "var(--t-base)", color: "var(--ink-soft)", lineHeight: "var(--lh-base)", marginBottom: "var(--s-4)" }}>
        {t("ui.err.text")}
      </p>
      <button className="ui-btn ui-btn--primary" onClick={() => window.location.reload()}>
        {t("ui.err.reload")}
      </button>
      {err?.message && (
        <div style={{ marginTop: "var(--s-4)", fontFamily: "var(--mono)", fontSize: "var(--t-2xs)", color: "var(--ink-faint)", wordBreak: "break-word" }}>
          {String(err.message)}
        </div>
      )}
    </div>
  );
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  componentDidCatch(err, info) {
    console.error("[admin] erro capturado pelo ErrorBoundary:", err, info?.componentStack);
  }

  componentDidUpdate(prev) {
    // Trocou de aba → limpa o erro pra nova aba renderizar normalmente
    if (prev.resetKey !== this.props.resetKey && this.state.err) {
      this.setState({ err: null });
    }
  }

  render() {
    if (this.state.err) return <CrashScreen err={this.state.err} />;
    return this.props.children;
  }
}
