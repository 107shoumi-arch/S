export type Market = 'TWSE' | 'TPEx';
export type InstrumentKind = 'stock' | 'etf' | 'bond-etf';

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  asOf: string;
  source: string;
  market: Market;
  kind: InstrumentKind;
  delayed: true;
}

export interface MarketIndex {
  name: string;
  value: number;
  change: number | null;
  asOf: string;
  source: string;
}

export interface MarketResponse {
  quotes: Quote[];
  index: MarketIndex | null;
  fetchedAt: string;
  errors: string[];
  cached: boolean;
}

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HistoryResponse {
  candles: Candle[];
  source: string;
  asOf: string | null;
  errors: string[];
}
