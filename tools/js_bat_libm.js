// js_bat_libm.js <preset> <frames.bin> <nframes> [outdir] [pinnedSecond]
// Runs the Battery port with Math.sin/cos/atan2/tan replaced by ucrtbase.dll's results
// (the exact functions wmp.dll imports: 0x1807f5198 sin, 0x1807f50c8 cos, 0x1807f50a0 atan2).
// Unknown arguments are collected, handed to libm.ps1, and the run is repeated until the
// argument set closes.  Writes stats.csv + frame_*.idx exactly like js_bat.js.
'use strict';
const fs=require('fs'), vm=require('vm'), path=require('path'), cp=require('child_process');
const SRC=require('path').join(__dirname,'..','src');
const preset=+process.argv[2], bin=process.argv[3], nf=+(process.argv[4]||300);
const outDir=process.argv[5]||('shim/p'+String(preset).padStart(2,'0'));
const SEED=+(process.argv[6]||1700000000);   // the pinned second, i.e. what srand(time(NULL)) sees
fs.mkdirSync(outDir,{recursive:true});

const b8=Buffer.alloc(8);
function bits(v){ b8.writeDoubleLE(v,0); return b8.toString('hex').match(/../g).reverse().join(''); }
function fromBits(h){ const b=Buffer.from(h.match(/../g).reverse().join(''),'hex'); return b.readDoubleLE(0); }

const tbl={sin:new Map(),cos:new Map(),atan2:new Map(),tan:new Map()};
const cacheFile=path.join(outDir,'libm_cache.txt');
function loadCache(f){
  if(!fs.existsSync(f)) return 0; let n=0;
  for(const line of fs.readFileSync(f,'utf8').split('\n')){
    if(!line) continue;
    const m=line.split(' ');            // "fn args -> res"
    if(m.length<4) continue;
    tbl[m[0]].set(m[1], fromBits(m[3])); n++;
  }
  return n;
}
loadCache(cacheFile);

let misses=new Set();
function mk(name){
  const t=tbl[name], native=Math[name];
  if(name==='atan2') return function(y,x){ const k=bits(y)+','+bits(x);
    if(t.has(k)) return t.get(k); misses.add(name+' '+k); return native(y,x); };
  return function(x){ const k=bits(x);
    if(t.has(k)) return t.get(k); misses.add(name+' '+k); return native(x); };
}
const PM=Object.create(null);
for(const k of Object.getOwnPropertyNames(Math)) PM[k]=Math[k];
// LIBM=sin,cos,atan2,tan (default all) — which functions come from ucrtbase, to decompose the residual
const WHICH=(process.env.LIBM||'sin,cos,atan2,tan').split(',');
for (const k of WHICH) PM[k]=mk(k);
console.error('shimming: '+WHICH.join(','));

function run(){
  misses=new Set();
  const fakeDate={now:()=>SEED*1000};
  const sb={window:{},Math:PM,Date:fakeDate,console,Object,Array,Number,String,JSON,isNaN,parseInt,parseFloat,
    Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,Uint8ClampedArray,ArrayBuffer};
  sb.globalThis=sb; vm.createContext(sb);
  // 00-rand.js first: it publishes A.sin/cos/atan2, which 70/72/73 capture in module-level vars
  // at load time, so the override has to land between the two loads.
  vm.runInContext(fs.readFileSync(path.join(SRC,'00-rand.js'),'utf8'),sb,{filename:'00-rand.js'});
  // (the modules take A.sin/A.cos/A.atan2 -- the ucrtbase clones -- so the table goes there too)
  for (const k of ['sin','cos','atan2']) if (WHICH.indexOf(k)>=0) sb.window.Alchemy[k]=PM[k];
  for (const f of ['15-effect.js','70-battery-warps.js','72-battery-draws.js','73-battery-draws-a.js','75-battery.js'])
    vm.runInContext(fs.readFileSync(path.join(SRC,f),'utf8'),sb,{filename:f});
  const AL=sb.window.Alchemy;
  const eng=new AL.Battery({width:384,height:288,options:{}});
  eng.setPreset(preset);
  const level={freq:[new Uint8Array(1024),new Uint8Array(1024)],wave:[new Uint8Array(1024),new Uint8Array(1024)],state:2,timeStamp:0};
  const buf=fs.readFileSync(bin), PER=4100;
  let n=Math.floor(buf.length/PER); if(nf>0&&nf<n) n=nf;
  const hashes=[];
  for(let f=-1;f<n;f++){
    if(f<0){level.freq[0].fill(0);level.freq[1].fill(0);level.wave[0].fill(0);level.wave[1].fill(0);level.state=2;level.timeStamp=0;}
    else{const o=f*PER;for(let c=0;c<2;c++){buf.copy(level.freq[c],0,o+c*1024,o+(c+1)*1024);buf.copy(level.wave[c],0,o+2048+c*1024,o+2048+(c+1)*1024);}
         level.state=buf.readInt32LE(o+4096);level.timeStamp=f*166667;}
    eng.render(level);
    let h=2166136261; const fr=eng.front;
    for(let i=0;i<fr.length;i++) h=Math.imul(h^fr[i],16777619);
    hashes.push([f,(h>>>0).toString(16).padStart(8,'0')]);
  }
  return hashes;
}

let pass=0, hashes;
for(;;){
  hashes=run(); pass++;
  console.error(`pass ${pass}: ${misses.size} new libm args`);
  if(misses.size===0) break;
  if(pass>12) throw new Error('libm arg set does not close');
  const q=path.join(outDir,'q.txt');
  fs.writeFileSync(q,[...misses].join('\n')+'\n');
  cp.execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',
    path.resolve(__dirname,'libm.ps1'),'-In',q.replace(/^/, '')],{stdio:['ignore','ignore','inherit'],maxBuffer:1<<30});
  const got=fs.readFileSync(q+'.out','utf8');
  fs.appendFileSync(cacheFile,got);
  for(const line of got.split('\n')){ if(!line) continue; const m=line.split(' '); if(m.length>=4) tbl[m[0]].set(m[1],fromBits(m[3])); }
}
fs.writeFileSync(path.join(outDir,'stats.csv'),'frame,ihash\n'+hashes.map(r=>r.join(',')).join('\n')+'\n');
console.error('done, '+hashes.length+' frames');
