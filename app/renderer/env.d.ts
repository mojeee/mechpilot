/// <reference types="vite/client" />
import type { MechPilotApi } from '@shared/api';

declare global {
  interface Window {
    mechpilot: MechPilotApi;
  }
}
