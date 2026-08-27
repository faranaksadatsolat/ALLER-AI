
import {
  evaluateProduct,
  extractProductCalories,
  REQUIRED_BASE_FAMILIES,
  customRequiredFamilies,
} from "./engine.js";
import { deepScan, requiredFamiliesForProfile } from "./ocr.js";
import {
  dHash,
  findLearnedTexts,
  saveCorrection,
  exportLearningData,
  getLearningCount,
} from "./learning.js";

const MAX_PRODUCTS = 6;
const MAX_PHOTOS = 3;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const lang = $("#lang");
const productsEl = $("#products");
const analyze = $("#analyze");
const result = $("#result");
const loading = $("#loading");
const productResults = $("#productResults");
const calTotal = $("#calTotal");
const exportLearningBtn = $("#exportLearning");
const learningCountEl = $("#learningCount");

let custom = [];
let products = [{ id: 1, photos: [] }];
let nextId = 2;
let lastRun = null;

const I = {
  en: {
    tag: "Understand the label before you eat.",
    hero: "Safety-first multilingual label checking.",
    sub: "ALLER AI now performs a thorough on-device scan across OCR language families. A negative result is shown only after the multilingual coverage gate passes.",
    profile: "What should we watch for?",
    profileSub: "Choose one or more allergens or ingredients you avoid.",
    milk: "Milk", egg: "Egg", peanut: "Peanut", treeNuts: "Tree nuts",
    soy: "Soy", wheat: "Wheat", sesame: "Sesame", fish: "Fish", shellfish: "Shellfish",
    add: "Add",
    products: "Add product photos",
    productsSub: "Up to 3 photos belong to one product. Different products must stay in separate groups.",
    product: "Product",
    photosForSame: "Photos in this box are treated as the same product.",
    choose: "Take or choose photos",
    remove: "Remove",
    addProduct: "+ Add another product",
    tip1: "Include the complete ingredient/allergen statement when possible.",
    tip2: "Include the nutrition panel if you want full-package calories.",
    tip3: "The first thorough scan downloads OCR models. Later scans can reuse browser cache.",
    autoLang: "PaddleOCR PP-OCRv5 on-device · multilingual family scan · automatic rotation",
    analyze: "Run thorough safety scan",
    note: "Photos are processed in your browser. ALLER AI does not upload them to a Render analysis server.",
    checking: "Running safety scan…",
    checkingSub: "Starting the multilingual OCR pipeline…",
    privacy: "Photos and profile stay on this device during analysis. Learning corrections are stored only in this browser.",
    footer: "ALLER AI is a safety-first decision-support prototype, not a medical guarantee. For severe allergies, verify the original label and manufacturer guidance.",
    noProfile: "Select at least one item to check.",
    addPhoto: "Add at least one product photo.",
    conflict: "Conflict detected",
    caution: "Caution",
    unverified: "Unable to verify",
    clear: "No listed conflict detected",
    mixed: "Products checked",
    reason: "Reason",
    packageCalories: "Estimated full-package calories",
    basis: "Calculation",
    totalCalories: "Estimated total for full packages",
    knownCalories: "Known calorie total",
    incompleteCalories: "Some products could not be included because the visible label did not provide enough information.",
    noCalories: "Full-package calories could not be calculated from the visible labels.",
    photoAdded: "Photo added",
    engineTitle: "On-device PaddleOCR could not start",
    engineBody: "One or more OCR models could not be loaded. ALLER AI will not issue a negative result when coverage is incomplete.",
    directMatches: "Direct matches",
    cautionMatches: "Precautionary matches",
    mentionMatches: "Unverified mentions",
    coverage: "Safety coverage",
    coverageComplete: "Complete multilingual gate",
    coverageIncomplete: "Incomplete — negative result blocked",
    teach: "Teach / correct this product",
    teachPrompt: "Type or paste the ingredient/allergen statement exactly as printed. This learning is positive-only: it can raise risk later, but can never create a 'No listed conflict' result.",
    teachSaved: "Correction saved on this device. Re-run the scan to apply it.",
    exportLearning: "Export learning data",
    learningCount: "local corrections",
  },
  ko: {
    tag: "먹기 전에 라벨을 이해하세요.",
    hero: "안전 우선 다국어 라벨 확인.",
    sub: "ALLER AI는 여러 OCR 언어 계열을 기기 내에서 정밀하게 확인합니다. 다국어 커버리지 게이트를 통과한 경우에만 음성 결과를 표시합니다.",
    profile: "무엇을 확인할까요?",
    profileSub: "피하고 싶은 알레르기 유발물질 또는 성분을 선택하세요.",
    milk: "우유", egg: "달걀", peanut: "땅콩", treeNuts: "견과류",
    soy: "대두", wheat: "밀", sesame: "참깨", fish: "생선", shellfish: "갑각류",
    add: "추가",
    products: "제품 사진 추가",
    productsSub: "한 제품당 최대 3장까지 추가할 수 있습니다. 다른 제품은 별도 그룹으로 추가하세요.",
    product: "제품",
    photosForSame: "이 박스의 사진은 같은 제품으로 분석됩니다.",
    choose: "촬영 또는 사진 선택",
    remove: "삭제",
    addProduct: "+ 다른 제품 추가",
    tip1: "가능하면 전체 원재료/알레르기 표시가 보이도록 촬영하세요.",
    tip2: "전체 포장 열량을 원하면 영양정보도 포함하세요.",
    tip3: "첫 정밀 분석에서는 OCR 모델을 다운로드합니다. 이후 브라우저 캐시를 사용할 수 있습니다.",
    autoLang: "PaddleOCR PP-OCRv5 기기 내 실행 · 다국어 계열 정밀 스캔 · 자동 회전",
    analyze: "정밀 안전 스캔",
    note: "사진은 브라우저에서 처리되며 Render 분석 서버로 업로드되지 않습니다.",
    checking: "안전 스캔 중…",
    checkingSub: "다국어 OCR 파이프라인을 시작하는 중…",
    privacy: "사진과 프로필은 분석 중 이 기기에서 처리됩니다. 학습 교정도 이 브라우저에만 저장됩니다.",
    footer: "ALLER AI는 안전 우선 의사결정 보조 프로토타입이며 의학적 안전을 보장하지 않습니다. 중증 알레르기의 경우 원본 라벨과 제조사 안내를 확인하세요.",
    noProfile: "확인할 항목을 하나 이상 선택하세요.",
    addPhoto: "제품 사진을 하나 이상 추가하세요.",
    conflict: "주의 성분 확인",
    caution: "주의 필요",
    unverified: "확인 불가",
    clear: "표시된 충돌 성분 없음",
    mixed: "제품 분석 결과",
    reason: "판단 근거",
    packageCalories: "전체 포장 예상 열량",
    basis: "계산 근거",
    totalCalories: "전체 제품 예상 열량 합계",
    knownCalories: "확인 가능한 열량 합계",
    incompleteCalories: "일부 제품은 보이는 라벨 정보가 부족해 합계에 포함되지 않았습니다.",
    noCalories: "보이는 라벨만으로 전체 포장 열량을 계산할 수 없습니다.",
    photoAdded: "사진 추가됨",
    engineTitle: "기기 내 PaddleOCR을 시작할 수 없습니다",
    engineBody: "일부 OCR 모델을 불러오지 못했습니다. 커버리지가 불완전한 경우 ALLER AI는 음성 결과를 표시하지 않습니다.",
    directMatches: "직접 확인된 항목",
    cautionMatches: "주의 표시 항목",
    mentionMatches: "확인되지 않은 언급",
    coverage: "안전 커버리지",
    coverageComplete: "다국어 게이트 통과",
    coverageIncomplete: "불완전 — 음성 결과 차단",
    teach: "이 제품 교정 / 학습",
    teachPrompt: "포장에 인쇄된 원재료/알레르기 문구를 그대로 입력하거나 붙여넣으세요. 이 학습은 위험도를 높이는 데만 사용되며 '충돌 성분 없음' 결과를 만드는 데 사용되지 않습니다.",
    teachSaved: "교정 내용이 이 기기에 저장되었습니다. 다시 분석하면 적용됩니다.",
    exportLearning: "학습 데이터 내보내기",
    learningCount: "개 로컬 교정",
  },
};

function t(k) {
  return (I[lang.value] || I.en)[k] || I.en[k] || k;
}

function setLang(v) {
  document.documentElement.lang = v;
  document.documentElement.dir = "ltr";
  $$("[data-i18n]").forEach((e) => (e.textContent = t(e.dataset.i18n)));
  localStorage.setItem("aller_lang", v);
  renderProducts();
  refreshLearningUI();
}

lang.value = localStorage.getItem("aller_lang") || "en";
if (!["en", "ko"].includes(lang.value)) lang.value = "en";
lang.onchange = () => setLang(lang.value);

function profile() {
  return {
    allergens: $$("#chips input:checked").map((x) => x.value),
    custom_avoid: [...custom],
  };
}

function saveProfile() {
  localStorage.setItem("aller_profile", JSON.stringify(profile()));
  update();
}

try {
  const p = JSON.parse(localStorage.getItem("aller_profile") || "{}");
  (p.allergens || []).forEach((v) => {
    const x = $(`#chips input[value="${v}"]`);
    if (x) x.checked = true;
  });
  custom = Array.isArray(p.custom_avoid) ? p.custom_avoid : [];
} catch {}

$("#chips").onchange = saveProfile;

function renderCustom() {
  const e = $("#customList");
  e.innerHTML = "";
  custom.forEach((v, i) => {
    const l = document.createElement("label");
    l.className = "chip";
    l.innerHTML = "<input type='checkbox' checked><span></span>";
    l.querySelector("span").textContent = v + " ×";
    l.onclick = (x) => {
      x.preventDefault();
      custom.splice(i, 1);
      renderCustom();
      saveProfile();
    };
    e.appendChild(l);
  });
}

$("#add").onclick = () => {
  const v = $("#custom").value.trim();
  if (v && !custom.some((x) => x.toLowerCase() === v.toLowerCase())) custom.push(v);
  $("#custom").value = "";
  renderCustom();
  saveProfile();
};

$("#custom").onkeydown = (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    $("#add").click();
  }
};

function renderProducts() {
  productsEl.innerHTML = "";

  products.forEach((p, idx) => {
    const box = document.createElement("div");
    box.className = "product";

    const top = document.createElement("div");
    top.className = "ptop";

    const left = document.createElement("div");
    left.innerHTML = `<div class="ptitle">${t("product")} ${idx + 1}</div><div class="psub">${t("photosForSame")}</div>`;
    top.appendChild(left);

    if (products.length > 1) {
      const rm = document.createElement("button");
      rm.className = "removeProduct";
      rm.textContent = t("remove");
      rm.onclick = () => {
        p.photos.forEach((x) => URL.revokeObjectURL(x.url));
        products.splice(idx, 1);
        renderProducts();
        update();
      };
      top.appendChild(rm);
    }

    const cap = document.createElement("div");
    cap.className = "capture";

    const btn = document.createElement("button");
    btn.className = "btn primary";
    btn.textContent = t("choose");

    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.multiple = true;
    inp.hidden = true;

    btn.onclick = () => inp.click();

    inp.onchange = (e) => {
      for (const f of [...e.target.files]) {
        if (p.photos.length >= MAX_PHOTOS) break;
        if (f.type.startsWith("image/")) {
          p.photos.push({
            file: f,
            url: URL.createObjectURL(f),
            rotation: 0,
            rotationLocked: false,
          });
        }
      }
      inp.value = "";
      renderProducts();
      update();
    };

    const msg = document.createElement("p");
    msg.textContent = `${p.photos.length}/${MAX_PHOTOS} ${t("photoAdded")}`;

    cap.append(btn, inp, msg);

    const ph = document.createElement("div");
    ph.className = "photos";

    p.photos.forEach((photo, j) => {
      const d = document.createElement("div");
      d.className = "photo";

      const im = document.createElement("img");
      im.src = photo.url;

      const x = document.createElement("button");
      x.className = "x";
      x.textContent = "×";
      x.onclick = () => {
        URL.revokeObjectURL(photo.url);
        p.photos.splice(j, 1);
        renderProducts();
        update();
      };

      const b = document.createElement("div");
      b.className = "added";
      b.textContent = t("photoAdded");

      d.append(im, x, b);
      ph.appendChild(d);
    });

    box.append(top, cap, ph);
    productsEl.appendChild(box);
  });

  $("#addProduct").disabled = products.length >= MAX_PRODUCTS;
}

$("#addProduct").onclick = () => {
  if (products.length < MAX_PRODUCTS) {
    products.push({ id: nextId++, photos: [] });
    renderProducts();
    update();
  }
};

function update() {
  const p = profile();
  const hasPhoto = products.some((x) => x.photos.length);
  analyze.disabled = !(hasPhoto && (p.allergens.length || p.custom_avoid.length));
}

function setProgress(txt) {
  const e = $("#loading span");
  if (e) e.textContent = txt;
}

function allergenLabel(hit) {
  const map = {
    milk: "milk",
    egg: "egg",
    peanut: "peanut",
    tree_nuts: "treeNuts",
    soy: "soy",
    wheat: "wheat",
    sesame: "sesame",
    fish: "fish",
    shellfish: "shellfish",
  };
  if (hit && map[hit.allergen_id]) return t(map[hit.allergen_id]);
  if (hit && hit.allergen_id === "custom") {
    return lang.value === "ko" ? "사용자 지정" : "Custom avoid";
  }
  return hit?.allergen || "";
}

function statusLabel(status) {
  if (status === "conflict") return t("conflict");
  if (status === "caution") return t("caution");
  if (status === "unverified") return t("unverified");
  return t("clear");
}

function kindFor(status) {
  if (status === "conflict") return "danger";
  if (status === "caution" || status === "unverified") return "warn";
  if (status === "no_listed_conflict") return "ok";
  return "";
}

function addEv(parent, label, value) {
  if (value === undefined || value === null || value === "") return;
  const r = document.createElement("div");
  r.className = "ev";
  const a = document.createElement("span");
  a.textContent = label;
  const b = document.createElement("strong");
  b.textContent = value;
  r.append(a, b);
  parent.appendChild(r);
}

function messageFor(p) {
  const direct = [...new Set((p.direct_matches || []).map(allergenLabel))];
  const caution = [...new Set((p.caution_matches || []).map(allergenLabel))];

  if (lang.value === "ko") {
    if (p.status === "conflict") return `선택한 주의 성분이 확인되었습니다: ${direct.join(", ")}.`;
    if (p.status === "caution") return `교차접촉 가능성에 대한 주의 표시가 확인되었습니다: ${caution.join(", ")}.`;
    if (p.status === "unverified") return "라벨을 충분히 검증하지 못했습니다. 이 결과를 음성 결과로 해석하지 마세요.";
    return "정밀 다국어 스캔에서 선택한 충돌 성분이 확인되지 않았습니다.";
  }

  if (p.status === "conflict") return `Selected ingredient conflict detected: ${direct.join(", ")}.`;
  if (p.status === "caution") return `Precautionary cross-contact warning detected: ${caution.join(", ")}.`;
  if (p.status === "unverified") return "ALLER AI could not verify the label strongly enough. Do not interpret this as a negative result.";
  return "No selected conflict was found after the thorough multilingual coverage gate completed.";
}

function basisText(c) {
  if (!c) return "";
  if (c.reference_kcal != null && c.reference_g != null && c.total_weight_g != null) {
    return lang.value === "ko"
      ? `${c.reference_g} g당 ${c.reference_kcal} kcal × 총 내용량 ${c.total_weight_g} g`
      : `${c.reference_kcal} kcal / ${c.reference_g} g × ${c.total_weight_g} g`;
  }
  return c.basis || "";
}

function refreshLearningUI() {
  const n = getLearningCount();
  if (learningCountEl) {
    learningCountEl.textContent =
      lang.value === "ko" ? `${n}${t("learningCount")}` : `${n} ${t("learningCount")}`;
  }
  if (exportLearningBtn) {
    exportLearningBtn.style.display = n ? "inline-flex" : "none";
    exportLearningBtn.textContent = t("exportLearning");
  }
}

exportLearningBtn.onclick = exportLearningData;

async function teachProduct(productIndex, analysisProduct) {
  const text = prompt(t("teachPrompt"));
  if (!text || !text.trim()) return;

  const product = products[productIndex];
  const hashes = [];
  for (const photo of product.photos) {
    try {
      hashes.push(photo._dhash || (photo._dhash = await dHash(photo.file)));
    } catch {}
  }

  const snapshot = (analysisProduct._sources || []).map((s) => ({
    family: s.familyId,
    rotation: s.rotation,
    items: (s.items || []).map((x) => ({ text: x.text, score: x.score })),
  }));

  saveCorrection({
    hashes,
    correctedText: text.trim(),
    productLabel: `Product ${productIndex + 1}`,
    resultStatus: analysisProduct.status,
    ocrSnapshot: snapshot,
  });

  refreshLearningUI();
  alert(t("teachSaved"));
}

function showResults(data) {
  loading.classList.remove("show");
  result.classList.add("show");
  productResults.innerHTML = "";

  const ps = data.products || [];
  const conflicts = ps.filter((x) => x.status === "conflict").length;
  const cautions = ps.filter((x) => x.status === "caution").length;
  const unverified = ps.filter((x) => x.status === "unverified").length;

  $("#ricon").textContent = conflicts || cautions || unverified ? "!" : "✓";
  $("#rtitle").textContent = conflicts
    ? t("conflict")
    : cautions
    ? t("caution")
    : unverified
    ? t("unverified")
    : t("mixed");

  $("#rbody").textContent =
    lang.value === "ko"
      ? `제품 ${ps.length}개 · 충돌 ${conflicts}건 · 주의 ${cautions}건 · 확인 불가 ${unverified}건`
      : `${ps.length} ${ps.length === 1 ? "Product" : "Products"} · ${conflicts} Conflict · ${cautions} Caution · ${unverified} Unverified`;

  const known = ps.filter((x) => x.calories?.package_kcal != null);
  const total = known.length
    ? known.reduce((a, x) => a + x.calories.package_kcal, 0)
    : null;

  if (total != null) {
    calTotal.style.display = "block";
    const complete = known.length === ps.length;
    calTotal.innerHTML = `<strong>${Math.round(total)} kcal</strong><span>${complete ? t("totalCalories") : t("knownCalories")}${complete ? "" : " · " + t("incompleteCalories")}</span>`;
  } else {
    calTotal.style.display = "block";
    calTotal.innerHTML = `<span>${t("noCalories")}</span>`;
  }

  ps.forEach((p, idx) => {
    const box = document.createElement("div");
    box.className = `presult ${kindFor(p.status)}`;

    const top = document.createElement("div");
    top.className = "prtop";

    const title = document.createElement("div");
    title.className = "prtitle";
    title.textContent = `${t("product")} ${idx + 1}`;

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = statusLabel(p.status);

    top.append(title, badge);
    box.appendChild(top);

    const msg = document.createElement("div");
    msg.className = "prmsg";
    msg.textContent = messageFor(p);
    box.appendChild(msg);

    const ev = document.createElement("div");
    ev.className = "evidence";

    addEv(
      ev,
      t("directMatches"),
      (p.direct_matches || []).map((x) => `${allergenLabel(x)} (${x.term})`).join(" · ")
    );
    addEv(
      ev,
      t("cautionMatches"),
      (p.caution_matches || []).map((x) => `${allergenLabel(x)} (${x.term})`).join(" · ")
    );
    addEv(
      ev,
      t("mentionMatches"),
      (p.mention_matches || []).map((x) => `${allergenLabel(x)} (${x.term})`).join(" · ")
    );
    addEv(ev, t("reason"), p.reason || "");

    const c = p.coverage || {};
    addEv(
      ev,
      t("coverage"),
      c.complete
        ? `${t("coverageComplete")} · ${p.family_ok}/${p.family_total}`
        : `${t("coverageIncomplete")} · ${p.family_ok}/${p.family_total}`
    );

    if (ev.children.length) box.appendChild(ev);

    const kcal = document.createElement("div");
    kcal.className = "kcal";
    if (p.calories?.package_kcal != null) {
      kcal.textContent = `${t("packageCalories")}: ${Math.round(p.calories.package_kcal)} kcal`;
      const b = basisText(p.calories);
      if (b) {
        const sm = document.createElement("small");
        sm.textContent = `${t("basis")}: ${b}`;
        kcal.appendChild(sm);
      }
    } else {
      kcal.textContent = t("noCalories");
    }
    box.appendChild(kcal);

    const teach = document.createElement("button");
    teach.className = "btn outline teachBtn";
    teach.textContent = t("teach");
    teach.onclick = () => teachProduct(idx, p);
    box.appendChild(teach);

    productResults.appendChild(box);
  });

  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function prepareLearning(product) {
  const hashes = [];
  for (const photo of product.photos) {
    try {
      hashes.push(photo._dhash || (photo._dhash = await dHash(photo.file)));
    } catch {}
  }
  return {
    hashes,
    learnedTexts: findLearnedTexts(hashes),
  };
}

analyze.onclick = async () => {
  const p = profile();
  if (!(p.allergens.length || p.custom_avoid.length)) {
    alert(t("noProfile"));
    return;
  }

  const active = products.filter((x) => x.photos.length);
  if (!active.length) {
    alert(t("addPhoto"));
    return;
  }

  result.classList.remove("show");
  loading.classList.add("show");
  analyze.disabled = true;

  try {
    setProgress(t("checkingSub"));

    const learning = new Map();
    for (const prod of active) {
      learning.set(prod.id, await prepareLearning(prod));
    }

    const scan = await deepScan(active, p, (info) => {
      setProgress(info.message || `${info.family || ""}`);
    });

    const defs = scan.defs;
    const requiredIds = defs.map((d) => d.id);
    const familyOk = requiredIds.filter((id) => scan.familyStatus[id]?.ok).length;

    const out = [];
    for (const prod of active) {
      const sources = scan.productSources.get(prod.id) || [];
      const learnedTexts = learning.get(prod.id)?.learnedTexts || [];

      const e = evaluateProduct({
        sources,
        profile: p,
        familyStatus: scan.familyStatus,
        requiredFamilies: requiredIds,
        learnedTexts,
      });

      out.push({
        product_id: prod.id,
        ...e,
        calories: extractProductCalories(sources),
        family_ok: familyOk,
        family_total: requiredIds.length,
        _sources: sources,
      });
    }

    lastRun = { scan, products: out };
    showResults({ products: out });
  } catch (e) {
    console.error(e);
    loading.classList.remove("show");
    alert(`${t("engineTitle")}\n${t("engineBody")}`);
  } finally {
    update();
  }
};

renderCustom();
setLang(lang.value);
renderProducts();
update();
refreshLearningUI();
