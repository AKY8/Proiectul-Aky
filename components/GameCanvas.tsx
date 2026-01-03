
import React, { useRef, useEffect, useCallback } from 'react';
import { Biome, PlayerState, GameEntity } from '../types';
import { MAP_SIZE, CLASS_DATA } from '../constants';

interface GameCanvasProps {
  player: PlayerState;
  engineRef: React.MutableRefObject<{ entities: GameEntity[] }>;
  biomes: Biome[];
  activeEffects: string[];
  onMove: (dx: number, dy: number) => void;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({ player, engineRef, biomes, activeEffects, onMove }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cam = useRef({ x: MAP_SIZE / 2, y: MAP_SIZE / 2, zoom: 0.8 });
  const stars = useRef<{x: number, y: number, s: number}[]>([]);

  if (stars.current.length === 0) {
    for(let i=0; i<400; i++) {
      stars.current.push({
        x: Math.random() * MAP_SIZE,
        y: Math.random() * MAP_SIZE,
        s: Math.random() * 2 + 1
      });
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    onMove(e.clientX - rect.left - canvas.width / 2, e.clientY - rect.top - canvas.height / 2);
  };

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const { entities } = engineRef.current;
    const playerCells = entities.filter(e => e.ownerId === 'player' || e.id === 'player');
    if (playerCells.length === 0) return;

    const totalMass = playerCells.reduce((sum, c) => sum + c.mass, 0);
    const avgX = playerCells.reduce((sum, c) => sum + (c.x * c.mass), 0) / totalMass;
    const avgY = playerCells.reduce((sum, c) => sum + (c.y * c.mass), 0) / totalMass;

    cam.current.x += (avgX - cam.current.x) * 0.15;
    cam.current.y += (avgY - cam.current.y) * 0.15;

    const massZoom = Math.max(0.1, Math.min(0.8, 150 / (Math.sqrt(totalMass) + 80)));
    cam.current.zoom += (massZoom - cam.current.zoom) * 0.05;

    const { width, height } = canvas;
    const z = cam.current.zoom;
    const vW = width / z;
    const vH = height / z;
    const vX = cam.current.x - vW / 2;
    const vY = cam.current.y - vH / 2;

    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(z, z);
    ctx.translate(-cam.current.x, -cam.current.y);

    // Stars
    stars.current.forEach(s => {
      const px = s.x;
      const py = s.y;
      if (px > vX && px < vX + vW && py > vY && py < vY + vH) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.fillRect(px, py, s.s, s.s);
      }
    });

    // Biomes
    biomes.forEach(b => {
      if (b.bounds.x + b.bounds.w > vX && b.bounds.x < vX + vW &&
          b.bounds.y + b.bounds.h > vY && b.bounds.y < vY + vH) {
        ctx.fillStyle = b.color + '12';
        ctx.fillRect(b.bounds.x, b.bounds.y, b.bounds.w, b.bounds.h);
      }
    });

    // World Border
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 15;
    ctx.strokeRect(0, 0, MAP_SIZE, MAP_SIZE);

    // Food
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.type === 'food' && e.x > vX && e.x < vX + vW && e.y > vY && e.y < vY + vH) {
        ctx.moveTo(e.x + e.radius, e.y);
        ctx.arc(e.x, e.y, e.radius, 0, 6.28);
      }
    }
    ctx.fill();

    const time = Date.now() * 0.002;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.type === 'food' || e.x + e.radius < vX || e.x - e.radius > vX + vW || e.y + e.radius < vY || e.y - e.radius > vY + vH) continue;

      if (e.type === 'virus') {
         ctx.fillStyle = e.color;
         ctx.strokeStyle = '#166534';
         ctx.lineWidth = 4;
         ctx.beginPath();
         const spikes = 20;
         for(let s=0; s<spikes*2; s++) {
            const rad = s % 2 === 0 ? e.radius : e.radius * 0.85;
            const angle = (s / spikes) * Math.PI;
            ctx.lineTo(e.x + Math.cos(angle) * rad, e.y + Math.sin(angle) * rad);
         }
         ctx.closePath();
         ctx.fill();
         ctx.stroke();
         continue;
      }

      const pulse = 1 + Math.sin(time + i) * 0.02;
      const r = e.radius * pulse;

      // Special Effects
      if ((e.id === 'player' || e.ownerId === 'player') && activeEffects.includes('FORTIFIED')) {
        ctx.save();
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#3b82f6';
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r + 8, 0, 6.28);
        ctx.stroke();
        ctx.restore();
      }

      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, 6.28);
      ctx.fill();

      // Labeling
      if (r * z > 14 && e.type !== 'ejected') {
        ctx.fillStyle = 'white';
        ctx.font = `bold ${Math.max(12, r * 0.35)}px Orbitron`;
        ctx.textAlign = 'center';
        const label = e.ownerId === 'player' || e.id === 'player' ? player.name : (e.class || 'AI');
        ctx.fillText(label, e.x, e.y + (r*0.1));
      }
    }

    ctx.restore();

    // Vignette
    const grd = ctx.createRadialGradient(width/2, height/2, width*0.4, width/2, height/2, width*0.8);
    grd.addColorStop(0, 'transparent');
    grd.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, width, height);

  }, [player.name, biomes, engineRef, activeEffects]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();
    let id = requestAnimationFrame(function frame() {
      render();
      id = requestAnimationFrame(frame);
    });
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(id);
    };
  }, [render]);

  return <canvas ref={canvasRef} onMouseMove={handleMouseMove} className="w-full h-full block touch-none" />;
};
