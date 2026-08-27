
import { customRequiredFamilies } from "./engine.js";

const DET_MODEL = "PP-OCRv5_mobile_det";

// Official explicit PP-OCRv5 recognition models.
// English is covered by the Latin model; Chinese/Japanese share PP-OCRv5_mobile_rec.
// This reduces the mandatory base scan from 9 pipelines to 7.
export const FAMILY_DEFS = [
  { id: "latin", label: "Latin multilingual", group: "latin", recModel: "latin_PP-OCRv5_mobile_rec" },
  { id: "korean", label: "Korean", group: "hangul", recModel: "korean_PP-OCRv5_mobile_rec" },
  { id: "arabic", label: "Arabic / Persian", group: "arabic", recModel: "arabic_PP-OCRv5_mobile_rec" },
  { id: "cyrillic", label: "Cyrillic", group: "cyrillic", recModel: "cyrillic_PP-OCRv5_mobile_rec" },
  { id: "devanagari", label: "Devanagari", group: "devanagari", recModel: "devanagari_PP-OCRv5_mobile_rec" },
  { id: "cjk", label: "Chinese / Japanese", group: "cjk", recModel: "PP-OCRv5_mobile_rec" },
  { id: "thai", label: "Thai", group: "thai", recModel: "th_PP-OCRv5_mobile_rec" },
];

const EXTRA_FAMILIES = {
  greek: { id: "greek", label: "Greek", group: "greek", recModel: "el_PP-OCRv5_mobile_rec" },
  tamil: { id: "tamil", label: "Tamil", group: "tamil", recModel: "ta_PP-OCRv5_mobile_rec" },
  telugu: { id: "telugu", label: "Telugu", group: "telugu", recModel: "te_PP-OCRv5_mobile_rec" },
};

let PaddleOCRClass = null;
const warmModels = new Map();

async function loadPaddleOCR() {
  if (PaddleOCRClass) return PaddleOCRClass;
  const urls = [
    "https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js@0.4.2/+esm",
    "https://esm.sh/@paddleocr/paddleocr-js@0.4.2?bundle",
  ];
  let last = null;
  for (const url of urls) {
    try {
      const mod = await import(url);
      if (mod?.PaddleOCR) {
        PaddleOCRClass = mod.PaddleOCR;
        return PaddleOCRClass;
      }
    } catch (e) {
      last = e;
      console.warn("PaddleOCR SDK CDN failed:", url, e);
    }
  }
  throw last || new Error("PaddleOCR.js could not be loaded");
}

function regexCount(text, group) {
  const map = {
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
  return ((String(text || "").match(map[group] || /$^/g)) || []).length;
}

function summarize(result, def) {
  const items = (result?.items || [])
    .map((x) => ({
      text: String(x.text || "").trim(),
      score: Number(x.score || 0),
      poly: x.poly || null,
    }))
    .filter((x) => x.text);

  let weighted = 0, totalW = 0;
  for (const x of items) {
    const w = Math.max(1, x.text.length);
    weighted += x.score * w;
    totalW += w;
  }

  const meanScore = totalW ? weighted / totalW : 0;
  const text = items.map((x) => x.text).join("\n");
  const chars = text.replace(/\s+/g, "").length;
  const scriptChars = regexCount(text, def.group);
  const scriptFactor = Math.min(1, scriptChars / 18);
  const textFactor = Math.min(1, chars / 45);
  const quality = meanScore * (0.55 * textFactor + 0.45 * scriptFactor);

  return {
    items, text, meanScore, chars, scriptChars, quality,
    detectedBoxes: Number(result?.metrics?.detectedBoxes || 0),
  };
}

async function baseCanvas(file, maxSide = 1850) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

function rotateCanvas(src, deg) {
  const d = ((deg % 360) + 360) % 360;
  if (d === 0) return src;
  const c = document.createElement("canvas");
  if (d === 90 || d === 270) {
    c.width = src.height; c.height = src.width;
  } else {
    c.width = src.width; c.height = src.height;
  }
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((d * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

function enhancedCanvas(src) {
  const c = document.createElement("canvas");
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.filter = "contrast(1.28) saturate(.9)";
  ctx.drawImage(src, 0, 0);
  ctx.filter = "none";
  return c;
}

async function createOCR(def) {
  // Keep the three most common/routing-critical recognizers warm.
  // Others are disposed after use to keep browser RAM bounded.
  if (warmModels.has(def.id)) return warmModels.get(def.id);

  const PaddleOCR = await loadPaddleOCR();
  const ocr = await PaddleOCR.create({
    textDetectionModelName: DET_MODEL,
    textRecognitionModelName: def.recModel,
    worker: false,
    textDetectionBatchSize: 1,
    textRecognitionBatchSize: 8,
    ortOptions: { backend: "auto" },
  });

  if (["latin", "korean", "arabic"].includes(def.id)) warmModels.set(def.id, ocr);
  return ocr;
}

async function recognizeVariants(ocr, def, photo) {
  if (!photo._baseCanvas) photo._baseCanvas = await baseCanvas(photo.file);

  // After one family has strongly established orientation, later families use
  // a single orientation. This is the largest inference-time reduction.
  const rotations = photo.rotationLocked
    ? [photo.rotation]
    : [photo.rotation ?? 0, 90, 270, 180].filter((x, i, a) => a.indexOf(x) === i);

  const canvases = rotations.map((r) => rotateCanvas(photo._baseCanvas, r));
  const results = await ocr.predict(canvases, {
    textRecScoreThresh: 0.30,
    textDetLimitSideLen: 1760,
    textDetMaxSideLimit: 2100,
    textDetBoxThresh: 0.45,
  });

  const candidates = results.map((r, i) => ({
    rotation: rotations[i],
    summary: summarize(r, def),
  })).sort((a, b) => b.summary.quality - a.summary.quality);

  let best = candidates[0] || {
    rotation: rotations[0] || 0,
    summary: summarize(null, def),
  };

  if (best.summary.detectedBoxes >= 2 && best.summary.quality < 0.45) {
    const enhanced = enhancedCanvas(rotateCanvas(photo._baseCanvas, best.rotation));
    const [rr] = await ocr.predict(enhanced, {
      textRecScoreThresh: 0.28,
      textDetLimitSideLen: 1760,
      textDetMaxSideLimit: 2100,
      textDetBoxThresh: 0.42,
    });
    const ss = summarize(rr, def);
    if (ss.quality > best.summary.quality) {
      best = { rotation: best.rotation, summary: ss };
    }
  }

  if (
    !photo.rotationLocked &&
    best.summary.meanScore >= 0.62 &&
    best.summary.scriptChars >= 10 &&
    best.summary.chars >= 24
  ) {
    photo.rotation = best.rotation;
    photo.rotationLocked = true;
  }

  return best;
}

function textOfSources(sources) {
  return (sources || []).flatMap((s) => s.items || []).map((x) => x.text || "").join("\n");
}

function routingHints(text) {
  const t = String(text || "");
  const ids = [];
  // Exact uppercase tags are deliberate; they avoid matching ordinary prose.
  if (/\b(?:PER|ARB)\b/.test(t)) ids.push("arabic");
  if (/\bRU\b/.test(t)) ids.push("cyrillic");
  if (/\b(?:KOR|KO)\b/.test(t)) ids.push("korean");
  if (/\b(?:JPN|JP|CHN|CN)\b/.test(t)) ids.push("cjk");
  if (/\bTH\b/.test(t)) ids.push("thai");
  if (/\bHI\b/.test(t)) ids.push("devanagari");
  return [...new Set(ids)];
}

export function requiredFamiliesForProfile(profile) {
  const extras = customRequiredFamilies(profile.custom_avoid || []);
  return [
    ...FAMILY_DEFS,
    ...extras.map((id) => EXTRA_FAMILIES[id]).filter(Boolean),
  ];
}

// Fast-safe route:
// 1) Latin first because it often reveals explicit language-panel tags.
// 2) Hinted family immediately next (PER/ARB/RU/etc.).
// 3) Korean early because it is a primary target market.
// 4) Remaining families only if a direct conflict has not already been found.
// A direct Conflict is terminal because no lower-severity result can override it.
export async function deepScan(products, profile, evaluatePartial, onProgress = () => {}) {
  const defs = requiredFamiliesForProfile(profile);
  const byId = new Map(defs.map((d) => [d.id, d]));
  const familyStatus = Object.fromEntries(defs.map((d) => [d.id, { ok: false, attempted: false }]));
  const productSources = new Map(products.map((p) => [p.id, []]));
  const terminal = new Set();

  const queue = [];
  const queued = new Set();
  const enqueue = (id, front = false) => {
    if (!byId.has(id) || queued.has(id)) return;
    queued.add(id);
    front ? queue.unshift(id) : queue.push(id);
  };

  enqueue("latin");
  enqueue("korean");
  enqueue("arabic");
  enqueue("cyrillic");
  enqueue("devanagari");
  enqueue("cjk");
  enqueue("thai");
  for (const d of defs) enqueue(d.id);

  let completed = 0;
  while (queue.length) {
    const id = queue.shift();
    const def = byId.get(id);
    if (!def) continue;

    onProgress({
      phase: "model",
      family: def.label,
      completed,
      total: defs.length,
      message: `Loading ${def.label} OCR…`,
    });

    let ocr = null;
    try {
      familyStatus[id] = { ok: false, attempted: true };
      ocr = await createOCR(def);

      for (let pi = 0; pi < products.length; pi++) {
        const product = products[pi];
        if (terminal.has(product.id)) continue;

        onProgress({
          phase: "scan",
          family: def.label,
          product: pi + 1,
          totalProducts: products.length,
          message: `${def.label}: product ${pi + 1}/${products.length}`,
        });

        for (let ph = 0; ph < product.photos.length; ph++) {
          const photo = product.photos[ph];
          try {
            const best = await recognizeVariants(ocr, def, photo);
            productSources.get(product.id).push({
              familyId: def.id,
              familyLabel: def.label,
              group: def.group,
              photoIndex: ph,
              rotation: best.rotation,
              items: best.summary.items,
              meanScore: best.summary.meanScore,
              quality: best.summary.quality,
              detectedBoxes: best.summary.detectedBoxes,
            });
          } catch (e) {
            console.warn("Photo OCR failed", def.id, ph, e);
          }
        }

        // Latin OCR can cheaply expose multilingual panel tags.
        if (id === "latin") {
          const hints = routingHints(textOfSources(productSources.get(product.id)));
          // Put hinted families at the very front in reverse so first hint wins.
          [...hints].reverse().forEach((h) => {
            const qi = queue.indexOf(h);
            if (qi >= 0) queue.splice(qi, 1);
            queue.unshift(h);
          });
        }

        // Early terminal only for a verified direct conflict.
        if (evaluatePartial) {
          const partial = evaluatePartial(productSources.get(product.id), familyStatus);
          if (partial?.status === "conflict") terminal.add(product.id);
        }
      }

      familyStatus[id] = { ok: true, attempted: true };
    } catch (e) {
      console.error("OCR family failed", def.id, e);
      familyStatus[id] = {
        ok: false,
        attempted: true,
        error: String(e?.message || e),
      };
    } finally {
      // Warm common models; dispose less common ones after use.
      if (ocr && !warmModels.has(def.id)) {
        try { await ocr.dispose?.(); } catch {}
      }
    }

    completed += 1;

    // If every product has a direct conflict, there is no reason to load more models.
    if (terminal.size === products.length) break;
  }

  return { defs, familyStatus, productSources, terminal };
}
