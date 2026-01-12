// Room background configurations for wall art preview
// Each room defines where the photo should be positioned on the wall

export type RoomBackground = {
  id: string;
  name: {
    fr: string;
    en: string;
  };
  src: string;
  // Wall positioning (percentages)
  wall: {
    centerX: number; // Horizontal center of wall area (0-100%)
    centerY: number; // Vertical center of wall area (0-100%)
    maxWidth: number; // Maximum width the art can occupy (0-100%)
  };
};

export const ROOM_BACKGROUNDS: RoomBackground[] = [
  {
    id: 'plateau',
    name: {
      fr: 'Salon Plateau',
      en: 'Plateau Living Room',
    },
    src: '/images/backgrounds/montreal_bright_airy_plateau_living_room.png',
    wall: {
      centerX: 45,
      centerY: 36,
      maxWidth: 38,
    },
  },
  {
    id: 'loft',
    name: {
      fr: 'Loft Montréal',
      en: 'Montreal Loft',
    },
    src: '/images/backgrounds/montrea_loft_living_room.png',
    wall: {
      centerX: 42,
      centerY: 35,
      maxWidth: 32,
    },
  },
  {
    id: 'cozy',
    name: {
      fr: 'Salon Chaleureux',
      en: 'Cozy Living Room',
    },
    src: '/images/backgrounds/montreal_cozy_living_room.png',
    wall: {
      centerX: 42,
      centerY: 33,
      maxWidth: 36,
    },
  },
  {
    id: 'coffee',
    name: {
      fr: 'Café Montréalais',
      en: 'Montreal Coffee Shop',
    },
    src: '/images/backgrounds/montreal_cozy_coffee_store.png',
    wall: {
      centerX: 45,
      centerY: 34,
      maxWidth: 34,
    },
  },
];

// Print size configurations
// Sizes affect how large the photo appears on the wall
export type PrintSize = {
  id: string;
  name: string;
  price: number;
  // Scale factor relative to wall maxWidth (0-1)
  // 24x36 = 1.0 (largest), smaller prints scale down proportionally
  scale: number;
};

export const PRINT_SIZES: PrintSize[] = [
  { id: '8x10', name: '8×10"', price: 45, scale: 0.4 },
  { id: '18x24', name: '18×24"', price: 120, scale: 0.7 },
  { id: '24x36', name: '24×36"', price: 180, scale: 1.0 },
];

// Product type options (based on Gelato fulfillment products)
export type ProductType = {
  id: string;
  name: {
    fr: string;
    en: string;
  };
  shortName: {
    fr: string;
    en: string;
  };
  price: number;
  // Visual styling for preview
  style: {
    type: 'poster' | 'framed' | 'canvas' | 'hanger';
    frameColor?: string;
    frameWidth?: number;
    matColor?: string;
    shadowIntensity: number; // 0-1
    hangerColor?: string;
  };
};

export const PRODUCT_TYPES: ProductType[] = [
  {
    id: 'fine-art',
    name: { fr: 'Affiche Fine Art', en: 'Fine Art Poster' },
    shortName: { fr: 'Fine Art', en: 'Fine Art' },
    price: 0, // Base price, included in size price
    style: {
      type: 'poster',
      shadowIntensity: 0.15,
    },
  },
  {
    id: 'framed',
    name: { fr: 'Cadre en Bois', en: 'Wooden Frame' },
    shortName: { fr: 'Cadre', en: 'Framed' },
    price: 45,
    style: {
      type: 'framed',
      frameColor: '#1a1a1a',
      frameWidth: 8,
      matColor: '#ffffff',
      shadowIntensity: 0.3,
    },
  },
  {
    id: 'canvas',
    name: { fr: 'Toile Canvas', en: 'Canvas' },
    shortName: { fr: 'Canvas', en: 'Canvas' },
    price: 35,
    style: {
      type: 'canvas',
      shadowIntensity: 0.25,
    },
  },
  {
    id: 'hanger',
    name: { fr: 'Affiche avec Cintre', en: 'Poster with Hanger' },
    shortName: { fr: 'Cintre', en: 'Hanger' },
    price: 25,
    style: {
      type: 'hanger',
      hangerColor: '#c4a77d',
      shadowIntensity: 0.2,
    },
  },
];
