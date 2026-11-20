# Gabarit

Logiciel de conception 3D paramétrique, gratuit, qui fonctionne dans le navigateur (et hors ligne une fois installé).

- Esquisses 2D : rectangle, cercle, rainure, polygone, contour libre, cotes modifiables, accroche à la grille.
- Fonctions : extrusion, enlèvement, révolution, perçage (simple, lamé, fraisé), congé, chanfrein, coque, symétrie, répétition.
- Historique modifiable, barre « Fin de la pièce », paramètres nommés utilisables dans toutes les cotes.
- Export STL (impression 3D) et STEP (autres logiciels de CAO), fichiers de pièce `.gabarit`.

Noyau géométrique : OpenCascade (via replicad). Affichage : three.js. Voir `web/LICENSES.txt`.

## Construire

```
npm install
node tools/build.mjs      # site dans dist/, version autonome dans dist-standalone/Gabarit.html
```

Publication : GitHub Pages sur la branche `gh-pages` (contenu de `dist/`), déployée par `.github/workflows/pages.yml`.
