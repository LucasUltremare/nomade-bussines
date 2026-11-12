/* ═══ PASTAS ═════════════════════════════════════════════════════════════
   Onde mora o clone de cada board, NESTA máquina.

   Faz mais sentido aqui que na web: quem sabe o caminho é quem está na
   máquina, e o CLI está na máquina. Ele consegue até adivinhar — varre a
   pasta de projetos e casa nome de repositório com nome de board.

     nomade pastas                  o que está configurado
     nomade pastas --detectar       procura os clones e propõe
     nomade pastas <board> <path>   define na mão
*/
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import { get, patch } from './api.mjs'
import { machineId } from './config.mjs'
import { cabecalho, dim, bold, azul, verde, gold, coral, info, erro } from './ui.mjs'

// onde as pessoas guardam projeto. A primeira que existir manda.
const CANDIDATAS = () => [
  process.env.NOMADE_PROJETOS,
  path.join(os.homedir(), 'Documents', 'GitHub'),
  path.join(os.homedir(), 'GitHub'),
  path.join(os.homedir(), 'code'),
  path.join(os.homedir(), 'projetos'),
  process.platform === 'win32' ? 'C:\\code' : null,
  // no Windows o OneDrive costuma sequestrar a pasta Documentos
  process.platform === 'win32' ? path.join(os.homedir(), 'OneDrive', 'Documents', 'GitHub') : null,
  path.join(os.homedir(), 'Documents', 'GitHub'),
  path.join(os.homedir(), 'source', 'repos'),
].filter(Boolean)

const norm = (s) => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '')

/* `nomade setpath Motion` — aponta o board pra ONDE TU ESTÁ.
   É o atalho que a gente usa de verdade: entra na pasta do projeto e roda.
   Sem caminho, usa o diretório atual; com caminho, usa ele. */
export async function setpath(argv) {
  const args = argv.filter(a => !a.startsWith("--"));
  if (!args.length) {
    erro("falta o board.");
    info(dim("  ex:  cd ~/Documents/motion && nomade setpath Motion"));
    info(dim("       nomade setpath \"Loja da Ana\" ~/GitHub/loja-ana\n"));
    return;
  }
  const caminho = args.length > 1 ? args[args.length - 1] : process.cwd();
  const nome = (args.length > 1 ? args.slice(0, -1) : args).join(" ");
  const abs = path.resolve(caminho.replace(/^~(?=$|\/)/, os.homedir()));

  try { await fs.access(abs) } catch { erro(`a pasta ${abs} não existe.`); process.exit(1) }
  // avisa se não parece projeto — mas não impede: pode ser pasta de assets
  const ehRepo = await fs.access(path.join(abs, ".git")).then(() => true).catch(() => false);

  const boards = await get("/api/office/runner-boards");
  const b = boards.find(x => norm(x.nome) === norm(nome))
    || boards.find(x => norm(x.nome).includes(norm(nome)));
  if (!b) {
    erro(`nenhum board casa com "${nome}".`);
    info(dim("  boards: " + boards.map(x => x.nome).join(" · ") + "\n"));
    process.exit(1);
  }

  await patch(`/api/office/boards/${b.id}/pasta`, { pasta: abs, maquinaId: await machineId() });
  info(`${verde("✓")} ${bold(b.nome)} → ${abs}`);
  if (!ehRepo) info(dim("  (não é um repositório git — se era isso que tu queria, beleza)"));
  info(dim(`  a dash já mostra o caminho novo na aba Execução.\n`));
}

export async function pastas(argv) {
  const boards = await get('/api/office/runner-boards')
  const detectar = argv.includes('--detectar')
  const args = argv.filter(a => !a.startsWith('--'))

  // definir na mão: nomade pastas "Loja da Ana" /caminho/do/repo
  if (args.length >= 2) {
    const alvoNome = args.slice(0, -1).join(' ')
    const caminho = args[args.length - 1]
    const b = boards.find(x => norm(x.nome) === norm(alvoNome))
      || boards.find(x => norm(x.nome).includes(norm(alvoNome)))
    if (!b) { erro(`nenhum board casa com "${alvoNome}". Roda \`nomade pastas\` pra ver a lista.`); process.exit(1) }
    const abs = path.resolve(caminho)
    try { await fs.access(abs) } catch { erro(`a pasta ${abs} não existe nesta máquina.`); process.exit(1) }
    await patch(`/api/office/boards/${b.id}/pasta`, { pasta: abs, maquinaId: await machineId() })
    info(`${verde('✓')} ${bold(b.nome)} → ${abs}`)
    return
  }

  if (detectar) return await detectarClones(boards)

  cabecalho('pastas dos boards')
  const comTask = boards.filter(b => b.tasks > 0)
  const resto = boards.filter(b => !b.tasks)
  const linha = async (b) => {
    let marca = dim('sem pasta')
    if (b.pasta) {
      const existe = await fs.access(b.pasta).then(() => true).catch(() => false)
      // a pasta é um campo só, compartilhado: caminho de OUTRA máquina aparece aqui
      marca = existe ? verde(b.pasta) : `${coral(b.pasta)} ${dim('(não existe aqui)')}`
    }
    info(`  ${bold(b.nome.padEnd(22))} ${dim(`${b.tasks} task${b.tasks === 1 ? '' : 's'}`)}  ${marca}`)
  }
  for (const b of comTask) await linha(b)
  if (resto.length) {
    info(dim(`\n  sem task de agent (${resto.length}):`))
    for (const b of resto) await linha(b)
  }
  info(dim(`\n  definir:   ${azul('nomade pastas "Nome do Board" /caminho/do/repo')}`))
  info(dim(`  adivinhar: ${azul('nomade pastas --detectar')}\n`))
}

/* Varre as pastas de projeto da máquina e casa nome de repo com nome de board.
   Só propõe — quem confirma é o sócio, porque um palpite errado manda o agent
   editar o repositório errado. */
async function detectarClones(boards) {
  const bases = []
  for (const c of CANDIDATAS()) {
    if (await fs.access(c).then(() => true).catch(() => false)) bases.push(c)
  }
  if (!bases.length) {
    erro('não achei pasta de projetos nesta máquina.')
    info(dim(`  procurei em: ${CANDIDATAS().join(', ')}`))
    info(dim('  aponta a tua com NOMADE_PROJETOS=/caminho'))
    return
  }

  cabecalho(`procurando clones em ${bases.map(b => dim(b)).join(', ')}`)
  const repos = []
  for (const base of bases) {
    for (const nome of await fs.readdir(base).catch(() => [])) {
      const abs = path.join(base, nome)
      const st = await fs.stat(abs).catch(() => null)
      if (!st?.isDirectory()) continue
      // só o que é repositório de verdade: pasta solta não é projeto
      if (await fs.access(path.join(abs, '.git')).then(() => true).catch(() => false)) repos.push({ nome, abs })
    }
  }
  if (!repos.length) { erro('nenhum repositório git encontrado.'); return }

  const propostas = []
  for (const b of boards) {
    if (b.pasta) continue
    const r = repos.find(x => norm(x.nome) === norm(b.nome))
      || repos.find(x => norm(x.nome).includes(norm(b.nome)) || norm(b.nome).includes(norm(x.nome)))
    if (r) propostas.push({ board: b, repo: r })
  }

  info(`  ${repos.length} repositório(s) · ${propostas.length} palpite(s)\n`)
  if (!propostas.length) {
    info(dim('  nenhum nome de repo bateu com nome de board.'))
    info(dim(`  define na mão: ${azul('nomade pastas "Nome" /caminho')}\n`))
    return
  }
  for (const p of propostas) info(`  ${bold(p.board.nome.padEnd(22))} → ${p.repo.abs}`)

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const r = (await rl.question(`\n  ${gold('confirma?')} [s/N] `)).trim().toLowerCase()
  rl.close()
  if (r !== 's' && r !== 'sim') { info(dim('  nada mudou.\n')); return }

  for (const p of propostas) {
    await patch(`/api/office/boards/${p.board.id}/pasta`, { pasta: p.repo.abs, maquinaId: await machineId() })
    info(`  ${verde('✓')} ${p.board.nome}`)
  }
  info('')
}
