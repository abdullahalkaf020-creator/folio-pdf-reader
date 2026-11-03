import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />,
);

// Cache the web app shell for offline browser use. Capacitor builds ship their assets locally
// and deliberately skip service workers to avoid interfering with the native bridge.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.warn('Folio offline worker could not be registered:', error);
    });
  });
}
