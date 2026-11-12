/* ══════════════════════════════════════════════════════════════════════════
   NOMADE BUSINESS — service worker

   Existe por três motivos, nessa ordem:
     1. tornar o cockpit instalável (critério de installability do Chrome);
     2. abrir rápido e não morrer numa tela branca quando a rede cai;
     3. receber push quando o app está fechado (o socket só vive com aba aberta).

   ESCOPO vs. INTERCEPTAÇÃO — a parte delicada.
   o domínio do painel não é só o painel: /link e /cli são do CLI
   (Studio/extensão) e /hq + /api são as duas APIs. O SW precisa de escopo "/"
   porque o app abre na RAIZ (o ai-service reescreve / → /admin/) e o
   start_url tem que estar dentro do escopo. Mas escopo largo não pode virar
   interceptação larga: aqui embaixo só respondemos por navegação do admin e
   por asset sob /admin/. Todo o resto passa direto pro browser, sem
   respondWith — inclusive /hub, /link, /hq/*, /api/* e o socket.io.

   Nada de API entra em cache: a resposta é por usuário (JWT no header) e um
   cache compartilhado aqui seria vazamento entre sócios.
   ══════════════════════════════════════════════════════════════════════════ */

const VERSION = 'v2'; // v2: sem navigationPreload (duplicava request e quebrava o OAuth)
const SHELL = `nomade-shell-${VERSION}`;
const ASSETS = `nomade-assets-${VERSION}`;
const NOSSOS = [SHELL, ASSETS];

// '/admin/' em produção (o SW é servido de /admin/sw.js). Derivado da própria
// localização pra não ter constante duplicada com o `base` do Vite.
const BASE = new URL('./', self.location).pathname;
const INDEX = BASE + 'index.html';

/* ─── install: guarda o shell ──────────────────────────────────────────── */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      // reload: o index não pode vir do cache HTTP do browser aqui, senão a
      // instalação "nova" já nasce com o HTML velho apontando pro bundle velho
      .then(c => c.add(new Request(INDEX, { cache: 'reload' })))
      .catch(() => {})
  );
  // não chamamos skipWaiting: quem decide a hora de trocar é a página
  // (mostra "nova versão · atualizar" e manda SKIP_WAITING).
});

/* ─── activate: joga fora cache de versão anterior ─────────────────────── */
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.map(n => NOSSOS.includes(n) ? null : caches.delete(n)));

    /* DESLIGAR, não apenas "não ligar": navigationPreload é estado da
       REGISTRATION, não do worker. A v1 ligou; uma v2 que só omitisse o
       enable() herdaria a flag ligada e continuaria quebrada pra quem já
       tinha visitado o site — que é exatamente todo mundo que precisa da
       correção. Só o disable() explícito cura. */
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.disable().catch(() => {});
    }

    /* Por que não ligar. Parece otimização de graça e não é:
       com ele ativo o browser dispara a request de navegação em paralelo pra
       TODA navegação no escopo — e o escopo aqui é "/". Nas navegações que
       este SW recusa (o `return` sem respondWith lá embaixo, pra /hq, /hub,
       /link) o browser descarta o preload e busca de novo pela rede: a mesma
       URL vai DUAS vezes ao servidor.

       Isso quebrou o login em 01/set/2026. O `code` do OAuth do Google é de
       uso único: o preload consumia o code e a request duplicada levava
       invalid_grant, virando `error=auth_failed` — "Erro no login. Tente de
       novo." — pra quem só queria entrar. */

    await self.clients.claim();
  })());
});

/* ─── a página manda trocar de versão ──────────────────────────────────── */
self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
  // Quem está no comando? Sem isto, "sw.js" é o nome dos dois e não dá pra
  // saber, nem daqui nem do DevTools, se o browser ainda está numa versão
  // velha. Custou uma tarde em 01/set/2026.
  if (e.data?.type === 'VERSAO') e.ports?.[0]?.postMessage(VERSION);
});

/* ─── o que é nosso ────────────────────────────────────────────────────── */
const ehNavegacaoDoAdmin = (url) => url.pathname === '/' || url.pathname.startsWith(BASE);
const ehAssetDoAdmin = (url) => url.pathname.startsWith(BASE) && !url.pathname.endsWith('/sw.js');

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // CDN, avatar do Google, etc.

  // Navegação do cockpit: rede primeiro (o HTML precisa ser fresco pra apontar
  // pro bundle com hash certo), cai no shell guardado se a rede falhar.
  if (req.mode === 'navigate') {
    if (!ehNavegacaoDoAdmin(url)) return; // /hub, /link — não é nosso
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) caches.open(SHELL).then(c => c.put(INDEX, res.clone())).catch(() => {});
        return res;
      } catch {
        return (await caches.match(INDEX)) || respostaOffline();
      }
    })());
    return;
  }

  if (!ehAssetDoAdmin(url)) return; // /hq/*, /api/*, socket.io — passa direto

  // Asset do admin: cache primeiro. Os bundles do Vite têm hash no nome, então
  // "cacheado" e "atual" são a mesma coisa — quando o build muda, o nome muda.
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        const copia = res.clone();
        caches.open(ASSETS).then(c => c.put(req, copia)).catch(() => {});
      }
      return res;
    } catch {
      return Response.error();
    }
  })());
});

function respostaOffline() {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Nomade Business / offline</title>
     <style>
       html,body{height:100%;margin:0}
       body{display:grid;place-items:center;background:#0a0a0b;color:#f2f4f5;
            font:14px/1.5 Inter,-apple-system,sans-serif;text-align:center;padding:24px}
       p{color:rgba(242,244,245,.5);margin:8px 0 20px}
       button{border:1px solid rgba(255,255,255,.12);background:#141416;color:#f2f4f5;
              border-radius:10px;padding:10px 18px;font:inherit;cursor:pointer}
     </style>
     <div>
       <h1 style="font-size:16px;margin:0">Sem conexão</h1>
       <p>O cockpit precisa de rede pra carregar os dados.</p>
       <button onclick="location.reload()">Tentar de novo</button>
     </div>`,
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   PUSH — o motivo de o webapp valer mais que a aba
   ══════════════════════════════════════════════════════════════════════════ */

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Nomade Business', body: e.data?.text() || '' }; }

  const titulo = d.title || 'Nomade Business';
  const opcoes = {
    body: d.body || '',
    icon: BASE + 'icons/icon-192.png',
    badge: BASE + 'icons/icon-192.png',
    // tag agrupa por assunto: cinco comentários na mesma task viram um aviso
    tag: d.tag || 'nomade',
    renotify: true,
    timestamp: d.ts ? new Date(d.ts).getTime() : Date.now(),
    data: { url: d.url || '/', notifId: d.notifId || null },
  };

  e.waitUntil((async () => {
    // Cockpit aberto e à vista? O sininho já mostrou — um aviso do sistema por
    // cima seria a mesma coisa duas vezes. (userVisibleOnly permite pular
    // quando existe cliente visível.)
    const abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const aVista = abas.some(a => a.visibilityState === 'visible' && a.focused);
    if (aVista) return;
    await self.registration.showNotification(titulo, opcoes);
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = new URL(e.notification.data?.url || '/', self.location.origin);

  e.waitUntil((async () => {
    const abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Já tem cockpit aberto? Foca ele e manda navegar por dentro (sem reload:
    // recarregar perderia o estado do kanban/chat de quem já estava usando).
    for (const aba of abas) {
      const u = new URL(aba.url);
      if (u.origin === destino.origin && (u.pathname === '/' || u.pathname.startsWith(BASE))) {
        await aba.focus();
        aba.postMessage({ type: 'NOTIF_CLICK', url: destino.pathname + destino.search });
        return;
      }
    }
    await self.clients.openWindow(destino.href);
  })());
});

/* O browser às vezes roda a assinatura sozinho (expiração, troca de conta).
   Aqui dentro não existe JWT, e criar rota sem autenticação só pra isso seria
   abrir uma porta de escrita pública. Então reassinamos localmente e deixamos
   o conserto pro app: o usePush reenvia a assinatura toda vez que o cockpit
   abre, e a antiga morre sozinha no servidor no primeiro 410. */
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    try {
      const chave = e.oldSubscription?.options?.applicationServerKey;
      if (!chave) return;
      await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: chave,
      });
    } catch {}
  })());
});
