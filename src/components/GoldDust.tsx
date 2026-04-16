'use client';

import { useEffect, useRef } from 'react';

/**
 * GoldDust — Subtle floating gold particles on a fixed canvas.
 * Lightweight: ~40 particles, requestAnimationFrame, auto-pauses when hidden.
 */
export default function GoldDust() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;

    interface P { x: number; y: number; r: number; vx: number; vy: number; a: number; da: number }
    const particles: P[] = [];
    const COUNT = 40;

    function resize() {
      w = canvas!.width = window.innerWidth;
      h = canvas!.height = window.innerHeight;
    }

    function init() {
      resize();
      particles.length = 0;
      for (let i = 0; i < COUNT; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: Math.random() * 1.5 + 0.5,
          vx: (Math.random() - 0.5) * 0.15,
          vy: -Math.random() * 0.2 - 0.05,
          a: Math.random() * 0.3 + 0.05,
          da: (Math.random() - 0.5) * 0.003,
        });
      }
    }

    function draw() {
      ctx!.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.a += p.da;
        if (p.a > 0.35 || p.a < 0.03) p.da = -p.da;
        if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;

        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(218, 165, 32, ${p.a})`;
        ctx!.fill();

        // Subtle glow
        if (p.r > 1) {
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
          ctx!.fillStyle = `rgba(218, 165, 32, ${p.a * 0.15})`;
          ctx!.fill();
        }
      }
      raf = requestAnimationFrame(draw);
    }

    init();
    draw();
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        opacity: 0.6,
      }}
      aria-hidden="true"
    />
  );
}
