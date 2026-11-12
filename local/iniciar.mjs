#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
 * Nomade Business — rodar NESTE computador, sem Docker e sem admin
 *
 *   Mac:      dois cliques em "Nomade.command"
 *   Windows:  dois cliques em "Nomade.cmd"
 *   Linux:    ./nomade.sh
 *
 * Os três chamam este arquivo com um Node (o do sistema ou um portátil que
 * eles baixam). Daqui pra frente é tudo Node, igual nos três sistemas:
 *
 *   1. primeira vez: pergunta idioma, empresa, e-mail e senha
 *   2. acha portas livres (o PC do trabalho costuma ter coisa na 5004)
 *   3. sobe um MongoDB portátil (baixa uma vez) ou usa o link que você der
 *   4. sobe o server e o office, espera responder e abre o navegador
 *   5. fecha tudo direito quando a janela fecha ou com Ctrl+C
 *
 * Os dados NÃO ficam nesta pasta: ficam na pasta do usuário (veja
 * pastaDados). Atualizar = baixar a versão nova e abrir; nada se perde.
 *
 * Comandos:  (nada) inicia · configurar · diagnostico · onde · ajuda
 * ══════════════════════════════════════════════════════════════════════════ */
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ESTE = fileURLToPath(import.meta.url)
const RAIZ = path.resolve(path.dirname(ESTE), '..')
const MONGO_VER = '8.0.37'
const WIN = process.platform === 'win32'
const MAC = process.platform === 'darwin'

function pastaDados() {
  if (process.env.NOMADE_DADOS) return path.resolve(process.env.NOMADE_DADOS)
  if (WIN) return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'NomadeBusiness')
  if (MAC) return path.join(os.homedir(), 'Library', 'Application Support', 'NomadeBusiness')
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'nomade-business')
}
const DADOS = pastaDados()
const ARQ = {
  config: path.join(DADOS, 'config.env'),
  estado: path.join(DADOS, 'estado.json'),
  mongo: path.join(DADOS, 'mongo'),
  logs: path.join(DADOS, 'logs'),
  runtime: path.join(DADOS, 'runtime'),
}

/* ── textos ──────────────────────────────────────────────────────────────── */
const T = {
  en: {
    titulo: 'Nomade Business',
    primeira: 'First time on this computer. Four questions and it runs.',
    empresa: 'Company name', email: 'Your e-mail (this is your login)', senha: 'Choose a password (8+ characters)',
    senha2: 'Type the password again', senha_curta: 'Too short.', senha_diff: "The passwords don't match.", email_ruim: "That doesn't look like an e-mail.",
    rede_q: 'Also open it from phones on the same Wi-Fi? On a work computer, answer no (y/N)',
    banco_q: 'Database: 1) on this computer (recommended)  2) I have a MongoDB link (Atlas)',
    banco_link: 'Paste the MongoDB link (mongodb+srv://…)',
    salvo: 'Saved in {f}',
    deps: 'Installing the dependencies (first time only)…',
    painel_build: 'Building the panel (first time only)…',
    sem_npm: "Couldn't install the dependencies. Download the ready-made version from the Releases page: {url}",
    ja: 'Nomade is already running. Opening {url}',
    portas: 'Port {a} is taken by another program; using {b}.',
    mongo_baixa: 'Downloading the database (MongoDB {v}, {mb} MB, only once)…',
    mongo_ok: 'Database ready.',
    mongo_reusa: 'The database was still on from last time; reusing it.',
    mongo_sem_download: "Couldn't download the database. The company network may block fastdl.mongodb.org.",
    mongo_manual: 'You can download it in the browser and put the file here, then open Nomade again:\n    {url}\n    → {dest}',
    mongo_atlas: 'Or use a free database in the cloud: create one at https://www.mongodb.com/atlas, copy the link and paste it below.',
    mongo_link_q: 'MongoDB link (or Enter to quit)',
    mongo_falhou: "The database didn't start. Last lines of {f}:",
    mongo_vc: 'Windows is missing the Visual C++ runtime that MongoDB needs. Ask IT to install "Microsoft Visual C++ Redistributable" (it is common), or use a MongoDB Atlas link.',
    mongo_linux: 'MongoDB has no build for this Linux. Install MongoDB with your package manager or use an Atlas link.',
    subindo: 'Starting…',
    pronto: 'Ready. Open:  {url}',
    entrar: 'Sign in with {email} and your password.',
    deixe: 'Keep this window open. To turn Nomade off, close it or press Ctrl+C.',
    parando: 'Turning off…',
    parado: 'Off. Your data is saved in {d}',
    caiu: '{s} stopped. Last lines of {f}:',
    reinicia: 'Starting {s} again…',
    desisto: '{s} keeps stopping. Nothing was lost. Send the file {f} when asking for help.',
    nao_subiu: "{s} didn't answer after {n}s. Look at {f}.",
    aqui: 'On this computer',
    diag_dica: 'Full check: run with "diagnostico". The panel shows the same list in Settings → This computer.',
    d_node: 'Node {v}', d_dados: 'Data folder {d} ({gb} GB free)', d_pouco: 'Data folder {d}: only {gb} GB free',
    d_proxy: 'Network proxy {p} ({de}); Nomade uses it', d_pac: 'The system uses an automatic proxy script (PAC). If the AI or downloads fail, ask IT for the proxy address and set HTTPS_PROXY in {f}',
    d_ca: 'Trusting the system certificates (needed when the company inspects HTTPS)',
    d_ca_nao: "This Node can't use the system certificates. If HTTPS fails, use the portable Node (delete {d} and open again)",
    d_ok: '{o}: {h} answers', d_falha: '{o}: {h} — {porque}',
    d_links: "Links for customers (proposals, payments, sign-up) only open on this computer. To send them, Nomade needs a public address. See docs/START-HERE.md",
    d_ollama: 'Local model (Ollama) found at {u}; Nomade uses it for memory search',
    d_ollama_nao: 'No local model (Ollama). Memory search works by matching words',
    d_nav: 'Project covers with {n}', d_nav_nao: 'No Chrome or Edge: projects get no automatic cover',
    d_sono: 'If the computer sleeps, Nomade stops. Turn sleep off while you need it on',
    o_ia: 'AI', o_pag: 'Payments', o_at: 'Customer service', o_mail: 'E-mail', o_dl: 'Downloads',
    p_dns: "the network can't find it (offline or blocked)", p_bloqueado: 'connection refused (firewall)', p_lento: 'no answer (slow or blocked)',
    p_certificado: 'the company network swaps the HTTPS certificate', p_proxy_senha: 'the proxy asks for a login', p_filtro: 'blocked by the company filter',
    ajuda: 'Commands:\n  (nothing)     start Nomade\n  configurar    answer the questions again (e-mail, password, database, network)\n  diagnostico   check what works on this computer\n  onde          show where the data is',
  },
  pt: {
    titulo: 'Nomade Business',
    primeira: 'Primeira vez neste computador. Quatro perguntas e ele roda.',
    empresa: 'Nome da empresa', email: 'Seu e-mail (vai ser o seu login)', senha: 'Escolha uma senha (8+ caracteres)',
    senha2: 'Digite a senha de novo', senha_curta: 'Muito curta.', senha_diff: 'As senhas não batem.', email_ruim: 'Isso não parece um e-mail.',
    rede_q: 'Abrir também pelo celular no mesmo Wi-Fi? No computador do trabalho, responda não (s/N)',
    banco_q: 'Banco de dados: 1) neste computador (recomendado)  2) tenho um link do MongoDB (Atlas)',
    banco_link: 'Cole o link do MongoDB (mongodb+srv://…)',
    salvo: 'Salvo em {f}',
    deps: 'Instalando as dependências (só na primeira vez)…',
    painel_build: 'Montando o painel (só na primeira vez)…',
    sem_npm: 'Não deu pra instalar as dependências. Baixe a versão pronta na página de Releases: {url}',
    ja: 'O Nomade já está rodando. Abrindo {url}',
    portas: 'A porta {a} está ocupada por outro programa; usando a {b}.',
    mongo_baixa: 'Baixando o banco de dados (MongoDB {v}, {mb} MB, só uma vez)…',
    mongo_ok: 'Banco pronto.',
    mongo_reusa: 'O banco ficou ligado da última vez; usando ele.',
    mongo_sem_download: 'Não deu pra baixar o banco. A rede da empresa pode estar bloqueando fastdl.mongodb.org.',
    mongo_manual: 'Dá pra baixar pelo navegador e colocar o arquivo aqui, depois abrir o Nomade de novo:\n    {url}\n    → {dest}',
    mongo_atlas: 'Ou use um banco grátis na nuvem: crie em https://www.mongodb.com/atlas, copie o link e cole abaixo.',
    mongo_link_q: 'Link do MongoDB (ou Enter pra sair)',
    mongo_falhou: 'O banco não subiu. Últimas linhas de {f}:',
    mongo_vc: 'Falta no Windows o Visual C++ que o MongoDB precisa. Peça pro TI instalar o "Microsoft Visual C++ Redistributable" (é comum), ou use um link do MongoDB Atlas.',
    mongo_linux: 'O MongoDB não tem versão pra este Linux. Instale o MongoDB pelo gerenciador de pacotes ou use um link do Atlas.',
    subindo: 'Subindo…',
    pronto: 'Pronto. Abra:  {url}',
    entrar: 'Entre com {email} e a sua senha.',
    deixe: 'Deixe esta janela aberta. Pra desligar o Nomade, feche ela ou aperte Ctrl+C.',
    parando: 'Desligando…',
    parado: 'Desligado. Os dados ficam salvos em {d}',
    caiu: 'O {s} parou. Últimas linhas de {f}:',
    reinicia: 'Subindo o {s} de novo…',
    desisto: 'O {s} continua parando. Nada se perdeu. Mande o arquivo {f} ao pedir ajuda.',
    nao_subiu: 'O {s} não respondeu em {n}s. Veja {f}.',
    aqui: 'Neste computador',
    diag_dica: 'Checagem completa: rode com "diagnostico". O painel mostra a mesma lista em Ajustes → Este computador.',
    d_node: 'Node {v}', d_dados: 'Pasta de dados {d} ({gb} GB livres)', d_pouco: 'Pasta de dados {d}: só {gb} GB livres',
    d_proxy: 'Proxy da rede {p} ({de}); o Nomade usa ele', d_pac: 'O sistema usa um script automático de proxy (PAC). Se a IA ou os downloads falharem, peça o endereço do proxy pro TI e coloque HTTPS_PROXY em {f}',
    d_ca: 'Confiando nos certificados do sistema (precisa quando a empresa inspeciona HTTPS)',
    d_ca_nao: 'Este Node não usa os certificados do sistema. Se o HTTPS falhar, use o Node portátil (apague {d} e abra de novo)',
    d_ok: '{o}: {h} responde', d_falha: '{o}: {h} — {porque}',
    d_links: 'Links pro cliente (propostas, pagamentos, cadastro) só abrem neste computador. Pra mandar, o Nomade precisa de um endereço público. Veja docs/COMECE-AQUI.md',
    d_ollama: 'Modelo local (Ollama) achado em {u}; o Nomade usa pra buscar nas memórias',
    d_ollama_nao: 'Sem modelo local (Ollama). A busca nas memórias é por palavra',
    d_nav: 'Capa dos projetos com o {n}', d_nav_nao: 'Sem Chrome ou Edge: os projetos ficam sem capa automática',
    d_sono: 'Se o computador dormir, o Nomade para. Desligue a suspensão enquanto precisar dele',
    o_ia: 'IA', o_pag: 'Pagamentos', o_at: 'Atendimento', o_mail: 'E-mail', o_dl: 'Downloads',
    p_dns: 'a rede não acha (sem internet ou bloqueado)', p_bloqueado: 'conexão recusada (firewall)', p_lento: 'sem resposta (lento ou bloqueado)',
    p_certificado: 'a rede da empresa troca o certificado HTTPS', p_proxy_senha: 'o proxy pede login', p_filtro: 'bloqueado pelo filtro da empresa',
    ajuda: 'Comandos:\n  (nada)        liga o Nomade\n  configurar    responde as perguntas de novo (e-mail, senha, banco, rede)\n  diagnostico   confere o que funciona neste computador\n  onde          mostra onde ficam os dados',
  },
  es: {
    titulo: 'Nomade Business',
    primeira: 'Primera vez en esta computadora. Cuatro preguntas y corre.',
    empresa: 'Nombre de la empresa', email: 'Tu correo (será tu usuario)', senha: 'Elige una contraseña (8+ caracteres)',
    senha2: 'Escribe la contraseña otra vez', senha_curta: 'Muy corta.', senha_diff: 'Las contraseñas no coinciden.', email_ruim: 'Eso no parece un correo.',
    rede_q: '¿Abrir también desde el celular en el mismo Wi-Fi? En la computadora del trabajo, responde no (s/N)',
    banco_q: 'Base de datos: 1) en esta computadora (recomendado)  2) tengo un link de MongoDB (Atlas)',
    banco_link: 'Pega el link de MongoDB (mongodb+srv://…)',
    salvo: 'Guardado en {f}',
    deps: 'Instalando las dependencias (solo la primera vez)…',
    painel_build: 'Armando el panel (solo la primera vez)…',
    sem_npm: 'No se pudieron instalar las dependencias. Descarga la versión lista en la página de Releases: {url}',
    ja: 'Nomade ya está corriendo. Abriendo {url}',
    portas: 'El puerto {a} lo usa otro programa; usando el {b}.',
    mongo_baixa: 'Descargando la base de datos (MongoDB {v}, {mb} MB, solo una vez)…',
    mongo_ok: 'Base lista.',
    mongo_reusa: 'La base quedó encendida desde la última vez; la uso.',
    mongo_sem_download: 'No se pudo descargar la base. La red de la empresa puede estar bloqueando fastdl.mongodb.org.',
    mongo_manual: 'Puedes descargarla en el navegador y poner el archivo aquí, luego abrir Nomade otra vez:\n    {url}\n    → {dest}',
    mongo_atlas: 'O usa una base gratis en la nube: créala en https://www.mongodb.com/atlas, copia el link y pégalo abajo.',
    mongo_link_q: 'Link de MongoDB (o Enter para salir)',
    mongo_falhou: 'La base no arrancó. Últimas líneas de {f}:',
    mongo_vc: 'A Windows le falta el Visual C++ que MongoDB necesita. Pide a TI que instale "Microsoft Visual C++ Redistributable" (es común), o usa un link de MongoDB Atlas.',
    mongo_linux: 'MongoDB no tiene versión para este Linux. Instala MongoDB con tu gestor de paquetes o usa un link de Atlas.',
    subindo: 'Arrancando…',
    pronto: 'Listo. Abre:  {url}',
    entrar: 'Entra con {email} y tu contraseña.',
    deixe: 'Deja esta ventana abierta. Para apagar Nomade, ciérrala o presiona Ctrl+C.',
    parando: 'Apagando…',
    parado: 'Apagado. Los datos quedan guardados en {d}',
    caiu: '{s} se detuvo. Últimas líneas de {f}:',
    reinicia: 'Arrancando {s} otra vez…',
    desisto: '{s} sigue deteniéndose. No se perdió nada. Envía el archivo {f} al pedir ayuda.',
    nao_subiu: '{s} no respondió en {n}s. Mira {f}.',
    aqui: 'En esta computadora',
    diag_dica: 'Revisión completa: ejecuta con "diagnostico". El panel muestra la misma lista en Ajustes → Esta computadora.',
    d_node: 'Node {v}', d_dados: 'Carpeta de datos {d} ({gb} GB libres)', d_pouco: 'Carpeta de datos {d}: solo {gb} GB libres',
    d_proxy: 'Proxy de red {p} ({de}); Nomade lo usa', d_pac: 'El sistema usa un script automático de proxy (PAC). Si la IA o las descargas fallan, pide a TI la dirección del proxy y pon HTTPS_PROXY en {f}',
    d_ca: 'Confiando en los certificados del sistema (hace falta cuando la empresa inspecciona HTTPS)',
    d_ca_nao: 'Este Node no usa los certificados del sistema. Si el HTTPS falla, usa el Node portátil (borra {d} y abre otra vez)',
    d_ok: '{o}: {h} responde', d_falha: '{o}: {h} — {porque}',
    d_links: 'Los links para el cliente (propuestas, pagos, registro) solo abren en esta computadora. Para enviarlos, Nomade necesita una dirección pública. Mira docs/EMPIEZA-AQUI.md',
    d_ollama: 'Modelo local (Ollama) encontrado en {u}; Nomade lo usa para buscar en la memoria',
    d_ollama_nao: 'Sin modelo local (Ollama). La búsqueda en la memoria es por palabra',
    d_nav: 'Portada de los proyectos con {n}', d_nav_nao: 'Sin Chrome ni Edge: los proyectos quedan sin portada automática',
    d_sono: 'Si la computadora se suspende, Nomade se detiene. Desactiva la suspensión mientras lo necesites',
    o_ia: 'IA', o_pag: 'Pagos', o_at: 'Atención', o_mail: 'Correo', o_dl: 'Descargas',
    p_dns: 'la red no lo encuentra (sin internet o bloqueado)', p_bloqueado: 'conexión rechazada (firewall)', p_lento: 'sin respuesta (lento o bloqueado)',
    p_certificado: 'la red de la empresa cambia el certificado HTTPS', p_proxy_senha: 'el proxy pide usuario', p_filtro: 'bloqueado por el filtro de la empresa',
    ajuda: 'Comandos:\n  (nada)        enciende Nomade\n  configurar    responde las preguntas otra vez (correo, contraseña, base, red)\n  diagnostico   revisa lo que funciona en esta computadora\n  onde          muestra dónde están los datos',
  },
}
let LANG = 'en'
const m = (k, v = {}) => String(T[LANG][k] ?? T.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? `{${x}}`)
const say = (s = '') => console.log(s ? `  ${s}` : '')
const ok = (s) => say(`✓ ${s}`), warn = (s) => say(`! ${s}`), bad = (s) => say(`✗ ${s}`)
const RELEASES = 'https://github.com/LucasUltremare/nomade-bussines/releases'

/* ── arquivos de config ──────────────────────────────────────────────────── */
function lerEnv(f) {
  const out = {}
  if (!fs.existsSync(f)) return out
  for (const linha of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const mt = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
    if (!mt) continue
    let v = mt[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[mt[1]] = v
  }
  return out
}
/* Troca as chaves dadas e mantém o resto do arquivo (a pessoa pode ter
   colado outras variáveis do .env.example ali). */
function gravarEnv(f, valores) {
  const linhas = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\r?\n/) : [
    '# Nomade Business — configuração deste computador.',
    '# Dá pra colar aqui qualquer variável do .env.example (chaves de IA, Mercado Pago, BASE_URL de um túnel…).',
    '',
  ]
  const falta = new Set(Object.keys(valores))
  const novas = linhas.map((l) => {
    const k = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1]
    if (k && falta.has(k)) { falta.delete(k); return `${k}=${valores[k]}` }
    return l
  })
  while (novas.length && novas[novas.length - 1] === '') novas.pop()
  for (const k of falta) novas.push(`${k}=${valores[k]}`)
  fs.writeFileSync(f, novas.join('\n') + '\n', { mode: 0o600 })
}
const lerEstado = () => { try { return JSON.parse(fs.readFileSync(ARQ.estado, 'utf8')) } catch { return {} } }
const gravarEstado = (e) => fs.writeFileSync(ARQ.estado, JSON.stringify(e, null, 2))

/* ── perguntas ───────────────────────────────────────────────────────────── */
function perguntar(q, padrao = '') {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(`  ${q}${padrao ? ` [${padrao}]` : ''}: `, (r) => { rl.close(); res(r.trim() || padrao) })
    rl.on('SIGINT', () => { rl.close(); console.log(); process.exit(130) })
  })
}
/* Senha sem aparecer na tela (asteriscos). Sem terminal, lê normal. */
function perguntarSenha(q) {
  if (!process.stdin.isTTY) return perguntar(q)
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    let mudo = false
    rl._writeToOutput = (s) => { rl.output.write(mudo ? s.replace(/[^\r\n]/g, '*') : s) }
    rl.question(`  ${q}: `, (r) => { rl.close(); process.stdout.write('\n'); res(r) })
    mudo = true
    rl.on('SIGINT', () => { rl.close(); console.log(); process.exit(130) })
  })
}

function detectarIdioma() {
  const l = (Intl.DateTimeFormat().resolvedOptions().locale || process.env.LANG || '').toLowerCase()
  return l.startsWith('pt') ? 'pt' : l.startsWith('es') ? 'es' : 'en'
}

async function configurar({ primeira }) {
  const atual = lerEnv(ARQ.config)
  const estado = lerEstado()
  console.log()
  say('1) English   2) Português   3) Español')
  const padrao = { en: '1', pt: '2', es: '3' }[estado.idioma || detectarIdioma()]
  const l = await perguntar('>', padrao)
  LANG = { 1: 'en', 2: 'pt', 3: 'es' }[l] || 'en'
  estado.idioma = LANG
  console.log()
  if (primeira) { say(m('primeira')); console.log() }

  const empresa = await perguntar(m('empresa'), atual.EMPRESA_NOME || '')
  let email = ''
  while (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    email = await perguntar(m('email'), (atual.ADMIN_EMAILS || '').split(',')[0])
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) say(m('email_ruim'))
  }
  let senha = ''
  for (;;) {
    senha = await perguntarSenha(m('senha'))
    if (!senha && atual.ADMIN_SENHA) { senha = atual.ADMIN_SENHA; break } // Enter mantém a senha atual
    if (senha.length < 8) { say(m('senha_curta')); continue }
    if (await perguntarSenha(m('senha2')) !== senha) { say(m('senha_diff')); continue }
    break
  }

  const valores = {
    EMPRESA_NOME: empresa || 'Minha Empresa',
    ADMIN_EMAILS: [email, ...(atual.ADMIN_EMAILS || '').split(',').map((s) => s.trim()).filter((s) => s && s !== email)].join(','),
    ADMIN_SENHA: senha,
    IDIOMA_PADRAO: LANG,
    JWT_SECRET: atual.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
    HQ_PROXY_SECRET: atual.HQ_PROXY_SECRET || crypto.randomBytes(32).toString('hex'),
  }
  // região de partida: a do computador (dá pra mudar no painel)
  const loc = Intl.DateTimeFormat().resolvedOptions()
  // o país do locale só vale se o idioma bate (sistema em inglês num PC do Brasil diz "US")
  const [idiomaSis, pais] = (loc.locale || '').split('-')
  if (!atual.PAIS_PADRAO && idiomaSis === LANG && /^[A-Z]{2}$/.test(pais || '')) valores.PAIS_PADRAO = pais
  if (!atual.FUSO_PADRAO && loc.timeZone) valores.FUSO_PADRAO = loc.timeZone

  if (!primeira) {
    const b = await perguntar(m('banco_q'), atual.MONGODB_URI ? '2' : '1')
    if (b === '2') {
      const uri = await perguntar(m('banco_link'), atual.MONGODB_URI || '')
      if (/^mongodb(\+srv)?:\/\//.test(uri)) valores.MONGODB_URI = uri
    } else if (atual.MONGODB_URI) valores.MONGODB_URI = ''
    const r = await perguntar(m('rede_q'), atual.NOMADE_REDE === '1' ? 's' : 'n')
    valores.NOMADE_REDE = /^[sy]/i.test(r) ? '1' : ''
  }

  gravarEnv(ARQ.config, valores)
  gravarEstado(estado)
  console.log()
  ok(m('salvo', { f: ARQ.config }))
}

/* ── rede da empresa: proxy e certificados ───────────────────────────────── */
/* O Node não lê o proxy do sistema sozinho. No Windows e no Mac o proxy da
   empresa costuma estar só nas configurações do sistema, não no ambiente:
   aqui ele vira HTTPS_PROXY pro Node (NODE_USE_ENV_PROXY) e pro curl. */
function detectarProxy() {
  const doEnv = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
  if (doEnv) return { url: doEnv, de: 'HTTPS_PROXY' }
  try {
    if (WIN) {
      const s = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      const pac = /AutoConfigURL\s+REG_SZ\s+(\S+)/i.exec(s)?.[1]
      const ligado = /ProxyEnable\s+REG_DWORD\s+0x1/i.test(s)
      let srv = /ProxyServer\s+REG_SZ\s+(\S+)/i.exec(s)?.[1]
      if (ligado && srv) {
        // "http=proxy:8080;https=proxy:8443" ou só "proxy:8080"
        if (srv.includes('=')) srv = /https=([^;]+)/i.exec(srv)?.[1] || /http=([^;]+)/i.exec(srv)?.[1] || ''
        if (srv) return { url: /^\w+:\/\//.test(srv) ? srv : `http://${srv}`, de: 'Windows' }
      }
      if (pac) return { pac }
    } else if (MAC) {
      const s = execFileSync('scutil', ['--proxy'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      const v = (k) => new RegExp(`${k} : (\\S+)`).exec(s)?.[1]
      if (v('HTTPSEnable') === '1' && v('HTTPSProxy')) return { url: `http://${v('HTTPSProxy')}:${v('HTTPSPort') || 80}`, de: 'macOS' }
      if (v('HTTPEnable') === '1' && v('HTTPProxy')) return { url: `http://${v('HTTPProxy')}:${v('HTTPPort') || 80}`, de: 'macOS' }
      if (v('ProxyAutoConfigEnable') === '1') return { pac: v('ProxyAutoConfigURLString') || 'PAC' }
    }
  } catch { /* sem reg/scutil */ }
  return {}
}
const suporta = (flag) => spawnSync(process.execPath, [flag, '-e', '0'], { stdio: 'ignore' }).status === 0
const SEM_PROXY = 'localhost,127.0.0.1,::1'

/* ── portas ──────────────────────────────────────────────────────────────── */
const consegueEscutar = (p, host) => new Promise((res) => {
  const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true)))
  s.listen(p, host)
})
/* Livre de verdade: ninguém atende nela (IPv4 nem IPv6) e dá pra escutar.
   No Mac, um programa em *:5004 não impede outro de pegar 127.0.0.1:5004,
   e aí o "localhost" do navegador cai no programa errado. */
async function portaLivre(p) {
  if (await conecta(p) || await conecta(p, '::1')) return false
  return await consegueEscutar(p, '127.0.0.1') && await consegueEscutar(p)
}
async function escolherPorta(pref, evitar) {
  for (let p = pref; p < pref + 40; p++) if (!evitar.includes(p) && await portaLivre(p)) return p
  return 0
}
const conecta = (p, host = '127.0.0.1') => new Promise((res) => {
  const s = net.connect(p, host).once('connect', () => { s.destroy(); res(true) }).once('error', () => res(false))
  s.setTimeout(1500, () => { s.destroy(); res(false) })
})
async function responde(url, ms = 1500) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return r.ok ? await r.json().catch(() => ({})) : null } catch { return null }
}

/* ── downloads (curl: usa o proxy e, no Windows, os certificados do sistema) ── */
const temCurl = () => spawnSync(WIN ? 'curl.exe' : 'curl', ['--version'], { stdio: 'ignore' }).status === 0
function curl(args, opts = {}) {
  return spawnSync(WIN ? 'curl.exe' : 'curl', ['-fL', '--retry', '2', '--connect-timeout', '20', ...args], { stdio: opts.stdio || ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 28, env: process.env })
}
async function baixar(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  if (temCurl()) return curl(['--progress-bar', '-o', dest, url], { stdio: ['ignore', 'inherit', 'inherit'] }).status === 0
  try {
    const r = await fetch(url)
    if (!r.ok) return false
    fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()))
    return true
  } catch { return false }
}
async function baixarTexto(url) {
  if (temCurl()) { const r = curl(['-sS', url]); return r.status === 0 ? r.stdout.toString() : null }
  try { const r = await fetch(url); return r.ok ? await r.text() : null } catch { return null }
}
async function baixarFaixa(url, a, b) {
  if (temCurl()) { const r = curl(['-sS', '-r', `${a}-${b}`, url]); return r.status === 0 ? r.stdout : null }
  try { const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}` } }); return r.status === 206 ? Buffer.from(await r.arrayBuffer()) : null } catch { return null }
}
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')

/* ── MongoDB portátil ────────────────────────────────────────────────────── */
function alvoMongo() {
  const arm = process.arch === 'arm64'
  if (MAC) return { url: `https://fastdl.mongodb.org/osx/mongodb-macos-${arm ? 'arm64' : 'x86_64'}-${MONGO_VER}.tgz`, mb: arm ? 82 : 86 }
  if (WIN) return { url: `https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-${MONGO_VER}.zip`, mb: 30, soExe: true }
  if (process.platform !== 'linux') return null
  let id = '', ver = ''
  try {
    const s = fs.readFileSync('/etc/os-release', 'utf8')
    id = /^ID="?([^"\n]+)/m.exec(s)?.[1] || ''
    ver = /^VERSION_ID="?([^"\n]+)/m.exec(s)?.[1] || ''
    if (!['ubuntu', 'debian', 'rhel', 'centos', 'rocky', 'almalinux', 'fedora'].includes(id)) {
      const like = /^ID_LIKE="?([^"\n]+)/m.exec(s)?.[1] || ''
      if (/ubuntu/.test(like)) id = 'ubuntu'; else if (/debian/.test(like)) id = 'debian'; else if (/rhel|fedora/.test(like)) id = 'rhel'
    }
  } catch { /* sem os-release */ }
  const maj = parseInt(ver, 10)
  const alvo = id === 'ubuntu' ? (maj >= 24 ? 'ubuntu2404' : maj >= 22 ? 'ubuntu2204' : 'ubuntu2004')
    : id === 'debian' ? 'debian12'
      : ['rhel', 'centos', 'rocky', 'almalinux', 'fedora'].includes(id) ? (maj >= 10 ? 'rhel10' : maj >= 9 ? 'rhel93' : 'rhel8')
        : null
  if (!alvo) return null
  return { url: `https://fastdl.mongodb.org/linux/mongodb-linux-${arm ? 'aarch64' : 'x86_64'}-${alvo}-${MONGO_VER}.tgz`, mb: 106 }
}
const pastaMongod = path.join(ARQ.runtime, `mongodb-${MONGO_VER}`)
const binMongod = path.join(pastaMongod, WIN ? 'mongod.exe' : 'mongod')

function acharMongod(cfg) {
  if (cfg.MONGOD_PATH && fs.existsSync(cfg.MONGOD_PATH)) return cfg.MONGOD_PATH
  if (fs.existsSync(binMongod)) return binMongod
  const r = spawnSync(WIN ? 'where' : 'which', ['mongod'], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() || null : null
}

/* No Windows o zip tem 809 MB (quase tudo símbolo de debug). O zip deixa ler
   um arquivo só: busca o índice no fim, depois só os ~30 MB do mongod.exe,
   e confere o CRC32 que o índice traz. */
async function mongodDoZip(url, dest) {
  const head = spawnSync(WIN ? 'curl.exe' : 'curl', ['-fsSLI', url], { encoding: 'utf8' })
  // com redirecionamento vêm vários cabeçalhos: vale o último
  const total = Number([...String(head.stdout || '').matchAll(/content-length:\s*(\d+)/gi)].pop()?.[1] || 0)
  if (!total) return false
  const fim = await baixarFaixa(url, Math.max(0, total - 65557), total - 1)
  if (!fim) return false
  const e = fim.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (e < 0) return false
  const cdTam = fim.readUInt32LE(e + 12), cdIni = fim.readUInt32LE(e + 16)
  const cd = await baixarFaixa(url, cdIni, cdIni + cdTam - 1)
  if (!cd) return false
  let p = 0, alvo = null
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const nl = cd.readUInt16LE(p + 28), el = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32)
    const nome = cd.subarray(p + 46, p + 46 + nl).toString()
    if (nome.endsWith('/bin/mongod.exe')) alvo = { metodo: cd.readUInt16LE(p + 10), crc: cd.readUInt32LE(p + 16), comp: cd.readUInt32LE(p + 20), local: cd.readUInt32LE(p + 42) }
    p += 46 + nl + el + cl
  }
  if (!alvo) return false
  const lh = await baixarFaixa(url, alvo.local, alvo.local + 29)
  if (!lh || lh.readUInt32LE(0) !== 0x04034b50) return false
  const ini = alvo.local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28)
  const tmp = `${dest}.parte`
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  let okDl = false
  if (temCurl()) okDl = curl(['--progress-bar', '-r', `${ini}-${ini + alvo.comp - 1}`, '-o', tmp, url], { stdio: ['ignore', 'inherit', 'inherit'] }).status === 0
  else { const b = await baixarFaixa(url, ini, ini + alvo.comp - 1); if (b) fs.writeFileSync(tmp, b); okDl = !!b }
  if (!okDl || fs.statSync(tmp).size !== alvo.comp) { fs.rmSync(tmp, { force: true }); return false }
  const bruto = fs.readFileSync(tmp)
  const dados = alvo.metodo === 8 ? zlib.inflateRawSync(bruto) : bruto
  fs.rmSync(tmp, { force: true })
  if (zlib.crc32(dados) >>> 0 !== alvo.crc >>> 0) return false
  fs.writeFileSync(dest, dados)
  return true
}

/* Mac e Linux: o .tgz inteiro, conferido com o .sha256 do próprio MongoDB. */
async function mongodDoTgz(url, dest) {
  const arq = path.join(ARQ.runtime, path.basename(url))
  // quem baixou pelo navegador pode ter deixado em Downloads
  const noDownloads = path.join(os.homedir(), 'Downloads', path.basename(url))
  if (!fs.existsSync(arq) && fs.existsSync(noDownloads)) fs.copyFileSync(noDownloads, arq)
  if (!fs.existsSync(arq) && !await baixar(url, arq)) return false
  const esperado = (await baixarTexto(`${url}.sha256`) || '').trim().split(/\s+/)[0]
  if (esperado && sha256(arq) !== esperado) { fs.rmSync(arq, { force: true }); return false }
  const tmp = path.join(ARQ.runtime, `mongo-tmp-${process.pid}`)
  fs.mkdirSync(tmp, { recursive: true })
  const r = spawnSync('tar', ['-xzf', arq, '-C', tmp], { stdio: 'inherit' })
  if (r.status !== 0) return false
  const sub = fs.readdirSync(tmp).find((d) => fs.existsSync(path.join(tmp, d, 'bin', 'mongod')))
  if (!sub) return false
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.renameSync(path.join(tmp, sub, 'bin', 'mongod'), dest)
  fs.chmodSync(dest, 0o755)
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.rmSync(arq, { force: true })
  return true
}

async function garantirMongod(cfg) {
  const achado = acharMongod(cfg)
  if (achado) return achado
  const alvo = alvoMongo()
  if (!alvo) { bad(m('mongo_linux')); return null }
  // o Windows também aceita o zip inteiro baixado pelo navegador
  const zipManual = [path.join(ARQ.runtime, path.basename(alvo.url)), path.join(os.homedir(), 'Downloads', path.basename(alvo.url))].find((f) => fs.existsSync(f))
  if (WIN && zipManual) {
    const tmp = path.join(ARQ.runtime, `mongo-tmp-${process.pid}`)
    fs.mkdirSync(tmp, { recursive: true })
    if (spawnSync('tar.exe', ['-xf', zipManual, '-C', tmp], { stdio: 'inherit' }).status === 0) {
      const sub = fs.readdirSync(tmp).find((d) => fs.existsSync(path.join(tmp, d, 'bin', 'mongod.exe')))
      if (sub) { fs.mkdirSync(pastaMongod, { recursive: true }); fs.renameSync(path.join(tmp, sub, 'bin', 'mongod.exe'), binMongod) }
    }
    fs.rmSync(tmp, { recursive: true, force: true })
    if (fs.existsSync(binMongod)) return binMongod
  }
  console.log()
  say(m('mongo_baixa', { v: MONGO_VER, mb: alvo.mb }))
  const deu = alvo.soExe ? await mongodDoZip(alvo.url, binMongod) : await mongodDoTgz(alvo.url, binMongod)
  if (deu) return binMongod
  console.log()
  bad(m('mongo_sem_download'))
  say(m('mongo_manual', { url: alvo.url, dest: ARQ.runtime }))
  return null
}

/* Pergunta um link do Atlas quando o banco local não deu. */
async function oferecerAtlas() {
  console.log()
  say(m('mongo_atlas'))
  const uri = await perguntar(m('mongo_link_q'))
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) return null
  gravarEnv(ARQ.config, { MONGODB_URI: uri })
  return uri
}

const ultimasLinhas = (f, n = 12) => { try { return fs.readFileSync(f, 'utf8').trimEnd().split(/\r?\n/).slice(-n) } catch { return [] } }
const vivo = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }

async function subirMongo(cfg, estado) {
  // ficou ligado de uma sessão que caiu? reaproveita
  if (estado.mongoPid && estado.portas?.mongo && vivo(estado.mongoPid) && await conecta(estado.portas.mongo)) {
    say(m('mongo_reusa'))
    return { uri: `mongodb://127.0.0.1:${estado.portas.mongo}`, pid: estado.mongoPid, proc: null }
  }
  const bin = await garantirMongod(cfg)
  if (!bin) return null
  const porta = await escolherPorta(estado.portas?.mongo || 27027, [])
  fs.mkdirSync(ARQ.mongo, { recursive: true })
  const log = path.join(ARQ.logs, 'mongod.log')
  const proc = spawn(bin, ['--dbpath', ARQ.mongo, '--port', String(porta), '--bind_ip', '127.0.0.1', '--logpath', log, '--logappend'], { stdio: 'ignore', windowsHide: true })
  let saiu = null
  proc.on('exit', (code) => { saiu = code ?? -1 })
  for (let i = 0; i < 120 && saiu === null; i++) {
    if (await conecta(porta)) {
      estado.portas = { ...estado.portas, mongo: porta }
      estado.mongoPid = proc.pid
      gravarEstado(estado)
      return { uri: `mongodb://127.0.0.1:${porta}`, pid: proc.pid, proc }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  console.log()
  // 0xC0000135: falta DLL (o Visual C++ do Windows)
  if (WIN && (saiu === 3221225781 || saiu === -1073741515)) bad(m('mongo_vc'))
  else { bad(m('mongo_falhou', { f: log })); for (const l of ultimasLinhas(log, 8)) say(`    ${l.slice(0, 200)}`) }
  try { proc.kill() } catch { /* já foi */ }
  return null
}

async function pararMongo(mongo) {
  if (!mongo?.pid) return
  try {
    // desligamento limpo pelo próprio driver (no Windows não existe SIGTERM)
    const { MongoClient } = await import(new URL('../node_modules/mongodb/lib/index.js', import.meta.url))
    const c = new MongoClient(mongo.uri, { serverSelectionTimeoutMS: 3000 })
    await c.db('admin').command({ shutdown: 1 }).catch(() => {})
    await c.close().catch(() => {})
  } catch { /* sem driver: cai no kill */ }
  for (let i = 0; i < 40 && vivo(mongo.pid); i++) await new Promise((r) => setTimeout(r, 250))
  if (vivo(mongo.pid)) try { process.kill(mongo.pid) } catch { /* já foi */ }
}

/* ── dependências (só quando roda de um clone do repositório) ───────────── */
function npm(args, cwd) {
  const bin = path.join(path.dirname(process.execPath), WIN ? 'npm.cmd' : 'npm')
  const cmd = fs.existsSync(bin) ? bin : (WIN ? 'npm.cmd' : 'npm')
  return spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: WIN, env: process.env }).status === 0
}
function garantirDependencias() {
  if (!fs.existsSync(path.join(RAIZ, 'node_modules', 'express'))) {
    say(m('deps'))
    if (!npm(['ci', '--omit=dev', '--no-audit', '--no-fund'], RAIZ)) { bad(m('sem_npm', { url: RELEASES })); return false }
  }
  if (!fs.existsSync(path.join(RAIZ, 'client', 'admin', 'dist', 'index.html'))) {
    say(m('painel_build'))
    const pa = path.join(RAIZ, 'client', 'admin')
    if (!npm(['ci', '--no-audit', '--no-fund'], pa) || !npm(['run', 'build'], pa)) { bad(m('sem_npm', { url: RELEASES })); return false }
  }
  return true
}

/* ── diagnóstico ─────────────────────────────────────────────────────────── */
async function alcanca(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(7000), redirect: 'manual' })
    if (r.status === 407) return 'proxy_senha'
    if ([403, 451].includes(r.status) && /html/i.test(r.headers.get('content-type') || '')) return 'filtro'
    return null
  } catch (e) {
    const c = String(e?.cause?.code || e?.code || ''), msg = String(e?.cause?.message || e?.message || '')
    if (e?.name === 'TimeoutError' || /TIMEOUT|ETIMEDOUT/.test(c)) return 'lento'
    if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') return 'dns'
    if (/CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)|ERR_TLS/i.test(`${c} ${msg}`)) return 'certificado'
    return 'bloqueado'
  }
}
function acharNavegador() {
  const c = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
    ...['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'].flatMap((v) => process.env[v] ? [
      `${process.env[v]}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env[v]}\\Microsoft\\Edge\\Application\\msedge.exe`] : []),
  ]
  const f = c.find((p) => { try { return fs.existsSync(p) } catch { return false } })
  return f ? (/edge/i.test(f) ? 'Edge' : /chromium/i.test(f) ? 'Chromium' : 'Chrome') : null
}

async function diagnostico({ completo, proxy, comMongo }) {
  console.log()
  say(m('aqui'))
  const linhas = []
  const v = process.versions.node
  linhas.push(['ok', m('d_node', { v })])
  try {
    const st = fs.statfsSync(DADOS)
    const gb = Math.round((st.bavail * st.bsize) / 1e9)
    linhas.push([gb < 2 ? 'warn' : 'ok', m(gb < 2 ? 'd_pouco' : 'd_dados', { d: DADOS, gb })])
  } catch { /* statfs antigo */ }
  if (proxy?.url) linhas.push(['ok', m('d_proxy', { p: proxy.url.replace(/\/\/[^@/]*@/, '//***@'), de: proxy.de })])
  if (proxy?.pac) linhas.push(['warn', m('d_pac', { f: ARQ.config })])
  if (process.execArgv.includes('--use-system-ca')) { if (completo) linhas.push(['ok', m('d_ca')]) } else linhas.push(['warn', m('d_ca_nao', { d: ARQ.runtime })])

  const hosts = [
    ['o_ia', 'api.anthropic.com'], ['o_ia', 'api.openai.com'], ['o_ia', 'generativelanguage.googleapis.com'],
    ['o_pag', 'api.mercadopago.com'], ['o_at', 'api.mercadolibre.com'], ['o_at', 'partner.shopeemobile.com'], ['o_mail', 'api.resend.com'],
    ...(comMongo ? [['o_dl', 'fastdl.mongodb.org']] : []),
  ]
  const res = await Promise.all(hosts.map(([, h]) => alcanca(`https://${h}/`)))
  hosts.forEach(([o, h], i) => {
    if (res[i]) linhas.push(['bad', m('d_falha', { o: m(o), h, porque: m(`p_${res[i]}`) })])
    else if (completo) linhas.push(['ok', m('d_ok', { o: m(o), h })])
  })

  const ollama = await responde('http://127.0.0.1:11434/api/tags', 1500)
  if (ollama) linhas.push(['ok', m('d_ollama', { u: 'http://127.0.0.1:11434' })])
  else if (completo) linhas.push(['warn', m('d_ollama_nao')])
  const nav = acharNavegador()
  if (nav) { if (completo) linhas.push(['ok', m('d_nav', { n: nav })]) } else linhas.push(['warn', m('d_nav_nao')])
  linhas.push(['warn', m('d_links')])
  if (completo) linhas.push(['warn', m('d_sono')])

  for (const [k, s] of linhas) (k === 'ok' ? ok : k === 'warn' ? warn : bad)(s)
  if (!completo) { console.log(); say(m('diag_dica')) }
  return { ollama: !!ollama }
}

/* ── processos do app ────────────────────────────────────────────────────── */
function abrirNavegador(url) {
  if (process.env.NOMADE_SEM_NAVEGADOR === '1') return
  const [cmd, args] = WIN ? ['explorer.exe', [url]] : MAC ? ['open', [url]] : ['xdg-open', [url]]
  try { spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref() } catch { /* sem navegador */ }
}
function ipDaRede() {
  for (const lista of Object.values(os.networkInterfaces())) for (const i of lista || []) if (i.family === 'IPv4' && !i.internal) return i.address
  return '127.0.0.1'
}
function girarLog(f) { try { if (fs.statSync(f).size > 5e6) fs.renameSync(f, `${f}.1`) } catch { /* não existe */ } }

async function iniciar() {
  if (!fs.existsSync(ARQ.config)) await configurar({ primeira: true })
  LANG = lerEstado().idioma || detectarIdioma()
  const cfg = lerEnv(ARQ.config)
  const est = lerEstado()

  // já está rodando (dois cliques duas vezes)?
  // (o pid do lançador vivo prova que é este Nomade, não outro na mesma porta)
  const pp = est.portas?.painel
  if (pp && est.lancadorPid && vivo(est.lancadorPid) && (await responde(`http://127.0.0.1:${pp}/health`))?.service) {
    const url = cfg.PAINEL_URL || `http://localhost:${pp}`
    ok(m('ja', { url })); abrirNavegador(url); return
  }

  if (!garantirDependencias()) { process.exitCode = 1; return }

  const proxy = detectarProxy()
  const diag = diagnostico({ completo: false, proxy, comMongo: !cfg.MONGODB_URI && !acharMongod(cfg) })

  // portas: tenta as da última vez, depois as padrão, depois a próxima livre
  const rede = cfg.NOMADE_REDE === '1'
  const pPainel = await escolherPorta(est.portas?.painel || 5004, [])
  const pServer = await escolherPorta(est.portas?.server || 5002, [pPainel])
  const { ollama } = await diag
  console.log()
  if (pPainel !== (est.portas?.painel || 5004)) say(m('portas', { a: est.portas?.painel || 5004, b: pPainel }))
  if (pServer !== (est.portas?.server || 5002)) say(m('portas', { a: est.portas?.server || 5002, b: pServer }))

  fs.mkdirSync(ARQ.logs, { recursive: true })
  let mongo = null
  let uri = cfg.MONGODB_URI
  if (!uri) {
    mongo = await subirMongo(cfg, est)
    if (!mongo) { uri = await oferecerAtlas(); if (!uri) { process.exitCode = 1; return } } else { uri = mongo.uri; say(m('mongo_ok')) }
  }

  const host = rede ? ipDaRede() : 'localhost'
  const painelUrl = cfg.PAINEL_URL || `http://${host}:${pPainel}`
  const baseUrl = cfg.BASE_URL || `http://${host}:${pServer}`
  const estadoNovo = { ...lerEstado(), portas: { ...lerEstado().portas, painel: pPainel, server: pServer } }
  gravarEstado(estadoNovo)

  const flags = process.execArgv.filter((f) => f === '--use-system-ca')
  const env = {
    ...process.env, ...cfg,
    NODE_ENV: 'production',
    NOMADE_LOCAL: '1',
    MONGODB_URI: uri,
    PORT: String(pServer),
    AI_SERVICE_PORT: String(pPainel),
    ADMIN_UPSTREAM: `http://127.0.0.1:${pServer}`,
    BASE_URL: baseUrl,
    PAINEL_URL: painelUrl,
    BIND_HOST: rede ? '' : (cfg.BIND_HOST || '127.0.0.1'),
    ...(ollama && !cfg.OLLAMA_URL ? { OLLAMA_URL: 'http://127.0.0.1:11434' } : {}),
  }
  delete env.NOMADE_FILHO

  console.log()
  say(m('subindo'))
  let parando = false
  const servicos = {
    server: { arq: 'server.js', log: path.join(ARQ.logs, 'server.log'), saude: `http://127.0.0.1:${pServer}/health`, quedas: [] },
    office: { arq: 'ai-service.js', log: path.join(ARQ.logs, 'office.log'), saude: `http://127.0.0.1:${pPainel}/health`, quedas: [] },
  }
  const subir = (nome) => {
    const s = servicos[nome]
    girarLog(s.log)
    const fd = fs.openSync(s.log, 'a')
    s.proc = spawn(process.execPath, [...flags, s.arq], { cwd: RAIZ, env, stdio: ['ignore', fd, fd], windowsHide: true })
    fs.closeSync(fd)
    s.proc.on('exit', (code, sinal) => {
      if (parando || sinal === 'SIGINT' || sinal === 'SIGTERM' || sinal === 'SIGHUP') return
      console.log()
      warn(m('caiu', { s: nome, f: s.log }))
      for (const l of ultimasLinhas(s.log, 10)) say(`    ${l.slice(0, 200)}`)
      s.quedas = [...s.quedas.filter((t) => Date.now() - t < 60_000), Date.now()]
      if (s.quedas.length > 3) { bad(m('desisto', { s: nome, f: s.log })); desligar(1); return }
      say(m('reinicia', { s: nome }))
      setTimeout(() => !parando && subir(nome), 1500)
    })
  }

  const desligar = async (code = 0) => {
    if (parando) return
    parando = true
    console.log()
    say(m('parando'))
    for (const s of Object.values(servicos)) try { s.proc?.kill() } catch { /* já foi */ }
    await new Promise((r) => setTimeout(r, 800))
    await pararMongo(mongo)
    const e = lerEstado(); delete e.mongoPid; delete e.lancadorPid; gravarEstado(e)
    say(m('parado', { d: DADOS }))
    process.exit(code)
  }
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => desligar(0))

  subir('server')
  subir('office')
  for (const [nome, s] of Object.entries(servicos)) {
    let deu = false
    for (let i = 0; i < 180 && !parando; i++) {
      if (await responde(s.saude)) { deu = true; break }
      await new Promise((r) => setTimeout(r, 500))
    }
    if (!deu && !parando) { bad(m('nao_subiu', { s: nome, n: 90, f: s.log })); return desligar(1) }
  }

  gravarEstado({ ...lerEstado(), lancadorPid: process.pid })
  console.log()
  ok(m('pronto', { url: painelUrl }))
  say(`  ${m('entrar', { email: (cfg.ADMIN_EMAILS || '').split(',')[0] })}`)
  say(`  ${m('deixe')}`)
  console.log()
  abrirNavegador(painelUrl)
}

/* ── entrada ─────────────────────────────────────────────────────────────── */
/* Roda a si mesmo de novo com o que a rede da empresa pede: certificados do
   sistema (--use-system-ca) e o proxy do sistema como HTTPS_PROXY. Assim o
   diagnóstico daqui vê a rede igual ao server e ao office. */
function reexecutar() {
  const flags = suporta('--use-system-ca') ? ['--use-system-ca'] : []
  const env = { ...process.env, NOMADE_FILHO: '1' }
  const proxy = detectarProxy()
  if (proxy.url) {
    env.HTTPS_PROXY = env.HTTPS_PROXY || proxy.url; env.https_proxy = env.https_proxy || proxy.url
    env.HTTP_PROXY = env.HTTP_PROXY || proxy.url; env.http_proxy = env.http_proxy || proxy.url
  }
  if (env.HTTPS_PROXY || env.HTTP_PROXY) {
    env.NODE_USE_ENV_PROXY = '1'
    const np = [env.NO_PROXY || env.no_proxy, SEM_PROXY].filter(Boolean).join(',')
    env.NO_PROXY = np; env.no_proxy = np
  }
  const c = spawn(process.execPath, [...flags, ESTE, ...process.argv.slice(2)], { stdio: 'inherit', env })
  // o filho recebe o Ctrl+C sozinho (mesmo terminal) e desliga tudo
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => {})
  c.on('exit', (code) => process.exit(code ?? 0))
}

async function main() {
  fs.mkdirSync(DADOS, { recursive: true })
  LANG = lerEstado().idioma || detectarIdioma()
  const cmd = (process.argv[2] || '').toLowerCase().replace(/^-+/, '')
  console.log()
  say(m('titulo'))
  if (['ajuda', 'help', 'h'].includes(cmd)) { console.log(); console.log(m('ajuda').replace(/^/gm, '  ')); return }
  if (['onde', 'where', 'dados'].includes(cmd)) { say(DADOS); return }
  if (['configurar', 'config', 'setup'].includes(cmd)) return configurar({ primeira: !fs.existsSync(ARQ.config) })
  if (['diagnostico', 'diagnóstico', 'doctor', 'check'].includes(cmd)) {
    const cfg = lerEnv(ARQ.config)
    await diagnostico({ completo: true, proxy: detectarProxy(), comMongo: !cfg.MONGODB_URI && !acharMongod(cfg) })
    console.log(); return
  }
  return iniciar()
}

if (process.env.NOMADE_FILHO !== '1') reexecutar()
else main().catch((e) => { console.error(e); process.exit(1) })
