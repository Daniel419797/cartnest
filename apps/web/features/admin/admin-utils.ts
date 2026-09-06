export function localDateToIso(value: string, endOfDay = false): string | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}${endOfDay ? "T23:59:59.999" : "T00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function localDateTimeToIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function percentageToBps(value: string): number | undefined {
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(value.trim())) return undefined;
  const [wholeText = "0", fractionText = ""] = value.trim().split(".");
  const whole = Number(wholeText);
  const fraction = Number(fractionText.padEnd(2, "0"));
  const bps = whole * 100 + fraction;
  return Number.isInteger(bps) && bps >= 0 && bps <= 10000 ? bps : undefined;
}

export function nairaToMinor(value: string): string | undefined {
  const trimmed = value.trim().replaceAll(",", "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) return undefined;
  const [whole = "0", fraction = ""] = trimmed.split(".");
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
}
