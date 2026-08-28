const WHOLE_NUMBER_FORMATTER = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const ONE_DECIMAL_FORMATTER = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export const formatModelSize = (sizeMb: number | null | undefined): string => {
  if (!sizeMb || !Number.isFinite(sizeMb) || sizeMb <= 0) {
    return "Unknown size";
  }

  if (sizeMb >= 1024) {
    const sizeGb = sizeMb / 1024;
    const formatter =
      sizeGb >= 10 ? WHOLE_NUMBER_FORMATTER : ONE_DECIMAL_FORMATTER;
    return `${formatter.format(sizeGb)} GB`;
  }

  const formatter =
    sizeMb >= 100 ? WHOLE_NUMBER_FORMATTER : ONE_DECIMAL_FORMATTER;

  return `${formatter.format(sizeMb)} MB`;
};
