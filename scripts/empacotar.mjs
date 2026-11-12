#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
 * Monta o zip da página de Releases: o Nomade pronto pra rodar no computador,
 * sem Docker, sem npm e sem build na máquina de quem baixa.
 *
 *   node scripts/empacotar.mjs            → release/nomade-business-<versão>.zip
 *   node scripts/empacotar.mjs --sem-build  (usa o client/admin/dist que já existe)
 *
 * Vai dentro: o código do servidor, o painel já montado, node_modules de
 * produção (sem os opcionais: o binário de 260 MB do claude-agent-sdk é do
 * CLI, não do servidor) e os lançadores Nomade.command / Nomade.cmd na raiz.
 * Um zip serve pros três sistemas: o Node e o MongoDB de cada um são baixados
 * na primeira vez que abre (local/iniciar.mjs).
 * ══════════════════════════════════════════════════════════════════════════ */
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const versao = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).version
const nome = `nomade-business-${versao}`
const SAIDA = path.join(RAIZ, 'release')
const PASTA = path.join(SAIDA, nome)
const ZIP = path.join(SAIDA, `${nome}.zip`)

const rodar = (cmd, args, cwd = RAIZ) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) { console.error(`✗ ${cmd} ${args.join(' ')}`); process.exit(1) }
}

// 1. painel
const painel = path.join(RAIZ, 'client', 'admin')
if (!process.argv.includes('--sem-build')) {
  rodar('npm', ['ci', '--no-audit', '--no-fund'], painel)
  rodar('npm', ['run', 'build'], painel)
}
if (!fs.existsSync(path.join(painel, 'dist', 'index.html'))) { console.error('✗ client/admin/dist não existe'); process.exit(1) }

// 2. cópia do que roda
fs.rmSync(PASTA, { recursive: true, force: true })
fs.rmSync(ZIP, { force: true })
fs.mkdirSync(PASTA, { recursive: true })
const FORA = new Set(['node_modules', '.DS_Store', 'time.json'])
const copiar = (de, para = de) => fs.cpSync(path.join(RAIZ, de), path.join(PASTA, para), {
  recursive: true,
  filter: (src) => !FORA.has(path.basename(src)),
})
for (const f of ['package.json', 'package-lock.json', 'server.js', 'ai-service.js', 'LICENSE', 'README.md', '.env.example']) copiar(f)
for (const d of ['lib', 'agents', 'config', 'cli', 'docs']) copiar(d)
copiar('client/admin/dist')
fs.mkdirSync(path.join(PASTA, 'local'))
copiar('local/iniciar.mjs')
copiar('local/nomade.sh')
copiar('local/Nomade.command', 'Nomade.command')
copiar('local/Nomade.cmd', 'Nomade.cmd')
fs.writeFileSync(path.join(PASTA, 'LEIA-ME.txt'), [
  'Nomade Business',
  '',
  'English',
  '  Mac:      double-click "Nomade.command" (first time: right-click > Open > Open).',
  '  Windows:  double-click "Nomade.cmd" (if Windows warns: More info > Run anyway).',
  '  Linux:    ./local/nomade.sh',
  '  The first time it downloads Node.js and the database (once), asks four questions',
  '  and opens the panel in the browser. Keep the window open while you use it.',
  '  Guide: docs/START-HERE.md',
  '',
  'Português',
  '  Mac:      dois cliques em "Nomade.command" (na primeira vez: botão direito > Abrir > Abrir).',
  '  Windows:  dois cliques em "Nomade.cmd" (se o Windows avisar: Mais informações > Executar assim mesmo).',
  '  Linux:    ./local/nomade.sh',
  '  Na primeira vez ele baixa o Node.js e o banco (uma vez só), faz quatro perguntas',
  '  e abre o painel no navegador. Deixe a janela aberta enquanto usa.',
  '  Guia: docs/COMECE-AQUI.md',
  '',
  'Español',
  '  Mac:      doble clic en "Nomade.command" (la primera vez: clic derecho > Abrir > Abrir).',
  '  Windows:  doble clic en "Nomade.cmd" (si Windows avisa: Más información > Ejecutar de todas formas).',
  '  Linux:    ./local/nomade.sh',
  '  La primera vez descarga Node.js y la base (una sola vez), hace cuatro preguntas',
  '  y abre el panel en el navegador. Deja la ventana abierta mientras lo usas.',
  '  Guía: docs/EMPIEZA-AQUI.md',
  '',
].join('\r\n'))
for (const f of ['Nomade.command', 'local/nomade.sh', 'local/iniciar.mjs']) fs.chmodSync(path.join(PASTA, f), 0o755)

// 3. dependências de produção, sem scripts de instalação e sem opcionais
rodar('npm', ['ci', '--omit=dev', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund'], PASTA)

// 4. zip (guarda a permissão de execução dos lançadores)
rodar('zip', ['-qry', '-X', ZIP, nome], SAIDA)
const tam = fs.statSync(ZIP).size
const hash = crypto.createHash('sha256').update(fs.readFileSync(ZIP)).digest('hex')
fs.writeFileSync(`${ZIP}.sha256`, `${hash}  ${path.basename(ZIP)}\n`)
fs.rmSync(PASTA, { recursive: true, force: true })
console.log(`✓ ${path.relative(RAIZ, ZIP)}  ${(tam / 1e6).toFixed(1)} MB`)
console.log(`  sha256 ${hash}`)
