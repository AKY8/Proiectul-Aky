
export enum CellClass {
  PREDATOR = 'Predator',
  TANK = 'Tank',
  PARASITE = 'Parasite',
  ASSASSIN = 'Assassin',
  SUPPORT = 'Support'
}

export interface Stats {
  speed: number;
  absorption: number;
  defense: number;
  regen: number;
  burst: number;
}

export interface PlayerState {
  id: string;
  name: string;
  level: number;
  exp: number;
  maxExp: number;
  class: CellClass;
  mass: number;
  stats: Stats;
  skillPoints: number;
  skills: string[];
}

export type AIBehavior = 'flee' | 'hunt' | 'idle' | 'ambush' | 'team';

export interface GameEntity {
  id: string;
  type: 'player' | 'ai' | 'food' | 'hazard' | 'virus' | 'ejected';
  ownerId?: string;
  mergeTimer?: number;
  spawnTime?: number; // performance.now() at creation
  vx?: number; // Velocity X for ejected mass/splits
  vy?: number; // Velocity Y for ejected mass/splits
  x: number;
  y: number;
  radius: number;
  color: string;
  mass: number;
  class?: CellClass;
  health?: number;
  behavior?: AIBehavior;
  targetId?: string;
  faction?: number;
  isVisible?: boolean; 
  // Added personality to GameEntity for AI entities
  personality?: { aggro: number; chaseBudget: number; fleeMargin: number; riskAversion: number };
}

export interface Biome {
  id: string;
  name: string;
  color: string;
  bounds: { x: number; y: number; w: number; h: number };
  effect: 'toxic' | 'lava' | 'nutrient' | 'dark' | 'normal';
}
