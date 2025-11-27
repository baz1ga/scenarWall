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
Pour un setup plus robuste : mettre un reverse proxy (Nginx) devant, gérer l’environnement (`NODE_ENV=production`, éventuelles vars d’API), et s’assurer que le dossier `data/` et `tenants/` restent en lecture/écriture côté serveur.

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
- `data/` : stockage des utilisateurs (`users.json`) et sessions (`sessions.json`).
- `tenants/` : données propres à chaque tenant (images, ordre, config).

> Note : les fichiers du dossier `data/` (ex. `users.json`, `sessions.json`, `global.json`) contiennent des données confidentielles et ne doivent pas être commités.

### Exemple de `data/global.json` (non commité)
```json
{
  "defaultQuotaMB": 100,
  "apiBase": "http://localhost:3100"
}
```
