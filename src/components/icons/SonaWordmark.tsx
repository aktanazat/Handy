const wordmarkText = "Sona";

type SonaWordmarkProps = {
  className?: string;
};

export const SonaWordmark = ({ className }: SonaWordmarkProps) => (
  <span
    className={`font-sans text-base leading-none font-semibold tracking-[-0.02em] ${className ?? ""}`}
  >
    {wordmarkText}
  </span>
);
