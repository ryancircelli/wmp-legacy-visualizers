// The canvas the visualizers paint. Skins place it; the app's ticker owns the engine and the loop.
import { createContext, useContext, useEffect, useRef } from 'react';
import type { Ticker } from './ticker';

export const TickerContext = createContext<Ticker | null>(null);

export function Visualizer(props: { className?: string; id?: string; onDoubleClick?: () => void }) {
  const ticker = useContext(TickerContext), ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => (ticker && ref.current ? ticker.attach(ref.current) : undefined), [ticker]);
  return <canvas ref={ref} className={props.className} id={props.id} onDoubleClick={props.onDoubleClick} />;
}
