
import { ONTOLOGY } from "./ontology.js?v=2.2.0";

export const ALLERGENS = ONTOLOGY.allergens;
export const MARKERS = ONTOLOGY.label_markers;

export const FAMILY_GROUP = {
  latin: "latin",
  korean: "hangul",
  arabic: "arabic",
  cyrillic: "cyrillic",
  devanagari: "devanagari",
  cjk: "cjk",
  thai: "thai",
  greek: "greek",
  tamil: "tamil",
  telugu: "telugu",
};

export const REQUIRED_BASE_FAMILIES = [
  "latin", "korean", "arabic", "cyrillic",
  "devanagari", "cjk", "thai"
];

const SCRIPT_REGEX = {
  latin: /[A-Za-zÀ-ÖØ-öø-ÿĀ-ž]/g,
  hangul: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g,
  arabic: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g,
  cyrillic: /[\u0400-\u052F]/g,
  devanagari: /[\u0900-\u097F]/g,
  cjk: /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/g,
  thai: /[\u0E00-\u0E7F]/g,
  greek: /[\u0370-\u03FF]/g,
  tamil: /[\u0B80-\u0BFF]/g,
  telugu: /[\u0C00-\u0C7F]/g,
};

export function normalizeArabicPersian(s) {
  return String(s || "")
    .replace(/[يىئ]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ؤ/g, "و")
    .replace(/[ةۀ]/g, "ه")
    .replace(/[أإٱ]/g, "ا")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "");
}

export function fold(s) {
  let x = String(s || "").normalize("NFKC").toLowerCase();
  x = normalizeArabicPersian(x);
  x = x.normalize("NFKD").replace(/\p{M}/gu, "");
  return x.replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();
}

export function compact(s) {
  return fold(s).replace(/[\s\u200b\u200c\u200d]+/g, "");
}

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isWordScript(term) {
  return /[a-z\u0370-\u03ff\u0400-\u052f\u0900-\u097f]/i.test(fold(term));
}

export function containsTerm(text, term) {
  const q = fold(term);
  const txt = fold(text);
  if (!q) return false;
  if (isWordScript(q)) {
    const r = new RegExp(
      "(?:^|[^\\p{L}\\p{N}_])" + esc(q) + "(?:$|[^\\p{L}\\p{N}_])",
      "iu"
    );
    return r.test(txt);
  }
  return compact(txt).includes(compact(q));
}

export function containsAny(text, terms) {
  return (terms || []).some((x) => containsTerm(text, x));
}

export function scriptCount(text, group) {
  const re = SCRIPT_REGEX[group];
  if (!re) return 0;
  return (String(text || "").match(re) || []).length;
}

function lineScore(line) {
  const n = Number(line?.score);
  return Number.isFinite(n) ? n : 0;
}

function sourceText(source) {
  return (source?.items || []).map((x) => x.text || "").join("\n");
}

function sourceMeanScore(source) {
  const lines = (source?.items || []).filter((x) => String(x.text || "").trim());
  if (!lines.length) return 0;
  let num = 0, den = 0;
  for (const line of lines) {
    const w = Math.max(1, String(line.text || "").trim().length);
    num += lineScore(line) * w;
    den += w;
  }
  return den ? num / den : 0;
}

export function sourceEvidence(source) {
  const text = sourceText(source);
  const ingredient = containsAny(text, MARKERS.ingredient_headings);
  const declaration = containsAny(text, [
    ...(MARKERS.direct_markers || []),
    ...(MARKERS.caution_markers || []),
  ]);
  const nutrition = containsAny(text, MARKERS.nutrition_headings);
  const meanScore = sourceMeanScore(source);
  const group = FAMILY_GROUP[source.familyId] || source.group || "";
  const scriptChars = scriptCount(text, group);
  return {
    text,
    ingredient,
    declaration,
    nutrition,
    meanScore,
    scriptChars,
    chars: compact(text).length,
  };
}

function allAliases(id) {
  const out = [];
  const item = ALLERGENS[id];
  if (!item) return out;
  for (const [lng, arr] of Object.entries(item.aliases || {})) {
    for (const alias of arr || []) out.push([lng, alias]);
  }
  return out;
}

function headingPosition(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (containsAny(lines[i].text || "", MARKERS.ingredient_headings)) return i;
  }
  return -1;
}

function contextFor(lines, idx, radius = 2) {
  return lines
    .slice(Math.max(0, idx - radius), Math.min(lines.length, idx + radius + 1))
    .map((x) => x.text || "")
    .join(" ");
}


// Generic dairy words need non-dairy phrase protection.
// Example: "cocoa butter" must NOT trigger Milk merely because "butter" is an alias.
// The protection removes only the known non-dairy phrase before alias matching;
// if a separate dairy term remains on the same line, it is still detected.
const MILK_NON_DAIRY_PHRASES = [
  // English
  "cocoa butter","cacao butter","peanut butter","almond butter","cashew butter",
  "hazelnut butter","sunflower seed butter","coconut butter",
  "coconut milk","almond milk","soy milk","soya milk","oat milk","rice milk",
  "coconut cream","cream of tartar",
  // French
  "beurre de cacao","beurre de cacahuète","beurre de cacahuete","beurre d'arachide",
  "beurre d’amande","beurre d'amande","lait de coco","lait d’amande","lait d'amande",
  "lait de soja","lait d’avoine","lait d'avoine","crème de coco","creme de coco",
  "crème de tartre","creme de tartre",
  // Spanish
  "manteca de cacao","mantequilla de cacao","mantequilla de cacahuete",
  "mantequilla de cacahuete","mantequilla de maní","mantequilla de mani",
  "leche de coco","leche de almendra","leche de soja","leche de avena",
  "crema de coco","cremor tártaro","cremor tartaro",
  // German
  "kakaobutter","erdnussbutter","mandelbutter","kokosmilch","mandelmilch",
  "sojamilch","hafermilch","kokoscreme",
  // Italian
  "burro di cacao","burro di arachidi","latte di cocco","latte di mandorla",
  "latte di soia","latte di avena","crema di cocco",
  // Portuguese
  "manteiga de cacau","manteiga de amendoim","leite de coco","leite de amêndoa",
  "leite de amendoa","leite de soja","leite de aveia","creme de coco",
  // Dutch
  "cacaoboter","amandelboter","kokosmelk","amandelmelk","sojamelk","havermelk","kokosroom",
  // Russian
  "масло какао","кокосовое молоко","миндальное молоко","соевое молоко",
  "овсяное молоко","кокосовые сливки",
  // Arabic
  "زبدة الكاكاو","زبدة الفول السوداني","حليب جوز الهند","حليب اللوز",
  "حليب الصويا","حليب الشوفان","كريمة جوز الهند",
  // Persian
  "کره کاکائو","کره بادام زمینی","کره بادام","شیر نارگیل","شیر بادام",
  "شیر سویا","شیر جو دوسر","خامه نارگیل",
  // Hindi
  "कोकोआ बटर","मूंगफली का मक्खन","नारियल का दूध","बादाम दूध",
  "सोया दूध","ओट दूध","नारियल क्रीम",
  // Japanese
  "ココアバター","ピーナッツバター","ココナッツミルク","アーモンドミルク",
  "オーツミルク","ココナッツクリーム",
  // Thai
  "เนยโกโก้","เนยถั่ว","นมอัลมอนด์","นมถั่วเหลือง","นมข้าวโอ๊ต","ครีมมะพร้าว",
  // Turkish
  "hindistan cevizi sütü","badem sütü","soya sütü","yulaf sütü",
  // Indonesian
  "mentega kakao","susu kelapa","susu almond","susu kedelai","susu oat","krim kelapa"
];

function stripKnownNonDairyMilkPhrases(text) {
  let out = String(text || "");
  for (const phrase of MILK_NON_DAIRY_PHRASES) {
    const p = fold(phrase);
    const f = fold(out);
    if (!p || !f.includes(p)) continue;

    // Use the normalized representation for reliable multilingual removal.
    const parts = f.split(p);
    out = parts.join(" ");
  }
  return out;
}

function aliasTextForMatch(allergenId, alias, text) {
  if (allergenId !== "milk") return text;
  const generic = new Set([
    "milk","butter","cream","lait","beurre","crème","creme","leche",
    "mantequilla","milch","butter","latte","burro","leite","manteiga",
    "melk","boter","молоко","сливки","حليب","زبدة","شیر","کره","خامه",
    "दूध","मक्खन","牛乳","バター","นม","เนย","süt","susu","mentega"
  ].map(fold));
  return generic.has(fold(alias)) ? stripKnownNonDairyMilkPhrases(text) : text;
}

function classifyLineContext(lines, idx, alias, learned = false, allergenId = "") {
  const line = lines[idx] || {};

  // Generic dairy aliases such as butter/cream/milk need adjacent OCR lines.
  // This prevents split layouts such as "COCOA" + "BUTTER" from becoming Milk.
  const raw = allergenId === "milk" ? contextFor(lines, idx, 1) : (line.text || "");
  const matchText = aliasTextForMatch(allergenId, alias, raw);
  if (!containsTerm(matchText, alias)) return null;
  if (learned) return "direct";

  const ctx = contextFor(lines, idx, 2);
  if (containsAny(ctx, MARKERS.caution_markers)) return "caution";
  if (containsAny(ctx, MARKERS.direct_markers)) return "direct";

  const hp = headingPosition(lines);
  if (hp >= 0 && idx >= hp && idx <= hp + 16) return "direct";
  return "mention";
}

function dedupeEvidence(items) {
  const best = new Map();
  for (const x of items) {
    const k = `${x.kind}|${x.allergen_id}|${fold(x.term)}`;
    const prev = best.get(k);
    if (!prev || (x.score || 0) > (prev.score || 0)) best.set(k, x);
  }
  return [...best.values()];
}

function aggregateEvidence(sources, profile, learnedTexts = []) {
  const hits = [];

  for (const source of sources || []) {
    const lines = source.items || [];
    for (const id of profile.allergens || []) {
      const item = ALLERGENS[id];
      if (!item) continue;
      for (const [language, alias] of allAliases(id)) {
        for (let i = 0; i < lines.length; i++) {
          const kind = classifyLineContext(lines, i, alias, false, id);
          if (!kind) continue;
          hits.push({
            kind,
            allergen_id: id,
            allergen: item.label,
            term: alias,
            language,
            score: lineScore(lines[i]),
            family: source.familyId,
            learned: false,
          });
        }
      }
    }

    for (const raw of profile.custom_avoid || []) {
      const term = String(raw || "").trim();
      if (!term) continue;
      for (let i = 0; i < lines.length; i++) {
        const kind = classifyLineContext(lines, i, term, false, "custom");
        if (!kind) continue;
        hits.push({
          kind,
          allergen_id: "custom",
          allergen: "Custom avoid",
          term,
          language: "user",
          score: lineScore(lines[i]),
          family: source.familyId,
          learned: false,
        });
      }
    }
  }

  // Learned corrections are positive-only. They can raise risk but never certify a negative.
  for (const text of learnedTexts || []) {
    const lines = [{ text, score: 1 }];
    for (const id of profile.allergens || []) {
      const item = ALLERGENS[id];
      if (!item) continue;
      for (const [language, alias] of allAliases(id)) {
        if (containsTerm(aliasTextForMatch(id, alias, text), alias)) {
          hits.push({
            kind: containsAny(text, MARKERS.caution_markers) ? "caution" : "direct",
            allergen_id: id,
            allergen: item.label,
            term: alias,
            language,
            score: 1,
            family: "learned-correction",
            learned: true,
          });
        }
      }
    }
    for (const raw of profile.custom_avoid || []) {
      const term = String(raw || "").trim();
      if (term && containsTerm(text, term)) {
        hits.push({
          kind: containsAny(text, MARKERS.caution_markers) ? "caution" : "direct",
          allergen_id: "custom",
          allergen: "Custom avoid",
          term,
          language: "user",
          score: 1,
          family: "learned-correction",
          learned: true,
        });
      }
    }
  }

  return dedupeEvidence(hits);
}

function strongEvidence(hits, kind) {
  const relevant = hits.filter((x) => x.kind === kind);
  const byAllergen = new Map();

  for (const h of relevant) {
    const key = h.allergen_id;
    if (!byAllergen.has(key)) byAllergen.set(key, []);
    byAllergen.get(key).push(h);
  }

  const out = [];
  for (const arr of byAllergen.values()) {
    const learned = arr.find((x) => x.learned);
    if (learned) {
      out.push(learned);
      continue;
    }
    const high = arr.find((x) => x.score >= 0.58);
    if (high) {
      out.push(high);
      continue;
    }
    const independent = new Set(arr.filter((x) => x.score >= 0.45).map((x) => x.family));
    if (independent.size >= 2) {
      out.push([...arr].sort((a, b) => b.score - a.score)[0]);
    }
  }
  return out;
}

function panelHints(text) {
  const hints = new Set();
  if (/\bPER\b/.test(text) || /\bPERSIAN\b/i.test(text) || /\bFARSI\b/i.test(text)) hints.add("arabic");
  if (/\bARB\b/.test(text) || /\bARABIC\b/i.test(text)) hints.add("arabic");
  if (/\bRU\b/.test(text) || /\bRUSSIAN\b/i.test(text)) hints.add("cyrillic");
  if (/\bKOR\b/.test(text) || /\bKOREAN\b/i.test(text)) hints.add("hangul");
  if (/\bJPN\b/.test(text) || /\bJAPANESE\b/i.test(text)) hints.add("japanese");
  if (/\bCHN\b/.test(text) || /\bCHINESE\b/i.test(text)) hints.add("han");
  return hints;
}

function coverageGate(sources, familyStatus, requiredFamilies) {
  const failures = [];
  for (const id of requiredFamilies) {
    const st = familyStatus[id];
    if (!st || !st.ok) failures.push(id);
  }

  const evs = (sources || []).map((s) => ({ source: s, ev: sourceEvidence(s) }));
  const fullText = evs.map((x) => x.ev.text).join("\n");
  const hints = panelHints(fullText);

  const groups = new Map();
  for (const { source, ev } of evs) {
    const g = FAMILY_GROUP[source.familyId] || "";
    if (!g) continue;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(ev);
  }

  const significantGroups = new Set();
  const verifiedGroups = new Set();

  for (const [group, list] of groups.entries()) {
    const significant = list.some(
      (x) => x.scriptChars >= 10 && x.meanScore >= 0.50 && x.chars >= 20
    );
    const verified = list.some(
      (x) =>
        (x.ingredient || x.declaration) &&
        x.meanScore >= 0.60 &&
        x.chars >= 24
    );
    if (significant) significantGroups.add(group);
    if (verified) verifiedGroups.add(group);
  }

  // Explicit language-panel hints also force verification.
  for (const h of hints) significantGroups.add(h);

  const unverifiedGroups = [...significantGroups].filter((g) => !verifiedGroups.has(g));
  const anyVerifiedIngredient = evs.some(
    ({ ev }) => ev.ingredient && ev.meanScore >= 0.62 && ev.chars >= 28
  );
  const anyVerifiedDeclaration = evs.some(
    ({ ev }) => ev.declaration && ev.meanScore >= 0.62 && ev.chars >= 16
  );

  const complete =
    failures.length === 0 &&
    unverifiedGroups.length === 0 &&
    (anyVerifiedIngredient || anyVerifiedDeclaration);

  return {
    complete,
    failures,
    significantGroups: [...significantGroups],
    verifiedGroups: [...verifiedGroups],
    unverifiedGroups,
    anyVerifiedIngredient,
    anyVerifiedDeclaration,
  };
}

export function evaluateProduct({
  sources = [],
  profile,
  familyStatus = {},
  requiredFamilies = REQUIRED_BASE_FAMILIES,
  learnedTexts = [],
}) {
  const hits = aggregateEvidence(sources, profile, learnedTexts);

  const direct = strongEvidence(hits, "direct");
  const caution = strongEvidence(hits, "caution").filter(
    (x) => !direct.some((d) => d.allergen_id === x.allergen_id)
  );

  // A low-context allergen mention is never treated as a negative.
  const mentions = hits.filter((x) => x.kind === "mention" && x.score >= 0.48);

  const coverage = coverageGate(sources, familyStatus, requiredFamilies);

  if (direct.length) {
    return {
      status: "conflict",
      direct_matches: direct,
      caution_matches: caution,
      mention_matches: mentions,
      coverage,
      reason: "A selected allergen was found in a verified ingredient/direct-declaration context.",
    };
  }

  if (caution.length) {
    return {
      status: "caution",
      direct_matches: [],
      caution_matches: caution,
      mention_matches: mentions,
      coverage,
      reason: "A selected allergen was found in a precautionary cross-contact statement.",
    };
  }

  if (mentions.length) {
    return {
      status: "unverified",
      direct_matches: [],
      caution_matches: [],
      mention_matches: mentions,
      coverage,
      reason: "A selected term was recognized outside a sufficiently verified ingredient/declaration context.",
    };
  }

  if (!coverage.complete) {
    return {
      status: "unverified",
      direct_matches: [],
      caution_matches: [],
      mention_matches: [],
      coverage,
      reason: "The multilingual safety coverage gate was not satisfied.",
    };
  }

  return {
    status: "no_listed_conflict",
    direct_matches: [],
    caution_matches: [],
    mention_matches: [],
    coverage,
    reason: "All required OCR families completed and the visible ingredient/declaration text passed the coverage gate.",
  };
}

// ----------------------------- Calories -----------------------------
export function normalizeCalorieOCR(s) {
  let x = normalizeArabicPersian(String(s || "").normalize("NFKC").toLowerCase())
    .replace(/[’`]/g, "'")
    .replace(/×/g, "x");

  x = x
    .replace(/\bk\s*c\s*a\s*[l1i|!]\b/gi, "kcal")
    .replace(/\bk\s*c\s*a\s*l\b/gi, "kcal");

  // Conservative numeric OCR repairs in nutrition contexts only.
  x = x.replace(/\b100\s*[09qos]\s*당\b/gi, "100 g당");
  x = x.replace(/\b100\s*g\s*[s5]\b/gi, "100 g");
  x = x.replace(/\b100\s*[09qo]\s*(?=\d+\s*kcal|\s*kcal)/gi, "100 g ");
  x = x.replace(/(\d+(?:[.,]\d+)?)\s*[09qo]\s*(?=\()/gi, "$1 g ");
  x = x.replace(/(\d+(?:[.,]\d+)?)\s*[09qo]\s*x\s*(\d+)/gi, "$1 g x $2");
  x = x.replace(/(\d)\s*[gq]\s*당/gi, "$1 g당").replace(/100\s*[gq]\b/gi, "100 g");
  x = x.replace(/종\s*내\s*용\s*[량양랑]/g, "총 내용량");

  return x.replace(/\s+/g, " ").trim();
}

function numberOf(s) {
  return Number(String(s).replace(/,/g, ""));
}

const ENERGY = "(?:kcal|킬로칼로리|千卡(?:路里)?|キロカロリー)";

const WEIGHT_PATTERNS = [
  /[총종]\s*내\s*용\s*[량양랑]\s*[:：]?\s*([\d,.]+)\s*g\b/i,
  /[총종]내용[량양랑]\s*[:：]?\s*([\d,.]+)\s*g\b/i,
  /(?:net\s*(?:wt|weight)|total\s*(?:content|weight))\s*[:：]?\s*([\d,.]+)\s*g\b/i,
  /(?:poids\s*net|peso\s*neto|nettogewicht|peso\s*liquido|peso\s*líquido)\s*[:：]?\s*([\d,.]+)\s*g\b/i,
  /(?:масса\s*нетто|вес\s*нетто)\s*[:：]?\s*([\d,.]+)\s*g\b/i,
  /(?:الوزن\s*الصافي|الوزن\s*الصافى)\s*[:：]?\s*([\d,.]+)\s*g\b/i,
  /(?:وزن\s*خالص)\s*[:：]?\s*([\d,.]+)\s*g\b/i,
  /(?:内容量|正味量)\s*[:：]?\s*([\d,.]+)\s*g\b/i,
  /(?:净含量|淨含量)\s*[:：]?\s*([\d,.]+)\s*g\b/i,
  /(?:शुद्ध\s*वजन)\s*[:：]?\s*([\d,.]+)\s*g\b/i,
  /(?:น้ำหนักสุทธิ)\s*[:：]?\s*([\d,.]+)\s*g\b/i,
  /(?:net\s*ağırlık|net\s*agirlik)\s*[:：]?\s*([\d,.]+)\s*g\b/i,
  /(?:berat\s*bersih)\s*[:：]?\s*([\d,.]+)\s*g\b/i,
];

function findMultipackWeight(n, c) {
  for (const r of [
    /([\d,.]+)\s*g\s*x\s*(\d+)\s*(?:봉지|개|팩|packs?|pcs?|pieces?|sachets?|bars?|sticks?)/i,
    /([\d,.]+)gx(\d+)(?:봉지|개|팩|packs?|pcs?|pieces?|sachets?|bars?|sticks?)/i,
  ]) {
    const m = n.match(r) || c.match(r);
    if (m) {
      const unit = numberOf(m[1]);
      const count = Number(m[2]);
      const v = unit * count;
      if (unit > 0 && count >= 2 && count <= 1000 && v >= 0.5 && v <= 50000) {
        return [v, "multipack_weight", unit, count];
      }
    }
  }
  return [null, null, null, null];
}

function recoverExplicitWeight(raw, multiG) {
  const rawText = String(raw || "").replace(/,/g, "");
  const v = Number(rawText);
  if (!(v >= 0.5 && v <= 50000)) return null;

  if (multiG == null) return v;

  const tolerance = Math.max(15, multiG * 0.12);
  if (Math.abs(v - multiG) <= tolerance) return v;

  // OCR sometimes prepends a stray digit to a perfectly visible package weight:
  // printed "253 g" -> OCR "8253 g".
  // When a multipack equation independently gives ~255 g, try numeric suffixes
  // and accept only a suffix that agrees with that independent evidence.
  const digits = rawText.replace(/[^\d.]/g, "");
  for (let cut = 1; cut <= Math.min(3, Math.max(0, digits.length - 2)); cut++) {
    const suffix = Number(digits.slice(cut));
    if (
      Number.isFinite(suffix) &&
      suffix >= 0.5 &&
      suffix <= 50000 &&
      Math.abs(suffix - multiG) <= tolerance
    ) {
      return suffix;
    }
  }

  // Explicit weight conflicts strongly with independent multipack evidence.
  // Do not trust it.
  return null;
}

function findWeight(n) {
  const c = n.replace(/\s+/g, "");
  const [multiG, multiMethod] = findMultipackWeight(n, c);

  // Prefer a printed total weight only when it is self-consistent with any
  // independent multipack equation visible on the same label.
  for (const r of WEIGHT_PATTERNS) {
    const m = n.match(r) || c.match(r);
    if (!m) continue;

    const recovered = recoverExplicitWeight(m[1], multiG);
    if (recovered != null) {
      const original = numberOf(m[1]);
      const method =
        Math.abs(recovered - original) > 0.001
          ? "explicit_total_weight_ocr_recovered"
          : "explicit_total_weight";
      return [recovered, method];
    }
  }

  // Structural recovery near the "100 g ... kcal" line.
  const basisRe = /100\s*g(?:\s*당|\s*(?:per|pour|por|pro))?/gi;
  let bm;
  while ((bm = basisRe.exec(n))) {
    const basisPos = bm.index;
    const before = n.slice(Math.max(0, basisPos - 180), basisPos);
    const after = n.slice(basisPos, Math.min(n.length, basisPos + 120));

    if (!new RegExp("[\\d,.]+\\s*" + ENERGY + "\\b", "i").test(after)) continue;

    const grams = [...before.matchAll(/([\d,.]+)\s*g\b/gi)]
      .map((m) => ({ raw: m[1], v: numberOf(m[1]), pos: m.index }))
      .filter((x) => x.v >= 10 && x.v <= 50000 && Math.abs(x.v - 100) > 0.01);

    if (!grams.length) continue;

    if (multiG != null) {
      const tolerance = Math.max(15, multiG * 0.12);
      const candidates = [];

      for (const g of grams) {
        const recovered = recoverExplicitWeight(g.raw, multiG);
        if (recovered != null && Math.abs(recovered - multiG) <= tolerance) {
          candidates.push({
            v: recovered,
            diff: Math.abs(recovered - multiG),
            pos: g.pos,
          });
        }
      }

      if (candidates.length) {
        candidates.sort((a, b) => a.diff - b.diff || b.pos - a.pos);
        return [candidates[0].v, "structural_total_weight_crosschecked"];
      }
    } else {
      // Without independent evidence, use only the closest preceding plausible
      // value. Extreme values are not automatically accepted as a snack-package
      // total just because OCR produced digits.
      const chosen = grams.sort((a, b) => b.pos - a.pos)[0];
      if (chosen && chosen.v <= 5000) {
        return [chosen.v, "structural_total_weight"];
      }
    }
  }

  if (multiG != null) return [multiG, multiMethod];
  return [null, null];
}

function kcalMatches(n) {
  const re = new RegExp("([\\d,.]+)\\s*" + ENERGY + "\\b", "gi");
  const out = [];
  let m;
  while ((m = re.exec(n))) {
    const v = numberOf(m[1]);
    if (v >= 1 && v <= 1500) out.push([m.index, v]);
  }
  return out;
}

function findReferenceEnergy(n) {
  const c = n.replace(/\s+/g, "");

  const patterns = [
    [new RegExp("([\\d,.]+)\\s*g\\s*(?:당|per|pour|por|pro)?\\s*[:：]?\\s*([\\d,.]+)\\s*" + ENERGY + "\\b", "i"), "g"],
    [new RegExp("([\\d,.]+)g(?:당|per|pour|por|pro)?[:：]?([\\d,.]+)" + ENERGY, "i"), "g"],
    [new RegExp("([\\d,.]+)\\s*" + ENERGY + "\\s*(?:/|per|pour|por|pro)\\s*([\\d,.]+)\\s*g\\b", "i"), "k"],
  ];

  for (const [pat, mode] of patterns) {
    const m = n.match(pat) || c.match(pat);
    if (m) {
      const bg = mode === "g" ? numberOf(m[1]) : numberOf(m[2]);
      const kc = mode === "g" ? numberOf(m[2]) : numberOf(m[1]);
      if (bg >= 0.5 && bg <= 50000 && kc >= 1 && kc <= 1500) {
        return [bg, kc, "direct_reference_pair"];
      }
    }
  }

  const hm =
    n.match(/100\s*g\s*당/i) ||
    c.match(/100g당/i) ||
    n.match(/100\s*g\s*(?:per|pour|por|pro)/i) ||
    n.match(/(?:per|pour|por|pro)\s*100\s*g/i) ||
    n.match(/100\s*g/i);

  if (hm) {
    const hp = hm.index || 0;
    const near = n.slice(hp, Math.min(n.length, hp + 180));
    const nearVals = kcalMatches(near);
    if (nearVals.length) return [100, nearVals[0][1], "nearby_100g_reference"];

    const vals = kcalMatches(n);
    if (vals.length === 1) return [100, vals[0][1], "layout_100g_reference"];
  }

  if (
    containsAny(n, MARKERS.nutrition_headings) &&
    (n.match(/100\s*g/i) || c.includes("100g"))
  ) {
    const vals = [...new Set(kcalMatches(n).map((x) => x[1]))];
    if (vals.length === 1) return [100, vals[0], "single_kcal_with_100g_basis"];
  }

  return [null, null, null];
}

export function extractCaloriesFromText(text) {
  const n = normalizeCalorieOCR(text);
  const [totalG, wm] = findWeight(n);
  const [refG, refKcal, em] = findReferenceEnergy(n);

  let explicit = null;
  for (const r of [
    new RegExp("총\\s*(?:열량|칼로리)\\s*[:：]?\\s*([\\d,.]+)\\s*" + ENERGY + "\\b", "i"),
    new RegExp("(?:total\\s*(?:energy|calories)|energy\\s*per\\s*pack)\\s*[:：]?\\s*([\\d,.]+)\\s*" + ENERGY + "\\b", "i"),
    new RegExp("(?:总热量|總熱量)\\s*[:：]?\\s*([\\d,.]+)\\s*" + ENERGY + "\\b", "i"),
  ]) {
    const m = n.match(r);
    if (m) {
      const v = numberOf(m[1]);
      if (v >= 1 && v <= 100000) {
        explicit = v;
        break;
      }
    }
  }

  let packageKcal = null;
  let basis = null;
  let method = null;

  if (explicit != null) {
    packageKcal = Math.round(explicit);
    basis = `Label states total energy: ${explicit} kcal`;
    method = "explicit_total_energy";
  } else if (totalG != null && refG != null && refKcal != null && refG > 0) {
    packageKcal = Math.round((refKcal * totalG) / refG);
    basis = `Calculated from ${refKcal} kcal / ${refG} g × ${totalG} g`;
    method = `${wm}+${em}`;
  }

  // Consumer-safety plausibility guard:
  // never display an extreme computed value unless the total energy itself was
  // explicitly printed on the label. Ambiguous OCR should become "unknown",
  // not a wildly wrong calorie number.
  if (
    method !== "explicit_total_energy" &&
    packageKcal != null &&
    (packageKcal <= 0 || packageKcal > 25000)
  ) {
    packageKcal = null;
    basis = null;
    method = "rejected_implausible_computed_energy";
  }

  if (!(packageKcal > 0 && packageKcal < 100000)) packageKcal = null;

  return {
    package_kcal: packageKcal,
    basis,
    total_weight_g: totalG,
    reference_kcal: refKcal,
    reference_g: refG,
    method,
  };
}

export function extractProductCalories(sources) {
  const ranked = [...(sources || [])]
    .map((s) => ({ s, ev: sourceEvidence(s) }))
    .sort((a, b) => {
      const an = a.ev.nutrition ? 1 : 0;
      const bn = b.ev.nutrition ? 1 : 0;
      return bn - an || b.ev.meanScore - a.ev.meanScore;
    });

  // Take a bounded set of best OCR texts to avoid duplicating every model's numbers.
  const text = ranked.slice(0, 5).map((x) => x.ev.text).join("\n");
  return extractCaloriesFromText(text);
}

export function customRequiredFamilies(customTerms = []) {
  const out = new Set();
  for (const term of customTerms) {
    const s = String(term || "");
    if (/[\u0370-\u03FF]/.test(s)) out.add("greek");
    if (/[\u0B80-\u0BFF]/.test(s)) out.add("tamil");
    if (/[\u0C00-\u0C7F]/.test(s)) out.add("telugu");
  }
  return [...out];
}
