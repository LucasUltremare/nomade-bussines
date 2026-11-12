/* ══════════════════════════════════════════════════════════════════════════
   PWA — instalação, atualização e deep link

   O `beforeinstallprompt` dispara CEDO, muitas vezes antes do React montar.
   Por isso o listener é registrado no import deste módulo (main.jsx importa
   antes de tudo) e o evento fica guardado aqui. Quem renderiza o botão só
   consulta este store — se esperasse o mount, o evento já teria passado.
   ══════════════════════════════════════════════════════════════════════════ */

const SW_URL = import.meta.env.BASE_URL + 'sw.js';

/* ─── store mínimo (sem lib: é um evento e dois booleanos) ─────────────── */
let promptGuardado = null;
let esperando = null; // service worker novo esperando pra assumir
const ouvintes = new Set();
const avisar = () => ouvintes.forEach(f => { try { f(); } catch {} });

export function assinarPWA(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

export const estadoPWA = () => ({
  podeInstalar: !!promptGuardado,
  temAtualizacao: !!esperando,
});

/* ─── instalado? ───────────────────────────────────────────────────────── */
export function rodandoInstalado() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.matchMedia?.('(display-mode: minimal-ui)').matches
    || window.navigator.standalone === true; // iOS
}

/* iOS/iPadOS não implementa beforeinstallprompt: o único caminho é
   Compartilhar → Adicionar à Tela de Início. Detectamos pra mostrar o passo a
   passo em vez de um botão que não faria nada.
   iPadOS moderno se identifica como Mac, daí o teste por touch. */
export function ehIOS() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export const ehSafari = () =>
  /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(navigator.userAgent);

/* ─── beforeinstallprompt ──────────────────────────────────────────────── */
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // sem isto o Chrome mostra a mini-infobar dele
  promptGuardado = e;
  avisar();
});

window.addEventListener('appinstalled', () => {
  promptGuardado = null;
  avisar();
});

/** Abre o diálogo nativo. Devolve 'accepted' | 'dismissed' | 'indisponivel'. */
export async function instalar() {
  if (!promptGuardado) return 'indisponivel';
  const e = promptGuardado;
  promptGuardado = null; // o evento é de uso único
  avisar();
  try {
    e.prompt();
    const { outcome } = await e.userChoice;
    return outcome;
  } catch {
    return 'dismissed';
  }
}

/* ─── deep link (?tab=&task=&board=) ───────────────────────────────────── */
/* Lido no import porque o App faz history.replaceState pra limpar o token da
   URL — se lêssemos depois, o parâmetro já teria sumido. */
const paramsIniciais = new URLSearchParams(window.location.search);
export const rotaInicial = {
  tab: paramsIniciais.get('tab'),
  task: paramsIniciais.get('task'),
  board: paramsIniciais.get('board'),
};

/* Clique na notificação com o app já aberto: o SW manda a rota por postMessage
   em vez de recarregar (recarregar perderia o que a pessoa estava fazendo). */
export function aoClicarNotificacao(fn) {
  const h = (e) => {
    if (e.data?.type !== 'NOTIF_CLICK') return;
    const p = new URLSearchParams(new URL(e.data.url, location.origin).search);
    fn({ tab: p.get('tab'), task: p.get('task'), board: p.get('board') });
  };
  navigator.serviceWorker?.addEventListener('message', h);
  return () => navigator.serviceWorker?.removeEventListener('message', h);
}

/* ─── registro do service worker ───────────────────────────────────────── */
export function registrarSW() {
  if (!('serviceWorker' in navigator)) return;
  // localhost sem HTTPS é permitido pelo browser; qualquer outro host sem TLS
  // não registra SW — evita erro barulhento no console em dev por IP.
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;

  window.addEventListener('load', async () => {
    try {
      /* scope '/' com script em /admin/sw.js só é aceito porque o servidor
         responde `Service-Worker-Allowed: /` nesse arquivo (server.js). É
         necessário: o cockpit abre na RAIZ do crew, não em /admin. */
      const reg = await navigator.serviceWorker.register(SW_URL, { scope: '/' });

      const observar = (sw) => {
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          // 'installed' + já existe controller = versão NOVA esperando.
          // Sem controller é a primeira instalação: não há o que avisar.
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            esperando = sw;
            avisar();
          }
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) { esperando = reg.waiting; avisar(); }
      observar(reg.installing);
      reg.addEventListener('updatefound', () => observar(reg.installing));

      // Volta do background depois de horas? Confere se saiu deploy.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    } catch (err) {
      console.warn('[pwa] service worker não registrou:', err);
    }
  });
}

/* Aplica a atualização assim que ela ficar pronta, sem perguntar.
   Só pra usar DESLOGADO: aí não há trabalho pra perder — e, se o service
   worker velho for justamente o que trava o login (foi o caso em
   01/set/2026), esperar o clique em "Atualizar" é um beco sem saída, porque
   aquela barra mora no Dashboard, que só existe depois de entrar. */
export function atualizarAssimQuePuder() {
  if (esperando) { aplicarAtualizacao(); return () => {}; }
  return assinarPWA(() => { if (esperando) aplicarAtualizacao(); });
}

/** Troca pra versão nova e recarrega quando ela assumir. */
export function aplicarAtualizacao() {
  if (!esperando) return;
  const alvo = esperando;
  let recarregou = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recarregou) return;
    recarregou = true;
    window.location.reload();
  });
  alvo.postMessage({ type: 'SKIP_WAITING' });
  esperando = null;
  avisar();
}
