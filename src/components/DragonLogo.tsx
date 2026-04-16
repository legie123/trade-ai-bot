'use client';

/**
 * DragonLogo — Premium crystalline dragon, gold 3D vectorial.
 * Breathing animation via CSS keyframes. Pure SVG, no deps.
 */
export default function DragonLogo({ size = 36 }: { size?: number }) {
  const id = 'dl' + Math.random().toString(36).slice(2, 6);
  return (
    <div
      className="dragon-logo-wrap"
      style={{ width: size, height: size, flexShrink: 0 }}
    >
      <svg
        viewBox="0 0 120 120"
        width={size}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="dragon-logo-svg"
        aria-label="Trade AI Dragon Logo"
        role="img"
      >
        <defs>
          {/* Gold crystal gradient */}
          <linearGradient id={`${id}-gold`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFD700" />
            <stop offset="30%" stopColor="#DAA520" />
            <stop offset="60%" stopColor="#F5C842" />
            <stop offset="100%" stopColor="#B8860B" />
          </linearGradient>
          {/* Deep gold for shadow facets */}
          <linearGradient id={`${id}-deep`} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#8B6914" />
            <stop offset="50%" stopColor="#DAA520" />
            <stop offset="100%" stopColor="#FFD700" />
          </linearGradient>
          {/* Highlight facet */}
          <linearGradient id={`${id}-hi`} x1="0%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stopColor="#FFF8DC" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#FFD700" stopOpacity="0.3" />
          </linearGradient>
          {/* Eye glow */}
          <radialGradient id={`${id}-eye`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FF4444" />
            <stop offset="60%" stopColor="#CC0000" />
            <stop offset="100%" stopColor="#8B0000" />
          </radialGradient>
          {/* Outer glow filter */}
          <filter id={`${id}-glow`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feColorMatrix in="blur" type="matrix"
              values="1 0.8 0 0 0  0.7 0.5 0 0 0  0 0 0 0 0  0 0 0 0.6 0"
              result="gold" />
            <feMerge>
              <feMergeNode in="gold" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* 3D bevel */}
          <filter id={`${id}-bevel`} x="-5%" y="-5%" width="110%" height="110%">
            <feSpecularLighting surfaceScale="4" specularConstant="0.8" specularExponent="20"
              lightingColor="#FFF8DC" result="spec">
              <fePointLight x="40" y="20" z="80" />
            </feSpecularLighting>
            <feComposite in="spec" in2="SourceAlpha" operator="in" result="specOut" />
            <feComposite in="SourceGraphic" in2="specOut" operator="arithmetic"
              k1="0" k2="1" k3="0.4" k4="0" />
          </filter>
        </defs>

        <g filter={`url(#${id}-glow)`}>
          {/* === DRAGON HEAD — crystalline facets === */}
          <g filter={`url(#${id}-bevel)`}>
            {/* Skull top — large crystal facet */}
            <polygon
              points="60,12 38,38 60,30 82,38"
              fill={`url(#${id}-gold)`}
              stroke="#B8860B" strokeWidth="0.5"
            />
            {/* Left skull */}
            <polygon
              points="38,38 28,56 48,52 60,30"
              fill={`url(#${id}-deep)`}
              stroke="#8B6914" strokeWidth="0.5"
            />
            {/* Right skull */}
            <polygon
              points="82,38 92,56 72,52 60,30"
              fill={`url(#${id}-deep)`}
              stroke="#8B6914" strokeWidth="0.5"
            />
            {/* Snout center */}
            <polygon
              points="48,52 60,30 72,52 60,68"
              fill={`url(#${id}-gold)`}
              stroke="#DAA520" strokeWidth="0.4"
            />
            {/* Left jaw */}
            <polygon
              points="28,56 48,52 40,76 22,68"
              fill={`url(#${id}-deep)`}
              stroke="#8B6914" strokeWidth="0.5"
            />
            {/* Right jaw */}
            <polygon
              points="92,56 72,52 80,76 98,68"
              fill={`url(#${id}-deep)`}
              stroke="#8B6914" strokeWidth="0.5"
            />
            {/* Lower snout */}
            <polygon
              points="48,52 60,68 72,52 80,76 60,82 40,76"
              fill={`url(#${id}-gold)`}
              stroke="#DAA520" strokeWidth="0.4"
            />
            {/* Chin */}
            <polygon
              points="40,76 60,82 80,76 68,96 60,100 52,96"
              fill={`url(#${id}-deep)`}
              stroke="#8B6914" strokeWidth="0.5"
            />

            {/* === HORNS — sharp crystal spikes === */}
            {/* Left horn */}
            <polygon
              points="38,38 18,10 30,34"
              fill={`url(#${id}-hi)`}
              stroke="#DAA520" strokeWidth="0.6"
            />
            <polygon
              points="18,10 30,34 38,38 28,18"
              fill={`url(#${id}-gold)`}
              stroke="#B8860B" strokeWidth="0.4"
              opacity="0.7"
            />
            {/* Right horn */}
            <polygon
              points="82,38 102,10 90,34"
              fill={`url(#${id}-hi)`}
              stroke="#DAA520" strokeWidth="0.6"
            />
            <polygon
              points="102,10 90,34 82,38 92,18"
              fill={`url(#${id}-gold)`}
              stroke="#B8860B" strokeWidth="0.4"
              opacity="0.7"
            />

            {/* === CROWN SPIKES — small crystals on top === */}
            <polygon points="50,18 46,6 54,14" fill={`url(#${id}-hi)`} stroke="#DAA520" strokeWidth="0.3" />
            <polygon points="60,12 58,2 62,2" fill={`url(#${id}-hi)`} stroke="#FFD700" strokeWidth="0.3" />
            <polygon points="70,18 74,6 66,14" fill={`url(#${id}-hi)`} stroke="#DAA520" strokeWidth="0.3" />

            {/* === HIGHLIGHT FACETS — 3D depth === */}
            <polygon
              points="60,30 52,20 60,12 68,20"
              fill={`url(#${id}-hi)`}
              opacity="0.4"
            />
            <polygon
              points="60,68 54,58 66,58"
              fill="rgba(255,248,220,0.25)"
            />
          </g>

          {/* === EYES — glowing red === */}
          <ellipse cx="44" cy="46" rx="5" ry="4"
            fill={`url(#${id}-eye)`}
            className="dragon-eye"
          />
          <ellipse cx="76" cy="46" rx="5" ry="4"
            fill={`url(#${id}-eye)`}
            className="dragon-eye"
          />
          {/* Eye highlights */}
          <circle cx="42" cy="44" r="1.5" fill="white" opacity="0.8" />
          <circle cx="74" cy="44" r="1.5" fill="white" opacity="0.8" />

          {/* === NOSTRIL GLOW === */}
          <ellipse cx="54" cy="64" rx="2" ry="1.5" fill="#CC0000" opacity="0.5" className="dragon-nostril" />
          <ellipse cx="66" cy="64" rx="2" ry="1.5" fill="#CC0000" opacity="0.5" className="dragon-nostril" />
        </g>

        {/* === NECK SCALES — crystal pattern below === */}
        <polygon points="52,96 48,108 54,104 60,110 66,104 72,108 68,96 60,100"
          fill={`url(#${id}-deep)`} stroke="#8B6914" strokeWidth="0.4" opacity="0.7" />
        <polygon points="54,104 50,116 58,112 60,118 62,112 70,116 66,104 60,110"
          fill={`url(#${id}-gold)`} stroke="#B8860B" strokeWidth="0.3" opacity="0.5" />
      </svg>
    </div>
  );
}
