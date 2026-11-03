// The admin page's FINALE section (hub/admin-page.ts): the finale just closed (its top 10 as CSV, for the coffees), this week and
// the three to come, each with its game, its words on the prize (after the 0.1 ETH, and a line under it) and its X space. The card service (cards/src/jackpot-service.ts) offers the artists'
// live games with a wallet, and keeps a finale that has started as it is.
type Pick = { appId: string; title: string; artist: string; bonus?: string; extra?: string; space?: string };
type Row = { n: number; from: string | null; to: string; open: boolean; closed?: boolean; pick: Pick | null };
type Offered = { appId: string; title: string; artist: string };
type Answer = { code: number; data: { finales?: Row[]; offered?: Offered[]; csv?: string; title?: string; rows?: unknown[]; error?: string } };
type Mount = { call(body: Record<string, unknown>): Promise<Answer>; el: <K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, string>, text?: string) => HTMLElementTagNameMap[K] };

const day = (t: string): string => new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/Lisbon', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function mountFinale({ call, el }: Mount): { load(): Promise<void> } {
  const box = document.getElementById('finaleWeeks') as HTMLElement, note = document.getElementById('finaleNote') as HTMLElement;
  const intro = note.textContent ?? '';
  const say = (text: string, bad = false): void => { note.textContent = text || intro; note.className = `note${bad ? ' bad' : ''}`; };

  /** The closed finale's top 10, read from its board now, saved as a CSV file by the browser. */
  async function download(week: Row, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    const { code, data } = await call({ action: 'finale-top10', week: week.n });
    button.disabled = false;
    if (code !== 200 || typeof data.csv !== 'string') { say(data.error ?? `The service answered ${code}.`, true); return; }
    const a = el('a', { href: URL.createObjectURL(new Blob([data.csv], { type: 'text/csv;charset=utf-8' })), download: `finale-week-${week.n}-${slug(data.title ?? 'top10')}-top10.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    say(`Week ${week.n}: ${data.rows?.length ?? 0} lines downloaded.`);
  }

  function row(week: Row, offered: Offered[]): HTMLElement {
    const card = el('div', { class: 'week', id: `finale-${week.n}` });
    card.append(el('h3', {}, `Week ${week.n}: ${week.pick ? week.pick.title : 'no game yet'}`), el('p', { class: 'meta' }, `${day(week.from as string)} to 23:00 Lisbon${week.pick ? ` · by ${week.pick.artist}` : ''}`));
    if (week.pick?.extra || week.pick?.bonus) card.append(el('p', { class: 'meta' }, `0.1 ETH${week.pick.extra ? ` + ${week.pick.extra}` : ''}${week.pick.bonus ? ` · ${week.pick.bonus}` : ''}`));
    if (week.pick?.space) card.append(el('p', { class: 'meta' }, `Space: ${week.pick.space}`));
    if (week.closed) {
      if (!week.pick) { card.append(el('p', { class: 'meta' }, 'Closed, with no game.')); return card; }
      const csv = el('button', { class: 'btn blue', type: 'button' }, 'Download the top 10 (CSV)'), acts = el('div', { class: 'acts' });
      csv.addEventListener('click', () => void download(week, csv));
      acts.append(csv);
      card.append(el('p', { class: 'meta' }, 'Closed. Rank, wallet, ENS and score of the seven hours, the artist left out.'), acts);
      return card;
    }
    if (!week.open) {
      card.append(el('p', { class: 'meta' }, 'Started: its game stays.'));
      if (week.pick) card.append(...spaceField(week, () => ({ action: 'finale-space', week: week.n })));
      return card;
    }
    const line = el('label', {}, 'The game'), pick = el('select', { 'aria-label': `The game of week ${week.n}` });
    pick.append(el('option', { value: '' }, '— no game yet —'));
    for (const g of offered) {
      const option = el('option', { value: g.appId }, `${g.title} · ${g.artist}`);
      option.selected = g.appId === week.pick?.appId;
      pick.append(option);
    }
    const more = el('label', {}, 'After the 0.1 ETH (optional)'), extra = el('input', { autocomplete: 'off', maxlength: '40', placeholder: '10 coffees', class: 'extra' });
    const under = el('label', {}, 'Bonus line, under the prizes (optional)'), bonus = el('input', { autocomplete: 'off', maxlength: '120', placeholder: 'Top 10: a … coffee NFT', class: 'bonus' });
    extra.value = week.pick?.extra ?? ''; bonus.value = week.pick?.bonus ?? '';
    const save = el('button', { class: 'btn blue', type: 'button' }, 'Save'), [where, space] = spaceInput(week);
    save.addEventListener('click', async () => {
      save.disabled = true;
      if (await apply({ action: 'finale-pick', week: week.n, appId: pick.value, extra: extra.value, bonus: bonus.value, space: space.value })) say(`Week ${week.n} saved.`);
      save.disabled = false;
    });
    line.append(pick); more.append(extra); under.append(bonus);
    const acts = el('div', { class: 'acts' });
    acts.append(save);
    card.append(line, more, under, where, acts);
    return card;
  }

  /** The X space: linked on the hub while the finale runs. */
  function spaceInput(week: Row): [HTMLLabelElement, HTMLInputElement] {
    const where = el('label', {}, 'The X space (optional)'), space = el('input', { autocomplete: 'off', maxlength: '200', placeholder: 'https://x.com/i/spaces/…', class: 'space' });
    space.value = week.pick?.space ?? '';
    where.append(space);
    return [where, space];
  }
  function spaceField(week: Row, body: () => Record<string, unknown>): HTMLElement[] {
    const [where, space] = spaceInput(week), save = el('button', { class: 'btn blue', type: 'button' }, 'Save the space'), acts = el('div', { class: 'acts' });
    save.addEventListener('click', async () => {
      save.disabled = true;
      if (await apply({ ...body(), space: space.value })) say(`Week ${week.n}: the space is saved.`);
      save.disabled = false;
    });
    acts.append(save);
    return [where, acts];
  }

  async function apply(body: Record<string, unknown>): Promise<boolean> {
    const { code, data } = await call(body);
    if (code !== 200) { say(data.error ?? `The service answered ${code}.`, true); return false; }
    box.replaceChildren(...(data.finales ?? []).filter((w) => w.from).map((w) => row(w, data.offered ?? [])));
    return true;
  }

  return { async load() { (document.getElementById('finaleBox') as HTMLElement).hidden = false; say(''); await apply({ action: 'finale' }); } };
}
