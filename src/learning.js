
const KEY = "aller_learning_v2";
const MAX_RECORDS = 100;

function loadAll() {
  try {
    const x = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
}

function saveAll(rows) {
  localStorage.setItem(KEY, JSON.stringify(rows.slice(-MAX_RECORDS)));
}

async function imageCanvas(file, w = 9, h = 8) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return c;
}

export async function dHash(file) {
  const c = await imageCanvas(file, 9, 8);
  const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, 9, 8).data;
  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i1 = (y * 9 + x) * 4;
      const i2 = (y * 9 + x + 1) * 4;
      const g1 = d[i1] * 0.299 + d[i1 + 1] * 0.587 + d[i1 + 2] * 0.114;
      const g2 = d[i2] * 0.299 + d[i2 + 1] * 0.587 + d[i2 + 2] * 0.114;
      bits += g1 > g2 ? "1" : "0";
    }
  }
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex.padStart(16, "0");
}

function hammingHex(a, b) {
  if (!a || !b || a.length !== b.length) return 999;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      n += x & 1;
      x >>= 1;
    }
  }
  return n;
}

export function getLearningCount() {
  return loadAll().length;
}

export function findLearnedTexts(hashes, maxDistance = 5) {
  const rows = loadAll();
  const matches = [];
  for (const row of rows) {
    const ok = (hashes || []).some((h) =>
      (row.hashes || []).some((rh) => hammingHex(h, rh) <= maxDistance)
    );
    if (ok && row.corrected_text) matches.push(row.corrected_text);
  }
  return [...new Set(matches)];
}

export function saveCorrection({
  hashes,
  correctedText,
  productLabel,
  resultStatus,
  ocrSnapshot,
}) {
  const text = String(correctedText || "").trim();
  if (!text) return false;
  const rows = loadAll();
  rows.push({
    schema: 1,
    created_at: new Date().toISOString(),
    hashes: [...new Set(hashes || [])],
    corrected_text: text,
    product_label: productLabel || "",
    previous_status: resultStatus || "",
    ocr_snapshot: ocrSnapshot || [],
    safety_policy: "positive-only-learning",
  });
  saveAll(rows);
  return true;
}

export function exportLearningData() {
  const rows = loadAll();
  const blob = new Blob(
    [JSON.stringify({ schema_version: 1, exported_at: new Date().toISOString(), records: rows }, null, 2)],
    { type: "application/json" }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `aller-ai-learning-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function clearLearningData() {
  localStorage.removeItem(KEY);
}
