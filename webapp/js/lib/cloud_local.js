// webapp/js/lib/cloud_local.js  (only the helpers below need changing)
const BASE = "http://127.0.0.1:8787/api";

async function jsonOrThrow(r) {
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}: ${text}`);
  return text ? JSON.parse(text) : {};
}

export async function groupSkillsCloudLocal(skills, categories) {
  const r = await fetch(`${BASE}/categorizeSkills`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skills, categories })
  });
  return await jsonOrThrow(r);
}

export async function summarizeJDCloudLocal(text) {
  const r = await fetch(`${BASE}/summarizeJD`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  const data = await jsonOrThrow(r);
  return data.markdown || "";
}

export async function bulletsFromJDCloudLocal(cv, jdText) {
  const r = await fetch(`${BASE}/bulletsFromJD`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cv, jdText })
  });
  return await jsonOrThrow(r);
}

export async function writeCloudLocal({ prompt, tone="neutral", length="short", format="plain-text", context="" }) {
  const r = await fetch(`${BASE}/write`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, tone, length, format, context })
  });
  const data = await jsonOrThrow(r);
  return data.text || "";
}

export async function rewriteCloudLocal({ text, operation="tighten", tone="neutral", length="short", format="plain-text", context="" }) {
  const r = await fetch(`${BASE}/rewrite`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, operation, tone, length, format, context })
  });
  const data = await jsonOrThrow(r);
  return data.text || "";
}

export async function proofreadCloudLocal({ text, language="en" }) {
  const r = await fetch(`${BASE}/proofread`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, language })
  });
  const data = await jsonOrThrow(r);
  return data.corrected || "";
}

export async function fetchCVSpecCloudLocal({ country, language="", seniority="mid" }) {
  const r = await fetch(`${BASE}/cvSpec`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ country, language, seniority })
  });
  return await jsonOrThrow(r);
}

export async function renderCVHTMLCloudLocal(cv, spec, theme="classic") {
  const r = await fetch(`${BASE}/renderCVHTML`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cv, spec, theme })
  });
  const data = await jsonOrThrow(r);
  return data.html || "";
}