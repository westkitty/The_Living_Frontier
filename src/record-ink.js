// Quiet, inspectable marks for the Long Record's fixed historical spine.
// Sealed events intentionally share one mark; their kind stays hidden.
export function drawRecordMark(ctx, event, x, y, scale) {
  const s = scale;
  ctx.strokeStyle = event.sealed ? 'rgba(150,140,120,.6)' : 'rgba(226,208,164,.9)';
  ctx.lineWidth = 0.85 * s;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (event.sealed) {
    ctx.rect(x - 2 * s, y - 2 * s, 4 * s, 4 * s);
  } else if (event.id === 'crater') {
    ctx.moveTo(x - 4 * s, y + 2 * s); ctx.lineTo(x - s, y - 2 * s);
    ctx.lineTo(x + s, y + s); ctx.lineTo(x + 4 * s, y - 2 * s);
    ctx.moveTo(x - 4 * s, y + 2 * s); ctx.lineTo(x + 4 * s, y + 2 * s);
  } else if (event.kind === 'work') {
    ctx.moveTo(x - 3 * s, y + 3 * s); ctx.lineTo(x - 3 * s, y - s);
    ctx.lineTo(x, y - 3 * s); ctx.lineTo(x + 3 * s, y - s); ctx.lineTo(x + 3 * s, y + 3 * s);
    ctx.moveTo(x - 4 * s, y + 3 * s); ctx.lineTo(x + 4 * s, y + 3 * s);
  } else if (event.kind === 'break') {
    ctx.moveTo(x - 4 * s, y - 2 * s); ctx.lineTo(x - s, y + s);
    ctx.lineTo(x + s, y - s); ctx.lineTo(x + 4 * s, y + 2 * s);
  } else if (event.kind === 'flood') {
    for (let row = -1; row <= 1; row++) {
      const yy = y + row * 2 * s;
      ctx.moveTo(x - 4 * s, yy); ctx.quadraticCurveTo(x - 2 * s, yy - s, x, yy);
      ctx.quadraticCurveTo(x + 2 * s, yy + s, x + 4 * s, yy);
    }
  } else if (event.kind === 'death') {
    ctx.moveTo(x, y + 4 * s); ctx.lineTo(x, y - 4 * s);
    ctx.moveTo(x, y - s); ctx.lineTo(x - 3 * s, y - 4 * s);
    ctx.moveTo(x, y + s); ctx.lineTo(x + 3 * s, y - 2 * s);
  } else {
    ctx.moveTo(x - 3 * s, y - 3 * s); ctx.lineTo(x + 3 * s, y + 3 * s);
    ctx.moveTo(x + 3 * s, y - 3 * s); ctx.lineTo(x - 3 * s, y + 3 * s);
  }
  ctx.stroke();
}
