/* Config do CLI em ~/.nomade/config.json — mesma pasta onde o runner já
   guarda as contas Claude (~/.nomade/contas), então tudo da empresa
   naquela máquina vive num lugar só. */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

// Onde o painel da tua empresa está (PAINEL_URL do servidor). `nomade login --url=...`
// grava no config; NOMADE_URL sobrescreve.
export const SERVICO_PADRAO = process.env.NOMADE_URL || 'http://localhost:5004'
// NOMADE_CONFIG_DIR permite apontar pra outro lugar — testar contra um
// serviço local, ou manter mais de uma conta na mesma máquina.
export const DIR = process.env.NOMADE_CONFIG_DIR || path.join(os.homedir(), '.nomade')
const ARQUIVO = path.join(DIR, 'config.json')

export async function ler() {
  try {
    const cfg = JSON.parse(await fs.readFile(ARQUIVO, 'utf8'))
    return { url: SERVICO_PADRAO, ...cfg, url: cfg.url || SERVICO_PADRAO }
  } catch {
    return { url: process.env.NOMADE_URL || SERVICO_PADRAO }
  }
}

export async function gravar(patch) {
  const atual = await ler()
  const novo = { ...atual, ...patch }
  await fs.mkdir(DIR, { recursive: true })
  // 0600: o token é credencial de sócio, não fica legível pro resto da máquina
  await fs.writeFile(ARQUIVO, JSON.stringify(novo, null, 2), { mode: 0o600 })
  return novo
}

export async function limpar() {
  await fs.rm(ARQUIVO, { force: true })
}

/** id estável desta máquina — gerado uma vez e guardado. */
export async function machineId() {
  const cfg = await ler()
  if (cfg.machineId) return cfg.machineId
  const id = crypto.randomBytes(8).toString('hex')
  await gravar({ machineId: id })
  return id
}

/** Pasta onde cada sócio loga a própria assinatura do Claude nesta máquina. */
export function baseDasContas() {
  if (process.env.NOMADE_CONTAS_DIR) return process.env.NOMADE_CONTAS_DIR
  // Fica junto do resto (~/.nomade/contas) nos três sistemas.
  return path.join(DIR, 'contas')
}
