"use client";
import { memo, useEffect, useRef } from "react";

export type ChartInterval = "5m" | "15m" | "1h" | "4h";

/** Map poll-style interval to TradingView resolution string (minutes). */
const INTERVAL_TO_TV: Record<ChartInterval, string> = {
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "240",
};

/** Default/favorite chart intervals — match our poll intervals (5m, 15m, 1h, 4h). */
const SUPPORTED_RESOLUTIONS = ["5", "15", "60", "240"];

/**
 * Watchlist of symbols aligned with Hyperliquid perpetuals.
 * TradingView's free widget data does not include Hyperliquid exchange
 * (see https://www.tradingview.com/widget-docs/markets/worldwide), so we use
 * Binance perpetuals (BINANCE:SYMBOLUSDT.P) for the same assets.
 */
const HYPERLIQUID_STYLE_WATCHLIST = [
  "BINANCE:BTCUSDT.P",
  "BINANCE:ETHUSDT.P",
  "BINANCE:SOLUSDT.P",
  "BINANCE:AVAXUSDT.P",
  "BINANCE:DOGEUSDT.P",
  "BINANCE:LINKUSDT.P",
  "BINANCE:SUIUSDT.P",
  "BINANCE:ARBUSDT.P",
  "BINANCE:OPUSDT.P",
  "BINANCE:APTUSDT.P",
  "BINANCE:NEARUSDT.P",
  "BINANCE:INJUSDT.P",
  "BINANCE:TIAUSDT.P",
  "BINANCE:WLDUSDT.P",
  "BINANCE:PEPEUSDT.P",
];

const DEFAULT_SYMBOL = HYPERLIQUID_STYLE_WATCHLIST[0];

interface TradingViewWidgetProps {
  /** Chart timeframe; should match poll interval (5m, 15m, 1h, 4h). */
  interval?: ChartInterval;
}

function TradingViewWidget({ interval = "5m" }: TradingViewWidgetProps) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = container.current;
    if (!parent) return;
    parent.querySelectorAll("script").forEach((s) => s.remove());
    parent.querySelectorAll("iframe").forEach((f) => f.remove());

    const script = document.createElement("script");
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      allow_symbol_change: true,
      calendar: false,
      details: true,
      hide_side_toolbar: true,
      hide_top_toolbar: false,
      hide_legend: false,
      hide_volume: false,
      hotlist: false,
      interval: INTERVAL_TO_TV[interval],
      locale: "en",
      save_image: true,
      style: "1",
      symbol: DEFAULT_SYMBOL,
      theme: "dark",
      timezone: "Etc/UTC",
      backgroundColor: "#0F0F0F",
      gridColor: "rgba(242, 242, 242, 0.06)",
      watchlist: HYPERLIQUID_STYLE_WATCHLIST,
      withdateranges: false,
      compareSymbols: [],
      studies: ["STD;Donchian_Channels"],
      autosize: true,
      support_host: "https://www.tradingview.com",
      // Limit chart interval dropdown to our poll intervals (5m, 15m, 1h, 4h)
      supported_resolutions: SUPPORTED_RESOLUTIONS,
    });
    parent.appendChild(script);
  }, [interval]);

  return (
    <div
      className="tradingview-widget-container"
      ref={container}
      style={{ height: "100%", width: "100%" }}
    >
      <div
        className="tradingview-widget-container__widget"
        style={{ height: "calc(100% - 32px)", width: "100%" }}
      />
      <div className="tradingview-widget-copyright">
        <a
          href="https://www.tradingview.com/symbols/BTCUSDT.P/?exchange=BINANCE"
          rel="noopener nofollow"
          target="_blank"
        >
          <span className="blue-text">Chart</span>
        </a>
        <span className="trademark"> by TradingView</span>
      </div>
    </div>
  );
}

export default memo(TradingViewWidget);
