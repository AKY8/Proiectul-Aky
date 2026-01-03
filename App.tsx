
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { Minimap } from './components/Minimap';
import { PlayerState, CellClass, GameEntity, Biome } from './types';
import { INITIAL_MASS, CLASS_DATA, MAP_SIZE, FOOD_COUNT, AI_COUNT } from './constants';
import { GoogleGenAI } from "@google/genai";

const PHYSICS_TPS = 60;
const MS_PER_TICK = 1000 / PHYSICS_TPS;
const MAX_TICKS_PER_FRAME = 5; // Prevents "Spiral of Death"
const GRID_SIZE = 400;

class GameEngine {
  entities: GameEntity[] = [];
  grid: Map<string, number[]> = new Map();
  playerIdx: number = -1;

  updateGrid() {
    this.grid.clear();
    const len = this.entities.length;
    for (let i = 0; i < len; i++) {
      const e = this.entities[i];
      const gx = (e.x / GRID_SIZE) | 0;
      const gy = (e.y / GRID_SIZE) | 0;
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
    const gx = (x / GRID_SIZE) | 0;
    const gy = (y / GRID_SIZE) | 0;
    const range = Math.ceil((radius * 2) / GRID_SIZE) + 1;
    
    for (let ox = -range; ox <= range; ox++) {
      for (let oy = -range; oy <= range; oy++) {
        const cell = this.grid.get(`${gx + ox},${gy + oy}`);
        if (cell) {
          const cLen = cell.length;
          for (let k = 0; k < cLen; k++) indices.push(cell[k]);
        }
      }
    }
    return indices;
  }
}

const App: React.FC = () => {
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'dead'>('menu');
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('osmos_name') || 'SUBJECT-01');
  const [isThinking, setIsThinking] = useState(false);
  const [advisorMessage, setAdvisorMessage] = useState<string | null>(null);
  
  const engineRef = useRef(new GameEngine());
  const mouseRef = useRef({ x: 0, y: 0 });
  const lastTimeRef = useRef<number>(0);
  const accumulatorRef = useRef<number>(0);
  const tickCounterRef = useRef<number>(0);
  
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

  const requestAdvice = async () => {
    if (isThinking) return;
    setIsThinking(true);
    setAdvisorMessage("Initiating Neural Link with Gemini 3 Pro...");

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `System: Strategic Evolutionary Analysis.
      Player Context:
      - Name: ${uiPlayer.name}
      - Bio-Class: ${uiPlayer.class}
      - Level: ${uiPlayer.level}
      - Mass: ${Math.floor(uiPlayer.mass)}
      - Threat Density: High
      
      Instructions: Use your deep reasoning to provide a tactical survival strategy for a ${uiPlayer.class} in a hostile 2D arena. Focus on biome utilization and mass preservation. Keep it under 40 words, cyberpunk tone.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingBudget: 32768 }
        },
      });

      setAdvisorMessage(response.text || "Evolutionary vectors undefined.");
    } catch (err) {
      setAdvisorMessage("Neural connection desynced. Rely on instincts.");
    } finally {
      setIsThinking(false);
      setTimeout(() => setAdvisorMessage(null), 10000);
    }
  };

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
    
    tickCounterRef.current++;

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
        e.mass *= 0.99985; // Slightly buffed retention
      } else {
        const distToPlayer = Math.hypot(pEnt.x - e.x, pEnt.y - e.y);
        let shouldUpdate = false;
        if (distToPlayer < 1500) shouldUpdate = true;
        else if (distToPlayer < 3000) shouldUpdate = tickCounterRef.current % 4 === 0;
        else if (distToPlayer < 5000) shouldUpdate = tickCounterRef.current % 12 === 0;

        if (shouldUpdate) {
          const factor = e.mass > pEnt.mass * 1.15 ? 0.65 : -0.9;
          const angle = Math.atan2(pEnt.y - e.y, pEnt.x - e.x);
          e.x += Math.cos(angle) * speedBase * factor;
          e.y += Math.sin(angle) * speedBase * factor;
          e.mass *= 0.99975;
        }
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
        const threshold = (a.radius * 0.95) ** 2;
        
        if (distSq < threshold && a.mass > b.mass * 1.15) {
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
        else if (entities[i].type === 'food') {
           nextEnts.push({ ...entities[i], x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE });
        }
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
      const deltaTime = time - lastTimeRef.current;
      lastTimeRef.current = time;
      
      accumulatorRef.current += deltaTime;
      let ticks = 0;
      while (accumulatorRef.current >= MS_PER_TICK && ticks < MAX_TICKS_PER_FRAME) {
        runPhysicsTick();
        accumulatorRef.current -= MS_PER_TICK;
        ticks++;
      }
      // If we skipped too many ticks, drain the accumulator to prevent stutters
      if (accumulatorRef.current > MS_PER_TICK) accumulatorRef.current = 0;
      
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
            </div>

            <div className="pointer-events-auto">
               <button 
                onClick={requestAdvice}
                disabled={isThinking}
                className={`glass px-6 py-4 rounded-2xl flex items-center gap-3 transition-all hover:scale-105 active:scale-95 border-indigo-500/30 shadow-indigo-500/10 shadow-lg ${isThinking ? 'opacity-50' : ''}`}
               >
                 <div className={`w-3 h-3 rounded-full bg-indigo-500 ${isThinking ? 'animate-pulse' : ''}`}></div>
                 <span className="font-orbitron text-[10px] font-black text-white uppercase tracking-widest">
                   {isThinking ? 'Thinking...' : 'Gemini Advisor'}
                 </span>
               </button>
            </div>

            {advisorMessage && (
              <div className="glass p-5 rounded-2xl w-80 bg-indigo-950/40 border-indigo-400/20 animate-in fade-in slide-in-from-left-4 duration-500 shadow-2xl">
                <p className="text-[11px] text-indigo-100 font-medium leading-relaxed">
                  <span className="text-indigo-400 font-black mr-2">CORE_LOGIC:</span>
                  {advisorMessage}
                </p>
              </div>
            )}
          </div>

          <div className="absolute top-8 right-8 flex flex-col items-end gap-3 pointer-events-none">
            <div className="glass px-8 py-5 rounded-[2.5rem] bg-slate-900/40 backdrop-blur-md border-emerald-500/20 shadow-2xl">
               <div className="flex flex-col items-end">
                  <span className="text-[10px] text-emerald-500/60 font-black uppercase tracking-[0.3em] mb-1">Total Biomass</span>
                  <div className="flex items-baseline gap-2">
                    <span className="font-orbitron text-4xl text-emerald-400 font-black leading-none tabular-nums">{Math.floor(uiPlayer.mass)}</span>
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
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/10 blur-[120px] rounded-full animate-pulse"></div>
          <div className="z-10 text-center max-w-5xl w-full">
            <h1 className="font-orbitron text-[120px] font-black italic text-white mb-2 tracking-tighter leading-none drop-shadow-2xl">OSMOS</h1>
            <p className="text-indigo-400 font-orbitron text-sm tracking-[1.5em] uppercase mb-16 opacity-60">Prime Evolutionary Interface</p>
            
            <div className="flex flex-col items-center gap-12">
              <div className="glass p-2 rounded-3xl group shadow-2xl">
                <input 
                  className="bg-slate-900/40 p-6 rounded-2xl text-center font-orbitron text-2xl w-[400px] outline-none text-white focus:bg-slate-800/60 transition-all uppercase tracking-widest placeholder:text-white/10" 
                  placeholder="IDENTIFY SUBJECT"
                  value={playerName} 
                  onChange={e => setPlayerName(e.target.value.toUpperCase().slice(0, 15))} 
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-5 gap-4 w-full">
                {(Object.keys(CLASS_DATA) as CellClass[]).map(cls => (
                  <button key={cls} onClick={() => startGame(cls)} className="group relative flex flex-col items-center p-8 rounded-[3rem] glass border-white/5 hover:bg-white/5 transition-all hover:-translate-y-2 overflow-hidden shadow-xl">
                    <div className="w-16 h-16 rounded-full mb-6 shadow-2xl group-hover:scale-125 transition-transform" style={{ background: CLASS_DATA[cls].color }}></div>
                    <h3 className="font-orbitron text-xs font-black text-white tracking-widest uppercase mb-3">{cls}</h3>
                    <p className="text-[10px] text-slate-400 font-semibold leading-relaxed h-12 opacity-0 group-hover:opacity-100 transition-opacity">
                      {CLASS_DATA[cls].description}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-full bg-slate-950/90 backdrop-blur-3xl">
          <div className="text-center glass p-20 rounded-[4rem] max-w-lg w-full border-red-500/20 shadow-red-500/10 shadow-2xl">
            <h2 className="font-orbitron text-6xl font-black text-red-500 mb-4 italic tracking-tighter">FAILURE</h2>
            <button onClick={() => { setGameState('menu'); lastTimeRef.current = 0; }} className="w-full bg-red-600/10 border border-red-500/30 py-6 rounded-3xl font-orbitron font-black text-red-500 hover:bg-red-500 hover:text-white transition-all">RE-EVOLVE</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
