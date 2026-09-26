import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/tokens.css';
import './ui/base.css';
import { App } from './app/App';
import { RootErrorBoundary } from './diagnostics/ErrorBoundary';
import { installGlobalHandlers, reportError } from './diagnostics/globalHandlers';
import { configureRendererLogging } from './diagnostics/logger';

configureRendererLogging(window.forge.isDev);
installGlobalHandlers();

const container = document.getElementById('root');
if (!container) throw new Error('#root element missing from index.html');

createRoot(container, {
  // Errors caught by our boundaries are logged by the boundary; these hooks
  // route React's own reporting to electron-log instead of the console.
  onCaughtError: () => undefined,
  onUncaughtError: (error, info) => reportError('uncaught React error', error, info.componentStack),
  onRecoverableError: (error, info) => reportError('recoverable React error', error, info.componentStack),
}).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
);
