export const DEFAULT_SCENARIO_ICON = 'fa-solid fa-scroll';
export const DEFAULT_SESSION_ICON = 'fa-solid fa-clapperboard';
const ICON_DEFINITIONS = [
  { label: 'Parchemin', name: 'scroll' },
  { label: 'Parchemin ancien', name: 'scroll-torah' },
  { label: 'Livre', name: 'book' },
  { label: 'Livre ouvert', name: 'book-open' },
  { label: 'Livre du mage', name: 'book-open-reader' },
  { label: 'Atlas', name: 'book-atlas' },
  { label: 'Livre squelette', name: 'book-skull' },
  { label: 'Lecteur', name: 'book-reader' },
  { label: 'Grimoire médical', name: 'book-medical' },
  { label: 'Dragon', name: 'dragon' },
  { label: 'Chapeau de magicien', name: 'hat-wizard' },
  { label: 'Baguette magique', name: 'wand-magic' },
  { label: 'Baguette céleste', name: 'magic-wand-sparkles' },
  { label: 'Masque', name: 'mask' },
  { label: 'Plume', name: 'feather-pointed' },
  { label: 'Plume d’écrivain', name: 'pen-nib' },
  { label: 'Écriture', name: 'pen-to-square' },
  { label: 'Carte', name: 'map' },
  { label: 'Position exacte', name: 'map-location-dot' },
  { label: 'Balise', name: 'map-marker' },
  { label: 'Punaise', name: 'map-pin' },
  { label: 'Panneaux', name: 'map-signs' },
  { label: 'Boussole', name: 'compass' },
  { label: 'Compas de dessin', name: 'compass-drafting' },
  { label: 'Globe', name: 'globe' },
  { label: 'Monde', name: 'earth-americas' },
  { label: 'Couronne', name: 'crown' },
  { label: 'Étoile', name: 'star' },
  { label: 'Étoile et croissant', name: 'star-and-crescent' },
  { label: 'Soleil', name: 'sun' },
  { label: 'Lune', name: 'moon' },
  { label: 'Montagne ensoleillée', name: 'mountain-sun' },
  { label: 'Feu', name: 'fire' },
  { label: 'Flamme courbée', name: 'fire-flame-curved' },
  { label: 'Brasier', name: 'fire-burner' },
  { label: 'Idée', name: 'lightbulb' },
  { label: 'Clé', name: 'key' },
  { label: 'Cadenas', name: 'lock' },
  { label: 'Cadenas ouvert', name: 'lock-open' },
  { label: 'Bouclier', name: 'shield' },
  { label: 'Bouclier divisé', name: 'shield-halved' },
  { label: 'Bouclier alternatif', name: 'shield-alt' },
  { label: 'Bouclier félin', name: 'shield-cat' },
  { label: 'Bouclier canin', name: 'shield-dog' },
  { label: 'Sablier', name: 'hourglass' },
  { label: 'Sablier moitié', name: 'hourglass-half' },
  { label: 'Sablier début', name: 'hourglass-start' },
  { label: 'Sablier fin', name: 'hourglass-end' },
  { label: 'Dé D20', name: 'dice-d20' },
  { label: 'Dé 6', name: 'dice-six' },
  { label: 'Dé 5', name: 'dice-five' },
  { label: 'Dé 4', name: 'dice-four' },
  { label: 'Dé 3', name: 'dice-three' },
  { label: 'Clap', name: 'clapperboard' },
  { label: 'Trophée', name: 'trophy' },
  { label: 'Colonnes', name: 'building-columns' },
  { label: 'Tour d’observation', name: 'tower-observation' },
  { label: 'Tour cellulaire', name: 'tower-cell' },
  { label: 'Casque ONU', name: 'helmet-un' },
  { label: 'Chapeau cowboy', name: 'hat-cowboy' },
  { label: 'Chapeau rigide', name: 'hat-hard' },
  { label: 'Tintement', name: 'bell' },
  { label: 'Fantôme', name: 'ghost' },
  { label: 'Satellite', name: 'satellite' }
];

export const ICON_OPTIONS = ICON_DEFINITIONS.map(def => ({
  label: def.label,
  value: `fa-solid fa-${def.name}`
}));

export function filterIcons(query = '', options = ICON_OPTIONS) {
  const normalized = (query || '').trim().toLowerCase();
  if (!normalized) return options;
  return options.filter(icon =>
    icon.label.toLowerCase().includes(normalized) ||
    icon.value.toLowerCase().includes(normalized)
  );
}
