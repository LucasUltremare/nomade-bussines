/**
 * lib/security — endurecimento HTTP sem dependência nova.
 *
 * O node roda ATRÁS de Cloudflare Tunnel + Nginx Proxy Manager (TLS termina
 * lá). Então:
 *   · o IP real do cliente vem em CF-Connecting-IP (Cloudflare) — NÃO confiar
 *     cegamente em X-Forwarded-For (spoofável se algo além do CF injetar);
 *   · security headers são setados aqui (não no proxy) pra ficarem versionados
 *     junto do código e valerem em qualquer ambiente.
 */

/* IP real do cliente. CF-Connecting-IP é setado pela Cloudflare e não é
   spoofável por quem passa pelo túnel; cai pro XFF/req.ip só em dev. */
function clientIp(req) {
  return (
    req.headers["cf-connecting-ip"] ||
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

/**
 * Rate limiter fixed-window em memória (processo único — ok pra esta escala).
 * Chave = ip + rota. Retorna middleware.
 *
 * @param {object} opts { windowMs, max, message }
 */
function rateLimit({ windowMs = 60_000, max = 60, message = "Muitas requisições. Tenta de novo em instantes." } = {}) {
  const hits = new Map(); // key -> { count, resetAt }

  // Limpeza periódica pra não vazar memória com IPs que sumiram
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs);
  if (sweep.unref) sweep.unref();

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const key = `${clientIp(req)}:${req.baseUrl || ""}${req.path}`;
    let rec = hits.get(key);
    if (!rec || rec.resetAt <= now) {
      rec = { count: 0, resetAt: now + windowMs };
      hits.set(key, rec);
    }
    rec.count++;

    const remaining = Math.max(0, max - rec.count);
    res.setHeader("RateLimit-Limit", max);
    res.setHeader("RateLimit-Remaining", remaining);
    res.setHeader("RateLimit-Reset", Math.ceil((rec.resetAt - now) / 1000));

    if (rec.count > max) {
      /* Loga só a PRIMEIRA vez que a janela estoura (senão vira flood no log
         durante um ataque). Serve de alarme pra um cenário chato: se o
         CF-Connecting-IP parar de chegar, todo mundo colapsa num "IP" só e
         gente de verdade começa a tomar 429 — no log isso aparece como o
         mesmo IP estourando tudo. */
      if (rec.count === max + 1) {
        console.warn(`[rate-limit] ${key} estourou ${max}/${Math.round(windowMs / 1000)}s`);
      }
      res.setHeader("Retry-After", Math.ceil((rec.resetAt - now) / 1000));
      return res.status(429).json({ error: "rate_limited", message });
    }
    next();
  };
}

/**
 * Security headers globais. Aplicar cedo no pipeline (antes das rotas).
 * A CSP da PÁGINA PÚBLICA de proposta é setada na própria resposta dela
 * (precisa liberar Google Fonts); aqui vai o baseline pra tudo.
 */
function securityHeaders(req, res, next) {
  // Não anunciar o stack
  res.removeHeader("X-Powered-By");

  /* HSTS — o browser passa a RECUSAR http:// nestes domínios por 1 ano, então
     ninguém cai numa conexão em claro (nem por link velho, nem por downgrade).
     Não checamos x-forwarded-proto: entre o CF Tunnel e o NPM o hop é http e o
     header chegaria "http", matando o HSTS em produção sem ninguém notar.
     Browser ignora HSTS recebido por http, então mandar sempre é seguro — só
     pulamos host local/IP pra não travar o dev em http://localhost.
     Sem `preload` de propósito: preload é via de mão única. Se algum dia
     existir subdomínio só-http, tirar o includeSubDomains. */
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").split(":")[0];
  const isLocalHost = host === "localhost" || host === "127.0.0.1" || /^\d+\.\d+\.\d+\.\d+$/.test(host);
  if (host && !isLocalHost) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  // MIME sniffing off, referrer enxuto, sem FLoC/topics
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "browser=(), interest-cohort=()");

  const isProposta = req.path.startsWith("/proposta/");

  // Clickjacking: nega iframe em tudo, MENOS a página pública de proposta
  // (ela pode legitimamente ser aberta/embedada; ainda assim travamos com CSP).
  if (!isProposta) {
    res.setHeader("X-Frame-Options", "DENY");
  }

  // API nunca deve ser cacheada por browser/proxy (dados de cliente, tokens)
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    // Frame-ancestors none reforça o X-Frame-Options pra respostas de API
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  }

  next();
}

/* CSP da página pública de proposta — inline styles + Google Fonts + data: img.
   frame-ancestors 'none' mata clickjacking do botão Pagar. Chamar dentro do
   handler de /proposta/:token antes de mandar o HTML. */
function propostaCsp(res) {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      "style-src 'unsafe-inline' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src data:",
      "form-action 'self'",       // o botão Pagar só posta pro próprio domínio
      "base-uri 'none'",
      "frame-ancestors 'none'",   // ninguém embeda a proposta num iframe
    ].join("; ")
  );
  res.setHeader("X-Frame-Options", "DENY");
}

module.exports = { rateLimit, securityHeaders, propostaCsp, clientIp };
