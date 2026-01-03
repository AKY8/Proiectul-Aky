
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { Minimap } from './components/Minimap';
import { PlayerState, CellClass, GameEntity, Biome } from './types';
import { INITIAL_MASS, CLASS_DATA, MAP_SIZE, FOOD_COUNT, AI_COUNT } from './constants';
import { GoogleGenAI } from "@google/genai";

const PHYSICS_TPS = 60;
const MS_PER_TICK = 1000 / PHYSICS_TPS;
const MAX_TICKS_PER_FRAME = 5; 
const GRID_CELL_SIZE = 500;
const MIN_SPLIT_MASS = 35;
const VIRUS_COUNT = 15;

class OptimizedGrid {
  cells: Int32Array[];
  counts: Int32Array;
  cols: number;

  constructor() {
    this.cols = Math.ceil(MAP_SIZE / GRID_CELL_SIZE);
    const totalCells = this.cols * this.cols;
    this.cells = Array.from({ length: totalCells }, () => new Int32Array(300)); 
    this.counts = new Int32Array(totalCells);
  }

  clear() {
    this.counts.fill(0);
  }

  insert(x: number, y: number, id: number) {
    const gx = Math.max(0, Math.min(this.cols - 1, (x / GRID_CELL_SIZE) | 0));
    const gy = Math.max(0, Math.min(this.cols - 1, (y / GRID_CELL_SIZE) | 0));
    const idx = gy * this.cols + gx;
    if (this.counts[idx] < 300) {
      this.cells[idx][this.counts[idx]++] = id;
    }
  }

  getNearby(x: number, y: number, radius: number): number[] {
    const results: number[] = [];
    const gx = (x / GRID_CELL_SIZE) | 0;
    const gy = (y / GRID_CELL_SIZE) | 0;
    const range = Math.ceil(radius / GRID_CELL_SIZE);

    for (let ox = -range; ox <= range; ox++) {
      for (let oy = -range; oy <= range; oy++) {
        const nx = gx + ox;
        const ny = gy + oy;
        if (nx >= 0 && nx < this.cols && ny >= 0 && ny < this.cols) {
          const idx = ny * this.cols + nx;
          for (let i = 0; i < this.counts[idx]; i++) {
            results.push(this.cells[idx][i]);
          }
        }
      }
    }
    return results;
  }
}

const App: React.FC = () => {
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'dead'>('menu');
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('osmos_name') || 'NOMAD');
  const [isThinking, setIsThinking] = useState(false);
  const [advisorMessage, setAdvisorMessage] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<{name: string, mass: number}[]>([]);
  
  const engineRef = useRef({ entities: [] as GameEntity[], playerIdx: -1 });
  const gridRef = useRef(new OptimizedGrid());
  const mouseRef = useRef({ x: 0, y: 0 });
  const lastTimeRef = useRef<number>(0);
  const accumulatorRef = useRef<number>(0);
  
  const [uiPlayer, setUiPlayer] = useState<PlayerState>({
    id: 'player', name: playerName, level: 1, exp: 0, maxExp: 100,
    class: CellClass.PREDATOR, mass: INITIAL_MASS,
    stats: CLASS_DATA[CellClass.PREDATOR].baseStats, skillPoints: 0, skills: []
  });

  const biomes = useMemo<Biome[]>(() => [
    { id: '1', name: 'Toxic Mire', color: '#10b981', bounds: { x: 500, y: 500, w: 2500, h: 2500 }, effect: 'toxic' },
    { id: '2', name: 'Magma Core', color: '#ef4444', bounds: { x: 5000, y: 5000, w: 2500, h: 2500 }, effect: 'lava' },
    { id: '3', name: 'Energy Nexus', color: '#0ea5e9', bounds: { x: 3000, y: 1000, w: 2000, h: 2000 }, effect: 'nutrient' },
  ], []);

  const requestAdvice = async () => {
    if (isThinking) return;
    setIsThinking(true);
    setAdvisorMessage("AI Strategist thinking...");

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      // Using gemini-3-pro-preview with thinkingBudget 32768 for deep strategy
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: `Status: Level ${uiPlayer.level} ${uiPlayer.class}. Mass: ${Math.floor(uiPlayer.mass)}. 
        Context: Arena split-mechanics enabled. Multiple cells can be controlled. Viruses present.
        Objective: Suggest a high-level split-kill or viral-baiting tactic for Osmos Prime. Tone: Cyber-Tactician. Max 20 words.`,
        config: { thinkingConfig: { thinkingBudget: 32768 } },
      });
      setAdvisorMessage(response.text?.trim() || "Stay alert.");
    } catch {
      setAdvisorMessage("Link severed.");
    } finally {
      setIsThinking(false);
      setTimeout(() => setAdvisorMessage(null), 10000);
    }
  };

  const handleSplit = useCallback(() => {
    const { entities } = engineRef.current;
    const playerCells = entities.filter(e => e.ownerId === 'player' || e.id === 'player');
    if (playerCells.length >= 16) return;

    const newCells: GameEntity[] = [];
    playerCells.forEach(cell => {
      if (cell.mass >= MIN_SPLIT_MASS) {
        const halfMass = cell.mass / 2;
        cell.mass = halfMass;
        cell.radius = Math.sqrt(cell.mass) * 4;
        cell.mergeTimer = PHYSICS_TPS * 15; // 15 seconds cooldown

        const dx = mouseRef.current.x, dy = mouseRef.current.y;
        const d = Math.sqrt(dx*dx + dy*dy) || 1;
        
        newCells.push({
          id: `player-split-${Math.random()}`,
          type: 'player',
          ownerId: 'player',
          x: cell.x + (dx / d) * cell.radius,
          y: cell.y + (dy / d) * cell.radius,
          radius: cell.radius,
          mass: halfMass,
          color: cell.color,
          class: cell.class,
          mergeTimer: PHYSICS_TPS * 15
        });
      }
    });
    engineRef.current.entities = [...entities, ...newCells];
  }, []);

  const handleEject = useCallback(() => {
    const { entities } = engineRef.current;
    const playerCells = entities.filter(e => e.ownerId === 'player' || e.id === 'player');
    
    const ejected: GameEntity[] = [];
    playerCells.forEach(cell => {
      if (cell.mass > 30) {
        const ejectMass = 12;
        cell.mass -= ejectMass;
        cell.radius = Math.sqrt(cell.mass) * 4;

        const dx = mouseRef.current.x, dy = mouseRef.current.y;
        const d = Math.sqrt(dx*dx + dy*dy) || 1;

        ejected.push({
          id: `eject-${Math.random()}`,
          type: 'ejected',
          ownerId: 'player',
          x: cell.x + (dx / d) * (cell.radius + 10),
          y: cell.y + (dy / d) * (cell.radius + 10),
          radius: 8,
          mass: ejectMass,
          color: cell.color
        });
      }
    });
    engineRef.current.entities = [...entities, ...ejected];
  }, []);

  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if (gameState !== 'playing') return;
      if (e.code === 'Space') handleSplit();
      if (e.code === 'KeyW') handleEject();
    };
    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, [gameState, handleSplit, handleEject]);

  const initWorld = (selectedClass: CellClass) => {
    const ents: GameEntity[] = [];
    ents.push({
      id: 'player', type: 'player', x: MAP_SIZE / 2, y: MAP_SIZE / 2,
      radius: Math.sqrt(INITIAL_MASS) * 4, color: CLASS_DATA[selectedClass].color,
      mass: INITIAL_MASS, class: selectedClass, mergeTimer: 0
    });
    for (let i = 0; i < FOOD_COUNT; i++) {
      ents.push({ id: `f-${i}`, type: 'food', x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE, radius: 3, color: '#334155', mass: 1 });
    }
    for (let i = 0; i < AI_COUNT; i++) {
      const cls = Object.values(CellClass)[Math.floor(Math.random() * 5)] as CellClass;
      ents.push({ id: `ai-${i}`, type: 'ai', x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE, radius: 20, color: CLASS_DATA[cls].color, mass: 40 + Math.random() * 250, class: cls });
    }
    for (let i = 0; i < VIRUS_COUNT; i++) {
      ents.push({ id: `v-${i}`, type: 'virus', x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE, radius: 60, color: '#22c55e', mass: 100 });
    }
    engineRef.current = { entities: ents, playerIdx: 0 };
  };

  const runPhysicsTick = useCallback(() => {
    const { entities } = engineRef.current;
    const playerCells = entities.filter(e => e.ownerId === 'player' || e.id === 'player');
    if (playerCells.length === 0) return;

    // 1. Move Actors
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.type === 'food' || e.type === 'virus') continue;
      
      const stats = e.class ? CLASS_DATA[e.class].baseStats : { speed: 1 };
      const speedMult = e.type === 'ejected' ? 12 : (stats.speed * 9) / (1 + Math.sqrt(e.mass) / 10);

      if (e.ownerId === 'player' || e.id === 'player') {
        const dx = mouseRef.current.x, dy = mouseRef.current.y;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d > 5) {
          e.x += (dx / d) * speedMult;
          e.y += (dy / d) * speedMult;
        }
        if (e.mergeTimer && e.mergeTimer > 0) e.mergeTimer--;
      } else if (e.type === 'ai') {
        const center = playerCells[0];
        const dist = Math.hypot(center.x - e.x, center.y - e.y);
        if (dist < 1500) {
          const angle = Math.atan2(center.y - e.y, center.x - e.x);
          const factor = e.mass > center.mass * 1.1 ? 0.7 : -0.8;
          e.x += Math.cos(angle) * speedMult * factor;
          e.y += Math.sin(angle) * speedMult * factor;
        }
      }
      e.x = Math.max(0, Math.min(MAP_SIZE, e.x));
      e.y = Math.max(0, Math.min(MAP_SIZE, e.y));
      e.radius = Math.sqrt(e.mass) * 4;
      e.mass *= 0.99995; 
    }

    // 2. Spatial Sync
    gridRef.current.clear();
    for(let i=0; i<entities.length; i++) {
      gridRef.current.insert(entities[i].x, entities[i].y, i);
    }

    // 3. Collisions & Logic
    const deadSet = new Set<number>();
    const virusFragments: GameEntity[] = [];
    let xpGain = 0;
    let totalPlayerMass = 0;

    for (let i = 0; i < entities.length; i++) {
      const a = entities[i];
      if (deadSet.has(i)) continue;
      
      if (a.ownerId === 'player' || a.id === 'player') totalPlayerMass += a.mass;

      const nearby = gridRef.current.getNearby(a.x, a.y, a.radius);
      for (const j of nearby) {
        if (i === j || deadSet.has(j)) continue;
        const b = entities[j];
        const distSq = (a.x - b.x)**2 + (a.y - b.y)**2;
        const combinedRadius = a.radius + b.radius;
        
        // Virus interaction
        if (a.type === 'virus' && b.type === 'ejected') {
           a.mass += b.mass;
           deadSet.add(j);
           if (a.mass > 250) { // Virus split!
             a.mass = 100;
             virusFragments.push({ id: `v-frag-${Math.random()}`, type: 'virus', x: a.x + 50, y: a.y + 50, radius: 60, mass: 100, color: a.color });
           }
           continue;
        }

        if (distSq < (a.radius * 0.95)**2) {
          // Virus explosion
          if (b.type === 'virus' && a.mass > b.mass * 1.2 && (a.id === 'player' || a.ownerId === 'player')) {
             deadSet.add(j); // Consume virus
             const fragments = Math.min(10, Math.floor(a.mass / 20));
             const fragMass = a.mass / fragments;
             a.mass = fragMass;
             for(let k=0; k<fragments-1; k++) {
                virusFragments.push({
                   id: `split-v-${Math.random()}`, type: 'player', ownerId: 'player',
                   x: a.x + (Math.random() - 0.5) * 100, y: a.y + (Math.random() - 0.5) * 100,
                   radius: Math.sqrt(fragMass)*4, mass: fragMass, color: a.color, mergeTimer: PHYSICS_TPS * 20
                });
             }
             continue;
          }

          // Eating logic
          if (a.mass > b.mass * 1.15) {
            // Sibling merge check
            const isSibling = (a.ownerId === b.ownerId && a.ownerId !== undefined) || (a.id === 'player' && b.ownerId === 'player') || (b.id === 'player' && a.ownerId === 'player');
            if (isSibling) {
              if ((a.mergeTimer || 0) <= 0 && (b.mergeTimer || 0) <= 0) {
                 a.mass += b.mass;
                 deadSet.add(j);
              }
            } else {
              a.mass += b.mass;
              deadSet.add(j);
              if (a.id === 'player' || a.ownerId === 'player') xpGain += Math.floor(b.mass * 2);
            }
          }
        }
      }
    }

    // 4. Update Stats & Leaderboard
    if (Date.now() % 1000 < 20) {
      const top = entities
        .filter(e => e.type === 'player' || e.type === 'ai')
        .reduce((acc, curr) => {
           const name = curr.id === 'player' || curr.ownerId === 'player' ? uiPlayer.name : (curr.class || 'BOT');
           acc[name] = (acc[name] || 0) + curr.mass;
           return acc;
        }, {} as Record<string, number>);
      
      setLeaderboard(Object.entries(top)
        .sort((a,b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, mass]) => ({ name, mass: Math.floor(mass) })));
    }

    if (xpGain > 0 || Math.floor(totalPlayerMass) !== Math.floor(uiPlayer.mass)) {
      setUiPlayer(prev => {
        let nExp = prev.exp + xpGain, nLvl = prev.level, nMax = prev.maxExp;
        while (nExp >= nMax) { nExp -= nMax; nLvl++; nMax = Math.floor(nMax * 1.4); }
        return { ...prev, exp: nExp, level: nLvl, maxExp: nMax, mass: totalPlayerMass };
      });
    }

    if (deadSet.size > 0 || virusFragments.length > 0) {
      let nextEnts = entities.filter((e, idx) => {
        if (!deadSet.has(idx)) return true;
        if (e.type === 'food') {
           e.x = Math.random() * MAP_SIZE; e.y = Math.random() * MAP_SIZE; return true;
        }
        return false;
      });
      engineRef.current.entities = [...nextEnts, ...virusFragments];
      engineRef.current.playerIdx = engineRef.current.entities.findIndex(e => e.id === 'player' || e.ownerId === 'player');
      if (engineRef.current.playerIdx === -1) setGameState('dead');
    }
  }, [uiPlayer.mass, uiPlayer.name]);

  useEffect(() => {
    if (gameState !== 'playing') return;
    let id: number;
    const loop = (time: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = time;
      accumulatorRef.current += Math.min(100, time - lastTimeRef.current);
      lastTimeRef.current = time;
      let ticks = 0;
      while (accumulatorRef.current >= MS_PER_TICK && ticks < MAX_TICKS_PER_FRAME) {
        runPhysicsTick();
        accumulatorRef.current -= MS_PER_TICK;
        ticks++;
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [gameState, runPhysicsTick]);

  const startGame = (cls: CellClass) => {
    setUiPlayer(p => ({ ...p, name: playerName, class: cls, stats: CLASS_DATA[cls].baseStats, mass: INITIAL_MASS, level: 1, exp: 0, maxExp: 100 }));
    initWorld(cls);
    setGameState('playing');
    lastTimeRef.current = 0;
  };

  return (
    <div className="w-screen h-screen bg-[#020617] overflow-hidden font-inter select-none">
      {gameState === 'playing' ? (
        <>
          <GameCanvas player={uiPlayer} engineRef={engineRef as any} biomes={biomes} onMove={(x, y) => mouseRef.current = { x, y }} />
          
          {/* Leaderboard */}
          <div className="absolute top-8 right-8 flex flex-col items-end gap-4 pointer-events-none">
             <div className="glass p-5 rounded-3xl w-56 border-white/5 shadow-2xl">
                <h3 className="font-orbitron text-[10px] text-indigo-400 font-black tracking-widest uppercase mb-3 border-b border-white/10 pb-2">Apex Entities</h3>
                {leaderboard.map((entry, i) => (
                  <div key={i} className="flex justify-between items-center mb-1">
                    <span className={`text-[11px] font-bold ${entry.name === uiPlayer.name ? 'text-white' : 'text-white/40'}`}>{i+1}. {entry.name}</span>
                    <span className="text-[10px] font-orbitron text-white/60">{entry.mass}</span>
                  </div>
                ))}
             </div>
             <div className="glass px-6 py-4 rounded-3xl border-emerald-500/20 shadow-xl">
                <div className="text-[10px] text-emerald-500/60 font-black uppercase tracking-widest mb-1 text-right">Aggregate Mass</div>
                <div className="font-orbitron text-3xl text-emerald-400 font-black text-right">{Math.floor(uiPlayer.mass)}</div>
             </div>
          </div>

          <div className="absolute top-8 left-8 flex flex-col gap-4 pointer-events-none">
            <div className="glass px-6 py-5 rounded-3xl w-72 shadow-2xl border-white/5">
              <div className="flex justify-between items-center mb-2">
                <h2 className="font-orbitron font-black text-white">{uiPlayer.name}</h2>
                <span className="text-xs font-black text-indigo-400">LVL {uiPlayer.level}</span>
              </div>
              <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 transition-all" style={{ width: `${(uiPlayer.exp/uiPlayer.maxExp)*100}%` }} />
              </div>
            </div>
            <button onClick={requestAdvice} disabled={isThinking} className="pointer-events-auto glass px-4 py-3 rounded-2xl flex items-center gap-2 hover:bg-white/5 transition-all w-fit">
              <div className={`w-2 h-2 rounded-full ${isThinking ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
              <span className="text-[10px] font-orbitron tracking-widest text-white uppercase">{isThinking ? 'Processing...' : 'Neural Advice'}</span>
            </button>
            {advisorMessage && (
              <div className="glass p-4 rounded-2xl w-72 text-[11px] text-indigo-200 border-indigo-500/20 italic animate-in fade-in slide-in-from-left-4">
                "{advisorMessage}"
              </div>
            )}
          </div>

          <div className="absolute bottom-8 left-8 flex gap-3">
             <div className="glass px-4 py-2 rounded-xl text-[10px] font-orbitron text-white/40 uppercase tracking-tighter">[SPACE] SPLIT</div>
             <div className="glass px-4 py-2 rounded-xl text-[10px] font-orbitron text-white/40 uppercase tracking-tighter">[W] EJECT</div>
          </div>

          <div className="absolute bottom-8 right-8">
            <Minimap player={uiPlayer} entities={engineRef.current.entities} biomes={biomes} />
          </div>
        </>
      ) : gameState === 'menu' ? (
        <div className="flex flex-col items-center justify-center h-full text-center p-6">
          <h1 className="font-orbitron text-8xl font-black text-white italic tracking-tighter mb-2">OSMOS</h1>
          <p className="text-indigo-400 font-orbitron text-xs tracking-[1em] uppercase mb-12">Prime Arena</p>
          <input className="bg-slate-900/50 p-6 rounded-2xl text-center font-orbitron text-xl w-80 outline-none text-white border border-white/5 mb-8 focus:border-indigo-500/50 transition-all" placeholder="IDENTIFY" value={playerName} onChange={e => setPlayerName(e.target.value.toUpperCase())} />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {(Object.keys(CLASS_DATA) as CellClass[]).map(cls => (
              <button key={cls} onClick={() => startGame(cls)} className="glass p-6 rounded-3xl hover:bg-white/5 transition-all group">
                <div className="w-12 h-12 rounded-full mx-auto mb-4 group-hover:scale-110 transition-transform" style={{ background: CLASS_DATA[cls].color }} />
                <span className="text-[10px] font-orbitron font-black text-white tracking-widest">{cls}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-full text-center">
          <h2 className="font-orbitron text-6xl font-black text-red-500 italic mb-8">CONSUMED</h2>
          <button onClick={() => setGameState('menu')} className="glass px-12 py-6 rounded-3xl font-orbitron font-black text-white hover:bg-white/5">RESTART</button>
        </div>
      )}
    </div>
  );
};

export default App;
