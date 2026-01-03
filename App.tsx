
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { Minimap } from './components/Minimap';
import { PlayerState, CellClass, GameEntity, Biome } from './types';
import { INITIAL_MASS, CLASS_DATA, MAP_SIZE, FOOD_COUNT, AI_COUNT } from './constants';

const PHYSICS_TPS = 60;
const MS_PER_TICK = 1000 / PHYSICS_TPS;
const GRID_SIZE = 400;

class GameEngine {
  entities: GameEntity[] = [];
  grid: Map<string, number[]> = new Map();
  playerIdx: number = -1;

  updateGrid() {
    this.grid.clear();
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      const gx = Math.floor(e.x / GRID_SIZE);
      const gy = Math.floor(e.y / GRID_SIZE);
      const key = `${gx},${gy}`;
      let cell = this.grid.get(key);
      if (!cell) {
        cell = [];
        this.grid.set(key, cell);
      }
      cell.push(i);
    }
  }

  getNearbyIndices(x: number, y: number, radius: number): number[] {
    const indices: number[] = [];
    const gx = Math.floor(x / GRID_SIZE);
    const gy = Math.floor(y / GRID_SIZE);
    const range = Math.ceil((radius * 2) / GRID_SIZE) + 1;
    for (let ox = -range; ox <= range; ox++) {
      for (let oy = -range; oy <= range; oy++) {
        const cell = this.grid.get(`${gx + ox},${gy + oy}`);
        if (cell) {
          for (let k = 0; k < cell.length; k++) indices.push(cell[k]);
        }
      }
    }
    return indices;
  }
}

const App: React.FC = () => {
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'dead'>('menu');
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('osmos_name') || 'SUBJECT-01');
  
  const engineRef = useRef(new GameEngine());
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
    { id: '3', name: 'Energy Nexus', color: '#0ea5e9', bounds: { x: 4000, y: 1000, w: 2000, h: 3000 }, effect: 'nutrient' },
  ], []);

  const initWorld = (selectedClass: CellClass) => {
    const ents: GameEntity[] = [];
    ents.push({
      id: 'player', type: 'player', x: MAP_SIZE / 2, y: MAP_SIZE / 2,
      radius: Math.sqrt(INITIAL_MASS) * 4, color: CLASS_DATA[selectedClass].color,
      mass: INITIAL_MASS, class: selectedClass
    });
    for (let i = 0; i < FOOD_COUNT; i++) {
      ents.push({
        id: `f-${i}`, type: 'food', x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE,
        radius: 3, color: '#334155', mass: 1
      });
    }
    for (let i = 0; i < AI_COUNT; i++) {
      const cls = Object.values(CellClass)[Math.floor(Math.random() * 5)] as CellClass;
      ents.push({
        id: `ai-${i}`, type: 'ai', x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE,
        radius: 20, color: CLASS_DATA[cls].color, mass: 40 + Math.random() * 250, class: cls
      });
    }
    engineRef.current.entities = ents;
    engineRef.current.playerIdx = 0;
    engineRef.current.updateGrid();
  };

  const runPhysicsTick = useCallback(() => {
    const eng = engineRef.current;
    const entities = eng.entities;
    if (eng.playerIdx === -1) return;
    const pEnt = entities[eng.playerIdx];

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.type === 'food') continue;
      const stats = e.class ? CLASS_DATA[e.class].baseStats : { speed: 1 };
      const speedBase = (stats.speed * 8.5) / (1 + Math.sqrt(e.mass) / 12);

      if (e.id === 'player') {
        const dx = mouseRef.current.x, dy = mouseRef.current.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 5) {
          e.x += (dx / d) * speedBase;
          e.y += (dy / d) * speedBase;
        }
        e.mass *= 0.9998;
      } else {
        const distToPlayer = Math.hypot(pEnt.x - e.x, pEnt.y - e.y);
        if (distToPlayer < 1800) {
          const factor = e.mass > pEnt.mass * 1.15 ? 0.6 : -0.85;
          e.x += ((pEnt.x - e.x) / distToPlayer) * speedBase * factor;
          e.y += ((pEnt.y - e.y) / distToPlayer) * speedBase * factor;
        } else {
          e.x += (Math.random() - 0.5) * 3;
          e.y += (Math.random() - 0.5) * 3;
        }
        e.mass *= 0.9997;
      }
      e.x = Math.max(0, Math.min(MAP_SIZE, e.x));
      e.y = Math.max(0, Math.min(MAP_SIZE, e.y));
      e.radius = Math.sqrt(e.mass) * 4;
    }

    eng.updateGrid();
    const deadSet = new Set<number>();
    let xpGain = 0;

    for (let i = 0; i < entities.length; i++) {
      const a = entities[i];
      if (deadSet.has(i) || a.type === 'food') continue;
      const nearby = eng.getNearbyIndices(a.x, a.y, a.radius);
      for (let k = 0; k < nearby.length; k++) {
        const j = nearby[k];
        if (i === j || deadSet.has(j)) continue;
        const b = entities[j];
        const distSq = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
        if (distSq < (a.radius * 0.95) ** 2 && a.mass > b.mass * 1.15) {
          a.mass += b.mass * (a.id === 'player' ? uiPlayer.stats.absorption : 1);
          deadSet.add(j);
          if (a.id === 'player') xpGain += Math.floor(b.mass * 5);
        }
      }
    }

    if (xpGain > 0 || Math.floor(pEnt.mass) !== Math.floor(uiPlayer.mass)) {
      setUiPlayer(prev => {
        let nExp = prev.exp + xpGain, nLvl = prev.level, nMax = prev.maxExp;
        while (nExp >= nMax) { nExp -= nMax; nLvl++; nMax = Math.floor(nMax * 1.55); }
        return { ...prev, exp: nExp, level: nLvl, maxExp: nMax, mass: pEnt.mass };
      });
    }

    if (deadSet.size > 0) {
      const nextEnts: GameEntity[] = [];
      for (let i = 0; i < entities.length; i++) {
        if (!deadSet.has(i)) nextEnts.push(entities[i]);
        else if (entities[i].type === 'food') nextEnts.push({ ...entities[i], x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE });
      }
      eng.entities = nextEnts;
      eng.playerIdx = eng.entities.findIndex(e => e.id === 'player');
      if (eng.playerIdx === -1) setGameState('dead');
    }
  }, [uiPlayer.stats.absorption, uiPlayer.mass]);

  useEffect(() => {
    if (gameState !== 'playing') return;
    let frameId: number;
    const loop = (time: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = time;
      accumulatorRef.current += time - lastTimeRef.current;
      lastTimeRef.current = time;
      while (accumulatorRef.current >= MS_PER_TICK) {
        runPhysicsTick();
        accumulatorRef.current -= MS_PER_TICK;
      }
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [gameState, runPhysicsTick]);

  const startGame = (cls: CellClass) => {
    localStorage.setItem('osmos_name', playerName);
    setUiPlayer(p => ({ 
      ...p, name: playerName, class: cls, stats: CLASS_DATA[cls].baseStats, mass: INITIAL_MASS, level: 1, exp: 0 
    }));
    initWorld(cls);
    setGameState('playing');
  };

  return (
    <div className="w-screen h-screen bg-[#020617] overflow-hidden font-inter select-none">
      {gameState === 'playing' ? (
        <>
          <GameCanvas player={uiPlayer} engineRef={engineRef} biomes={biomes} onMove={(x, y) => mouseRef.current = { x, y }} />
          
          {/* Enhanced HUD */}
          <div className="absolute top-8 left-8 flex flex-col gap-5 pointer-events-none">
            <div className="glass px-6 py-5 rounded-[2rem] w-80 shadow-2xl border-white/5 bg-slate-900/60 backdrop-blur-xl">
              <div className="flex justify-between items-start mb-4">
                <div>
                   <h2 className="font-orbitron font-black text-xl text-white tracking-tight uppercase">{uiPlayer.name}</h2>
                   <div className="flex items-center gap-2 mt-1">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CLASS_DATA[uiPlayer.class].color }}></div>
                      <span className="text-[10px] text-indigo-400 font-black uppercase tracking-[0.2em]">{uiPlayer.class}</span>
                   </div>
                </div>
                <div className="flex flex-col items-end">
                   <span className="text-[11px] font-black italic text-indigo-300">RANK</span>
                   <span className="text-2xl font-orbitron font-black leading-none">{uiPlayer.level}</span>
                </div>
              </div>
              <div className="relative w-full h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
                <div className="h-full bg-gradient-to-r from-indigo-600 to-blue-400 transition-all duration-500 shadow-[0_0_10px_rgba(79,70,229,0.5)]" style={{ width: `${(uiPlayer.exp / uiPlayer.maxExp) * 100}%` }} />
              </div>
              <div className="flex justify-between mt-2 text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                <span>Core Progression</span>
                <span>{Math.floor((uiPlayer.exp / uiPlayer.maxExp) * 100)}%</span>
              </div>
            </div>
          </div>

          <div className="absolute top-8 right-8 flex flex-col items-end gap-3 pointer-events-none">
            <div className="glass px-8 py-5 rounded-[2.5rem] bg-slate-900/40 backdrop-blur-md border-emerald-500/20 shadow-xl shadow-emerald-900/10">
               <div className="flex flex-col items-end">
                  <span className="text-[10px] text-emerald-500/60 font-black uppercase tracking-[0.3em] mb-1">Total Biomass</span>
                  <div className="flex items-baseline gap-2">
                    <span className="font-orbitron text-4xl text-emerald-400 font-black leading-none tabular-nums drop-shadow-[0_0_8px_rgba(52,211,153,0.3)]">{Math.floor(uiPlayer.mass)}</span>
                    <span className="text-xs font-black text-emerald-600/80">µg</span>
                  </div>
               </div>
            </div>
          </div>

          <div className="absolute bottom-8 right-8 scale-110">
            <Minimap player={uiPlayer} entities={engineRef.current.entities} biomes={biomes} />
          </div>
        </>
      ) : gameState === 'menu' ? (
        <div className="flex flex-col items-center justify-center h-full p-8 relative overflow-hidden">
          {/* Animated Background Orbs */}
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/10 blur-[120px] rounded-full animate-pulse"></div>
          <div className="absolute bottom-[-5%] right-[-5%] w-[30%] h-[30%] bg-emerald-600/10 blur-[100px] rounded-full animate-pulse" style={{ animationDelay: '1s' }}></div>

          <div className="z-10 text-center max-w-5xl w-full">
            <h1 className="font-orbitron text-[120px] font-black italic text-white mb-2 tracking-tighter leading-none drop-shadow-2xl">OSMOS</h1>
            <p className="text-indigo-400 font-orbitron text-sm tracking-[1.5em] uppercase mb-16 opacity-60">Prime Evolutionary Interface</p>
            
            <div className="flex flex-col items-center gap-12">
              <div className="glass p-2 rounded-3xl group transition-all hover:border-white/20 focus-within:border-indigo-500/50">
                <input 
                  className="bg-slate-900/40 p-6 rounded-2xl text-center font-orbitron text-2xl w-[400px] outline-none text-white focus:bg-slate-800/60 transition-all uppercase tracking-widest placeholder:text-slate-700" 
                  placeholder="IDENTIFY SUBJECT"
                  value={playerName} 
                  onChange={e => setPlayerName(e.target.value.toUpperCase().slice(0, 15))} 
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-4 w-full">
                {(Object.keys(CLASS_DATA) as CellClass[]).map(cls => (
                  <button 
                    key={cls} 
                    onClick={() => startGame(cls)} 
                    className="group relative flex flex-col items-center p-8 rounded-[3rem] glass border-white/5 hover:bg-white/5 transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl active:scale-95 overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    <div 
                      className="w-16 h-16 rounded-full mb-6 shadow-2xl group-hover:scale-125 transition-transform duration-500 relative z-10" 
                      style={{ 
                        background: CLASS_DATA[cls].color,
                        boxShadow: `0 0 30px ${CLASS_DATA[cls].color}44`
                      }}
                    >
                      <div className="absolute inset-0 rounded-full bg-white/20 blur-sm scale-75 animate-pulse"></div>
                    </div>
                    <h3 className="font-orbitron text-xs font-black text-white tracking-widest uppercase mb-3 z-10">{cls}</h3>
                    <p className="text-[10px] text-slate-400 font-semibold leading-relaxed h-12 opacity-0 group-hover:opacity-100 transition-opacity duration-300 px-2 z-10">
                      {CLASS_DATA[cls].description}
                    </p>
                    <div className="mt-4 flex gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
                       <div className="w-1 h-1 rounded-full bg-white"></div>
                       <div className="w-1 h-1 rounded-full bg-white"></div>
                       <div className="w-1 h-1 rounded-full bg-white"></div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-full bg-slate-950/90 backdrop-blur-3xl">
          <div className="text-center glass p-20 rounded-[4rem] max-w-lg w-full border-red-500/20 shadow-[0_0_100px_rgba(239,68,68,0.1)]">
            <h2 className="font-orbitron text-6xl font-black text-red-500 mb-4 italic tracking-tighter">FAILURE</h2>
            <p className="font-orbitron text-[10px] tracking-[0.5em] text-red-500/50 uppercase mb-12">Genetic structural integrity compromised</p>
            <button 
              onClick={() => { setGameState('menu'); lastTimeRef.current = 0; }} 
              className="group relative w-full overflow-hidden bg-red-600/10 border border-red-500/30 py-6 rounded-3xl font-orbitron font-black text-red-500 hover:bg-red-500 hover:text-white transition-all duration-300 shadow-xl"
            >
              <span className="relative z-10">RE-EVOLVE</span>
              <div className="absolute inset-0 bg-red-500 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
