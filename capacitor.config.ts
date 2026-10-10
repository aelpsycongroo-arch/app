import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aelpsycongroo.warehouse',
  appName: 'Warehouse Blueprint',
  webDir: 'dist',
  android: {
    // Android 15 draws apps edge-to-edge; keep the header clear of the status bar.
    adjustMarginsForEdgeToEdge: 'auto',
  },
};

export default config;
