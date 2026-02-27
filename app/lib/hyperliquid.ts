/**
 * Minimal types for Hyperliquid public API (info + WebSocket).
 * No API keys required for market data.
 */

export interface MetaAsset {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
  isDelisted?: boolean;
  marginMode?: string;
}

export interface MetaResponse {
  universe: MetaAsset[];
  marginTables: unknown;
}

/** Symbol -> mid price (string for precision) */
export type AllMidsResponse = Record<string, string>;

/** WebSocket message: subscription confirmation or data push */
export interface WsMessage {
  channel?: string;
  data?: AllMidsResponse;
  subscription?: { type: string };
}

/** Candlestick interval for candleSnapshot */
export type CandleInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

/** Single candlestick from candleSnapshot (o,c,h,l,v as strings for precision) */
export interface CandleSnapshotItem {
  t: number;
  T: number;
  o: string;
  c: string;
  h: string;
  l: string;
  v: string;
  n: number;
  s: string;
  i: string;
}

/** Request for candleSnapshot */
export interface CandleSnapshotRequest {
  coin: string;
  interval: CandleInterval;
  startTime: number;
  endTime: number;
}
