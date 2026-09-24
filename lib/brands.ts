const BRAND_ALIASES = new Map<string, string>([
  ["3djp", "3DJP"],
  ["猫空", "猫的天空之城"],
  ["猫的天空之城", "猫的天空之城"],
  ["heye", "HEYE"],
  ["toi", "Toi图益"],
  ["toi图益", "Toi图益"],
  ["toi/toi", "Toi图益"],
]);

export function normalizeBrandSearch(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, "");
}

export function canonicalizeKnownBrand(value: string): string {
  const text = value.normalize("NFKC").trim();
  if (!text) return "";

  return BRAND_ALIASES.get(normalizeBrandSearch(text)) ?? text;
}

export function isKnownBrand(
  value: string,
  brands: string[],
): boolean {
  const target = normalizeBrandSearch(
    canonicalizeKnownBrand(value),
  );

  if (!target) return true;

  return brands.some(
    (brand) =>
      normalizeBrandSearch(
        canonicalizeKnownBrand(brand),
      ) === target,
  );
}
