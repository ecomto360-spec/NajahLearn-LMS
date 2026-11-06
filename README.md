# NajahLearn LMS — Plateforme E-Learning & Gestion Scolaire

Plateforme professionnelle de formation à distance et de gestion administrative pour écoles et centres de formation.

Conçue spécifiquement pour répondre aux exigences réglementaires et opérationnelles :
- **Langue** : Français
- **Devise** : Dinar Algérien (DZD, د.ج)
- **Fuseau horaire de référence** : `Africa/Algiers` (GMT+1)
- **Format de date** : `JJ/MM/AAAA`

---

## 1. Architecture Technique & Choix de Conception

- **Frontend** : React 19 + TypeScript, Vite 8, Tailwind CSS, Lucide React Icons. Typographie : *Plus Jakarta Sans* et *JetBrains Mono* avec chiffres tabulaires (`tabular-nums`) pour les montants financiers et métriques.
- **Backend** : Node.js (TypeScript) avec Express monté via `server.ts` et middlewares Vite intégrés en développement.
- **Base de Données & Persistance** : Moteur relationnel avec persistance atomique sur disque (`./data/najahlearn.json`), gestion des transactions ACID (ex: validation de paiement $\rightarrow$ activation de l'abonnement $\rightarrow$ journalisation d'audit en une seule opération indivisible).
- **Sécurité des Accès (Anti-Partage de Comptes)** :
  - Hachage cryptographique sécurisé PBKDF2 / SHA-256 avec salage.
  - Registre des sessions actives par appareil (`ActiveSessions`).
  - **Politique stricte de session unique** pour les étudiants : toute nouvelle connexion sur un autre appareil révoque automatiquement la session précédente et alerte l'utilisateur.
  - Contrôle des autorisations d'accès aux séances en direct et aux ressources côté serveur (`/api/sessions/:id/join`).
- **Visioconférence** :
  - Architecture officielle Zoom Server-to-Server OAuth (`/api/settings/integrations/ZOOM`).
  - Salle de visioconférence WebRTC interactive intégrée (`meet.jit.si`) utilisable immédiatement avec caméra, microphone, chat en direct et partage d'écran sans clé API requise.
- **Paiements & Abonnements** :
  - Gestion des règlements manuels en DZD : CCP Algérie Poste / BaridiMob, virements bancaires (BNA, CPA, BEA), espèces au guichet, chèques.
  - Génération et impression de **Reçus Officiels de Versement** avec cachet de scolarité.
  - Architecture d'intégration pour passerelle de paiement international (Stripe, webhooks vérifiés, clés d'idempotence).

---

## 2. Rôles et Comptes de Démonstration

L'application intègre un sélecteur de rôle instantané dans la barre supérieure pour permettre aux évaluateurs de tester l'ensemble des parcours sans saisie répétitive :

| Rôle | Nom | E-mail | Mot de passe | Rôle & Particularité |
| :--- | :--- | :--- | :--- | :--- |
| **Administrateur** | Dr. Rachid Haddad | `admin@najahlearn.dz` | `Admin2026!` | Accès complet : KPIs, finances, scolarité, sécurité, tests |
| **Gestionnaire** | Fatima Zohra Mansour | `gestion@najahlearn.dz` | `Manager2026!` | Scolarité, inscriptions, émargements et paiements |
| **Enseignant** | Prof. Karim Benali | `k.benali@najahlearn.dz` | `Teacher2026!` | Enseignant Web Dev : Classes, direct, émargements |
| **Enseignante** | Prof. Amira Belkacem | `a.belkacem@najahlearn.dz` | `Teacher2026!` | Enseignante Data Science & IA |
| **Étudiant (Actif)** | Yacine Brahimi | `yacine.brahimi@etu.najahlearn.dz` | `Student2026!` | Abonnement valide : accès autorisé aux cours et séances |
| **Étudiant (Expiré)** | Sofiane Feghouli | `sofiane.feghouli@etu.najahlearn.dz` | `Student2026!` | Abonnement échu : accès visioconférence bloqué (test sécurité) |
| **Étudiante (Attente)** | Lina Khaldi | `lina.khaldi@etu.najahlearn.dz` | `Student2026!` | Paiement BaridiMob en attente de validation administrative |

---

## 3. Suite de Tests Automatisés (15/15 Scénarios Validés)

Un lanceur de tests automatisés est intégré au backend (`POST /api/test-suite/run`) et accessible graphiquement dans l'onglet **"Tests Automatisés (15)"** de l'espace Administrateur :

1. **Création et connexion d'un étudiant** : Hachage PBKDF2 et token de session unique.
2. **Connexion administrateur et enseignant** : Authentification et cloisonnement des rôles.
3. **Blocage de l'accès aux ressources interdites (RBAC)** : Rejet HTTP 403 pour un étudiant tentant d'accéder aux routes administratives.
4. **Inscription d'un étudiant à une formation** : Association cohérente étudiant $\rightarrow$ classe $\rightarrow$ formation.
5. **Activation d'un abonnement après confirmation de paiement** : Transaction atomique (Paiement validé $\rightarrow$ Abonnement activé $\rightarrow$ Journal d'audit).
6. **Blocage d'un étudiant dont l'abonnement a expiré** : Rejet côté serveur sans délivrance du lien de visioconférence.
7. **Limitation des sessions simultanées** : Connexion sur un 2e appareil révoquant automatiquement la session antérieure de l'étudiant.
8. **Création et modification d'une séance** : Planification avec fuseau `Africa/Algiers` et report.
9. **Affectation d'un enseignant à une classe** : Vérification des liaisons d'emploi du temps.
10. **Saisie des présences et calcul des taux** : Émargement complet (Présent, Absent, Retard, Excusé) et calcul en temps réel.
11. **Calcul des statistiques réelles du dashboard** : Montants DZD réels, impayés, abonnements actifs.
12. **Import et export de données** : Validation des colonnes CSV et détection préventive des doublons.
13. **Gestion des erreurs de formulaire** : Rejet des emails erronés et des montants négatifs.
14. **Vérification de la persistance disque** : Écriture atomique et rechargement intègre du fichier JSON.
15. **Cloisonnement étanche des données** : Impossibilité pour un étudiant de consulter les paiements ou les cours d'un autre étudiant.

---

## 4. Guide d'Installation et Lancement Local

### Prérequis
- Node.js version 20 ou supérieure.
- npm version 10 ou supérieure.

### Installation
```bash
# Cloner le dépôt et installer les dépendances
npm install

# Copier le fichier d'environnement
cp .env.example .env
```

### Lancement en Développement
```bash
npm run dev
```
L'application démarre sur `http://localhost:3000`.

### Lancement en Production
```bash
npm run build
npm start
```

---

## 5. Procédure de Sauvegarde et Restauration

### Sauvegarde à chaud (Backup)
Les données sont conservées de manière centralisée dans le répertoire `./data/najahlearn.json`.
Pour créer une copie horodatée :
```bash
mkdir -p backups
cp data/najahlearn.json backups/najahlearn_$(date +%Y%m%d_%H%M%S).json
```
Un endpoint d'export JSON est également disponible à chaud : `GET /api/backup` (réservé ADMIN).

### Restauration (Restore)
1. Arrêter le serveur de production si nécessaire.
2. Remplacer le fichier `data/najahlearn.json` par la sauvegarde choisie.
3. Redémarrer l'application.

---

## 6. Intégrations Externes & Configurations de Production

| Service | Fonctionnalité | Clés Requises en Production | Statut Actuel |
| :--- | :--- | :--- | :--- |
| **Zoom API** | Création automatique de réunions privées | Account ID, Client ID, Client Secret (App S2S OAuth) | Opérationnel en mode Démo / WebRTC direct, prêt pour clés |
| **Algérie Poste / BaridiMob** | Rapprochement bancaire manuel | Reçu CCP / Numéro de transaction | Opérationnel avec validation administrative et reçus |
| **Passerelle Internationale (Stripe)** | Encaissement par carte bancaire internationale | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Architecture modulaire prête (désactivée par défaut) |
