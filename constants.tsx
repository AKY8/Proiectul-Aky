
import { CellClass, Stats } from './types';

export const MAP_SIZE = 8000;
export const CHUNK_SIZE = 1000;
export const INITIAL_MASS = 25;
export const FOOD_COUNT = 1500;
export const AI_COUNT = 45;

export const CLASS_DATA: Record<CellClass, { description: string; baseStats: Stats; color: string }> = {
  [CellClass.PREDATOR]: {
    description: "Apex Hunter: +50% Digestie & Viziune. Creștere rapidă din pradă.",
    baseStats: { speed: 1.3, absorption: 1.6, defense: 0.8, regen: 1.0, burst: 1.2 },
    color: '#ff3e3e'
  },
  [CellClass.TANK]: {
    description: "Behemoth: +100% Defensă. Pierde masă greu și regenerează rapid.",
    baseStats: { speed: 0.8, absorption: 0.9, defense: 2.2, regen: 1.8, burst: 0.5 },
    color: '#3b82f6'
  },
  [CellClass.PARASITE]: {
    description: "Leech: Furt de Masă la contact. Agil și greu de fixat.",
    baseStats: { speed: 1.5, absorption: 0.5, defense: 0.6, regen: 1.2, burst: 1.5 },
    color: '#d946ef'
  },
  [CellClass.ASSASSIN]: {
    description: "Ghost: Viteză Explozivă. Aproape invizibil în zonele întunecate.",
    baseStats: { speed: 1.7, absorption: 1.1, defense: 0.5, regen: 0.7, burst: 2.2 },
    color: '#10b981'
  },
  [CellClass.SUPPORT]: {
    description: "Nexus: Regenerează hrana în jur și oferă buff-uri de viteză.",
    baseStats: { speed: 1.2, absorption: 0.8, defense: 1.3, regen: 2.8, burst: 0.8 },
    color: '#fbbf24'
  }
};
