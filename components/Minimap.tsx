
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
  const size = 200; // Increased size

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scale = size / MAP_SIZE;

    // Clear with dark semi-transparent bg
    ctx.fillStyle = 'rgba(2, 6, 23, 0.9)';
    ctx.fillRect(0, 0, size, size);

    // Draw Biomes
    biomes.forEach(biome => {
      ctx.fillStyle = biome.color + '44';
      ctx.fillRect(
        biome.bounds.x * scale,
        biome.bounds.y * scale,
        biome.bounds.w * scale,
        biome.bounds.h * scale
      );
    });

    // Draw Entities
    entities.forEach(entity => {
      if (entity.type === 'food') return;

      const x = entity.x * scale;
      const y = entity.y * scale;
      
      if (entity.id === 'player') {
        // Player Marker: Pulse effect
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 6, y - 6, 12, 12);
      } else {
        // Enemy Marker
        ctx.fillStyle = entity.color;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Grid Overlay
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 0.5;
    const gridStep = 2000 * scale;
    for(let i=0; i<size; i+=gridStep) {
        ctx.moveTo(i, 0); ctx.lineTo(i, size);
        ctx.moveTo(0, i); ctx.lineTo(size, i);
    }
    ctx.stroke();

    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, size, size);

  }, [entities, biomes, player]);

  return (
    <div className="relative rounded-[20px] overflow-hidden border border-white/10 shadow-3xl bg-slate-900/90 backdrop-blur-2xl p-1">
      <canvas 
        ref={canvasRef} 
        width={size} 
        height={size} 
        className="block rounded-xl"
      />
      <div className="absolute top-2 left-3 pointer-events-none">
        <span className="text-[9px] font-orbitron font-black text-white/20 uppercase tracking-[0.3em]">Scanner.OS</span>
      </div>
    </div>
  );
};
