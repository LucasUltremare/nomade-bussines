/* ═══ FERRAMENTAS DE ARQUIVO ═════════════════════════════════════════════
   O que o Claude Agent SDK dá pronto (Read/Edit/Bash/Grep) e que não existe
   em mais lugar nenhum. Escrito à mão pra o motor rodar em GLM.

   A TRAVA QUE IMPORTA: todo caminho é resolvido e conferido contra a raiz do
   projeto. Modelo alucina caminho — "../.ssh/config", "/etc/hosts" — e sem
   isso uma alucinação vira estrago fora da pasta. Nenhuma ferramenta daqui
   toca em nada acima da raiz.

   O shell NÃO é sandbox: o agent precisa de npm, git e remotion de verdade.
   O limite é o mesmo do Claude Code hoje (roda como o usuário, dentro da
   pasta) — a diferença é que aqui está escrito onde ele começa e termina. */
import fs from 'node:fs/promises'
import fsSync from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'

/* O shell muda por sistema: /bin/sh não existe no Windows, e usar ele lá
   fazia TODA chamada de `rodar` falhar com ENOENT — o agent ficava cego,
   tentava de novo, e queimava o teto de passos sem entender por quê. */
const SHELL = process.platform === 'win32'
  ? { cmd: process.env.ComSpec || 'cmd.exe', pre: ['/d', '/s', '/c'] }
  : { cmd: '/bin/sh', pre: ['-c'] }

const TETO_LEITURA = 60_000   // ~15k tokens: acima disso o modelo se perde
const TETO_SAIDA = 12_000     // saída de comando
const TIMEOUT_MS = 180_000    // build e render demoram

/** Resolve dentro da raiz — ou estoura. É a única porta pro disco. */
function dentro(raiz, alvo) {
  const abs = path.resolve(raiz, alvo || '.')
  const rel = path.relative(raiz, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`"${alvo}" está fora do projeto. Só dá pra mexer dentro de ${raiz}`)
  }
  return abs
}

/* Segunda barreira: LINK SIMBÓLICO. `path.resolve` é texto puro e não segue
   link — um atalho dentro do projeto apontando pra fora passaria pela
   checagem acima. Aqui o caminho real é conferido de novo. */
async function dentroReal(raiz, alvo) {
  const abs = dentro(raiz, alvo)
  const raizReal = await fsSync.realpath(raiz).catch(() => raiz)
  // arquivo novo ainda não existe: confere a pasta que vai recebê-lo
  const existe = await fsSync.realpath(abs).catch(() => null)
  const alvoReal = existe || await fsSync.realpath(path.dirname(abs)).catch(() => path.dirname(abs))
  const rel = path.relative(raizReal, alvoReal)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`"${alvo}" aponta pra fora do projeto (link simbólico). Recusado.`)
  }
  return abs
}

const IGNORA = new Set(['node_modules', '.git', 'dist', 'out', '.next', '__pycache__', '.cache', 'conf'])

export function ferramentasDeArquivo(raiz) {
  return {
    ler_arquivo: {
      descricao: 'Lê um arquivo do projeto. Caminho relativo à raiz. Sempre lê antes de editar — editar às cegas sobrescreve o trabalho de outro.',
      schema: {
        type: 'object',
        properties: { caminho: { type: 'string', description: 'ex: PECAS.ts ou src/kit/marca.ts' } },
        required: ['caminho'],
      },
      async executar({ caminho }) {
        const abs = await dentroReal(raiz, caminho)
        const txt = await fs.readFile(abs, 'utf8')
        if (txt.length > TETO_LEITURA) {
          return txt.slice(0, TETO_LEITURA) + `\n\n[cortado: o arquivo tem ${txt.length} chars. Usa buscar_no_projeto pra achar o trecho que importa.]`
        }
        return txt || '(arquivo vazio)'
      },
    },

    escrever_arquivo: {
      descricao: 'Escreve um arquivo INTEIRO, criando ou substituindo. Pra mudar um pedaço de arquivo que já existe, usa editar_arquivo — é mais seguro.',
      schema: {
        type: 'object',
        properties: {
          caminho: { type: 'string' },
          conteudo: { type: 'string', description: 'o conteúdo completo do arquivo' },
        },
        required: ['caminho', 'conteudo'],
      },
      async executar({ caminho, conteudo }) {
        const abs = await dentroReal(raiz, caminho)
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, conteudo)
        return `Escrito: ${caminho} (${conteudo.length} chars)`
      },
    },

    editar_arquivo: {
      descricao: 'Troca um trecho EXATO por outro dentro de um arquivo. O trecho procurado tem que aparecer uma vez só — se aparecer mais, inclui linhas em volta pra ficar único. Falha em vez de adivinhar.',
      schema: {
        type: 'object',
        properties: {
          caminho: { type: 'string' },
          procurar: { type: 'string', description: 'o texto exato que existe hoje, com a indentação' },
          substituir: { type: 'string', description: 'o que entra no lugar' },
        },
        required: ['caminho', 'procurar', 'substituir'],
      },
      async executar({ caminho, procurar, substituir }) {
        const abs = await dentroReal(raiz, caminho)
        const txt = await fs.readFile(abs, 'utf8')
        const n = txt.split(procurar).length - 1
        if (n === 0) throw new Error(`não achei esse trecho em ${caminho}. Lê o arquivo de novo — ele pode ter mudado, ou a indentação está diferente.`)
        if (n > 1) throw new Error(`esse trecho aparece ${n} vezes em ${caminho}. Inclui linhas em volta pra ficar único.`)
        await fs.writeFile(abs, txt.replace(procurar, substituir))
        return `Editado: ${caminho}`
      },
    },

    listar_projeto: {
      descricao: 'Mostra a árvore de arquivos do projeto (sem node_modules, .git, out, dist).',
      schema: {
        type: 'object',
        properties: { pasta: { type: 'string', description: 'subpasta, opcional' } },
      },
      async executar({ pasta }) {
        const base = dentro(raiz, pasta || '.')
        const linhas = []
        const anda = async (dir, prefixo = '') => {
          if (linhas.length > 300) return
          const itens = (await fs.readdir(dir, { withFileTypes: true }))
            .filter(d => !IGNORA.has(d.name) && !d.name.startsWith('.'))
            .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
          for (const it of itens) {
            const rel = path.relative(raiz, path.join(dir, it.name))
            if (it.isDirectory()) { linhas.push(`${prefixo}${it.name}/`); await anda(path.join(dir, it.name), prefixo + '  ') }
            else linhas.push(`${prefixo}${it.name}`)
          }
        }
        await anda(base)
        return linhas.join('\n') || '(vazio)'
      },
    },

    buscar_no_projeto: {
      descricao: 'Procura um texto nos arquivos do projeto e devolve as linhas com o número. Usa pra achar onde algo está definido antes de mexer.',
      schema: {
        type: 'object',
        properties: {
          texto: { type: 'string' },
          extensao: { type: 'string', description: 'filtra por extensão, ex: .ts' },
        },
        required: ['texto'],
      },
      async executar({ texto, extensao }) {
        const achados = []
        const anda = async (dir) => {
          if (achados.length > 80) return
          for (const it of await fs.readdir(dir, { withFileTypes: true })) {
            if (IGNORA.has(it.name) || it.name.startsWith('.')) continue
            const abs = path.join(dir, it.name)
            if (it.isDirectory()) { await anda(abs); continue }
            if (extensao && !it.name.endsWith(extensao)) continue
            const conteudo = await fs.readFile(abs, 'utf8').catch(() => '')
            conteudo.split('\n').forEach((linha, i) => {
              if (achados.length <= 80 && linha.includes(texto)) {
                achados.push(`${path.relative(raiz, abs)}:${i + 1}: ${linha.trim().slice(0, 160)}`)
              }
            })
          }
        }
        await anda(raiz)
        return achados.length ? achados.join('\n') : `nada com "${texto}"`
      },
    },

    rodar: {
      descricao: 'Roda um comando no terminal, dentro da pasta do projeto. Usa pra instalar, buildar, testar e renderizar. Devolve a saída. Comando que apaga coisa (rm -rf, git reset --hard) só se a task pedir explicitamente.',
      schema: {
        type: 'object',
        properties: { comando: { type: 'string', description: 'ex: npm run check' } },
        required: ['comando'],
      },
      async executar({ comando }) {
        return new Promise((ok) => {
          execFile(SHELL.cmd, [...SHELL.pre, comando], { cwd: raiz, timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
            (err, stdout, stderr) => {
              const saida = [stdout, stderr].filter(Boolean).join('\n').trim()
              const corte = saida.length > TETO_SAIDA
                ? saida.slice(0, TETO_SAIDA) + `\n[…cortado, ${saida.length} chars no total]`
                : saida
              if (err?.killed) return ok(`o comando estourou ${TIMEOUT_MS / 1000}s e foi morto.\n${corte}`)
              // erro NÃO vira exceção: a saída de um build que falhou é o que
              // o agent precisa ler pra consertar
              ok(`[saída ${err ? `· código ${err.code}` : '· ok'}]\n${corte || '(sem saída)'}`)
            })
        })
      },
    },
  }
}
