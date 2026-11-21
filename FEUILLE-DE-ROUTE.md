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
| Texte (gravé ou en relief, accents compris) | ✅ v0.6 |
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
| Cotation automatique : encombrement, axes, diamètres des trous, positions des trous | ✅ v0.6 |
| Vues en coupe, vues de détail, nomenclature sur le plan | 🗓️ |

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

## 8. Là où Gabarit peut faire mieux que SolidWorks
SolidWorks coûte plusieurs milliers d’euros par an, ne tourne que sur un PC Windows puissant et demande des semaines d’apprentissage. Gabarit joue sur d’autres forces :

| Idée | Pourquoi c’est mieux | État |
|---|---|---|
| Gratuit, sans compte, s’ouvre dans un navigateur, marche sans Internet | Aucun installateur, aucune licence, même sur un vieux PC ou un Mac | ✅ |
| Interface en français courant, aide dans chaque panneau | Pas besoin de formation | ✅ |
| Paramètres et calculs dans toutes les cases | Aussi souple que les équations de SolidWorks, en plus simple | ✅ |
| Partage d’une pièce par simple lien (la pièce est dans le lien) | Pas de serveur, pas de compte, la personne ouvre et modifie | ✅ v0.7 |
| Recherche de commandes en tapant (Ctrl+K) : « trou », « arrondir », « filet M8 » | Plus rapide que de chercher dans les menus | ✅ v0.7 |
| Pensé pour l’impression 3D : surplombs colorés, pose à plat automatique, export 3MF | SolidWorks vise l’usinage ; ici l’impression 3D est au centre | ✅ v0.7 |
| Variantes d’une pièce en un clic (familles) | L’équivalent des configurations, sans tableau Excel | ✅ v0.7 |
| Versions enregistrées avec retour en arrière | Historique sans logiciel de gestion de données | ✅ v0.7 |
| Essai dans un meuble (case Kallax, niveau de Billy, bac, meuble sur mesure) : la pièce rentre-t-elle, combien on en range, jusqu’où l’agrandir | Dans SolidWorks il faut modéliser le meuble et faire un assemblage ; ici c’est un bouton | ✅ v1.5 |
| Pas du quadrillage réglable jusqu’à 0,01 mm, commun au sol, aux flèches, aux boutons − et + et au dessin | Un seul réglage, visible à côté de la vue | ✅ v1.5 |
| Bibliothèque de pièces standard paramétriques (vis, écrous, rondelles, roulements) | Sans abonnement à une bibliothèque | 🗓️ |
| Assistant qui repère les problèmes (paroi trop fine pour l’impression, trou trop près du bord) | Conseils avant d’imprimer | 🗓️ |
| Travail à plusieurs en direct | Sans serveur payant : à étudier (pair à pair) | 🗓️ |
