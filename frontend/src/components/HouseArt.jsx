import React from "react";

// Stylised modern house with a roof of solar panels — the hero render stand-in.
export default function HouseArt() {
  const panels = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      panels.push(
        <rect
          key={`${r}-${c}`}
          x={250 + c * 47}
          y={70 + r * 33}
          width={43}
          height={29}
          rx={2}
          fill="#2c2f36"
          stroke="#444851"
          strokeWidth="1.5"
        />
      );
    }
  }

  return (
    <svg viewBox="0 0 760 420" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <defs>
        <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4f2ee" />
          <stop offset="1" stopColor="#e3e0d8" />
        </linearGradient>
        <linearGradient id="roof" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3d44" />
          <stop offset="1" stopColor="#2a2c31" />
        </linearGradient>
      </defs>

      {/* ground shadow */}
      <ellipse cx="430" cy="392" rx="320" ry="20" fill="#000" opacity="0.06" />

      {/* main house body */}
      <rect x="300" y="210" width="330" height="180" rx="6" fill="url(#wall)" />
      {/* lower-left wing */}
      <rect x="170" y="262" width="150" height="128" rx="6" fill="#eceae3" />

      {/* gable roof with panels */}
      <polygon points="270,210 470,70 670,210" fill="url(#roof)" />
      <polygon points="270,210 470,70 470,210" fill="#000" opacity="0.08" />
      {panels}

      {/* chimney */}
      <rect x="430" y="40" width="20" height="46" rx="2" fill="#33363c" />

      {/* windows */}
      <rect x="340" y="250" width="46" height="46" rx="4" fill="#cfd6da" stroke="#b9c0c4" />
      <rect x="540" y="250" width="46" height="46" rx="4" fill="#cfd6da" stroke="#b9c0c4" />
      <rect x="200" y="300" width="40" height="40" rx="4" fill="#cfd6da" stroke="#b9c0c4" />
      {/* door */}
      <rect x="440" y="300" width="44" height="90" rx="4" fill="#d9b48a" />
      <circle cx="448" cy="345" r="2.5" fill="#8a6b4a" />

      {/* trees */}
      <g>
        <rect x="118" y="330" width="7" height="40" fill="#9a8f7a" />
        <circle cx="121" cy="318" r="26" fill="#bcae8e" opacity="0.85" />
        <circle cx="105" cy="330" r="18" fill="#c8bb9c" opacity="0.8" />
      </g>
      <g>
        <rect x="660" y="345" width="6" height="35" fill="#9a8f7a" />
        <circle cx="663" cy="334" r="20" fill="#c4b694" opacity="0.8" />
      </g>
    </svg>
  );
}
