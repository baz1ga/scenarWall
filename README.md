# ScenarWall

Petit guide pour naviguer dans le projet et lancer le serveur.

## Lancer en local
- Installer les dépendances : `npm install`
- Générer le CSS Tailwind (v3) : `npm run tailwind:build` (ou `npm run tailwind:watch` en dev)
- Démarrer le serveur : `npm start` (port 3100)
- Ouvrir `http://localhost:3100/index.html`

## Lancer en production (exemple simple)
- Générer le CSS : `npm run tailwind:build`
- Démarrer le serveur Node : `npm start` (ou via un process manager type pm2)
- Servir `http://<host>:3100/index.html`
Pour un setup plus robuste : mettre un reverse proxy (Nginx) devant, gérer l’environnement (`NODE_ENV=production`, éventuelles vars d’API), et s’assurer que le dossier `data/` (dont `data/tenants/`) reste en lecture/écriture côté serveur.

### Variables d’environnement (préférées pour les secrets)
- `API_BASE` : URL publique de l’API.
- `PIXABAY_KEY` : clé Pixabay (sera servie au front pour l’onglet Pixabay).
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` : credentials OAuth Discord.
- `DISCORD_SCOPES` : liste séparée par des virgules (ex: `identify`).
- Si `DISCORD_ALLOWED_GUILD_ID` est défini, ajoute `guilds` dans `DISCORD_SCOPES` (automatique si absent).

### Changer le port / l’URL
- Le port par défaut est fixé dans `server.js` (3100). Modifie la valeur ou exporte `PORT` (`PORT=4000 npm start`).
- Les URL côté front pointent sur le même host/port (chemins relatifs). Si tu utilises un reverse proxy ou un host différent, ajuste la config d’accès au besoin (ex. via un proxy Nginx vers le port Node).

## Structure
- `server.js` : API Express + routes de fichiers statiques.
- `public/` : tout le front (HTML/CSS/JS).
  - `public/admin/` : interface admin unifiée (galerie + tension + quotas + utilisateurs + mot de passe).
  - `public/front/` : affichage public tenantisé (front + CSS/JS dédiés).
  - `public/index.html`, `public/signup.html` : pages d’auth.
  - `public/fragments/` : fragments HTML (donation, legal footer) injectés par `public/js/common/fragments-loader.js`.
- `public/css/tailwind.css` : build Tailwind généré depuis `src/tailwind.css`.
- `public/js/common/` : `auth.js`, `config.js`, `fragments-loader.js`.
- `src/tailwind.css` : entrée Tailwind (base/components/utilities).
- `tailwind.config.js` / `postcss.config.js` : config Tailwind/PostCSS.
- `data/` : stockage des données (utilisateurs, sessions, `data/tenants/`). Le fichier `data/global.json` ne doit contenir que `defaultQuotaMB`.

> Les secrets et configs publiques (`PIXABAY_KEY`, credentials Discord, `API_BASE`, etc.) doivent être fournis via les variables d’environnement et non dans `global.json`.

### Exemple de `data/global.json` (non commité)
```json
{
  "defaultQuotaMB": 100
}
```
