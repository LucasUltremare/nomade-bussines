/* ═══ PROSPECÇÃO — Google Places ═════════════════════════════════════════
   Acha negócio real por tipo + região e vira lead em `nomade_leads`.
   Dali o gatilho de triagem que já existe pega e cria a task pro squad.

   POR QUE PLACES E NÃO SCRAPING: é API oficial, o dado é público e de
   EMPRESA (nome fantasia, endereço comercial, telefone comercial, site) —
   não é dado pessoal garimpado. Raspar rede social viola ToS e derruba
   conta; e-mail pessoal em massa é problema de LGPD. Aqui não tem nenhum
   dos dois.

   O QUE FAZ O LEAD SER BOM, pra uma agência que vende site e automação:
   um negócio que FUNCIONA (nota boa, muita avaliação) e NÃO TEM SITE. Esse
   é o cliente que tem dinheiro, tem cliente, e não tem presença. O score
   abaixo é explicável de propósito — vem com o motivo escrito, porque
   número sozinho ninguém confia nem consegue melhorar. */

const CAMPOS = [
  'places.id', 'places.displayName', 'places.formattedAddress',
  'places.nationalPhoneNumber', 'places.websiteUri',
  'places.rating', 'places.userRatingCount',
  'places.businessStatus', 'places.primaryTypeDisplayName',
].join(',')

/** Site que é só rede social não é site — e costuma ser o melhor lead. */
const soRedeSocial = (url) => /(?:instagram|facebook|linktr\.ee|linktree|beacons\.ai|wa\.me|linkr)\./i.test(url || '')

/** Celular brasileiro tem 9 dígitos depois do DDD; fixo não é WhatsApp. */
function whatsappDe(telefone) {
  const so = String(telefone || '').replace(/\D/g, '')
  const semPais = so.startsWith('55') ? so.slice(2) : so
  return semPais.length === 11 && semPais[2] === '9' ? `55${semPais}` : null
}

/* Nota de 0 a 100 + o porquê em português.

   A RÉGUA MUDA POR FONTE, e isso não é detalhe: no Places, campo de site
   vazio É evidência (o Google pergunta pro dono). No OpenStreetMap, vazio
   quase sempre quer dizer "ninguém mapeou" — só 8 de 40 padarias de Sorocaba
   têm o campo preenchido. Pontuar ausência de dado como se fosse ausência de
   site transformaria a fonte grátis numa lista de notas mentirosas. */
function pontuar(p, fonte = 'places') {
  return fonte === 'osm' ? pontuarOsm(p) : pontuarPlaces(p)
}

/* No OSM não existe nota nem contagem de avaliação, e a ausência de campo não
   informa. Então o que sobra de sinal REAL é: tem telefone (dá pra abordar) e
   o pouco que estiver mapeado. Score baixo aqui é honesto — a fonte sabe menos. */
function pontuarOsm(p) {
  const motivos = []
  let score = 35 // piso: é um negócio real, mapeado, do tipo certo
  const site = p.websiteUri || ''

  if (p.nationalPhoneNumber) { score += 30; motivos.push('tem telefone') }
  else { score -= 15; motivos.push('sem telefone no mapa — precisa achar o contato') }

  if (soRedeSocial(site)) { score += 20; motivos.push('só rede social, sem site próprio') }
  else if (site) { score -= 20; motivos.push('já tem site') }
  else { motivos.push('site desconhecido — o OSM não sabe, não quer dizer que não tem') }

  if (p.horario) { score += 5; motivos.push('cadastro cuidado') }
  return { score: Math.max(0, Math.min(100, score)), motivo: motivos.join(' · ') }
}

function pontuarPlaces(p) {
  const motivos = []
  let score = 0
  const site = p.websiteUri || ''
  const avaliacoes = p.userRatingCount || 0
  const nota = p.rating || 0

  if (!site) { score += 45; motivos.push('sem site') }
  else if (soRedeSocial(site)) { score += 35; motivos.push('só tem rede social, sem site próprio') }

  if (avaliacoes >= 100) { score += 25; motivos.push(`${avaliacoes} avaliações — movimento real`) }
  else if (avaliacoes >= 30) { score += 15; motivos.push(`${avaliacoes} avaliações`) }
  // menos de 10 avaliações é negócio não-validado: pode ser novo, pode estar
  // morrendo, e em nenhum dos dois casos vale a ligação
  else if (avaliacoes < 10) { score -= 15; motivos.push(`só ${avaliacoes} avaliações — negócio não validado`) }

  if (nota >= 4.5) { score += 15; motivos.push(`nota ${nota} — cliente satisfeito`) }
  // nota ruim não se resolve com site: o problema é a operação, e ele não paga
  else if (nota && nota < 3.5) { score -= 20; motivos.push(`nota ${nota} — problema é de operação, não de site`) }

  if (!p.nationalPhoneNumber) { score -= 20; motivos.push('sem telefone — difícil abordar') }
  if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') { score -= 60; motivos.push('não está operando') }

  return { score: Math.max(0, Math.min(100, score)), motivo: motivos.join(' · ') }
}

/** Uma busca no Places. `regiao` entra no texto mesmo — é o que o Places espera. */
export async function buscarNoPlaces({ busca, regiao, max = 20, chave }) {
  if (!chave) throw new Error('Sem chave do Google Places (GOOGLE_PLACES_KEY ou GOOGLE_API_KEY).')
  const texto = [busca, regiao].filter(Boolean).join(' em ')
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'X-Goog-Api-Key': chave,
      'X-Goog-FieldMask': CAMPOS,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      textQuery: texto,
      languageCode: 'pt-BR',
      regionCode: 'BR',
      maxResultCount: Math.min(20, Math.max(1, max)), // teto da API por página
    }),
    signal: AbortSignal.timeout(20_000),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    const razao = j?.error?.details?.[0]?.reason
    if (razao === 'API_KEY_SERVICE_BLOCKED') {
      throw new Error('A Places API não está habilitada nesse projeto do Google Cloud. Liga em console.cloud.google.com → APIs → Places API (New).')
    }
    throw new Error(j?.error?.message || `Places HTTP ${r.status}`)
  }
  return (j.places || []).map(p => ({
    placeId: p.id,
    nome: p.displayName?.text || '(sem nome)',
    endereco: p.formattedAddress || '',
    telefone: p.nationalPhoneNumber || '',
    site: p.websiteUri || '',
    nota: p.rating || null,
    avaliacoes: p.userRatingCount || 0,
    tipo: p.primaryTypeDisplayName?.text || '',
    operando: !p.businessStatus || p.businessStatus === 'OPERATIONAL',
    fonte: 'places',
    ...pontuar(p, 'places'),
  }))
}

/* ═══ FONTE GRÁTIS — OpenStreetMap via Overpass ══════════════════════════
   Sem chave, sem cartão, sem cota paga. Em compensação o dado é mais pobre:
   em Sorocaba, das 40 padarias mapeadas, 12 têm telefone e 8 têm site.
   Serve pra descobrir QUEM existe; o contato às vezes tu vai ter que caçar.

   O Overpass é infraestrutura comunitária e gratuita: uma busca de cada vez,
   com timeout curto e teto de resultado. Não é lugar pra varredura em massa. */

/* O que a pessoa digita → como o OSM etiqueta. Sem isso, "padaria" não acha
   nada: o mapa fala shop=bakery. O que não estiver aqui cai na busca por nome. */
const TAGS_OSM = {
  padaria: ['shop=bakery'],
  restaurante: ['amenity=restaurant'],
  lanchonete: ['amenity=fast_food'],
  bar: ['amenity=bar', 'amenity=pub'],
  cafe: ['amenity=cafe'], 'cafeteria': ['amenity=cafe'],
  pizzaria: ['amenity=restaurant'],
  mercado: ['shop=supermarket', 'shop=convenience'],
  supermercado: ['shop=supermarket'],
  farmacia: ['amenity=pharmacy'],
  oficina: ['shop=car_repair'], 'oficina mecanica': ['shop=car_repair'],
  'auto center': ['shop=car_repair'], 'lava rapido': ['shop=car_wash'],
  barbearia: ['shop=hairdresser'], salao: ['shop=hairdresser'], 'salao de beleza': ['shop=hairdresser'],
  estetica: ['shop=beauty'], manicure: ['shop=beauty'],
  academia: ['leisure=fitness_centre'],
  petshop: ['shop=pet'], 'pet shop': ['shop=pet'], veterinario: ['amenity=veterinary'],
  clinica: ['amenity=clinic'], dentista: ['amenity=dentist'], medico: ['amenity=doctors'],
  hotel: ['tourism=hotel'], pousada: ['tourism=guest_house'],
  imobiliaria: ['office=estate_agent'], advogado: ['office=lawyer'],
  contador: ['office=accountant'], contabilidade: ['office=accountant'],
  loja: ['shop=yes'], roupa: ['shop=clothes'], calcado: ['shop=shoes'],
  otica: ['shop=optician'], joalheria: ['shop=jewelry'],
  papelaria: ['shop=stationery'], floricultura: ['shop=florist'],
  'material de construcao': ['shop=doityourself', 'shop=hardware'],
  moveis: ['shop=furniture'], eletronicos: ['shop=electronics'],
}

const semAcento = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

function filtrosOsm(busca) {
  const b = semAcento(busca)
  const exato = TAGS_OSM[b]
  if (exato) return exato.map(t => { const [k, v] = t.split('='); return `["${k}"="${v}"]` })
  const parcial = Object.keys(TAGS_OSM).find(k => b.includes(k) || k.includes(b))
  if (parcial) return TAGS_OSM[parcial].map(t => { const [k, v] = t.split('='); return `["${k}"="${v}"]` })
  // desconhecido: procura pelo NOME, que pega "Auto Elétrica", "Chaveiro" etc.
  return [`["name"~"${busca.replace(/["\\]/g, '')}",i]`]
}

/* Instâncias públicas do Overpass. Dar 504 quando está cheio é o normal do
   serviço, não exceção — então tenta a próxima em vez de falhar na cara do
   sócio. São servidores doados por voluntários: uma consulta por vez. */
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
]

async function consultarOverpass(query) {
  let ultimo = null
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'NomadeBusiness/1.0 (prospeccao)' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(45_000),
      })
      if (r.ok) return await r.json().catch(() => ({}))
      // 429/504 = ocupado; 400 = a consulta está errada e trocar de servidor não resolve
      if (r.status === 400) throw new Error('consulta inválida — provavelmente a região não existe como município no mapa')
      ultimo = `HTTP ${r.status}`
    } catch (e) {
      if (/consulta inválida/.test(e.message)) throw e
      ultimo = e.name === 'TimeoutError' ? 'tempo esgotado' : e.message
    }
  }
  throw new Error(`as três instâncias públicas do Overpass estão ocupadas (${ultimo}). Tenta de novo em um minuto — ou usa --places.`)
}

export async function buscarNoOsm({ busca, regiao, max = 40 }) {
  if (!regiao) throw new Error('No OpenStreetMap a região é obrigatória (ex: "Sorocaba").')
  const cidade = String(regiao).split(/[,\/]/)[0].trim()
  const filtros = filtrosOsm(busca)
  // admin_level 8 = município no Brasil
  const query = `[out:json][timeout:25];
area["name"="${cidade.replace(/["\\]/g, '')}"]["admin_level"="8"]->.a;
(${filtros.map(f => `nwr${f}(area.a);`).join('\n')});
out center tags ${Math.min(120, Math.max(1, max))};`

  const j = await consultarOverpass(query)
  const achados = (j.elements || [])
    .map(e => e.tags || {})
    .filter(t => t.name)
    .map(t => {
      const p = {
        nome: t.name,
        endereco: [t['addr:street'], t['addr:housenumber'], t['addr:suburb'], cidade].filter(Boolean).join(', '),
        nationalPhoneNumber: t.phone || t['contact:phone'] || '',
        websiteUri: t.website || t['contact:website'] || t['contact:instagram'] || '',
        horario: t.opening_hours || '',
      }
      return {
        placeId: `osm:${semAcento(t.name)}:${semAcento(cidade)}`, // sem id estável útil: nome+cidade serve pro dedupe
        nome: p.nome, endereco: p.endereco,
        telefone: p.nationalPhoneNumber, site: p.websiteUri,
        nota: null, avaliacoes: 0, tipo: busca, operando: true,
        fonte: 'osm',
        ...pontuar(p, 'osm'),
      }
    })
  // o mesmo comércio às vezes está mapeado como ponto E como polígono
  const vistos = new Set()
  return achados.filter(a => !vistos.has(a.placeId) && vistos.add(a.placeId))
}

/* Grava o que ainda não existe. DEDUPE PELO placeId, que é estável no Google:
   rodar a mesma busca de novo não pode encher a base do mesmo comércio.
   Telefone é a segunda barreira — a mesma empresa aparece com dois places
   quando tem duas unidades cadastradas errado. */
export async function importarLeads(colLeads, achados, { por, busca, regiao, scoreMinimo = 30 } = {}) {
  const dignos = achados.filter(a => a.operando && a.score >= scoreMinimo)
  const ignorados = achados.length - dignos.length
  if (!dignos.length) return { novos: 0, repetidos: 0, ignorados, leads: [] }

  const ids = dignos.map(a => a.placeId)
  const fones = dignos.map(a => a.telefone).filter(Boolean)
  const jaTem = await colLeads.find(
    { $or: [{ placeId: { $in: ids } }, ...(fones.length ? [{ contactValue: { $in: fones } }] : [])] },
    { projection: { placeId: 1, contactValue: 1 } }
  ).toArray()
  const vistos = new Set([...jaTem.map(x => x.placeId), ...jaTem.map(x => x.contactValue)].filter(Boolean))

  const novos = []
  for (const a of dignos) {
    if (vistos.has(a.placeId) || (a.telefone && vistos.has(a.telefone))) continue
    vistos.add(a.placeId)
    if (a.telefone) vistos.add(a.telefone)
    novos.push({
      name: a.nome,
      company: a.nome,
      email: null,
      whatsapp: whatsappDe(a.telefone),
      contactType: a.telefone ? 'telefone' : 'nenhum',
      contactValue: a.telefone || '',
      // o que a triagem lê pra decidir a abordagem, em português
      msg: [
        `${a.nome}${a.tipo ? ` · ${a.tipo}` : ''}`,
        a.endereco,
        a.site ? `site: ${a.site}` : 'SEM SITE',
        a.nota ? `nota ${a.nota} em ${a.avaliacoes} avaliações` : 'sem avaliações',
        `\nPor que é lead: ${a.motivo}`,
      ].filter(Boolean).join('\n'),
      source: 'places',
      vertical: busca || null,
      regiao: regiao || null,
      placeId: a.placeId,
      endereco: a.endereco,
      site: a.site || null,
      nota: a.nota,
      avaliacoes: a.avaliacoes,
      score: a.score,
      motivo: a.motivo,
      status: 'new',
      prospectadoPor: por || null,
      createdAt: new Date(),
    })
  }
  if (novos.length) await colLeads.insertMany(novos)
  return {
    novos: novos.length,
    repetidos: dignos.length - novos.length,
    ignorados,
    leads: novos.map(n => ({ nome: n.name, score: n.score, motivo: n.motivo, telefone: n.contactValue, site: n.site })),
  }
}
