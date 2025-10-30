// webapp/js/main.js
import {
  checkAllAvailability,
  ensureSummarizer,
  ensureWriter,
  ensureRewriter,
  ensureProofreader,
  ensureTranslator,
  ensureLanguageDetector,
  ensurePromptSession
} from './lib/ai.js';
import { lintCV } from './lib/ats.js';
import { renderCV } from './lib/templates.js';
import { tokenizeSkills, groupSkillsLocal, groupSkillsAI } from './lib/skills.js';

// Cloud (local proxy → Gemini)
import {
  fetchCVSpecCloudLocal,
  renderCVHTMLCloudLocal,
  groupSkillsCloudLocal,
  summarizeJDCloudLocal,
  bulletsFromJDCloudLocal,
  writeCloudLocal,
  rewriteCloudLocal,
  proofreadCloudLocal
} from './lib/cloud_local.js';

const DEFAULT_PACKS = {
  // Added Projects, Publications, Patents to common orders
  "UK": { "page_limit": 2, "photo_allowed": false, "date_format": "MMM YYYY–MMM YYYY", "spelling": "en-GB",
    "sections": ["Summary","Experience","Education","Projects","Skills","Certifications","Publications","Patents"],
    "notes": ["Avoid photos to reduce bias risk.","Single column layout. No tables.","Reverse chronological experience."]},
  "US": { "page_limit": 1, "photo_allowed": false, "date_format": "MMM YYYY–MMM YYYY", "spelling": "en-US",
    "sections": ["Summary","Experience","Education","Projects","Skills","Certifications","Publications","Patents"],
    "notes": ["Early-career resumes typically 1 page.","Avoid headers/footers for key info.","Single column. No graphics."]},
  "DE": { "page_limit": 2, "photo_allowed": false, "date_format": "MM/YYYY–MM/YYYY", "spelling": "de-DE",
    "sections": ["Profil","Berufserfahrung","Ausbildung","Projekte","Fähigkeiten","Zertifikate","Publikationen","Patente"],
    "notes": ["Photo is culturally common but optional. Keep off for ATS fairness.","List languages with CEFR levels (e.g., B2)."]},
  "FR": { "page_limit": 2, "photo_allowed": false, "date_format": "MM/YYYY–MM/YYYY", "spelling": "fr-FR",
    "sections": ["Profil","Expérience","Éducation","Projets","Compétences","Certifications","Publications","Brevets"],
    "notes": ["Photo sometimes used; for ATS mode, keep off.","Use accents correctly (é, ç)."]},
  "IN": { "page_limit": 2, "photo_allowed": false, "date_format": "MMM YYYY–MMM YYYY", "spelling": "en-IN",
    "sections": ["Summary","Experience","Education","Projects","Skills","Certifications","Publications","Patents"],
    "notes": ["Keep format ATS-simple; avoid images and tables.","Quantify impact (%, ₹, time saved)."]}
};

const SKILL_ORDER = [
  "Programming","Frontend","Backend","Data & ML","Cloud & DevOps",
  "Databases","Testing","Tools","Languages","Other"
];

const debounce = (fn, ms=300) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };

/* ================== GUARDS & SANITIZERS ================== */
const MAX_ROLE_WORDS = 10;
const MAX_TITLE_WORDS = 12;
const MAX_BULLET_WORDS = 22;

const SENTENCE_PUNCT_RE = /[.?!:;]/;
const BULLET_MARK_RE = /^\s*[-–—•]\s*/;
const ACTION_VERB_RE = /\b(developed|implemented|improved|collaborated|built|designed|contributed|deployed|led|optimized|analysed|analyzed|managed|reduced|increased|resolved|created)\b/i;
const META_LINE_RE = /^\s*(here('?s)? (the )?(correct(ed)?|fixed) text|original (résumé|resume) text|corrected (résumé|resume) text|as an ai|note:)/i;
const CODE_FENCE_RE = /^`{3,}|`{3,}$/g;

const BAD_PHRASES = [
  'Original Résumé Text', 'Corrected Résumé Text',
  'Here is the corrected text', 'I am an AI', 'as an AI'
];

function sanitizeOneLine(s) {
  return String(s || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function firstClause(s) { return sanitizeOneLine(String(s).split(SENTENCE_PUNCT_RE)[0]); }
function capWords(s, n) {
  const parts = sanitizeOneLine(s).split(' ').filter(Boolean);
  return parts.slice(0, n).join(' ');
}
function stripMeta(text) {
  let t = String(text || '');
  t = t.replace(CODE_FENCE_RE, '');
  t = t.replace(/^\s*\*\*(?:original|corrected)[^:]*:\*\*\s*/i, '');
  t = t.replace(/^\s*(?:original|corrected)[^:]*:\s*/i, '');
  BAD_PHRASES.forEach(p => { t = t.replace(new RegExp(p, 'ig'), ''); });
  return t.trim();
}
function sanitizeRoleText(next, prev='') {
  let out = sanitizeOneLine(next).replace(BULLET_MARK_RE,'');
  out = firstClause(out);
  if (ACTION_VERB_RE.test(out)) {
    const cleanedPrev = firstClause(prev).replace(BULLET_MARK_RE,'');
    return sanitizeOneLine(cleanedPrev || capWords(out, MAX_ROLE_WORDS));
  }
  out = capWords(out, MAX_ROLE_WORDS).replace(/[.:;,-]\s*$/,'').trim();
  out = out.replace(/[^\p{L}\p{N}&+\-/.,\s]/gu, '').trim();
  return out || prev;
}
function sanitizeTitleText(next, prev='') {
  let out = sanitizeOneLine(next);
  out = firstClause(out);
  out = capWords(out, MAX_TITLE_WORDS).replace(/[.:;,-]\s*$/,'').trim();
  if (ACTION_VERB_RE.test(out)) out = capWords(out, 6);
  out = out.replace(/[^\p{L}\p{N}&+\-/.,\s]/gu, '').trim();
  return out || prev;
}
function sanitizeBulletLine(s) {
  let out = String(s || '');
  out = stripMeta(out);
  out = out.replace(BULLET_MARK_RE, '');
  out = out.replace(/\s+/g, ' ').trim();
  if (META_LINE_RE.test(out)) out = out.replace(META_LINE_RE, '').trim();
  out = out.replace(/\bnot\b.*?(,|\.)/i, '').trim();
  const words = out.split(' ').filter(Boolean);
  if (words.length > MAX_BULLET_WORDS) out = words.slice(0, MAX_BULLET_WORDS).join(' ');
  out = out.replace(/\s*[.;:,-]\s*$/, '').trim();
  out = out.replace(/^[`"'“”]+|[`"'“”]+$/g, '');
  return out;
}
function sanitizeBulletList(lines) {
  const seen = new Set();
  const clean = [];
  for (const l of lines) {
    const s = sanitizeBulletLine(l);
    if (!s) continue;
    if (BAD_PHRASES.some(p => s.toLowerCase().includes(p.toLowerCase()))) continue;
    if (!seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); clean.push(s); }
  }
  return clean;
}

/* ================== DATA MODEL (extended) ================== */
let CV = {
  profile: { name: '', title: '', location: '', contact: { email: '', phone: '', website: '', linkedin: '', github: '' }, summary: '' },
  experience: [],
  education: [],
  skills: [],
  certifications: [],   // [{ name, issuer, date, link }]
  projects: [],         // [{ name, link, bullets:[] }]
  publications: [],     // [{ title, authors, venue, date, doi, link }]
  patents: [],          // [{ title, office, number, date, status, link, inventors }]
  meta: { countryPack: 'UK', atsStrict: true, locale: 'auto' }
};

let countryPacks = DEFAULT_PACKS;

/* ================== FIELD BINDING (Summary fix) ================== */
const FIELD_ALIASES = {
  name: ['#name','[name="name"]','#fullName','#profileName'],
  title: ['#title','[name="title"]','#headline','#roleTitle','#jobTitle'],
  summary: ['#summary','#summaryText','#profileSummary','textarea[name="summary"]','#objective','#about'],
  location: ['#location','[name="location"]','#city','#currentLocation'],
  email: ['#email','[name="email"]','input[type="email"][name="email"]'],
  phone: ['#phone','[name="phone"]','input[type="tel"][name="phone"]'],
  website: ['#website','[name="website"]','#portfolio'],
  linkedin: ['#linkedin','[name="linkedin"]'],
  github: ['#github','[name="github"]']
};
const BOUND = {};
function qs(sel){ return document.querySelector(sel); }
function qsaAll(selectors){ const sels = Array.isArray(selectors) ? selectors : [selectors]; const nodes=[]; sels.forEach(s=>nodes.push(...document.querySelectorAll(s))); return Array.from(new Set(nodes)); }
function getBoundEls(field){ return BOUND[field] || []; }
function setElsValue(els, val){ els.forEach(el => { if ('value' in el && el.value !== val) el.value = val; if (el.tagName === 'TEXTAREA' && el.value !== val) el.value = val; }); }
function bindProfileField(field, { isContact=false } = {}){
  const els = qsaAll(FIELD_ALIASES[field] || []); if (!els.length) return;
  BOUND[field] = els;
  const curr = isContact ? (CV.profile.contact[field] || '') : (CV.profile[field] || '');
  setElsValue(els, curr);
  els.forEach(el => el.addEventListener('input', () => { const v = el.value ?? ''; if (isContact) CV.profile.contact[field]=v; else CV.profile[field]=v; refreshPreview(); }));
}
function updateBoundField(field, value, { isContact=false } = {}){ if (isContact) CV.profile.contact[field]=value; else CV.profile[field]=value; setElsValue(getBoundEls(field), value); }

/* ================== PRELOAD UI ================== */
function insertPreloadUI() {
  const host = document.querySelector('#ai-status')?.parentElement || document.body;
  if (document.getElementById('preloadAI')) return;
  const wrap = document.createElement('div');
  wrap.style.marginTop = '8px';
  wrap.innerHTML = `
    <button id="preloadAI" class="btn">Download AI models</button>
    <span id="preloadProgress" style="margin-left:8px;font-family:monospace;"></span>
  `;
  host.appendChild(wrap);
  document.getElementById('preloadAI').addEventListener('click', preloadAIModels);
  window.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') preloadAIModels(); });
}
function showProgress(name, p, err) {
  const el = document.getElementById('preloadProgress'); if (!el) return;
  if (err) { el.textContent = `${name}: error (${err})`; return; }
  if (p === 1) { el.textContent = `${name}: 100%`; return; }
  if (typeof p === 'number') el.textContent = p <= 0 ? `${name}: starting…` : `${name}: ${Math.round(p*100)}%`;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitAvailability(name, fnAvailability, maxMs = 5 * 60 * 1000) {
  const el = document.getElementById('preloadProgress');
  const started = Date.now();
  let last = '';
  while (Date.now() - started < maxMs) {
    let a = 'unknown';
    try { a = await fnAvailability(); } catch { a = 'error'; }
    if (a !== last) {
      last = a;
      if (el) {
        const label =
          a === 'available'     ? '100%' :
          a === 'downloading'   ? 'downloading…' :
          a === 'downloadable'  ? 'queued…' :
          a === 'unavailable'   ? 'unavailable' :
          a === 'error'         ? 'error' : a;
        el.textContent = `${name}: ${label}`;
      }
    }
    if (a === 'available') return true;
    await sleep(1500);
  }
  return false;
}

/* ========= Single source of truth for the Availability banner ========= */
async function renderAvailabilityBanner() {
  const el = document.querySelector('#ai-status');
  if (!el) return;
  try {
    const pairs = await checkAllAvailability(); // e.g., [["Prompt API","available"], ...]
    const parts = pairs
      .filter(([n]) => String(n).toLowerCase() !== 'language detector') // avoid dup if ever included
      .map(([n, a]) => `${n}: <strong>${a}</strong>`);
    try {
      const ld = await self.LanguageDetector?.availability?.();
      if (ld) parts.push(`Language Detector: <strong>${ld}</strong>`);
    } catch {}
    el.innerHTML = 'Availability: ' + parts.join(' · ');
  } catch {
    // no-op
  }
}

/* ================== EXPORT (PDF/HTML) — with extra sections augmentation ================== */
function sectionHeadingExists(root, label){
  const hs = root.querySelectorAll('h2, h3, .section-title');
  for (const h of hs) { if ((h.textContent||'').trim().toLowerCase() === String(label).trim().toLowerCase()) return true; }
  return false;
}
function mk(tag, className){ const el=document.createElement(tag); if (className) el.className=className; return el; }
function formatPublication(p){
  const bits = [];
  if (p.authors) bits.push(p.authors);
  if (p.title) bits.push(`“${p.title}”`);
  if (p.venue) bits.push(p.venue);
  if (p.date) bits.push(p.date);
  if (p.doi) bits.push(`doi:${p.doi}`);
  return bits.join(', ');
}
function formatPatent(p){
  const bits = [];
  if (p.title) bits.push(p.title);
  const det = [p.office, p.number].filter(Boolean).join(' ');
  if (det) bits.push(det);
  if (p.status) bits.push(p.status);
  if (p.date) bits.push(p.date);
  return bits.join(' · ');
}
function addListSection(root, title, items){
  if (!items?.length) return;
  root.querySelectorAll(`[data-autoinserted="${title}"]`).forEach(n => n.remove());
  if (sectionHeadingExists(root, title)) return;

  const sec = mk('section','cv-section'); sec.setAttribute('data-autoinserted', title);
  const h = mk('h2'); h.textContent = title; sec.appendChild(h);
  const ul = mk('ul'); ul.style.paddingLeft = '1.1rem';
  items.forEach(txt => { const li=mk('li'); li.textContent = txt; ul.appendChild(li); });
  sec.appendChild(ul);
  root.appendChild(sec);
}
function augmentExtraSections(root){
  const pubs = (CV.publications||[]).map(p => {
    let line = formatPublication(p);
    if (p.link) line += ` — ${p.link}`;
    return line;
  });
  addListSection(root, 'Publications', pubs);

  const pats = (CV.patents||[]).map(p => {
    let line = formatPatent(p);
    if (p.link) line += ` — ${p.link}`;
    return line;
  });
  addListSection(root, 'Patents', pats);

  const certs = (CV.certifications||[]).map(c => {
    const bits=[c.name, c.issuer, c.date].filter(Boolean).join(' — ');
    return c.link ? `${bits} — ${c.link}` : bits;
  });
  addListSection(root, 'Certifications', certs);

  const projs = (CV.projects||[]).map(p => p.link ? `${p.name} — ${p.link}` : p.name).filter(Boolean);
  addListSection(root, 'Projects', projs);
}

async function onExportPDF() {
  let htmlDoc = '';
  try {
    const spec = await fetchCVSpecCloudLocal({ country: CV.meta.countryPack, seniority: 'mid' });
    const htmlGem = await renderCVHTMLCloudLocal(CV, spec, 'classic');
    if (htmlGem && (/<html[\s>]/i.test(htmlGem) || /^<!doctype html>/i.test(htmlGem))) {
      htmlDoc = htmlGem;
    }
  } catch (_) {}

  if (!htmlDoc) {
    const pack = (countryPacks[CV.meta.countryPack] || DEFAULT_PACKS['UK']);
    const root = renderCV(CV, pack);
    augmentExtraSections(root);

    let css = '';
    try { const r = await fetch('./css/cv.css', { cache:'no-cache' }); css = r.ok ? await r.text() : ''; } catch {}
    const printCss = `
      ${css}
      @page { size: A4; margin: 14mm; }
      @media print {
        body { background: #fff !important; }
        .cv-page { box-shadow: none !important; margin: 0 !important; width: auto !important; }
      }
    `;
    htmlDoc = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${CV.profile?.name ? (CV.profile.name + ' - CV') : 'CV'}</title>
  <style>${printCss}</style>
</head>
<body>
  ${root.outerHTML}
</body>
</html>`;
  }

  const blob = new Blob([htmlDoc], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed'; frame.style.right = '0'; frame.style.bottom = '0';
  frame.style.width = '0'; frame.style.height = '0'; frame.style.border = '0';
  document.body.appendChild(frame);
  frame.onload = () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); }
    finally { setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(frame); }, 1200); }
  };
  frame.src = url;
}

async function onExportHTML() {
  try {
    const spec = await fetchCVSpecCloudLocal({ country: CV.meta.countryPack, seniority: 'mid' });
    const htmlGem = await renderCVHTMLCloudLocal(CV, spec, 'classic');
    if (htmlGem && /^<!doctype html>/i.test(htmlGem) || /<html[\s>]/i.test(htmlGem)) {
      const blobG = new Blob([htmlGem], { type:'text/html' });
      const urlG = URL.createObjectURL(blobG);
      const aG=document.createElement('a'); aG.href=urlG; aG.download='cv.html'; aG.click();
      setTimeout(()=>URL.revokeObjectURL(urlG),1000);
      return;
    }
  } catch(e) { console.warn('Gemini render failed, falling back to local export:', e?.message||e); }

  try {
    const pack = countryPacks[CV.meta.countryPack] || DEFAULT_PACKS['UK'];
    const root = renderCV(CV, pack);
    augmentExtraSections(root);
    const htmlBody = root.outerHTML;
    let css = '';
    try { const r = await fetch('./css/cv.css', { cache:'no-cache' }); css = r.ok ? await r.text() : ''; } catch {}
    const html = `<!doctype html>
<meta charset="utf-8">
<title>${CV.profile?.name ? (CV.profile.name + ' - CV') : 'CV'}</title>
<style>${css || 'body{font-family:Arial,sans-serif}'}</style>
<body>${htmlBody}</body>`;
    const blob = new Blob([html], { type:'text/html' });
    const url = URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download='cv.html'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  } catch (e) { alert('Export failed. See console.'); console.error(e); }
}

/* ================== PRELOAD MODELS (now calls renderAvailabilityBanner) ================== */
async function preloadAIModels() {
  const results = [];
  try {
    if ('LanguageModel' in self) {
      try {
        const s = await self.LanguageModel.availability();
        if (s !== 'available') {
          const sess = await ensurePromptSession({}, showProgress);
          try { sess.destroy?.(); } catch {}
          await waitAvailability('Prompt', () => self.LanguageModel.availability());
        }
      } catch (e) { results.push(`Prompt: ${e.message||'error'}`); }
    } else { results.push('Prompt: unsupported'); }

    for (const [name, Ensurer, api] of [
      ['Summarizer', ensureSummarizer, 'Summarizer'],
      ['Writer', ensureWriter, 'Writer'],
      ['Rewriter', ensureRewriter, 'Rewriter'],
      ['Proofreader', ensureProofreader, 'Proofreader'],
    ]) {
      if (api in self) {
        try {
          const s = await self[api].availability();
          if (s !== 'available') {
            const obj = await Ensurer({}, showProgress);
            try { obj.destroy?.(); } catch {}
            await waitAvailability(name, () => self[api].availability());
          }
        } catch (e) { results.push(`${name}: ${e.message||'error'}`); }
      } else { results.push(`${name}: unsupported`); }
    }

    if ('LanguageDetector' in self) {
      try {
        const s = await self.LanguageDetector.availability();
        if (s !== 'available') {
          await ensureLanguageDetector();
          await waitAvailability('Language Detector', () => self.LanguageDetector.availability());
        }
      } catch (e) { results.push(`Language Detector: ${e.message || 'error'}`); }
    } else {
      results.push('Language Detector: unsupported');
    }

  } finally {
    await renderAvailabilityBanner(); // <— single source of truth
  }
  if (results.length) alert(results.join('\n'));
}

/* ================== COUNTRY PACKS ================== */
async function loadCountryPacks() {
  const candidates = ['/shared/country_packs.json','../shared/country_packs.json','./shared/country_packs.json','shared/country_packs.json'];
  for (const url of candidates) {
    try { const r = await fetch(url, { cache:'no-cache' }); if (r.ok) return await r.json(); } catch(e) {}
  }
  console.warn('[CV Foundry] Using built-in country packs (fetch failed).');
  return DEFAULT_PACKS;
}

/* ================== INIT ================== */
(async function init(){
  try {
    await renderAvailabilityBanner(); // <— render once at boot
  } catch {}
  try { countryPacks = await loadCountryPacks(); } catch { countryPacks = DEFAULT_PACKS; }
  insertPreloadUI();

  // Bind profile fields incl. Summary
  bindProfileField('name'); bindProfileField('title'); bindProfileField('summary');
  bindProfileField('location'); bindProfileField('email',{isContact:true}); bindProfileField('phone',{isContact:true});
  bindProfileField('website',{isContact:true}); bindProfileField('linkedin',{isContact:true}); bindProfileField('github',{isContact:true});

  // Country select + Gemini spec fetch
  const countrySel = qs('#countryPack');
  if (countrySel) {
    countrySel.innerHTML = '';
    Object.keys(countryPacks).forEach(k => { const o=document.createElement('option'); o.value=k; o.textContent=k; countrySel.append(o); });
    countrySel.value = CV.meta.countryPack;
    countrySel.addEventListener('change', async e => {
      CV.meta.countryPack = e.target.value;
      await updateCountryPackFromGemini(CV.meta.countryPack);
      updateCountryNotes();
      refreshPreview();
    });
    await updateCountryPackFromGemini(CV.meta.countryPack).catch(()=>{});
  }

  const atsStrict = qs('#atsStrict');
  if (atsStrict) { atsStrict.checked = true; atsStrict.addEventListener('change', e => { CV.meta.atsStrict = e.target.checked; refreshPreview(); }); }
  qs('#locale')?.addEventListener('change', e => { CV.meta.locale = e.target.value; });

  updateCountryNotes();

  // Buttons
  qs('#addExperience')?.addEventListener('click', () => addExperience());
  qs('#addEducation')?.addEventListener('click', () => addEducation());
  qs('#addCertification')?.addEventListener('click', () => addCertification());
  qs('#addProject')?.addEventListener('click', () => addProject());
  qs('#addPublication')?.addEventListener('click', () => addPublication());
  qs('#addPatent')?.addEventListener('click', () => addPatent());
  qs('#analyzeJD')?.addEventListener('click', onAnalyzeJD);
  qs('#genBullets')?.addEventListener('click', onGenBullets);
  qs('#rewriteTone')?.addEventListener('click', onRewriteTone);
  qs('#proofread')?.addEventListener('click', onProofreadAll);
  qs('#translate')?.addEventListener('click', onTranslate);
  qs('#exportHTML')?.addEventListener('click', onExportHTML);
  qs('#exportPDF')?.addEventListener('click', onExportPDF);

  /* ---------- Skills normalize (Gemini) + group ---------- */
  const normalizeSkillsAI = async (rawText) => {
    const input = String(rawText || '').trim();
    if (!input) return [];

    try {
      const avail = await self.LanguageModel?.availability?.();
      if (avail === 'available') {
        const session = await ensurePromptSession({});
        const schema = {
          type: 'object',
          properties: { skills: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 200 } },
          required: ['skills']
        };
        const prompt =
`Extract distinct professional/technical skills and tools from the text below.
Rules:
- Keep multi-word terms as ONE item (e.g., "Machine Learning", "Natural Language Processing").
- Normalize tech casing (e.g., "pytorch" → "PyTorch", "aws" → "AWS").
- Remove duplicates and fluff.
Return ONLY JSON: {"skills": string[]}

TEXT:
${input}`;
        const res = await session.prompt(prompt, { responseConstraint: schema });
        try { const parsed = JSON.parse(res); if (Array.isArray(parsed.skills)) return [...new Set(parsed.skills.map(s => String(s).trim()).filter(Boolean))]; } catch {}
      }
    } catch (e) { console.warn('Prompt skills normalize failed:', e); }

    try {
      const json = await writeCloudLocal({
        prompt:
`Extract distinct professional/technical skills and tools from the text.
- Keep multi-word terms intact (e.g., "Machine Learning", "Deep Learning").
- Normalize casing; remove duplicates.
Reply ONLY with a minified JSON array of strings, no prose.

TEXT:
${input}`,
        tone: 'neutral', length: 'short', format: 'plain-text'
      });
      let arr = [];
      try { const parsed = JSON.parse(json); if (Array.isArray(parsed)) arr = parsed; else if (Array.isArray(parsed.skills)) arr = parsed.skills; }
      catch { arr = String(json || '').split(/[\n,]+/).map(s => s.trim().replace(/^[-•]\s*/, '')).filter(Boolean); }
      return [...new Set(arr.map(s => String(s).trim()).filter(Boolean))];
    } catch (e) { console.warn('Cloud skills normalize failed:', e); }

    return tokenizeSkills(input);
  };

  const recomputeSkillsGrouped = async () => {
    try {
      const avail = await self.LanguageModel?.availability?.();
      if (avail === 'available') {
        CV.meta.skillsGrouped = await groupSkillsAI(CV.skills);
        CV.meta.skillsGroupedSource = 'ai';
      } else {
        try { CV.meta.skillsGrouped = await groupSkillsCloudLocal(CV.skills, SKILL_ORDER); CV.meta.skillsGroupedSource = 'cloud-local'; }
        catch { CV.meta.skillsGrouped = groupSkillsLocal(CV.skills); CV.meta.skillsGroupedSource = 'heuristic'; }
      }
    } catch {
      try { CV.meta.skillsGrouped = await groupSkillsCloudLocal(CV.skills, SKILL_ORDER); CV.meta.skillsGroupedSource = 'cloud-local'; }
      catch { CV.meta.skillsGrouped = groupSkillsLocal(CV.skills); CV.meta.skillsGroupedSource = 'heuristic'; }
    }
    refreshPreview();
  };
  const recomputeSkillsGroupedDebounced = debounce(recomputeSkillsGrouped, 350);

  let skillsTaskId = 0;
  const normalizeAndGroupSkills = async (raw) => {
    const myId = ++skillsTaskId;
    const normalized = await normalizeSkillsAI(raw);
    if (myId !== skillsTaskId) return;
    CV.skills = normalized;
    await recomputeSkillsGrouped();
  };
  const normalizeAndGroupSkillsDebounced = debounce(normalizeAndGroupSkills, 450);
  document.querySelectorAll('#skills, textarea[name="skills"], #skillsInput').forEach(el => {
    el.addEventListener('input', (e) => normalizeAndGroupSkillsDebounced(e.target.value));
  });

  // Seed example experience
  addExperience({ company:'Acme Corp', role:'Frontend Engineer', location:'London, UK', start:'Jan 2022', end:'Present', bullets:['Shipped performance improvements that reduced LCP by 22%.'] });

  await recomputeSkillsGrouped();
  refreshPreview();

  // Auto-upgrade to AI when Prompt model becomes available
  (function pollPromptReady(){
    let last = 'unknown';
    const iv = setInterval(async () => {
      try {
        const a = await self.LanguageModel?.availability?.();
        if (a !== last) {
          last = a;
          await renderAvailabilityBanner(); // <— refresh whole line cleanly
        }
        if (a === 'available') clearInterval(iv);
      } catch {}
    }, 4000);
  })();

  // Auto-update Language Detector status without duplicating
  (function pollLangReady() {
    let last = 'unknown';
    const iv = setInterval(async () => {
      try {
        const a = await self.LanguageDetector?.availability?.();
        if (!a) return; // API not present
        if (a !== last) {
          last = a;
          await renderAvailabilityBanner(); // <— refresh whole line cleanly
        }
        if (a === 'available') clearInterval(iv);
      } catch {}
    }, 4000);
  })();

})().catch(e => { console.error('Init failed:', e); alert('Init failed — reload and ensure you served from the project root.'); });

/* ================== COUNTRY SPEC helper ================== */
async function updateCountryPackFromGemini(country) {
  try {
    const spec = await fetchCVSpecCloudLocal({ country, seniority: 'mid' });
    const baseSections = (DEFAULT_PACKS[country]?.sections ?? DEFAULT_PACKS['UK'].sections);
    const specSections = Array.isArray(spec.section_order) && spec.section_order.length ? spec.section_order : baseSections;
    const ensureExtras = (arr) => {
      const need = ['Projects','Certifications','Publications','Patents'];
      const out = [...arr];
      need.forEach(s => { if (!out.some(x => String(x).toLowerCase()===s.toLowerCase())) out.push(s); });
      return out;
    };
    countryPacks[country] = {
      page_limit: spec.page_limit ?? (DEFAULT_PACKS[country]?.page_limit ?? 2),
      photo_allowed: !!spec.photo_allowed,
      date_format: spec.date_format || (DEFAULT_PACKS[country]?.date_format ?? 'MMM YYYY–MMM YYYY'),
      spelling: spec.spelling || (DEFAULT_PACKS[country]?.spelling ?? 'en-GB'),
      sections: ensureExtras(specSections),
      notes: Array.isArray(spec.notes) ? spec.notes : (DEFAULT_PACKS[country]?.notes ?? [])
    };
  } catch (e) { console.warn('cvSpec fallback to built-in for', country, e?.message||e); }
}
function updateCountryNotes() {
  const pack = countryPacks[CV.meta.countryPack] || DEFAULT_PACKS['UK'];
  const notesEl = qs('#countryNotes'); if (!notesEl) return;
  notesEl.innerHTML = `<strong>Defaults:</strong> ${pack.sections.join(', ')} · ${pack.page_limit}p max · ${pack.date_format}<br><em>${pack.notes.join(' • ')}</em>`;
}

/* ================== EXPERIENCE/EDU UI ================== */
const expList = document.querySelector('#experienceList') || document.createElement('div');
function addExperience(initial={}) {
  const idx = CV.experience.push({ company:'', role:'', location:'', start:'', end:'', bullets:[], ...initial }) - 1;
  const wrap = document.createElement('div');
  wrap.className = 'exp-card';
  wrap.innerHTML = `
    <div class="grid">
      <label>Company<input data-k="company" /></label>
      <label>Role<input data-k="role" /></label>
      <label>Location<input data-k="location" /></label>
      <label>Start<input data-k="start" placeholder="MMM YYYY or MM/YYYY" /></label>
      <label>End<input data-k="end" placeholder="Present or MMM YYYY" /></label>
    </div>
    <label>Bullets (one per line)<textarea data-k="bullets" rows="4"></textarea></label>
    <div class="controls">
      <button class="btn" data-act="generate">Generate from JD</button>
      <button class="btn" data-act="rewrite">Rewrite</button>
      <button class="btn" data-act="delete">Delete</button>
    </div>`;
  wrap.querySelectorAll('input, textarea').forEach(inp => {
    if (inp.dataset.k in initial) inp.value = initial[inp.dataset.k];
    inp.addEventListener('input', () => {
      const k = inp.dataset.k;
      if (k === 'bullets') CV.experience[idx].bullets = inp.value.split('\n').map(s=>s.trim()).filter(Boolean);
      else CV.experience[idx][k] = inp.value;
      refreshPreview();
    });
  });
  wrap.querySelector('[data-act="delete"]')?.addEventListener('click', () => { CV.experience.splice(idx,1); expList.removeChild(wrap); refreshPreview(); });

  // REWRITE bullets
  wrap.querySelector('[data-act="rewrite"]')?.addEventListener('click', async () => {
    const original = CV.experience[idx].bullets.join('\n');
    try {
      const rewriter = await ensureRewriter({ tone:'neutral', format:'plain-text', length:'short' });
      const improved = await rewriter.rewrite(original, { operation:'tighten' }).catch(()=>original);
      let out = String(improved || original).split('\n').map(s=>s.trim()).filter(Boolean);
      out = sanitizeBulletList(out);
      if (out.length) {
        CV.experience[idx].bullets = out;
        wrap.querySelector('textarea[data-k="bullets"]').value = out.join('\n');
        refreshPreview(); return;
      }
    } catch (eDevice) {
      try {
        const improved = await rewriteCloudLocal({ text: original, operation:'tighten', tone:'neutral', length:'short', format:'plain-text' });
        let out = String(improved || original).split('\n').map(s=>s.trim()).filter(Boolean);
        out = sanitizeBulletList(out);
        if (out.length) {
          CV.experience[idx].bullets = out;
          wrap.querySelector('textarea[data-k="bullets"]').value = out.join('\n');
          refreshPreview(); return;
        }
      } catch (eCloud) {
        try {
          const viaWriter = await writeCloudLocal({
            prompt: 'Rewrite each resume bullet into a concise, quantified, ATS-friendly bullet. Keep one bullet per line, ≤22 words.\n' + original,
            tone:'neutral', length:'short', format:'plain-text'
          });
          let out = String(viaWriter || original).split('\n').map(s=>s.trim()).filter(Boolean);
          out = sanitizeBulletList(out);
          if (out.length) {
            CV.experience[idx].bullets = out;
            wrap.querySelector('textarea[data-k="bullets"]').value = out.join('\n');
            refreshPreview(); return;
          }
        } catch (eWriter) {
          alert(`Rewriter failed.`);
        }
      }
    }
  });

  wrap.querySelector('[data-act="generate"]')?.addEventListener('click', onGenerateFromJD(idx, wrap));
  (document.querySelector('#experienceList')||expList).appendChild(wrap);
}

const eduList = document.querySelector('#educationList') || document.createElement('div');
function addEducation(initial={}) {
  const idx = CV.education.push({ institution:'', degree:'', start:'', end:'' , ...initial}) - 1;
  const wrap = document.createElement('div');
  wrap.className = 'exp-card';
  wrap.innerHTML = `
    <div class="grid">
      <label>Institution<input data-k="institution" /></label>
      <label>Degree<input data-k="degree" /></label>
      <label>Start<input data-k="start" /></label>
      <label>End<input data-k="end" /></label>
    </div>`;
  wrap.querySelectorAll('input').forEach(inp => {
    if (inp.dataset.k in initial) inp.value = initial[inp.dataset.k];
    inp.addEventListener('input', () => { CV.education[idx][inp.dataset.k] = inp.value; refreshPreview(); });
  });
  (document.querySelector('#educationList')||eduList).appendChild(wrap);
}

/* ================== NEW SECTION UI BUILDERS ================== */
const certList = document.querySelector('#certificationList') || document.createElement('div');
function addCertification(initial={}) {
  const idx = CV.certifications.push({ name:'', issuer:'', date:'', link:'', ...initial }) - 1;
  const wrap = document.createElement('div'); wrap.className = 'exp-card';
  wrap.innerHTML = `
    <div class="grid">
      <label>Name<input data-k="name" /></label>
      <label>Issuer<input data-k="issuer" /></label>
      <label>Date<input data-k="date" placeholder="MMM YYYY" /></label>
      <label>Link<input data-k="link" placeholder="https://..." /></label>
    </div>
    <div class="controls"><button class="btn" data-act="delete">Delete</button></div>`;
  wrap.querySelectorAll('input').forEach(inp => {
    if (inp.dataset.k in initial) inp.value = initial[inp.dataset.k];
    inp.addEventListener('input', () => { CV.certifications[idx][inp.dataset.k] = inp.value; refreshPreview(); });
  });
  wrap.querySelector('[data-act="delete"]')?.addEventListener('click', () => { CV.certifications.splice(idx,1); certList.removeChild(wrap); refreshPreview(); });
  (document.querySelector('#certificationList')||certList).appendChild(wrap);
}

const projList = document.querySelector('#projectList') || document.createElement('div');
function addProject(initial={}) {
  const idx = CV.projects.push({ name:'', link:'', bullets:[], ...initial }) - 1;
  const wrap = document.createElement('div'); wrap.className = 'exp-card';
  wrap.innerHTML = `
    <div class="grid">
      <label>Name<input data-k="name" /></label>
      <label>Link<input data-k="link" placeholder="https://..." /></label>
    </div>
    <label>Bullets (one per line)<textarea data-k="bullets" rows="3"></textarea></label>
    <div class="controls">
      <button class="btn" data-act="rewrite">Rewrite</button>
      <button class="btn" data-act="delete">Delete</button>
    </div>`;
  wrap.querySelectorAll('input, textarea').forEach(inp => {
    if (inp.dataset.k in initial) inp.value = initial[inp.dataset.k];
    inp.addEventListener('input', () => {
      const k = inp.dataset.k;
      if (k === 'bullets') CV.projects[idx].bullets = inp.value.split('\n').map(s=>s.trim()).filter(Boolean);
      else CV.projects[idx][k] = inp.value;
      refreshPreview();
    });
  });
  wrap.querySelector('[data-act="delete"]')?.addEventListener('click', () => { CV.projects.splice(idx,1); projList.removeChild(wrap); refreshPreview(); });
  wrap.querySelector('[data-act="rewrite"]')?.addEventListener('click', async () => {
    const original = CV.projects[idx].bullets.join('\n');
    try {
      const rewriter = await ensureRewriter({ tone:'neutral', format:'plain-text', length:'short' });
      let out = await rewriter.rewrite(original, { operation:'tighten' }).catch(()=>original);
      out = sanitizeBulletList(String(out||original).split('\n'));
      CV.projects[idx].bullets = out;
      wrap.querySelector('textarea[data-k="bullets"]').value = out.join('\n');
      refreshPreview();
    } catch { /* ignore */ }
  });
  (document.querySelector('#projectList')||projList).appendChild(wrap);
}

const pubList = document.querySelector('#publicationList') || document.createElement('div');
function addPublication(initial={}) {
  const idx = CV.publications.push({ title:'', authors:'', venue:'', date:'', doi:'', link:'', ...initial }) - 1;
  const wrap = document.createElement('div'); wrap.className = 'exp-card';
  wrap.innerHTML = `
    <div class="grid">
      <label>Title<input data-k="title" /></label>
      <label>Authors<input data-k="authors" placeholder="A. Author, B. Author" /></label>
      <label>Venue<input data-k="venue" placeholder="Conf./Journal" /></label>
      <label>Date<input data-k="date" placeholder="YYYY" /></label>
      <label>DOI<input data-k="doi" placeholder="10.xxxx/..." /></label>
      <label>Link<input data-k="link" placeholder="https://..." /></label>
    </div>
    <div class="controls"><button class="btn" data-act="delete">Delete</button></div>`;
  wrap.querySelectorAll('input').forEach(inp => {
    if (inp.dataset.k in initial) inp.value = initial[inp.dataset.k];
    inp.addEventListener('input', () => { CV.publications[idx][inp.dataset.k] = inp.value; refreshPreview(); });
  });
  wrap.querySelector('[data-act="delete"]')?.addEventListener('click', () => { CV.publications.splice(idx,1); pubList.removeChild(wrap); refreshPreview(); });
  (document.querySelector('#publicationList')||pubList).appendChild(wrap);
}

const patList = document.querySelector('#patentList') || document.createElement('div');
function addPatent(initial={}) {
  const idx = CV.patents.push({ title:'', office:'', number:'', date:'', status:'', link:'', inventors:'', ...initial }) - 1;
  const wrap = document.createElement('div'); wrap.className = 'exp-card';
  wrap.innerHTML = `
    <div class="grid">
      <label>Title<input data-k="title" /></label>
      <label>Office<input data-k="office" placeholder="USPTO/EPO/etc." /></label>
      <label>Number<input data-k="number" placeholder="US 12,345,678" /></label>
      <label>Status<input data-k="status" placeholder="Granted/Pending" /></label>
      <label>Date<input data-k="date" placeholder="YYYY" /></label>
      <label>Inventors<input data-k="inventors" placeholder="A. Inventor, B. Inventor" /></label>
      <label>Link<input data-k="link" placeholder="https://..." /></label>
    </div>
    <div class="controls"><button class="btn" data-act="delete">Delete</button></div>`;
  wrap.querySelectorAll('input').forEach(inp => {
    if (inp.dataset.k in initial) inp.value = initial[inp.dataset.k];
    inp.addEventListener('input', () => { CV.patents[idx][inp.dataset.k] = inp.value; refreshPreview(); });
  });
  wrap.querySelector('[data-act="delete"]')?.addEventListener('click', () => { CV.patents.splice(idx,1); patList.removeChild(wrap); refreshPreview(); });
  (document.querySelector('#patentList')||patList).appendChild(wrap);
}

/* ================== LOCALE / PROOFREAD (extended to new sections) ================== */
function languagesForPack(pack) { const tag = String(pack?.spelling || 'en-GB'); const base = tag.split('-')[0] || 'en'; return Array.from(new Set([tag, base])); }
function norm(s) { return String(s ?? '').replace(/\s+/g, ' ').trim(); }

async function normalizeDialect(text, localeTag) {
  const input = String(text ?? '');
  if (!/^en(-|$)/i.test(localeTag)) return input;
  const instruction = `Convert spelling to ${localeTag} conventions (e.g., organisation/organization as appropriate).
Correct ONLY spelling variants; preserve meaning, punctuation, casing and line breaks.
Return ONLY the corrected text.`;
  try {
    const writer = await ensureWriter({ tone:'neutral', format:'plain-text', length:'short' });
    const out = await writer.write(`${instruction}\n${input}`, { context: 'Dialect normalisation for résumé text' });
    if (out && norm(out) !== norm(input)) return String(stripMeta(out));
  } catch (_) {}
  try {
    const out = await writeCloudLocal({ prompt: `${instruction}\n${input}`, tone: 'neutral', length: 'short', format: 'plain-text' });
    if (out && norm(out) !== norm(input)) return String(stripMeta(out));
  } catch (_) {}
  return input;
}

async function proofreadSmart(text, { localeTag = 'en-GB', aggressive = true } = {}) {
  const input = String(text ?? '').trim(); if (!input) return { corrected: '', source: 'none' };
  try {
    const langs = languagesForPack({ spelling: localeTag });
    const proof = await ensureProofreader({ expectedInputLanguages: langs });
    const r = await proof.proofread(input);
    if (r?.corrected && norm(r.corrected) !== norm(input)) return { corrected: stripMeta(r.corrected), source: 'device' };
    if (!aggressive) return { corrected: stripMeta(r?.corrected || input), source: 'device' };
  } catch (_) {}
  try {
    const corrected = await proofreadCloudLocal({ text: input, language: localeTag });
    if (corrected && norm(corrected) !== norm(input)) return { corrected: stripMeta(corrected), source: 'cloud' };
  } catch (_) {}
  try {
    const fixed = await writeCloudLocal({
      prompt: 'Correct grammar, spelling, and punctuation ONLY. Preserve line breaks. Return ONLY the corrected text (no explanations, headings, labels).\n' + input,
      tone:'neutral', length:'short', format:'plain-text'
    });
    if (fixed && norm(fixed) !== norm(input)) return { corrected: stripMeta(String(fixed)), source: 'writer' };
  } catch (_) {}
  return { corrected: input, source: 'original' };
}
async function proofreadRoleSafe(text, localeTag) {
  const original = String(text || ''); let out = original;
  try { const langs = languagesForPack({ spelling: localeTag }); const proof = await ensureProofreader({ expectedInputLanguages: langs }); const r = await proof.proofread(original); if (r?.corrected) out = r.corrected; } catch (_) {}
  if (out === original) { try { const corrected = await proofreadCloudLocal({ text: original, language: localeTag }); if (corrected) out = corrected; } catch (_) {} }
  return sanitizeRoleText(out, original);
}
async function proofreadBulletsSafe(list, localeTag) {
  const out = [];
  for (const b of list) {
    let curr = String(b || '');
    try { const langs = languagesForPack({ spelling: localeTag }); const proof = await ensureProofreader({ expectedInputLanguages: langs }); const r = await proof.proofread(curr); if (r?.corrected) curr = r.corrected; } catch (_) {}
    try { const corrected = await proofreadCloudLocal({ text: curr, language: localeTag }); if (corrected) curr = corrected; } catch (_) {}
    out.push(sanitizeBulletLine(curr));
  }
  return sanitizeBulletList(out);
}

async function onProofreadAll() {
  const pack = countryPacks[CV.meta.countryPack] || DEFAULT_PACKS[CV.meta.countryPack] || { spelling: 'en-GB' };
  const localeTag = String(pack.spelling || 'en-GB');
  let changes = 0; const changedFields = [];

  const fixStringField = async (value, doDialect = true) => {
    let { corrected } = await proofreadSmart(value, { localeTag, aggressive: true });
    if (doDialect) corrected = await normalizeDialect(corrected, localeTag);
    return corrected;
  };

  // Summary & Title
  if (typeof CV.profile.summary === 'string') { const before = CV.profile.summary; const after = await fixStringField(before, true); if (after !== before) { updateBoundField('summary', after); changes++; changedFields.push('Summary'); } }
  if (CV.profile.title) { const before = CV.profile.title; const afterRaw = await fixStringField(before, true); const after = sanitizeTitleText(afterRaw, before); if (after !== before) { updateBoundField('title', after); changes++; changedFields.push('Title'); } }

  // Experience
  const expCards = document.querySelectorAll('#experienceList .exp-card');
  for (let i = 0; i < CV.experience.length; i++) {
    const exp = CV.experience[i];
    if (exp.role) {
      const before = exp.role; const safe = await proofreadRoleSafe(before, localeTag);
      if (safe !== before) { exp.role = safe; const inp = expCards[i]?.querySelector('input[data-k="role"]'); if (inp) inp.value = safe; changes++; changedFields.push(`Experience #${i+1} role`); }
    }
    if (Array.isArray(exp.bullets) && exp.bullets.length) {
      const beforeList = [...exp.bullets]; const afterList = await proofreadBulletsSafe(beforeList, localeTag);
      if (afterList.join('\n') !== beforeList.join('\n')) { exp.bullets = afterList; const ta = expCards[i]?.querySelector('textarea[data-k="bullets"]'); if (ta) ta.value = afterList.join('\n'); changes++; changedFields.push(`Experience #${i+1} bullets`); }
    }
  }

  // Education degree
  const eduCards = document.querySelectorAll('#educationList .exp-card');
  for (let i = 0; i < CV.education.length; i++) {
    const ed = CV.education[i];
    if (ed.degree) { const before = ed.degree; const afterRaw = await fixStringField(before, true); const after = sanitizeTitleText(afterRaw, before);
      if (after !== before) { ed.degree = after; const inp = eduCards[i]?.querySelector('input[data-k="degree"]'); if (inp) inp.value = after; changes++; changedFields.push(`Education #${i+1} degree`); } }
  }

  // Projects bullets
  if (Array.isArray(CV.projects)) {
    const projCards = document.querySelectorAll('#projectList .exp-card');
    for (let i = 0; i < CV.projects.length; i++) {
      const pr = CV.projects[i];
      if (Array.isArray(pr.bullets) && pr.bullets.length) {
        const beforeList = [...pr.bullets]; const afterList = await proofreadBulletsSafe(beforeList, localeTag);
        if (afterList.join('\n') !== beforeList.join('\n')) { pr.bullets = afterList; const ta = projCards[i]?.querySelector('textarea[data-k="bullets"]'); if (ta) ta.value = afterList.join('\n'); changes++; changedFields.push(`Project #${i+1} bullets`); }
      }
      if (pr.name) { const before = pr.name; const after = sanitizeTitleText(await fixStringField(before, true), before); if (after !== before) { pr.name = after; const inp = projCards[i]?.querySelector('input[data-k="name"]'); if (inp) inp.value = after; changes++; changedFields.push(`Project #${i+1} name`); } }
    }
  }

  // Certifications basic fields
  if (Array.isArray(CV.certifications)) {
    const certCards = document.querySelectorAll('#certificationList .exp-card');
    for (let i = 0; i < CV.certifications.length; i++) {
      const c = CV.certifications[i];
      for (const k of ['name','issuer']) {
        if (c[k]) {
          const before = c[k]; const after = sanitizeTitleText(await fixStringField(before, true), before);
          if (after !== before) { c[k] = after; const inp = certCards[i]?.querySelector(`input[data-k="${k}"]`); if (inp) inp.value = after; changes++; changedFields.push(`Certification #${i+1} ${k}`); }
        }
      }
    }
  }

  // Publications fields
  if (Array.isArray(CV.publications)) {
    const pubCards = document.querySelectorAll('#publicationList .exp-card');
    for (let i = 0; i < CV.publications.length; i++) {
      const p = CV.publications[i];
      for (const k of ['title','venue']) {
        if (p[k]) {
          const before = p[k]; const after = sanitizeTitleText(await fixStringField(before, true), before);
          if (after !== before) { p[k] = after; const inp = pubCards[i]?.querySelector(`input[data-k="${k}"]`); if (inp) inp.value = after; changes++; changedFields.push(`Publication #${i+1} ${k}`); }
        }
      }
    }
  }

  // Patents fields
  if (Array.isArray(CV.patents)) {
    const patCards = document.querySelectorAll('#patentList .exp-card');
    for (let i = 0; i < CV.patents.length; i++) {
      const p = CV.patents[i];
      for (const k of ['title','status','office']) {
        if (p[k]) {
          const before = p[k]; const after = sanitizeTitleText(await fixStringField(before, true), before);
          if (after !== before) { p[k] = after; const inp = patCards[i]?.querySelector(`input[data-k="${k}"]`); if (inp) inp.value = after; changes++; changedFields.push(`Patent #${i+1} ${k}`); }
        }
      }
    }
  }
  
  refreshPreview();
  alert(changes ? `Proofread complete. Updated ${changes} field${changes>1?'s':''}:\n• ${changedFields.join('\n• ')}` : 'Proofread complete. No changes suggested.');
}

/* ================== ACTIONS ================== */
async function onAnalyzeJD() {
  const txt = (document.querySelector('#jobText')?.value) || '';
  try {
    const summarizer = await ensureSummarizer({ type:'key-points', format:'markdown', length:'medium' });
    const out = await summarizer.summarize(txt, { context: 'Extract required experience, responsibilities, and top skills.' });
    const outEl = document.querySelector('#jdOut'); if (outEl) out.textContent = out; return;
  } catch(e) {}
  try {
    const md = await summarizeJDCloudLocal(txt);
    const outEl = document.querySelector('#jdOut'); if (outEl) outEl.textContent = md;
  } catch(e) { alert('Summarizer unavailable (device & local).'); }
}
function onGenBullets() { if (!CV.experience.length) addExperience(); const lastCard = document.querySelector('#experienceList')?.lastElementChild; lastCard?.querySelector('[data-act="generate"]')?.click(); }
async function onRewriteTone() {
  const summary = CV.profile.summary || 'Experienced candidate.';
  const instruction = 'Rewrite this RESUME SUMMARY to be concise and impactful. Output ONLY the revised summary text. Do NOT include name, job title/headline, bullets, or emojis. Keep 2–4 sentences, ATS-friendly, neutral tone.';
  try {
    const writer = await ensureWriter({ tone:'neutral', format:'plain-text', length:'short' });
    const rewritten = await writer.write(`${instruction}\n\n${summary}`, { context:'Resume summary; return ONLY summary text' });
    updateBoundField('summary', String(rewritten||'').trim()); refreshPreview(); return;
  } catch {}
  try {
    const text = await writeCloudLocal({ prompt: `${instruction}\n\n${summary}`, tone: 'neutral', length:'short', format:'plain-text', context:'Resume summary; return ONLY summary text' });
    updateBoundField('summary', String(text||'').trim()); refreshPreview();
  } catch(e) { alert('Writer unavailable (device & local).'); }
}
async function onTranslate() {
  try {
    const pack = countryPacks[CV.meta.countryPack] || DEFAULT_PACKS['UK'];
    let target = pack.spelling; if (CV.meta.locale !== 'auto') target = CV.meta.locale;
    let source = 'en';
    try { const det = await ensureLanguageDetector(); const best=(await det.detect(collectAllText()))?.[0]; if (best?.detectedLanguage) source = best.detectedLanguage; } catch {}
    const translator = await ensureTranslator(source, target);
    const previewEl = document.querySelector('#preview'); const text = previewEl?.innerText || '';
    const translated = await translator.translate(text);
    if (previewEl) previewEl.innerText = translated;
  } catch(e) { alert('Translator not available on this Chrome build.'); }
}

/* ================== HELPERS ================== */
function collectAllText(){
  const tmp=document.createElement('div');
  const pack = countryPacks[CV.meta.countryPack] || DEFAULT_PACKS['UK'];
  const node = renderCV(CV, pack);
  augmentExtraSections(node); // include extra sections in text snapshot
  tmp.appendChild(node);
  return tmp.innerText;
}
function refreshPreview(){
  const preview = document.querySelector('#preview'); if (!preview) return;
  preview.innerHTML='';
  const pack = countryPacks[CV.meta.countryPack] || DEFAULT_PACKS['UK'];
  const node = renderCV(CV, pack);
  augmentExtraSections(node);
  preview.appendChild(node);
  const warnings = lintCV(CV, pack, node);
  const w = document.querySelector('#atsWarnings'); if (w) w.innerHTML = warnings.map(x=>'⚠️ '+x).join('<br>');
}

/* ================== STAR bullets generator ================== */
function onGenerateFromJD(idx, wrap){
  return async () => {
    const jdText = document.querySelector('#jobText')?.value.trim();
    if (!jdText) return alert('Paste a job description first.');
    try {
      const session = await ensurePromptSession({});
      const schema = { type:'object', properties:{ bullets:{ type:'array', items:{type:'string', maxLength:220}, maxItems:6 }, skills:{ type:'array', items:{type:'string'}, maxItems:12 } }, required:['bullets'] };
      const prompt = `Using the STAR method, draft quantified resume bullets for the role "${CV.experience[idx].role}" at "${CV.experience[idx].company}".
Candidate background (from current CV):
${JSON.stringify(CV, null, 2)}
Target job description (from job snap):
${jdText}
Constraints: 1) No tables or emojis. 2) 1 bullet per line. 3) <= ${MAX_BULLET_WORDS} words per bullet. Return JSON.`;
      const res = await session.prompt(prompt, { responseConstraint: schema });
      let parsed = {}; try { parsed = JSON.parse(res); } catch { parsed = { bullets: String(res||'').split('\n').filter(Boolean) }; }
      let out = Array.isArray(parsed.bullets) ? parsed.bullets : [];
      out = sanitizeBulletList(out);
      CV.experience[idx].bullets = out;
      const ta = wrap.querySelector('textarea[data-k="bullets"]'); if (ta) ta.value = out.join('\n');
      const outEl=document.querySelector('#jdOut'); if (outEl) outEl.textContent = JSON.stringify({ bullets: out, skills: parsed.skills||[] },null,2);
      refreshPreview();
      return;
    } catch(e) {
      try {
        const parsed = await bulletsFromJDCloudLocal(CV, jdText);
        let out = Array.isArray(parsed.bullets) ? parsed.bullets : [];
        out = sanitizeBulletList(out);
        CV.experience[idx].bullets = out;
        const ta = wrap.querySelector('textarea[data-k="bullets"]'); if (ta) ta.value = out.join('\n');
        const outEl=document.querySelector('#jdOut'); if (outEl) outEl.textContent = JSON.stringify({ bullets: out, skills: parsed.skills||[] },null,2);
        refreshPreview();
      } catch(err) {
        alert('Prompt API not available and local cloud fallback failed.');
      }
    }
  }
}