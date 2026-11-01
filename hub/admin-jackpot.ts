// The admin page's JACKPOT section (hub/admin-page.ts): each closed week as the card service calculated it, and PAY. The
// service holds no key and sends nothing: PAY builds one Disperse call for the wallet in this browser, which signs it. PAY is
// live only for the treasury, on mainnet, with a balance that covers the week and the wall's address typed. Just before
// sending it asks the service again whether the week is still due, and has the wallet simulate the call; the hash goes to
// the service at once, so a week with a send on its way cannot be paid twice; the service marks it paid from the chain.
import { DISPERSE, encodeDisperse } from '../cards/src/disperse.js';
import { ethOf, type GameShare, type PayLine, type PlanFinale } from '../cards/src/jackpot.js';

type Plan = { n: number; from: string; to: string; credits: number; totalWei: string; games: GameShare[]; lines: PayLine[]; wallWei: string; sendWei: string; heldWei: string; held: string[]; finale?: PlanFinale };
type WeekRecord = { plan: Plan; status: 'due' | 'sent' | 'paid'; hash?: string; wall?: string; sentAt?: string; paidAt?: string; note?: string };
type WeekView = WeekRecord | { n: number; error: string };
type Answer = { code: number; data: { weeks?: WeekView[]; treasury?: string; error?: string } };
export type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown>; on?(event: string, listener: () => void): void };
export type Mount = { wallet?: Eip1193; call(body: Record<string, unknown>): Promise<Answer>; el: <K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, string>, text?: string) => HTMLElementTagNameMap[K] };

const ETHERSCAN = 'https://etherscan.io/tx/', WALL_KEY = 'wall-address', MAINNET = '0x1', ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const remembered = (): string => { try { return localStorage.getItem(WALL_KEY) ?? ''; } catch { return ''; } };
const remember = (v: string): void => { try { localStorage.setItem(WALL_KEY, v); } catch { /* it is only a convenience */ } };
const hasPlan = (w: WeekView): w is WeekRecord => 'plan' in w;
const day = (t: string): string => new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/Lisbon', dateStyle: 'medium', timeStyle: 'short' });
const failure = (error: unknown): string => {
  const e = error as { code?: number; message?: string };
  return e?.code === 4001 ? 'Refused in the wallet: nothing was sent.' : (e?.message ?? 'The wallet did not answer.').slice(0, 200);
};

export function mountJackpot({ wallet: standIn, call, el }: Mount): { load(): Promise<void> } {
  const box = document.getElementById('jackpotWeeks') as HTMLElement, connect = document.getElementById('walletConnect') as HTMLButtonElement;
  const seen = document.getElementById('walletSeen') as HTMLElement, top = document.getElementById('jackpotNote') as HTMLElement;
  const provider = (): Eip1193 | undefined => standIn ?? (window as unknown as { ethereum?: Eip1193 }).ethereum;
  let weeks: WeekView[] = [], treasury = '', account = '', chain = '', balance: bigint | null = null, sending = false;
  const say = (text: string, bad = false): void => { top.textContent = text; top.className = `note${bad ? ' bad' : ''}`; };

  async function apply(body: Record<string, unknown>): Promise<boolean> {
    const { code, data } = await call(body);
    if (data.weeks) { weeks = data.weeks; treasury = (data.treasury ?? '').toLowerCase(); }
    if (code !== 200) say(data.error ?? `The service answered ${code}.`, true);
    draw();
    return code === 200;
  }

  async function readWallet(): Promise<void> {
    const wallet = provider();
    if (!wallet) return;
    const accounts = await wallet.request({ method: 'eth_accounts' }) as string[];
    account = (accounts[0] ?? '').toLowerCase();
    chain = String(await wallet.request({ method: 'eth_chainId' }));
    balance = account ? BigInt(String(await wallet.request({ method: 'eth_getBalance', params: [account, 'latest'] }))) : null;
    seen.textContent = account ? `${account} · ${balance === null ? '' : `${ethOf(balance)} ETH`}${chain === MAINNET ? '' : ' · not on mainnet'}` : '';
    draw();
  }

  /** Why PAY is off for this week; null when it is live. */
  function blocked(week: WeekRecord, wall: string): string | null {
    if (week.status !== 'due') return 'A payment went out for this week.';
    if (BigInt(week.plan.sendWei) === 0n) return 'Nothing to pay this week.';
    if (!provider()) return 'No wallet in this browser.';
    if (!account) return 'Connect the treasury\'s wallet.';
    if (account !== treasury) return `The connected wallet is not the treasury (${treasury}).`;
    if (chain !== MAINNET) return 'Switch the wallet to Ethereum mainnet.';
    if (balance === null || balance < BigInt(week.plan.sendWei)) return `The treasury's balance does not cover ${ethOf(week.plan.sendWei)} ETH.`;
    if (!ADDRESS.test(wall)) return 'Type the wall\'s NFC address.';
    if (wall.toLowerCase() === treasury) return 'The wall\'s address cannot be the treasury.';
    return null;
  }

  async function pay(week: WeekRecord, wall: string): Promise<void> {
    const wallet = provider();
    if (!wallet || sending) return;
    sending = true;
    try {
      await readWallet();
      await apply({ action: 'jackpot' });
      const fresh = weeks.find((w): w is WeekRecord => hasPlan(w) && w.plan.n === week.plan.n);
      const why = fresh ? blocked(fresh, wall) : 'This week is gone.';
      if (why || !fresh) { say(why ?? '', true); return; }
      const lines = [...fresh.plan.lines.map((l) => ({ wallet: l.wallet, wei: BigInt(l.wei) })), { wallet: wall.toLowerCase(), wei: BigInt(fresh.plan.wallWei) }].filter((l) => l.wei > 0n);
      const tx = { from: account, to: DISPERSE, value: `0x${BigInt(fresh.plan.sendWei).toString(16)}`, data: encodeDisperse(lines) };
      try { await wallet.request({ method: 'eth_estimateGas', params: [tx] }); } catch (error) { say(`The send would fail, nothing was sent: ${failure(error)}`, true); return; }
      say('Check and sign in your wallet.');
      let hash: string;
      try { hash = String(await wallet.request({ method: 'eth_sendTransaction', params: [tx] })); } catch (error) { say(failure(error), true); return; }
      say(`Sent: ${hash}. Waiting for the chain…`);
      if (!await apply({ action: 'jackpot-paid', week: fresh.plan.n, hash })) { say(`Sent, but the service did not record it. Do not pay again: paste this hash in the week: ${hash}`, true); return; }
      for (let i = 0; i < 120; i++) {
        if (await wallet.request({ method: 'eth_getTransactionReceipt', params: [hash] })) break;
        await new Promise((r) => setTimeout(r, 5000));
      }
      await apply({ action: 'jackpot-paid', week: fresh.plan.n, hash });
      const after = weeks.find((w): w is WeekRecord => hasPlan(w) && w.plan.n === fresh.plan.n);
      say(after?.status === 'paid' ? `Week ${fresh.plan.n} is paid.` : `Week ${fresh.plan.n}: ${after?.note ?? 'not confirmed yet, CHECK AGAIN in a moment.'}`, after?.status !== 'paid');
      await readWallet();
    } catch (error) { say(failure(error), true); } finally { sending = false; draw(); }
  }

  function table(plan: Plan): HTMLElement {
    const box = el('div', { class: 'scroll' }), t = el('table'), head = el('tr');
    for (const c of ['Game', 'Credits', 'Winner', 'Artist', 'Wall 10%']) head.append(el('th', {}, c));
    t.append(head);
    for (const g of plan.games) {
      const row = el('tr');
      row.append(el('td', {}, g.title), el('td', {}, String(g.credits)),
        el('td', {}, g.best ? `${g.best.name} · ${ethOf(g.bestWei)}` : `no score · ${ethOf(g.bestWei)} stays`),
        el('td', {}, g.ours ? `to the wall · ${ethOf(g.artistWei)}` : `${g.artist} · ${ethOf(g.artistWei)}${g.artistWallet ? '' : ' stays'}`), el('td', {}, ethOf(g.wallWei)));
      t.append(row);
    }
    box.append(t);
    return box;
  }

  function weekCard(week: WeekRecord): HTMLElement {
    const { plan } = week, card = el('div', { class: 'week', id: `week-${plan.n}` });
    card.append(el('h3', {}, `Week ${plan.n}: ${plan.credits} credits, ${ethOf(plan.totalWei)} ETH${plan.finale ? ` + the finale's ${ethOf(plan.finale.wei)}` : ''}`),
      el('p', { class: 'meta' }, `${day(plan.from)} to ${day(plan.to)} · ${week.status === 'paid' ? `paid ${day(week.paidAt ?? '')}` : week.status === 'sent' ? 'sent, not confirmed' : 'to pay'}`));
    if (plan.games.length) card.append(table(plan));
    if (plan.finale) card.append(el('p', { class: 'meta' }, `Finale: ${plan.finale.title} by ${plan.finale.artist}, ${plan.finale.winners.length} of 5 places, ${ethOf(plan.finale.wei)} ETH from NFC. ${plan.finale.winners.map((w) => `#${w.rank} ${w.name} ${w.score}`).join(' · ')}`));
    for (const h of plan.held) card.append(el('p', { class: 'meta warn' }, h));
    if (week.note) card.append(el('p', { class: 'meta warn' }, week.note));
    const list = el('ul', { class: 'lines' });
    for (const l of plan.lines) list.append(el('li', {}, `${ethOf(l.wei)} ETH → ${l.name} (${l.wallet}): ${l.for.join(', ')}`));
    card.append(list);

    if (week.hash) {
      const link = el('a', { href: `${ETHERSCAN}${week.hash}`, target: '_blank', rel: 'noopener', class: 'meta' }, week.hash);
      card.append(el('p', { class: 'meta' }, week.status === 'paid' ? `The wall: ${ethOf(plan.wallWei)} ETH → ${week.wall}. Hash:` : 'Hash:'), link);
    }
    if (week.status === 'sent') {
      const again = el('button', { class: 'btn', type: 'button' }, 'Check again'), forget = el('button', { class: 'btn', type: 'button' }, 'Forget this send');
      again.addEventListener('click', () => void apply({ action: 'jackpot-paid', week: plan.n, hash: week.hash }));
      forget.addEventListener('click', () => { if (confirm('Forget this send? Only if Etherscan shows it never went through: the week can then be paid again.')) void apply({ action: 'jackpot-clear', week: plan.n }); });
      const acts = el('div', { class: 'acts' });
      acts.append(again, forget);
      card.append(acts);
    }
    if (week.status === 'due') {
      const line = el('label', {}, `The wall: ${ethOf(plan.wallWei)} ETH to the NFC address`), wall = el('input', { autocomplete: 'off', spellcheck: 'false', placeholder: '0x…', class: 'wall-address' });
      wall.value = remembered(); line.append(wall);
      const total = el('p', { class: 'meta' }, `One send of ${ethOf(plan.sendWei)} ETH, ${plan.lines.length + 1} lines, through Disperse (${DISPERSE}).${BigInt(plan.heldWei) > 0n ? ` ${ethOf(plan.heldWei)} ETH stays in the treasury.` : ''}`);
      const go = el('button', { class: 'btn blue', type: 'button' }, 'Pay'), redo = el('button', { class: 'btn', type: 'button' }, 'Calculate again');
      const why = el('p', { class: 'meta why' }), acts = el('div', { class: 'acts' });
      const check = (): void => { const reason = blocked(week, wall.value.trim()); go.disabled = reason !== null || sending; why.textContent = reason ?? ''; };
      wall.addEventListener('input', () => { remember(wall.value.trim()); check(); });   // the card is drawn again often
      go.addEventListener('click', () => void pay(week, wall.value.trim()));
      redo.addEventListener('click', () => void apply({ action: 'jackpot-recompute', week: plan.n }));
      acts.append(go, redo);
      const paste = el('form', { class: 'paste' }), hash = el('input', { autocomplete: 'off', spellcheck: 'false', placeholder: '0x… a hash already sent for this week', 'aria-label': 'A hash already sent' });
      paste.append(hash, el('button', { class: 'btn', type: 'submit' }, 'Record'));
      paste.addEventListener('submit', (e) => { e.preventDefault(); void apply({ action: 'jackpot-paid', week: plan.n, hash: hash.value.trim() }); });
      card.append(line, total, acts, why, paste);
      check();
    }
    return card;
  }

  function draw(): void {
    box.replaceChildren(...weeks.map((w) => (hasPlan(w) ? weekCard(w) : el('p', { class: 'meta warn' }, `Week ${w.n}: not calculated yet (${w.error}).`))));
    if (!weeks.length) box.append(el('p', { class: 'empty' }, 'No week closed yet.'));
  }

  connect.addEventListener('click', async () => {
    const wallet = provider();
    if (!wallet) { say('No wallet in this browser: MetaMask, Rabby or another extension holding the treasury.', true); return; }
    try { await wallet.request({ method: 'eth_requestAccounts' }); await readWallet(); say(''); } catch (error) { say(failure(error), true); }
  });
  const follow = (): void => { void readWallet().catch(() => undefined); };
  provider()?.on?.('accountsChanged', follow);
  provider()?.on?.('chainChanged', follow);

  return {
    async load() {
      (document.getElementById('jackpotBox') as HTMLElement).hidden = false;
      await apply({ action: 'jackpot' });
      await readWallet().catch(() => undefined);
      // a send left on its way: the chain may have settled it since
      for (const w of weeks) if (hasPlan(w) && w.status === 'sent' && w.hash) await apply({ action: 'jackpot-paid', week: w.plan.n, hash: w.hash });
    },
  };
}
