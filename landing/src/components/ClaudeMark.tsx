/** Claude app icon: coral squircle with the twelve-petal burst */
export function ClaudeMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="#DA7757" />
      <g fill="#FCF2EE" transform="translate(12 12)">
        {Array.from({ length: 12 }, (_, i) => (
          <path
            key={i}
            d="M0 -8.55 C.7 -8.55 1.25 -6.6 1.35 -4.35 C1.45 -2.4 .75 -1.35 0 -1.35 C-.75 -1.35 -1.45 -2.4 -1.35 -4.35 C-1.25 -6.6 -.7 -8.55 0 -8.55Z"
            transform={`rotate(${i * 30})`}
          />
        ))}
        <circle r="2.55" />
      </g>
    </svg>
  )
}
