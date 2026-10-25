/* Terreno compartilhado (navegador e servidor usam EXATAMENTE a mesma função de altura) */
(function(root){
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),lerp=(a,b,t)=>a+(b-a)*t;
const smooth=(x,a,b)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)};
const SEED=7331,WORLD=600,HALF=WORLD/2,WATER=-2.6;
function hsh(a,b){let n=(a*374761393+b*668265263+SEED*1442695041)|0;n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967295}
function noise(x,y){const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  return lerp(lerp(hsh(xi,yi),hsh(xi+1,yi),u),lerp(hsh(xi,yi+1),hsh(xi+1,yi+1),u),v)}
function fbm(x,y){let s=0,a=.5,f=1;for(let i=0;i<4;i++){s+=a*noise(x*f,y*f);f*=2;a*=.5}return s}
const ZONES=[
  {id:'town',name:'Vila Alvorada',x:0,z:0,r:50,lv:'cidade',col:[.3,.55,.24]},
  {id:'forest',name:'Floresta Sussurrante',x:105,z:18,r:62,lv:'1-4',col:[.17,.4,.17]},
  {id:'goblin',name:'Covil dos Goblins',x:15,z:-112,r:56,lv:'4-8',col:[.33,.38,.2]},
  {id:'grave',name:'Cemitério Esquecido',x:-108,z:34,r:56,lv:'6-10',col:[.33,.37,.27]},
  {id:'desert',name:'Areias Escarlates',x:180,z:-150,r:62,lv:'10-14',col:[.82,.68,.4]},
  {id:'snow',name:'Cume Gélido',x:-160,z:-175,r:66,lv:'14-18',col:[.88,.92,.97]},
  {id:'swamp',name:'Brejo da Névoa',x:-50,z:185,r:62,lv:'18-22',col:[.2,.3,.17]},
  {id:'crypt',name:'Cripta de Morvak',x:215,z:175,r:36,lv:'masmorra',col:[.24,.21,.27]}];
const WILD={id:'wild',name:'Terras Selvagens',lv:'',col:[.3,.55,.24]};
function zoneAt(x,z){let best=null,bd=1e9;for(const q of ZONES){const d=Math.hypot(x-q.x,z-q.z);if(d<q.r&&d<bd){best=q;bd=d}}return best||WILD}
function heightAt(x,z){
  let h=(fbm(x*.011+10,z*.011+10)-.46)*36;
  h=lerp(2.2,h,smooth(Math.hypot(x,z),34,64));
  for(const q of ZONES){if(q.id==='town')continue;h=lerp(Math.max(h,.2)*.55+.3,h,smooth(Math.hypot(x-q.x,z-q.z),q.id==='crypt'?26:18,q.r))}
  const e=Math.max(Math.abs(x),Math.abs(z));if(e>HALF-46)h+=Math.pow((e-(HALF-46))/46,1.4)*34;
  return h}
function roadDist(x,z){let best=1e9;for(const q of ZONES){if(q.id==='town')continue;
  const ax=0,az=0,bx=q.x,bz=q.z,dx=bx-ax,dz=bz-az,t=clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz),0,1);
  best=Math.min(best,Math.hypot(x-(ax+dx*t),z-(az+dz*t)))}return best}
const walkable=(x,z)=>heightAt(x,z)>WATER+.5&&Math.abs(x)<HALF-10&&Math.abs(z)<HALF-10;
const T={SEED,WORLD,HALF,WATER,ZONES,zoneAt,heightAt,roadDist,walkable,noise,fbm,hsh};
if(typeof module!=='undefined'&&module.exports)module.exports=T;else root.TERRAIN=T;
})(typeof window!=='undefined'?window:globalThis);
