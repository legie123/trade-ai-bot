'use client';

import { useEffect, useRef } from 'react';

/**
 * GoldDust — Subtle floating gold particles on a fixed canvas.
 * Performance-optimized:
 *   - 20 particles on mobile (≤768px), 40 on desktop
 *   - Pauses animation when tab is hidden (visibilitychange)
 *   - Disabled entirely when prefers-reduced-motion is set
 *   - No glow pass on mobile to save GPU fill rate
 */
export default function GoldDust() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Respect reduced-motion preference — render nothing
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    let paused = false;

    const isMobile = window.innerWidth <= 768;
    const COUNT = isMobile ? 20 : 40;

    interface P { x: number; y: number; r: number; vx: number; vy: number; a: number; da: number }
    const particles: P[] = [];

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
      if (paused) return; // Don't schedule next frame if paused
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

        // Subtle glow — skip on mobile to save GPU
        if (!isMobile && p.r > 1) {
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
          ctx!.fillStyle = `rgba(218, 165, 32, ${p.a * 0.15})`;
          ctx!.fill();
        }
      }
      raf = requestAnimationFrame(draw);
    }

    // Pause when tab is hidden — saves battery on mobile
    function onVisibility() {
      if (document.hidden) {
        paused = true;
        cancelAnimationFrame(raf);
      } else {
        paused = false;
        raf = requestAnimationFrame(draw);
      }
    }

    init();
    draw();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
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
