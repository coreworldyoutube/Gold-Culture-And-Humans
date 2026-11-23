(async () => {
"use strict";
const $ = id => document.getElementById(id);
let BALANCE;
try {
 const response=await fetch("data/balance.json",{cache:"no-store"});
 if(!response.ok)throw new Error("HTTP "+response.status);
 BALANCE=await response.json();
 if(!BALANCE||BALANCE.configVersion!==1)throw new Error("未対応の設定ファイルです");
} catch(error) {
 console.error("balance.json の読み込みに失敗しました:",error);
 document.body.innerHTML='<main style="max-width:760px;margin:40px auto;padding:20px;color:#fff;font-family:sans-serif"><h1>設定ファイルを読み込めません</h1><p>data/balance.json を取得できませんでした。HTTPサーバー経由で開き、ファイルの配置とJSON形式を確認してください。</p><pre></pre></main>';
 document.querySelector("pre").textContent=String(error);
 return;
}
const prices=BALANCE.resourcePrices;
const resourceNames=Object.keys(prices);
 const mineableResources=new Set(BALANCE.mineDiscoveryWeights.map(item=>item.resource));
 const laborRoles=["forestry","mining","hunting","farming","processing"];
 const laborLabels={forestry:"林業",mining:"採掘",hunting:"狩猟",farming:"農業",processing:"加工"};
const pool=BALANCE.mineDiscoveryWeights.map(item=>[item.resource,item.weight]);
const POWER_RECOVERY_COST=BALANCE.power.recoveryCostPerPoint;
const {productNames,technologyNames,technologyDescriptions}=window.GAME_CATALOG;
const technologies=BALANCE.technologies.map(technology=>{const multiplier=BALANCE.researchCostMultipliers?.[technology.id]||1;const scale=cost=>({money:Math.ceil((cost.money||0)*multiplier),electricity:cost.electricity||0,raw:Object.fromEntries(Object.entries(cost.raw||{}).map(([k,v])=>[k,Math.ceil(v*multiplier)])),goods:Object.fromEntries(Object.entries(cost.goods||{}).map(([k,v])=>[k,Math.ceil(v*multiplier)]))});return {...technology,cost:scale(technology.cost),costMultiplier:multiplier,desc:technologyDescriptions[technology.id]||""};});
const fresh=()=>({schemaVersion:6,lastSavedAt:Date.now(),...BALANCE.initial,goods:Object.fromEntries(productNames.map(n=>[n,0])),labor:Object.fromEntries(laborRoles.map(role=>[role,0])),researched:[],rocketsLaunched:0,resources:Object.fromEntries(resourceNames.map(n=>[n,0])),mines:[],totalMined:0,log:[]});
let s = fresh();
function finiteNonnegative(value,fallback=0){const n=Number(value);return Number.isFinite(n)&&n>=0?n:fallback;}
function sanitizeState(){
 for(const key of ["money","gold","bread","workers","ovens","admins","power","electricity","politicalBurden","totalMined","mineCost","rocketsLaunched"])s[key]=finiteNonnegative(s[key],key==="power"?100:0);
 s.power=Math.min(100,s.power);
 s.mineCost=BALANCE.mine.baseExplorationCost;
 s.resources=Object.fromEntries(resourceNames.map(n=>[n,finiteNonnegative(s.resources?.[n])]));
 s.goods=Object.fromEntries(productNames.map(n=>[n,finiteNonnegative(s.goods?.[n])]));
 s.labor=Object.fromEntries(laborRoles.map(role=>[role,Math.floor(finiteNonnegative(s.labor?.[role]))]));
 let allocated=0;for(const role of laborRoles){s.labor[role]=Math.min(s.labor[role],Math.max(0,Math.floor(s.workers-allocated)));allocated+=s.labor[role];}
 s.mines=(Array.isArray(s.mines)?s.mines:[]).filter(m=>m&&resourceNames.includes(m.type)).map(m=>{const capacity=finiteNonnegative(m.capacity);return {...m,capacity,remaining:Math.min(capacity,finiteNonnegative(m.remaining)),rate:finiteNonnegative(m.rate),developed:m.developed!==false,depth:Math.max(1,Math.min(3,Math.floor(finiteNonnegative(m.depth,1)))),hardness:["soft","normal","hard"].includes(m.hardness)?m.hardness:"normal"};}).filter(m=>m.capacity>0);
 s.researched=(Array.isArray(s.researched)?s.researched:[]).filter(id=>Object.prototype.hasOwnProperty.call(technologyNames,id));
 s.rocketsLaunched=finiteNonnegative(s.rocketsLaunched);
 s.log=(Array.isArray(s.log)?s.log:[]).filter(x=>typeof x==="string").slice(0,35);
 if(typeof s.tax!=="boolean")s.tax=Boolean(s.tax);
}
function fmt(n){const value=Number(n);return Math.floor(Number.isFinite(value)?value:0).toLocaleString("ja-JP");}
function note(t){s.log.unshift(new Date().toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"})+" "+t);s.log=s.log.slice(0,35);}
function save(silent=false){if(!silent)note("ゲームをセーブした。");s.lastSavedAt=Date.now();try{localStorage.setItem("goldClickerSave",JSON.stringify(s));}catch(e){note("保存に失敗した。ブラウザの保存容量を確認してください。");console.warn(e);}render();}
function load(){try{const raw=localStorage.getItem("goldClickerSave");if(!raw)return;const d=JSON.parse(raw);if(!d||typeof d!=="object")throw new Error("セーブデータの形式が不正です");s={...fresh(),...d,resources:{...fresh().resources,...(d.resources||{})},goods:{...fresh().goods,...(d.goods||{})},researched:Array.isArray(d.researched)?d.researched:[],mines:Array.isArray(d.mines)?d.mines:[],log:Array.isArray(d.log)?d.log:[]};if(!d.schemaVersion||d.schemaVersion<2){s.power=Math.max(100,Number(d.power)||0);s.politicalBurden=Number(d.politicalBurden)||0;}s.schemaVersion=6;sanitizeState();const elapsed=Math.max(0,Math.min(BALANCE.offline.maxSimulationSeconds,(Date.now()-(Number(d.lastSavedAt)||Date.now()))/1000));if(elapsed>=1){simulate(elapsed);note("留守中の"+fmt(elapsed)+"秒分、生産を進めた。");}save(true);}catch(e){console.warn(e);note("セーブデータを読み込めなかったため、新しい状態で開始した。");s=fresh();}}
function weightedPick(){let total=pool.reduce((a,x)=>a+x[1],0),r=Math.random()*total;for(const [n,w] of pool){r-=w;if(r<=0)return n;}return "鉄";}
function mineChance(){const total=pool.reduce((sum,[,weight])=>sum+weight,0);return pool.map(([name,weight])=>`${name} ${(weight/total*100).toFixed(1)}%`).join(" / ");}
function bake(n=1){s.bread+=n;render();}
function sellBread(n){n=Math.min(s.bread,n);if(n<=0)return;s.bread-=n;s.money+=n*BALANCE.bread.sellPrice;note(`パン${fmt(n)}個を売却し、通貨${fmt(n*BALANCE.bread.sellPrice)}を得た。`);render();}
function buy(cost){if(s.money<cost)return false;s.money-=cost;return true;}
function activeMineCount(){return s.mines.filter(m=>m.developed&&m.remaining>0).length;}
function mineExplorationCost(targeted=false){let cost=BALANCE.mine.baseExplorationCost*(targeted?BALANCE.mine.targetedSurveyCostMultiplier:1);if(s.researched.includes("geological_survey"))cost*=1-BALANCE.mine.geologicalSurveyExplorationDiscount;if(s.researched.includes("mechanized_drilling"))cost*=1-BALANCE.mine.mechanizedDrillingExplorationDiscount;return Math.ceil(cost);}
function mineDevelopmentCost(m){const depth=BALANCE.mine.depthCostMultipliers[String(m.depth)]||1;let hardness=BALANCE.mine.hardnessCostMultipliers[m.hardness]||1;let investment=BALANCE.mine.developmentBaseCost*depth*hardness;if(m.hardness==="hard"&&s.researched.includes("dynamite"))investment*=BALANCE.mine.dynamiteHardRockCostMultiplier;if(m.depth>=2&&s.researched.includes("steam_power"))investment*=1-BALANCE.mine.steamPowerDevelopmentDiscount;if(s.researched.includes("mine_railway"))investment*=1-BALANCE.mine.railwayDevelopmentDiscount;if(m.depth>=2&&s.researched.includes("mechanized_drilling"))investment*=1-BALANCE.mine.mechanizedDrillingDepthDiscount;return Math.ceil(investment);}
function mineRequirement(m){if(m.hardness==="hard"&&!s.researched.includes("dynamite"))return "ダイナマイト研究が必要";if(m.depth>=BALANCE.mine.steamPowerDepthRequirement&&!s.researched.includes("steam_power"))return "蒸気機関研究が必要";return "";}
function developMine(index){const m=s.mines[index];if(!m||m.developed||m.remaining<=0||activeMineCount()>=mineLimitForPopulation())return;const requirement=mineRequirement(m);if(requirement){note(requirement+"。");render();return;}const cost=mineDevelopmentCost(m);if(!buy(cost)){note("鉱山開発の投資資金が足りない。");render();return;}m.developed=true;note(m.type+"鉱山の開発を完了。投資額："+fmt(cost)+"。");render();}
function mineLimitForPopulation(){return Math.floor(s.workers/BALANCE.mine.workersPerMineSlot);}
 function nextMineThreshold(){const nextWorkers=(Math.floor(s.workers/BALANCE.mine.workersPerMineSlot)+1)*BALANCE.mine.workersPerMineSlot;return {minWorkers:nextWorkers,maxMines:nextWorkers/BALANCE.mine.workersPerMineSlot};}
 function discoverMine(type,cost){if(!mineableResources.has(type)||!buy(cost))return;const capacityKey=({"鉄":"iron","銅":"copper","金":"gold","石炭":"coal","ボーキサイト":"bauxite","ウラン":"uranium"})[type]||"default";const base=BALANCE.mine.capacityBase[capacityKey];const capacity=Math.floor(base*(BALANCE.mine.capacityRandomFactor.minimum+Math.random()*BALANCE.mine.capacityRandomFactor.range));const rate=type==="金"?BALANCE.mine.miningRatePerSecond.gold:BALANCE.mine.miningRatePerSecond.otherMinimum+Math.random()*BALANCE.mine.miningRatePerSecond.otherRandomRange;const depth=1+Math.floor(Math.random()*3),hardness=["soft","normal","hard"][Math.floor(Math.random()*3)];const m={type,capacity,remaining:capacity,rate,depth,hardness,developed:false};s.mines.push(m);note(type+"鉱床を発見！ 深度"+depth+"・"+({soft:"軟岩",normal:"通常岩盤",hard:"硬岩"}[hardness])+"。開発投資が必要。");render();}
function mineOne(m){if(m.remaining<=0||m.rate<=0)return;const amount=Math.min(m.rate,m.remaining);m.remaining-=amount;s.resources[m.type]+=amount;s.totalMined+=amount;}
 function allocatedWorkers(){return laborRoles.reduce((sum,role)=>sum+s.labor[role],0);}
 function setLabor(role,value){if(!laborRoles.includes(role))return;const others=allocatedWorkers()-s.labor[role],maximum=Math.max(0,s.workers-others);s.labor[role]=Math.min(maximum,Math.max(0,Math.floor(Number(value)||0)));note(laborLabels[role]+"に"+fmt(s.labor[role])+"人を配置した。");render();}
 function powerProductivityModifier(){const p=BALANCE.power,value=p.productivityModifierAtZero+(Math.max(0,s.power)/100)*(p.productivityModifierAtHundred-p.productivityModifierAtZero);return Math.max(p.productivityFloor,Math.min(p.productivityCap,value));}
 function administrationPurchaseCost(){const base=BALANCE.administration.baseCost*Math.pow(BALANCE.administration.costMultiplier,s.admins);const locomotives=s.goods["蒸気機関車"]||0;const discount=Math.min(BALANCE.administration.steamLocomotiveDiscountCap,locomotives*BALANCE.administration.steamLocomotiveDiscountPerUnit);return Math.max(1,Math.ceil(base*(1-discount)));}
 function electricityGenerationPerSecond(){
  const generatorCount=s.goods["発電機"]||0,reactorCount=s.goods["原子炉"]||0;
  const coalNeed=generatorCount*BALANCE.generator.coalConsumptionPerSecondPerUnit,uraniumNeed=reactorCount*BALANCE.generator.uraniumConsumptionPerSecondPerReactor;
  const coalRatio=coalNeed>0?Math.min(1,(s.resources["石炭"]||0)/coalNeed):0;
  const uraniumRatio=uraniumNeed>0?Math.min(1,(s.resources["ウラン"]||0)/uraniumNeed):0;
  return generatorCount*BALANCE.generator.electricityPerSecondPerUnit*coalRatio+reactorCount*BALANCE.generator.nuclearElectricityPerSecondPerUnit*uraniumRatio;
 }
 function produceLabor(dt,efficiency){
  const rates=BALANCE.labor.productionPerWorkerPerSecond;
  for(const role of ["forestry","mining","hunting","farming"]){for(const [resource,rate] of Object.entries(rates[role]||{})){s.resources[resource]=(s.resources[resource]||0)+s.labor[role]*rate*efficiency*dt;}}
  const processing=s.labor.processing*(rates.processing.建材||0)*efficiency*dt;
  const converted=Math.min(processing,s.resources["木材"]||0,s.resources["石"]||0);
  if(converted>0){s.resources["木材"]-=converted;s.resources["石"]-=converted;s.goods["建材"]=(s.goods["建材"]||0)+converted;}
 }
 function consumeFood(dt){
  let needed=s.workers*BALANCE.worker.breadConsumptionPerSecond*dt,consumed=0;
  for(const resource of ["パン","小麦","肉"]){const stock=resource==="パン"?s.bread:(s.resources[resource]||0),used=Math.min(stock,needed);if(resource==="パン")s.bread-=used;else s.resources[resource]-=used;needed-=used;consumed+=used;if(needed<=0)break;}
  return dt>0?Math.min(s.workers,consumed/(BALANCE.worker.breadConsumptionPerSecond*dt)):0;
 }
function costText(cost){const parts=[];for(const [k,n] of Object.entries(cost.raw||{}))parts.push(k+" "+n);for(const [k,n] of Object.entries(cost.goods||{}))parts.push(k+" "+n);if(cost.electricity)parts.push("電力 "+fmt(cost.electricity));if(cost.money)parts.push("通貨 "+fmt(cost.money));return parts.join(" · ")||"なし";}
function hasCost(cost){return s.money>=(cost.money||0)&&s.electricity>=(cost.electricity||0)&&Object.entries(cost.raw||{}).every(([k,n])=>(s.resources[k]||0)>=n)&&Object.entries(cost.goods||{}).every(([k,n])=>(s.goods[k]||0)>=n);}
function payCost(cost){if(!hasCost(cost))return false;s.money-=cost.money||0;s.electricity-=cost.electricity||0;for(const [k,n] of Object.entries(cost.raw||{}))s.resources[k]-=n;for(const [k,n] of Object.entries(cost.goods||{}))s.goods[k]-=n;return true;}
function renderIndustry(){
 $("products").innerHTML=productNames.map(n=>`<div class="resource"><span>${n}</span><strong>${fmt(s.goods[n]||0)}</strong></div>`).join("");
 $("recipes").innerHTML=recipes.map((r,i)=>{const unlocked=s.researched.includes(r.tech),cost={raw:r.raw||{},goods:r.goods||{}},disabled=!unlocked||!hasCost(cost);return `<div class="industry-row ${unlocked?"":"locked"}"><div><strong>${r.name}</strong><small>${costText(cost)} → ${Object.entries(r.out).map(([k,v])=>k+" "+v).join(", ")}${unlocked?"":" · 要研究："+technologyNames[r.tech]}</small></div><button data-recipe="${i}" ${disabled?"disabled":""}>加工</button></div>`;}).join("");
 $("technologies").innerHTML=technologies.map(t=>{const done=s.researched.includes(t.id),ready=(t.requires||[]).every(id=>s.researched.includes(id)),disabled=done||!ready||!hasCost(t.cost);return `<div class="industry-row ${ready?"":"locked"}"><div><strong>${technologyNames[t.id]} ${done?"✓":""}</strong><small>${t.desc} · 必要資材：${costText(t.cost)}${!ready?" · 前提技術："+t.requires.map(x=>technologyNames[x]).join("・"):""}</small></div><button data-tech="${t.id}" ${disabled?"disabled":""}>${done?"研究済み":"研究"}</button></div>`;}).join("");
 $("rocketCount").textContent=fmt(s.goods["ロケット"]||0)+"（打ち上げ "+fmt(s.rocketsLaunched||0)+" 回）";
 $("launchRocket").disabled=!s.researched.includes("rocketry")||(s.goods["ロケット"]||0)<1;
}
function craftRecipe(index){const r=recipes[index];if(!r||!s.researched.includes(r.tech)||!payCost({raw:r.raw||{},goods:r.goods||{}}))return;for(const [k,n] of Object.entries(r.out))s.goods[k]=(s.goods[k]||0)+n;note(r.name+"を製造した。");render();}
function researchTech(id){const t=technologies.find(x=>x.id===id);if(!t||s.researched.includes(id)||(t.requires||[]).some(x=>!s.researched.includes(x))||!payCost(t.cost))return;s.researched.push(id);note("技術研究を完了："+technologyNames[id]+"（資源倍率 ×"+fmt(t.costMultiplier)+"）。");render();}
function render(){
 sanitizeState();
 $("money").textContent=fmt(s.money);$("gold").textContent=fmt(s.gold)+" g";$("bread").textContent=fmt(s.bread);
 $("bakeAmount").textContent="(+"+fmt(BALANCE.bread.clickProduction)+")";
 $("taxCost").textContent=fmt(BALANCE.tax.unlockCost);
 $("adminCost").textContent=fmt(administrationPurchaseCost());
 $("powerHint").textContent="人口が増えると国力が徐々に低下。国力0で生産性-50%、100以上で最大+20%。通貨"+fmt(BALANCE.power.recoveryCostPerPoint)+"で回復できます。";
 $("workers").textContent=fmt(s.workers);$("power").textContent=fmt(s.power);$("electricity").textContent=fmt(s.electricity);
  $("electricityStored").textContent=fmt(s.electricity);$("electricityRate").textContent=fmt(electricityGenerationPerSecond())+" / 秒";
  $("generatorCount").textContent=fmt(s.goods["発電機"]||0);$("reactorCount").textContent=fmt(s.goods["原子炉"]||0);
 const modifier=powerProductivityModifier(),allocated=allocatedWorkers(),unassigned=Math.max(0,s.workers-allocated);
 $("laborUnassigned").textContent=fmt(unassigned)+" 人";$("laborOutput").textContent="生産性 "+(modifier>=0?"+":"")+(modifier*100).toFixed(1)+"%";
 for(const role of laborRoles){const input=$("labor-"+role);if(input&&document.activeElement!==input)input.value=s.labor[role];const count=$("labor-count-"+role);if(count)count.textContent=fmt(s.labor[role])+" 人";}
 const shortage=Math.max(0,s.politicalBurden-s.power);
 $("burden").textContent=fmt(s.politicalBurden);$("powerShortage").textContent=(s.workers*BALANCE.worker.populationPowerDrainPerSecond).toFixed(3)+" / 秒";
 const recoveryAmount=Math.max(1,Math.floor(Number($("powerAmount").value)||1));
 $("recoveryPreview").textContent=`必要通貨：${fmt(recoveryAmount*POWER_RECOVERY_COST)}（現在の所持通貨で${fmt(Math.floor(s.money/BALANCE.power.recoveryCostPerPoint))}まで回復可能）`;
 $("recoverPower").disabled=s.money<recoveryAmount*POWER_RECOVERY_COST;
 $("recoverOne").disabled=s.money<BALANCE.power.recoveryCostPerPoint;$("recoverTen").disabled=s.money<10*BALANCE.power.recoveryCostPerPoint;
 $("recoverMax").disabled=s.money<POWER_RECOVERY_COST;
 const tax=s.tax?s.workers*BALANCE.worker.taxIncomePerSecond:0;const upkeep=s.workers*BALANCE.worker.upkeepPerSecond;
 $("income").textContent=(tax-upkeep>0?"+":"")+((tax-upkeep).toFixed(1))+" / 秒";
 $("ovenCost").textContent=fmt(BALANCE.oven.baseCost*Math.pow(BALANCE.oven.costMultiplier,s.ovens));$("workerCost").textContent=fmt(BALANCE.worker.baseCost*Math.pow(BALANCE.worker.costMultiplier,s.workers));
 $("taxStatus").textContent=s.tax?"導入済み":"未導入";$("taxIncome").textContent=fmt(tax)+" / 秒";
 $("powerBuildings").textContent=fmt(s.admins);$("era").textContent=(s.rocketsLaunched||0)>0?"宇宙時代":s.researched.includes("rocketry")?"宇宙開発準備":s.researched.includes("integrated_circuit")?"情報社会":s.researched.includes("electricity")?"電化社会":s.researched.includes("steam_power")?"産業革命":s.researched.includes("bronze_casting")?"青銅器時代":s.workers>=5||s.admins>=1?"都市国家":"村落";
 $("mineCost").textContent=fmt(mineExplorationCost());$("ovens").textContent=fmt(s.ovens);$("admins").textContent=fmt(s.admins);
 const mineLimit=mineLimitForPopulation(),activeMines=activeMineCount(),nextTier=nextMineThreshold(),prospects=s.mines.filter(m=>!m.developed&&m.remaining>0).length;$("mineCount").textContent=fmt(activeMines)+" / "+fmt(mineLimit)+"（稼働中）・未開発 "+fmt(prospects);$("totalMined").textContent=fmt(s.totalMined);$("mineLimitHint").textContent=nextTier?"人口 "+fmt(s.workers)+"人 · "+fmt(nextTier.minWorkers)+"人で開発可能な鉱山枠が "+fmt(nextTier.maxMines)+"へ拡張":"人口 "+fmt(s.workers)+"人 · 開発可能な鉱山枠 "+fmt(mineLimit)+"（最大段階）";
 $("buyOven").disabled=s.money<BALANCE.oven.baseCost*Math.pow(BALANCE.oven.costMultiplier,s.ovens);
 $("buyWorker").disabled=s.money<BALANCE.worker.baseCost*Math.pow(BALANCE.worker.costMultiplier,s.workers);
 $("buyTax").disabled=s.tax||s.money<BALANCE.tax.unlockCost;$("buyPower").disabled=s.money<administrationPurchaseCost();
  const locomotiveCount=s.goods["蒸気機関車"]||0,locomotiveDiscount=Math.min(BALANCE.administration.steamLocomotiveDiscountCap,locomotiveCount*BALANCE.administration.steamLocomotiveDiscountPerUnit);
  $("powerHint").textContent="蒸気機関車 "+fmt(locomotiveCount)+"両により行政機関の購入費用を"+(locomotiveDiscount*100).toFixed(0)+"%削減。国力回復は別途通貨"+fmt(BALANCE.power.recoveryCostPerPoint)+" / 1。";
 $("explore").disabled=s.money<mineExplorationCost();$("explore").textContent="鉱床を探査する";
 const surveyCost=mineExplorationCost(true);$("surveyCost").textContent=fmt(surveyCost);$("survey").disabled=s.money<surveyCost;
 $("sellBread").disabled=s.bread<10;$("sellAllBread").disabled=s.bread<1;
 $("sellGold").disabled=s.gold<1;$("sellAllGold").disabled=s.gold<1;
 $("sellResources").disabled=resourceNames.every(n=>n==="金"||(s.resources[n]||0)<1);
 $("resources").innerHTML=resourceNames.filter(n=>n!=="金").map(n=>`<div class="resource"><span>${n} <small>· ${fmt(prices[n])} / 個</small></span><strong>${fmt(s.resources[n]||0)}</strong></div>`).join("")+`<div class="resource"><span>金（資産） <small>· ${fmt(prices["金"])} / 個</small></span><strong>${fmt(s.gold)}</strong></div>`;if(!$("sellResource").options.length)$("sellResource").innerHTML=[...resourceNames.filter(n=>n!=="金"),"金"].map(n=>`<option value="${n}">${n}</option>`).join("");updateSellPreview();
 $("mines").innerHTML=s.mines.length?s.mines.map((m,i)=>{const requirement=mineRequirement(m),cost=mineDevelopmentCost(m),full=activeMineCount()>=mineLimitForPopulation(),label=m.hardness==="soft"?"軟岩":m.hardness==="hard"?"硬岩":"通常岩盤";return `<div class="mine"><div class="mine-head"><span class="mine-name">${m.type}鉱床 <span class="tag">${m.remaining<=0?"枯渇":m.developed?"稼働中":"未開発"}</span></span><strong>${fmt(m.remaining)} / ${fmt(m.capacity)}</strong></div><div class="progress"><span style="width:${Math.max(0,m.remaining/m.capacity*100)}%"></span></div><small>深度：${m.depth} · 地質：${label} · ${m.type==="金"?"金は資産として保管":"採掘資源"}</small>${m.developed?`<small>採掘速度：${m.rate.toFixed(1)} / 秒</small>`:`<small>開発投資：${fmt(cost)} 通貨 · ${requirement||"開発可能"}</small><button data-develop-mine="${i}" ${m.remaining<=0||!!requirement||full||s.money<cost?"disabled":""}>鉱山を開発する</button>`}</div>`;}).join(""):'<p class="muted">まだ鉱床は発見されていない。</p>';
 $("log").innerHTML=s.log.map(x=>`<div>${x.replaceAll("&","&amp;").replaceAll("<","&lt;")}</div>`).join("")||"<div>文明の歴史がここに記録される。</div>";
 renderIndustry();
}
$("laborPanel").addEventListener("change",e=>{const input=e.target.closest("[data-labor-role]");if(input)setLabor(input.dataset.laborRole,input.value);});
$("recipes").addEventListener("click",e=>{const b=e.target.closest("[data-recipe]");if(b)craftRecipe(Number(b.dataset.recipe));});
$("technologies").addEventListener("click",e=>{const b=e.target.closest("[data-tech]");if(b)researchTech(b.dataset.tech);});
$("mines").addEventListener("click",e=>{const b=e.target.closest("[data-develop-mine]");if(b)developMine(Number(b.dataset.developMine));});
$("launchRocket").onclick=()=>{if(!s.researched.includes("rocketry")||(s.goods["ロケット"]||0)<1)return;s.goods["ロケット"]--;s.rocketsLaunched=(s.rocketsLaunched||0)+1;note("ロケットを打ち上げた。宇宙時代が始まった！");render();};
$("bake").onclick=()=>bake(BALANCE.bread.clickProduction);
$("sellBread").onclick=()=>sellBread(10);
$("sellAllBread").onclick=()=>sellBread(s.bread);
$("buyOven").onclick=()=>{const c=Math.ceil(BALANCE.oven.baseCost*Math.pow(BALANCE.oven.costMultiplier,s.ovens));if(buy(c)){s.ovens++;note("かまどを購入した。");render();}};
$("buyWorker").onclick=()=>{const c=Math.ceil(BALANCE.worker.baseCost*Math.pow(BALANCE.worker.costMultiplier,s.workers));if(buy(c)){s.workers++;note("労働者を1人雇用した。");render();}};
$("buyTax").onclick=()=>{if(!s.tax&&buy(BALANCE.tax.unlockCost)){s.tax=true;note("税制を導入した。労働者から税収が発生する。");render();}};
$("buyPower").onclick=()=>{const c=administrationPurchaseCost();if(buy(c)){s.admins++;s.power=Math.min(100,s.power+BALANCE.administration.powerGrantedOnPurchase);note("行政機関を建設。費用："+fmt(c)+"。国力が回復した。");render();}};
$("explore").onclick=()=>discoverMine(weightedPick(),mineExplorationCost());
$("survey").onclick=()=>discoverMine($("surveyResource").value,mineExplorationCost(true));
function selectedStock(name){return name==="金"?s.gold:(s.resources[name]||0);}
 function updateSellPreview(){const name=$("sellResource").value||"鉄",stock=selectedStock(name),qty=Math.floor(Number($("sellQuantity").value)),valid=Number.isFinite(qty)&&qty>=1&&qty<=Math.floor(stock);$("sellPreview").textContent=`所持：${fmt(stock)} · 売却額：${fmt(Math.max(0,qty)*prices[name])} 通貨`;$("sellSelected").disabled=!valid;$("sellSelectedAll").disabled=stock<1;}
 function sellSelected(all=false){const name=$("sellResource").value,stock=selectedStock(name),requested=all?Math.floor(stock):Math.floor(Number($("sellQuantity").value)),qty=Math.min(stock,requested);if(!name||!Number.isFinite(qty)||qty<1)return;if(name==="金")s.gold-=qty;else s.resources[name]-=qty;const revenue=qty*prices[name];s.money+=revenue;note(`${name}を${fmt(qty)}個売却し、通貨${fmt(revenue)}を得た。`);render();}
 $("sellResource").addEventListener("change",updateSellPreview);$("sellQuantity").addEventListener("input",updateSellPreview);$("sellSelected").onclick=()=>sellSelected(false);$("sellSelectedAll").onclick=()=>sellSelected(true);
 $("sellGold").onclick=()=>{if(s.gold>=1){s.gold--;s.money+=prices["金"];note("金1 gを売却し、通貨"+fmt(prices["金"])+"を得た。");render();}};
$("sellResources").onclick=()=>{let total=0,items=0;for(const n of resourceNames){if(n==="金")continue;const amount=Math.floor(s.resources[n]||0);if(amount>0){s.resources[n]-=amount;total+=amount*prices[n];items+=amount;}}if(total>0){s.money+=total;note(fmt(items)+"個の資源を売却し、通貨"+fmt(total)+"を得た。");render();}};
$("sellAllGold").onclick=()=>{const n=Math.floor(s.gold);if(n>0){s.gold-=n;s.money+=n*prices["金"];note(`金${n} gを売却し、通貨${fmt(n*prices["金"])}を得た。`);render();}};
function recoverPower(amount){amount=Math.floor(Number(amount));if(!Number.isFinite(amount)||amount<1)return;const recoverable=Math.min(amount,100-s.power);if(recoverable<1)return;const cost=recoverable*BALANCE.power.recoveryCostPerPoint;if(s.money<cost){note("通貨が足りないため、国力を回復できなかった。");render();return;}s.money-=cost;s.power=Math.min(100,s.power+recoverable);note(`通貨${fmt(cost)}を使い、国力を${fmt(recoverable)}回復した。`);render();}
$("powerAmount").addEventListener("input",()=>{const v=Math.floor(Number($("powerAmount").value));$("recoverPower").disabled=!Number.isFinite(v)||v<1||s.money<v*POWER_RECOVERY_COST;$("recoveryPreview").textContent=v>0?`必要通貨：${fmt(v*POWER_RECOVERY_COST)}（現在の所持通貨で${fmt(Math.floor(s.money/POWER_RECOVERY_COST))}まで回復可能）`:"1以上の整数を入力してください。";});
$("recoverPower").onclick=()=>recoverPower($("powerAmount").value);
$("recoverOne").onclick=()=>recoverPower(1);
$("recoverTen").onclick=()=>recoverPower(10);
$("recoverMax").onclick=()=>recoverPower(Math.floor(s.money/POWER_RECOVERY_COST));
$("save").onclick=()=>save();
$("reset").onclick=()=>{if(confirm("セーブデータを消して最初から始めますか？")){localStorage.removeItem("goldClickerSave");s=fresh();note("新しい文明が始まった。");render();}};
function simulate(seconds){sanitizeState();const rawDt=Number(seconds),dt=Number.isFinite(rawDt)?Math.max(0,rawDt):0;if(!dt)return;
 const burden=s.workers*BALANCE.worker.politicalBurden+s.ovens*BALANCE.oven.politicalBurden+s.admins*BALANCE.administration.politicalBurden+s.mines.filter(m=>m.developed&&m.remaining>0).length*BALANCE.mine.politicalBurdenPerActiveMine;
 s.politicalBurden=burden;
 const shortage=Math.max(0,burden-s.power);
 const efficiency=1+powerProductivityModifier();
 s.bread+=s.ovens*BALANCE.oven.breadProductionPerSecond*efficiency*dt;
 const fed=consumeFood(dt);
 if(s.tax)s.money+=fed*BALANCE.worker.taxIncomePerSecond*dt;
 s.money=Math.max(0,s.money-s.workers*BALANCE.worker.upkeepPerSecond*dt);
 s.power=Math.min(100,Math.max(0,s.power-s.workers*BALANCE.worker.populationPowerDrainPerSecond*dt)+(s.admins*BALANCE.administration.powerRecoveryPerSecond+(s.goods["発電機"]||0)*BALANCE.generator.powerRecoveryPerSecondPerUnit)*dt);
 const generatorCount=s.goods["発電機"]||0,reactorCount=s.goods["原子炉"]||0;
 const coalNeed=generatorCount*BALANCE.generator.coalConsumptionPerSecondPerUnit*dt,coalAvailable=s.resources["石炭"]||0;
 const coalFuelRatio=coalNeed>0?Math.min(1,coalAvailable/coalNeed):0,coalUsed=coalNeed*coalFuelRatio;
 if(coalUsed>0)s.resources["石炭"]-=coalUsed;
 const uraniumNeed=reactorCount*BALANCE.generator.uraniumConsumptionPerSecondPerReactor*dt,uraniumAvailable=s.resources["ウラン"]||0;
 const reactorFuelRatio=uraniumNeed>0?Math.min(1,uraniumAvailable/uraniumNeed):0,uraniumUsed=uraniumNeed*reactorFuelRatio;
 if(uraniumUsed>0)s.resources["ウラン"]-=uraniumUsed;
 s.electricity+=(generatorCount*BALANCE.generator.electricityPerSecondPerUnit*coalFuelRatio+reactorCount*BALANCE.generator.nuclearElectricityPerSecondPerUnit*reactorFuelRatio)*dt;
 produceLabor(dt,efficiency);
 const machineBonus=1+(s.goods["蒸気機関"]||0)*BALANCE.mine.steamEngineMiningRateBonusPerUnit;
 const miningWorkers=s.labor.mining,requiredMiners=Math.max(1,activeMineCount()*BALANCE.labor.mineWorkersPerFullRate),mineLaborFactor=Math.min(1,miningWorkers/requiredMiners);
 for(const m of s.mines){if(m.developed&&m.remaining>0&&mineLaborFactor>0){const mined=Math.min(m.rate*efficiency*machineBonus*mineLaborFactor*dt,m.remaining);m.remaining=Math.max(0,m.remaining-mined);if(m.type==="金")s.gold+=mined;else s.resources[m.type]=(s.resources[m.type]||0)+mined;s.totalMined+=mined;}}
}
let ticks=0;
load();note("ゲームを開始した。まずはパンを作って売ろう。");render();
setInterval(()=>{simulate(1);ticks++;if(ticks%5===0)save(true);render();},1000);
})().catch(error=>{console.error("ゲーム初期化エラー:",error);document.body.innerHTML="<main style=\"padding:24px;color:white\"><h1>ゲームを初期化できません</h1><pre></pre></main>";document.querySelector("pre").textContent=String(error);});
