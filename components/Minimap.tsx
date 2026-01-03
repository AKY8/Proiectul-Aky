
import React, { useRef, useEffect } from 'react';
import { GameEntity, Biome, PlayerState } from '../types';
import { MAP_SIZE } from '../constants';

interface MinimapProps {
  player: PlayerState;
  entities: GameEntity[];
  biomes: Biome[];
}

export const Minimap: React.FC<MinimapProps> = ({ player, entities, biomes }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = 180;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const scale = size / MAP_SIZE;

    // Background
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, size, size);

    // Grid lines for depth
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = 2000 * scale;
    for(let i=0; i<=size; i+=step) {
      ctx.moveTo(i, 0); ctx.lineTo(i, size);
      ctx.moveTo(0, i); ctx.lineTo(size, i);
    }
    ctx.stroke();

    // Biomes
    biomes.forEach(biome => {
      ctx.fillStyle = biome.color + '33';
      ctx.fillRect(
        biome.bounds.x * scale,
        biome.bounds.y * scale,
        biome.bounds.w * scale,
        biome.bounds.h * scale
      );
    });

    // Entities
    entities.forEach(entity => {
      if (entity.type === 'food') return;
      const x = entity.x * scale;
      const y = entity.y * scale;
      const isPlayerCell = entity.id === 'player' || entity.ownerId === 'player';
      
      if (isPlayerCell) {
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 4;
        ctx.shadowColor = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else if (entity.type === 'ai') {
        ctx.fillStyle = entity.color;
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (entity.type === 'virus') {
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    });

    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, size, size);

  }, [entities, biomes]);

  return (
    <div className="relative rounded-3xl overflow-hidden border border-white/10 shadow-3xl bg-slate-900/40 backdrop-blur-xl p-1 animate-in zoom-in duration-700">
      <canvas 
        ref={canvasRef} 
        width={size} 
        height={size} 
        className="block rounded-2xl"
      />
      <div className="absolute top-2 left-3 pointer-events-none flex items-center gap-1.5">
        <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-[8px] font-orbitron font-black text-white/30 uppercase tracking-[0.4em]">SAT-NAV V.2</span>
      </div>
    </div>
  );
};
