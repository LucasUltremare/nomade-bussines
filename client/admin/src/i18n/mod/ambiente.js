/* Este computador — o que funciona nesta instalação (Ajustes e onboarding).
   Chaves: amb.<item> (título) e amb.<item>.<motivo> (o que significa e o que fazer).
   Motivos de rede (dns, certificado…) caem em amb.net.<motivo>. */
export const en = {
  "amb.title": "This computer",
  "amb.sub": "What works in this installation and what needs a public address or a network change.",
  "amb.testing": "Testing…",
  "amb.again": "Test again",
  "amb.fail": "Could not run the test. Reload the page.",
  "amb.proxy": "A network proxy was found and is being used.",
  "amb.e.ok": "Works", "amb.e.aviso": "Partly", "amb.e.nao": "Doesn't work", "amb.e.off": "Not set up",
  "ob.s.machine": "This computer",
  "ob.machine.title": "What works on this computer",
  "ob.machine.sub": "Nomade is running on this machine, not on a server. Most of it works the same. A few things need a public address or are blocked by the network. Nothing here stops you from using the panel.",

  "amb.acesso": "Who opens the panel",
  "amb.acesso.maquina": "Only this computer, at {url}. Other people and your phone can't open it.",
  "amb.acesso.rede": "Devices on the same network open it at {url}.",
  "amb.acesso.sem_https": "Opens from anywhere at {url}, but without HTTPS. Put an HTTPS proxy in front of it.",
  "amb.acesso.ok": "Opens from anywhere, with HTTPS.",

  "amb.links": "Links you send to customers",
  "amb.links.maquina": "Proposals, payment links and sign-up links point to {url}, which only opens on this computer. A customer can't open them. To send links, Nomade needs a public address: a small server, or a tunnel to this computer.",
  "amb.links.rede": "Links only open for people on the same network ({url}).",
  "amb.links.sem_https": "Links open, but at {url} without HTTPS. Some phones and WhatsApp warn about it.",
  "amb.links.ok": "Customers open proposals, payments and sign-up links from anywhere.",

  "amb.ligado": "When it is on",
  "amb.ligado.local": "Nomade runs while its window is open and the computer is awake. If the computer sleeps or shuts down, the panel and every link stop until you open it again. Your data stays saved.",

  "amb.ia": "AI",
  "amb.ia.ok": "{provedor} answers. Chat, agents and drafts work.",
  "amb.ia.sem_chave": "No AI connected. Paste a key in Integrations to turn on chat, agents and drafts. Everything else works without it.",
  "amb.ia.outra_chave": "The chat is set to {provedor}, but the key you saved is for {outra}. Pick {outra} in Chat or paste a {provedor} key.",
  "amb.ia.ollama_off": "The local model (Ollama) doesn't answer at {url}. Open Ollama or fix the address.",

  "amb.memoria": "Memory search",
  "amb.memoria.semantica": "Finds memories by meaning, with the local model.",
  "amb.memoria.texto": "Without a local model (Ollama), memories are found by matching words. It works, it just finds less. Install Ollama to search by meaning.",

  "amb.pagamentos": "Payments (Mercado Pago)",
  "amb.pagamentos.off": "Not connected. Payment links need a Mercado Pago access token in Integrations.",
  "amb.pagamentos.webhook": "Payment links are created, but Mercado Pago can't reach this computer to say a payment went through. The status won't change by itself: check the payment in Mercado Pago and mark it.",
  "amb.pagamentos.ok": "Links are created and paid ones are marked by themselves.",

  "amb.email": "E-mail (Resend)",
  "amb.email.off": "Not set up. Nomade doesn't send e-mails until RESEND_API_KEY is set.",
  "amb.email.ok": "E-mails go out.",

  "amb.atendimento": "Customer service channels",
  "amb.atendimento.https": "Mercado Livre and Shopee only connect to a public HTTPS address. Trying it as a customer works here.",
  "amb.atendimento.ok": "Mercado Livre and Shopee can connect.",

  "amb.print": "Project covers",
  "amb.print.ok": "The site screenshot is taken with {navegador}.",
  "amb.print.sem": "No Chrome or Edge found on this computer, so projects get no automatic cover.",

  "amb.net.dns": "The network can't find {host}. You may be offline, or the company network blocks it. Ask IT to allow {host}.",
  "amb.net.bloqueado": "The connection to {host} is refused. A firewall is probably blocking it. Ask IT to allow {host}.",
  "amb.net.lento": "{host} didn't answer in time. The network is slow or silently blocks it.",
  "amb.net.certificado": "The company network inspects HTTPS and swaps the certificate, so the connection to {host} is refused. The local launcher trusts the system certificates; if it still fails, ask IT for the root certificate and set NODE_EXTRA_CA_CERTS.",
  "amb.net.proxy_senha": "The network proxy asks for a login. Put it in the proxy address (http://user:password@proxy:port) in HTTPS_PROXY.",
  "amb.net.filtro": "The company filter blocks {host}. Ask IT to allow it.",
};

export const pt = {
  "amb.title": "Este computador",
  "amb.sub": "O que funciona nesta instalação e o que precisa de endereço público ou de mudança na rede.",
  "amb.testing": "Testando…",
  "amb.again": "Testar de novo",
  "amb.fail": "Não deu pra testar. Recarregue a página.",
  "amb.proxy": "Achamos um proxy de rede e ele está sendo usado.",
  "amb.e.ok": "Funciona", "amb.e.aviso": "Em parte", "amb.e.nao": "Não funciona", "amb.e.off": "Não configurado",
  "ob.s.machine": "Este computador",
  "ob.machine.title": "O que funciona neste computador",
  "ob.machine.sub": "O Nomade está rodando nesta máquina, não num servidor. Quase tudo funciona igual. Algumas coisas precisam de endereço público ou são barradas pela rede. Nada aqui impede de usar o painel.",

  "amb.acesso": "Quem abre o painel",
  "amb.acesso.maquina": "Só este computador, em {url}. Outras pessoas e o seu celular não abrem.",
  "amb.acesso.rede": "Aparelhos da mesma rede abrem em {url}.",
  "amb.acesso.sem_https": "Abre de qualquer lugar em {url}, mas sem HTTPS. Coloque um proxy com HTTPS na frente.",
  "amb.acesso.ok": "Abre de qualquer lugar, com HTTPS.",

  "amb.links": "Links que você manda pro cliente",
  "amb.links.maquina": "Propostas, links de pagamento e de cadastro apontam pra {url}, que só abre neste computador. O cliente não consegue abrir. Pra mandar link, o Nomade precisa de um endereço público: um servidor pequeno ou um túnel até este computador.",
  "amb.links.rede": "Os links só abrem pra quem está na mesma rede ({url}).",
  "amb.links.sem_https": "Os links abrem, mas em {url} sem HTTPS. Alguns celulares e o WhatsApp avisam.",
  "amb.links.ok": "O cliente abre proposta, pagamento e cadastro de qualquer lugar.",

  "amb.ligado": "Quando ele está ligado",
  "amb.ligado.local": "O Nomade roda enquanto a janela dele está aberta e o computador acordado. Se o computador dormir ou desligar, o painel e todos os links param até você abrir de novo. Os dados ficam salvos.",

  "amb.ia": "IA",
  "amb.ia.ok": "{provedor} responde. Chat, agents e rascunhos funcionam.",
  "amb.ia.sem_chave": "Nenhuma IA conectada. Cole uma chave em Integrações pra ligar o chat, os agents e os rascunhos. O resto funciona sem.",
  "amb.ia.outra_chave": "O chat está no {provedor}, mas a chave salva é do {outra}. Escolha {outra} no Chat ou cole uma chave do {provedor}.",
  "amb.ia.ollama_off": "O modelo local (Ollama) não responde em {url}. Abra o Ollama ou corrija o endereço.",

  "amb.memoria": "Busca nas memórias",
  "amb.memoria.semantica": "Acha memórias pelo significado, com o modelo local.",
  "amb.memoria.texto": "Sem modelo local (Ollama), as memórias são achadas por palavra. Funciona, só acha menos. Instale o Ollama pra buscar pelo significado.",

  "amb.pagamentos": "Pagamentos (Mercado Pago)",
  "amb.pagamentos.off": "Não conectado. Os links de pagamento precisam do access token do Mercado Pago em Integrações.",
  "amb.pagamentos.webhook": "Os links de pagamento são criados, mas o Mercado Pago não consegue chegar neste computador pra avisar que pagaram. O status não muda sozinho: confira no Mercado Pago e marque.",
  "amb.pagamentos.ok": "Os links são criados e os pagos são marcados sozinhos.",

  "amb.email": "E-mail (Resend)",
  "amb.email.off": "Não configurado. O Nomade não manda e-mail até ter RESEND_API_KEY.",
  "amb.email.ok": "Os e-mails saem.",

  "amb.atendimento": "Canais de atendimento",
  "amb.atendimento.https": "Mercado Livre e Shopee só conectam num endereço público com HTTPS. O teste como cliente funciona aqui.",
  "amb.atendimento.ok": "Mercado Livre e Shopee podem conectar.",

  "amb.print": "Capa dos projetos",
  "amb.print.ok": "O print do site é tirado com o {navegador}.",
  "amb.print.sem": "Nenhum Chrome ou Edge neste computador, então os projetos ficam sem capa automática.",

  "amb.net.dns": "A rede não acha {host}. Pode estar sem internet, ou a rede da empresa bloqueia. Peça pro TI liberar {host}.",
  "amb.net.bloqueado": "A conexão com {host} é recusada. Provavelmente um firewall bloqueia. Peça pro TI liberar {host}.",
  "amb.net.lento": "{host} não respondeu a tempo. A rede está lenta ou bloqueia sem avisar.",
  "amb.net.certificado": "A rede da empresa inspeciona o HTTPS e troca o certificado, então a conexão com {host} é recusada. O instalador local confia nos certificados do sistema; se ainda falhar, peça o certificado raiz pro TI e coloque em NODE_EXTRA_CA_CERTS.",
  "amb.net.proxy_senha": "O proxy da rede pede login. Coloque no endereço do proxy (http://usuario:senha@proxy:porta) em HTTPS_PROXY.",
  "amb.net.filtro": "O filtro da empresa bloqueia {host}. Peça pro TI liberar.",
};

export const es = {
  "amb.title": "Esta computadora",
  "amb.sub": "Lo que funciona en esta instalación y lo que necesita una dirección pública o un cambio en la red.",
  "amb.testing": "Probando…",
  "amb.again": "Probar otra vez",
  "amb.fail": "No se pudo probar. Recarga la página.",
  "amb.proxy": "Encontramos un proxy de red y se está usando.",
  "amb.e.ok": "Funciona", "amb.e.aviso": "En parte", "amb.e.nao": "No funciona", "amb.e.off": "Sin configurar",
  "ob.s.machine": "Esta computadora",
  "ob.machine.title": "Lo que funciona en esta computadora",
  "ob.machine.sub": "Nomade está corriendo en esta máquina, no en un servidor. Casi todo funciona igual. Algunas cosas necesitan una dirección pública o la red las bloquea. Nada de esto impide usar el panel.",

  "amb.acesso": "Quién abre el panel",
  "amb.acesso.maquina": "Solo esta computadora, en {url}. Otras personas y tu celular no lo abren.",
  "amb.acesso.rede": "Los dispositivos de la misma red lo abren en {url}.",
  "amb.acesso.sem_https": "Abre desde cualquier lugar en {url}, pero sin HTTPS. Pon un proxy con HTTPS delante.",
  "amb.acesso.ok": "Abre desde cualquier lugar, con HTTPS.",

  "amb.links": "Links que envías al cliente",
  "amb.links.maquina": "Propuestas, links de pago y de registro apuntan a {url}, que solo abre en esta computadora. El cliente no puede abrirlos. Para enviar links, Nomade necesita una dirección pública: un servidor pequeño o un túnel hasta esta computadora.",
  "amb.links.rede": "Los links solo abren para quien está en la misma red ({url}).",
  "amb.links.sem_https": "Los links abren, pero en {url} sin HTTPS. Algunos celulares y WhatsApp avisan.",
  "amb.links.ok": "El cliente abre propuestas, pagos y registros desde cualquier lugar.",

  "amb.ligado": "Cuándo está encendido",
  "amb.ligado.local": "Nomade corre mientras su ventana está abierta y la computadora despierta. Si la computadora se suspende o se apaga, el panel y todos los links se detienen hasta que lo abras otra vez. Los datos quedan guardados.",

  "amb.ia": "IA",
  "amb.ia.ok": "{provedor} responde. Chat, agentes y borradores funcionan.",
  "amb.ia.sem_chave": "Ninguna IA conectada. Pega una clave en Integraciones para activar el chat, los agentes y los borradores. Lo demás funciona sin ella.",
  "amb.ia.outra_chave": "El chat está en {provedor}, pero la clave guardada es de {outra}. Elige {outra} en el Chat o pega una clave de {provedor}.",
  "amb.ia.ollama_off": "El modelo local (Ollama) no responde en {url}. Abre Ollama o corrige la dirección.",

  "amb.memoria": "Búsqueda en la memoria",
  "amb.memoria.semantica": "Encuentra memorias por significado, con el modelo local.",
  "amb.memoria.texto": "Sin modelo local (Ollama), las memorias se encuentran por palabra. Funciona, solo encuentra menos. Instala Ollama para buscar por significado.",

  "amb.pagamentos": "Pagos (Mercado Pago)",
  "amb.pagamentos.off": "No conectado. Los links de pago necesitan el access token de Mercado Pago en Integraciones.",
  "amb.pagamentos.webhook": "Los links de pago se crean, pero Mercado Pago no puede llegar a esta computadora para avisar que pagaron. El estado no cambia solo: revisa el pago en Mercado Pago y márcalo.",
  "amb.pagamentos.ok": "Los links se crean y los pagados se marcan solos.",

  "amb.email": "Correo (Resend)",
  "amb.email.off": "Sin configurar. Nomade no envía correos hasta tener RESEND_API_KEY.",
  "amb.email.ok": "Los correos salen.",

  "amb.atendimento": "Canales de atención",
  "amb.atendimento.https": "Mercado Libre y Shopee solo se conectan a una dirección pública con HTTPS. La prueba como cliente funciona aquí.",
  "amb.atendimento.ok": "Mercado Libre y Shopee pueden conectarse.",

  "amb.print": "Portada de los proyectos",
  "amb.print.ok": "La captura del sitio se hace con {navegador}.",
  "amb.print.sem": "No hay Chrome ni Edge en esta computadora, así que los proyectos quedan sin portada automática.",

  "amb.net.dns": "La red no encuentra {host}. Puede que no haya internet, o la red de la empresa lo bloquea. Pide a TI que libere {host}.",
  "amb.net.bloqueado": "La conexión con {host} es rechazada. Probablemente un firewall la bloquea. Pide a TI que libere {host}.",
  "amb.net.lento": "{host} no respondió a tiempo. La red está lenta o bloquea sin avisar.",
  "amb.net.certificado": "La red de la empresa inspecciona el HTTPS y cambia el certificado, así que la conexión con {host} es rechazada. El instalador local confía en los certificados del sistema; si aún falla, pide a TI el certificado raíz y ponlo en NODE_EXTRA_CA_CERTS.",
  "amb.net.proxy_senha": "El proxy de la red pide usuario. Ponlo en la dirección del proxy (http://usuario:clave@proxy:puerto) en HTTPS_PROXY.",
  "amb.net.filtro": "El filtro de la empresa bloquea {host}. Pide a TI que lo libere.",
};
