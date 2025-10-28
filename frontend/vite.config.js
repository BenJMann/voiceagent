import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dotenv from 'dotenv';
import path from 'path';

export default defineConfig(({ mode }) => {
  const envFile = path.resolve(process.cwd(), '.env');
  const result = dotenv.config({ path: envFile });
  const envVars = result.parsed || {};

  return {
    plugins: [react()],
    server: {
      port: Number(envVars.VITE_PORT) || 5173,
    },
    define: {
      'process.env': envVars,
    },
  };
});
