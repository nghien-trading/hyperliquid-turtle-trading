"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AllMidsResponse, MetaAsset, MetaResponse, WsMessage } from "../lib/hyperliquid";
import TurtleDonchianPanel from "./TurtleDonchianPanel";
import TradingView from "./TradingView";

const INFO_URL = "https://api.hyperliquid.xyz/info";
const WS_URL = "wss://api.hyperliquid.xyz/ws";

const STORAGE_KEY = "hyperliquid-selected-symbols";
const POLL_INTERVAL_STORAGE_KEY = "hyperliquid-poll-interval";

export type PollInterval = "5m" | "15m" | "1h" | "4h";

const POLL_INTERVAL_MS: Record<PollInterval, number> = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
};

/** Next UTC boundary (e.g. 0h00m00s, 0h05m00s for 5m) in ms since epoch */
function getNextBoundaryMs(intervalMs: number): number {
  return Math.ceil(Date.now() / intervalMs) * intervalMs;
}

function formatUtcTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getUTCHours().toString().padStart(2, "0");
  const m = d.getUTCMinutes().toString().padStart(2, "0");
  const s = d.getUTCSeconds().toString().padStart(2, "0");
  return `${h}:${m}:${s} UTC`;
}

function loadSelectedFromStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.every((x) => typeof x === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function saveSelectedToStorage(symbols: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
  } catch {
    // ignore
  }
}

function loadPollIntervalFromStorage(): PollInterval {
  if (typeof window === "undefined") return "5m";
  try {
    const raw = localStorage.getItem(POLL_INTERVAL_STORAGE_KEY);
    if (raw === "5m" || raw === "15m" || raw === "1h" || raw === "4h") return raw;
  } catch {
    // ignore
  }
  return "5m";
}

function savePollIntervalToStorage(interval: PollInterval) {
  try {
    localStorage.setItem(POLL_INTERVAL_STORAGE_KEY, JSON.stringify(interval));
  } catch {
    // ignore
  }
}

function formatPrice(priceStr: string | undefined, decimals: number = 4): string {
  if (priceStr == null || priceStr === "") return "—";
  const n = Number(priceStr);
  if (Number.isNaN(n)) return priceStr;
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

const PROGRESS_CIRCLE_SIZE = 32;
const PROGRESS_CIRCLE_R = 14;
const PROGRESS_CIRCLE_C = 2 * Math.PI * PROGRESS_CIRCLE_R;

function NextRefreshProgressCircle({
  nextRefreshAt,
  intervalMs,
  now,
}: {
  nextRefreshAt: number;
  intervalMs: number;
  now: number;
}) {
  const remaining = Math.max(0, nextRefreshAt - now);
  const progress = intervalMs > 0 ? 1 - remaining / intervalMs : 0;
  const clamped = Math.max(0, Math.min(1, progress));
  const strokeDashoffset = PROGRESS_CIRCLE_C * (1 - clamped);
  return (
    <svg
      width={PROGRESS_CIRCLE_SIZE}
      height={PROGRESS_CIRCLE_SIZE}
      viewBox={`0 0 ${PROGRESS_CIRCLE_SIZE} ${PROGRESS_CIRCLE_SIZE}`}
      className="shrink-0"
      aria-label={`Time until next refresh: ${Math.ceil(remaining / 1000)}s`}
    >
      <circle
        cx={PROGRESS_CIRCLE_SIZE / 2}
        cy={PROGRESS_CIRCLE_SIZE / 2}
        r={PROGRESS_CIRCLE_R}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        className="text-border"
      />
      <circle
        cx={PROGRESS_CIRCLE_SIZE / 2}
        cy={PROGRESS_CIRCLE_SIZE / 2}
        r={PROGRESS_CIRCLE_R}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeDasharray={PROGRESS_CIRCLE_C}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        className="text-accent transition-[stroke-dashoffset] duration-1000 ease-linear"
        style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
      />
    </svg>
  );
}

export default function HyperliquidPrices() {
  const [universe, setUniverse] = useState<MetaAsset[]>([]);
  const [mids, setMids] = useState<AllMidsResponse>({});
  const [selected, setSelected] = useState<string[]>(() => loadSelectedFromStorage());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [pollInterval, setPollInterval] = useState<PollInterval>(() => loadPollIntervalFromStorage());
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const [clock, setClock] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchMeta = useCallback(async () => {
    const res = await fetch(INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "meta" }),
    });
    if (!res.ok) throw new Error(`meta: ${res.status}`);
    const data = (await res.json()) as MetaResponse;
    return data.universe ?? [];
  }, []);

  const fetchAllMids = useCallback(async () => {
    const res = await fetch(INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
    });
    if (!res.ok) throw new Error(`allMids: ${res.status}`);
    const data = (await res.json()) as AllMidsResponse;
    return data;
  }, []);

  const fetchAllMidsRef = useRef(fetchAllMids);
  fetchAllMidsRef.current = fetchAllMids;

  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      reconnectAttempts.current = 0;
      ws.send(
        JSON.stringify({
          method: "subscribe",
          subscription: { type: "allMids", dex: "" },
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WsMessage;
        if (msg.channel !== "allMids" || !msg.data || typeof msg.data !== "object" || Array.isArray(msg.data)) return;
        const data = msg.data as Record<string, unknown>;
        const valid: Record<string, string> = {};
        for (const [k, v] of Object.entries(data)) {
          if (typeof k === "string" && typeof v === "string") valid[k] = v;
        }
        if (Object.keys(valid).length === 0) return;
        setMids((prev) => ({ ...prev, ...valid }));
        setLastUpdate(Date.now());
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
      wsRef.current = null;
      const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30000);
      reconnectAttempts.current += 1;
      reconnectTimeoutRef.current = setTimeout(connectWs, delay);
    };

    ws.onerror = () => {
      // close will fire and trigger reconnect
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);

    (async () => {
      try {
        const [metaUniverse, initialMids] = await Promise.all([fetchMeta(), fetchAllMids()]);
        if (cancelled) return;
        setUniverse(metaUniverse);
        if (initialMids && typeof initialMids === "object" && !Array.isArray(initialMids) && Object.keys(initialMids).length > 0) {
          setMids(initialMids);
          setLastUpdate(Date.now());
        }
        connectWs();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsConnected(false);
    };
  }, [fetchMeta, fetchAllMids, connectWs]);

  useEffect(() => {
    saveSelectedToStorage(selected);
  }, [selected]);

  useEffect(() => {
    savePollIntervalToStorage(pollInterval);
  }, [pollInterval]);

  useEffect(() => {
    if (loading) return;
    const intervalMs = POLL_INTERVAL_MS[pollInterval];

    function schedule() {
      const next = getNextBoundaryMs(intervalMs);
      setNextRefreshAt(next);
      const delay = Math.max(0, next - Date.now());
      pollTimeoutRef.current = setTimeout(async () => {
        try {
          const data = await fetchAllMidsRef.current();
          if (data && typeof data === "object" && !Array.isArray(data) && Object.keys(data).length > 0) {
            setMids(data);
            setLastUpdate(Date.now());
          }
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Poll failed");
        }
        schedule();
      }, delay);
    }
    schedule();
    return () => {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    };
  }, [pollInterval, loading]);

  useEffect(() => {
    if (nextRefreshAt == null) return;
    setClock(Date.now());
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [nextRefreshAt]);

  const toggleSymbol = (symbol: string) => {
    setSelected((prev) =>
      prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol]
    );
  };

  const removeSymbol = (symbol: string) => {
    setSelected((prev) => prev.filter((s) => s !== symbol));
  };

  const handleRefresh = async () => {
    setError(null);
    try {
      const next = await fetchAllMids();
      if (next && typeof next === "object" && !Array.isArray(next) && Object.keys(next).length > 0) {
        setMids(next);
        setLastUpdate(Date.now());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    }
  };

  const searchLower = search.trim().toLowerCase();
  const filteredUniverse = searchLower
    ? universe.filter((a) => a.name.toLowerCase().includes(searchLower))
    : universe;

  const nameToAsset = new Map(universe.map((a) => [a.name, a]));

  return (
    <div className="flex min-h-screen flex-col bg-background font-sans">
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        <header className="mb-6">
          <p className="mb-1 text-sm font-medium uppercase tracking-wider text-accent">
            Nghiện Trading
          </p>
          <h1 className="mb-1.5 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Hyperliquid Turtle Trading
          </h1>
          <p className="mb-6 text-sm text-muted">
            Select assets to watch. Prices refresh at exact UTC boundaries (e.g. 0h00m00s, 0h05m00s).
          </p>
        </header>

        {/* Poll interval: above chart and drives both price refresh and chart timeframe */}
        <section className="mb-4 rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-foreground">
              Interval
            </span>
            <div className="flex gap-1.5">
              {(["5m", "15m", "1h", "4h"] as const).map((interval) => (
                <button
                  key={interval}
                  type="button"
                  onClick={() => setPollInterval(interval)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    pollInterval === interval
                      ? "bg-accent text-white shadow-sm"
                      : "bg-background text-muted hover:bg-surface-hover hover:text-foreground border border-border"
                  }`}
                >
                  {interval}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted">
              Prices & chart timeframe
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-border pt-3">
            <span className="flex items-center gap-2 text-sm text-muted">
              {wsConnected ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-success" aria-hidden /> Live
                </>
              ) : (
                <>
                  <span className="h-2 w-2 rounded-full bg-warning animate-pulse" aria-hidden /> Reconnecting…
                </>
              )}
            </span>
            {lastUpdate != null && (
              <span className="text-xs text-muted">
                Updated {new Date(lastUpdate).toLocaleTimeString()}
              </span>
            )}
            {nextRefreshAt != null && (
              <span className="flex items-center gap-2 text-xs text-muted">
                <NextRefreshProgressCircle
                  nextRefreshAt={nextRefreshAt}
                  intervalMs={POLL_INTERVAL_MS[pollInterval]}
                  now={clock || nextRefreshAt - POLL_INTERVAL_MS[pollInterval]}
                />
                Next refresh at {formatUtcTime(nextRefreshAt)}
              </span>
            )}
            <button
              type="button"
              onClick={handleRefresh}
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover"
            >
              Refresh now
            </button>
          </div>
        </section>

        <section className="mb-8 overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="h-[420px] w-full">
            <TradingView interval={pollInterval} />
          </div>
        </section>

        {loading && (
          <p className="text-sm text-muted">Loading universe and prices…</p>
        )}
        {error && (
          <div className="mb-4 rounded-xl border px-4 py-3 text-sm shadow-sm" style={{ borderColor: 'var(--error-border)', background: 'var(--error-bg)', color: 'var(--error-text)' }}>
            {error}
          </div>
        )}

        {!loading && universe.length > 0 && (
          <>
            <section className="mb-6 rounded-xl border border-border bg-surface p-4 shadow-sm">
              <label className="mb-2 block text-sm font-medium text-foreground">
                Add asset
              </label>
              <input
                type="text"
                placeholder="Search by symbol (e.g. BTC, PPL, Perplexity…)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-foreground placeholder-muted transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
              <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border bg-background">
                {filteredUniverse.length === 0 ? (
                  <p className="p-3 text-sm text-muted">No matching assets</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {filteredUniverse.slice(0, 100).map((asset) => (
                      <li key={asset.name} className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-hover">
                        <input
                          type="checkbox"
                          id={`asset-${asset.name}`}
                          checked={selected.includes(asset.name)}
                          onChange={() => toggleSymbol(asset.name)}
                          className="h-4 w-4 rounded border-border text-accent focus:ring-2 focus:ring-accent/30 focus:ring-offset-0"
                        />
                        <label
                          htmlFor={`asset-${asset.name}`}
                          className="flex-1 cursor-pointer text-sm text-foreground"
                        >
                          {asset.name}
                        </label>
                        <span className="text-xs text-muted">
                          max {asset.maxLeverage}x
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            {selected.length === 0 ? (
              <p className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted shadow-sm">
                Select one or more assets above to see live mid prices.
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border bg-accent-muted/50">
                      <th className="px-4 py-3 font-medium text-foreground">
                        Symbol
                      </th>
                      <th className="px-4 py-3 font-medium text-foreground">
                        Mid price
                      </th>
                      <th className="px-4 py-3 font-medium text-foreground">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {selected.map((symbol) => {
                      const asset = nameToAsset.get(symbol);
                      const decimals = asset?.szDecimals ?? 4;
                      const price = mids[symbol];
                      return (
                        <React.Fragment key={symbol}>
                          <tr className="transition-colors hover:bg-surface-hover">
                            <td className="px-4 py-3 font-medium text-foreground">
                              {symbol}
                            </td>
                            <td className="px-4 py-3 font-mono text-foreground">
                              {formatPrice(price, decimals)}
                            </td>
                            <td className="px-4 py-3">
                              <a
                                href={`https://app.hyperliquid.xyz/trade/${symbol}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-accent hover:underline"
                              >
                                Trade
                              </a>
                              {" · "}
                              <button
                                type="button"
                                onClick={() => removeSymbol(symbol)}
                                className="font-medium text-muted hover:text-foreground hover:underline"
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                          <tr>
                            <td colSpan={3} className="bg-background/50 p-0">
                              <TurtleDonchianPanel
                                symbol={symbol}
                                currentMid={mids[symbol]}
                                asset={asset}
                                pollInterval={pollInterval}
                                refreshTrigger={lastUpdate}
                              />
                            </td>
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
