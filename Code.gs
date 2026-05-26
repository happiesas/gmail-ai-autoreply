// =============================================================================
// gmail-ai-autoreply — Apps Script
// Réponses Gmail automatiques rédigées par Gemini.
// https://github.com/happiesas/gmail-ai-autoreply
// =============================================================================
//
// QUICK START
//   1. Récupère une clé Gemini gratuite : https://aistudio.google.com/app/apikey
//   2. Modifie le bloc CONFIG.business ci-dessous (nom, URL, description, ton).
//   3. Dans l'éditeur Apps Script : Exécuter > setGeminiApiKey("TA_CLE")
//   4. Lance `dryRun()` pour voir des brouillons sans rien envoyer.
//   5. Quand tu es prêt : `install()` active le cron qui répond automatiquement.
//
// =============================================================================

const CONFIG = {
  // 🎯 TON BUSINESS — modifie uniquement ce bloc
  business: {
    name: 'Happie',
    url: 'https://happie.com',
    description:
      "Happie aide les entrepreneurs à automatiser leur quotidien sans coder : email, CRM, support, contenus. Solutions simples, prêtes en quelques minutes.",
    signature: "L'équipe Happie",
    languagePolicy: 'match-incoming',   // 'match-incoming' | 'fr-only' | 'en-only'
    addressForm: 'formal',              // 'formal' (vous) | 'casual' (tu) | 'auto'
    tone: 'chaleureux mais professionnel, direct, sans jargon',
    replyLength: '4 à 7 phrases',
    cta: 'invite simplement la personne à découvrir le site',
    forbiddenPromises: [
      'prix ou tarifs précis non listés',
      'délais de livraison ou de réponse',
      'fonctionnalités non décrites ci-dessus',
      'partenariats ou intégrations spécifiques',
    ],
  },

  // 🤖 IA
  ai: {
    model: 'gemini-2.5-flash',
    temperature: 0.35,
    maxOutputTokens: 500,
  },

  // ⚙️ EXÉCUTION
  runtime: {
    triggerMinutes: 1,
    maxThreadsPerRun: 4,
    maxDailyReplies: 40,
    maxInputChars: 6000,
    minRemainingEmailQuota: 5,
    replyMode: 'send',                  // 'send' | 'draft' (brouillon pour valider avant)
  },

  // 📬 GMAIL
  gmail: {
    lookbackQuery: 'newer_than:2d',
    searchQuery:
      'in:inbox is:unread -in:spam -in:trash -category:promotions -category:social -category:forums',
    labels: {
      sent: 'AutoReply/Sent',
      skipped: 'AutoReply/Skip',
      error: 'AutoReply/Error',
      dryRun: 'AutoReply/DryRun',
    },
  },
};

// =============================================================================
// SETUP / CONTRÔLE
// =============================================================================
function install() {
  assertConfigured_();
  ensureLabels_();
  removeTriggers_('processUnreadInbox');
  ScriptApp.newTrigger('processUnreadInbox')
    .timeBased()
    .everyMinutes(CONFIG.runtime.triggerMinutes)
    .create();
  console.log(`Auto-reply trigger installed for "${CONFIG.business.name}".`);
}

function uninstall() {
  removeTriggers_('processUnreadInbox');
  console.log('Auto-reply trigger removed.');
}

function setGeminiApiKey(apiKey) {
  const value = String(apiKey || '').trim();
  if (!value) throw new Error('Missing apiKey parameter.');
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', value);
  console.log('GEMINI_API_KEY configured.');
}

function clearGeminiApiKey() {
  PropertiesService.getScriptProperties().deleteProperty('GEMINI_API_KEY');
  console.log('GEMINI_API_KEY removed.');
}

function dryRun() { return processUnreadInbox_(true); }
function processUnreadInbox() { return processUnreadInbox_(false); }

// =============================================================================
// ORCHESTRATION
// =============================================================================
function processUnreadInbox_(dryRunMode) {
  assertConfigured_();

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    console.log('Another run is already active. Skipping.');
    return;
  }

  try {
    if (!dryRunMode && !canSendMoreToday_()) {
      console.log('Daily reply cap reached. Skipping.');
      return;
    }
    if (!dryRunMode && MailApp.getRemainingDailyQuota() <= CONFIG.runtime.minRemainingEmailQuota) {
      console.log('Gmail daily quota almost exhausted. Skipping.');
      return;
    }

    const labels = ensureLabels_();
    const threads = GmailApp.search(buildSearchQuery_(), 0, CONFIG.runtime.maxThreadsPerRun);
    console.log(`Found ${threads.length} candidate thread(s).`);

    for (const thread of threads) handleThread_(thread, labels, dryRunMode);
  } finally {
    lock.releaseLock();
  }
}

function handleThread_(thread, labels, dryRunMode) {
  try {
    const messages = thread.getMessages();
    const message = latestUnreadMessage_(messages);
    if (!message) { thread.addLabel(labels.skipped); return; }

    const last = messages[messages.length - 1];
    if (last && message.getId() !== last.getId()) {
      thread.addLabel(labels.skipped); return;
    }

    const skipReason = deterministicSkipReason_(message);
    if (skipReason) {
      console.log(`Skipped ${thread.getId()}: ${skipReason}`);
      thread.addLabel(labels.skipped); return;
    }

    const decision = generateReplyDecision_(thread, message);
    if (!decision.should_reply) {
      console.log(`AI skipped ${thread.getId()}: ${decision.reason}`);
      thread.addLabel(labels.skipped); return;
    }

    const body = normalizeReplyBody_(decision.body);
    if (!body) throw new Error('AI returned an empty reply body.');

    if (dryRunMode || CONFIG.runtime.replyMode === 'draft') {
      if (dryRunMode) {
        console.log(`DRY RUN reply for ${thread.getId()}:\n${body}`);
        thread.addLabel(labels.dryRun);
      } else {
        thread.createDraftReply(body);
        thread.addLabel(labels.sent);
      }
      return;
    }

    thread.reply(body, { name: CONFIG.business.name });
    thread.addLabel(labels.sent);
    thread.markRead();
    incrementDailyReplyCount_();
    console.log(`Replied to thread ${thread.getId()}.`);
  } catch (error) {
    console.error(`Error on thread ${thread.getId()}: ${error && error.stack ? error.stack : error}`);
    thread.addLabel(labels.error);
  }
}

// =============================================================================
// IA — Gemini
// =============================================================================
function generateReplyDecision_(thread, message) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const prompt = buildPrompt_(thread, message);
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(CONFIG.ai.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: CONFIG.ai.temperature,
        maxOutputTokens: CONFIG.ai.maxOutputTokens,
        responseMimeType: 'application/json',
      },
    }),
  });

  const status = res.getResponseCode();
  const text = res.getContentText();
  if (status < 200 || status >= 300) throw new Error(`Gemini API ${status}: ${text.slice(0, 500)}`);

  const data = JSON.parse(text);
  const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
  const output = parts.map((p) => p.text || '').join('').trim();
  const decision = JSON.parse(stripJsonFence_(output));

  return {
    should_reply: Boolean(decision.should_reply),
    reason: String(decision.reason || ''),
    body: String(decision.body || ''),
  };
}

function buildPrompt_(thread, message) {
  const b = CONFIG.business;
  const from = message.getFrom() || '';
  const subject = message.getSubject() || thread.getFirstMessageSubject() || '';
  const date = message.getDate();
  const plain = truncate_(cleanBody_(message.getPlainBody()), CONFIG.runtime.maxInputChars);

  const langRule = {
    'match-incoming': "Réponds dans la langue exacte du message reçu.",
    'fr-only': "Réponds toujours en français.",
    'en-only': "Always reply in English.",
  }[b.languagePolicy];

  const addressRule = {
    'formal': "Vouvoie systématiquement (en français). Use formal register (in English).",
    'casual': "Tutoie systématiquement (en français). Use casual register (in English).",
    'auto': "Adapte le registre (tu/vous) au ton du message reçu.",
  }[b.addressForm];

  const forbidden = (b.forbiddenPromises || [])
    .map((p) => `  • ${p}`)
    .join('\n') || '  • (aucune contrainte spécifique)';

  return [
    `Tu rédiges des réponses email pour ${b.name}.`,
    '',
    `À propos de ${b.name} :`,
    b.description,
    `Site web (à mentionner UNE seule fois max) : ${b.url}`,
    `Signature à utiliser à la fin : ${b.signature}`,
    '',
    'Règles de forme :',
    `- ${langRule}`,
    `- ${addressRule}`,
    `- Ton : ${b.tone}.`,
    `- Longueur : ${b.replyLength}.`,
    `- Termine par : ${b.cta}.`,
    '- Aucun markdown, aucune puce, aucune ligne "Objet:".',
    '- Ne dis jamais que tu es une IA ou que tu as analysé le message.',
    '- N\'ajoute pas de pièce jointe et ne propose pas d\'appel sauf demande explicite.',
    '',
    'Ne réponds PAS aux messages suivants (renvoie should_reply=false) :',
    '- newsletters, notifications automatiques, accusés de réception',
    '- demandes de désabonnement',
    '- messages agressifs, insultants, spam, ou non humains',
    '- messages totalement hors-sujet pour notre activité',
    '',
    'Ne promets JAMAIS :',
    forbidden,
    '',
    'Retourne UNIQUEMENT du JSON valide, sans markdown :',
    '{"should_reply":true,"reason":"lead|question|support|other","body":"..."}',
    'OU',
    '{"should_reply":false,"reason":"unsubscribe|automated|spam|negative|not_relevant","body":""}',
    '',
    `Expéditeur : ${from}`,
    `Sujet : ${subject}`,
    `Date : ${date}`,
    '',
    'Corps du dernier message :',
    plain,
  ].join('\n');
}

// =============================================================================
// FILTRES DÉTERMINISTES
// =============================================================================
function deterministicSkipReason_(message) {
  const from = message.getFrom() || '';
  const fromEmail = extractEmail_(from);
  const subject = message.getSubject() || '';
  const autoSubmitted = getHeader_(message, 'Auto-Submitted').toLowerCase();
  const precedence = getHeader_(message, 'Precedence').toLowerCase();
  const listUnsubscribe = getHeader_(message, 'List-Unsubscribe');

  if (/(^|[.+_-])(no-?reply|do-?not-?reply|noreply|notification|mailer-daemon|postmaster|bounce)([.+_-]|@|$)/i.test(fromEmail))
    return 'system sender';
  if (autoSubmitted && autoSubmitted !== 'no') return `auto-submitted: ${autoSubmitted}`;
  if (precedence && /(bulk|junk|list)/i.test(precedence)) return `precedence: ${precedence}`;
  if (listUnsubscribe) return 'mailing list';
  if (/unsubscribe|desabonnement|stop|opt[- ]?out/i.test(normalizeAscii_(subject)))
    return 'unsubscribe subject';
  return '';
}

// =============================================================================
// UTILITAIRES
// =============================================================================
function buildSearchQuery_() {
  return [
    CONFIG.gmail.searchQuery,
    CONFIG.gmail.lookbackQuery,
    `-label:"${CONFIG.gmail.labels.sent}"`,
    `-label:"${CONFIG.gmail.labels.skipped}"`,
    `-label:"${CONFIG.gmail.labels.error}"`,
  ].join(' ');
}

function latestUnreadMessage_(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].isUnread()) return messages[i];
  }
  return null;
}

function ensureLabels_() {
  const L = CONFIG.gmail.labels;
  return {
    sent: getOrCreateLabel_(L.sent),
    skipped: getOrCreateLabel_(L.skipped),
    error: getOrCreateLabel_(L.error),
    dryRun: getOrCreateLabel_(L.dryRun),
  };
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function assertConfigured_() {
  if (!PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY'))
    throw new Error('Missing script property GEMINI_API_KEY. Run setGeminiApiKey("...") first.');
}

function canSendMoreToday_() { return getDailyReplyCount_() < CONFIG.runtime.maxDailyReplies; }

function incrementDailyReplyCount_() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty(dailyCounterKey_(), String(getDailyReplyCount_() + 1));
}

function getDailyReplyCount_() {
  return Number(PropertiesService.getScriptProperties().getProperty(dailyCounterKey_()) || '0');
}

function dailyCounterKey_() {
  const d = new Date();
  return `reply_count_${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function removeTriggers_(name) {
  for (const t of ScriptApp.getProjectTriggers())
    if (t.getHandlerFunction() === name) ScriptApp.deleteTrigger(t);
}

function normalizeReplyBody_(body) {
  return String(body)
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 5000);
}

function cleanBody_(body) {
  return String(body || '')
    .replace(/\r/g, '\n')
    .replace(/\nOn .+ wrote:\n[\s\S]*/i, '')
    .replace(/\nLe .+ a ecrit\s?:\n[\s\S]*/i, '')
    .replace(/\n>.*(\n>.*)*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncate_(v, max) {
  const t = String(v || '');
  return t.length > max ? `${t.slice(0, max)}\n[message tronqué]` : t;
}

function stripJsonFence_(v) {
  return String(v || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function extractEmail_(v) {
  const t = String(v || '').trim();
  const b = t.match(/<([^>]+)>/);
  if (b) return b[1].trim().toLowerCase();
  const e = t.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return e ? e[0].toLowerCase() : t.toLowerCase();
}

function getHeader_(m, n) { try { return String(m.getHeader(n) || ''); } catch (_) { return ''; } }

function normalizeAscii_(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}
