/**
 * Turtle Trading / Donchian + ATR calculations (pure, deterministic).
 * All signals use last closed candle only.
 */

/** Candle with numeric OHLC for calculations */
export interface Candle {
  o: number;
  c: number;
  h: number;
  l: number;
  v?: number;
}

/** Donchian bands for one bar (index i uses bars [i-n+1, i]) */
export interface DonchianBands {
  upper: number;
  lower: number;
  middle: number;
}

/** Parse API candle strings to numbers */
function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Convert CandleSnapshotItem to Candle */
export function toCandle(item: { o: string; c: string; h: string; l: string; v?: string }): Candle {
  return {
    o: num(item.o),
    c: num(item.c),
    h: num(item.h),
    l: num(item.l),
    v: item.v != null ? num(item.v) : undefined,
  };
}

/** Donchian bands for the last n bars ending at index i (i is last bar). */
export function donchianBands(candles: Candle[], n: number, endIndex: number): DonchianBands | null {
  const start = Math.max(0, endIndex - n + 1);
  const slice = candles.slice(start, endIndex + 1);
  if (slice.length < n) return null;
  let upper = slice[0].h;
  let lower = slice[0].l;
  for (let j = 1; j < slice.length; j++) {
    if (slice[j].h > upper) upper = slice[j].h;
    if (slice[j].l < lower) lower = slice[j].l;
  }
  return { upper, lower, middle: (upper + lower) / 2 };
}

/** True Range for each bar. First bar: TR = H - L. */
export function trueRange(candles: Candle[]): number[] {
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const { h, l } = candles[i];
    const prevC = i > 0 ? candles[i - 1].c : h;
    tr.push(Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC)));
  }
  return tr;
}

/** ATR with Wilder smoothing, period n. Returns array; last value is N. */
export function atr(candles: Candle[], n: number): number[] {
  const tr = trueRange(candles);
  const out: number[] = [];
  if (tr.length < n) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += tr[i];
  out[n - 1] = sum / n;
  for (let i = n; i < tr.length; i++) {
    out.push((out[out.length - 1]! * (n - 1) + tr[i]!) / n);
  }
  return out;
}

/** Breakout direction from close vs bands: long (close > upper), short (close < lower), none. */
export function breakoutSignal(close: number, upper: number, lower: number): "long" | "short" | "none" {
  if (close > upper) return "long";
  if (close < lower) return "short";
  return "none";
}

export type BreakoutType = "true" | "sub" | "none";

/**
 * Classify breakout quality: true (full entry), sub (DCA), none.
 * Long: true = close > upper and close >= upper + threshold*N; sub = wick-only or marginal.
 * Short: true = close < lower and close <= lower - threshold*N; sub = wick-only or marginal.
 */
export function breakoutType(
  candle: Candle,
  upper: number,
  lower: number,
  N: number,
  threshold: number,
  volumeAboveAvg?: boolean
): BreakoutType {
  const { h, l, c } = candle;
  const threshN = threshold * N;

  // Long breakout
  if (c > upper) {
    if (c >= upper + threshN && (volumeAboveAvg !== false)) return "true";
    return "sub"; // marginal (close above but not enough)
  }
  if (h > upper && c <= upper) return "sub"; // wick-only long

  // Short breakout
  if (c < lower) {
    if (c <= lower - threshN && (volumeAboveAvg !== false)) return "true";
    return "sub";
  }
  if (l < lower && c >= lower) return "sub"; // wick-only short

  return "none";
}

/** Position size in base units: (riskPct/100 * account) / (N * price). Round down to szDecimals. */
export function positionSize(
  accountUsd: number,
  riskPct: number,
  N: number,
  price: number,
  szDecimals: number
): number {
  if (N <= 0 || price <= 0) return 0;
  const riskDollars = (riskPct / 100) * accountUsd;
  const size = riskDollars / (N * price);
  const factor = 10 ** szDecimals;
  return Math.floor(size * factor) / factor;
}

export interface SlTpLevels {
  sl: number;
  tp?: number;
  trailingExit?: number;
}

/** SL = 2N from entry. Optional TP (e.g. 2:1 => 4N). Optional trailing exit level (Donchian opposite band). */
export function slTpLevels(
  entry: number,
  N: number,
  isLong: boolean,
  options?: { tpMultiple?: number; trailingExit?: number }
): SlTpLevels {
  const sl = isLong ? entry - 2 * N : entry + 2 * N;
  const out: SlTpLevels = { sl };
  if (options?.tpMultiple != null && options.tpMultiple > 0) {
    out.tp = isLong ? entry + options.tpMultiple * N : entry - options.tpMultiple * N;
  }
  if (options?.trailingExit != null) out.trailingExit = options.trailingExit;
  return out;
}

export type Strength = "none" | "weak" | "medium" | "strong";

export interface Evaluation {
  direction: "long" | "short" | "none";
  strength: Strength;
  breakoutType: BreakoutType;
  tag: string;
  suggestion: string;
}

/**
 * Evaluation from last closed candle: direction, strength (20/55 agreement), breakout type.
 * Candles must already have at least 55 + 20 for warmup; use last index = candles.length - 1.
 */
export function evaluationTag(
  candles: Candle[],
  lenEntry: number,
  lenExit: number,
  len55: number,
  N: number,
  threshold: number,
  useVolumeFilter: boolean
): Evaluation | null {
  const lastIdx = candles.length - 1;
  if (lastIdx < len55) return null;

  const last = candles[lastIdx]!;
  const bandsEntry = donchianBands(candles, lenEntry, lastIdx);
  const bands55 = donchianBands(candles, len55, lastIdx);
  if (!bandsEntry || !bands55) return null;

  const dir = breakoutSignal(last.c, bandsEntry.upper, bandsEntry.lower);
  const volRatio =
    useVolumeFilter && last.v != null && candles.length >= 21
      ? (() => {
          let sum = 0;
          for (let i = lastIdx - 20; i < lastIdx; i++) sum += candles[i]?.v ?? 0;
          const avg = sum / 20;
          return avg > 0 ? (last.v ?? 0) / avg : 1;
        })()
      : undefined;
  const volumeAboveAvg = volRatio == null ? undefined : volRatio >= 1;

  const bt = breakoutType(last, bandsEntry.upper, bandsEntry.lower, N, threshold, volumeAboveAvg);

  // Strength: both 20 and 55 agree = strong; 55 only = medium; entry (20) only = weak
  let strength: Strength = "none";
  if (dir === "long") {
    const aboveEntry = last.c > bandsEntry.upper;
    const above55 = last.c > bands55.upper;
    if (aboveEntry && above55) strength = "strong";
    else if (above55) strength = "medium";
    else if (aboveEntry) strength = "weak";
  } else if (dir === "short") {
    const belowEntry = last.c < bandsEntry.lower;
    const below55 = last.c < bands55.lower;
    if (belowEntry && below55) strength = "strong";
    else if (below55) strength = "medium";
    else if (belowEntry) strength = "weak";
  }

  const dirLabel = dir === "none" ? "None" : dir === "long" ? "Long" : "Short";
  const btLabel = bt === "true" ? "True (full)" : bt === "sub" ? "Sub (DCA)" : "None";
  const tag = dir === "none" ? "None" : `${dirLabel} – ${strength} – ${btLabel}`;
  const suggestion =
    dir === "none"
      ? "No breakout; no entry."
      : bt === "true"
        ? "Full Turtle position size at current mid."
        : bt === "sub"
          ? "DCA: use ½ unit or 1st tranche; add on confirmation."
          : "No entry.";

  return {
    direction: dir,
    strength,
    breakoutType: bt,
    tag,
    suggestion,
  };
}

/** Get Donchian bands for exit period (e.g. 10 or 20) for trailing exit level. */
export function trailingExitLevel(
  candles: Candle[],
  exitPeriod: number,
  isLong: boolean,
  endIndex: number
): number | null {
  const bands = donchianBands(candles, exitPeriod, endIndex);
  if (!bands) return null;
  return isLong ? bands.lower : bands.upper;
}
