#!/usr/bin/env node
/* Dump e restore de office_memories. Existe porque mongodump não está
   instalado nas máquinas da casa e backup que depende de ferramenta ausente
   não é backup. EJSON preserva ObjectId, Date e os 768 floats do embedding —
   JSON.stringify comum viraria string e o restore devolveria lixo silencioso.

     node scripts/backup-memorias.mjs dump
     node scripts/backup-memorias.mjs verificar <arquivo>
     node scripts/backup-memorias.mjs restaurar <arquivo> --aplicar   */
import { MongoClient } from 'mongodb'
import { EJSON } from 'bson'
import fs from 'fs'
import os from 'os'
import path from 'path'

const [cmd, arg] = process.argv.slice(2)
const uri = process.env.MONGODB_URI
  || (fs.existsSync('.env') && fs.readFileSync('.env', 'utf8').match(/^MONGODB_URI=(.+)$/m)?.[1].trim())
if (!uri) { console.error('MONGODB_URI ausente.'); process.exit(1) }

const DIR = process.env.BACKUP_DIR || path.join(os.homedir(), 'nomade-backups')
const abrir = async () => { const c = new MongoClient(uri); await c.connect(); return c }

if (cmd === 'dump') {
  const c = await abrir()
  const docs = await c.db(process.env.MONGODB_OFFICE_DB || "nomade_office").collection('office_memories').find({}).toArray()
  await c.close()
  if (!docs.length) { console.error('coleção vazia — não gravo dump vazio por cima de nada.'); process.exit(1) }
  fs.mkdirSync(DIR, { recursive: true })
  const alvo = path.join(DIR, `office_memories-${new Date().toISOString().replace(/[:.]/g, '-')}.ejson`)
  fs.writeFileSync(alvo, EJSON.stringify(docs, { relaxed: false }))
  console.log(`${docs.length} docs → ${alvo}`)
  console.log(`confere com:  node scripts/backup-memorias.mjs verificar ${alvo}`)

} else if (cmd === 'verificar') {
  if (!arg) { console.error('falta o arquivo.'); process.exit(1) }
  const docs = EJSON.parse(fs.readFileSync(arg, 'utf8'))
  const c = await abrir()
  const naBase = await c.db(process.env.MONGODB_OFFICE_DB || "nomade_office").collection('office_memories').countDocuments()
  await c.close()
  const comVetor = docs.filter(d => Array.isArray(d.embedding) && d.embedding.length === 768).length
  const numerico = docs.every(d => !d.embedding || d.embedding.every(x => typeof x === 'number'))
  const comData = docs.filter(d => d.createdAt instanceof Date).length
  const ids = new Set(docs.map(d => d.id))
  console.log(`arquivo   ${(fs.statSync(arg).size / 1024).toFixed(0)} KB`)
  console.log(`docs      ${docs.length}   (base tem ${naBase})`)
  console.log(`ids       ${ids.size} únicos`)
  console.log(`embedding ${comVetor} com 768 floats · tipo numérico ${numerico ? 'ok' : 'QUEBRADO'}`)
  console.log(`datas     ${comData} como Date`)
  const ok = docs.length === naBase && ids.size === docs.length && numerico && comVetor === docs.length && comData === docs.length
  console.log(ok ? '\ndump íntegro — restaurável.' : '\nDUMP SUSPEITO — não aplique migração em cima disto.')
  process.exit(ok ? 0 : 1)

} else if (cmd === 'restaurar') {
  if (!arg) { console.error('falta o arquivo.'); process.exit(1) }
  const docs = EJSON.parse(fs.readFileSync(arg, 'utf8'))
  if (!process.argv.includes('--aplicar')) {
    console.log(`restauraria ${docs.length} docs de ${arg} — SUBSTITUINDO office_memories inteira.`)
    console.log('pra valer, acrescenta --aplicar'); process.exit(0)
  }
  const c = await abrir()
  const office = c.db(process.env.MONGODB_OFFICE_DB || "nomade_office")
  // uma memória por empresa: dump de outra empresa não entra aqui (lib/memoria-empresa.js)
  const carimbo = await office.collection('office_config').findOne({ id: 'empresa' })
  const donos = [...new Set(docs.map(d => d.empresaId).filter(Boolean))]
  if (carimbo && donos.some(id => id !== carimbo.empresaId)) {
    console.error(`o dump é de outra empresa (${donos.join(', ')}); este banco é de "${carimbo.nome}" (${carimbo.empresaId}). Nada foi alterado.`)
    await c.close(); process.exit(1)
  }
  const col = office.collection('office_memories')
  await col.deleteMany({})
  await col.insertMany(docs)
  console.log(`restaurados ${await col.countDocuments()} docs.`)
  await c.close()

} else {
  console.log('uso: dump | verificar <arquivo> | restaurar <arquivo> --aplicar')
}
