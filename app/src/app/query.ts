// The QueryClient (ARCHITECTURE v7.1): fetched data cached per key for the page's life, so a
// view switch never refetches; no refetch on window focus (a desktop app, and Spotify's page
// under the overlay takes focus all the time); retries as the engine's adapter says (the 429
// gate waits Retry-After).
import { QueryClient } from '@tanstack/react-query';
import type { Queries } from '../adapters';

export function createQueryClient(queries: Pick<Queries, 'retryPolicy'> & Partial<Pick<Queries, 'setInvalidator'>>): QueryClient {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 60 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: queries.retryPolicy.retry,
        retryDelay: queries.retryPolicy.retryDelay,
      },
    },
  });
  // after a library change (Like, add to a playlist) the adapter names the keys to refetch
  queries.setInvalidator?.((keys) => keys.forEach((k) => void qc.invalidateQueries({ queryKey: k })));
  return qc;
}
