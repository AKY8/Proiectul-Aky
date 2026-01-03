
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
const VIRUS_COUNT = 25;
const MAX_PLAYER_CELLS = 16;
const EJECT_COOLDOWN = 100;

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

  clear() {
    this.counts.fill(0);
  }

  insert(x: number, y: number, id: number) {
    const gx = Math.max(0, Math.min(this.cols - 1, (x / GRID_CELL_SIZE) | 0));
    const gy = Math.max(0, Math.min(this.cols - 1, (y / GRID_CELL_SIZE) | 0));
    const idx = gy * this.cols + gx;
    if (this.counts[idx] < 512) {
      this.cells[idx][this.counts[idx]++] = id;
    }
  }

  getNearby(x: number, y: number, radius: number): number[] {
    const results: number[] = [];
    const gx = (x / GRID_CELL_SIZE) | 0;
    const gy = (y / GRID_CELL_SIZE) | 0;
    const range = Math.max(1, Math.ceil(radius / GRID_CELL_SIZE));

    for (let ox = -range; ox <= range; ox++) {
      for (let oy = -range; oy <= range; oy++) {
        const nx = gx + ox;
        const ny = gy + oy;
        if (nx >= 0 && nx < this.cols && ny >= 0 && ny < this.cols) {
          const idx = ny * this.cols + nx;
          const count = this.counts[idx];
          const cellArr = this.cells[idx];
          for (let i = 0; i < count; i++) {
            results.push(cellArr[i]);
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
  const [selectedHoverClass, setSelectedHoverClass] = useState<CellClass | null>(null);
  
  const engineRef = useRef({ entities: [] as GameEntity[], playerIdx: -1 });
  const gridRef = useRef(new OptimizedGrid());
  const mouseRef = useRef({ x: 0, y: 0 });
  const lastTimeRef = useRef<number>(0);
  const accumulatorRef = useRef<number>(0);
  const lastEjectTime = useRef<number>(0);
  
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
    setAdvisorMessage("Establishing encrypted tactical link...");

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: `CONTEXT:
        Player: ${uiPlayer.name} (${uiPlayer.class})
        Mass: ${Math.floor(uiPlayer.mass)} | Level: ${uiPlayer.level}
        Arena: High-intensity split-physics environment.
        Goal: Provide a brief, cool, RPG-styled tactical tip for survival and domination.
        Max 18 words. AI Strategist tone.`,
        config: { thinkingConfig: { thinkingBudget: 32768 } },
      });
      setAdvisorMessage(response.text?.trim() || "Consolidate biomass for dominance.");
    } catch {
      setAdvisorMessage("Link integrity compromised.");
    } finally {
      setIsThinking(false);
      setTimeout(() => setAdvisorMessage(null), 15000);
    }
  };

  const handleSplit = useCallback(() => {
    const { entities } = engineRef.current;
    const playerCells = entities.filter(e => (e.ownerId === 'player' || e.id === 'player') && e.mass >= MIN_SPLIT_MASS);
    if (playerCells.length === 0 || entities.filter(e => e.ownerId === 'player' || e.id === 'player').length >= MAX_PLAYER_CELLS) return;

    const newCells: GameEntity[] = [];
    playerCells.forEach(cell => {
      const halfMass = cell.mass / 2;
      cell.mass = halfMass;
      cell.radius = Math.sqrt(cell.mass) * 4;
      cell.mergeTimer = PHYSICS_TPS * 25; 

      const dx = mouseRef.current.x, dy = mouseRef.current.y;
      const d = Math.sqrt(dx*dx + dy*dy) || 1;
      
      newCells.push({
        id: `p-split-${Math.random()}`,
        type: 'player',
        ownerId: 'player',
        x: cell.x + (dx / d) * (cell.radius * 0.6),
        y: cell.y + (dy / d) * (cell.radius * 0.6),
        radius: cell.radius,
        mass: halfMass,
        color: cell.color,
        class: cell.class,
        mergeTimer: PHYSICS_TPS * 25,
        behavior: 'idle'
      });
    });
    engineRef.current.entities = [...entities, ...newCells];
  }, []);

  const handleEject = useCallback(() => {
    if (Date.now() - lastEjectTime.current < EJECT_COOLDOWN) return;
    lastEjectTime.current = Date.now();

    const { entities } = engineRef.current;
    const playerCells = entities.filter(e => (e.ownerId === 'player' || e.id === 'player') && e.mass > 45);
    
    const ejected: GameEntity[] = [];
    playerCells.forEach(cell => {
      const ejectMass = 14;
      cell.mass -= ejectMass;
      cell.radius = Math.sqrt(cell.mass) * 4;

      const dx = mouseRef.current.x, dy = mouseRef.current.y;
      const d = Math.sqrt(dx*dx + dy*dy) || 1;

      ejected.push({
        id: `ej-${Math.random()}`,
        type: 'ejected',
        ownerId: 'player',
        x: cell.x + (dx / d) * (cell.radius + 15),
        y: cell.y + (dy / d) * (cell.radius + 15),
        radius: 10,
        mass: ejectMass,
        color: cell.color
      });
    });
    engineRef.current.entities = [...entities, ...ejected];
  }, []);

  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if (gameState !== 'playing') return;
      if (e.code === 'Space') { e.preventDefault(); handleSplit(); }
      if (e.code === 'KeyW') { e.preventDefault(); handleEject(); }
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
      ents.push({ id: `f-${i}`, type: 'food', x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE, radius: 3, color: '#475569', mass: 1 });
    }
    for (let i = 0; i < AI_COUNT; i++) {
      const cls = Object.values(CellClass)[Math.floor(Math.random() * 5)] as CellClass;
      ents.push({ id: `ai-${i}`, type: 'ai', x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE, radius: 20, color: CLASS_DATA[cls].color, mass: 60 + Math.random() * 400, class: cls });
    }
    for (let i = 0; i < VIRUS_COUNT; i++) {
      ents.push({ id: `v-${i}`, type: 'virus', x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE, radius: 65, color: '#22c55e', mass: 100 });
    }
    engineRef.current = { entities: ents, playerIdx: 0 };
  };

  const runPhysicsTick = useCallback(() => {
    const { entities } = engineRef.current;
    const playerCells = entities.filter(e => e.ownerId === 'player' || e.id === 'player');
    if (playerCells.length === 0) return;

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.type === 'food' || e.type === 'virus') continue;
      
      const stats = e.class ? CLASS_DATA[e.class].baseStats : { speed: 1 };
      const baseSpeed = (stats.speed * 8.5) / (1 + Math.sqrt(e.mass) / 11);
      const speedMult = e.type === 'ejected' ? 14 : baseSpeed;

      if (e.ownerId === 'player' || e.id === 'player') {
        const dx = mouseRef.current.x, dy = mouseRef.current.y;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d > 5) {
          e.x += (dx / d) * speedMult;
          e.y += (dy / d) * speedMult;
        }
        if (e.mergeTimer && e.mergeTimer > 0) e.mergeTimer--;

        for(let j=0; j<entities.length; j++) {
            const other = entities[j];
            if (i === j || (other.ownerId !== 'player' && other.id !== 'player')) continue;
            const isMerging = (e.mergeTimer === 0 && other.mergeTimer === 0);
            if (!isMerging) {
                const dx = e.x - other.x;
                const dy = e.y - other.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                const min = e.radius + other.radius;
                if (dist < min) {
                    const force = (min - dist) * 0.12;
                    const ax = (dx / dist) * force;
                    const ay = (dy / dist) * force;
                    e.x += ax; e.y += ay;
                    other.x -= ax; other.y -= ay;
                }
            }
        }
      } else if (e.type === 'ai') {
        const target = playerCells[0];
        const dist = Math.hypot(target.x - e.x, target.y - e.y);
        if (dist < 2200) {
          const angle = Math.atan2(target.y - e.y, target.x - e.x);
          const factor = e.mass > target.mass * 1.25 ? 0.7 : -0.95;
          e.x += Math.cos(angle) * speedMult * factor;
          e.y += Math.sin(angle) * speedMult * factor;
        }
      }
      e.x = Math.max(0, Math.min(MAP_SIZE, e.x));
      e.y = Math.max(0, Math.min(MAP_SIZE, e.y));
      e.radius = Math.sqrt(e.mass) * 4;
      e.mass *= 0.99998; 
    }

    gridRef.current.clear();
    for(let i=0; i<entities.length; i++) {
      gridRef.current.insert(entities[i].x, entities[i].y, i);
    }

    const deadSet = new Set<number>();
    const additions: GameEntity[] = [];
    let xpGain = 0;
    let totalMassAccum = 0;

    for (let i = 0; i < entities.length; i++) {
      const a = entities[i];
      if (deadSet.has(i)) continue;
      if (a.ownerId === 'player' || a.id === 'player') totalMassAccum += a.mass;

      const nearby = gridRef.current.getNearby(a.x, a.y, a.radius);
      for (const j of nearby) {
        if (i === j || deadSet.has(j)) continue;
        const b = entities[j];
        const distSq = (a.x - b.x)**2 + (a.y - b.y)**2;
        
        if (a.type === 'virus' && b.type === 'ejected') {
           if (distSq < (a.radius + b.radius)**2) {
             a.mass += b.mass;
             deadSet.add(j);
             if (a.mass > 210) {
                a.mass = 100;
                additions.push({ id: `v-${Math.random()}`, type: 'virus', x: a.x + 100, y: a.y + 100, radius: 65, mass: 100, color: a.color });
             }
           }
           continue;
        }

        if (distSq < (a.radius * 0.92)**2) {
          if (b.type === 'virus' && a.mass > b.mass * 1.3 && (a.id === 'player' || a.ownerId === 'player')) {
             deadSet.add(j); 
             const fragments = Math.min(14, Math.floor(a.mass / 22));
             const fragMass = a.mass / fragments;
             a.mass = fragMass;
             for(let k=0; k<fragments-1; k++) {
                additions.push({
                   id: `split-v-${Math.random()}`, type: 'player', ownerId: 'player',
                   x: a.x + (Math.random() - 0.5) * 180, y: a.y + (Math.random() - 0.5) * 180,
                   radius: Math.sqrt(fragMass)*4, mass: fragMass, color: a.color, mergeTimer: PHYSICS_TPS * 30
                });
             }
             continue;
          }

          if (a.mass > b.mass * 1.18) {
            const isSibling = (a.ownerId === 'player' || a.id === 'player') && (b.ownerId === 'player' || b.id === 'player');
            if (isSibling) {
               if ((a.mergeTimer || 0) <= 0 && (b.mergeTimer || 0) <= 0) {
                  a.mass += b.mass; deadSet.add(j);
               }
            } else {
              a.mass += b.mass; deadSet.add(j);
              if (a.id === 'player' || a.ownerId === 'player') xpGain += Math.floor(b.mass * 2.8);
            }
          }
        }
      }
    }

    if (Date.now() % 1000 < 30) {
      const scoreMap = entities
        .filter(e => e.type === 'player' || e.type === 'ai')
        .reduce((acc, curr) => {
           const n = curr.ownerId === 'player' || curr.id === 'player' ? uiPlayer.name : (curr.class || 'BOT');
           acc[n] = (acc[n] || 0) + curr.mass;
           return acc;
        }, {} as Record<string, number>);
      
      setLeaderboard(Object.entries(scoreMap)
        .sort((a,b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, mass]) => ({ name, mass: Math.floor(mass) })));
    }

    if (xpGain > 0 || Math.floor(totalMassAccum) !== Math.floor(uiPlayer.mass)) {
      setUiPlayer(prev => {
        let nExp = prev.exp + xpGain, nLvl = prev.level, nMax = prev.maxExp;
        while (nExp >= nMax) { nExp -= nMax; nLvl++; nMax = Math.floor(nMax * 1.5); }
        return { ...prev, exp: nExp, level: nLvl, maxExp: nMax, mass: totalMassAccum };
      });
    }

    if (deadSet.size > 0 || additions.length > 0) {
      const nextEnts = entities.filter((e, idx) => {
        if (deadSet.has(idx)) {
          if (e.type === 'food') { e.x = Math.random() * MAP_SIZE; e.y = Math.random() * MAP_SIZE; return true; }
          return false;
        }
        return true;
      });
      engineRef.current.entities = [...nextEnts, ...additions];
      engineRef.current.playerIdx = engineRef.current.entities.findIndex(e => e.id === 'player' || e.ownerId === 'player');
      if (engineRef.current.playerIdx === -1) setGameState('dead');
    }
  }, [uiPlayer.mass, uiPlayer.name]);

  useEffect(() => {
    if (gameState !== 'playing') return;
    let frameId: number;
    const update = (time: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = time;
      accumulatorRef.current += Math.min(100, time - lastTimeRef.current);
      lastTimeRef.current = time;
      let ticks = 0;
      while (accumulatorRef.current >= MS_PER_TICK && ticks < MAX_TICKS_PER_FRAME) {
        runPhysicsTick();
        accumulatorRef.current -= MS_PER_TICK;
        ticks++;
      }
      frameId = requestAnimationFrame(update);
    };
    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [gameState, runPhysicsTick]);

  const startGame = (cls: CellClass) => {
    setUiPlayer(p => ({ ...p, name: playerName, class: cls, stats: CLASS_DATA[cls].baseStats, mass: INITIAL_MASS, level: 1, exp: 0, maxExp: 100 }));
    initWorld(cls);
    setGameState('playing');
    lastTimeRef.current = 0;
  };

  return (
    <div className="w-screen h-screen bg-[#020617] overflow-hidden font-inter select-none relative">
      {gameState === 'playing' ? (
        <>
          <GameCanvas player={uiPlayer} engineRef={engineRef as any} biomes={biomes} onMove={(x, y) => mouseRef.current = { x, y }} />
          
          {/* Leaderboard Overlay */}
          <div className="absolute top-6 right-6 flex flex-col items-end gap-6 pointer-events-none">
             <div className="glass p-6 rounded-[32px] w-64 border-white/10 shadow-[0_0_40px_rgba(0,0,0,0.5)] transition-all animate-in slide-in-from-right duration-500">
                <div className="flex items-center gap-2 mb-4 border-b border-white/10 pb-3">
                  <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                  <h3 className="font-orbitron text-[10px] text-white/50 font-black tracking-[0.3em] uppercase">Apex Ranking</h3>
                </div>
                {leaderboard.map((entry, i) => (
                  <div key={i} className={`flex justify-between items-center mb-2 last:mb-0 px-2 py-1 rounded-lg transition-colors ${entry.name === uiPlayer.name ? 'bg-indigo-500/20' : ''}`}>
                    <span className={`text-[11px] font-bold truncate pr-3 ${entry.name === uiPlayer.name ? 'text-white' : 'text-white/30'}`}>{i+1}. {entry.name}</span>
                    <span className={`text-[10px] font-orbitron ${entry.name === uiPlayer.name ? 'text-indigo-300' : 'text-white/40'}`}>{entry.mass}</span>
                  </div>
                ))}
             </div>
             <div className="glass px-8 py-5 rounded-[32px] border-emerald-500/20 shadow-2xl animate-in slide-in-from-right duration-700">
                <div className="text-[10px] text-emerald-500/60 font-black uppercase tracking-[0.3em] mb-1 text-right">Biomass Units</div>
                <div className="font-orbitron text-4xl text-emerald-400 font-black text-right tracking-tighter">{Math.floor(uiPlayer.mass)}</div>
             </div>
          </div>

          {/* Player HUD */}
          <div className="absolute top-6 left-6 flex flex-col gap-6 pointer-events-none">
            <div className="glass px-8 py-6 rounded-[32px] w-80 shadow-2xl border-white/10 animate-in slide-in-from-left duration-500">
              <div className="flex justify-between items-end mb-3">
                <div className="flex flex-col">
                  <span className="text-[10px] text-white/30 font-black uppercase tracking-[0.3em]">Operator</span>
                  <h2 className="font-orbitron font-black text-white text-xl tracking-tight leading-none">{uiPlayer.name}</h2>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] text-indigo-400 font-black uppercase tracking-widest">Level</span>
                  <span className="font-orbitron text-2xl font-black text-indigo-300 leading-none">{uiPlayer.level}</span>
                </div>
              </div>
              <div className="w-full h-2 bg-slate-950/50 rounded-full overflow-hidden border border-white/5 relative">
                <div className="h-full bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.5)] transition-all duration-700 ease-out" style={{ width: `${(uiPlayer.exp/uiPlayer.maxExp)*100}%` }} />
              </div>
            </div>

            <button onClick={requestAdvice} disabled={isThinking} className="pointer-events-auto glass px-6 py-4 rounded-[24px] flex items-center gap-4 hover:bg-indigo-500/10 hover:border-indigo-500/30 transition-all w-fit group border-white/10 shadow-xl">
              <div className={`w-3 h-3 rounded-full shadow-[0_0_10px_currentColor] ${isThinking ? 'text-amber-500 bg-amber-500 animate-pulse' : 'text-emerald-500 bg-emerald-500'}`} />
              <div className="flex flex-col items-start">
                <span className="text-[9px] font-orbitron font-black text-white/40 uppercase tracking-[0.3em]">Tactical Core</span>
                <span className="text-[11px] font-orbitron text-white group-hover:text-indigo-400 transition-colors uppercase font-bold">{isThinking ? 'Analyzing Arena...' : 'Neural Advisory'}</span>
              </div>
            </button>

            {advisorMessage && (
              <div className="glass p-6 rounded-[32px] w-80 text-[12px] leading-relaxed text-indigo-100 border-indigo-500/30 italic animate-in fade-in slide-in-from-top-4 duration-500 backdrop-blur-[24px] shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500" />
                <span className="opacity-80">"{advisorMessage}"</span>
              </div>
            )}
          </div>

          {/* Controls Hint */}
          <div className="absolute bottom-10 left-10 flex gap-6 pointer-events-none opacity-40 hover:opacity-100 transition-opacity">
             <div className="flex items-center gap-3">
               <div className="glass w-10 h-10 rounded-xl flex items-center justify-center font-orbitron font-black border-white/20">W</div>
               <span className="text-[10px] font-orbitron tracking-widest uppercase">Eject</span>
             </div>
             <div className="flex items-center gap-3">
               <div className="glass px-4 h-10 rounded-xl flex items-center justify-center font-orbitron font-black border-white/20">SPACE</div>
               <span className="text-[10px] font-orbitron tracking-widest uppercase">Split</span>
             </div>
          </div>

          <div className="absolute bottom-10 right-10 animate-in zoom-in duration-1000">
            <Minimap player={uiPlayer} entities={engineRef.current.entities} biomes={biomes} />
          </div>
        </>
      ) : gameState === 'menu' ? (
        <div className="flex flex-col items-center justify-center h-full text-center p-8 animate-in fade-in duration-1000">
          <div className="mb-2 transition-transform hover:scale-105 duration-700">
            <h1 className="font-orbitron text-[130px] font-black text-white italic tracking-tighter leading-none select-none drop-shadow-[0_0_60px_rgba(255,255,255,0.2)]">OSMOS</h1>
            <p className="text-indigo-400 font-orbitron text-[11px] tracking-[1.6em] uppercase mb-16 opacity-70 font-black">Evolutionary Apex Arena</p>
          </div>

          <div className="relative mb-16 group">
            <div className="absolute inset-0 bg-indigo-500/20 blur-[50px] opacity-0 group-focus-within:opacity-100 transition-opacity" />
            <input 
              className="relative bg-slate-900/60 p-8 rounded-[40px] text-center font-orbitron text-2xl w-[450px] outline-none text-white border border-white/10 focus:border-indigo-500/50 focus:bg-slate-900/80 transition-all shadow-2xl placeholder:text-white/10 tracking-[0.2em] font-black" 
              placeholder="IDENTIFY" 
              value={playerName} 
              onChange={e => setPlayerName(e.target.value.toUpperCase())} 
              maxLength={12} 
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 max-w-7xl">
            {(Object.keys(CLASS_DATA) as CellClass[]).map(cls => (
              <div key={cls} className="relative group">
                {/* Stats Tooltip */}
                <div className={`absolute -top-32 left-1/2 -translate-x-1/2 w-48 glass p-4 rounded-2xl opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none z-50 border-indigo-500/20 shadow-2xl ${selectedHoverClass === cls ? 'translate-y-0' : 'translate-y-4'}`}>
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-center text-[10px] font-orbitron">
                      <span className="text-white/40">SPEED</span>
                      <span className="text-white font-black">{CLASS_DATA[cls].baseStats.speed.toFixed(1)}</span>
                    </div>
                    <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-white/40" style={{ width: `${CLASS_DATA[cls].baseStats.speed * 40}%` }} />
                    </div>
                    <div className="flex justify-between items-center text-[10px] font-orbitron mt-1">
                      <span className="text-white/40">DEFENSE</span>
                      <span className="text-white font-black">{CLASS_DATA[cls].baseStats.defense.toFixed(1)}</span>
                    </div>
                    <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-400" style={{ width: `${CLASS_DATA[cls].baseStats.defense * 40}%` }} />
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => startGame(cls)} 
                  onMouseEnter={() => setSelectedHoverClass(cls)}
                  onMouseLeave={() => setSelectedHoverClass(null)}
                  className="glass p-10 rounded-[48px] hover:bg-white/10 transition-all group border-transparent hover:border-white/20 shadow-2xl flex flex-col items-center w-full relative overflow-hidden"
                >
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity bg-gradient-to-b from-transparent to-white/20" />
                  <div 
                    className="w-16 h-16 rounded-full mb-8 group-hover:scale-125 transition-transform duration-500 shadow-[0_0_30px_rgba(0,0,0,0.5)] relative" 
                    style={{ background: CLASS_DATA[cls].color }}
                  >
                    <div className="absolute inset-0 rounded-full bg-inherit blur-md opacity-40 group-hover:opacity-80 transition-opacity" />
                  </div>
                  <span className="text-[12px] font-orbitron font-black text-white tracking-[0.4em] uppercase group-hover:text-indigo-400 group-hover:scale-110 transition-all">{cls}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-full text-center animate-in zoom-in duration-700 p-8">
          <div className="mb-12 relative">
            <div className="absolute inset-0 blur-[120px] bg-red-600/30 opacity-60" />
            <h2 className="relative font-orbitron text-9xl font-black text-red-600 italic tracking-tighter drop-shadow-2xl">CONSUMED</h2>
            <p className="font-orbitron text-white/30 tracking-[1em] uppercase mt-2 font-black">Biological Failure</p>
          </div>
          <button 
            onClick={() => setGameState('menu')} 
            className="glass px-20 py-8 rounded-[48px] font-orbitron font-black text-white hover:bg-white/10 tracking-[0.5em] transition-all text-2xl hover:scale-105 border-white/20 shadow-2xl group"
          >
            <span className="group-hover:text-red-400 transition-colors">RE-EVOLVE</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default App;
