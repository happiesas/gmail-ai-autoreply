# gmail-ai-autoreply

Réponses Gmail automatiques rédigées par **Gemini**, en **3 minutes chrono**, **sans coder**.
Tout tient dans un seul script Google Apps Script — pas de serveur, pas d'abonnement, pas d'outil tiers.

> Made with ❤️ by [Happie](https://happie.fr) — l'automatisation sans code pour les entrepreneurs.

---

## ✨ Ce que ça fait

- 📥 Surveille ta boîte Gmail toutes les minutes
- 🧠 Pour chaque mail entrant, demande à Gemini s'il faut répondre — et quoi répondre
- ✍️ Rédige la réponse dans **ton ton**, dans **la langue du mail entrant**
- ✅ Envoie automatiquement (ou crée un brouillon, mode "draft" recommandé au début)
- 🛡️ **Ne répond jamais** aux newsletters, mails automatiques, désabonnements, spam
- 🏷️ Étiquette les threads (`AutoReply/Sent`, `AutoReply/Skip`, `AutoReply/Error`)
- 💰 **Gratuit** dans la limite du quota Gemini Flash (≈ 1500 requêtes/jour) et du quota Gmail (100 envois/jour, ou 1500 sur Workspace)

---

## ⚡ Quick start (3 minutes)

### 1. Récupérer une clé Gemini

→ [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) → **Create API key** → copie la clé.

### 2. Créer le projet Apps Script

→ [script.google.com](https://script.google.com) → **Nouveau projet** → renomme-le `gmail-ai-autoreply` → colle le contenu de [`Code.gs`](./Code.gs) dans l'éditeur.

### 3. Adapter à ton business

Tout en haut du script, modifie **uniquement** le bloc `CONFIG.business` :

```javascript
business: {
  name: 'Mon Entreprise',
  url: 'https://monsite.com',
  description: "On fait X pour Y. Notre promesse, c'est Z.",
  signature: "L'équipe Mon Entreprise",
  languagePolicy: 'match-incoming',   // ou 'fr-only', 'en-only'
  addressForm: 'formal',              // ou 'casual', 'auto'
  tone: 'chaleureux mais professionnel, direct',
  replyLength: '4 à 7 phrases',
  cta: 'invite simplement la personne à découvrir le site',
  forbiddenPromises: [
    'prix ou tarifs précis',
    'délais de livraison',
    // ... ajoute tout ce que l'IA ne doit JAMAIS promettre
  ],
},
```

### 4. Brancher la clé API

Dans l'éditeur Apps Script :

1. Sélectionne la fonction `setGeminiApiKey` dans la barre du haut.
2. Clique **Exécuter** une première fois → autorise les accès Gmail demandés.
3. Ouvre l'**éditeur de script**, lance dans la console :
   ```javascript
   setGeminiApiKey('TA_CLE_GEMINI_ICI');
   ```
   (Ou utilise **Paramètres du projet** → **Propriétés du script** → ajoute manuellement la propriété `GEMINI_API_KEY`.)

### 5. Tester en mode brouillon

```javascript
dryRun();
```

→ Va voir tes **Brouillons** Gmail : l'IA aura rédigé une réponse pour chaque mail non lu correspondant aux critères, **sans rien envoyer**. Vérifie le ton, le contenu, l'absence de promesses trop fortes.

### 6. Activer en automatique

Quand tu es confiant :

```javascript
install();
```

→ Un trigger se déclenche **toutes les minutes**. Plus rien à faire.

Pour arrêter à tout moment :

```javascript
uninstall();
```

---

## 🎛️ Configuration avancée

Toute la config est dans le bloc `CONFIG` en haut du script. Voici les paramètres clés :

### `CONFIG.business`
| Champ | Description |
|---|---|
| `name` | Nom utilisé comme signature d'envoi Gmail |
| `url` | URL mentionnée 1× max dans la réponse |
| `description` | 2-3 phrases qui décrivent ton produit/service |
| `signature` | Texte de signature en fin de mail |
| `languagePolicy` | `match-incoming` (auto) / `fr-only` / `en-only` |
| `addressForm` | `formal` (vous) / `casual` (tu) / `auto` |
| `tone` | Décris le ton en mots-clés (ex: `"chaleureux, direct, jargon-free"`) |
| `replyLength` | Ex: `"3 à 5 phrases"`, `"un paragraphe court"` |
| `cta` | Ce qui doit clore le mail (ex: `"propose une réponse rapide"`) |
| `forbiddenPromises` | Liste de choses que l'IA ne doit **JAMAIS** promettre |

### `CONFIG.runtime`
| Champ | Défaut | Description |
|---|---|---|
| `triggerMinutes` | `1` | Fréquence du cron (en minutes) |
| `maxThreadsPerRun` | `4` | Threads max traités par exécution |
| `maxDailyReplies` | `40` | Plafond quotidien de réponses envoyées |
| `replyMode` | `'send'` | `'send'` (envoie direct) ou `'draft'` (brouillon à valider) |

### `CONFIG.gmail.searchQuery`

Par défaut, le script ne traite que les mails de la boîte de réception, non lus, hors spam/promo/social/forums. Tu peux restreindre encore plus, par exemple :

```javascript
searchQuery: 'in:inbox is:unread label:clients -in:spam -in:trash'
```

---

## 🛡️ Sécurités intégrées

Le script **refuse** automatiquement de répondre dans ces cas :

- Expéditeur type `noreply@`, `do-not-reply@`, `postmaster@`, `mailer-daemon@`
- Header `Auto-Submitted` (mails générés automatiquement)
- Header `Precedence: bulk/junk/list` (mailings de masse)
- Header `List-Unsubscribe` présent (mailing list)
- Sujet contenant `unsubscribe`, `désabonnement`, `stop`, `opt-out`
- Gemini lui-même décide `should_reply: false` si le mail est : newsletter, spam, agressif, hors-sujet

Et en plus, deux verrous additionnels :

- **Lock script** : impossible de lancer 2 exécutions en parallèle (évite les doublons)
- **Quota daily** : compteur de réponses envoyées par jour, bloque dès que `maxDailyReplies` est atteint
- **Quota Gmail** : si Gmail signale qu'il reste moins de 5 envois possibles dans la journée, le script s'arrête

---

## 📊 Suivi & debug

- Toutes les exécutions sont visibles dans **Apps Script → Exécutions** (logs détaillés)
- Les threads traités reçoivent un label :
  - `AutoReply/Sent` → réponse envoyée
  - `AutoReply/Skip` → ignoré (raison dans les logs)
  - `AutoReply/Error` → exception levée
  - `AutoReply/DryRun` → réponse générée en mode test

Pour réinjecter un thread (après debug) : retire son label `AutoReply/*` et marque-le non-lu.

---

## 🧪 FAQ

**C'est légal de faire répondre une IA à mes clients ?**
Oui. Tu restes responsable du contenu envoyé. Si tu veux jouer la transparence, ajoute `"réponse assistée par IA"` dans ta signature.

**Ça coûte combien ?**
0 €/mois pour la grande majorité des entrepreneurs. Gemini 2.5 Flash est gratuit jusqu'à ~1500 requêtes/jour. Au-delà, le pricing est dérisoire (centimes par millier de requêtes).

**Combien de mails par jour je peux envoyer ?**
- **Gmail perso** : 100 envois/jour
- **Google Workspace** : 1500/jour
- Le script respecte ces quotas automatiquement.

**Et si l'IA dit une bêtise ?**
Pendant 2-3 jours, garde `replyMode: 'draft'`. Tu valides chaque brouillon à la main. Quand tu es confiant, passe en `'send'`.

**Ça marche avec Outlook / un autre fournisseur ?**
Non, le script utilise Google Apps Script — Gmail uniquement.

**Comment changer le modèle Gemini ?**
Dans `CONFIG.ai.model`, mets `gemini-2.5-pro` pour plus de qualité (plus lent et plus cher), ou `gemini-2.5-flash-lite` pour le moins cher.

---

## 🚀 Vidéo tutoriel

📺 [Regarder la vidéo](https://youtube.com/@happie) — pas-à-pas en 3 minutes chrono.

---

## 📄 License

[MIT](./LICENSE) — fais-en ce que tu veux. Si tu modifies et partages, un crédit à [Happie](https://happie.fr) fait plaisir.

---

## 🤝 Contribuer

Bug, suggestion, fork amélioré ? → [Ouvre une issue](https://github.com/happiesas/gmail-ai-autoreply/issues) ou propose une pull request.

Si ce projet t'a fait gagner du temps, mets une ⭐ et partage-le.
