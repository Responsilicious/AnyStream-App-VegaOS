#!/usr/bin/env node
/**
 * Read-only check of how a Jellyfin server answers the collection queries AnyStream uses (docs/collections.md,
 * "Live verification"). It only sends GET requests with the viewer's own token: no admin key, no Collections API,
 * nothing is changed on the server.
 *
 *   JELLYFIN_URL=https://watch.example.com JELLYFIN_TOKEN=<user token> node apps/vega/scripts/verify-jellyfin-collections.mjs
 *
 * The token is a normal user sign-in token (Dashboard → API keys also works, but then visibility is not the viewer's).
 * Run it once as an unrestricted user and once as a user with parental controls to compare.
 * Output is a plain report; item names are printed, ids are shortened.
 */

const base = (process.env.JELLYFIN_URL ?? '').replace(/\/+$/, '');
const token = process.env.JELLYFIN_TOKEN ?? '';
if (!base || !token) {
  console.error('Set JELLYFIN_URL and JELLYFIN_TOKEN.');
  process.exit(2);
}

const headers = {
  Authorization: `MediaBrowser Client="AnyStream verify", Device="script", DeviceId="anystream-verify", Version="0.1.0", Token="${token}"`,
  Accept: 'application/json',
};

async function get(path, query = {}) {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) {
      url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`${res.status} ${path}`);
  }
  return res.json();
}

const short = id => (id ? `${id.slice(0, 6)}…` : '-');
const line = (label, value) => console.log(`${label.padEnd(44)} ${value}`);

const info = await get('/System/Info/Public');
const me = await get('/Users/Me');
line('Server', `${info.ServerName} · Jellyfin ${info.Version}`);
line('Viewer', `${me.Name}${me.Policy?.MaxParentalRating != null ? ` (max rating ${me.Policy.MaxParentalRating})` : ''}`);
const userId = me.Id;

// 1. Discovery from the user root, as the app does.
const list = await get(`/Users/${userId}/Items`, {
  IncludeItemTypes: 'BoxSet',
  Recursive: true,
  SortBy: 'SortName',
  SortOrder: 'Ascending',
  Fields: 'Overview,ChildCount',
  EnableTotalRecordCount: true,
});
const ids = list.Items.map(i => i.Id);
line('Collections (TotalRecordCount / returned)', `${list.TotalRecordCount} / ${list.Items.length}`);
line('Repeated ids in the list', ids.length - new Set(ids).size);
line('Non-BoxSet items in the list', list.Items.filter(i => i.Type !== 'BoxSet').length);

// 2. Views: is there a boxsets view, and does a movie library ParentId miss any collection?
const views = await get(`/Users/${userId}/Views`);
const boxView = views.Items.find(v => v.CollectionType === 'boxsets');
line('Collections view (CollectionType=boxsets)', boxView ? `${boxView.Name} ${short(boxView.Id)}` : 'none');
if (boxView) {
  const viaView = await get(`/Users/${userId}/Items`, { ParentId: boxView.Id, EnableTotalRecordCount: true, Limit: 0 });
  line('  BoxSets via the view', viaView.TotalRecordCount);
}
for (const v of views.Items.filter(x => x.CollectionType === 'movies')) {
  const inLib = await get(`/Users/${userId}/Items`, { ParentId: v.Id, IncludeItemTypes: 'BoxSet', Recursive: true, Limit: 0 });
  line(`  BoxSets with ParentId=${v.Name}`, inLib.TotalRecordCount);
}

// 3. Server grouping: does a Movies query without CollapseBoxSetItems=false return BoxSets?
for (const v of views.Items.filter(x => x.CollectionType === 'movies' || x.CollectionType === 'tvshows')) {
  const type = v.CollectionType === 'movies' ? 'Movie' : 'Series';
  const plain = await get(`/Users/${userId}/Items`, { ParentId: v.Id, Recursive: true, IncludeItemTypes: type, Limit: 200 });
  const off = await get(`/Users/${userId}/Items`, { ParentId: v.Id, Recursive: true, IncludeItemTypes: type, CollapseBoxSetItems: false, Limit: 0 });
  line(`Grouping in ${v.Name}: BoxSets without/with flag`, `${plain.Items.filter(i => i.Type === 'BoxSet').length} / 0 expected (total ${off.TotalRecordCount})`);
}

// 4. Members of each collection (first 8).
console.log('\nMembers (direct, CollapseBoxSetItems=false):');
for (const c of list.Items.slice(0, 8)) {
  const q = { ParentId: c.Id, Recursive: false, CollapseBoxSetItems: false, Fields: 'PremiereDate,ProductionYear', EnableTotalRecordCount: true };
  const defaultOrder = await get(`/Users/${userId}/Items`, q);
  const byName = await get(`/Users/${userId}/Items`, { ...q, SortBy: 'SortName', SortOrder: 'Ascending' });
  const recursive = await get(`/Users/${userId}/Items`, { ...q, Recursive: true, Limit: 0 });
  const paged = await get(`/Users/${userId}/Items`, { ...q, StartIndex: 1, Limit: 2 });
  const kinds = [...new Set(defaultOrder.Items.map(i => i.Type))].join(',');
  const order = defaultOrder.Items.map(i => `${i.Name}${i.ProductionYear ? ` (${i.ProductionYear})` : ''}`).slice(0, 6).join(' · ');
  const sameAsName = defaultOrder.Items.map(i => i.Id).join() === byName.Items.map(i => i.Id).join();
  const pageOk = paged.Items.map(i => i.Id).join() === defaultOrder.Items.slice(1, 3).map(i => i.Id).join();
  console.log(`- ${c.Name} ${short(c.Id)}`);
  line('    total / ChildCount / recursive total', `${defaultOrder.TotalRecordCount} / ${c.ChildCount ?? '-'} / ${recursive.TotalRecordCount}`);
  line('    kinds', kinds || '(empty)');
  line('    default order (first 6)', order || '(empty)');
  line('    default order equals SortName', sameAsName);
  line('    page 2 of 2 matches default order slice', pageOk);
  const nested = defaultOrder.Items.filter(i => i.Type === 'BoxSet');
  if (nested.length) {
    line('    nested collections', nested.map(n => n.Name).join(', '));
  }
  const orphanEpisodes = defaultOrder.Items.filter(i => (i.Type === 'Episode' || i.Type === 'Season') && !i.SeriesId);
  if (orphanEpisodes.length) {
    line('    episodes/seasons without SeriesId', orphanEpisodes.length);
  }
}
