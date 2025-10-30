// webapp/js/lib/ai.js
// Thin wrappers around Chrome's built-in on-device AI (Gemini Nano).

/* -------------------- utils -------------------- */
function mkMonitor(name, onProgress) {
  if (typeof onProgress !== 'function') return undefined;
  return (m) => {
    try {
      const progressHandler = (e) => {
        let p = null;
        if (typeof e?.progress === 'number') p = e.progress;
        else if (typeof e?.loaded === 'number' && typeof e?.total === 'number' && e.total > 0) p = e.loaded / e.total;
        else if (typeof e?.loaded === 'number') p = (e.loaded <= 1 ? e.loaded : null);
        onProgress(name, p, null, 'event');
      };
      const stateHandler = (e) => {
        const s = e?.state || e?.detail || e?.target?.state;
        if (s === 'available') onProgress(name, 1, null, 'state');
        else onProgress(name, null, null, `state:${s}`);
      };
      m.addEventListener?.('downloadprogress', progressHandler);
      m.addEventListener?.('progress',          progressHandler);
      m.addEventListener?.('statechange',       stateHandler);
      m.addEventListener?.('downloadstatechange', stateHandler);
    } catch {}
  };
}

async function safeAvailability(ctor, ...args) {
  try {
    const fn = ctor?.availability;
    if (typeof fn === 'function') return await fn.apply(ctor, args);
  } catch {}
  return ctor ? 'available' : 'unsupported';
}

/* -------------------- availability banner -------------------- */
export async function checkAllAvailability() {
  const out = [];
  if ('LanguageModel' in self) out.push(['Prompt API', await safeAvailability(self.LanguageModel)]);
  else out.push(['Prompt API','unsupported']);

  for (const [name, ctor] of [
    ['Summarizer', self.Summarizer],
    ['Writer', self.Writer],
    ['Rewriter', self.Rewriter],
    ['Proofreader', self.Proofreader],
    ['Translator', self.Translator],
  ]) out.push([name, await safeAvailability(ctor)]);

  const ldOK = !!(self.ai?.languageDetector && typeof self.ai.languageDetector.detect === 'function');
  out.push(['Language Detector', ldOK ? 'available' : 'unsupported']);
  return out;
}

/* -------------------- Prompt API -------------------- */
export async function ensurePromptSession(options = {}, onProgress) {
  if (!('LanguageModel' in self) || typeof self.LanguageModel?.create !== 'function') {
    throw new Error('Prompt API unsupported');
  }
  let a = 'unknown'; try { a = await self.LanguageModel.availability(); } catch {}
  const session = await self.LanguageModel.create({
    ...options,
    monitor: (a === 'downloadable' || a === 'downloading') ? mkMonitor('Prompt', onProgress) : undefined
  });
  if (a === 'downloadable' || a === 'downloading') { try { await session.prompt('ping'); } catch {} } // warm-up
  if (typeof session?.prompt !== 'function') throw new Error('prompt() missing');
  return session;
}

/* -------------------- Summarizer -------------------- */
export async function ensureSummarizer(options = {}, onProgress) {
  if (!('Summarizer' in self) || typeof self.Summarizer?.create !== 'function') {
    throw new Error('Summarizer unsupported');
  }
  const a = await safeAvailability(self.Summarizer);
  if (a === 'unavailable') throw new Error('Summarizer unavailable');
  const obj = await self.Summarizer.create({
    type:'key-points', format:'markdown', length:'medium',
    monitor: (a === 'downloadable' || a === 'downloading') ? mkMonitor('Summarizer', onProgress) : undefined,
    ...options
  });
  if (typeof obj?.summarize !== 'function') throw new Error('summarize() missing');
  return obj;
}

/* -------------------- Writer -------------------- */
export async function ensureWriter(options = {}, onProgress) {
  if (!('Writer' in self) || typeof self.Writer?.create !== 'function') {
    throw new Error('Writer unsupported');
  }
  const a = await safeAvailability(self.Writer);
  if (a === 'unavailable') throw new Error('Writer unavailable');
  const obj = await self.Writer.create({
    tone:'neutral', format:'plain-text', length:'short',
    monitor: (a === 'downloadable' || a === 'downloading') ? mkMonitor('Writer', onProgress) : undefined,
    ...options
  });
  if (typeof obj?.write !== 'function') throw new Error('write() missing');
  return obj;
}

/* -------------------- Rewriter (tolerant create) -------------------- */
export async function ensureRewriter(options = {}, onProgress) {
  if (!('Rewriter' in self) || typeof self.Rewriter?.create !== 'function') {
    throw new Error('Rewriter unsupported');
  }
  const a = await safeAvailability(self.Rewriter);
  if (a === 'unavailable') throw new Error('Rewriter unavailable');

  const base = { tone:'neutral', format:'plain-text', length:'short' };
  const monitor = (a === 'downloadable' || a === 'downloading') ? mkMonitor('Rewriter', onProgress) : undefined;

  // Some builds are strict about options; try with full options, then minimal
  try {
    const obj = await self.Rewriter.create({ ...base, monitor, ...options });
    if (typeof obj?.rewrite !== 'function') throw new Error('rewrite() missing');
    return obj;
  } catch (e) {
    const obj = await self.Rewriter.create({ monitor }); // minimal
    if (typeof obj?.rewrite !== 'function') throw new Error('rewrite() missing');
    return obj;
  }
}

/* -------------------- Proofreader (tolerant create) -------------------- */
export async function ensureProofreader(options = {}, onProgress) {
  if (!('Proofreader' in self) || typeof self.Proofreader?.create !== 'function') {
    throw new Error('Proofreader unsupported');
  }
  const a = await safeAvailability(self.Proofreader);
  if (a === 'unavailable') throw new Error('Proofreader unavailable');

  const monitor = (a === 'downloadable' || a === 'downloading') ? mkMonitor('Proofreader', onProgress) : undefined;

  try {
    const obj = await self.Proofreader.create({ expectedInputLanguages:['en'], monitor, ...options });
    if (typeof obj?.proofread !== 'function') throw new Error('proofread() missing');
    return obj;
  } catch (e) {
    const obj = await self.Proofreader.create({ monitor }); // minimal
    if (typeof obj?.proofread !== 'function') throw new Error('proofread() missing');
    return obj;
  }
}

/* -------------------- Translator -------------------- */
export async function ensureTranslator(sourceLanguage='en', targetLanguage='en-GB', onProgress) {
  if (!('Translator' in self) || typeof self.Translator?.create !== 'function') {
    throw new Error('Translator unsupported');
  }
  let a = 'unknown';
  try { a = await self.Translator.availability?.({ sourceLanguage, targetLanguage }) ?? 'available'; } catch {}
  if (a === 'unavailable') throw new Error('Translator unavailable');
  const obj = await self.Translator.create({
    sourceLanguage, targetLanguage,
    monitor: (a === 'downloadable' || a === 'downloading') ? mkMonitor('Translator', onProgress) : undefined
  });
  if (typeof obj?.translate !== 'function') throw new Error('translate() missing');
  return obj;
}

/* -------------------- Language Detector -------------------- */
export async function ensureLanguageDetector() {
  if (self.ai?.languageDetector && typeof self.ai.languageDetector.detect === 'function') {
    return { async detect(text) { return await self.ai.languageDetector.detect(text); } };
  }
  return { async detect(_text){ return [{ detectedLanguage:'en', confidence:0.5 }]; } };
}