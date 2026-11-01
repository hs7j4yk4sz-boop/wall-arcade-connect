// The admin page's FINALE section (hub/admin-page.ts): this week and the three to come, each with its game. The card service
// (cards/src/jackpot-service.ts) offers the artists' live games with a wallet, and keeps a finale that has started as it is.
type Row = { n: number; from: string | null; to: string; open: boolean; pick: { appId: string; title: string; artist: string } | null };
type Offered = { appId: string; title: string; artist: string };
type Answer = { code: number; data: { finales?: Row[]; offered?: Offered[]; error?: string } };
type Mount = { call(body: Record<string, unknown>): Promise<Answer>; el: <K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, string>, text?: string) => HTMLElementTagNameMap[K] };

const day = (t: string): string => new Date(t).toLocaleString('en-GB', { timeZone: 'Europe/Lisbon', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function mountFinale({ call, el }: Mount): { load(): Promise<void> } {
  const box = document.getElementById('finaleWeeks') as HTMLElement, note = document.getElementById('finaleNote') as HTMLElement;
  const intro = note.textContent ?? '';
  const say = (text: string, bad = false): void => { note.textContent = text || intro; note.className = `note${bad ? ' bad' : ''}`; };

  function row(week: Row, offered: Offered[]): HTMLElement {
    const card = el('div', { class: 'week', id: `finale-${week.n}` });
    card.append(el('h3', {}, `Week ${week.n}: ${week.pick ? week.pick.title : 'no game yet'}`), el('p', { class: 'meta' }, `${day(week.from as string)} to 23:00 Lisbon${week.pick ? ` · by ${week.pick.artist}` : ''}`));
    if (!week.open) { card.append(el('p', { class: 'meta' }, 'Started: its game stays.')); return card; }
    const line = el('label', {}, 'The game'), pick = el('select', { 'aria-label': `The game of week ${week.n}` });
    pick.append(el('option', { value: '' }, '— no game yet —'));
    for (const g of offered) {
      const option = el('option', { value: g.appId }, `${g.title} · ${g.artist}`);
      option.selected = g.appId === week.pick?.appId;
      pick.append(option);
    }
    const save = el('button', { class: 'btn blue', type: 'button' }, 'Save');
    save.addEventListener('click', async () => {
      save.disabled = true;
      if (await apply({ action: 'finale-pick', week: week.n, appId: pick.value })) say(`Week ${week.n} saved.`);
      save.disabled = false;
    });
    line.append(pick);
    const acts = el('div', { class: 'acts' });
    acts.append(save);
    card.append(line, acts);
    return card;
  }

  async function apply(body: Record<string, unknown>): Promise<boolean> {
    const { code, data } = await call(body);
    if (code !== 200) { say(data.error ?? `The service answered ${code}.`, true); return false; }
    box.replaceChildren(...(data.finales ?? []).filter((w) => w.from).map((w) => row(w, data.offered ?? [])));
    return true;
  }

  return { async load() { (document.getElementById('finaleBox') as HTMLElement).hidden = false; say(''); await apply({ action: 'finale' }); } };
}
