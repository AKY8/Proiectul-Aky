
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { Minimap } from './components/Minimap';
import { ChatBot } from './components/ChatBot';
import { PlayerState, CellClass, GameEntity, Biome } from './types';
import { INITIAL_MASS, CLASS_DATA, MAP_SIZE, FOOD_COUNT, AI_COUNT } from './constants';
import { GoogleGenAI } from "@google/genai";

const PHYSICS_TPS = 60;
const MS_PER_TICK = 1000 / PHYSICS_TPS;
const GRID_CELL_SIZE = 500;
const MIN_SPLIT_MASS = 35;
const VIRUS_COUNT = 25;
const MAX_PLAYER_CELLS = 16;
const EJECTED_TTL = 12000; 

const NEARBY_BUFFER = new Int32Array(2048);

const PERSONALITIES = {
  TIMID: { aggro: 0.2, chaseBudget: 120, fleeMargin: 1.4, riskAversion: 1.5 },
  BALANCED: { aggro: 0.5, chaseBudget: 300, fleeMargin: 1.15, riskAversion: 1.0 },
  AGGRESSIVE: { aggro: 0.9, chaseBudget: 600, fleeMargin: 1.05, riskAversion: 0.5 },
  CUNNING: { aggro: 0.6, chaseBudget: 400, fleeMargin: 1.2, riskAversion: 0.8 }
};

class EntityPool {
  private pool: GameEntity[] = [];
  get(type: 'food' | 'ejected'): GameEntity {
    if (this.pool.length > 0) {
      const e = this.pool.pop()!;
      e.type = type;
      return e;
    }
    return { id: '', type, x: 0, y: 0, radius: 0, color: '', mass: 0 };
  }
  release(e: GameEntity) {
    if (this.pool.length < 3000) {
      e.ownerId = undefined; e.vx = undefined; e.vy = undefined; e.spawnTime = undefined; e.mergeTimer = undefined;
      this.pool.push(e);
    }
  }
}
const globalEntityPool = new EntityPool();

class OptimizedGrid {
  cells: Int32Array[];
  counts: Int32Array;
  cols: number;
  constructor() {
    this.cols = Math.ceil(MAP_SIZE / GRID_CELL_SIZE);
    const totalCells = this.cols * this.cols;
    this.cells = Array.from({ length: totalCells }, () => new Int32Array(512)); 
    this.counts = new Int32Array(totalCells);
  }
  clear() { this.counts.fill(0); }
  insert(x: number, y: number, id: number) {
    const gx = Math.max(0, Math.min(this.cols - 1, (x / GRID_CELL_SIZE) | 0));
    const gy = Math.max(0, Math.min(this.cols - 1, (y / GRID_CELL_SIZE) | 0));
    const idx = gy * this.cols + gx;
    if (this.counts[idx] < 512) this.cells[idx][this.counts[idx]++] = id;
  }
  getNearbyInto(x: number, y: number, radius: number): number {
    let writeIdx = 0;
    const gx = (x / GRID_CELL_SIZE) | 0;
    const gy = (y / GRID_CELL_SIZE) | 0;
    const range = Math.max(1, Math.ceil(radius / GRID_CELL_SIZE));
    for (let ox = -range; ox <= range; ox++) {
      for (let oy = -range; oy <= range; oy++) {
        const nx = gx + ox; const ny = gy + oy;
        if (nx >= 0 && nx < this.cols && ny >= 0 && ny < this.cols) {
          const idx = ny * this.cols + nx;
          const count = this.counts[idx];
          const cellArr = this.cells[idx];
          for (let i = 0; i < count; i++) {
            if (writeIdx < NEARBY_BUFFER.length) NEARBY_BUFFER[writeIdx++] = cellArr[i];
          }
        }
      }
    }
    return writeIdx;
  }
}

const App: React.FC = () => {
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'dead'>('menu');
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('osmos_name') || 'NOMAD');
  const [uiSnapshot, setUiSnapshot] = useState({ mass: INITIAL_MASS, level: 1, exp: 0, maxExp: 100, abilityCd: 0, isThinking: false, advisorMsg: null as string | null });

  const engineRef = useRef({ entities: [] as GameEntity[] });
  const gridRef = useRef(new OptimizedGrid());
  const mouseRef = useRef({ x: 0, y: 0 });
  const lastTimeRef = useRef<number>(0);
  const accumulatorRef = useRef<number>(0);
  const cooldownRef = useRef(0);
  const activeEffectsRef = useRef<string[]>([]);
  const playerStatsRef = useRef<PlayerState>({ id: 'player', name: playerName, level: 1, exp: 0, maxExp: 100, class: CellClass.PREDATOR, mass: INITIAL_MASS, stats: CLASS_DATA[CellClass.PREDATOR].baseStats, skillPoints: 0, skills: [] });

  const biomes = useMemo<Biome[]>(() => [
    { id: '1', name: 'Toxic Mire', color: '#10b981', bounds: { x: 500, y: 500, w: 2500, h: 2500 }, effect: 'toxic' },
    { id: '2', name: 'Magma Core', color: '#ef4444', bounds: { x: 5000, y: 5000, w: 2500, h: 2500 }, effect: 'lava' },
    { id: '3', name: 'Energy Nexus', color: '#0ea5e9', bounds: { x: 3000, y: 1000, w: 2000, h: 2000 }, effect: 'nutrient' },
    { id: '4', name: 'Void Zone', color: '#6366f1', bounds: { x: 1000, y: 5000, w: 2000, h: 2500 }, effect: 'dark' },
  ], []);

  const handleDeepTacticalAnalysis = useCallback(async () => {
    if (uiSnapshot.isThinking) return;
    setUiSnapshot(prev => ({ ...prev, isThinking: true, advisorMsg: "ANALYZING BIOLOGICAL LANDSCAPE..." }));
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const p = playerStatsRef.current;
      const { entities } = engineRef.current;
      const nearbyEnemies = entities.filter(e => e.type === 'ai' && e.mass > p.mass).length;
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: `I am a ${p.class} level ${p.level} with ${Math.floor(p.mass)} mass. Nearby threats: ${nearbyEnemies}. Provide a 1-sentence cryptic survival directive.`,
        config: { thinkingConfig: { thinkingBudget: 32768 } },
      });
      setUiSnapshot(prev => ({ ...prev, advisorMsg: response.text || "CONSUME OR BE CONSUMED.", isThinking: false }));
      setTimeout(() => setUiSnapshot(prev => ({ ...prev, advisorMsg: null })), 8000);
    } catch (err) { setUiSnapshot(prev => ({ ...prev, isThinking: false, advisorMsg: "AI LINK BROKEN." })); }
  }, [uiSnapshot.isThinking]);

  const handleAbility = useCallback(() => {
    if (cooldownRef.current > 0) return;
    const cls = playerStatsRef.current.class;
    const { entities } = engineRef.current;
    
    if (cls === CellClass.ASSASSIN) {
      entities.forEach(e => {
        if (e.ownerId === 'player' || e.id === 'player') {
          const d = Math.sqrt(mouseRef.current.x**2 + mouseRef.current.y**2) || 0.001;
          e.vx = (mouseRef.current.x/d) * 55; e.vy = (mouseRef.current.y/d) * 55;
          e.mass *= 0.95; 
        }
      });
      cooldownRef.current = 180;
    } else if (cls === CellClass.TANK) {
       activeEffectsRef.current.push('FORTIFIED'); 
       cooldownRef.current = 500;
       setTimeout(() => activeEffectsRef.current = activeEffectsRef.current.filter(e => e !== 'FORTIFIED'), 5000);
    } else if (cls === CellClass.SUPPORT) {
       const p = entities.find(e => e.id === 'player' || e.ownerId === 'player');
       if (p) {
         for(let i=0; i<10; i++) {
           const f = globalEntityPool.get('food');
           f.id = `spore-${Math.random()}`; f.x = p.x + (Math.random()-0.5)*300; f.y = p.y + (Math.random()-0.5)*300;
           f.radius = 4; f.color = '#fbbf24'; f.mass = 5; entities.push(f);
         }
       }
       cooldownRef.current = 300;
    } else {
      handleDeepTacticalAnalysis();
      cooldownRef.current = 600;
    }
  }, [handleDeepTacticalAnalysis]);

  const handleSplit = useCallback(() => {
    const { entities } = engineRef.current;
    const playerCells = entities.filter(e => e.ownerId === 'player' || e.id === 'player');
    if (playerCells.length >= MAX_PLAYER_CELLS) return;

    const newCells: GameEntity[] = [];
    playerCells.forEach(cell => {
      if (cell.mass >= MIN_SPLIT_MASS && playerCells.length + newCells.length < MAX_PLAYER_CELLS) {
        const halfMass = cell.mass / 2;
        cell.mass = halfMass;
        cell.radius = Math.sqrt(halfMass) * 4;
        cell.mergeTimer = PHYSICS_TPS * 15; 

        const d = Math.sqrt(mouseRef.current.x**2 + mouseRef.current.y**2) || 0.001;
        const nx = mouseRef.current.x / d;
        const ny = mouseRef.current.y / d;

        newCells.push({
          id: `psplit-${Math.random()}`,
          type: 'player',
          ownerId: 'player',
          x: cell.x + nx * cell.radius * 2,
          y: cell.y + ny * cell.radius * 2,
          vx: nx * 45, 
          vy: ny * 45,
          radius: cell.radius,
          mass: halfMass,
          color: cell.color,
          mergeTimer: PHYSICS_TPS * 15,
          spawnTime: performance.now()
        });
      }
    });
    if (newCells.length > 0) {
      engineRef.current.entities = [...entities, ...newCells];
    }
  }, []);

  const handleEject = useCallback(() => {
    const { entities } = engineRef.current;
    const playerCells = entities.filter(e => (e.ownerId === 'player' || e.id === 'player') && e.mass > 45);
    const ejectedArr: GameEntity[] = [];
    playerCells.forEach(cell => {
      cell.mass -= 18;
      cell.radius = Math.sqrt(cell.mass) * 4;
      const d = Math.sqrt(mouseRef.current.x**2 + mouseRef.current.y**2) || 0.001;
      const nx = mouseRef.current.x / d;
      const ny = mouseRef.current.y / d;
      
      const e = globalEntityPool.get('ejected');
      e.id = `ej-${Math.random()}`;
      e.ownerId = 'player';
      e.x = cell.x + nx * (cell.radius + 15);
      e.y = cell.y + ny * (cell.radius + 15);
      e.vx = nx * 24;
      e.vy = ny * 24;
      e.radius = 12;
      e.mass = 16;
      e.color = cell.color;
      e.spawnTime = performance.now();
      e.mergeTimer = PHYSICS_TPS * 0.8; // Short 0.8s protection to prevent instant self-absorb upon birth, but allow it immediately after
      ejectedArr.push(e);
    });
    if (ejectedArr.length > 0) {
      engineRef.current.entities = [...entities, ...ejectedArr];
    }
  }, []);

  const runPhysicsTick = useCallback((tickCount: number) => {
    const { entities } = engineRef.current;
    const now = performance.now();
    const playerIndices: number[] = [];
    
    let centerMassX = 0, centerMassY = 0, totalPlayerMass = 0;
    for (let i = 0; i < entities.length; i++) {
      const ent = entities[i];
      if (ent.ownerId === 'player' || ent.id === 'player') {
        playerIndices.push(i);
        centerMassX += ent.x * ent.mass; 
        centerMassY += ent.y * ent.mass; 
        totalPlayerMass += ent.mass;
      }
    }

    const avgPlayerX = totalPlayerMass > 0 ? centerMassX / totalPlayerMass : MAP_SIZE / 2;
    const avgPlayerY = totalPlayerMass > 0 ? centerMassY / totalPlayerMass : MAP_SIZE / 2;

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (!e) continue;
      const isP = e.ownerId === 'player' || e.id === 'player';
      if (e.type === 'food' || e.type === 'virus') continue;

      if (e.mergeTimer && e.mergeTimer > 0) e.mergeTimer--;

      let speedMult = 1;
      biomes.forEach(b => {
        if (e.x > b.bounds.x && e.x < b.bounds.x + b.bounds.w && e.y > b.bounds.y && e.y < b.bounds.y + b.bounds.h) {
          if (b.effect === 'toxic') e.mass *= 0.9998;
          if (b.effect === 'lava') { e.mass *= 0.9995; speedMult = 1.25; }
          if (b.effect === 'nutrient') e.mass *= 1.0004;
        }
      });

      const stats = e.class ? CLASS_DATA[e.class].baseStats : { speed: 1 };
      let baseSpeed = (stats.speed * 8.2 * speedMult) / (1 + Math.sqrt(e.mass) / 15);
      
      if (activeEffectsRef.current.includes('FORTIFIED') && isP) {
        baseSpeed *= 0.4;
        e.mass *= 1.0005;
      }

      if (e.type === 'ejected') {
        e.x += e.vx || 0; e.y += e.vy || 0;
        if (e.vx) e.vx *= 0.92; if (e.vy) e.vy *= 0.92;
      } else if (isP) {
        const dxMouse = mouseRef.current.x, dyMouse = mouseRef.current.y;
        const dMouse = Math.sqrt(dxMouse*dxMouse + dyMouse*dyMouse) || 0.001;
        
        const dxCenter = avgPlayerX - e.x, dyCenter = avgPlayerY - e.y;
        const distCenter = Math.sqrt(dxCenter*dxCenter + dyCenter*dyCenter) || 0.001;
        const cohesionStrength = distCenter > e.radius * 2 ? 0.08 : 0.02;

        e.x += (e.vx || 0); e.y += (e.vy || 0);
        if (e.vx) e.vx *= 0.88; if (e.vy) e.vy *= 0.88;

        if (dMouse > 5) {
          e.x += (dxMouse / dMouse) * baseSpeed;
          e.y += (dyMouse / dMouse) * baseSpeed;
        }

        e.x += (dxCenter / distCenter) * baseSpeed * cohesionStrength;
        e.y += (dyCenter / distCenter) * baseSpeed * cohesionStrength;
      } else if (e.type === 'ai') {
        if (tickCount % 10 === 0 || !e.behavior) {
          const personality = e.personality || PERSONALITIES.BALANCED;
          const visionRadius = 1600;
          const count = gridRef.current.getNearbyInto(e.x, e.y, visionRadius);
          
          let bestTarget = null;
          let maxHuntScore = -Infinity;
          let dangerX = 0, dangerY = 0, dangerCount = 0;
          let foodX = 0, foodY = 0, foodCount = 0;

          for (let k = 0; k < count; k++) {
            const idx = NEARBY_BUFFER[k];
            const other = entities[idx];
            if (!other || idx === i) continue;

            const dist = Math.hypot(other.x - e.x, other.y - e.y) || 1;
            if ((other.type === 'ai' || other.ownerId === 'player' || other.id === 'player') && other.mass > e.mass * personality.fleeMargin) {
              dangerX += (e.x - other.x) / dist; dangerY += (e.y - other.y) / dist;
              dangerCount++;
            }
            if ((other.type === 'ai' || other.ownerId === 'player' || other.id === 'player') && e.mass > other.mass * 1.3) {
              const huntScore = (other.mass / dist) * personality.aggro;
              if (huntScore > maxHuntScore) { maxHuntScore = huntScore; bestTarget = other; }
            }
            if (other.type === 'food') { foodX += other.x; foodY += other.y; foodCount++; }
          }

          if (dangerCount > 0) {
            e.behavior = 'flee'; e.targetId = undefined;
            e.vx = (dangerX / dangerCount) * baseSpeed; e.vy = (dangerY / dangerCount) * baseSpeed;
          } else if (bestTarget && maxHuntScore > 0.1) {
            e.behavior = 'hunt'; e.targetId = bestTarget.id;
          } else if (foodCount > 5) {
            e.behavior = 'idle';
            e.vx = (foodX / foodCount - e.x) * 0.05; e.vy = (foodY / foodCount - e.y) * 0.05;
          } else {
            e.behavior = 'idle';
            if (Math.random() < 0.05) { e.vx = (Math.random()-0.5)*15; e.vy = (Math.random()-0.5)*15; }
          }
        }

        if (e.behavior === 'flee' || e.behavior === 'idle') {
          e.x += e.vx || 0; e.y += e.vy || 0;
        } else if (e.behavior === 'hunt' && e.targetId) {
          let tx = e.x, ty = e.y;
          if (e.targetId === 'player') { tx = avgPlayerX; ty = avgPlayerY; }
          else {
            const tEnt = entities.find(ent => ent.id === e.targetId);
            if (tEnt) { tx = tEnt.x; ty = tEnt.y; } else e.behavior = 'idle';
          }
          const dx = tx - e.x, dy = ty - e.y;
          const d = Math.hypot(dx, dy) || 1;
          e.x += (dx / d) * baseSpeed; e.y += (dy / d) * baseSpeed;
        }
      }
      e.x = Math.max(0, Math.min(MAP_SIZE, e.x)); e.y = Math.max(0, Math.min(MAP_SIZE, e.y));
      e.radius = Math.sqrt(e.mass) * 4;
    }

    for (let a = 0; a < playerIndices.length; a++) {
      const ea = entities[playerIndices[a]];
      if (!ea) continue;
      for (let b = a + 1; b < playerIndices.length; b++) {
        const eb = entities[playerIndices[b]];
        if (!eb) continue;
        const dx = ea.x - eb.x, dy = ea.y - eb.y;
        const distSq = dx*dx + dy*dy, min = ea.radius + eb.radius;
        if (distSq < min * min) {
          const dist = Math.sqrt(distSq) || 0.001;
          const force = (min - dist) * ( (ea.mergeTimer === 0 && eb.mergeTimer === 0) ? 0.02 : 0.4 );
          ea.x += (dx / dist) * force; ea.y += (dy / dist) * force;
          eb.x -= (dx / dist) * force; eb.y -= (dy / dist) * force;
        }
      }
    }

    gridRef.current.clear();
    for(let i=0; i<entities.length; i++) gridRef.current.insert(entities[i].x, entities[i].y, i);

    const deadSet = new Set<number>();
    let xpGain = 0;
    for (let i = 0; i < entities.length; i++) {
      const a = entities[i];
      if (!a || deadSet.has(i)) continue;
      if (a.type === 'ejected' && a.spawnTime && now - a.spawnTime > EJECTED_TTL) { deadSet.add(i); continue; }
      if (a.type !== 'player' && a.type !== 'ai' && a.type !== 'virus' && a.type !== 'ejected') continue;
      
      const count = gridRef.current.getNearbyInto(a.x, a.y, a.radius);
      for (let k = 0; k < count; k++) {
        const j = NEARBY_BUFFER[k]; if (i === j || deadSet.has(j)) continue;
        const b = entities[j];
        if (!b) continue;
        
        const distSq = (a.x-b.x)**2 + (a.y-b.y)**2;
        // Collision threshold for eating
        if (distSq < (a.radius * 0.95)**2 && a.mass > b.mass * 1.1) {
          const isPlayerA = a.ownerId === 'player' || a.id === 'player';
          const isPlayerB = b.ownerId === 'player' || b.id === 'player';
          
          if (isPlayerA && isPlayerB) {
            if ((a.mergeTimer || 0) <= 0 && (b.mergeTimer || 0) <= 0) {
              a.mass += b.mass; deadSet.add(j);
            }
          } else if (isPlayerA && b.type === 'ejected') {
            // Player can eat ejected mass (including their own) after short mergeTimer
            if ((b.mergeTimer || 0) <= 0) {
              a.mass += b.mass; deadSet.add(j);
            }
          } else {
            a.mass += b.mass; deadSet.add(j);
            if (isPlayerA) xpGain += Math.floor(b.mass * 1.5);
          }
        }
      }
    }

    if (cooldownRef.current > 0) cooldownRef.current--;
    if (deadSet.size > 0) {
      engineRef.current.entities = entities.filter((e, idx) => {
        if (deadSet.has(idx)) {
          if (e.type === 'food') { e.x = Math.random()*MAP_SIZE; e.y = Math.random()*MAP_SIZE; return true; }
          if (e.type === 'ejected') globalEntityPool.release(e);
          return false;
        }
        return true;
      });
      if (engineRef.current.entities.findIndex(e => e.id === 'player' || e.ownerId === 'player') === -1) setGameState('dead');
    }
    
    const p = playerStatsRef.current;
    p.mass = totalPlayerMass; p.exp += xpGain;
    while (p.exp >= p.maxExp) { p.exp -= p.maxExp; p.level++; p.maxExp = Math.floor(p.maxExp * 2.1); }
  }, [biomes]);

  useEffect(() => {
    if (gameState !== 'playing') return;
    let frameId: number, tickCount = 0;
    const update = (time: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = time;
      accumulatorRef.current += Math.min(100, time - lastTimeRef.current);
      lastTimeRef.current = time;
      while (accumulatorRef.current >= MS_PER_TICK) {
        runPhysicsTick(tickCount++);
        accumulatorRef.current -= MS_PER_TICK;
      }
      frameId = requestAnimationFrame(update);
    };
    frameId = requestAnimationFrame(update);
    const uiInterval = setInterval(() => {
      setUiSnapshot(prev => ({ ...prev, mass: playerStatsRef.current.mass, level: playerStatsRef.current.level, exp: playerStatsRef.current.exp, maxExp: playerStatsRef.current.maxExp, abilityCd: cooldownRef.current }));
    }, 100);
    return () => { cancelAnimationFrame(frameId); clearInterval(uiInterval); };
  }, [gameState, runPhysicsTick]);

  useEffect(() => {
    if (gameState !== 'playing') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') handleSplit();
      if (e.code === 'KeyW') handleEject();
      if (e.code === 'KeyQ') handleAbility();
      if (e.code === 'KeyR') handleDeepTacticalAnalysis();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gameState, handleSplit, handleEject, handleAbility, handleDeepTacticalAnalysis]);

  const initWorld = (selectedClass: CellClass) => {
    const ents: GameEntity[] = [];
    ents.push({ id: 'player', type: 'player', x: MAP_SIZE / 2, y: MAP_SIZE / 2, radius: Math.sqrt(INITIAL_MASS) * 4, color: CLASS_DATA[selectedClass].color, mass: INITIAL_MASS, class: selectedClass, mergeTimer: 0 });
    for (let i = 0; i < FOOD_COUNT; i++) {
      const f = globalEntityPool.get('food');
      f.id = `f-${i}`; f.x = Math.random()*MAP_SIZE; f.y = Math.random()*MAP_SIZE; f.radius = 3; f.color = '#475569'; f.mass = 1; ents.push(f);
    }
    for (let i = 0; i < AI_COUNT; i++) {
      const cls = Object.values(CellClass)[Math.floor(Math.random() * 5)] as CellClass;
      const persKeys = Object.keys(PERSONALITIES);
      const personality = PERSONALITIES[persKeys[Math.floor(Math.random()*persKeys.length)] as keyof typeof PERSONALITIES];
      ents.push({ id: `ai-${i}`, type: 'ai', x: Math.random()*MAP_SIZE, y: Math.random()*MAP_SIZE, radius: 20, color: CLASS_DATA[cls].color, mass: 80 + Math.random()*1200, class: cls, personality });
    }
    for (let i = 0; i < VIRUS_COUNT; i++) ents.push({ id: `v-${i}`, type: 'virus', x: Math.random()*MAP_SIZE, y: Math.random()*MAP_SIZE, radius: 65, color: '#22c55e', mass: 100 });
    engineRef.current.entities = ents;
  };

  return (
    <div className="w-screen h-screen bg-[#020617] overflow-hidden font-inter select-none relative">
      {gameState === 'playing' ? (
        <>
          <GameCanvas player={playerStatsRef.current} engineRef={engineRef as any} biomes={biomes} activeEffects={activeEffectsRef.current} onMove={(x, y) => mouseRef.current = { x, y }} />
          <div className="absolute top-6 right-6 flex flex-col items-end gap-4 pointer-events-none">
             <div className="glass px-8 py-5 rounded-[32px] border-emerald-500/20 shadow-2xl">
                <div className="text-[10px] text-emerald-500/60 font-black uppercase tracking-[0.3em] mb-1 text-right">Biomass Units</div>
                <div className="font-orbitron text-4xl text-emerald-400 font-black text-right tracking-tighter">{Math.floor(uiSnapshot.mass)}</div>
             </div>
          </div>
          <div className="absolute top-6 left-6 flex flex-col gap-6 pointer-events-none">
            <div className="glass px-8 py-6 rounded-[32px] w-80 shadow-2xl border-white/10">
              <div className="flex justify-between items-end mb-3">
                <div className="flex flex-col">
                  <span className="text-[10px] text-white/30 font-black uppercase tracking-[0.3em]">Operator</span>
                  <h2 className="font-orbitron font-black text-white text-xl tracking-tight leading-none">{playerStatsRef.current.name}</h2>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] text-indigo-400 font-black uppercase tracking-widest">Level</span>
                  <span className="font-orbitron text-2xl font-black text-indigo-300 leading-none">{uiSnapshot.level}</span>
                </div>
              </div>
              <div className="w-full h-2 bg-slate-950/50 rounded-full overflow-hidden border border-white/5 relative">
                <div className="h-full bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.5)] transition-all duration-700 ease-out" style={{ width: `${(uiSnapshot.exp/uiSnapshot.maxExp)*100}%` }} />
              </div>
            </div>
            {uiSnapshot.advisorMsg && (
              <div className="glass p-6 rounded-[32px] w-80 text-[12px] leading-relaxed text-indigo-100 border-indigo-500/30 italic animate-in fade-in slide-in-from-top-4 duration-500 backdrop-blur-[24px] shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500" />
                <span className="opacity-80">"{uiSnapshot.advisorMsg}"</span>
                {uiSnapshot.isThinking && <div className="mt-2 text-[10px] text-indigo-400 animate-pulse font-black uppercase tracking-widest">Recalibrating Strategy...</div>}
              </div>
            )}
          </div>
          <div className="absolute bottom-10 left-10 flex flex-col gap-4 pointer-events-auto">
             <ChatBot />
             <div className="flex gap-4">
               <div className="flex flex-col items-center">
                 <button className={`glass w-14 h-14 rounded-2xl flex items-center justify-center font-orbitron font-black border-white/20 text-white relative ${uiSnapshot.abilityCd > 0 ? 'opacity-40 grayscale' : 'hover:scale-110 hover:border-indigo-500 cursor-pointer shadow-indigo-500/20 shadow-xl'}`} onClick={handleAbility}>
                   Q
                   {uiSnapshot.abilityCd > 0 && <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-2xl text-[10px]">{Math.ceil(uiSnapshot.abilityCd/60)}s</div>}
                 </button>
                 <span className="text-[9px] font-orbitron text-white/40 mt-2 uppercase tracking-widest">Skill</span>
               </div>
               <div className="flex flex-col items-center">
                 <button className="glass w-14 h-14 rounded-2xl flex items-center justify-center font-orbitron font-black border-white/20 text-white hover:scale-110 hover:border-emerald-500 cursor-pointer shadow-emerald-500/20 shadow-xl" onClick={handleEject}>W</button>
                 <span className="text-[9px] font-orbitron text-white/40 mt-2 uppercase tracking-widest">Eject</span>
               </div>
               <div className="flex flex-col items-center">
                 <button className="glass w-24 h-14 rounded-2xl flex items-center justify-center font-orbitron font-black border-white/20 text-white hover:scale-105 hover:border-amber-500 cursor-pointer shadow-amber-500/20 shadow-xl" onClick={handleSplit}>SPACE</button>
                 <span className="text-[9px] font-orbitron text-white/40 mt-2 uppercase tracking-widest">Split</span>
               </div>
             </div>
          </div>
          <div className="absolute bottom-10 right-10">
            <Minimap player={playerStatsRef.current} entities={engineRef.current.entities} biomes={biomes} />
          </div>
        </>
      ) : gameState === 'menu' ? (
        <div className="flex flex-col items-center justify-center h-full text-center p-8 animate-in fade-in duration-1000">
          <h1 className="font-orbitron text-[130px] font-black text-white italic tracking-tighter leading-none mb-4">OSMOS</h1>
          <p className="text-indigo-400 font-orbitron text-[11px] tracking-[1.6em] uppercase mb-16 opacity-70 font-black">Evolutionary Apex Arena</p>
          <div className="glass p-1 rounded-full mb-12 border-white/5">
             <input className="bg-transparent px-10 py-6 rounded-full text-center font-orbitron text-2xl w-[500px] outline-none text-white placeholder:text-white/10 uppercase tracking-[0.2em]" placeholder="Identity Operator" value={playerName} onChange={e => setPlayerName(e.target.value.toUpperCase())} maxLength={12} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 max-w-7xl">
            {(Object.keys(CLASS_DATA) as CellClass[]).map(cls => (
              <button key={cls} onClick={() => { playerStatsRef.current.class = cls; playerStatsRef.current.name = playerName; initWorld(cls); setGameState('playing'); }} className="glass p-8 rounded-[40px] hover:bg-white/10 transition-all flex flex-col items-center group border-white/5">
                <div className="w-14 h-14 rounded-full mb-6 group-hover:scale-125 transition-all shadow-2xl relative" style={{ background: CLASS_DATA[cls].color }}>
                   <div className="absolute inset-0 rounded-full bg-inherit blur-md opacity-40 group-hover:opacity-100" />
                </div>
                <span className="text-[11px] font-orbitron font-black text-white tracking-[0.4em] uppercase">{cls}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-full text-center p-8">
          <h2 className="font-orbitron text-9xl font-black text-red-600 italic tracking-tighter mb-4">CONSUMED</h2>
          <button onClick={() => setGameState('menu')} className="glass px-20 py-8 rounded-[48px] font-orbitron font-black text-white hover:bg-white/10 tracking-[0.5em] text-2xl border-white/20 transition-all hover:scale-105">RE-EVOLVE</button>
        </div>
      )}
    </div>
  );
};
export default App;
