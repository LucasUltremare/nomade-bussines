import { useMemo } from "react";
import { useT } from "../../i18n/index.jsx";
import "./config.css";

/* País, moeda, fuso e começo da semana. Os nomes vêm do próprio navegador
   (Intl.DisplayNames), então aparecem no idioma da tela sem tabela nossa. */

const PAISES = "AD AE AF AG AI AL AM AO AR AS AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CW CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FO FR GA GB GD GE GF GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MQ MR MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP NR NZ OM PA PE PF PG PH PK PL PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WS YE ZA ZM ZW".split(" ");

/* moeda e fuso que quase sempre acompanham o país — só sugestão: ao trocar
   o país a gente preenche, e a pessoa muda se o caso dela for outro. */
const DO_PAIS = {
  BR: ["BRL", "America/Sao_Paulo"], PT: ["EUR", "Europe/Lisbon"], US: ["USD", "America/New_York"], CA: ["CAD", "America/Toronto"],
  MX: ["MXN", "America/Mexico_City"], AR: ["ARS", "America/Argentina/Buenos_Aires"], CL: ["CLP", "America/Santiago"], CO: ["COP", "America/Bogota"],
  PE: ["PEN", "America/Lima"], UY: ["UYU", "America/Montevideo"], PY: ["PYG", "America/Asuncion"], BO: ["BOB", "America/La_Paz"],
  EC: ["USD", "America/Guayaquil"], VE: ["VES", "America/Caracas"], CR: ["CRC", "America/Costa_Rica"], PA: ["PAB", "America/Panama"],
  DO: ["DOP", "America/Santo_Domingo"], GT: ["GTQ", "America/Guatemala"], ES: ["EUR", "Europe/Madrid"], FR: ["EUR", "Europe/Paris"],
  DE: ["EUR", "Europe/Berlin"], IT: ["EUR", "Europe/Rome"], NL: ["EUR", "Europe/Amsterdam"], BE: ["EUR", "Europe/Brussels"],
  IE: ["EUR", "Europe/Dublin"], AT: ["EUR", "Europe/Vienna"], GR: ["EUR", "Europe/Athens"], FI: ["EUR", "Europe/Helsinki"],
  GB: ["GBP", "Europe/London"], CH: ["CHF", "Europe/Zurich"], SE: ["SEK", "Europe/Stockholm"], NO: ["NOK", "Europe/Oslo"],
  DK: ["DKK", "Europe/Copenhagen"], PL: ["PLN", "Europe/Warsaw"], CZ: ["CZK", "Europe/Prague"], RO: ["RON", "Europe/Bucharest"],
  HU: ["HUF", "Europe/Budapest"], TR: ["TRY", "Europe/Istanbul"], UA: ["UAH", "Europe/Kyiv"], IL: ["ILS", "Asia/Jerusalem"],
  AE: ["AED", "Asia/Dubai"], SA: ["SAR", "Asia/Riyadh"], IN: ["INR", "Asia/Kolkata"], CN: ["CNY", "Asia/Shanghai"],
  JP: ["JPY", "Asia/Tokyo"], KR: ["KRW", "Asia/Seoul"], SG: ["SGD", "Asia/Singapore"], HK: ["HKD", "Asia/Hong_Kong"],
  TH: ["THB", "Asia/Bangkok"], ID: ["IDR", "Asia/Jakarta"], PH: ["PHP", "Asia/Manila"], VN: ["VND", "Asia/Ho_Chi_Minh"],
  MY: ["MYR", "Asia/Kuala_Lumpur"], AU: ["AUD", "Australia/Sydney"], NZ: ["NZD", "Pacific/Auckland"], ZA: ["ZAR", "Africa/Johannesburg"],
  NG: ["NGN", "Africa/Lagos"], KE: ["KES", "Africa/Nairobi"], EG: ["EGP", "Africa/Cairo"], MA: ["MAD", "Africa/Casablanca"],
  AO: ["AOA", "Africa/Luanda"], MZ: ["MZN", "Africa/Maputo"], CV: ["CVE", "Atlantic/Cape_Verde"],
};
const MOEDAS_BASE = ["BRL", "USD", "EUR", "GBP", "ARS", "MXN", "CLP", "COP", "PEN", "UYU", "CAD", "AUD", "CHF", "JPY"];
const FUSOS_BASE = ["America/Sao_Paulo", "America/Argentina/Buenos_Aires", "America/Bogota", "America/Mexico_City", "America/Lima", "America/Santiago", "America/New_York", "America/Los_Angeles", "Europe/Lisbon", "Europe/Madrid", "Europe/London", "UTC"];

const suportados = (tipo, base) => { try { return Intl.supportedValuesOf(tipo); } catch { return base; } };
const nomes = (lang, tipo) => { try { return new Intl.DisplayNames([lang], { type: tipo }); } catch { return null; } };

export function RegiaoEditor({ value, onChange, cls = { grid: "st-grid", f: "st-f" } }) {
  const { t, lang } = useT();
  const v = value || {};
  const set = (patch) => onChange({ ...v, ...patch });

  const paises = useMemo(() => {
    const dn = nomes(lang, "region");
    return PAISES.map((c) => ({ c, n: dn?.of(c) || c })).sort((a, b) => a.n.localeCompare(b.n, lang));
  }, [lang]);
  const moedas = useMemo(() => {
    const dn = nomes(lang, "currency");
    return [...new Set([v.moeda, ...suportados("currency", MOEDAS_BASE)])].filter(Boolean)
      .map((c) => ({ c, n: dn?.of(c) || c })).sort((a, b) => a.c.localeCompare(b.c));
  }, [lang, v.moeda]);
  const fusos = useMemo(() => [...new Set([v.fuso, ...suportados("timeZone", FUSOS_BASE), "UTC"])].filter(Boolean), [v.fuso]);

  const trocarPais = (pais) => {
    const [moeda, fuso] = DO_PAIS[pais] || [];
    set({ pais, ...(moeda ? { moeda } : {}), ...(fuso ? { fuso } : {}) });
  };

  // como dinheiro e data vão aparecer com essa escolha
  const amostra = useMemo(() => {
    try {
      const loc = `${lang}-${v.pais || "BR"}`;
      return [
        new Intl.NumberFormat(loc, { style: "currency", currency: v.moeda || "BRL" }).format(1234.56),
        new Date().toLocaleDateString(loc, { timeZone: v.fuso || undefined, day: "numeric", month: "long", year: "numeric" }),
        new Date().toLocaleTimeString(loc, { timeZone: v.fuso || undefined, hour: "2-digit", minute: "2-digit" }),
      ];
    } catch { return null; }
  }, [lang, v.pais, v.moeda, v.fuso]);

  return (
    <div className="reg">
      <div className={cls.grid}>
        <label className={cls.f}><span>{t("reg.country")}</span>
          <select value={v.pais || ""} onChange={(e) => trocarPais(e.target.value)}>
            {paises.map((p) => <option key={p.c} value={p.c}>{p.n}</option>)}
          </select>
        </label>
        <label className={cls.f}><span>{t("reg.city")}</span>
          <input value={v.cidade || ""} onChange={(e) => set({ cidade: e.target.value })} maxLength={80} />
        </label>
        <label className={cls.f}><span>{t("reg.currency")}</span>
          <select value={v.moeda || ""} onChange={(e) => set({ moeda: e.target.value })}>
            {moedas.map((m) => <option key={m.c} value={m.c}>{m.c} · {m.n}</option>)}
          </select>
        </label>
        <label className={cls.f}><span>{t("reg.tz")}</span>
          <select value={v.fuso || ""} onChange={(e) => set({ fuso: e.target.value })}>
            {fusos.map((f) => <option key={f} value={f}>{f.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <div className={cls.f}><span>{t("reg.week")}</span>
          <div className="seg">
            {[1, 0, 6].map((d) => <button key={d} type="button" aria-pressed={(v.semanaComeca ?? 1) === d} onClick={() => set({ semanaComeca: d })}>{t(`day.${d}`)}</button>)}
          </div>
        </div>
      </div>
      {amostra && (
        <dl className="reg-amostra">
          <div><dt>{t("reg.sample.money")}</dt><dd>{amostra[0]}</dd></div>
          <div><dt>{t("reg.sample.date")}</dt><dd>{amostra[1]}</dd></div>
          <div><dt>{t("reg.sample.time")}</dt><dd>{amostra[2]}</dd></div>
        </dl>
      )}
    </div>
  );
}
