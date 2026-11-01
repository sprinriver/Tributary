import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { router } from './router.tsx';
import { applyTheme, initialTheme } from './shell/theme.ts';
import './styles.css';
import './shell.css';

// Before the first paint, so the saved theme never flashes.
applyTheme(initialTheme());

const queryClient = new QueryClient();
const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
