export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="14.5" cy="14.5" r="7.5" fill="#e4674c" />
      <path
        fill="#131f22"
        d="M33.5 5.3 37.74 10.26 42.7 14.5 37.74 18.74 33.5 23.7 29.26 18.74 24.3 14.5 29.26 10.26 Z"
      />
      <rect x="16.5" y="27.5" width="15" height="15" rx="3.75" fill="#f4c354" />
    </svg>
  )
}
