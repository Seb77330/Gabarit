# Gabarit : ce que fait SolidWorks, et où on en est

Légende : ✅ fait · 🔨 en cours · 🗓️ prévu plus tard · ❌ hors de portée pour l'instant

## 1. Esquisses
| SolidWorks | Gabarit |
|---|---|
| Lignes, rectangles, cercles, rainures, polygones | ✅ |
| Arcs (3 points, tangents) dans les contours | ✅ v0.2 (on tire le milieu d'un côté pour le courber) |
| Congés et chanfreins d'esquisse | ✅ congé des angles du contour libre |
| Traits de construction | ✅ |
| Cotes pilotantes, équations, variables globales | ✅ (paramètres nommés, calculs dans toutes les cases) |
| Contraintes géométriques (horizontal, vertical, parallèle, perpendiculaire, égal, tangent, coïncident, symétrique, fixe) et solveur, degrés de liberté | ✅ v0.3 |
| Chemins ouverts (pour balayage) | ✅ v0.2 |
| Splines (courbes lisses), ellipses | ✅ v0.5 |
| Texte | 🗓️ |
| Miroir d'esquisse, décalage d'entités | ✅ v0.5 |
| Convertir les entités, ajuster/prolonger, répétition d'esquisse | 🗓️ (aujourd'hui : arêtes projetées en pointillé et accroche) |
| Esquisse 3D | ❌ |

## 2. Fonctions de pièce
| SolidWorks | Gabarit |
|---|---|
| Bossage et enlèvement extrudés (distance, symétrique, à travers tout) | ✅ |
| Révolution (bossage et enlèvement) | ✅ |
| Assistance au perçage (simple, lamé, fraisé) | ✅ |
| Congés, chanfreins | ✅ (congés à rayon constant) |
| Coque | ✅ |
| Symétrie et répétitions de la pièce entière | ✅ |
| Plans de référence décalés et inclinés | ✅ v0.2 |
| Lissage (loft) | ✅ v0.2 |
| Balayage (sweep) | ✅ v0.2 |
| Dépouille | ✅ v0.2 |
| Répétition et symétrie de fonctions choisies, répétition en grille (2 directions) | ✅ v0.2 |
| Extrusion « jusqu'à la face » (parallèle ou inclinée) | ✅ v0.5 |
| Extrusion « jusqu'au suivant », dépouille dans l'extrusion | 🗓️ |
| Congés à rayon variable, congés de face | 🗓️ |
| Nervures, filetages ISO (vis et taraudage), hélices et ressorts | ✅ v0.5 |
| Enroulement, déformation | 🗓️ |
| Pièces multicorps, combiner, découper | 🗓️ |
| Configurations (familles de pièces) | 🗓️ (les paramètres en font déjà une partie) |
| Tôlerie, soudures, moules, surfaces avancées | ❌ pour l'instant |

## 3. Outils
| SolidWorks | Gabarit |
|---|---|
| Propriétés de masse (volume, masse, matière) | ✅ |
| Centre de gravité | ✅ v0.2 |
| Mesure | ✅ v0.2 |
| Vue en coupe | ✅ v0.2 |
| Annuler, historique, barre de reprise, désactiver une fonction | ✅ |
| Détection des interférences (assemblages) | ✅ v0.4 |
| Analyse de dépouille, d'épaisseur | 🗓️ |

## 4. Fichiers
| SolidWorks | Gabarit |
|---|---|
| Export STL, STEP | ✅ |
| Import STEP, STL | ✅ v0.2 |
| Export 3MF, OBJ, DXF d'esquisse | ✅ v0.5 |
| DXF/DWG des mises en plan | 🗓️ |

## 5. Mises en plan
| SolidWorks | Gabarit |
|---|---|
| Vues standard (face, dessus, droite, iso), arêtes cachées | ✅ v0.2 |
| Cartouche, échelle, export PDF | ✅ v0.2 |
| Cotation automatique, coupes, détails, nomenclature | 🗓️ |

## 6. Assemblages
| SolidWorks | Gabarit |
|---|---|
| Insérer des pièces (Gabarit, STEP, STL), composant fixe, bibliothèque « Mes pièces » | ✅ v0.4 |
| Contraintes : coïncidence, concentrique, distance, parallèles (inverser, désactiver) | ✅ v0.4 |
| Interférences, vue éclatée, nomenclature avec masses (export tableur), export STEP/STL de l'assemblage | ✅ v0.4 |
| Contraintes d'angle, de tangence, engrenages ; sous-assemblages ; mise en plan d'assemblage | 🗓️ |

## 7. Simulation, rendu, PDM
| SolidWorks | Gabarit |
|---|---|
| Simulation (résistance), rendu photoréaliste, PDM, collaboration | ❌ pour l'instant |
