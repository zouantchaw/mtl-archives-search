/**
 * Print configuration — mirrors apps/next-app/lib/room-backgrounds.ts
 * Room wall positions, sizes, and product frame styles.
 */

export type RoomBackground = {
  id: string;
  name: string;
  /** staticFile() path */
  src: string;
  wall: {
    centerX: number; // 0-100%
    centerY: number; // 0-100%
    maxWidth: number; // 0-100%
  };
};

export const ROOMS: RoomBackground[] = [
  {
    id: "plateau",
    name: "Salon Plateau",
    src: "images/backgrounds/montreal_bright_airy_plateau_living_room.png",
    wall: { centerX: 45, centerY: 36, maxWidth: 38 },
  },
  {
    id: "loft",
    name: "Loft Montréal",
    src: "images/backgrounds/montrea_loft_living_room.png",
    wall: { centerX: 42, centerY: 35, maxWidth: 32 },
  },
  {
    id: "cozy",
    name: "Salon Chaleureux",
    src: "images/backgrounds/montreal_cozy_living_room.png",
    wall: { centerX: 42, centerY: 33, maxWidth: 36 },
  },
  {
    id: "coffee",
    name: "Café Montréalais",
    src: "images/backgrounds/montreal_cozy_coffee_store.png",
    wall: { centerX: 45, centerY: 34, maxWidth: 34 },
  },
];

export type ProductStyle = "poster" | "framed" | "hanger";

export type ProductType = {
  id: string;
  name: string;
  style: ProductStyle;
  frameColor?: string;
  frameWidth?: number;
  hangerColor?: string;
  shadowIntensity: number;
};

export const PRODUCTS: Record<ProductStyle, ProductType> = {
  poster: {
    id: "fine-art",
    name: "Affiche Fine Art",
    style: "poster",
    shadowIntensity: 0.15,
  },
  framed: {
    id: "framed-canvas",
    name: "Canvas Encadré",
    style: "framed",
    frameColor: "#0a0a1a",
    frameWidth: 6,
    shadowIntensity: 0.3,
  },
  hanger: {
    id: "hanger",
    name: "Affiche avec Cintre",
    style: "hanger",
    hangerColor: "#c4a77d",
    shadowIntensity: 0.2,
  },
};

export const PRINT_SIZES = [
  { id: "8x10", name: '8×10"', price: 45, scale: 0.4 },
  { id: "18x24", name: '18×24"', price: 120, scale: 0.7 },
  { id: "24x36", name: '24×36"', price: 180, scale: 1.0 },
] as const;
