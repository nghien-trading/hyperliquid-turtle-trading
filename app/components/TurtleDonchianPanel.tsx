"use client";

import { useCallback, useEffect, useState } from "react";
import type { MetaAsset } from "../lib/hyperliquid";
import { fetchCandles } from "../lib/candles";
import type { CandleInterval } from "../lib/hyperliquid";
import {
  atr,
  donchianBands,
  evaluationTag,
  positionSize,
  slTpLevels,
  toCandle,
  trailingExitLevel,
} from "../lib/turtle";

const INTERVAL_MS: Record<CandleInterval, number> = {
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

const MIN_CANDLES = 75;
const FETCH_BARS = 120;

/** Poll interval from main page; Turtle candle interval matches this */
export type TurtlePollInterval = "5m" | "15m" | "1h" | "4h";

interface TurtleDonchianPanelProps {
  symbol: string;
  currentMid: string | undefined;
  asset: MetaAsset | undefined;
  /** Candle interval matches the selected poll interval */
  pollInterval: TurtlePollInterval;
  /** When this changes (e.g. on poll refresh or Refresh now), candles are refetched */
  refreshTrigger: number | null;
}

export default function TurtleDonchianPanel({ symbol, currentMid, asset, pollInterval, refreshTrigger }: TurtleDonchianPanelProps) {
  const candleInterval: CandleInterval = pollInterval;
  const [entryPeriod, setEntryPeriod] = useState(20);
  const [exitPeriod, setExitPeriod] = useState(10);
  const [riskPct, setRiskPct] = useState(1);
  const [accountUsd, setAccountUsd] = useState(10000);
  const [trueThreshold, setTrueThreshold] = useState(0.25);
  const [useVolumeFilter, setUseVolumeFilter] = useState(false);
  const [candles, setCandles] = useState<{ o: number; c: number; h: number; l: number; v?: number }[]>([]);
  const [candleError, setCandleError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCandlesForSymbol = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setCandleError(null);
    try {
      const endTime = Date.now();
      const startTime = endTime - FETCH_BARS * INTERVAL_MS[candleInterval];
      const raw = await fetchCandles(symbol, candleInterval, startTime, endTime);
      const converted = raw.map((item) => toCandle(item));
      setCandles(converted);
      if (converted.length < MIN_CANDLES) {
        setCandleError(`Only ${converted.length} bars; need ${MIN_CANDLES}+ for Donchian + ATR.`);
      }
    } catch (e) {
      setCandleError(e instanceof Error ? e.message : "Failed to load candles");
      setCandles([]);
    } finally {
      setLoading(false);
    }
  }, [symbol, candleInterval]);

  useEffect(() => {
    fetchCandlesForSymbol();
  }, [fetchCandlesForSymbol, refreshTrigger]);

  const price = currentMid != null && currentMid !== "" ? Number(currentMid) : null;
  const szDecimals = asset?.szDecimals ?? 4;

  const lastIdx = candles.length - 1;
  const hasEnough = candles.length >= MIN_CANDLES && lastIdx >= 54;
  const candleList: { o: number; c: number; h: number; l: number; v?: number }[] = candles;

  const bandsEntry = hasEnough ? donchianBands(candleList, entryPeriod, lastIdx) : null;
  const bands55 = hasEnough ? donchianBands(candleList, 55, lastIdx) : null;
  const atrValues = atr(candleList, 20);
  const N = atrValues.length > 0 ? atrValues[atrValues.length - 1]! : null;
  const evalResult =
    hasEnough && N != null && N > 0
      ? evaluationTag(candleList, entryPeriod, exitPeriod, 55, N, trueThreshold, useVolumeFilter)
      : null;

  const lastCandle = hasEnough ? candleList[lastIdx]! : null;
  const trailingLong =
    hasEnough && lastIdx >= 0
      ? trailingExitLevel(candleList, exitPeriod, true, lastIdx)
      : null;
  const trailingShort =
    hasEnough && lastIdx >= 0
      ? trailingExitLevel(candleList, exitPeriod, false, lastIdx)
      : null;

  const sizeFull =
    price != null && price > 0 && N != null && N > 0 && accountUsd > 0
      ? positionSize(accountUsd, riskPct, N, price, szDecimals)
      : null;
  const sizeDca = sizeFull != null ? sizeFull * 0.5 : null;

  const isLong = evalResult?.direction === "long";
  const isShort = evalResult?.direction === "short";
  const entry = price ?? 0;
  const levels =
    N != null && price != null && price > 0
      ? isLong
        ? slTpLevels(entry, N, true, {
            tpMultiple: 4,
            trailingExit: trailingLong ?? undefined,
          })
        : isShort
          ? slTpLevels(entry, N, false, {
              tpMultiple: 4,
              trailingExit: trailingShort ?? undefined,
            })
          : null
      : null;

  const formatNum = (n: number, dec: number = 4) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: dec });

  const inputClass =
    "w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";
  const labelClass = "mb-1 block text-xs font-medium text-foreground";

  return (
    <section className="border-t border-border bg-surface px-4 py-4">
      <h2 className="mb-2 text-base font-semibold text-foreground">
        Turtle / Donchian (entry at current mid)
      </h2>

      <p className="mb-3 text-xs text-muted">
        Evaluation is for <strong>entry at current mid</strong> only. We do not have your position;
        size, SL, and exit levels are <strong>if you enter now</strong>.
      </p>

      <p className="mb-4 text-xs text-muted">
        Candle interval: <strong>{candleInterval}</strong> (matches poll interval)
      </p>

      {/* Inputs */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Entry period</label>
          <input
            type="number"
            min={5}
            max={100}
            value={entryPeriod}
            onChange={(e) => setEntryPeriod(Number(e.target.value) || 20)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Exit period</label>
          <input
            type="number"
            min={5}
            max={100}
            value={exitPeriod}
            onChange={(e) => setExitPeriod(Number(e.target.value) || 10)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Risk %</label>
          <input
            type="number"
            min={0.1}
            max={10}
            step={0.1}
            value={riskPct}
            onChange={(e) => setRiskPct(Number(e.target.value) || 1)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Account (USD)</label>
          <input
            type="number"
            min={1}
            value={accountUsd}
            onChange={(e) => setAccountUsd(Number(e.target.value) || 10000)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>True breakout threshold (×N)</label>
          <input
            type="number"
            min={0.1}
            max={1}
            step={0.05}
            value={trueThreshold}
            onChange={(e) => setTrueThreshold(Number(e.target.value) || 0.25)}
            className={inputClass}
          />
        </div>
        <div className="flex items-center gap-2 sm:col-span-2">
          <input
            type="checkbox"
            id="turtle-volume-filter"
            checked={useVolumeFilter}
            onChange={(e) => setUseVolumeFilter(e.target.checked)}
            className="h-4 w-4 rounded border-border text-accent focus:ring-2 focus:ring-accent/30 focus:ring-offset-0"
          />
          <label htmlFor="turtle-volume-filter" className="text-xs text-muted">
            Require volume above 20-bar average for true breakout
          </label>
        </div>
      </div>

      {loading && (
        <p className="mb-2 text-xs text-muted">Loading candles…</p>
      )}

      {candleError && (
        <p className="mb-4 text-sm text-warning">{candleError}</p>
      )}

      {!hasEnough && !loading && candles.length > 0 && (
        <p className="mb-4 text-sm text-muted">
          Need at least {MIN_CANDLES} bars (have {candles.length}). Try a smaller interval or wait.
        </p>
      )}

      {/* Outputs */}
      {hasEnough && (
        <div className="space-y-4 border-t border-border pt-4">
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <span className="text-muted">Donchian (entry)</span>
              <p className="font-mono text-foreground">
                U {bandsEntry ? formatNum(bandsEntry.upper) : "—"} / L{" "}
                {bandsEntry ? formatNum(bandsEntry.lower) : "—"} / M{" "}
                {bandsEntry ? formatNum(bandsEntry.middle) : "—"}
              </p>
            </div>
            <div>
              <span className="text-muted">N (ATR 20)</span>
              <p className="font-mono text-foreground">{N != null ? formatNum(N) : "—"}</p>
            </div>
            <div>
              <span className="text-muted">Last close</span>
              <p className="font-mono text-foreground">{lastCandle ? formatNum(lastCandle.c) : "—"}</p>
            </div>
          </div>

          <div>
            <span className="text-muted">Breakout</span>
            <p className="font-medium capitalize text-foreground">{evalResult?.direction ?? "—"}</p>
          </div>

          <div>
            <span className="text-muted">Breakout type</span>
            <p className="font-medium text-foreground">
              {evalResult?.breakoutType === "true"
                ? "True (full entry)"
                : evalResult?.breakoutType === "sub"
                  ? "Sub (DCA / scale-in)"
                  : "None"}
            </p>
          </div>

          <div>
            <span className="text-muted">Evaluation tag</span>
            <p className="font-medium text-foreground">{evalResult?.tag ?? "—"}</p>
            <p className="mt-1 text-xs text-muted">{evalResult?.suggestion}</p>
          </div>

          <div>
            <span className="text-muted">If you enter now (at current mid)</span>
            <p className="text-xs text-muted">
              Current mid: {price != null ? formatNum(price, szDecimals) : "—"}
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-foreground">
              <li>
                Recommended size (full):{" "}
                {sizeFull != null ? `${formatNum(sizeFull, szDecimals)} base` : "—"}
              </li>
              {evalResult?.breakoutType === "sub" && (
                <li>DCA suggestion: {sizeDca != null ? `${formatNum(sizeDca, szDecimals)} base (½ unit)` : "—"}</li>
              )}
              {levels && (
                <>
                  <li>SL (2N): {formatNum(levels.sl, szDecimals)}</li>
                  {levels.tp != null && <li>TP (4N): {formatNum(levels.tp, szDecimals)}</li>}
                  {levels.trailingExit != null && (
                    <li>Trailing exit level: {formatNum(levels.trailingExit, szDecimals)}</li>
                  )}
                </>
              )}
            </ul>
          </div>

          <p className="text-xs text-muted">
            Entry/exit use last closed candle; SL = 2N; size = {riskPct}% risk; True = full, Sub = DCA.
          </p>
        </div>
      )}
    </section>
  );
}
