import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'id.folio.reader',
  appName: 'Folio PDF Reader',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    captureInput: true,
  },
};

export default config;
