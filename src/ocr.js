
import { FAMILY_GROUP, customRequiredFamilies } from "./engine.js";

export const FAMILY_DEFS = [
  { id: "en", label: "English", lang: "en", group: "latin" },
  { id: "korean", label: "Korean", lang: "korean", group: "hangul" },
  { id: "arabic", label: "Arabic / Persian", lang: "fa", group: "arabic" },
  { id: "latin", label: "Latin multilingual", lang: "fr", group: "latin" },
  { id: "cyrillic", label: "Cyrillic", lang: "ru", group: "cyrillic" },
  { id: "devanagari", label: "Devanagari", lang: "hi", group: "devanagari" },
  { id: "japanese", label: "Japanese", lang: "japan", group: "japanese" },
  { id: "chinese", label: "Chinese", lang: "ch", group: "han" },
  { id: "thai", label: "Thai", lang: "th", group: "thai" },
];

const EXTRA_FAMILIES = {
  greek: { id: "greek", label: "Greek", lang: "el", group: "greek" },
  tamil: { id: "tamil", label: "Tamil", lang: "ta", group: "tamil" },
  telugu: { id: "telugu", label: "Telugu", lang: "te", group: "telugu" },
};

let PaddleOCRClass = null;

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
    japanese: /[\u3040-\u30FF]/g,
    han: /[\u3400-\u4DBF\u4E00-\u9FFF]/g,
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

  // Score should prefer correctly recognized target-script text, not gibberish.
  const scriptFactor = Math.min(1, scriptChars / 18);
  const textFactor = Math.min(1, chars / 45);
  const quality = meanScore * (0.55 * textFactor + 0.45 * scriptFactor);

  return {
    items,
    text,
    meanScore,
    chars,
    scriptChars,
    quality,
    detectedBoxes: Number(result?.metrics?.detectedBoxes || 0),
  };
}

async function baseCanvas(file, maxSide = 2100) {
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
    c.width = src.height;
    c.height = src.width;
  } else {
    c.width = src.width;
    c.height = src.height;
  }

  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((d * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

function enhancedCanvas(src) {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.filter = "contrast(1.35) saturate(0.85)";
  ctx.drawImage(src, 0, 0);
  ctx.filter = "none";
  return c;
}

async function createOCR(def) {
  const PaddleOCR = await loadPaddleOCR();
  return await PaddleOCR.create({
    lang: def.lang,
    ocrVersion: "PP-OCRv5",
    worker: false,
    textDetectionBatchSize: 1,
    textRecognitionBatchSize: 8,
    ortOptions: {
      backend: "auto",
    },
  });
}

async function recognizeVariants(ocr, def, photo) {
  if (!photo._baseCanvas) photo._baseCanvas = await baseCanvas(photo.file);

  const rotations = photo.rotationLocked
    ? [photo.rotation]
    : [photo.rotation ?? 0, 90, 270, 180].filter(
        (x, i, a) => a.indexOf(x) === i
      );

  const canvases = rotations.map((r) => rotateCanvas(photo._baseCanvas, r));
  let results = await ocr.predict(canvases, {
    textRecScoreThresh: 0.30,
    textDetLimitSideLen: 1920,
    textDetMaxSideLimit: 2300,
    textDetBoxThresh: 0.45,
  });

  let candidates = results.map((r, i) => ({
    rotation: rotations[i],
    summary: summarize(r, def),
  }));

  candidates.sort((a, b) => b.summary.quality - a.summary.quality);
  let best = candidates[0] || {
    rotation: rotations[0] || 0,
    summary: summarize(null, def),
  };

  // One controlled enhancement retry if boxes exist but recognition is weak.
  if (best.summary.detectedBoxes >= 2 && best.summary.quality < 0.48) {
    const enhanced = enhancedCanvas(rotateCanvas(photo._baseCanvas, best.rotation));
    const [rr] = await ocr.predict(enhanced, {
      textRecScoreThresh: 0.28,
      textDetLimitSideLen: 1920,
      textDetMaxSideLimit: 2300,
      textDetBoxThresh: 0.42,
    });
    const ss = summarize(rr, def);
    if (ss.quality > best.summary.quality) {
      best = { rotation: best.rotation, summary: ss };
    }
  }

  // Only lock orientation when target-script evidence is substantial.
  if (
    !photo.rotationLocked &&
    best.summary.meanScore >= 0.62 &&
    best.summary.scriptChars >= 12 &&
    best.summary.chars >= 24
  ) {
    photo.rotation = best.rotation;
    photo.rotationLocked = true;
  }

  return best;
}

export function requiredFamiliesForProfile(profile) {
  const extras = customRequiredFamilies(profile.custom_avoid || []);
  return [
    ...FAMILY_DEFS,
    ...extras.map((id) => EXTRA_FAMILIES[id]).filter(Boolean),
  ];
}

export async function deepScan(products, profile, onProgress = () => {}) {
  const defs = requiredFamiliesForProfile(profile);
  const familyStatus = Object.fromEntries(defs.map((d) => [d.id, { ok: false }]));
  const productSources = new Map(products.map((p) => [p.id, []]));

  const totalSteps = defs.length;
  let step = 0;

  for (const def of defs) {
    step += 1;
    onProgress({
      phase: "model",
      family: def.label,
      step,
      totalSteps,
      message: `Loading ${def.label} OCR (${step}/${totalSteps})…`,
    });

    let ocr = null;
    try {
      ocr = await createOCR(def);

      for (let pi = 0; pi < products.length; pi++) {
        const product = products[pi];

        onProgress({
          phase: "scan",
          family: def.label,
          step,
          totalSteps,
          product: pi + 1,
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
      }

      familyStatus[def.id] = { ok: true };
    } catch (e) {
      console.error("OCR family failed", def.id, e);
      familyStatus[def.id] = {
        ok: false,
        error: String(e?.message || e),
      };
    } finally {
      try {
        await ocr?.dispose?.();
      } catch {}
    }
  }

  return {
    defs,
    familyStatus,
    productSources,
  };
}
