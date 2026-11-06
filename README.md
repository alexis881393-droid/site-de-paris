# RACEBET CONTROL

Panneau de contrôle pour la **comptabilité des paris fictifs** sur les courses automobiles RP d'un serveur GTA V FiveM.

> Les mises et les gains sont exprimés en **dollars fictifs FiveM**, non convertibles en argent réel.
> Aucun paiement réel, aucune connexion à FiveM, aucun transfert. Tout est saisi à la main ; le site calcule.

---

## Sommaire

1. [Fonctionnalités](#1-fonctionnalités)
2. [Règles financières appliquées](#2-règles-financières-appliquées)
3. [Architecture](#3-architecture)
4. [Installation locale (Windows / PowerShell)](#4-installation-locale-windows--powershell)
5. [Base de données Neon](#5-base-de-données-neon)
6. [Déploiement sur Vercel (offre Hobby)](#6-déploiement-sur-vercel-offre-hobby)
7. [Variables d'environnement](#7-variables-denvironnement)
8. [Sauvegardes automatiques (Cloudflare R2)](#8-sauvegardes-automatiques-cloudflare-r2)
9. [Export et restauration](#9-export-et-restauration)
10. [Tests](#10-tests)
11. [Sécurité et limites](#11-sécurité-et-limites)
12. [Ce qui dépend d'un service externe](#12-ce-qui-dépend-dun-service-externe)

---

## 1. Fonctionnalités

**Deux parties** :

| Adresse | Accès | Contenu |
|---|---|---|
| `/` | public, sans connexion | Cotes des pilotes en direct et leur évolution (graphique), encart « paris en espèces uniquement ». Aucune donnée de parieur (nom, téléphone, montant). Courses visibles : paris ouverts, clôturés ou résultat connu. |
| `/admin` | privé, compte obligatoire | Tout le reste : pilotes, paris, comptabilité, associés, et l'onglet **Comptes** (`4`). |

**Comptes de l'espace privé** : chaque administrateur crée son compte (pseudo + mot de passe) avec un **code d'accès à usage unique** (`RB-XXXX-XXXX-XXXX`).
- Premier code : `npm run admin:code` depuis votre PC (voir « Commandes utiles »).
- Codes suivants : onglet **Comptes** → « Générer un code ». Le code complet n'est affiché qu'une fois ; seule son empreinte SHA-256 est stockée. Un code inutilisé peut être révoqué.
- L'onglet liste les comptes créés (date, qui a invité, dernière connexion) et permet de supprimer un autre compte (ses sessions sont fermées).
- Mots de passe hachés avec scrypt ; 5 échecs de connexion consécutifs bloquent le compte 15 min ; session de 30 jours dans un cookie `httpOnly`, `SameSite=Lax`, `Secure` en production.

**En-tête** : logo, sélecteur de course active, statut, bouton « Nouvelle course », historique de toutes les courses (recherche, filtre par statut, suppression).

**Suppression d'une course** (Historique → Supprimer) : possible pour une course en préparation, terminée (paiements ou remboursements terminés) ou sans aucun pari. Refusée tant que des gains ou remboursements sont dus (contrôlé aussi en base par `racebet_purge_race`). Pour une course avec des paris, il faut taper `SUPPRIMER`. La course disparaît de la comptabilité ; un résumé reste dans le journal des opérations.

**Pilotes déjà enregistrés** : en préparation, un champ de recherche propose les pilotes des courses précédentes (filtre au fil de la frappe). L'icône corbeille retire un pilote de cette liste sans modifier les courses passées ; il y réapparaît s'il est recréé.

**Parieurs** : nom RP obligatoire, numéro de téléphone facultatif (identifie le joueur).

**Trois onglets** (raccourcis clavier `1`, `2`, `3` ; `N` = nouvelle course, `H` = historique) :

| Onglet | Rôle |
|---|---|
| **PILOTES** | Ajout / correction / retrait des pilotes (en préparation uniquement), ouverture des paris, tour des cotes en direct, enregistrement du résultat officiel (vainqueur + classement informatif). |
| **PARIS** | Saisie d'un pari avec fenêtre de confirmation obligatoire, tableau des paris (recherche, filtres pilote / résultat / paiement, tri par montant, total visible), clôture, annulation, marquage des paiements et remboursements. |
| **COMPTABILITÉ** | Comptabilité de la course sélectionnée, tableau de bord global (filtres période / statut / recherche), graphiques, exports CSV, sauvegarde JSON complète, état des sauvegardes automatiques. |

**Cycle de vie d'une course** (transitions contrôlées côté serveur ET en base) :

```
EN PRÉPARATION ──► PARIS OUVERTS ──► PARIS CLÔTURÉS ──► RÉSULTATS ENREGISTRÉS ──► PAIEMENTS TERMINÉS
      │                 │                  │                    (si aucun gain à verser : directement PAIEMENTS TERMINÉS)
      └─────────────────┴──────────────────┴──► COURSE ANNULÉE ──► REMBOURSEMENTS TERMINÉS
```

Plusieurs courses peuvent être à des étapes différentes en même temps ; chaque course a sa propre cagnotte et sa propre comptabilité.

---

## 2. Règles financières appliquées

Code : [`src/lib/finance.ts`](src/lib/finance.ts) (100 % entiers `BigInt`, aucun flottant dans un montant).

| Règle | Implémentation |
|---|---|
| **Commission** | Fixée à la création (0 à 100 %, 2 décimales max., ex. 12,5 %), stockée en points de base, **immuable** (trigger SQL). `commission = plancher(cagnotte × taux)` : l'arrondi va toujours vers le bas, le dollar résiduel reste aux joueurs. |
| **Cote** | `cote = cagnotte distribuable ÷ mises sur le pilote`. Affichée tronquée à 2 décimales, **jamais** utilisée pour payer. « Aucune mise » si le pilote n'a reçu aucun pari. |
| **Gains** | Répartition proportionnelle par la **méthode des plus grands restes** : partie entière pour chacun, puis les dollars restants un par un aux plus grands restes fractionnaires (égalité : mise la plus haute, puis pari le plus ancien, puis identifiant). La somme des gains = cagnotte distribuable, au dollar près. |
| **Aucun pari sur le vainqueur** | L'organisateur conserve 100 % de la cagnotte. La commission est absorbée (jamais comptée deux fois). |
| **Cote < ×1** | Normal : si tout le monde a parié sur le vainqueur, chacun récupère moins que sa mise. |
| **Annulation** | Possible tant qu'aucun résultat officiel n'est enregistré (même après clôture). Remboursement intégral, commission 0 $. |
| **Un pari par joueur et par course** | Clé d'identité `tel:<chiffres du numéro de téléphone>` sinon `name:<nom normalisé>` (casse, accents, espaces et séparateurs du numéro ignorés). Contrainte d'unicité PostgreSQL. Un même nom RP ne peut pas contourner la règle en ajoutant ou omettant un numéro. |
| **Paris immuables** | Aucune route de modification/suppression (HTTP 405) **et** trigger PostgreSQL qui refuse tout `UPDATE` / `DELETE` / `TRUNCATE`. |
| **Paiements idempotents** | Un règlement ne passe qu'une fois de « à verser » à « versé » (verrou de ligne + trigger). Un double clic ne compte rien deux fois. |
| **Redistribution aux associés** | Le bénéfice de la course (revenu de l'organisateur) est partagé entre **4 associés** (25 % chacun par défaut, noms et parts modifiables, total obligatoirement 100 %). Répartition au dollar près par plus grands restes. Dans l'onglet Comptabilité de la course sélectionnée, chaque part se marque « versée » ; au **premier versement**, la répartition de la course est **figée** (noms et pourcentages copiés, montant immuable par trigger). Une course avec des parts encore à verser ne peut pas être supprimée. |

**Comptabilité** : le revenu de l'organisateur n'est compté que lorsqu'il est **définitivement acquis** (résultat enregistré). Avant, les mises sont affichées comme « fonds détenus ». Revenu global = commissions acquises (courses avec gagnants) + cagnottes conservées (courses sans gagnant) : deux postes exclusifs pour une même course.

---

## 3. Architecture

```
src/
  app/                  Next.js App Router (page unique + routes API REST)
    api/races/...       courses, pilotes, paris, clôture, résultat, annulation
    api/settlements/    paiements / remboursements
    api/accounting      comptabilité globale
    api/export/         CSV + sauvegarde JSON
    api/cron/backup     sauvegarde quotidienne (protégée par CRON_SECRET)
  components/           interface (en-tête, onglets, fenêtres modales)
  lib/                  logique pure partagée : finance, comptabilité, formats, validation Zod
  server/
    db/schema.ts        schéma Drizzle (source des migrations)
    services/           commandes transactionnelles + requêtes de lecture
    backup/             export, vérification, restauration, envoi R2
drizzle/                migrations SQL (0001 = triggers d'intégrité)
scripts/                administration locale : migrations, restauration, sauvegarde, démo
tests/                  tests Vitest (logique pure + PostgreSQL réel via PGlite)
```

- **PostgreSQL (Neon) est l'unique source de vérité.** Aucune donnée métier dans le navigateur (seule la dernière course consultée est mémorisée localement, par confort).
- **Concurrence** : chaque opération critique est une transaction. Un pari prend un verrou partagé sur la course, la clôture un verrou exclusif : un pari concurrent à la clôture est soit entièrement accepté avant, soit rejeté. La cagnotte figée à la clôture est enregistrée (`race_closures`).
- **Plusieurs opérateurs** : les écrans se rafraîchissent automatiquement (toutes les 4 s) ; le serveur reste seul juge.
- **Journal** : toutes les opérations (création, ouverture, pari, clôture, résultat, annulation, paiement, remboursement, sauvegarde) sont journalisées dans `operation_log`, en ajout seul.

---

## 4. Installation locale (Windows / PowerShell)

Prérequis : **Node.js 22 ou plus** (`node -v`) et Git.

```powershell
cd "D:\1 c script rdtm\site de paris"
npm install
Copy-Item .env.example .env.local
notepad .env.local      # renseignez DATABASE_URL (voir section 5)
npm run db:migrate      # crée les tables et les triggers dans Neon
npm run dev             # http://localhost:3000
```

### Développement hors ligne, sans Neon (facultatif)

Une base PostgreSQL embarquée (PGlite) stockée dans `.\.pglite` peut servir **uniquement en local** (refusée sur Vercel) :

```powershell
$env:DATABASE_DRIVER = "pglite"
npm run db:migrate
npm run db:seed-demo    # facultatif : 2 courses de démonstration (refusé si la base n'est pas vide)
npm run dev
```

Pour revenir à Neon : `Remove-Item Env:DATABASE_DRIVER` (ou fermez le terminal).

### Commandes utiles

```powershell
npm run typecheck   # vérification TypeScript
npm test            # tests
npm run build       # build de production
npm start           # lance le build de production en local
```

Remise à zéro en gardant une seule course et ses pilotes (sauvegarde automatique dans le dossier `backups` avant effacement) :

```powershell
npm run reset:keep -- "Liste noire"           # aperçu, ne modifie rien
npm run reset:keep -- "Liste noire" --apply   # demande de taper REMETTRE A ZERO
```

Code d'accès à l'espace privé (usage unique, affiché une seule fois ; la base visée est celle de `DATABASE_URL`) :

```powershell
npm run admin:code
```

---

## 5. Base de données Neon

1. Créez un compte sur <https://neon.tech> (offre gratuite) puis **New Project** (région proche : `AWS Europe Central (Frankfurt)`).
2. Dans **Dashboard → Connect**, choisissez la base `neondb`, cochez **Connection pooling** et copiez la chaîne :
   `postgresql://UTILISATEUR:MOT_DE_PASSE@ep-xxxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`
3. Collez-la dans `.env.local` :
   ```
   DATABASE_URL=postgresql://...
   ```
4. Appliquez les migrations depuis votre PC :
   ```powershell
   npm run db:migrate
   ```
   La commande est idempotente : relancez-la après chaque mise à jour du projet contenant de nouvelles migrations.

> Ne partagez jamais cette chaîne : elle donne un accès complet à la base. Elle n'est jamais envoyée au navigateur.

---

## 6. Déploiement sur Vercel (offre Hobby)

1. Poussez le projet sur un dépôt GitHub (le fichier `.gitignore` exclut `.env.local`, `.pglite/`, `backups/`).
   ```powershell
   git init
   git add .
   git commit -m "RACEBET CONTROL"
   git branch -M main
   git remote add origin https://github.com/VOTRE_COMPTE/racebet-control.git
   git push -u origin main
   ```
2. Sur <https://vercel.com/new>, importez le dépôt. Framework détecté : **Next.js**. Aucun réglage de build à changer.
3. **Settings → Environment Variables** : ajoutez au minimum `DATABASE_URL` (environnements Production et Preview). Voir section 7.
4. Lancez (ou relancez) le déploiement : **Deployments → … → Redeploy**.
5. Avant le premier usage, vérifiez que `npm run db:migrate` a été exécuté sur la même base Neon.

Les redéploiements ne touchent jamais aux données : elles sont dans Neon.

Avec la CLI (facultatif) :
```powershell
npm i -g vercel
vercel link
vercel env add DATABASE_URL production
vercel --prod
```

---

## 7. Variables d'environnement

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` | **Oui** | Chaîne de connexion Neon (pooled). Sans elle, le site affiche « Base de données non configurée ». |
| `CRON_SECRET` | Pour les sauvegardes auto | Secret aléatoire de la tâche planifiée. Générer : `[Convert]::ToBase64String((1..36 \| % { Get-Random -Max 256 }))` |
| `R2_ACCOUNT_ID` | Pour les sauvegardes auto | Identifiant de compte Cloudflare. |
| `R2_ACCESS_KEY_ID` | Pour les sauvegardes auto | Clé d'accès API R2. |
| `R2_SECRET_ACCESS_KEY` | Pour les sauvegardes auto | Secret de la clé R2. |
| `R2_BUCKET` | Pour les sauvegardes auto | Nom du bucket **privé**. |
| `BACKUP_RETENTION_DAYS` | Non (30) | Durée de conservation. Les 7 sauvegardes les plus récentes sont toujours gardées. |
| `DATABASE_DRIVER` | Non | `pglite` = base locale de développement. Ne pas définir sur Vercel. |

---

## 8. Sauvegardes automatiques (Cloudflare R2)

Tant que les 5 variables `CRON_SECRET` + `R2_*` ne sont pas renseignées, l'onglet Comptabilité affiche **« Sauvegardes automatiques non configurées »** et aucune sauvegarde automatique n'a lieu. La sauvegarde reste possible depuis votre PC : `npm run backup:local`.

### Mise en place

1. Cloudflare → **R2 Object Storage** → **Create bucket** (ex. `racebet-backups`), accès **privé** (n'activez pas l'accès public).
2. R2 → **Manage R2 API Tokens** → **Create API token** : permission **Object Read & Write**, limitée à ce bucket. Notez *Access Key ID*, *Secret Access Key* et l'*Account ID*.
3. Dans Vercel, ajoutez `CRON_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, puis redéployez.
4. La tâche est déclarée dans [`vercel.json`](vercel.json) : `0 4 * * *` (04:00 UTC chaque jour). Sur l'offre Hobby, Vercel autorise **une exécution par jour** et ne garantit pas l'heure exacte (exécution possible dans l'heure).
5. Test manuel immédiat (remplacez l'URL et le secret) :
   ```powershell
   Invoke-RestMethod -Uri "https://VOTRE-SITE.vercel.app/api/cron/backup" -Headers @{ Authorization = "Bearer VOTRE_CRON_SECRET" }
   ```

### Fonctionnement

- Export complet dans une transaction en lecture seule (instantané cohérent), compressé (`.json.gz`), envoyé dans `backups/` du bucket.
- **Vérification d'intégrité** : le fichier est relu depuis R2, son empreinte SHA-256 comparée, puis son contenu revérifié (format, compteurs, somme de contrôle interne).
- Rétention : suppression des sauvegardes plus anciennes que `BACKUP_RETENTION_DAYS`, en gardant toujours les 7 dernières.
- Chaque réussite / échec est journalisé et visible dans l'onglet Comptabilité.
- L'endpoint refuse toute requête sans `Authorization: Bearer <CRON_SECRET>` (HTTP 401).

---

## 9. Export et restauration

### Exports (onglet Comptabilité)

- **CSV courses** : comptabilité par course.
- **CSV paris** : tous les paris avec règlement associé.
- **CSV règlements** : gains et remboursements.
- **CSV associés** : part de chaque associé par course (provisoire, à verser, versée).

Les CSV utilisent le séparateur `;` et l'encodage UTF-8 avec BOM (ouverture directe dans Excel en français).

Sauvegarde locale en ligne de commande : `npm run backup:local` (écrit dans `.\backups\`).

### Restauration (script local uniquement)

La restauration n'existe **pas** sur le site (aucun bouton destructeur sur le site). Elle se fait depuis votre PC :

```powershell
# 1. Vérifier un fichier sans rien écrire
npm run restore -- "C:\chemin\racebet-sauvegarde.json" --check

# 2. Restaurer dans une base VIDE (recommandé : une nouvelle branche Neon)
npm run restore -- "C:\chemin\racebet-sauvegarde.json"

# 3. Écraser une base existante (efface TOUT puis restaure)
npm run restore -- "C:\chemin\racebet-2026-11-06T04-00-00-000Z.json.gz" --wipe
```

- La base cible est celle de `DATABASE_URL` dans `.env.local`. Vérifiez-la : le script affiche l'hôte et demande de taper `RESTAURER`.
- Tout se déroule dans **une seule transaction** : en cas d'erreur, rien n'est modifié.
- Procédure conseillée : Neon → **Branches → Create branch**, pointez `.env.local` sur cette branche, restaurez, contrôlez, puis basculez `DATABASE_URL` sur Vercel si nécessaire.
- Les fichiers R2 se téléchargent depuis le tableau de bord Cloudflare (R2 → bucket → `backups/`).

---

## 10. Tests

```powershell
npm test
```

Les tests métier tournent sur un **vrai PostgreSQL** embarqué (PGlite) avec les migrations et triggers de production :

| N° | Couvert par |
|---|---|
| 1 Pari mutuel classique (×4,25 ; 10 000 → 42 500) | `finance.test.ts`, `integration.test.ts` |
| 2 Aucun pari sur le vainqueur | `finance.test.ts`, `integration.test.ts` |
| 3 Tous sur le vainqueur (×0,85) | `finance.test.ts`, `integration.test.ts` |
| 4 Annulation (250 000 remboursés, commission 0) | `finance.test.ts`, `integration.test.ts` |
| 5 Un pari par joueur (casse, accents, numéro de téléphone, SQL direct) | `integration.test.ts` |
| 6 Pari verrouillé (UPDATE/DELETE/TRUNCATE refusés en base) | `integration.test.ts` |
| 7 Courses indépendantes | `integration.test.ts` |
| 8 Concurrence (paris simultanés, double clic, clôture concurrente) | `integration.test.ts` |
| 9 Arrondis (plus grands restes, 500 tirages aléatoires) | `finance.test.ts`, `integration.test.ts` |
| 10 Persistance (fermeture / nouvelle session) | `persistence.test.ts` |
| 11 Paiement validé deux fois | `integration.test.ts` |
| 12 Export → restauration à l'identique, refus des doublons et des fichiers altérés | `integration.test.ts` |

Vérifié manuellement sur le serveur de production local : `PUT` / `PATCH` / `DELETE` sur les paris → **405**, cron sans secret → **401**.

---

## 11. Sécurité et limites

- **Espace privé** : toutes les routes API (sauf `/api/public/odds` et `/api/auth/*`) exigent une session valide, vérifiée côté serveur à chaque requête, en plus de la page `/admin`. La page publique n'expose que les noms des pilotes et les cotes. Le site demande aux moteurs de recherche de ne pas l'indexer.
- **Codes d'accès** : quiconque détient un code inutilisé peut créer un compte. Transmettez-les en privé et révoquez ceux qui ne servent plus. Les comptes et codes ne sont pas inclus dans les sauvegardes JSON.
- Les garde-fous comptables (paris immuables, commission figée, transitions de statut, paiements uniques) sont appliqués **en base de données**, donc même contre un appel direct à l'API.
- Les secrets (`DATABASE_URL`, clés R2, `CRON_SECRET`) restent côté serveur.
- Le contournement des triggers (`racebet.maintenance`) n'est utilisé que par le script local de restauration ; l'application web ne l'active jamais.

### Limites des offres gratuites

| Service | Limite à connaître |
|---|---|
| Vercel Hobby | Usage non commercial ; 1 tâche planifiée par jour max., heure non garantie ; durée d'exécution des fonctions limitée. |
| Neon Free | Stockage et heures de calcul plafonnés ; la base se met en veille après inactivité (première requête ensuite un peu plus lente). Historique de restauration (PITR) court : gardez des sauvegardes externes. |
| Cloudflare R2 | 10 Go de stockage gratuits par mois, largement suffisant pour ces fichiers. |

---

## 12. Ce qui dépend d'un service externe

| Fonction | Dépend de | État par défaut |
|---|---|---|
| Tout le site | Neon (`DATABASE_URL`) | Écran « Base de données non configurée » tant qu'elle manque. |
| Sauvegarde quotidienne | Vercel Cron + Cloudflare R2 + `CRON_SECRET` | **Non configurée** (affiché dans Comptabilité). |
| Exports CSV | Neon uniquement | Disponibles dès que la base est configurée (le téléchargement de sauvegarde JSON depuis le site a été retiré). |
| Polices (Chakra Petch, Barlow) | Google Fonts, téléchargées au build | Auto-hébergées par Next.js. |

### Informations à fournir pour la mise en ligne

1. La chaîne de connexion **Neon** (pooled) → `DATABASE_URL`.
2. Pour les sauvegardes : **Account ID**, **Access Key ID**, **Secret Access Key** et nom du bucket R2, plus un `CRON_SECRET` que vous générez.

### Remplacer le logo

Le logo provisoire est dans [`src/components/logo.tsx`](src/components/logo.tsx) et l'icône d'onglet dans [`public/icon.svg`](public/icon.svg).
