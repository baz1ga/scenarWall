# ScenarWall

Petit guide pour naviguer dans le projet et lancer le serveur.

## Lancer en local
- Installer les dépendances si besoin : `npm install`
- Démarrer : `node server.js` (port 3100)
- Ouvrir `http://localhost:3100/login.html`

## Structure
- `server.js` : API Express + routes de fichiers statiques.
- `public/` : tout le front (HTML/CSS/JS).  
  - `public/admin/`, `public/godmode/`, `public/front/` : les pages principales.  
  - `public/css/` : styles partagés (front/back).  
  - `public/js/` : scripts dédiés (admin, godmode, front) et `public/js/common/` pour `auth.js` et `config.js`.
- `data/` : stockage des utilisateurs (`users.json`) et sessions (`sessions.json`).
- `tenants/` : données propres à chaque tenant (images, ordre, config).
