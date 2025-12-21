export const DEFAULT_SCENARIO_ICON = 'fa-solid fa-scroll';
export const DEFAULT_SESSION_ICON = 'fa-solid fa-clapperboard';
const ICON_DEFINITIONS = [
  { label: 'Parchemin', key: 'scroll', name: 'scroll' },
  { label: 'Parchemin ancien', key: 'scrollTorah', name: 'scroll-torah' },
  { label: 'Livre', key: 'book', name: 'book' },
  { label: 'Livre ouvert', key: 'bookOpen', name: 'book-open' },
  { label: 'Livre du mage', key: 'bookOpenReader', name: 'book-open-reader' },
  { label: 'Atlas', key: 'bookAtlas', name: 'book-atlas' },
  { label: 'Livre squelette', key: 'bookSkull', name: 'book-skull' },
  { label: 'Lecteur', key: 'bookReader', name: 'book-reader' },
  { label: 'Grimoire médical', key: 'bookMedical', name: 'book-medical' },
  { label: 'Dragon', key: 'dragon', name: 'dragon' },
  { label: 'Chapeau de magicien', key: 'hatWizard', name: 'hat-wizard' },
  { label: 'Baguette magique', key: 'wandMagic', name: 'wand-magic' },
  { label: 'Baguette céleste', key: 'wandMagicSparkles', name: 'magic-wand-sparkles' },
  { label: 'Masque', key: 'mask', name: 'mask' },
  { label: 'Plume', key: 'feather', name: 'feather-pointed' },
  { label: 'Plume d’écrivain', key: 'penNib', name: 'pen-nib' },
  { label: 'Écriture', key: 'penToSquare', name: 'pen-to-square' },
  { label: 'Carte', key: 'map', name: 'map' },
  { label: 'Position exacte', key: 'mapLocationDot', name: 'map-location-dot' },
  { label: 'Balise', key: 'mapMarker', name: 'map-marker' },
  { label: 'Punaise', key: 'mapPin', name: 'map-pin' },
  { label: 'Panneaux', key: 'mapSigns', name: 'map-signs' },
  { label: 'Boussole', key: 'compass', name: 'compass' },
  { label: 'Compas de dessin', key: 'compassDrafting', name: 'compass-drafting' },
  { label: 'Globe', key: 'globe', name: 'globe' },
  { label: 'Monde', key: 'earthAmericas', name: 'earth-americas' },
  { label: 'Couronne', key: 'crown', name: 'crown' },
  { label: 'Étoile', key: 'star', name: 'star' },
  { label: 'Étoile et croissant', key: 'starCrescent', name: 'star-and-crescent' },
  { label: 'Soleil', key: 'sun', name: 'sun' },
  { label: 'Lune', key: 'moon', name: 'moon' },
  { label: 'Montagne ensoleillée', key: 'mountainSun', name: 'mountain-sun' },
  { label: 'Feu', key: 'fire', name: 'fire' },
  { label: 'Flamme courbée', key: 'fireFlameCurved', name: 'fire-flame-curved' },
  { label: 'Brasier', key: 'fireBurner', name: 'fire-burner' },
  { label: 'Idée', key: 'lightbulb', name: 'lightbulb' },
  { label: 'Clé', key: 'key', name: 'key' },
  { label: 'Cadenas', key: 'lock', name: 'lock' },
  { label: 'Cadenas ouvert', key: 'lockOpen', name: 'lock-open' },
  { label: 'Bouclier', key: 'shield', name: 'shield' },
  { label: 'Bouclier divisé', key: 'shieldHalved', name: 'shield-halved' },
  { label: 'Bouclier alternatif', key: 'shieldAlt', name: 'shield-alt' },
  { label: 'Bouclier félin', key: 'shieldCat', name: 'shield-cat' },
  { label: 'Bouclier canin', key: 'shieldDog', name: 'shield-dog' },
  { label: 'Sablier', key: 'hourglass', name: 'hourglass' },
  { label: 'Sablier moitié', key: 'hourglassHalf', name: 'hourglass-half' },
  { label: 'Sablier début', key: 'hourglassStart', name: 'hourglass-start' },
  { label: 'Sablier fin', key: 'hourglassEnd', name: 'hourglass-end' },
  { label: 'Dé D20', key: 'diceD20', name: 'dice-d20' },
  { label: 'Dé 6', key: 'diceSix', name: 'dice-six' },
  { label: 'Dé 5', key: 'diceFive', name: 'dice-five' },
  { label: 'Dé 4', key: 'diceFour', name: 'dice-four' },
  { label: 'Dé 3', key: 'diceThree', name: 'dice-three' },
  { label: 'Clap', key: 'clapperboard', name: 'clapperboard' },
  { label: 'Trophée', key: 'trophy', name: 'trophy' },
  { label: 'Colonnes', key: 'buildingColumns', name: 'building-columns' },
  { label: 'Tour d’observation', key: 'towerObservation', name: 'tower-observation' },
  { label: 'Tour cellulaire', key: 'towerCell', name: 'tower-cell' },
  { label: 'Casque ONU', key: 'helmetUn', name: 'helmet-un' },
  { label: 'Chapeau cowboy', key: 'hatCowboy', name: 'hat-cowboy' },
  { label: 'Chapeau rigide', key: 'hatHard', name: 'hat-hard' },
  { label: 'Tintement', key: 'bell', name: 'bell' },
  { label: 'Fantôme', key: 'ghost', name: 'ghost' },
  { label: 'Satellite', key: 'satellite', name: 'satellite' }
];

export const ICON_OPTIONS = ICON_DEFINITIONS.map(def => ({
  label: def.label,
  value: `fa-solid fa-${def.name}`,
  key: def.key || null
}));

export function filterIcons(query = '', options = ICON_OPTIONS, texts = null) {
  const normalized = (query || '').trim().toLowerCase();
  if (!normalized) {
    return options.map(icon => ({
      ...icon,
      label: resolveLabel(icon, texts)
    }));
  }
  return options
    .map(icon => ({
      ...icon,
      label: resolveLabel(icon, texts)
    }))
    .filter(icon =>
      icon.label.toLowerCase().includes(normalized) ||
      icon.value.toLowerCase().includes(normalized)
    );
}

function resolveLabel(icon, texts) {
  if (!texts || !icon.key) return icon.label;
  // locales/icons.json is flat (key -> label). Fallback: support nested under "icons".
  const direct = texts[icon.key];
  if (typeof direct === 'string' && direct.length) return direct;
  const nested = texts.icons && texts.icons[icon.key];
  if (typeof nested === 'string' && nested.length) return nested;
  return icon.label;
}
