/**
 * NetGeo entry point.
 * Mounts <App/> with a single QueryClient (server-state cache) and the global
 * design-system stylesheet. React Query handles fetch dedupe/caching so the
 * shell stays light; realtime updates flow through the WS channels, not polling.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
// Design-system fonts (design §2.3): Geist Sans (headings), Inter (body),
// JetBrains Mono (IP/CLI/ledger). Variable `wght` axis only = lightest bundle;
// unicode-range in each @font-face lazy-loads only the latin subset at runtime.
import '@fontsource-variable/geist/wght.css';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './theme/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
