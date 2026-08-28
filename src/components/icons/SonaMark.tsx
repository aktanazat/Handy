type SonaMarkProps = {
  width?: number | string;
  height?: number | string;
  className?: string;
};

export const SonaMark = ({
  width = 24,
  height = 24,
  className,
}: SonaMarkProps) => (
  <svg
    aria-hidden="true"
    className={className}
    fill="none"
    focusable="false"
    height={height}
    viewBox="232 320 576 384"
    width={width}
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle cx="280" cy="512" r="44" fill="currentColor" />
    <path
      d="M424 512c14 0 18-112 64-112 58 0 52 224 112 224 46 0 58-144 104-144h40"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="88"
    />
  </svg>
);
