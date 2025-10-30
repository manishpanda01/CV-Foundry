// dev-proxy.mjs — Gemini-only local proxy (Node 18+; Node 24 OK)
// Start:  GEMINI_API_KEY=... node dev-proxy.mjs
import express from "express";
import cors from "cors";

const PORT   = process.env.PORT || 8787;
const ORIGIN = process.env.ALLOW_ORIGIN || "http://127.0.0.1:8000";
const GEMINI_KEY   = process.env.GEMINI_API_KEY || "AIzaSyCQz9MSFY00LU9IZRrU7JkcoPq-NFKVhIY";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

if (!GEMINI_KEY) console.warn("⚠️  Set GEMINI_API_KEY before starting the proxy.");

const app = express();
app.use(cors({ origin: ORIGIN }));
app.use(express.json({ limit: "2mb" }));

async function geminiJSON(prompt) {
  if (!GEMINI_KEY) throw new Error("Missing GEMINI_API_KEY");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }]}],
      generationConfig: { responseMimeType: "application/json" }
    })
  });
  if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
  const data = await r.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return JSON.parse(text);
}
async function geminiText(prompt) {
  if (!GEMINI_KEY) throw new Error("Missing GEMINI_API_KEY");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }]}],
      generationConfig: { responseMimeType: "text/plain" }
    })
  });
  if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
  const data = await r.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

function sanitizeGrouped(obj, categories) {
  const out = {};
  for (const cat of categories) {
    const arr = Array.isArray(obj[cat]) ? obj[cat] : [];
    const cleaned = [...new Set(arr.map(s => String(s).trim()).filter(Boolean))];
    if (cleaned.length) out[cat] = cleaned;
  }
  return out;
}

// --------- endpoints ---------
app.post("/api/categorizeSkills", async (req, res) => {
  try {
    const skills = Array.isArray(req.body?.skills) ? req.body.skills : [];
    const cats = req.body?.categories?.length ? req.body.categories : [
      "Programming","Frontend","Backend","Data & ML","Cloud & DevOps","Databases","Testing","Tools","Languages","Other"
    ];
    const prompt = `
You are an ATS resume skill categorizer.
Group the user's skills into these EXACT categories: ${cats.join(", ")}.
Rules:
- Use only those categories; if unsure, put the item in "Other".
- Normalize skill casing (e.g., "javascript" → "JavaScript", "node" → "Node.js", "postgres" → "PostgreSQL").
- Deduplicate within each category.
- Return ONLY JSON, no prose.

User skills:
${JSON.stringify(skills, null, 2)}
`.trim();
    const raw = await geminiJSON(prompt);
    res.json(sanitizeGrouped(raw, cats));
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.post("/api/summarizeJD", async (req, res) => {
  try {
    const jd = String(req.body?.text || "");
    const prompt = `
Summarize the job description below as concise markdown bullet points.
Focus on Required Experience, Responsibilities, and Top Skills. Use 6–10 bullets.

JD:
${jd}
`.trim();
    const md = await geminiText(prompt);
    res.json({ markdown: md });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.post("/api/bulletsFromJD", async (req, res) => {
  try {
    const cv = req.body?.cv || {};
    const jdText = String(req.body?.jdText || "");
    const prompt = `
Using the STAR method, write 4–6 quantified resume bullets for the candidate.
Role: "${cv?.experience?.slice(-1)[0]?.role || ''}" at "${cv?.experience?.slice(-1)[0]?.company || ''}"

Candidate background (JSON):
${JSON.stringify(cv, null, 2)}

Target job requirements:
${jdText}

Constraints:
1) 1 bullet per line. 2) <= 22 words per bullet. 3) No emojis, no tables.
Return ONLY JSON: {"bullets":[string...], "skills":[string...]}.
`.trim();
    const raw = await geminiJSON(prompt);
    let bullets = Array.isArray(raw?.bullets) ? raw.bullets : [];
    let skills  = Array.isArray(raw?.skills) ? raw.skills : [];
    if (!bullets.length && typeof raw === "string") {
      bullets = raw.split("\n").map(s=>s.trim()).filter(Boolean).slice(0,6);
    }
    res.json({
      bullets: bullets.slice(0,6).map(s=>String(s).trim()).filter(Boolean),
      skills:  skills.slice(0,12).map(s=>String(s).trim()).filter(Boolean)
    });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

// NEW: Writer / Rewriter / Proofreader
app.post("/api/write", async (req, res) => {
  try {
    const { prompt, tone="neutral", length="short", format="plain-text", context="" } = req.body || {};
    const sys = `
You are a resume writer. Produce ${length} ${format} text in a ${tone} tone.
No emojis, no tables, ATS-friendly.
If the user gave context, follow it.
Return ONLY JSON: {"text": string}.
`;
    const out = await geminiJSON(`${sys}\n\nUser prompt:\n${String(prompt||"").trim()}\n\nContext:\n${String(context||"").trim()}`);
    res.json({ text: String(out?.text || "").trim() });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});
app.post("/api/rewrite", async (req, res) => {
  try {
    const { text="", operation="tighten", tone="neutral", length="short", format="plain-text", context="" } = req.body || {};
    const opGuide = {
      tighten:   "Shorten, remove fluff, keep meaning.",
      expand:    "Expand slightly with specific impact (metrics if present).",
      formalize: "Make professional, consistent tense.",
      simplify:  "Make clear, simple vocabulary.",
      "active-voice": "Rewrite to active voice."
    }[operation] || "Improve clarity.";
    const prompt = `
Rewrite the resume text with these constraints:

Operation: ${opGuide}
Tone: ${tone}
Target length: ${length}
Format: ${format}
Rules: No emojis, no tables, ATS-friendly. Keep factual content.

Original:
${text}

Return ONLY JSON: {"text": string}.
`.trim();
    const out = await geminiJSON(prompt);
    res.json({ text: String(out?.text || "").trim() });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});
app.post("/api/proofread", async (req, res) => {
  try {
    const { text="", language="en" } = req.body || {};
    const prompt = `
Proofread this ${language} resume text for grammar, spelling, and punctuation.
Keep meaning; prefer concise wording; do not add emojis or tables.
Return ONLY JSON: {"corrected": string}.

Text:
${text}
`.trim();
    const out = await geminiJSON(prompt);
    res.json({ corrected: String(out?.corrected || "").trim() });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.listen(PORT, () => {
  console.log(`Dev proxy listening on http://127.0.0.1:${PORT}`);
  console.log(`Allow-Origin: ${ORIGIN}`);
});

// === NEW: Country CV spec ===
// POST /api/cvSpec { country:"UK", language?: "en-GB", seniority?: "junior|mid|senior" } -> { ...spec }
app.post("/api/cvSpec", async (req, res) => {
  try {
    const country  = String(req.body?.country || "UK").toUpperCase();
    const language = String(req.body?.language || "").trim();
    const seniority = String(req.body?.seniority || "mid").toLowerCase();

    const prompt = `
You are a resume standards expert. Produce a structured "CV spec" for ${country} that is ATS-friendly.
Output JSON with these keys ONLY:

{
  "country": "UK",
  "language": "en-GB",
  "page_limit": 1|2,
  "photo_allowed": false,
  "date_format": "MMM YYYY–MMM YYYY" | "MM/YYYY–MM/YYYY",
  "spelling": "en-GB|en-US|de-DE|fr-FR|en-IN",
  "section_order": ["Summary","Experience","Education","Skills","Certifications","Projects"],
  "labels": { "Summary":"...", "Experience":"...", "Education":"...", "Skills":"...", "Certifications":"...", "Projects":"..." },
  "notes": [string...],                        // cultural/ATS notes (max 6)
  "bullets_guidelines": [string...],           // style/tense/metrics (max 8)
  "ats_rules": [string...]                     // parser-friendly rules (max 6)
}

Rules:
- Tailor for ${seniority}-level candidate.
- Prefer ATS simplicity: no tables, no graphics, single column recommended.
- For DE/FR labels, use native language.
- Photo is generally false for ATS fairness (even if culturally common).
${language ? `- Force language/spelling to ${language}.` : ""}

Return ONLY JSON.
`.trim();

    const spec = await geminiJSON(prompt);
    // minimal sanitation
    spec.country = spec.country || country;
    res.json(spec);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// === NEW: Render full HTML from CV+spec ===
// POST /api/renderCVHTML { cv:object, spec:object, theme? } -> { html:string }
app.post("/api/renderCVHTML", async (req, res) => {
  try {
    const cv   = req.body?.cv || {};
    const spec = req.body?.spec || {};
    const theme = String(req.body?.theme || "classic");

    const prompt = `
You are a resume layout engine. Using the provided CV JSON and CV spec JSON, output an ATS-friendly HTML document.
Constraints:
- Semantic HTML only (header/section/ul/li). No tables, no images, no scripts.
- Inline minimal CSS for print (A4/Letter), good spacing and hierarchy, single column.
- Respect section order and labels from "spec.section_order" and "spec.labels".
- Render skills as comma-separated lines or small "chips" via CSS spans.
- Include contact line, dates formatted per "spec.date_format".
- Keep it clean and professional; no emojis.

Return ONLY the HTML (a complete <html>… document), no JSON wrapper.

CV JSON:
${JSON.stringify(cv, null, 2)}

CV SPEC JSON:
${JSON.stringify(spec, null, 2)}

Theme: ${theme}
`.trim();

    const html = await geminiText(prompt);
    res.json({ html: String(html || "").trim() });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});