"use client";

import { useMemo, useState } from "react";
import {
  canonicalizeKnownBrand,
  normalizeBrandSearch,
} from "@/lib/brands";

export function BrandInput({
  value,
  onChange,
  brands,
}: {
  value: string;
  onChange: (value: string) => void;
  brands: string[];
}) {
  const [focused, setFocused] = useState(false);

  const options = useMemo(() => {
    const unique = Array.from(
      new Set(
        brands
          .map(canonicalizeKnownBrand)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b, "zh-CN"));

    const query = normalizeBrandSearch(value);

    if (!query) return unique.slice(0, 12);

    return unique
      .filter((brand) =>
        normalizeBrandSearch(brand).includes(query),
      )
      .slice(0, 12);
  }, [brands, value]);

  return (
    <div className="brandInputWrap">
      <input
        value={value}
        maxLength={80}
        autoComplete="off"
        placeholder="输入或搜索品牌，例如 HEYE"
        onFocus={() => setFocused(true)}
        onBlur={() =>
          window.setTimeout(() => setFocused(false), 120)
        }
        onChange={(event) => onChange(event.target.value)}
      />

      {focused && options.length > 0 && (
        <div className="brandSuggestions">
          {options.map((brand) => (
            <button
              type="button"
              key={brand}
              onMouseDown={(event) => {
                event.preventDefault();
                onChange(brand);
                setFocused(false);
              }}
            >
              {brand}
            </button>
          ))}
        </div>
      )}

      {focused &&
        value.trim() &&
        options.length === 0 && (
          <div className="brandNoMatch">
            暂无匹配品牌，可以作为新品牌发布
          </div>
        )}
    </div>
  );
}
