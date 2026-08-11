/** Official Jargon mark: equal-size coral circle, navy star, gold square in a triangle */
export function LogoMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`logo-mark ${className}`}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Coral circle — top left */}
      <circle cx="14.5" cy="14.5" r="7.5" fill="#e4674c" />

      {/* Navy star — top right, enlarged + thickened to match visual weight */}
      <path
        fill="#131f22"
        d="M33.5 5.3 L37.74 10.26 L42.7 14.5 L37.74 18.74 L33.5 23.7 L29.26 18.74 L24.3 14.5 L29.26 10.26 Z"
      />

      {/* Gold rounded square — bottom center */}
      <rect x="16.5" y="27.5" width="15" height="15" rx="3.75" fill="#f4c354" />
    </svg>
  )
}
