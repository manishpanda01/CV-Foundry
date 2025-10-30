// webapp/js/lib/templates.js
import { groupSkillsLocal } from "./skills.js";

/**
 * Render the CV into a DOM node.
 * Accepts optional 'pack' for future locale/date formatting needs.
 */
export function renderCV(cv, pack = {}) {
  const el = document.createElement('div');
  el.className = 'cv-page-wrap';

  const name = escapeHtml(cv?.profile?.name || '');
  const title = escapeHtml(cv?.profile?.title || '');
  const location = escapeHtml(cv?.profile?.location || '');

  const contactBits = [
    safeContact(cv?.profile?.contact?.email),
    safeContact(cv?.profile?.contact?.phone),
    safeContact(cv?.profile?.contact?.website),
    safeContact(cv?.profile?.contact?.linkedin),
    safeContact(cv?.profile?.contact?.github),
  ].filter(Boolean).join(' • ');

  const summaryHtml = (cv?.profile?.summary || '').trim()
    ? `<div class="section"><h2>Summary</h2><p>${escapeHtml(cv.profile.summary)}</p></div>`
    : '';

  el.innerHTML = `
    <div class="cv">
      ${name ? `<h1>${name}</h1>` : ''}
      ${title ? `<div><strong>${title}</strong></div>` : ''}
      <div>${location}${contactBits ? (location ? ' • ' : '') + contactBits : ''}</div>

      ${summaryHtml}
      ${renderExperience(cv?.experience)}
      ${renderEducation(cv?.education)}
      ${renderProjects(cv?.projects)}
      ${renderSkills(cv?.skills, cv?.meta)}
      ${renderCertifications(cv?.certifications)}
      ${renderPublications(cv?.publications)}
      ${renderPatents(cv?.patents)}
    </div>
  `;
  return el;
}

/* -------------------- Sections -------------------- */

function renderExperience(items = []) {
  if (!Array.isArray(items) || !items.length) return '';
  const rows = items.map(it => {
    const role = escapeHtml(it?.role || '');
    const company = escapeHtml(it?.company || '');
    const loc = it?.location ? ` • ${escapeHtml(it.location)}` : '';
    const dates = `${escapeHtml(it?.start || '')} – ${escapeHtml(it?.end || '')}`;
    const bullets = Array.isArray(it?.bullets) && it.bullets.length
      ? `<ul>${it.bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`
      : '';
    return `
      <div class="item">
        <div><strong>${role}</strong>${company ? ` — ${company}` : ''}${loc}</div>
        <div>${dates}</div>
        ${bullets}
      </div>
    `;
  }).join('');
  return `<div class="section"><h2>Experience</h2>${rows}</div>`;
}

function renderEducation(items = []) {
  if (!Array.isArray(items) || !items.length) return '';
  const rows = items.map(it => {
    const degree = escapeHtml(it?.degree || '');
    const inst = escapeHtml(it?.institution || '');
    const dates = `${escapeHtml(it?.start || '')} – ${escapeHtml(it?.end || '')}`;
    return `
      <div class="item">
        <div><strong>${degree}</strong>${inst ? ` — ${inst}` : ''}</div>
        <div>${dates}</div>
      </div>
    `;
  }).join('');
  return `<div class="section"><h2>Education</h2>${rows}</div>`;
}

function renderProjects(items = []) {
  if (!Array.isArray(items) || !items.length) return '';
  const rows = items.map(p => {
    // Support both {name,link,bullets[]} and simple strings
    if (typeof p === 'string') {
      return `<div class="item"><div><strong>${escapeHtml(p)}</strong></div></div>`;
    }
    const name = escapeHtml(p?.name || '');
    const link = p?.link ? ` — ${escapeHtml(p.link)}` : '';
    const bullets = Array.isArray(p?.bullets) && p.bullets.length
      ? `<ul>${p.bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`
      : '';
    return `
      <div class="item">
        <div><strong>${name}</strong>${link}</div>
        ${bullets}
      </div>
    `;
  }).join('');
  return `<div class="section"><h2>Projects</h2>${rows}</div>`;
}

function renderSkills(items = [], cvMeta) {
  // If we already have grouped skills in meta, use them; else fall back to local grouping.
  const grouped = (cvMeta && cvMeta.skillsGrouped)
    ? cvMeta.skillsGrouped
    : groupSkillsLocal(items);

  if (!grouped || !Object.keys(grouped).length) return '';

  const lines = Object.entries(grouped).map(([cat, list]) => {
    const flat = (Array.isArray(list) ? list : []).map(escapeHtml).join(', ');
    return `<li><strong>${escapeHtml(cat)}:</strong> ${flat}</li>`;
  }).join('');

  const aiBadge = cvMeta?.skillsGroupedSource === 'ai' ? ' (AI)' : '';
  return `<div class="section"><h2>Skills${aiBadge}</h2><ul>${lines}</ul></div>`;
}

function renderCertifications(items = []) {
  if (!Array.isArray(items) || !items.length) return '';
  const rows = items.map(c => {
    if (typeof c === 'string') return `<li>${escapeHtml(c)}</li>`;
    const bits = [
      c?.name ? escapeHtml(c.name) : '',
      c?.issuer ? escapeHtml(c.issuer) : '',
      c?.date ? escapeHtml(c.date) : ''
    ].filter(Boolean).join(' — ');
    const line = c?.link ? `${bits} — ${escapeHtml(c.link)}` : bits;
    return `<li>${line}</li>`;
  }).join('');
  return `<div class="section"><h2>Certifications</h2><ul>${rows}</ul></div>`;
}

function renderPublications(items = []) {
  if (!Array.isArray(items) || !items.length) return '';
  const rows = items.map(p => {
    if (typeof p === 'string') return `<li>${escapeHtml(p)}</li>`;
    const authors = p?.authors ? escapeHtml(p.authors) : '';
    const title = p?.title ? `“${escapeHtml(p.title)}”` : '';
    const venue = p?.venue ? `<em>${escapeHtml(p.venue)}</em>` : '';
    const date = p?.date ? escapeHtml(p.date) : '';
    const doi = p?.doi ? `doi:${escapeHtml(p.doi)}` : '';
    const main = [authors, title, venue, date, doi].filter(Boolean).join(', ');
    const line = p?.link ? `${main} — ${escapeHtml(p.link)}` : main;
    return `<li>${line}</li>`;
  }).join('');
  return `<div class="section"><h2>Publications</h2><ul>${rows}</ul></div>`;
}

function renderPatents(items = []) {
  if (!Array.isArray(items) || !items.length) return '';
  const rows = items.map(p => {
    if (typeof p === 'string') return `<li>${escapeHtml(p)}</li>`;
    const title = p?.title ? escapeHtml(p.title) : '';
    const officeNo = [p?.office, p?.number].filter(Boolean).map(escapeHtml).join(' ');
    const status = p?.status ? escapeHtml(p.status) : '';
    const date = p?.date ? escapeHtml(p.date) : '';
    const inventors = p?.inventors ? escapeHtml(p.inventors) : '';
    const main = [title, officeNo, status, date, inventors].filter(Boolean).join(' · ');
    const line = p?.link ? `${main} — ${escapeHtml(p.link)}` : main;
    return `<li>${line}</li>`;
  }).join('');
  return `<div class="section"><h2>Patents</h2><ul>${rows}</ul></div>`;
}

/* -------------------- Helpers -------------------- */

function safeContact(s) {
  const v = (s || '').toString().trim();
  return v ? escapeHtml(v) : '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}