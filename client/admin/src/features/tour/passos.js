/* Roteiro do tour. `alvo` é o data-tour do elemento; `menu: true` avisa que
   o alvo mora na barra lateral (no celular ela precisa abrir antes).
   Passo de tela que a empresa desligou some sozinho: o Tour pula alvo
   que não está na página. Textos em i18n/mod/setup.js. */
const nav = (id) => ({ alvo: `nav-${id}`, titulo: `tour.${id}.t`, texto: `tour.${id}.d`, menu: true, lado: "right" });

export const passosDoTour = [
  { titulo: "tour.welcome.t", texto: "tour.welcome.d" },
  { alvo: "ws", titulo: "tour.ws.t", texto: "tour.ws.d", menu: true, lado: "right" },
  { alvo: "search", titulo: "tour.search.t", texto: "tour.search.d", menu: true, lado: "right" },
  nav("home"),
  nav("atendimento"),
  nav("leads"),
  nav("clients"),
  nav("propostas"),
  nav("payments"),
  nav("finance"),
  nav("tasks"),
  nav("projetos"),
  nav("chat"),
  nav("inbox"),
  nav("memoria"),
  nav("membros"),
  nav("integrations"),
  nav("settings"),
  { alvo: "avisos", titulo: "tour.avisos.t", texto: "tour.avisos.d", lado: "bottom" },
  { alvo: "ajuda", titulo: "tour.ajuda.t", texto: "tour.ajuda.d", lado: "bottom" },
  { titulo: "tour.end.t", texto: "tour.end.d" },
];
