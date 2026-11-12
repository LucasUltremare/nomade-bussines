#!/usr/bin/env node
/* Pega o erro que o `node --check` NÃO pega: rota registrada ANTES do
   middleware existir.

     app.post('/x', officeAuth, ...)   // linha 714
     const officeAuth = ...            // linha 961  ← TDZ

   Sintaxe válida, e o processo morre no boot com "Cannot access before
   initialization" — o container entra em loop e o proxy devolve 502.
   Aconteceu de verdade em 26/ago/2026.

   `function foo(){}` sobe (hoisting) e não tem esse problema; `const` e `let`
   têm. Por isso a checagem só olha as declarações léxicas. */
import fs from 'node:fs'

const ARQUIVOS = process.argv.slice(2)
if (!ARQUIVOS.length) { console.error('uso: check-rotas.mjs <arquivo.js…>'); process.exit(2) }

let problemas = 0
for (const arquivo of ARQUIVOS) {
  const linhas = fs.readFileSync(arquivo, 'utf8').split('\n')

  // onde cada const/let de topo é declarada
  const declarada = new Map()
  linhas.forEach((l, i) => {
    const m = l.match(/^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/)
    if (m && !declarada.has(m[1])) declarada.set(m[1], i + 1)
  })

  linhas.forEach((l, i) => {
    const rota = l.match(/^\s*(?:app|admin|router)\.(get|post|patch|put|delete|use)\(\s*['"`]([^'"`]*)['"`]\s*,\s*(.+)$/)
    if (!rota) return
    const [, verbo, caminho, resto] = rota
    // os middlewares são os identificadores soltos antes do handler
    for (const nome of (resto.match(/\b[A-Za-z_$][\w$]*\b/g) || [])) {
      const decl = declarada.get(nome)
      if (decl && decl > i + 1) {
        console.error(
          `✗ ${arquivo}:${i + 1}  ${verbo.toUpperCase()} ${caminho}\n` +
          `   usa "${nome}", que só é declarada na linha ${decl}.\n` +
          `   Move a rota pra DEPOIS da linha ${decl}.\n`
        )
        problemas++
      }
    }
  })
}

if (problemas) { console.error(`${problemas} rota(s) antes do middleware — o serviço não sobe assim.`); process.exit(1) }
console.log(`✓ ${ARQUIVOS.length} arquivo(s): nenhuma rota antes do middleware`)
