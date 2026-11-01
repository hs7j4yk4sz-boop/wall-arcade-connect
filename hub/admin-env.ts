// The admin page's stand-ins: none on the real page. Only the preview build (scripts/build-hub.ts --preview) swaps this file for hub/admin-demo.ts.
import type { Eip1193 } from './admin-jackpot.js';

export const demo: null | { wallet: Eip1193; call(body: Record<string, unknown>): Promise<{ code: number; data: unknown }> } = null;
