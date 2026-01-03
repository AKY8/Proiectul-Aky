
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
  ownerId?: string; // For split cells and ejected mass
  mergeTimer?: number; // Ticks until this cell can merge with siblings
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
}

export interface Biome {
  id: string;
  name: string;
  color: string;
  bounds: { x: number; y: number; w: number; h: number };
  effect: 'toxic' | 'lava' | 'nutrient' | 'dark' | 'normal';
}
