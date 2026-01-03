
import React, { useRef, useEffect, useCallback } from 'react';
import { Biome, PlayerState } from '../types';
import { MAP_SIZE } from '../constants';

interface GameCanvasProps {
  player: PlayerState;
  engineRef: React.MutableRefObject<any>;
  biomes: Biome[];
  onMove: (dx: number, dy: number) => void;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({ player, engineRef, biomes, onMove }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cam = useRef({ x: MAP_SIZE / 2, y: MAP_SIZE / 2, zoom: 0.8 });

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
    const entities = engine.entities;
    const pEnt = entities[engine.playerIdx];
    if (!pEnt) return;

    // Smooth Camera
    cam.current.x += (pEnt.x - cam.current.x) * 0.12;
    cam.current.y += (pEnt.y - cam.current.y) * 0.12;
    const targetZoom = Math.max(0.25, Math.min(1.1, 80 / (Math.sqrt(pEnt.mass) + 40)));
    cam.current.zoom += (targetZoom - cam.current.zoom) * 0.04;

    const { width, height } = canvas;
    const zoom = cam.current.zoom;

    // Calculate viewport bounds for culling
    const vW = width / zoom, vH = height / zoom;
    const vL = cam.current.x - vW / 2, vR = cam.current.x + vW / 2;
    const vT = cam.current.y - vH / 2, vB = cam.current.y + vH / 2;

    // Draw Background
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-cam.current.x, -cam.current.y);

    // Grid (Sparse)
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let x = 0; x <= MAP_SIZE; x += 1000) { ctx.moveTo(x, 0); ctx.lineTo(x, MAP_SIZE); }
    for (let y = 0; y <= MAP_SIZE; y += 1000) { ctx.moveTo(0, y); ctx.lineTo(MAP_SIZE, y); }
    ctx.stroke();

    // Biomes
    biomes.forEach(b => {
      ctx.fillStyle = b.color + '0a';
      ctx.fillRect(b.bounds.x, b.bounds.y, b.bounds.w, b.bounds.h);
    });

    // Batch Draw Food (MASSIVE PERFORMANCE GAIN)
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.type !== 'food') continue;
      if (e.x < vL || e.x > vR || e.y < vT || e.y > vB) continue;
      ctx.moveTo(e.x + 3, e.y);
      ctx.arc(e.x, e.y, 3, 0, Math.PI * 2);
    }
    ctx.fill();

    // Draw Actors
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.type === 'food') continue;
      if (e.x < vL - e.radius || e.x > vR + e.radius || e.y < vT - e.radius || e.y > vB + e.radius) continue;

      const isPlayer = e.id === 'player';
      
      // Aura/Glow
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius * 1.1, 0, Math.PI * 2);
      ctx.fillStyle = e.color + '22';
      ctx.fill();

      // Body
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fillStyle = e.color;
      ctx.fill();

      // Label
      if (e.radius * zoom > 15) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `bold ${Math.max(12, e.radius * 0.4)}px Orbitron`;
        ctx.textAlign = 'center';
        ctx.fillText(isPlayer ? player.name : (e.class || 'AI'), e.x, e.y + e.radius * 0.1);
      }
    }

    ctx.restore();
  }, [player.name, biomes, engineRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    window.addEventListener('resize', resize);
    resize();
    let frameId: number;
    const loop = () => { render(); frameId = requestAnimationFrame(loop); };
    frameId = requestAnimationFrame(loop);
    return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(frameId); };
  }, [render]);

  return <canvas ref={canvasRef} onMouseMove={handleMouseMove} className="w-full h-full block" />;
};
