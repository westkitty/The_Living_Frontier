// The title screen: what the save says about itself, what happens when
// something cannot be recovered from, and the line between a working frontier
// and a broken one. The game must never fail silently — a frontier that has
// quietly stopped is the worst thing this program can do to a player.
export function describeSave(obj) {
  if (!obj) return null;
  try {
    const away = Math.max(0, (Date.now() - obj.savedAt) / 1000);
    const hrs = away / 3600;
    const set = obj.settlements || [];
    const alive = set.filter(s => !s.abandoned).length;
    const best = set.slice().sort((a, b) => b.prosperity - a.prosperity)[0];
    return `<b>Day ${obj.day}</b> · ${Object.keys(obj.discovered || {}).length} landmarks found · ${alive}/${set.length} villages standing<br>
      ${best ? `${best.name} is ${best.abandoned ? 'abandoned' : best.status}.` : ''}
      ${hrs > 0.05 ? `<br><span style="color:var(--amber)">The frontier moved on for ${hrs < 1 ? Math.round(away / 60) + ' minutes' : hrs.toFixed(1) + ' hours'} without you.</span>` : ''}`;
  } catch (e) { return null; }
}

export function fatal(msg, detail) {
  const el = document.getElementById('boot-status');
  if (el) { el.style.color = '#ef8a74'; el.textContent = msg; }
  const s = document.getElementById('save-summary');
  if (s) s.innerHTML = `<b>${msg}</b><br><span style="font-size:11px;opacity:.7">${detail || ''}</span>`;
  console.error(msg, detail);
}

// A failure the game cannot recover from used to be either invisible (an
// unhandled rejection) or a toast that scrolled away. Either way the player was
// left staring at a frontier that had stopped. Say what happened, and write the
// world down first — a crash is exactly when the save matters most.
export function reportFailure(what, detail) {
  try {
    if (globalThis.GAME && globalThis.GAME.state) globalThis.GAME.state.save();
  } catch (e) { /* storage may be the thing that is broken */ }
  console.error(what, detail);
  if (globalThis.GAME && globalThis.GAME.ui) {
    globalThis.GAME.ui.toast('⚠ ' + what + ' — your world was saved if it could be.', 'bad');
    return;
  }
  fatal(what, detail);
}
