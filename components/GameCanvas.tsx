
import React, { useRef, useEffect, useCallback } from 'react';
import { Biome, PlayerState, GameEntity } from '../types';
import { MAP_SIZE, CLASS_DATA } from '../constants';

interface GameCanvasProps {
  player: PlayerState;
  engineRef: React.MutableRefObject<any>;
  biomes: Biome[];
  onMove: (dx: number, dy: number) => void;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({ player, engineRef, biomes, onMove }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cam = useRef({ x: MAP_SIZE / 2, y: MAP_SIZE / 2, zoom: 0.8 });
  
  // Cache for cell textures to avoid repeated expensive arc calls
  const cellCache = useRef<Map<string, HTMLCanvasElement>>(new Map());

  const getCellTexture = (color: string, radius: number): HTMLCanvasElement => {
    const key = `${color}-${Math.floor(radius)}`;
    if (cellCache.current.has(key)) return cellCache.current.get(key)!;

    const size = Math.ceil(radius * 2.5);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const center = size / 2;
      // Aura
      ctx.beginPath();
      ctx.arc(center, center, radius * 1.1, 0, Math.PI * 2);
      ctx.fillStyle = color + '22';
      ctx.fill();
      // Body
      ctx.beginPath();
      ctx.arc(center, center, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    
    // Simple cache eviction to prevent memory leak
    if (cellCache.current.size > 200) cellCache.current.clear();
    cellCache.current.set(key, canvas);
    return canvas;
  };

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

    const engine = engineRef.current;
    const entities: GameEntity[] = engine.entities;
    const pEnt = entities[engine.playerIdx];
    if (!pEnt) return;

    // Smooth Camera Follow
    cam.current.x += (pEnt.x - cam.current.x) * 0.15;
    cam.current.y += (pEnt.y - cam.current.y) * 0.15;
    const targetZoom = Math.max(0.2, Math.min(1.0, 100 / (Math.sqrt(pEnt.mass) + 50)));
    cam.current.zoom += (targetZoom - cam.current.zoom) * 0.05;

    const { width, height } = canvas;
    const zoom = cam.current.zoom;

    // Culling Box Calculation (Frustum)
    const vW = width / zoom;
    const vH = height / zoom;
    const vX = cam.current.x - vW / 2;
    const vY = cam.current.y - vH / 2;

    // Background
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-cam.current.x, -cam.current.y);

    // Draw Biomes (Culled)
    biomes.forEach(b => {
      // Basic rect intersection for culling
      if (!(b.bounds.x + b.bounds.w < vX || b.bounds.x > vX + vW || b.bounds.y + b.bounds.h < vY || b.bounds.y > vY + vH)) {
        ctx.fillStyle = b.color + '0a';
        ctx.fillRect(b.bounds.x, b.bounds.y, b.bounds.w, b.bounds.h);
      }
    });

    // Sparse Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 4 / zoom;
    ctx.beginPath();
    const gridStart = Math.floor(vX / 1000) * 1000;
    const gridEnd = Math.ceil((vX + vW) / 1000) * 1000;
    for (let x = gridStart; x <= gridEnd; x += 1000) {
      if (x < 0 || x > MAP_SIZE) continue;
      ctx.moveTo(x, Math.max(0, vY));
      ctx.lineTo(x, Math.min(MAP_SIZE, vY + vH));
    }
    const gridStartV = Math.floor(vY / 1000) * 1000;
    const gridEndV = Math.ceil((vY + vH) / 1000) * 1000;
    for (let y = gridStartV; y <= gridEndV; y += 1000) {
      if (y < 0 || y > MAP_SIZE) continue;
      ctx.moveTo(Math.max(0, vX), y);
      ctx.lineTo(Math.min(MAP_SIZE, vX + vW), y);
    }
    ctx.stroke();

    // Batch Rendering: Food Particles
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.type !== 'food') continue;
      // Cull check
      if (e.x < vX || e.x > vX + vW || e.y < vY || e.y > vY + vH) continue;
      ctx.moveTo(e.x + 3, e.y);
      ctx.arc(e.x, e.y, 3, 0, Math.PI * 2);
    }
    ctx.fill();

    // Render Actors (Players & AI)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.type === 'food') continue;
      
      // Frustum Culling for Actors
      if (e.x + e.radius < vX || e.x - e.radius > vX + vW || e.y + e.radius < vY || e.y - e.radius > vY + vH) continue;

      const texture = getCellTexture(e.color, e.radius);
      ctx.drawImage(texture, e.x - texture.width / 2, e.y - texture.height / 2);

      // Labeling (Only if large enough on screen)
      if (e.radius * zoom > 12) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        const fontSize = Math.max(12, Math.floor(e.radius * 0.35));
        ctx.font = `bold ${fontSize}px Orbitron`;
        const label = e.id === 'player' ? player.name : (e.class || 'BIOMASS');
        ctx.fillText(label, e.x, e.y);
        
        // Level badge for large entities
        if (e.radius * zoom > 30) {
          ctx.font = `bold ${fontSize * 0.5}px Orbitron`;
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          ctx.fillText(`M: ${Math.floor(e.mass)}`, e.x, e.y + fontSize * 0.8);
        }
      }
    }

    ctx.restore();
  }, [player.name, biomes, engineRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();
    
    let frameId: number;
    const loop = () => {
      render();
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(frameId);
    };
  }, [render]);

  return <canvas ref={canvasRef} onMouseMove={handleMouseMove} className="w-full h-full block" />;
};
