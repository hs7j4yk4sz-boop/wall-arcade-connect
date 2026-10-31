// The grouped payment of a week: one call to the Disperse contract, signed by the treasury in the admin page. Plain ABI,
// no library, shared by the page (which builds the call) and the service (which reads it back from the chain).
export const DISPERSE = '0xd152f549545093347a162dce210e7293f1452150';
const SELECTOR = 'e63d38ed';                                     // disperseEther(address[],uint256[])
export type Line = { wallet: string; wei: bigint };

const word = (v: bigint): string => v.toString(16).padStart(64, '0');

/** The calldata of disperseEther for these lines. */
export function encodeDisperse(lines: Line[]): string {
  const n = BigInt(lines.length);
  return `0x${SELECTOR}${word(64n)}${word(64n + 32n + 32n * n)}${word(n)}${lines.map((l) => word(BigInt(l.wallet))).join('')}${word(n)}${lines.map((l) => word(l.wei)).join('')}`;
}

/** The lines of a disperseEther call; throws for anything else. */
export function decodeDisperse(data: string): Line[] {
  if (!/^0x[0-9a-fA-F]*$/.test(data) || data.slice(2, 10).toLowerCase() !== SELECTOR) throw new Error('not disperseEther');
  const body = data.slice(10), at = (i: number): bigint => {
    const w = body.slice(i * 64, i * 64 + 64);
    if (w.length !== 64) throw new Error('short call');
    return BigInt(`0x${w}`);
  };
  const first = Number(at(0) / 32n), second = Number(at(1) / 32n), n = Number(at(first));
  if (n !== Number(at(second)) || n > 500) throw new Error('recipients and values differ');
  return Array.from({ length: n }, (_, i) => ({ wallet: `0x${at(first + 1 + i).toString(16).padStart(40, '0')}`, wei: at(second + 1 + i) }));
}
