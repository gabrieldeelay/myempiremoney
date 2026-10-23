/* Vozz 0.2.7 + Piper pt-BR, Apache-2.0. https://github.com/Pedro21062014/vozz */

// C:/Users/carlo/AppData/Local/Temp/atlas-vozz-inspect/package/src/g2p/numbers.js
var UNIDADES = [
  "zero",
  "um",
  "dois",
  "tr\xEAs",
  "quatro",
  "cinco",
  "seis",
  "sete",
  "oito",
  "nove"
];
var DEZ_A_DEZENOVE = [
  "dez",
  "onze",
  "doze",
  "treze",
  "quatorze",
  "quinze",
  "dezesseis",
  "dezessete",
  "dezoito",
  "dezenove"
];
var DEZENAS = [
  "",
  "",
  "vinte",
  "trinta",
  "quarenta",
  "cinquenta",
  "sessenta",
  "setenta",
  "oitenta",
  "noventa"
];
var CENTENAS = [
  "",
  "cento",
  "duzentos",
  "trezentos",
  "quatrocentos",
  "quinhentos",
  "seiscentos",
  "setecentos",
  "oitocentos",
  "novecentos"
];
var ESCALAS = [
  ["", ""],
  ["mil", "mil"],
  ["milh\xE3o", "milh\xF5es"],
  ["bilh\xE3o", "bilh\xF5es"],
  ["trilh\xE3o", "trilh\xF5es"],
  ["quatrilh\xE3o", "quatrilh\xF5es"]
];
var ORDINAIS_U = [
  "",
  "primeiro",
  "segundo",
  "terceiro",
  "quarto",
  "quinto",
  "sexto",
  "s\xE9timo",
  "oitavo",
  "nono"
];
var ORDINAIS_D = [
  "",
  "d\xE9cimo",
  "vig\xE9simo",
  "trig\xE9simo",
  "quadrag\xE9simo",
  "quinquag\xE9simo",
  "sexag\xE9simo",
  "septuag\xE9simo",
  "octog\xE9simo",
  "nonag\xE9simo"
];
var ORDINAIS_C = [
  "",
  "cent\xE9simo",
  "ducent\xE9simo",
  "trecent\xE9simo",
  "quadringent\xE9simo",
  "quingent\xE9simo",
  "seiscent\xE9simo",
  "septingent\xE9simo",
  "octingent\xE9simo",
  "noningent\xE9simo"
];
function ate999(n, feminino = false) {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const partes = [];
  const c = Math.floor(n / 100);
  const resto = n % 100;
  if (c > 0) {
    let centena = CENTENAS[c];
    if (feminino && c >= 2) centena = centena.replace(/tos$/, "tas");
    partes.push(centena);
  }
  if (resto > 0) {
    if (resto < 10) {
      partes.push(feminino ? femininizar(UNIDADES[resto]) : UNIDADES[resto]);
    } else if (resto < 20) {
      partes.push(DEZ_A_DEZENOVE[resto - 10]);
    } else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      if (u === 0) partes.push(DEZENAS[d]);
      else partes.push(`${DEZENAS[d]} e ${feminino ? femininizar(UNIDADES[u]) : UNIDADES[u]}`);
    }
  }
  return partes.join(" e ");
}
function femininizar(palavra) {
  if (palavra === "um") return "uma";
  if (palavra === "dois") return "duas";
  return palavra;
}
function inteiroPorExtenso(valor, opts = {}) {
  const { feminino = false } = opts;
  let n = typeof valor === "string" ? BigInt(valor.replace(/\D/g, "") || "0") : BigInt(Math.trunc(Number(valor)));
  let negativo = false;
  if (n < 0n) {
    negativo = true;
    n = -n;
  }
  if (n === 0n) return negativo ? "menos zero" : "zero";
  const grupos = [];
  while (n > 0n) {
    grupos.push(Number(n % 1000n));
    n /= 1000n;
  }
  if (grupos.length > ESCALAS.length) {
    return soletrarDigitos(String(valor));
  }
  const trechos = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (g === 0) continue;
    if (i === 1) {
      trechos.push(g === 1 ? "mil" : `${ate999(g, feminino)} mil`);
    } else if (i === 0) {
      trechos.push(ate999(g, feminino));
    } else {
      const [sing, plur] = ESCALAS[i];
      trechos.push(`${ate999(g, false)} ${g === 1 ? sing : plur}`);
    }
  }
  let texto = juntarTrechos(trechos, grupos);
  if (negativo) texto = `menos ${texto}`;
  return texto;
}
function juntarTrechos(trechos, grupos) {
  if (trechos.length === 1) return trechos[0];
  const ultimo = grupos[0];
  const out = trechos.slice(0, -1).join(", ");
  if (ultimo > 0 && (ultimo < 100 || ultimo % 100 === 0)) {
    return `${out} e ${trechos[trechos.length - 1]}`;
  }
  return `${out}, ${trechos[trechos.length - 1]}`;
}
function decimalPorExtenso(inteiro, fracao, opts = {}) {
  const parteInt = inteiroPorExtenso(inteiro, opts);
  if (!fracao) return parteInt;
  const limpa = fracao.replace(/0+$/, "") === "" ? "0" : fracao;
  const zerosIniciais = /^0+/.exec(limpa)?.[0]?.length ?? 0;
  const resto = limpa.slice(zerosIniciais);
  const ditos = [];
  for (let i = 0; i < zerosIniciais; i++) ditos.push("zero");
  if (resto) ditos.push(inteiroPorExtenso(resto, opts));
  return `${parteInt} v\xEDrgula ${ditos.join(" ")}`;
}
function ordinalPorExtenso(n, opts = {}) {
  const { feminino = false } = opts;
  n = Math.trunc(Number(n));
  if (n <= 0 || n > 999) return inteiroPorExtenso(n, opts);
  const partes = [];
  const c = Math.floor(n / 100);
  const d = Math.floor(n % 100 / 10);
  const u = n % 10;
  if (c) partes.push(ORDINAIS_C[c]);
  if (d) partes.push(ORDINAIS_D[d]);
  if (u) partes.push(ORDINAIS_U[u]);
  let texto = partes.join(" ");
  if (feminino) texto = texto.replace(/o\b/g, "a");
  return texto;
}
function soletrarDigitos(str) {
  return String(str).split("").map((c) => /\d/.test(c) ? UNIDADES[Number(c)] : c === "-" ? "" : c).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}
function anoPorExtenso(n) {
  return inteiroPorExtenso(n);
}

// C:/Users/carlo/AppData/Local/Temp/atlas-vozz-inspect/package/src/g2p/normalize.js
var MESES = [
  "janeiro",
  "fevereiro",
  "mar\xE7o",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro"
];
var ABREVIACOES = new Map(Object.entries({
  "sr.": "senhor",
  "sr": "senhor",
  "sra.": "senhora",
  "sra": "senhora",
  "srta.": "senhorita",
  "dr.": "doutor",
  "dra.": "doutora",
  "prof.": "professor",
  "profa.": "professora",
  "eng.": "engenheiro",
  "av.": "avenida",
  "r.": "rua",
  "p\xE7.": "pra\xE7a",
  "ed.": "edif\xEDcio",
  "apto.": "apartamento",
  "ap.": "apartamento",
  "p\xE1g.": "p\xE1gina",
  "pag.": "p\xE1gina",
  "p\xE1gs.": "p\xE1ginas",
  "fig.": "figura",
  "obs.": "observa\xE7\xE3o",
  "ex.": "exemplo",
  "etc.": "etc\xE9tera",
  "etc": "etc\xE9tera",
  "cia.": "companhia",
  "ltda.": "limitada",
  "s.a.": "sociedade an\xF4nima",
  "n\xFAm.": "n\xFAmero",
  "n\xBA": "n\xFAmero",
  "n\xB0": "n\xFAmero",
  "no.": "n\xFAmero",
  "tel.": "telefone",
  "cel.": "celular",
  "kg": "quilogramas",
  "km": "quil\xF4metros",
  "km/h": "quil\xF4metros por hora",
  "cm": "cent\xEDmetros",
  "mm": "mil\xEDmetros",
  "ml": "mililitros",
  "mg": "miligramas",
  "gb": "gigabytes",
  "mb": "megabytes",
  "kb": "kilobytes",
  "tb": "terabytes"
}));
var SIMBOLOS = new Map(Object.entries({
  "%": " por cento ",
  "&": " e ",
  "@": " arroba ",
  "+": " mais ",
  "=": " igual a ",
  "\u20AC": " euros ",
  "\xA3": " libras ",
  "\xA9": " copyright ",
  "\xAE": " marca registrada ",
  "\xB0c": " graus celsius ",
  "\xB0f": " graus fahrenheit ",
  "\xBA": " graus ",
  "#": " cerquilha ",
  "/": " barra ",
  "\\": " barra invertida ",
  "*": " asterisco ",
  "_": " ",
  "~": " ",
  "^": " ",
  "|": " "
}));
var SIGLAS_PALAVRA = /* @__PURE__ */ new Set([
  "onu",
  "otan",
  "fifa",
  "ibama",
  "inss",
  "cpf",
  "cep",
  "brics",
  "mercosul",
  "petrobras",
  "embraer",
  "unesco",
  "unicef",
  "senai",
  "sesc",
  "usp",
  "puc",
  "enem",
  "sus",
  "detran",
  "procon",
  "ipva",
  "fies",
  "prouni",
  "sisu"
]);
var LETRAS_FALADAS = {
  a: "\xE1",
  b: "b\xEA",
  c: "c\xEA",
  d: "d\xEA",
  e: "\xE9",
  f: "\xE9fe",
  g: "g\xEA",
  h: "ag\xE1",
  i: "i",
  j: "jota",
  k: "c\xE1",
  l: "\xE9le",
  m: "\xEAme",
  n: "\xEAne",
  o: "\xF3",
  p: "p\xEA",
  q: "qu\xEA",
  r: "\xE9rre",
  s: "\xE9sse",
  t: "t\xEA",
  u: "u",
  v: "v\xEA",
  w: "d\xE1bliu",
  x: "xis",
  y: "\xEDpsilon",
  z: "z\xEA"
};
function soletrarSigla(sigla) {
  return sigla.toLowerCase().split("").map((c) => LETRAS_FALADAS[c] ?? c).join(" ");
}
function normalizar(texto, opts = {}) {
  const { expandirNumeros = true, expandirSiglas = true } = opts;
  let t = String(texto ?? "");
  t = t.normalize("NFC");
  t = t.replace(/[\u2018\u2019\u02BC]/g, "'");
  t = t.replace(/[\u201C\u201D\u00AB\u00BB]/g, '"');
  t = t.replace(/[\u2013\u2014\u2212]/g, "\u2014");
  t = t.replace(/\u2026/g, "...");
  t = t.replace(/[\t\f\v\u00A0\u200B]/g, " ");
  t = t.replace(/https?:\/\/(?:www\.)?([^\s/]+)\S*/gi, (_, dom) => ` ${dom.replace(/\./g, " ponto ")} `);
  t = t.replace(/\b([\w.+-]+)@([\w.-]+)\b/g, (_, u, d) => ` ${u.replace(/\./g, " ponto ")} arroba ${d.replace(/\./g, " ponto ")} `);
  t = t.replace(/\b(\d{1,2})\s*[h:]\s*(\d{2})\b(?!\s*[:h])/gi, (_, h, m) => {
    const hh = Number(h), mm = Number(m);
    const hora = `${inteiroPorExtenso(hh, { feminino: true })} ${hh === 1 ? "hora" : "horas"}`;
    if (mm === 0) return ` ${hora} `;
    return ` ${hora} e ${inteiroPorExtenso(mm)} ${mm === 1 ? "minuto" : "minutos"} `;
  });
  t = t.replace(/\b(\d{1,2})\s*h\b/gi, (_, h) => {
    const hh = Number(h);
    return ` ${inteiroPorExtenso(hh, { feminino: true })} ${hh === 1 ? "hora" : "horas"} `;
  });
  t = t.replace(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/g, (m, d, mo, y) => {
    const dia = Number(d), mes = Number(mo);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return m;
    const diaTxt = dia === 1 ? "primeiro" : inteiroPorExtenso(dia);
    return ` ${diaTxt} de ${MESES[mes - 1]} de ${anoPorExtenso(y)} `;
  });
  t = t.replace(/R\$\s?([\d.]+)(?:,(\d{1,2}))?/gi, (_, int, cent) => {
    const i = int.replace(/\./g, "");
    const n = Number(i);
    let out = ` ${inteiroPorExtenso(i)} ${n === 1 ? "real" : "reais"}`;
    if (cent && Number(cent) > 0) {
      const c = Number(cent.padEnd(2, "0"));
      out += ` e ${inteiroPorExtenso(c)} ${c === 1 ? "centavo" : "centavos"}`;
    }
    return `${out} `;
  });
  t = t.replace(/US\$\s?([\d.]+)(?:,(\d{1,2}))?/gi, (_, int) => ` ${inteiroPorExtenso(int.replace(/\./g, ""))} d\xF3lares `);
  t = t.replace(/(\d+(?:,\d+)?)\s*%/g, (_, n) => {
    const [i, f] = n.split(",");
    return ` ${f ? decimalPorExtenso(i, f) : inteiroPorExtenso(i)} por cento `;
  });
  t = t.replace(/(\d+)\s*°\s*C\b/gi, (_, n) => ` ${inteiroPorExtenso(n)} graus celsius `);
  t = t.replace(/\b(\d{1,3})\s*([ºª°])/g, (_, n, marca) => ` ${ordinalPorExtenso(n, { feminino: marca === "\xAA" })} `);
  t = t.replace(/\(?\b(\d{2})\)?\s?9?\d{4}-\d{4}\b/g, (m) => ` ${soletrarDigitos(m.replace(/[()]/g, ""))} `);
  if (expandirNumeros) {
    t = t.replace(/\b(\d{1,3}(?:\.\d{3})+|\d+),(\d+)\b/g, (_, i, f) => ` ${decimalPorExtenso(i.replace(/\./g, ""), f)} `);
    t = t.replace(/\b\d{1,3}(?:\.\d{3})+\b/g, (m) => ` ${inteiroPorExtenso(m.replace(/\./g, ""))} `);
    t = t.replace(/\d+/g, (m) => ` ${inteiroPorExtenso(m)} `);
  }
  t = t.replace(/\b([a-zà-ÿ]{1,6}\.?)/gi, (m) => {
    const chave = m.toLowerCase();
    return ABREVIACOES.has(chave) ? ABREVIACOES.get(chave) : m;
  });
  if (expandirSiglas) {
    t = t.replace(/\b[A-ZÀ-Þ]{2,6}\b/g, (m) => {
      const baixa = m.toLowerCase();
      if (SIGLAS_PALAVRA.has(baixa)) return baixa;
      if (/[AEIOUÀ-Þ]/.test(m) && m.length >= 4 && /^[A-ZÀ-Þ]*[AEIOU][A-ZÀ-Þ]*$/.test(m) === false) {
        return baixa;
      }
      return ` ${soletrarSigla(m)} `;
    });
  }
  for (const [sim, txt] of SIMBOLOS) {
    t = t.split(sim).join(txt);
  }
  t = t.replace(/ {2,}/g, " ").trim();
  return t;
}

// C:/Users/carlo/AppData/Local/Temp/atlas-vozz-inspect/package/src/g2p/lexicon.js
var CLITICOS = new Map(Object.entries({
  a: "a",
  as: "as",
  o: "\u028A",
  os: "\u028As",
  um: "u\u0303\u014B",
  uns: "u\u0303\u014Bs",
  uma: "um\xE6",
  umas: "um\xE6s",
  de: "d\u0292y",
  do: "d\u028A",
  da: "da",
  dos: "d\u028As",
  das: "das",
  em: "e\u026A\u014B",
  no: "n\u028A",
  na: "na",
  nos: "n\u028As",
  nas: "nas",
  num: "nu\u0303\u014B",
  numa: "num\xE6",
  por: "por",
  pelo: "pel\u028A",
  pela: "pel\xE6",
  pelos: "pel\u028As",
  pelas: "pel\xE6s",
  ao: "a\u028A",
  aos: "a\u028As",
  \u00E0: "a",
  \u00E0s: "as",
  e: "i",
  ou: "o\u028A",
  que: "ky",
  se: "sy",
  me: "my",
  te: "t\u0283y",
  lhe: "\u028Ey",
  nos_: "n\u028As",
  vos: "vus",
  com: "ko\u014B",
  sem: "se\u026A\u014B",
  para: "pa\u027E\xE6",
  pra: "pra",
  \u00E9: "\u025B",
  \u00E0s_: "as"
}));
var LEXICO = new Map(Object.entries({
  // --- verbos e palavras funcionais de alta frequência ---
  n\u00E3o: "n\u02C8\u0250\u0303\u028A\u0303",
  sim: "s\u02C8i\u014B",
  tamb\u00E9m: "t\u0250\u0303mb\u02C8e\u026A\u014B",
  ent\u00E3o: "e\u026A\u014Bt\u02C8\u0250\u0303\u028A\u0303",
  muito: "mw\u02C8i\u014Bt\u028A",
  muita: "mw\u02C8i\u014Bt\xE6",
  muitos: "mw\u02C8i\u014Bt\u028As",
  muitas: "mw\u02C8i\u014Bt\xE6s",
  bem: "b\u02C8e\u026A\u014B",
  tem: "t\u02C8e\u026A\u014B",
  t\u00EAm: "t\u02C8e\u026A\u014B",
  vem: "v\u02C8e\u026A\u014B",
  s\u00E3o: "s\u02C8\u0250\u0303\u028A\u0303",
  est\u00E3o: "est\u02C8\u0250\u0303\u028A\u0303",
  est\u00E1: "est\u02C8a",
  estou: "est\u02C8ow",
  ser: "s\u02C8er",
  ter: "t\u02C8er",
  ver: "v\u02C8er",
  vir: "v\u02C8ir",
  p\u00F4r: "p\u02C8or",
  fazer: "faz\u02C8er",
  dizer: "d\u0292iz\u02C8er",
  poder: "pod\u02C8er",
  querer: "ke\u027E\u02C8er",
  hoje: "\u02C8o\u0292y",
  ontem: "\u02C8o\u014Bte\u026A\u014B",
  amanh\u00E3: "\u02CC\xE6m\u0250\u0303\u0272\u02C8\u0250\u0303",
  agora: "\u02CCa\u0261\u02C8\u0254\u027E\xE6",
  depois: "dep\u02C8o\u026As",
  antes: "\u02C8\u0250\u0303\u014Bt\u0283ys",
  sempre: "s\u02C8e\u026Ampry",
  nunca: "n\u02C8u\u0303\u014Bk\xE6",
  ainda: "\u02CCa\u02C8i\u014Bd\xE6",
  aqui: "ak\u02C8i",
  ali: "al\u02C8i",
  l\u00E1: "l\u02C8a",
  c\u00E1: "k\u02C8a",
  j\u00E1: "\u0292\u02C8a",
  s\u00F3: "s\u02C8\u0254",
  at\u00E9: "\u025Ba\u0261ud\u028A",
  ap\u00F3s: "ap\u02C8\u0254s",
  mais: "m\u02C8a\u026As",
  mas: "m\u02C8as",
  menos: "m\u02C8en\u028As",
  onde: "\u02C8o\u014Bd\u0292y",
  quando: "kw\u02C8\u0250\u0303\u014Bd\u028A",
  como: "k\u02C8om\u028A",
  porque: "p\u02C8o\u027E\u0259ky",
  porqu\u00EA: "po\u027E\u0259k\u02C8e",
  quem: "k\u02C8e\u026A\u014B",
  qual: "kw\u02C8a\u028A",
  quais: "kw\u02C8a\u026As",
  quanto: "kw\u02C8\u0250\u0303\u014Bt\u028A",
  todo: "t\u02C8od\u028A",
  toda: "t\u02C8od\xE6",
  todos: "t\u02C8od\u028As",
  todas: "t\u02C8od\xE6s",
  outro: "\u02C8owtr\u028A",
  outra: "\u02C8owtr\xE6",
  mesmo: "m\u02C8ezm\u028A",
  mesma: "m\u02C8ezm\xE6",
  cada: "k\u02C8ad\xE6",
  algum: "a\u028A\u0261\u02C8u\u0303\u014B",
  alguma: "\u02CCa\u028A\u0261\u02C8um\xE6",
  nada: "n\u02C8ad\xE6",
  tudo: "t\u02C8ud\u028A",
  algo: "\u02C8a\u028A\u0261\u028A",
  ele: "\u02C8ely",
  ela: "\u02C8\u025Bl\xE6",
  eles: "\u02C8elys",
  elas: "\u02C8\u025Bl\xE6s",
  eu: "\u02C8e\u028A",
  tu: "t\u02C8u",
  n\u00F3s: "n\u02C8\u0254s",
  v\u00F3s: "v\u02C8\u0254s",
  voc\u00EA: "vos\u02C8e",
  voc\u00EAs: "vos\u02C8es",
  gente: "\u0292\u02C8e\u026A\u014Bt\u0283y",
  isso: "\u02C8is\u028A",
  isto: "\u02C8ist\u028A",
  aquilo: "\u02CCak\u02C8il\u028A",
  esse: "\u02C8esi",
  essa: "\u02C8\u025Bs\xE6",
  este: "\u02C8est\u0283y",
  esta: "\u02C8\u025Bst\xE6",
  meu: "m\u02C8e\u028A",
  minha: "m\u02C8i\u0272\xE6",
  seu: "s\u02C8e\u028A",
  sua: "s\u02C8u\xE6",
  nosso: "n\u02C8\u0254s\u028A",
  nossa: "n\u02C8\u0254s\xE6",
  obrigado: "\u02CCobri\u0261\u02C8ad\u028A",
  obrigada: "\u02CCobri\u0261\u02C8ad\xE6",
  favor: "fav\u02C8or",
  desculpa: "d\u02CCesk\u02C8uwp\xE6",
  oi: "\u02C8o\u026A",
  ol\u00E1: "ol\u02C8a",
  tchau: "t\u0283\u02C8a\u028A",
  bom: "b\u02C8o\u014B",
  boa: "b\u02C8o\xE6",
  boas: "b\u02C8o\xE6s",
  bons: "b\u02C8o\u014Bs",
  dia: "d\u0292\u02C8i\xE6",
  dias: "d\u0292\u02C8i\xE6s",
  noite: "n\u02C8o\u026At\u0283y",
  tarde: "t\u02C8a\u027E\u0259d\u0292y",
  ano: "\u02C8\u0250\u0303n\u028A",
  anos: "\u02C8\u0250\u0303n\u028As",
  m\u00EAs: "m\u02C8es",
  hora: "\u02C8\u0254\u027E\xE6",
  horas: "\u02C8\u0254\u027E\xE6s",
  vez: "v\u02C8es",
  vezes: "v\u02C8ezys",
  coisa: "k\u02C8o\u026Az\xE6",
  coisas: "k\u02C8o\u026Az\xE6s",
  pessoa: "p\u02CCes\u02C8o\xE6",
  pessoas: "p\u02CCes\u02C8o\xE6s",
  brasil: "braz\u02C8i\u028A",
  brasileiro: "br\u02CCazil\u02C8e\u026A\u027E\u028A",
  brasileira: "br\u02CCazil\u02C8e\u026A\u027E\xE6",
  portugu\u00EAs: "p\u02CCo\u027E\u0259tu\u0261\u02C8es",
  portuguesa: "p\u02CCo\u027E\u0259tu\u0261\u02C8ez\xE6",
  senhor: "se\u0272\u02C8or",
  senhora: "s\u02CCe\u0272\u02C8\u0254\u027E\xE6",
  // --- vogais tônicas abertas imprevisíveis ---
  caf\u00E9: "kaf\u02C8\u025B",
  p\u00E9: "p\u02C8\u025B",
  f\u00E9: "f\u02C8\u025B",
  n\u00E9: "n\u02C8\u025B",
  av\u00F3: "av\u02C8\u0254",
  av\u00F4: "av\u02C8o",
  vov\u00F3: "vov\u02C8\u0254",
  vov\u00F4: "vov\u02C8o",
  hist\u00F3ria: "\u02CCist\u02C8\u0254\u027Ej\xE6",
  mem\u00F3ria: "m\u02CCem\u02C8\u0254\u027Ej\xE6",
  vit\u00F3ria: "v\u02CCit\u02C8\u0254\u027Ej\xE6",
  poss\u00EDvel: "p\u02CCos\u02C8ive\u028A",
  dif\u00EDcil: "d\u0292\u02CCif\u02C8isi\u028A",
  f\u00E1cil: "f\u02C8asi\u028A",
  \u00FAtil: "\u02C8ut\u0283i\u028A",
  n\u00EDvel: "n\u02C8ive\u028A",
  m\u00F3vel: "m\u02C8\u0254v\u025B\u028A",
  novo: "n\u02C8ov\u028A",
  nova: "n\u02C8\u0254v\xE6",
  novos: "n\u02C8\u0254v\u028As",
  novas: "n\u02C8\u0254v\xE6s",
  jogo: "\u0292\u02C8o\u0261\u028A",
  jogos: "\u0292\u02C8\u0254\u0261\u028As",
  porco: "p\u02C8o\u027E\u0259k\u028A",
  corpo: "k\u02C8o\u027E\u0259p\u028A",
  for\u00E7a: "f\u02C8o\u027E\u0259s\xE6",
  morte: "m\u02C8\u0254\u027E\u0259t\u0283y",
  sorte: "s\u02C8\u0254\u027E\u0259t\u0283y",
  sol: "s\u02C8\u0254l",
  mar: "m\u02C8ar",
  flor: "fl\u02C8or",
  cor: "k\u02C8or",
  melhor: "melj\u02C8\u0254r",
  pior: "pi\u02C8\u0254r",
  maior: "ma\u026A\u02C8\u0254r",
  amor: "\xE6m\u02C8or",
  dor: "d\u02C8or",
  calor: "kal\u02C8or",
  papel: "pap\u02C8\u025B\u028A",
  anel: "\u0250\u0303n\u02C8\u025B\u028A",
  hotel: "ot\u02C8\u025B\u028A",
  \u00E1gua: "\u02C8a\u0261w\xE6",
  l\u00EDngua: "l\u02C8i\u014B\u0261w\xE6",
  antigo: "\u02CC\u0250\u0303\u014Bt\u0283\u02C8i\u0261\u028A",
  // --- dígrafos e grupos difíceis ---
  exemplo: "\u02CCez\u02C8e\u026Ampl\u028A",
  exato: "\u02CCez\u02C8at\u028A",
  exame: "\u02CCez\u02C8\u0250\u0303my",
  texto: "t\u02C8est\u028A",
  pr\u00F3ximo: "pr\u02C8\u0254sim\u028A",
  m\u00E1ximo: "m\u02C8asim\u028A",
  sexta: "s\u02C8est\xE6",
  excelente: "\u02CCesel\u02C8e\u026A\u014Bt\u0283y",
  exerc\u00EDcio: "\u02CCeze\u027E\u0259s\u02C8isj\u028A",
  t\u00E1xi: "t\u02C8aksi",
  fixo: "f\u02C8iks\u028A",
  sexo: "s\u02C8\u025Bks\u028A",
  peixe: "p\u02C8e\u026A\u0283y",
  caixa: "k\u02C8a\u026A\u0283\xE6",
  baixo: "b\u02C8a\u026A\u0283\u028A",
  trabalho: "tr\u02CCab\u02C8alj\u028A",
  filho: "f\u02C8ilj\u028A",
  filha: "f\u02C8ilj\xE6",
  velho: "v\u02C8\u025Blj\u028A",
  olho: "\u02C8\u0254lj\u028A",
  milho: "m\u02C8ilj\u028A",
  vinho: "v\u02C8i\u0272\u028A",
  sonho: "s\u02C8o\u0272\u028A",
  banho: "b\u02C8\u0250\u0303\u0272\u028A",
  tenho: "t\u02C8e\u0272\u028A",
  venho: "v\u02C8e\u0272\u028A",
  ganho: "\u0261\u02C8\u0250\u0303\u0272\u028A",
  carro: "k\u02C8ax\u028A",
  caro: "k\u02C8a\u027E\u028A",
  terra: "t\u02C8\u025Bx\xE6",
  cara: "k\u02C8a\u027E\xE6",
  guerra: "\u0261\u02C8\u025Bx\xE6",
  cachorro: "k\u02CCa\u0283\u02C8ox\u028A",
  correr: "kox\u02C8er",
  raz\u00E3o: "xaz\u02C8\u0250\u0303\u028A\u0303",
  cora\u00E7\u00E3o: "k\u02CCo\u027Eas\u02C8\u0250\u0303\u028A\u0303",
  na\u00E7\u00E3o: "nas\u02C8\u0250\u0303\u028A\u0303",
  m\u00E3e: "m\u02C8\u0250\u0303y",
  p\u00E3o: "p\u02C8\u0250\u0303\u028A\u0303",
  c\u00E3o: "k\u02C8\u0250\u0303\u028A\u0303",
  irm\u00E3o: "i\u027E\u0259m\u02C8\u0250\u0303\u028A\u0303",
  alem\u00E3o: "\u02CCalem\u02C8\u0250\u0303\u028A\u0303",
  ver\u00E3o: "ve\u027E\u02C8\u0250\u0303\u028A\u0303",
  // --- tecnologia / estrangeirismos ---
  site: "s\u02C8a\u026At\u0283y",
  email: "\u02CCema\u02C8i\u028A",
  online: "o\u014Bl\u02C8a\u026A\u014B",
  software: "s\u02C8\u0254ftwe\u0259",
  hardware: "x\u02C8a\u027Ediw\u025B\u027E",
  mouse: "m\u02C8a\u028Azi",
  internet: "\u02CCi\u014Bte\u027E\u0259n\u02C8\u025Bt\u0283",
  wifi: "wif\u02C8i",
  app: "\u02C8ap",
  // Siglas técnicas lidas letra a letra (sem vogal, o G2P as leria como palavra).
  npm: "\u02C8eni p\u02C8e \u02C8emi",
  api: "\u02CCapi\u02C8i",
  url: "\u02CCu\u02C8\u025Bli",
  css: "s\u02C8e \u02C8esi \u02C8esi",
  html: "\u02CCa\u0261\u02C8a t\u02C8e \u02C8emi \u02C8\u025Bli",
  sql: "\u02CC\u025Bsi k\u02C8u \u02C8\u025Bli",
  cli: "s\u02C8e \u02C8\u025Bli \u02C8i",
  json: "\u0292\u02C8ejz\xF5\u014B",
  npx: "\u02C8eni p\u02C8e \u0283\u02C8is",
  smartphone: "zm\u02CCa\u027E\u0259tf\u02C8ony",
  link: "l\u02C8i\u014Bk",
  download: "da\u028A\u014Bl\u02C8owd",
  design: "dez\u02C8a\u026An",
  startup: "sta\u027E\u0259t\u02C8up",
  feedback: "f\u02CCeedb\u02C8ak",
  google: "\u0261\u02C8u\u0261ol",
  youtube: "j\u02CCowt\u02C8uby",
  whatsapp: "wats\u02C8ap"
}));
function buscarLexico(palavra) {
  const chave = palavra.toLowerCase();
  if (LEXICO.has(chave)) return LEXICO.get(chave);
  return null;
}
function buscarClitico(palavra) {
  const chave = palavra.toLowerCase();
  return CLITICOS.has(chave) ? CLITICOS.get(chave) : null;
}

// C:/Users/carlo/AppData/Local/Temp/atlas-vozz-inspect/package/src/g2p/index.js
var FORTES = "aeo\xE1\xE9\xF3\xE2\xEA\xF4\xE3\xF5\xE0";
var FRACAS = "iu";
var FRACAS_ACENT = "\xED\xFA\xEF";
var VOGAIS = FORTES + FRACAS + FRACAS_ACENT + "\xFC";
var ACENTO_GRAFICO = "\xE1\xE9\xED\xF3\xFA\xE2\xEA\xF4";
var TIL = "\xE3\xF5";
var eVogal = (c) => !!c && VOGAIS.includes(c);
var eFraca = (c) => !!c && FRACAS.includes(c);
var DIGRAFOS = ["ch", "lh", "nh", "rr", "ss", "qu", "gu"];
var OBSTRUINTES = "pbtdkgfvc";
function segmentar(p) {
  const un = [];
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if (eVogal(c)) {
      un.push({ tipo: "V", txt: c });
      i++;
      continue;
    }
    const par = p.slice(i, i + 2);
    if ((par === "qu" || par === "gu") && "ei\xE9\xEA\xED\xEC".includes(p[i + 2] ?? "")) {
      un.push({ tipo: "C", txt: par });
      i += 2;
      continue;
    }
    if (DIGRAFOS.includes(par)) {
      un.push({ tipo: "C", txt: par });
      i += 2;
      continue;
    }
    un.push({ tipo: "C", txt: c });
    i++;
  }
  return un;
}
function silabificar(palavra) {
  const p = String(palavra).toLowerCase();
  const un = segmentar(p);
  if (!un.length) return [];
  const nucleos = [];
  const consAntes = [];
  let buffer = [];
  for (let i = 0; i < un.length; i++) {
    const u = un[i];
    if (u.tipo === "C") {
      buffer.push(u.txt);
      continue;
    }
    const vogais = [u.txt];
    const prox = un[i + 1];
    if (prox && prox.tipo === "V" && eFraca(prox.txt)) {
      const depois = un[i + 2];
      const proxProx = depois && depois.tipo === "V";
      if (!(eFraca(u.txt) && eFraca(prox.txt) && proxProx)) {
        vogais.push(prox.txt);
        i++;
      }
    }
    nucleos.push({ vogais });
    consAntes.push(buffer);
    buffer = [];
  }
  const consFinais = buffer;
  if (!nucleos.length) {
    return [{ onset: [], nucleo: [], coda: consFinais, tonica: true }];
  }
  const silabas = (
    /** @type {Silaba[]} */
    []
  );
  for (let s = 0; s < nucleos.length; s++) {
    silabas.push({ onset: [], nucleo: nucleos[s].vogais, coda: [] });
  }
  silabas[0].onset = consAntes[0];
  for (let s = 1; s < nucleos.length; s++) {
    const grupo = consAntes[s];
    if (grupo.length === 0) continue;
    if (grupo.length === 1) {
      silabas[s].onset = [grupo[0]];
      continue;
    }
    const ult = grupo[grupo.length - 1];
    const penult = grupo[grupo.length - 2];
    const clusterValido = (ult === "l" || ult === "r") && penult.length === 1 && OBSTRUINTES.includes(penult);
    if (clusterValido) {
      silabas[s - 1].coda = grupo.slice(0, -2);
      silabas[s].onset = [penult, ult];
    } else {
      silabas[s - 1].coda = grupo.slice(0, -1);
      silabas[s].onset = [ult];
    }
  }
  silabas[silabas.length - 1].coda = consFinais;
  return silabas;
}
function acentuar(sil, palavra) {
  if (!sil.length) return -1;
  for (let i = 0; i < sil.length; i++) {
    if (sil[i].nucleo.some((v) => ACENTO_GRAFICO.includes(v))) {
      sil[i].tonica = true;
      return i;
    }
  }
  if (sil.length === 1) {
    sil[0].tonica = true;
    return 0;
  }
  const ultima = sil[sil.length - 1];
  if (ultima.nucleo.some((v) => TIL.includes(v))) {
    ultima.tonica = true;
    return sil.length - 1;
  }
  const nucUlt = ultima.nucleo.join("");
  const codaUlt = ultima.coda.join("");
  const term = nucUlt + codaUlt;
  const oxitona = (
    // terminações consonantais r, l, z, x, n
    /^[rlzxn]$/.test(codaUlt) || // "-ais/-eis/-óis": ditongo + s (papéis, reais)
    codaUlt === "s" && ultima.nucleo.length === 2 || // "-im/-um/-ins/-uns"
    /^(i|u)(m|ns|m s)?$/.test(term) && /m|ns/.test(codaUlt) || // tônica em i/u finais (ex.: caqui, urubu) quando sem coda
    codaUlt === "" && /[iu]$/.test(nucUlt) && nucUlt.length === 1
  );
  const paroxitonaForcada = /^(em|ens|am|ams)$/.test(term) || /^(am|em|ens)$/.test(nucUlt + codaUlt);
  if (oxitona && !paroxitonaForcada) {
    ultima.tonica = true;
    return sil.length - 1;
  }
  const idx = sil.length - 2;
  sil[idx].tonica = true;
  return idx;
}
function acentoSecundario(sil, iTon) {
  if (sil.length < 3 || iTon <= 1) return;
  sil[0].secundaria = true;
}
var NASALIZAVEL = /* @__PURE__ */ new Set(["m", "n"]);
function nucleoNasal(v) {
  switch (v) {
    case "a":
    case "\xE1":
    case "\xE0":
    case "\xE2":
    case "\xE3":
      return "\u0250\u0303";
    case "e":
    case "\xE9":
    case "\xEA":
      return "e\u026A";
    case "i":
    case "\xED":
      return "i";
    case "o":
    case "\xF3":
    case "\xF4":
    case "\xF5":
      return "o";
    case "u":
    case "\xFA":
      return "\u0169";
    default:
      return v;
  }
}
function vogalOral(v, { tonica, finalPalavra, pretonicaNasal }) {
  switch (v) {
    // "a" pretônico diante de nasal reduz para [æ] (banana, caneta, amarelo).
    case "a":
      return finalPalavra && !tonica || pretonicaNasal ? "\xE6" : "a";
    case "\xE1":
    case "\xE0":
      return "a";
    case "\xE2":
      return "\u0250";
    case "\xE3":
      return "\u0250\u0303";
    case "e":
      return finalPalavra && !tonica ? "y" : "e";
    case "\xE9":
      return "\u025B";
    case "\xEA":
      return "e";
    case "i":
    case "\xED":
      return "i";
    case "o":
      return finalPalavra && !tonica ? "\u028A" : "o";
    case "\xF3":
      return "\u0254";
    case "\xF4":
      return "o";
    case "\xF5":
      return "\xF5";
    case "u":
    case "\xFA":
    case "\xFC":
      return "u";
    default:
      return v;
  }
}
function offglide(v, nasal) {
  if (v === "i" || v === "\xED") return nasal ? "\u026A\u0303" : "\u026A";
  if (v === "u" || v === "\xFA") return nasal ? "\u028A\u0303" : "\u028A";
  if (v === "o") return nasal ? "\u028A\u0303" : "\u028A";
  if (v === "e") return nasal ? "\u026A\u0303" : "\u026A";
  return v;
}
function mapearNucleo(sil, ctx) {
  const { tonica = false } = sil;
  const { finalPalavra, nasalPorCoda, pretonicaNasal = false } = ctx;
  const vs = sil.nucleo;
  if (!vs.length) return "";
  const temTil = vs.some((v) => TIL.includes(v));
  const nasal = nasalPorCoda || temTil;
  if (vs.length === 2 && temTil) {
    const [a2, b2] = vs;
    const base2 = nucleoNasal(a2);
    if (b2 === "o" || b2 === "u") return `${base2}\u028A\u0303`;
    if (b2 === "e" || b2 === "i") return `${base2}\u026A\u0303`;
    return base2 + offglide(b2, true);
  }
  if (vs.length === 1) {
    const v = vs[0];
    if (nasal) return nucleoNasal(v);
    return vogalOral(v, { tonica, finalPalavra, pretonicaNasal });
  }
  const [a, b] = vs;
  if (a === "o" && b === "u") return "o\u028A";
  const base = nasal ? nucleoNasal(a) : vogalOral(a, { tonica, finalPalavra: false, pretonicaNasal });
  return base + offglide(b, nasal);
}
function nasalCoda(proxOnset) {
  const c = (proxOnset ?? "")[0] ?? "";
  return c !== "" && "pbm".includes(c) ? "m" : "\u014B";
}
function mapearOnset(cons, ctx) {
  const { nucleoIPA, inicioPalavra, codaAnterior } = ctx;
  let out = "";
  for (let i = 0; i < cons.length; i++) {
    const c = cons[i];
    const proximaCons = cons[i + 1];
    const primeiro = i === 0;
    const vSeg = nucleoIPA[0] ?? "";
    const brando = "i\u026Ae\u025By".includes(vSeg) && !proximaCons;
    switch (c) {
      case "ch":
        out += "\u0283";
        break;
      case "lh":
        out += "lj";
        break;
      case "nh":
        out += "\u0272";
        break;
      case "rr":
        out += "x";
        break;
      case "ss":
        out += "s";
        break;
      case "qu":
        out += "k";
        break;
      case "gu":
        out += "\u0261";
        break;
      case "b":
        out += "b";
        break;
      case "c":
        out += brando ? "s" : "k";
        break;
      case "\xE7":
        out += "s";
        break;
      case "d":
        out += "i\u026A".includes(vSeg) || vSeg === "y" ? proximaCons ? "d" : "d\u0292" : "d";
        break;
      case "f":
        out += "f";
        break;
      case "g":
        out += brando ? "\u0292" : "\u0261";
        break;
      case "h":
        break;
      case "j":
        out += "\u0292";
        break;
      case "k":
        out += "k";
        break;
      case "l":
        out += "l";
        break;
      case "m":
        out += "m";
        break;
      case "n":
        out += "n";
        break;
      case "p":
        out += "p";
        break;
      case "q":
        out += "k";
        break;
      case "r":
        if (primeiro && (inicioPalavra || /[nlsɾ]$/.test(codaAnterior))) out += "x";
        else if (primeiro && codaAnterior === "") out += "\u027E";
        else out += "r";
        break;
      case "s":
        out += ctx.intervocalico && primeiro ? "z" : "s";
        break;
      case "t":
        out += "i\u026A".includes(vSeg) || vSeg === "y" ? proximaCons ? "t" : "t\u0283" : "t";
        break;
      case "v":
        out += "v";
        break;
      case "w":
        out += "w";
        break;
      case "x":
        out += "\u0283";
        break;
      case "y":
        out += "j";
        break;
      case "z":
        out += "z";
        break;
      default:
        out += c;
    }
  }
  return out;
}
function mapearCoda(cons, ctx) {
  const { proxOnset, finalPalavra, sonorizarS } = ctx;
  let out = "";
  for (let i = 0; i < cons.length; i++) {
    const c = cons[i];
    const ehUltima = i === cons.length - 1;
    const seguinte = cons[i + 1] ?? (ehUltima ? (proxOnset ?? "")[0] ?? "" : "");
    switch (c) {
      case "m":
      case "n":
        out += nasalCoda(seguinte);
        break;
      case "r":
        out += finalPalavra && ehUltima ? "r" : "\u027E\u0259";
        break;
      case "l":
        out += "\u028A";
        break;
      case "s":
      case "ss":
        if (finalPalavra && ehUltima) out += sonorizarS ? "z" : "s";
        else out += "bdgjlmnrvz\xE7".includes(seguinte) ? "z" : "s";
        break;
      case "z":
        out += finalPalavra && ehUltima ? sonorizarS ? "z" : "s" : "z";
        break;
      case "x":
        out += "s";
        break;
      case "c":
        out += "k";
        break;
      case "\xE7":
        out += "s";
        break;
      case "b":
        out += "b";
        break;
      case "d":
        out += "d\u0292";
        break;
      case "g":
        out += "\u0261";
        break;
      case "p":
        out += "p";
        break;
      case "t":
        out += "t\u0283";
        break;
      case "ch":
        out += "\u0283";
        break;
      default:
        out += c;
    }
  }
  return out;
}
function palavraParaIPA(palavra, ctx = {}) {
  const { proximaInicial = "" } = ctx;
  const p = String(palavra).toLowerCase();
  if (!p) return "";
  const sil = silabificar(p);
  if (!sil.length) return "";
  const iTon = acentuar(sil, p);
  acentoSecundario(sil, iTon);
  const sonorizarS = !!proximaInicial && (eVogal(proximaInicial) || "bdgjlmnrvz".includes(proximaInicial));
  let out = "";
  let codaAnterior = "";
  for (let s = 0; s < sil.length; s++) {
    const cur = sil[s];
    const prox = sil[s + 1];
    const finalPalavra = s === sil.length - 1;
    const nasalPorCoda = cur.coda.length > 0 && NASALIZAVEL.has(cur.coda[0]);
    const contatoNasal = !nasalPorCoda && !!prox && prox.onset.length === 1 && NASALIZAVEL.has(prox.onset[0]) && cur.nucleo.length === 1 && "a\xE1\xE0".includes(cur.nucleo[0]);
    const nasalIntervoc = contatoNasal && !!cur.tonica;
    const pretonicaNasal = contatoNasal && !cur.tonica;
    const codaSoS = cur.coda.length === 1 && (cur.coda[0] === "s" || cur.coda[0] === "ss");
    const nucleoIPA = mapearNucleo(cur, {
      finalPalavra: finalPalavra && (cur.coda.length === 0 || codaSoS),
      nasalPorCoda: nasalPorCoda || nasalIntervoc,
      pretonicaNasal
    });
    const intervocalico = s > 0 && sil[s - 1].coda.length === 0;
    const onsetIPA = mapearOnset(cur.onset, {
      nucleoIPA,
      inicioPalavra: s === 0,
      codaAnterior,
      intervocalico
    });
    const codaIPA = mapearCoda(cur.coda, {
      proxOnset: prox ? prox.onset.join("") : "",
      finalPalavra,
      sonorizarS
    });
    codaAnterior = codaIPA;
    const marca = cur.tonica ? "\u02C8" : cur.secundaria ? "\u02CC" : "";
    out += onsetIPA + marca + nucleoIPA + codaIPA;
  }
  return limpar(out);
}
function limpar(ipa) {
  return ipa.normalize("NFD").replace(/g/g, "\u0261").replace(/ˈ{2,}/g, "\u02C8").replace(/\u0303{2,}/g, "\u0303").trim();
}
var PONTUACAO = /^[;:,.!?¡¿—…"«»“”(){}[\]]+$/;
function fonemizar(texto, opts = {}) {
  const { normalizar: usarNorm = true, lexico: extra = null } = opts;
  const t = usarNorm ? normalizar(texto) : String(texto ?? "");
  if (!t) return "";
  const tokens = t.match(/[\p{L}\p{M}'-]+|[;:,.!?—…"«»“”(){}[\]]|\s+/gu) ?? [];
  const palavras = tokens.filter((x) => /\p{L}/u.test(x));
  const partes = [];
  let idx = 0;
  for (const tk of tokens) {
    if (/^\s+$/.test(tk)) {
      if (partes.length && partes[partes.length - 1] !== " ") partes.push(" ");
      continue;
    }
    if (PONTUACAO.test(tk)) {
      while (partes.length && partes[partes.length - 1] === " ") partes.pop();
      partes.push(tk, " ");
      continue;
    }
    const proxima = palavras[idx + 1] ?? "";
    idx++;
    const bruta = tk.toLowerCase().replace(/^['-]+|['-]+$/g, "");
    if (!bruta) continue;
    if (bruta.includes("-")) {
      const sub = bruta.split("-").filter(Boolean);
      partes.push(sub.map((w) => resolverPalavra(w, "", extra)).join(" "));
      continue;
    }
    partes.push(resolverPalavra(bruta, proxima[0] ?? "", extra));
  }
  return partes.join("").replace(/\s{2,}/g, " ").replace(/\s+([;:,.!?…])/g, "$1").trim();
}
function resolverPalavra(palavra, proximaInicial, extra) {
  if (extra && Object.hasOwn(extra, palavra)) return extra[palavra];
  const lex = buscarLexico(palavra);
  if (lex) return lex;
  const cli = buscarClitico(palavra);
  if (cli) return cli;
  return palavraParaIPA(palavra, { proximaInicial });
}

// C:/Users/carlo/AppData/Local/Temp/atlas-vozz-inspect/package/src/audio.js
var TAXA_PADRAO = 24e3;
var Audio = class _Audio {
  /**
   * @param {Float32Array} amostras PCM em [-1, 1]
   * @param {number} taxa amostras por segundo
   */
  constructor(amostras, taxa = TAXA_PADRAO) {
    this.amostras = amostras;
    this.taxa = taxa;
  }
  /** Duração em segundos. */
  get duracao() {
    return this.amostras.length / this.taxa;
  }
  /** Converte para WAV PCM 16-bit. @returns {ArrayBuffer} */
  paraWav() {
    return codificarWav(this.amostras, this.taxa);
  }
  /** Cria um Blob `audio/wav` (navegador). */
  paraBlob() {
    return new Blob([this.paraWav()], { type: "audio/wav" });
  }
  /** Cria uma object URL tocável em `<audio src=...>`. */
  paraURL() {
    return URL.createObjectURL(this.paraBlob());
  }
  /**
   * Toca o áudio no navegador.
   * @returns {Promise<void>} resolve quando terminar
   */
  tocar() {
    if (typeof window === "undefined") {
      throw new Error("[vozz] tocar() s\xF3 funciona no navegador. No Node use salvar().");
    }
    const url = this.paraURL();
    const el = new window.Audio(url);
    this._elemento = el;
    return new Promise((resolve, reject) => {
      el.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      el.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      el.play().catch(reject);
    });
  }
  /** Interrompe a reprodução iniciada por `tocar()`. */
  parar() {
    if (this._elemento) {
      this._elemento.pause();
      this._elemento.currentTime = 0;
    }
  }
  /**
   * Salva em disco (Node) ou dispara download (navegador).
   * @param {string} caminho
   */
  async salvar(caminho = "audio.wav") {
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      const a = document.createElement("a");
      a.href = this.paraURL();
      a.download = caminho;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
      return;
    }
    const modulo = "node:fs/promises";
    const { writeFile } = await import(
      /* @vite-ignore */
      /* webpackIgnore: true */
      modulo
    );
    await writeFile(caminho, new Uint8Array(this.paraWav()));
  }
  /** Concatena vários trechos, com pausa opcional entre eles. */
  static concatenar(lista, pausaSegundos = 0) {
    const itens = lista.filter(Boolean);
    if (!itens.length) return new _Audio(new Float32Array(0));
    const taxa = itens[0].taxa;
    const silencio = Math.round(pausaSegundos * taxa);
    const total = itens.reduce((s, a) => s + a.amostras.length, 0) + silencio * (itens.length - 1);
    const buf = new Float32Array(total);
    let off = 0;
    itens.forEach((a, i) => {
      buf.set(a.amostras, off);
      off += a.amostras.length;
      if (i < itens.length - 1) off += silencio;
    });
    return new _Audio(buf, taxa);
  }
};
function codificarWav(amostras, taxa = TAXA_PADRAO) {
  const n = amostras.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const escreverTexto = (off2, txt) => {
    for (let i = 0; i < txt.length; i++) dv.setUint8(off2 + i, txt.charCodeAt(i));
  };
  escreverTexto(0, "RIFF");
  dv.setUint32(4, 36 + n * 2, true);
  escreverTexto(8, "WAVE");
  escreverTexto(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, taxa, true);
  dv.setUint32(28, taxa * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  escreverTexto(36, "data");
  dv.setUint32(40, n * 2, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, amostras[i]));
    dv.setInt16(off, v < 0 ? v * 32768 : v * 32767, true);
    off += 2;
  }
  return buf;
}

// C:/Users/carlo/AppData/Local/Temp/atlas-vozz-inspect/package/src/splitter.js
var ABREV = /* @__PURE__ */ new Set([
  "sr",
  "sra",
  "srta",
  "dr",
  "dra",
  "prof",
  "profa",
  "eng",
  "exmo",
  "av",
  "r",
  "p\xE7",
  "ed",
  "apto",
  "ap",
  "p\xE1g",
  "pag",
  "fig",
  "obs",
  "ex",
  "etc",
  "cia",
  "ltda",
  "n\xFAm",
  "no",
  "tel",
  "cel",
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
  "seg",
  "ter",
  "qua",
  "qui",
  "sex",
  "s\xE1b",
  "dom",
  "vs",
  "p",
  "pp"
]);
var FECHAMENTO = /* @__PURE__ */ new Set(['"', "'", ")", "]", "}", "\u201D", "\xBB", "\u2026"]);
function dividirEmSentencas(texto) {
  const t = String(texto ?? "").replace(/\r\n/g, "\n");
  if (!t.trim()) return [];
  const sentencas = [];
  let inicio = 0;
  let i = 0;
  while (i < t.length) {
    const c = t[i];
    if (c === "\n" && t[i + 1] === "\n") {
      const s = t.slice(inicio, i).trim();
      if (s) sentencas.push(s);
      inicio = i + 1;
      i += 2;
      continue;
    }
    if (".!?\u2026".includes(c)) {
      let fim = i;
      while (fim + 1 < t.length && ".!?\u2026".includes(t[fim + 1])) fim++;
      while (fim + 1 < t.length && FECHAMENTO.has(t[fim + 1])) fim++;
      const proximo = t.slice(fim + 1).match(/^\s*(\S)/);
      const charSeguinte = proximo?.[1] ?? "";
      const espacoDepois = /^\s/.test(t.slice(fim + 1)) || fim + 1 >= t.length;
      let j = i - 1;
      while (j >= 0 && /\S/.test(t[j])) j--;
      const palavraAnt = t.slice(j + 1, i).toLowerCase().replace(/[^\p{L}\d]/gu, "");
      const ehAbreviacao = c === "." && ABREV.has(palavraAnt);
      const ehDecimal = c === "." && /\d$/.test(t.slice(0, i)) && /^\d/.test(t.slice(i + 1));
      const ehSigla = c === "." && palavraAnt.length === 1 && /^[a-zà-ÿ]$/.test(palavraAnt);
      const continuaMinuscula = charSeguinte && /[a-zà-ÿ0-9]/.test(charSeguinte);
      if (!ehAbreviacao && !ehDecimal && !ehSigla && espacoDepois && !continuaMinuscula) {
        const s = t.slice(inicio, fim + 1).trim();
        if (s) sentencas.push(s);
        inicio = fim + 1;
      }
      i = fim + 1;
      continue;
    }
    i++;
  }
  const resto = t.slice(inicio).trim();
  if (resto) sentencas.push(resto);
  return sentencas;
}
var DivisorDeTexto = class {
  constructor() {
    this._buffer = "";
    this._fila = [];
    this._aguardando = null;
    this._fechado = false;
  }
  /** Adiciona texto ao fluxo. */
  empurrar(...pedacos) {
    for (const p of pedacos) this._buffer += p;
    this._processar();
    return this;
  }
  /** Emite o que restou sem esperar pontuação final. */
  descarregar() {
    const resto = this._buffer.trim();
    if (resto) this._fila.push(resto);
    this._buffer = "";
    this._liberar();
    return this;
  }
  /** Encerra o fluxo. */
  fechar() {
    if (this._fechado) return this;
    this._fechado = true;
    this.descarregar();
    return this;
  }
  /** @private */
  _processar() {
    const sentencas = dividirEmSentencas(this._buffer);
    if (sentencas.length <= 1) return;
    const completas = sentencas.slice(0, -1);
    const ultima = sentencas[sentencas.length - 1];
    for (const s of completas) this._fila.push(s);
    this._buffer = this._buffer.slice(this._buffer.lastIndexOf(ultima));
    if (completas.length) this._liberar();
  }
  /** @private */
  _liberar() {
    if (this._aguardando) {
      const r = this._aguardando;
      this._aguardando = null;
      r();
    }
  }
  async *[Symbol.asyncIterator]() {
    for (; ; ) {
      if (this._fila.length) {
        yield this._fila.shift();
        continue;
      }
      if (this._fechado) return;
      await new Promise((r) => {
        this._aguardando = r;
      });
    }
  }
};

// C:/Users/carlo/AppData/Local/Temp/atlas-vozz-inspect/package/src/piper.js
var CDN_PADRAO = "https://cdn.jsdelivr.net/gh/Pedro21062014/vozz@main";
var ARQ_MODELO = "pt_BR-faber-medium-uint8.onnx";
var ARQ_CONFIG = "pt_BR-faber-medium-uint8.onnx.json";
var CACHE = "vozz-piper-v1";
async function baixar(url, { aoProgredir, usarCache = true, rotulo = "" } = {}) {
  let cache = null;
  if (usarCache && typeof caches !== "undefined") {
    try {
      cache = await caches.open(CACHE);
      const hit = await cache.match(url);
      if (hit) {
        aoProgredir?.({ status: "cache", progresso: 1, recebido: 0, total: 0, arquivo: rotulo });
        return await hit.arrayBuffer();
      }
    } catch {
      cache = null;
    }
  }
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`[vozz] Falha ao baixar ${rotulo || url}: HTTP ${resp.status}`);
  }
  const total = Number(resp.headers.get("content-length")) || 0;
  if (!resp.body || !total) {
    const buf2 = await resp.arrayBuffer();
    aoProgredir?.({ status: "baixando", progresso: 1, recebido: buf2.byteLength, total: buf2.byteLength, arquivo: rotulo });
    if (cache) {
      try {
        await cache.put(url, new Response(buf2.slice(0), { headers: resp.headers }));
      } catch {
      }
    }
    return buf2;
  }
  const leitor = resp.body.getReader();
  const pedacos = [];
  let recebido = 0;
  for (; ; ) {
    const { done, value } = await leitor.read();
    if (done) break;
    pedacos.push(value);
    recebido += value.length;
    aoProgredir?.({ status: "baixando", progresso: recebido / total, recebido, total, arquivo: rotulo });
  }
  const buf = new Uint8Array(recebido);
  let off = 0;
  for (const p of pedacos) {
    buf.set(p, off);
    off += p.length;
  }
  if (cache) {
    try {
      await cache.put(url, new Response(buf.slice(0), { headers: resp.headers }));
    } catch {
    }
  }
  return buf.buffer;
}
function usaConvIntegerAssinado(buffer) {
  const dados = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1 << 20));
  const alvo = [67, 111, 110, 118, 73, 110, 116, 101, 103, 101, 114];
  const limite = dados.length - alvo.length;
  for (let i = 0; i <= limite; i++) {
    if (dados[i] !== alvo[0]) continue;
    let k = 1;
    while (k < alvo.length && dados[i + k] === alvo[k]) k++;
    if (k === alvo.length) return true;
  }
  return false;
}
function configurarThreads(ort, preferido) {
  try {
    const wasm = ort?.env?.wasm;
    if (!wasm) return;
    if (typeof preferido === "number" && preferido > 0) {
      wasm.numThreads = preferido;
      return;
    }
    const temSAB = typeof SharedArrayBuffer !== "undefined";
    if (!temSAB) {
      wasm.numThreads = 1;
      return;
    }
    const nucleos = typeof navigator !== "undefined" && navigator.hardwareConcurrency || 2;
    wasm.numThreads = nucleos >= 4 ? 2 : 1;
  } catch {
  }
}
async function escolherDispositivo(pref) {
  if (pref && pref !== "auto") return pref;
  if (typeof navigator !== "undefined" && "gpu" in navigator) {
    try {
      const ad = await navigator.gpu.requestAdapter();
      if (ad) return "webgpu";
    } catch {
    }
  }
  return "wasm";
}
var Piper = class _Piper {
  /** @private */
  constructor(sessao, config, ort, info) {
    this.sessao = sessao;
    this.config = config;
    this.ort = ort;
    this.dispositivo = info.dispositivo;
    this.taxa = config.audio?.sample_rate ?? 22050;
    this.mapa = config.phoneme_id_map ?? {};
    const inf = config.inference ?? {};
    this.padrao = {
      ruido: inf.noise_scale ?? 0.667,
      duracao: inf.length_scale ?? 1,
      ruidoW: inf.noise_w ?? 0.8
    };
  }
  /**
   * Baixa o modelo (uma vez) e inicializa a sessão de inferência.
   * @param {OpcoesCarregar} [opcoes]
   */
  static async carregar(opcoes = {}) {
    const {
      cdn = CDN_PADRAO,
      urlModelo = `${cdn}/${ARQ_MODELO}`,
      urlConfig = `${cdn}/${ARQ_CONFIG}`,
      dispositivo = "auto",
      aoProgredir = null,
      cache = true,
      urlRuntime = ORT_CDN
    } = opcoes;
    const ort = await carregarRuntime(urlRuntime);
    const alvo = await escolherDispositivo(dispositivo);
    if (!ort?.InferenceSession) {
      throw new Error("[vozz] Runtime ONNX inv\xE1lido: falta InferenceSession.");
    }
    configurarThreads(ort, opcoes.threads);
    const cfgBuf = await baixar(urlConfig, { aoProgredir, usarCache: cache, rotulo: "config" });
    const config = JSON.parse(new TextDecoder().decode(cfgBuf));
    const modeloBuf = await baixar(urlModelo, { aoProgredir, usarCache: cache, rotulo: "modelo" });
    aoProgredir?.({ status: "iniciando", progresso: 1, recebido: 0, total: 0, arquivo: "sess\xE3o" });
    const temConvInteger = usaConvIntegerAssinado(modeloBuf);
    const criar = (provedores) => ort.InferenceSession.create(modeloBuf, {
      executionProviders: provedores,
      graphOptimizationLevel: "all"
    });
    let alvoFinal = alvo;
    let sessao;
    try {
      sessao = await criar(alvoFinal === "webgpu" ? ["webgpu", "wasm"] : ["wasm"]);
    } catch (e) {
      if (alvoFinal !== "wasm") {
        sessao = await criar(["wasm"]);
        alvoFinal = "wasm";
      } else {
        const msg = String(e?.message ?? e);
        if (temConvInteger && /ConvInteger|NOT_IMPLEMENTED|Could not find an implementation/i.test(msg)) {
          throw new Error(
            `[vozz] O modelo foi quantizado com QInt8 (int8 assinado), e o ONNX Runtime s\xF3 implementa ConvInteger para uint8 \u2014 por isso a sess\xE3o n\xE3o \xE9 criada, em nenhum backend.
  Solu\xE7\xE3o: re-quantize a partir do modelo fp32 usando QUInt8.
    from onnxruntime.quantization import quantize_dynamic, QuantType
    quantize_dynamic("modelo.onnx", "modelo_uint8.onnx", weight_type=QuantType.QUInt8)
  O tamanho do arquivo \xE9 o mesmo. Detalhes no README, se\xE7\xE3o "Problemas comuns".
  (erro original: ${msg})`
          );
        }
        throw new Error(`[vozz] Falha ao criar a sess\xE3o de infer\xEAncia: ${msg}`);
      }
    }
    aoProgredir?.({ status: "pronto", progresso: 1, recebido: 0, total: 0 });
    return new _Piper(sessao, config, ort, { dispositivo: alvoFinal });
  }
  /**
   * Injeta o runtime ONNX manualmente, quando o bundler não resolve o
   * import dinâmico (Cloudflare Workers, alguns setups de webpack).
   *
   *   import * as ort from "onnxruntime-web";
   *   Piper.usarRuntime(ort);
   */
  static usarRuntime(ort) {
    usarRuntime(ort);
    return _Piper;
  }
  /** Texto → IPA (mesmo G2P pt-BR do restante do pacote). */
  static fonemizar(texto, opcoes) {
    return fonemizar(texto, opcoes);
  }
  /**
   * Converte IPA nos ids que o modelo espera.
   *
   * O Piper usa o formato do espeak: um símbolo de início (^), um separador
   * (_) entre cada fonema e um de fim ($). O separador é obrigatório — sem
   * ele o alinhamento interno do VITS sai errado e o áudio fica arrastado.
   *
   * @param {string} ipa
   * @returns {number[]}
   */
  idsDeFonemas(ipa) {
    const m = this.mapa;
    const pad = m["_"]?.[0] ?? 0;
    const ids = [];
    if (m["^"]) ids.push(m["^"][0], pad);
    for (const ch of ipa.normalize("NFD")) {
      const e = m[ch];
      if (e) ids.push(e[0], pad);
    }
    if (m["$"]) ids.push(m["$"][0]);
    return ids;
  }
  /**
   * Sintetiza uma cadeia IPA.
   * @param {string} ipa
   * @param {{velocidade?:number, ruido?:number, ruidoW?:number}} [opcoes]
   * @returns {Promise<Audio>}
   */
  async sintetizarIPA(ipa, opcoes = {}) {
    const ids = this.idsDeFonemas(ipa);
    if (ids.length <= 2) return new Audio(new Float32Array(0), this.taxa);
    const { Tensor } = this.ort;
    const escalaDuracao = this.padrao.duracao / (opcoes.velocidade ?? 1);
    const entradas = {
      input: new Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
      input_lengths: new Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new Tensor("float32", Float32Array.from([
        opcoes.ruido ?? this.padrao.ruido,
        escalaDuracao,
        opcoes.ruidoW ?? this.padrao.ruidoW
      ]), [3])
    };
    const saida = await this.sessao.run(entradas);
    const bruto = saida[this.sessao.outputNames[0]].data;
    return new Audio(bruto instanceof Float32Array ? bruto : Float32Array.from(bruto), this.taxa);
  }
  /**
   * Sintetiza texto em português.
   * @param {string} texto
   * @param {{velocidade?:number, ruido?:number, ruidoW?:number, lexico?:object}} [opcoes]
   * @returns {Promise<Audio>}
   */
  async falar(texto, opcoes = {}) {
    const trechos = [];
    const pausa = Math.round(0.1 * this.taxa);
    let total = 0;
    for await (const t of this.falarEmFluxo(texto, opcoes)) {
      const amostras = t.audio.amostras;
      if (!amostras.length) continue;
      if (trechos.length) total += pausa;
      trechos.push(amostras);
      total += amostras.length;
    }
    if (!trechos.length) return new Audio(new Float32Array(0), this.taxa);
    if (trechos.length === 1) return new Audio(trechos[0], this.taxa);
    const buf = new Float32Array(total);
    let off = 0;
    for (let i = 0; i < trechos.length; i++) {
      buf.set(trechos[i], off);
      off += trechos[i].length + (i < trechos.length - 1 ? pausa : 0);
      trechos[i] = null;
    }
    return new Audio(buf, this.taxa);
  }
  /**
   * Sintetiza em fluxo: entrega cada sentença assim que fica pronta, o que
   * permite começar a tocar sem esperar o texto inteiro.
   *
   * @param {string|DivisorDeTexto} entrada
   * @param {object} [opcoes]
   */
  async *falarEmFluxo(entrada, opcoes = {}) {
    const maxFonemas = opcoes.maxFonemas ?? MAX_FONEMAS;
    const fonte = entrada instanceof DivisorDeTexto ? entrada : (function* () {
      for (const s of dividirEmSentencas(String(entrada ?? ""))) yield s;
    })();
    for await (const sentenca of fonte) {
      const limpa = String(sentenca).trim();
      if (!limpa) continue;
      const ipa = fonemizar(limpa, { lexico: opcoes.lexico });
      if (!ipa) continue;
      for (const bloco of dividirIPA(ipa, maxFonemas)) {
        const audio = await this.sintetizarIPA(bloco, opcoes);
        await respirar();
        yield { texto: limpa, fonemas: bloco, audio };
      }
    }
  }
  /** Libera a sessão de inferência. */
  async liberar() {
    await this.sessao?.release?.();
  }
  /** Remove o modelo do cache do navegador. */
  static async limparCache() {
    if (typeof caches === "undefined") return false;
    return caches.delete(CACHE);
  }
};
var MAX_FONEMAS = 360;
var PONTOS_DE_CORTE = /(?<=[,;:—…])\s+/;
function dividirIPA(ipa, limite = MAX_FONEMAS) {
  const texto = String(ipa ?? "").trim();
  if (texto.length <= limite) return texto ? [texto] : [];
  const blocos = [];
  let atual = "";
  const empurrar = (parte) => {
    const candidato = atual ? `${atual} ${parte}` : parte;
    if (candidato.length <= limite) {
      atual = candidato;
      return;
    }
    if (atual) blocos.push(atual);
    atual = parte;
  };
  for (const trecho of texto.split(PONTOS_DE_CORTE)) {
    if (trecho.length <= limite) {
      empurrar(trecho);
      continue;
    }
    let linha = "";
    for (const palavra of trecho.split(/\s+/)) {
      if (linha && linha.length + 1 + palavra.length > limite) {
        empurrar(linha);
        linha = palavra;
      } else {
        linha = linha ? `${linha} ${palavra}` : palavra;
      }
    }
    if (linha) empurrar(linha);
  }
  if (atual) blocos.push(atual);
  return blocos;
}
function respirar() {
  if (typeof globalThis !== "undefined") {
    const s = globalThis.scheduler;
    if (s && typeof s.yield === "function") return s.yield();
    if (typeof globalThis.setTimeout === "function") {
      return new Promise((r) => globalThis.setTimeout(r, 0));
    }
  }
  return Promise.resolve();
}
var runtimeInjetado = null;
function usarRuntime(ort) {
  runtimeInjetado = ort;
}
var ORT_CDN = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.min.mjs";
async function carregarRuntime(urlCdn = ORT_CDN) {
  if (runtimeInjetado) return runtimeInjetado;
  if (typeof globalThis !== "undefined" && globalThis.ort?.InferenceSession) {
    return globalThis.ort;
  }
  const temDom = typeof window !== "undefined" && typeof document !== "undefined";
  if (!temDom) {
    try {
      const importar = new Function("m", "return import(m)");
      return await importar("onnxruntime-node");
    } catch (e) {
      throw new Error(
        `[vozz] Instale o runtime ONNX para Node: npm i onnxruntime-node
  (motivo: ${e?.message ?? e})`
      );
    }
  }
  try {
    const importar = new Function("u", "return import(u)");
    const mod = await importar(urlCdn);
    const ort = mod?.default?.InferenceSession ? mod.default : mod;
    if (!ort?.InferenceSession) throw new Error("m\xF3dulo sem InferenceSession");
    return ort;
  } catch (e) {
    throw new Error(
      `[vozz] N\xE3o foi poss\xEDvel carregar o runtime ONNX.
  Alternativas:
    1) instale e injete:  npm i onnxruntime-web
         import * as ort from "onnxruntime-web";
         Piper.usarRuntime(ort);
    2) aponte outro CDN:  Piper.carregar({ urlRuntime: "https://..." })
  (motivo: ${e?.message ?? e})`
    );
  }
}
var piper_default = Piper;
export {
  Audio,
  CDN_PADRAO,
  DivisorDeTexto,
  ORT_CDN,
  Piper,
  piper_default as default,
  dividirIPA,
  fonemizar,
  usarRuntime
};
