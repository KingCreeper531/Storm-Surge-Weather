// ================================================================
//  NWS SOCIAL PANEL v13.9
//  Nearest NWS office X/Twitter feed via Nitter RSS (no API key)
// ================================================================
window.NWSsocial = (() => {
  'use strict';
  const OFFICES = [
    {id:'AKQ',name:'NWS Wakefield VA',handle:'NWSWakefield',lat:36.98,lng:-77.01},
    {id:'ALY',name:'NWS Albany NY',handle:'NWSAlbany',lat:42.75,lng:-73.83},
    {id:'AMA',name:'NWS Amarillo TX',handle:'NWSAmarillo',lat:35.22,lng:-101.70},
    {id:'APX',name:'NWS Gaylord MI',handle:'NWSGaylord',lat:44.91,lng:-84.72},
    {id:'ARX',name:'NWS La Crosse WI',handle:'NWSLaCrosse',lat:43.82,lng:-91.19},
    {id:'BGM',name:'NWS Binghamton NY',handle:'NWSBinghamton',lat:42.20,lng:-75.98},
    {id:'BIS',name:'NWS Bismarck ND',handle:'NWSBismarck',lat:46.77,lng:-100.76},
    {id:'BMX',name:'NWS Birmingham AL',handle:'NWSBirmingham',lat:33.17,lng:-86.77},
    {id:'BOI',name:'NWS Boise ID',handle:'NWSBoise',lat:43.57,lng:-116.21},
    {id:'BOU',name:'NWS Denver CO',handle:'NWSBoulder',lat:40.00,lng:-105.25},
    {id:'BOX',name:'NWS Boston MA',handle:'NWSBoston',lat:42.36,lng:-71.06},
    {id:'BRO',name:'NWS Brownsville TX',handle:'NWSBrownsville',lat:25.90,lng:-97.42},
    {id:'BTV',name:'NWS Burlington VT',handle:'NWSBurlington',lat:44.47,lng:-73.21},
    {id:'BUF',name:'NWS Buffalo NY',handle:'NWSBuffalo',lat:42.89,lng:-78.87},
    {id:'CAR',name:'NWS Caribou ME',handle:'NWSCaribou',lat:46.87,lng:-68.02},
    {id:'CHS',name:'NWS Charleston SC',handle:'NWSCharlestonSC',lat:32.78,lng:-79.94},
    {id:'CLE',name:'NWS Cleveland OH',handle:'NWSCleveland',lat:41.50,lng:-81.69},
    {id:'CRP',name:'NWS Corpus Christi TX',handle:'NWSCorpusChristi',lat:27.80,lng:-97.40},
    {id:'CTP',name:'NWS State College PA',handle:'NWSStateCollege',lat:40.79,lng:-77.86},
    {id:'CYS',name:'NWS Cheyenne WY',handle:'NWSCheyenne',lat:41.15,lng:-104.82},
    {id:'DDC',name:'NWS Dodge City KS',handle:'NWSDodgeCity',lat:37.76,lng:-99.97},
    {id:'DLH',name:'NWS Duluth MN',handle:'NWSDuluth',lat:46.84,lng:-92.19},
    {id:'DMX',name:'NWS Des Moines IA',handle:'NWSDesMoines',lat:41.73,lng:-93.72},
    {id:'DTX',name:'NWS Detroit MI',handle:'NWSDetroit',lat:42.70,lng:-83.47},
    {id:'DVN',name:'NWS Quad Cities',handle:'NWSQuadCities',lat:41.61,lng:-90.58},
    {id:'EAX',name:'NWS Kansas City MO',handle:'NWSKansasCity',lat:38.81,lng:-94.26},
    {id:'EKA',name:'NWS Eureka CA',handle:'NWSEureka',lat:40.80,lng:-124.16},
    {id:'EPZ',name:'NWS El Paso TX',handle:'NWSElPaso',lat:31.81,lng:-106.53},
    {id:'EWX',name:'NWS Austin/San Antonio',handle:'NWSAustinSanAnt',lat:29.70,lng:-98.02},
    {id:'FFC',name:'NWS Atlanta GA',handle:'NWSAtlanta',lat:33.36,lng:-84.57},
    {id:'FGF',name:'NWS Grand Forks ND',handle:'NWSGrandForks',lat:47.93,lng:-97.18},
    {id:'FGZ',name:'NWS Flagstaff AZ',handle:'NWSFlagstaff',lat:35.23,lng:-111.82},
    {id:'FSD',name:'NWS Sioux Falls SD',handle:'NWSSiouxFalls',lat:43.73,lng:-96.62},
    {id:'FWD',name:'NWS Dallas/Fort Worth',handle:'NWSDFWx',lat:32.83,lng:-97.30},
    {id:'GGW',name:'NWS Glasgow MT',handle:'NWSGlasgow',lat:48.21,lng:-106.62},
    {id:'GID',name:'NWS Hastings NE',handle:'NWSHastings',lat:40.58,lng:-98.43},
    {id:'GJT',name:'NWS Grand Junction CO',handle:'NWSGrandJunction',lat:39.12,lng:-108.53},
    {id:'GLD',name:'NWS Goodland KS',handle:'NWSGoodland',lat:39.37,lng:-101.70},
    {id:'GRB',name:'NWS Green Bay WI',handle:'NWSGreenBay',lat:44.48,lng:-88.13},
    {id:'GRR',name:'NWS Grand Rapids MI',handle:'NWSGrandRapids',lat:42.89,lng:-85.52},
    {id:'GSP',name:'NWS Greenville SC',handle:'NWSGreenville',lat:34.89,lng:-82.22},
    {id:'GYX',name:'NWS Gray ME',handle:'NWSGray',lat:43.89,lng:-70.26},
    {id:'HFO',name:'NWS Honolulu HI',handle:'NWSHonolulu',lat:21.30,lng:-157.86},
    {id:'HGX',name:'NWS Houston TX',handle:'NWSHouston',lat:29.47,lng:-95.08},
    {id:'HNX',name:'NWS Hanford CA',handle:'NWSHanford',lat:36.31,lng:-119.63},
    {id:'HUN',name:'NWS Huntsville AL',handle:'NWSHuntsville',lat:34.73,lng:-86.59},
    {id:'ICT',name:'NWS Wichita KS',handle:'NWSWichita',lat:37.65,lng:-97.43},
    {id:'ILM',name:'NWS Wilmington NC',handle:'NWSWilmingtonNC',lat:34.27,lng:-77.90},
    {id:'ILN',name:'NWS Wilmington OH',handle:'NWSWilmingtonOH',lat:39.42,lng:-83.82},
    {id:'ILX',name:'NWS Lincoln IL',handle:'NWSLincoln',lat:40.15,lng:-89.34},
    {id:'IND',name:'NWS Indianapolis IN',handle:'NWSIndianapolis',lat:39.77,lng:-86.16},
    {id:'IWX',name:'NWS Northern Indiana',handle:'NWSNorthernIndiana',lat:41.36,lng:-85.20},
    {id:'JAN',name:'NWS Jackson MS',handle:'NWSJackson',lat:32.30,lng:-90.18},
    {id:'JAX',name:'NWS Jacksonville FL',handle:'NWSJacksonville',lat:30.33,lng:-81.66},
    {id:'JKL',name:'NWS Jackson KY',handle:'NWSJacksonKY',lat:37.59,lng:-83.31},
    {id:'KEY',name:'NWS Key West FL',handle:'NWSKeyWest',lat:24.56,lng:-81.78},
    {id:'LBF',name:'NWS North Platte NE',handle:'NWSNorthPlatte',lat:41.13,lng:-100.68},
    {id:'LCH',name:'NWS Lake Charles LA',handle:'NWSLakeCharles',lat:30.13,lng:-93.22},
    {id:'LMK',name:'NWS Louisville KY',handle:'NWSLouisville',lat:38.18,lng:-85.74},
    {id:'LOT',name:'NWS Chicago IL',handle:'NWSChicago',lat:41.60,lng:-88.08},
    {id:'LOX',name:'NWS Los Angeles CA',handle:'NWSLosAngeles',lat:34.05,lng:-118.25},
    {id:'LSX',name:'NWS St. Louis MO',handle:'NWSStLouis',lat:38.63,lng:-90.20},
    {id:'LUB',name:'NWS Lubbock TX',handle:'NWSLubbock',lat:33.57,lng:-101.86},
    {id:'LWX',name:'NWS Baltimore/DC',handle:'NWSBaltimore',lat:38.89,lng:-77.03},
    {id:'LZK',name:'NWS Little Rock AR',handle:'NWSLittleRock',lat:34.75,lng:-92.29},
    {id:'MAF',name:'NWS Midland TX',handle:'NWSMidland',lat:31.99,lng:-102.08},
    {id:'MEG',name:'NWS Memphis TN',handle:'NWSMemphis',lat:35.15,lng:-90.05},
    {id:'MFR',name:'NWS Medford OR',handle:'NWSMedford',lat:42.33,lng:-122.87},
    {id:'MHX',name:'NWS Newport NC',handle:'NWSMHXWeather',lat:34.73,lng:-76.88},
    {id:'MKX',name:'NWS Milwaukee WI',handle:'NWSMilwaukee',lat:43.04,lng:-87.91},
    {id:'MLB',name:'NWS Melbourne FL',handle:'NWSMelbourne',lat:28.08,lng:-80.61},
    {id:'MOB',name:'NWS Mobile AL',handle:'NWSMobile',lat:30.69,lng:-88.04},
    {id:'MPX',name:'NWS Twin Cities MN',handle:'NWSTwinCities',lat:44.98,lng:-93.27},
    {id:'MQT',name:'NWS Marquette MI',handle:'NWSMarquette',lat:46.54,lng:-87.40},
    {id:'MRX',name:'NWS Morristown TN',handle:'NWSMorristown',lat:36.21,lng:-83.47},
    {id:'MSO',name:'NWS Missoula MT',handle:'NWSMissoula',lat:46.87,lng:-114.02},
    {id:'MTR',name:'NWS San Francisco CA',handle:'NWSSanFrancisco',lat:37.77,lng:-122.42},
    {id:'OAX',name:'NWS Omaha NE',handle:'NWSOmaha',lat:41.26,lng:-96.01},
    {id:'OHX',name:'NWS Nashville TN',handle:'NWSNashville',lat:36.17,lng:-86.78},
    {id:'OKX',name:'NWS New York NY',handle:'NWSNewYorkNY',lat:40.71,lng:-74.01},
    {id:'OTX',name:'NWS Spokane WA',handle:'NWSSpokane',lat:47.66,lng:-117.43},
    {id:'OUN',name:'NWS Norman OK',handle:'NWSNorman',lat:35.22,lng:-97.44},
    {id:'PAH',name:'NWS Paducah KY',handle:'NWSPaducah',lat:37.07,lng:-88.60},
    {id:'PBZ',name:'NWS Pittsburgh PA',handle:'NWSPittsburgh',lat:40.44,lng:-79.99},
    {id:'PDT',name:'NWS Pendleton OR',handle:'NWSPendleton',lat:45.67,lng:-118.79},
    {id:'PHI',name:'NWS Philadelphia PA',handle:'NWSPhiladelphia',lat:39.95,lng:-75.17},
    {id:'PIH',name:'NWS Pocatello ID',handle:'NWSPocatello',lat:42.87,lng:-112.45},
    {id:'PQR',name:'NWS Portland OR',handle:'NWSPortland',lat:45.52,lng:-122.68},
    {id:'PSR',name:'NWS Phoenix AZ',handle:'NWSPhoenix',lat:33.45,lng:-112.07},
    {id:'PUB',name:'NWS Pueblo CO',handle:'NWSPueblo',lat:38.25,lng:-104.61},
    {id:'RAH',name:'NWS Raleigh NC',handle:'NWSRaleigh',lat:35.78,lng:-78.64},
    {id:'REV',name:'NWS Reno NV',handle:'NWSReno',lat:39.53,lng:-119.81},
    {id:'RIW',name:'NWS Riverton WY',handle:'NWSRiverton',lat:43.02,lng:-108.38},
    {id:'RLX',name:'NWS Charleston WV',handle:'NWSCharlestonWV',lat:38.35,lng:-81.63},
    {id:'RNK',name:'NWS Blacksburg VA',handle:'NWSBlacksburg',lat:37.23,lng:-80.41},
    {id:'SEW',name:'NWS Seattle WA',handle:'NWSSeattle',lat:47.61,lng:-122.33},
    {id:'SGF',name:'NWS Springfield MO',handle:'NWSSpringfield',lat:37.21,lng:-93.29},
    {id:'SGX',name:'NWS San Diego CA',handle:'NWSSanDiego',lat:32.72,lng:-117.16},
    {id:'SHV',name:'NWS Shreveport LA',handle:'NWSShreveport',lat:32.52,lng:-93.75},
    {id:'SJT',name:'NWS San Angelo TX',handle:'NWSSanAngelo',lat:31.46,lng:-100.44},
    {id:'SJU',name:'NWS San Juan PR',handle:'NWSSanJuan',lat:18.47,lng:-66.12},
    {id:'SLC',name:'NWS Salt Lake City UT',handle:'NWSSaltLakeCity',lat:40.76,lng:-111.89},
    {id:'STO',name:'NWS Sacramento CA',handle:'NWSSacramento',lat:38.58,lng:-121.49},
    {id:'TAE',name:'NWS Tallahassee FL',handle:'NWSTallahassee',lat:30.44,lng:-84.28},
    {id:'TBW',name:'NWS Tampa Bay FL',handle:'NWSTampaBay',lat:27.95,lng:-82.46},
    {id:'TFX',name:'NWS Great Falls MT',handle:'NWSGreatFalls',lat:47.50,lng:-111.30},
    {id:'TOP',name:'NWS Topeka KS',handle:'NWSTopeka',lat:39.05,lng:-95.68},
    {id:'TSA',name:'NWS Tulsa OK',handle:'NWSTulsa',lat:36.15,lng:-95.99},
    {id:'TWC',name:'NWS Tucson AZ',handle:'NWSTucson',lat:32.22,lng:-110.97},
    {id:'UNR',name:'NWS Rapid City SD',handle:'NWSRapidCity',lat:44.08,lng:-103.23},
    {id:'VEF',name:'NWS Las Vegas NV',handle:'NWSLasVegas',lat:36.17,lng:-115.14},
  ];

  const NITTER = [
    'https://nitter.privacydev.net',
    'https://nitter.poast.org',
    'https://nitter.nl',
  ];

  let _panel=null, _open=false, _office=null, _proxyIdx=0;

  function _hav(a,b,c,d){const R=6371,dL=(c-a)*Math.PI/180,dN=(d-b)*Math.PI/180,x=Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dN/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}

  function nearest(lat,lng){
    return OFFICES.reduce((b,o)=>{const d=_hav(lat,lng,o.lat,o.lng);return d<b.d?{o,d}:b},{o:OFFICES[0],d:Infinity}).o;
  }

  function _esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function _ago(d){const s=Math.floor((Date.now()-d)/1000);if(s<60)return s+'s ago';if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';}

  async function _fetch(handle){
    for(let i=0;i<NITTER.length;i++){
      const proxy=NITTER[(_proxyIdx+i)%NITTER.length];
      try{
        const r=await fetch(`${proxy}/${handle}/rss`,{signal:AbortSignal.timeout(6000)});
        if(!r.ok)continue;
        const xml=await r.text();
        const doc=new DOMParser().parseFromString(xml,'text/xml');
        const items=Array.from(doc.querySelectorAll('item')).slice(0,12);
        if(!items.length)continue;
        _proxyIdx=(_proxyIdx+i)%NITTER.length;
        return items.map(it=>({
          text:(it.querySelector('description')?.textContent||'')
            .replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#039;/g,"'").trim(),
          link:it.querySelector('link')?.textContent||`https://x.com/${handle}`,
          ts:new Date(it.querySelector('pubDate')?.textContent||Date.now()),
        }));
      }catch(e){continue;}
    }
    return null;
  }

  function _render(posts, office){
    const feed=$('nwsSocialFeed'), sub=$('nwsSocialSub'), lnk=$('nwsSocialXLink');
    if(sub) sub.textContent=`@${office.handle} · ${office.name}`;
    if(lnk){ lnk.href=`https://x.com/${office.handle}`; lnk.textContent='Open on X ↗'; }
    if(!posts||!posts.length){
      feed.innerHTML=`<div style="text-align:center;padding:32px;color:var(--t3)"><div style="font-size:2rem">🐦</div><div style="margin-top:8px;font-size:.82rem">Nitter unavailable — <a href="https://x.com/${_esc(office.handle)}" target="_blank" rel="noopener" style="color:#1d9bf0">view on X.com ↗</a></div></div>`;
      return;
    }
    feed.innerHTML=posts.map(p=>{
      const isAlert=/warning|watch|advisory|tornado|hurricane|flood|blizzard|urgent|statement/i.test(p.text);
      const txt=_esc(p.text).replace(/https?:\/\/[^\s<]+/g,u=>`<a href="${u}" target="_blank" rel="noopener" style="color:#1d9bf0">${u.replace(/^https?:\/\//,'')}</a>`);
      return `<div style="padding:10px 16px;border-bottom:1px solid rgba(255,255,255,.05)${isAlert?';background:rgba(239,68,68,.06);border-left:3px solid #ef4444':''}"><div style="font-size:.82rem;color:var(--t1,#f1f5f9);line-height:1.5">${txt}</div><div style="display:flex;align-items:center;gap:8px;margin-top:5px"><span style="font-size:.68rem;color:var(--t3)">${_ago(p.ts)}</span>${isAlert?'<span style="font-size:.65rem;background:rgba(239,68,68,.2);color:#ef4444;padding:1px 6px;border-radius:10px">⚠ ALERT</span>':''}<a href="${_esc(p.link)}" target="_blank" rel="noopener" style="font-size:.68rem;color:#1d9bf0;margin-left:auto">View ↗</a></div></div>`;
    }).join('');
  }

  async function _load(lat,lng){
    _office=nearest(lat,lng);
    const t=$('nwsSocialTitle'),sub=$('nwsSocialSub'),feed=$('nwsSocialFeed');
    if(t)   t.textContent='NWS Updates';
    if(sub) sub.textContent=`Finding office for ${lat.toFixed(1)}, ${lng.toFixed(1)}…`;
    if(feed)feed.innerHTML='<div style="text-align:center;padding:28px;color:var(--t3)"><div style="font-size:1.5rem;animation:spin 1s linear infinite;display:inline-block">⟳</div><div style="margin-top:8px;font-size:.82rem">Loading posts…</div></div>';
    const posts=await _fetch(_office.handle);
    _render(posts||[], _office);
  }

  function _build(){
    const el=document.createElement('div');
    el.id='nwsSocialPanel';
    el.style.cssText='position:fixed;bottom:0;left:50%;transform:translateX(-50%) translateY(110%);width:min(500px,96vw);max-height:440px;background:var(--bg2,#1a1f2e);border:1px solid rgba(255,255,255,.1);border-bottom:none;border-radius:14px 14px 0 0;z-index:8000;display:flex;flex-direction:column;box-shadow:0 -8px 32px rgba(0,0,0,.5);transition:transform .3s cubic-bezier(.34,1.2,.64,1);font-family:Outfit,sans-serif;overflow:hidden';
    el.innerHTML=`
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px 10px;border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0">
        <span style="font-size:1.15rem">🐦</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:.9rem;color:var(--t1,#f1f5f9)" id="nwsSocialTitle">NWS Updates</div>
          <div style="font-size:.72rem;color:var(--t3,#64748b);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" id="nwsSocialSub">Loading…</div>
        </div>
        <a id="nwsSocialXLink" href="#" target="_blank" rel="noopener" style="font-size:.72rem;color:#1d9bf0;border:1px solid rgba(29,155,240,.35);padding:3px 10px;border-radius:20px;white-space:nowrap;text-decoration:none">Open on X ↗</a>
        <button id="nwsSocialClose" style="background:none;border:none;color:var(--t3,#94a3b8);font-size:1.1rem;cursor:pointer;padding:2px 6px;flex-shrink:0">✕</button>
      </div>
      <div id="nwsSocialFeed" style="overflow-y:auto;flex:1"></div>
    `;
    document.body.appendChild(el);
    el.querySelector('#nwsSocialClose').onclick=()=>NWSsocial.close();
    return el;
  }

  return {
    init(){ _panel=_build(); },
    open(lat,lng){ if(!_panel)_panel=_build(); _open=true; _panel.style.transform='translateX(-50%) translateY(0)'; _load(lat,lng); },
    close(){ _open=false; if(_panel)_panel.style.transform='translateX(-50%) translateY(110%)'; },
    toggle(lat,lng){ _open?this.close():this.open(lat,lng); return _open; },
    isOpen(){ return _open; },
    getOffice(){ return _office; },
    nearest,
  };
})();
