export const STANDARD_HEADINGS = new Set([
  'Summary','Experience','Education','Skills','Projects','Certifications',
  'Profil','Berufserfahrung','Ausbildung','Fähigkeiten','Expérience','Éducation','Compétences'
]);
export function lintCV(cv, countryPack, htmlPreview) {
  const warnings = [];
  const wordCount = textContentFromCV(cv).split(/\s+/).filter(Boolean).length;
  const estPages = Math.max(1, Math.round(wordCount / 500));
  if (estPages > (countryPack.page_limit||2)) warnings.push(`Estimated length ${estPages} pages exceeds ${countryPack.page_limit} page limit for ${cv.meta.countryPack}.`);
  const headings = collectHeadings(cv);
  for (const h of headings) if (!STANDARD_HEADINGS.has(h)) warnings.push(`Non‑standard section heading: ${h}`);
  const dateRegex = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{4}|\d{2}\/\d{4}/;
  if (!JSON.stringify(cv).match(dateRegex)) warnings.push('No standardized dates detected (e.g., "MMM YYYY" or "MM/YYYY").');
  if (htmlPreview) {
    if (htmlPreview.querySelector('table')) warnings.push('Tables detected — remove for ATS.');
    if (htmlPreview.querySelector('img')) warnings.push('Images detected — remove for ATS.');
    if (htmlPreview.querySelectorAll('*').length > 2000) warnings.push('Document is overly complex; simplify DOM.');
  }
  return warnings;
}
function collectHeadings(cv) {
  const arr = []; if (cv.profile?.summary) arr.push('Summary');
  if (cv.experience?.length) arr.push('Experience');
  if (cv.education?.length) arr.push('Education');
  if (cv.skills?.length) arr.push('Skills');
  if (cv.projects?.length) arr.push('Projects');
  if (cv.certifications?.length) arr.push('Certifications');
  return arr;
}
function textContentFromCV(cv) {
  const parts = [];
  parts.push(cv.profile?.name||'', cv.profile?.title||'', cv.profile?.summary||'');
  for (const e of (cv.experience||[])) parts.push(e.company, e.role, ...(e.bullets||[]));
  for (const ed of (cv.education||[])) parts.push(ed.institution, ed.degree);
  parts.push(...(cv.skills||[]));
  return parts.join(' ');
}
