/**
 * Fetch historical candlesticks from Hyperliquid (candleSnapshot).
 */

import type { CandleInterval, CandleSnapshotItem } from "./hyperliquid";

const INFO_URL = "https://api.hyperliquid.xyz/info";

export type { CandleInterval, CandleSnapshotItem };

/**
 * Fetches candlestick data for a symbol. Returns array ordered by time (oldest first).
 * Need at least 75+ bars for 55-period Donchian + 20-period ATR; request 100–120 to be safe.
 */
export async function fetchCandles(
  coin: string,
  interval: CandleInterval,
  startTime: number,
  endTime: number
): Promise<CandleSnapshotItem[]> {
  const res = await fetch(INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "candleSnapshot",
      req: { coin, interval, startTime, endTime },
    }),
  });
  if (!res.ok) throw new Error(`candleSnapshot: ${res.status}`);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  const arr = data as CandleSnapshotItem[];
  arr.sort((a, b) => a.t - b.t);
  return arr;
}
