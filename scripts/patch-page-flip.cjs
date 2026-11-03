const fs = require('fs');
const path = require('path');

const file = path.join(
  __dirname,
  '../node_modules/page-flip/dist/js/page-flip.browser.js'
);

if (!fs.existsSync(file)) {
  console.error('[PageFlip] File runtime tidak ditemukan:', file);
  process.exit(1);
}

let code = fs.readFileSync(file, 'utf8');
let changed = false;

function ensurePatch(before, after, label) {
  if (code.includes(after)) {
    console.log('[PageFlip] Sudah ada:', label);
    return;
  }

  const first = code.indexOf(before);
  const last = code.lastIndexOf(before);
  if (first === -1 || first !== last) {
    throw new Error(`Gagal memasang patch "${label}". Pola tidak ditemukan atau tidak unik.`);
  }

  code = code.slice(0, first) + after + code.slice(first + before.length);
  changed = true;
  console.log('[PageFlip] Berhasil:', label);
}

try {
  // Start horizontal dragging as soon as the finger moves. The original library
  // waits 250 ms before accepting touch movement, which makes the page feel stuck.
  ensurePatch(
    'this.touchPoint=null,this.swipeTimeout=250',
    'this.touchPoint=null,this.isTouchDragging=!1,this.swipeTimeout=250',
    'status drag'
  );

  ensurePatch(
    'this.touchPoint={point:i,time:Date.now()},setTimeout(()=>{null!==this.touchPoint&&this.app.startUserTouch(i)},this.swipeTimeout)',
    'this.touchPoint={point:i,time:Date.now()},this.isTouchDragging=!1,setTimeout(()=>{null!==this.touchPoint&&!this.isTouchDragging&&(this.isTouchDragging=!0,this.app.startUserTouch(i))},this.swipeTimeout)',
    'aktivasi drag cadangan'
  );

  ensurePatch(
    'this.onTouchMove=t=>{if(t.changedTouches.length>0){const e=t.changedTouches[0],i=this.getMousePos(e.clientX,e.clientY);',
    'this.onTouchMove=t=>{if(t.changedTouches.length>0){const e=t.changedTouches[0],i=this.getMousePos(e.clientX,e.clientY);null!==this.touchPoint&&!this.isTouchDragging&&Math.abs(i.x-this.touchPoint.point.x)>6&&Math.abs(i.x-this.touchPoint.point.x)>1.15*Math.abs(i.y-this.touchPoint.point.y)&&(this.isTouchDragging=!0,this.app.startUserTouch(this.touchPoint.point));',
    'deteksi gerakan horizontal langsung'
  );

  ensurePatch(
    'Math.abs(t)>this.swipeDistance&&e<2*this.swipeDistance',
    '!this.isTouchDragging&&Math.abs(t)>this.swipeDistance&&e<2*this.swipeDistance',
    'pencegahan swipe ganda'
  );

  ensurePatch(
    'this.touchPoint=null}this.app.userStop(i,s)',
    'this.touchPoint=null}this.isTouchDragging=!1,this.app.userStop(i,s)',
    'reset status sentuhan'
  );

  const requiredMarkers = [
    'this.touchPoint=null,this.isTouchDragging=!1,this.swipeTimeout=250',
    'this.isTouchDragging=!0,this.app.startUserTouch(i)',
    'this.app.startUserTouch(this.touchPoint.point)',
    '!this.isTouchDragging&&Math.abs(t)>this.swipeDistance',
    'this.isTouchDragging=!1,this.app.userStop(i,s)',
  ];
  const missing = requiredMarkers.filter((marker) => !code.includes(marker));
  if (missing.length > 0) {
    throw new Error(`Verifikasi patch gagal: ${missing.length} bagian belum terpasang.`);
  }

  if (changed) fs.writeFileSync(file, code, 'utf8');
  console.log('[PageFlip] Semua optimasi input sentuh terverifikasi.');
} catch (error) {
  console.error('[PageFlip] PATCH GAGAL:', error.message);
  process.exit(1);
}
