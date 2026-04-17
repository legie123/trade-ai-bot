'use client';

import { useId } from 'react';

/**
 * DragonLogo — Premium profile silhouette.
 * Design: Right-facing dragon profile, clean bezier curves.
 * Gold 3-stop gradient, crimson eye with glow, breathing ambient light.
 * Sizes: 44px sidebar collapsed, 56px expanded, scalable.
 * No crystalline polygons — smooth, luxury, restrained power.
 */
export default function DragonLogo({ size = 44 }: { size?: number }) {
  // AUDIT FIX T6: Replaced Math.random() in render with React useId()
  const id = 'dl' + useId().replace(/:/g, '');

  return (
    <div
      className="dragon-logo-wrap"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        position: 'relative',
      }}
    >
      {/* Ambient glow — CSS breathing animation */}
      <div
        className="dragon-ambient"
        style={{
          position: 'absolute',
          inset: -4,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(218,165,32,0.2) 0%, transparent 70%)',
          animation: 'dragonBreathe 4s ease-in-out infinite',
          pointerEvents: 'none',
        }}
      />

      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="dragon-logo-svg"
        aria-label="Trade AI Dragon Logo"
        role="img"
        style={{ position: 'relative', zIndex: 1 }}
      >
        <defs>
          {/* Premium gold gradient — 3 stops */}
          <linearGradient id={`${id}-g`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFD700" />
            <stop offset="50%" stopColor="#DAA520" />
            <stop offset="100%" stopColor="#B8860B" />
          </linearGradient>

          {/* Dark gold for depth/shadow */}
          <linearGradient id={`${id}-d`} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#6B4F10" />
            <stop offset="100%" stopColor="#8B6914" />
          </linearGradient>

          {/* Highlight for horn/jaw edge */}
          <linearGradient id={`${id}-h`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FFF8DC" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#DAA520" stopOpacity="0.1" />
          </linearGradient>

          {/* Eye glow */}
          <radialGradient id={`${id}-e`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FF2020" />
            <stop offset="50%" stopColor="#CC0000" />
            <stop offset="100%" stopColor="#8B0000" />
          </radialGradient>

          {/* Subtle outer glow */}
          <filter id={`${id}-gl`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="b" />
            <feColorMatrix in="b" type="matrix"
              values="1 0.7 0 0 0  0.7 0.5 0 0 0  0 0 0 0 0  0 0 0 0.35 0" result="gd" />
            <feMerge>
              <feMergeNode in="gd" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Eye glow filter */}
          <filter id={`${id}-eg`} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" />
          </filter>
        </defs>

        <g filter={`url(#${id}-gl)`}>
          {/* === MAIN PROFILE — right-facing dragon head === */}

          {/* Horn — sweeping curve */}
          <path
            d="M 38 28 Q 30 8, 50 5 Q 42 16, 45 26 Z"
            fill={`url(#${id}-h)`}
            stroke="#DAA520"
            strokeWidth="0.5"
          />
          {/* Second horn (behind) */}
          <path
            d="M 34 32 Q 22 14, 38 8 Q 32 20, 36 30 Z"
            fill={`url(#${id}-d)`}
            stroke="#8B6914"
            strokeWidth="0.4"
            opacity="0.6"
          />

          {/* Head — smooth profile silhouette */}
          <path
            d={`
              M 42 26
              C 48 22, 58 22, 64 28
              C 70 34, 76 36, 82 38
              C 86 39, 88 42, 86 46
              L 78 50
              C 74 52, 68 56, 64 60
              C 60 64, 54 66, 48 64
              C 42 62, 36 56, 34 50
              C 32 44, 34 36, 38 30
              C 39 28, 40 27, 42 26
              Z
            `}
            fill={`url(#${id}-g)`}
            stroke="#B8860B"
            strokeWidth="0.6"
          />

          {/* Jaw — lower profile */}
          <path
            d={`
              M 48 64
              C 52 68, 60 72, 66 70
              C 72 68, 78 62, 82 56
              C 80 58, 76 60, 72 60
              C 66 60, 58 62, 48 64
              Z
            `}
            fill={`url(#${id}-d)`}
            stroke="#8B6914"
            strokeWidth="0.5"
          />

          {/* Snout ridge — highlight */}
          <path
            d="M 64 28 C 70 32, 78 36, 84 40 C 80 38, 72 34, 66 30 Z"
            fill={`url(#${id}-h)`}
            opacity="0.5"
          />

          {/* Mouth line */}
          <path
            d="M 82 48 C 76 52, 66 58, 56 62"
            stroke="#8B6914"
            strokeWidth="0.8"
            strokeLinecap="round"
            opacity="0.6"
          />

          {/* Nostril */}
          <ellipse cx="80" cy="44" rx="2" ry="1.2"
            fill="#CC0000"
            opacity="0.4"
            className="dragon-nostril"
          />

          {/* Neck scales — flowing lines */}
          <path d="M 34 52 C 32 60, 28 72, 26 82 C 30 74, 36 66, 40 58"
            stroke="#8B6914" strokeWidth="0.6" fill="none" opacity="0.4" />
          <path d="M 38 56 C 36 64, 32 76, 30 86 C 34 78, 40 68, 44 60"
            stroke="#B8860B" strokeWidth="0.5" fill="none" opacity="0.3" />
          <path d="M 42 58 C 40 66, 38 78, 36 90 C 40 82, 44 72, 46 62"
            stroke="#DAA520" strokeWidth="0.4" fill="none" opacity="0.25" />

          {/* Neck body */}
          <path
            d={`
              M 34 52
              C 30 62, 24 76, 22 92
              C 22 96, 24 98, 28 98
              C 36 98, 44 88, 48 78
              C 50 72, 50 66, 48 64
              Z
            `}
            fill={`url(#${id}-g)`}
            stroke="#B8860B"
            strokeWidth="0.5"
            opacity="0.85"
          />

          {/* Crown spike — small */}
          <path d="M 46 24 L 48 14 L 50 23" fill={`url(#${id}-h)`} stroke="#DAA520" strokeWidth="0.3" />

          {/* === EYE — crimson with inner glow === */}
          {/* Eye glow halo */}
          <circle cx="56" cy="38" r="6"
            fill={`url(#${id}-e)`}
            filter={`url(#${id}-eg)`}
            className="dragon-eye"
            opacity="0.5"
          />
          {/* Eye main */}
          <ellipse cx="56" cy="38" rx="4" ry="3.5"
            fill={`url(#${id}-e)`}
            className="dragon-eye"
          />
          {/* Pupil slit */}
          <ellipse cx="57" cy="38" rx="1.2" ry="3"
            fill="#2a0000"
          />
          {/* Eye highlight */}
          <circle cx="54.5" cy="36.5" r="1.2" fill="white" opacity="0.7" />

          {/* Brow ridge */}
          <path d="M 48 34 C 52 32, 60 32, 64 34"
            stroke="#B8860B" strokeWidth="1" strokeLinecap="round" fill="none" />
        </g>
      </svg>
    </div>
  );
}
