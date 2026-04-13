'use client';
/**
 * STATUS — Command Center
 * Operational truth dashboard: health, exchanges, AI credits,
 * logs, gladiator, trading ops, system resources.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRealtimeData } from '@/hooks/useRealtimeData';
import BottomNav from '@/components/BottomNav';
import DeepSeekStatus from '@/app/components/DeepSeekStatus';

const C = {
  bg:'#07080d', surface:'#0d1018', surfaceAlt:'#111520', border:'#1a2133', borderAlt:'#242d40',
  green:'#00e676', greenBg:'#00e67614', red:'#ff3d57', redBg:'#ff3d5714',
  yellow:'#ffd600', yellowBg:'#ffd60014', blue:'#29b6f6', blueBg:'#29b6f614',
  purple:'#b39ddb', purpleBg:'#b39ddb14', muted:'#3a4558', mutedLight:'#5a6a85',
  text:'#c8d4e8', textDim:'#8899b0', white:'#edf2fb',
  font:'system-ui,-apple-system,"Segoe UI",sans-serif',
};

interface HealthData {
  status:string; version:string; systemMode:string; uptimeSecs:number;
  coreMonitor:{heartbeat:string;watchdog:string;killSwitch:string};
  trading:{autoSelectEnabled:boolean;totalGladiators:number;decisionsToday:number;forgeProgress:number};
  api:{binance:{ok:boolean;mode:string;latencyMs:number};dexScreener:{ok:boolean};coinGecko:{ok:boolean}};
  timestamp:string;
}
interface DiagData {
  overallHealth:string;
  mexc?:{status:string;latencyMs:number;usdtBalance:number;healthGrade:string;clockDriftMs:number};
  supabase?:{status:string;writeLatencyMs:number;readLatencyMs:number;roundtripMs:number;consistent:boolean;healthGrade:string};
  equity?:{currentBalance:number;peakBalance:number;maxDrawdownPercent:number;totalTrades:number;wins:number;losses:number;winRatePercent:number;mode:string;haltedUntil:string|null};
  sentinel?:{dailyLossPercent?:number;maxDrawdown?:number;triggered?:boolean};
  positions?:{total:number;open:number;closed:number};
  system?:{memoryUsageMB:{rss:number;heapUsed:number;heapTotal:number};uptimeSeconds:number;nodeVersion:string;diagnosticDurationMs:number};
}
interface CreditsData {
  openai:{status:string;balance:string};
  deepseek:{status:string;balance:string;is_available:boolean};
}
interface ExchangeRow { name:string;enabled:boolean;mode:string;connected:boolean;error?:string; }
interface ExchangeData { activeExchange:string; exchanges:ExchangeRow[]; }

function hColor(s:string|boolean|undefined):string{
  if(s===undefined||s===null)return C.mutedLight;
  const v=String(s).toUpperCase();
  if(s===true||['OK','HEALTHY','GREEN','ACTIVE','SAFE','CONNECTED'].includes(v))return C.green;
  if(s===false||['ERROR','DEGRADED','CRITICAL','RED','INVALID_KEY','MISSING_KEY','NETWORK_ERROR'].includes(v))return C.red;
  if(['WARNING','YELLOW','INACTIVE','QUOTA_EXCEEDED'].includes(v))return C.yellow;
  return C.mutedLight;
}
function hBg(s:string|boolean|undefined):string{
  const c=hColor(s);
  if(c===C.green)return C.greenBg;
  if(c===C.red)return C.redBg;
  if(c===C.yellow)return C.yellowBg;
  return 'transparent';
}
function uptime(s:number):string{
  if(!s||s<=0)return'—';
  const d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60);
  return d>0?`${d}d ${h}h`:`${h}h ${m}m`;
}
function ft(ts:string):string{
  try{return new Date(ts).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});}catch{return'—';}
}
function lColor(l:string):string{
  const u=l?.toUpperCase();
  if(u==='ERROR'||u==='FATAL')return C.red;
  if(u==='WARN'||u==='WARNING')return C.yellow;
  if(u==='DEBUG')return C.muted;
  return C.mutedLight;
}
function gColor(g:string|undefined):string{
  if(!g)return C.mutedLight;
  const u=g.toUpperCase();
  return u==='A'?C.green:u==='B'?C.yellow:u==='C'?C.red:C.mutedLight;
}

export default function StatusPage(){
  const {dashboard:dash,bot,connectionStatus,lastUpdate,updateCount,forceRefresh}=useRealtimeData();
  const [health,setHealth]=useState<HealthData|null>(null);
  const [diag,setDiag]=useState<DiagData|null>(null);
  const [credits,setCredits]=useState<CreditsData|null>(null);
  const [exchanges,setExchanges]=useState<ExchangeData|null>(null);
  const [loading,setLoading]=useState(true);
  const [diagLoading,setDiagLoading]=useState(false);
  const [lastDiag,setLastDiag]=useState<Date|null>(null);
  const [activeLog,setActiveLog]=useState<'all'|'error'|'warn'>('all');
  const diagRef=useRef<NodeJS.Timeout|null>(null);

  const fetchLight=useCallback(async()=>{
    try{
      const[hR,eR]=await Promise.allSettled([
        fetch('/api/health').then(r=>r.ok?r.json():null),
        fetch('/api/exchanges').then(r=>r.ok?r.json():null),
      ]);
      if(hR.status==='fulfilled'&&hR.value)setHealth(hR.value);
      if(eR.status==='fulfilled'&&eR.value)setExchanges(eR.value);
    }catch{}
  },[]);

  const fetchDiag=useCallback(async()=>{
    setDiagLoading(true);
    try{
      const[dR,cR]=await Promise.allSettled([
        fetch('/api/diagnostics/master').then(r=>r.ok?r.json():null),
        fetch('/api/diagnostics/credits').then(r=>r.ok?r.json():null),
      ]);
      if(dR.status==='fulfilled'&&dR.value)setDiag(dR.value);
      if(cR.status==='fulfilled'&&cR.value)setCredits(cR.value);
      setLastDiag(new Date());
    }catch{}finally{setDiagLoading(false);setLoading(false);}
  },[]);

  const refreshAll=useCallback(async()=>{
    await Promise.all([fetchLight(),fetchDiag(),forceRefresh()]);
  },[fetchLight,fetchDiag,forceRefresh]);

  useEffect(()=>{
    fetchLight(); fetchDiag();
    const lt=setInterval(fetchLight,20000);
    diagRef.current=setInterval(fetchDiag,90000);
    return()=>{clearInterval(lt);if(diagRef.current)clearInterval(diagRef.current);};
  },[fetchLight,fetchDiag]);

  const overallStatus=health?.status||diag?.overallHealth||(loading?'LOADING':'UNKNOWN');
  const statusCol=hColor(overallStatus);
  const gladiators=bot?.gladiators||[];
  const omega=gladiators.find(g=>g.isOmega)||gladiators[0]||null;
  const logs=dash?.logs?.recent||[];
  const filteredLogs=logs.filter(l=>
    activeLog==='all'?true:
    activeLog==='error'?['error','fatal'].includes(l.level?.toLowerCase()):
    ['warn','warning'].includes(l.level?.toLowerCase())
  );
  const errorCount=logs.filter(l=>['error','fatal'].includes(l.level?.toLowerCase())).length;
  const warnCount=logs.filter(l=>['warn','warning'].includes(l.level?.toLowerCase())).length;
  const connLabel:Record<string,string>={connected:'SSE LIVE',connecting:'CONNECTING',reconnecting:'RECONNECTING',polling:'POLLING',error:'ERROR'};
  const connColor:Record<string,string>={connected:C.green,connecting:C.yellow,reconnecting:C.yellow,polling:C.blue,error:C.red};

  const card=(label:string,val:string,col?:string)=>(
    <div className="stat-card" style={{background:C.surface, padding:'12px'}}>
      <div className="stat-label" style={{color:C.mutedLight}}>{label}</div>
      <div className="stat-value" style={{color:col||C.white, fontSize:'1.2rem'}}>{val}</div>
    </div>
  );

  return(
    <div style={{background:C.bg,minHeight:'100vh',fontFamily:C.font,paddingBottom:80,color:C.text}}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes spin{to{transform:rotate(360deg)}}
        .log-row{border-bottom:1px solid ${C.border};padding:6px 12px;display:flex;gap:8px;align-items:flex-start;}
        .log-row:last-child{border-bottom:none;}
        .log-row:hover{background:${C.surfaceAlt};}
        .tab-btn{background:none;border:none;cursor:pointer;padding:4px 8px;border-radius:4px;font-size:10px;font-weight:600;letter-spacing:0.04em;font-family:inherit;}
        .tab-btn.active{background:${C.borderAlt};color:${C.white};}
        .tab-btn:not(.active){color:${C.mutedLight};}
        .ex-row{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid ${C.border};}
        .ex-row:last-child{border-bottom:none;}
        .chip{display:flex;align-items:center;gap:6px;padding:7px 10px;background:${C.surfaceAlt};border:1px solid ${C.border};border-radius:7px;flex-shrink:0;}
      `}</style>

      {/* ── HEADER ── */}
      <header style={{position:'sticky',top:0,zIndex:50,background:C.bg,borderBottom:`1px solid ${C.border}`,padding:'12px 14px',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        <div style={{display:'flex',alignItems:'center',gap:10,flex:1,minWidth:'200px'}}>
          {loading
            ?<div style={{width:10,height:10,borderRadius:'50%',border:`2px solid ${C.yellow}`,borderTopColor:'transparent',animation:'spin .8s linear infinite'}}/>
            :<div style={{width:10,height:10,borderRadius:'50%',background:statusCol,boxShadow:`0 0 8px ${statusCol}`,flexShrink:0}}/>
          }
          <div className="no-overflow">
            <div style={{fontSize:13,fontWeight:700,color:C.white,lineHeight:1}}>TRADE AI — STATUS</div>
            <div style={{fontSize:10,color:C.mutedLight,marginTop:2}} className="no-overflow">
              {overallStatus}{health?.version?` · v${health.version.split(' ')[0]}`:''}{health?.uptimeSecs?` · up ${uptime(health.uptimeSecs)}`:''}
            </div>
          </div>
        </div>
        
        <div style={{display:'flex',alignItems:'center',gap:8,marginLeft:'auto'}}>
          <div style={{display:'flex',alignItems:'center',gap:5,padding:'3px 8px',borderRadius:5,border:`1px solid ${(connColor[connectionStatus]||C.muted)}30`,background:hBg(connectionStatus==='connected'?'OK':connectionStatus==='error'?'ERROR':'WARN')}}>
            <div style={{width:6,height:6,borderRadius:'50%',background:connColor[connectionStatus]||C.mutedLight,animation:connectionStatus==='connected'?'pulse 2s infinite':'none'}}/>
            <span style={{fontSize:9,fontWeight:700,color:connColor[connectionStatus]||C.mutedLight}}>{connLabel[connectionStatus]||connectionStatus.toUpperCase()}</span>
          </div>
          <button style={{padding:'4px 10px',background:'transparent',border:`1px solid ${C.borderAlt}`,color:C.mutedLight,borderRadius:5,fontSize:11,cursor:'pointer',display:'flex',alignItems:'center',gap:4,fontFamily:'inherit'}} onClick={refreshAll}>
            <span style={{animation:loading||diagLoading?'spin .8s linear infinite':'none',display:'inline-block'}}>↺</span>Refresh
          </button>
        </div>
      </header>

      {/* ── CORE SERVICES STRIP ── */}
      <div style={{margin:'12px 12px 0'}} className="scroll-x">
        <div style={{display:'flex',gap:7,paddingBottom:2}}>
        {[
          {label:'STREAM',val:connLabel[connectionStatus]||'—',col:connColor[connectionStatus]||C.mutedLight},
          {label:'HEARTBEAT',val:dash?.heartbeat?.status||health?.coreMonitor?.heartbeat||'—',col:hColor(dash?.heartbeat?.status||health?.coreMonitor?.heartbeat)},
          {label:'WATCHDOG',val:dash?.watchdog?.status||health?.coreMonitor?.watchdog||'—',col:hColor(dash?.watchdog?.status||health?.coreMonitor?.watchdog)},
          {label:'KILL SW',val:dash?.killSwitch?.engaged?'ENGAGED':(health?.coreMonitor?.killSwitch||'—'),col:dash?.killSwitch?.engaged?C.red:C.green},
          {label:'SUPABASE',val:diag?.supabase?.status||'—',col:hColor(diag?.supabase?.status)},
          {label:'MODE',val:health?.systemMode||bot?.stats?.mode||'—',col:health?.systemMode==='AUTO_TRADE'?C.yellow:C.blue},
        ].map(c=>(
          <div key={c.label} className="chip">
            <div style={{width:7,height:7,borderRadius:'50%',background:c.col,animation:c.col===C.green?'pulse 2.5s infinite':'none',flexShrink:0}}/>
            <div>
              <div style={{fontSize:8,fontWeight:700,color:C.mutedLight,letterSpacing:'0.07em'}}>{c.label}</div>
              <div style={{fontSize:10,fontWeight:700,color:c.col,whiteSpace:'nowrap'}}>{c.val}</div>
            </div>
          </div>
        ))}
        </div>
      </div>

      {/* ── KILL SWITCH ALERT ── */}
      {dash?.killSwitch?.engaged&&(
        <div style={{margin:'12px 12px 0',background:C.redBg,border:`1px solid ${C.red}40`,borderRadius:10,padding:'12px 14px'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
            <div style={{width:8,height:8,borderRadius:'50%',background:C.red,animation:'pulse 1s infinite'}}/>
            <span style={{fontSize:12,fontWeight:800,color:C.red,letterSpacing:'0.05em'}}>KILL SWITCH ENGAGED</span>
          </div>
          <div style={{fontSize:11,color:C.text}}>{dash.killSwitch.reason||'Bot halted by emergency stop'}</div>
        </div>
      )}

      {/* ── EXCHANGE CONNECTIVITY ── */}
      <div style={{margin:'12px 12px 0',background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
        <div style={{padding:'8px 12px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:10,fontWeight:700,letterSpacing:'0.08em',color:C.mutedLight,textTransform:'uppercase'}}>Exchange Connectivity</span>
          {exchanges?.activeExchange&&<span style={{fontSize:9,color:C.blue,fontWeight:600}}>ACTIVE: {exchanges.activeExchange.toUpperCase()}</span>}
        </div>
        {health?.api&&[
          {name:'Binance',ok:health.api.binance?.ok,latency:health.api.binance?.latencyMs,mode:health.api.binance?.mode},
          {name:'DexScreener',ok:health.api.dexScreener?.ok,latency:null,mode:null},
          {name:'CoinGecko',ok:health.api.coinGecko?.ok,latency:null,mode:null},
        ].map(r=>(
          <div key={r.name} className="ex-row">
            <div style={{width:26,height:26,borderRadius:6,flexShrink:0,background:C.surfaceAlt,border:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:8,fontWeight:800,color:C.mutedLight}}>{r.name.slice(0,2).toUpperCase()}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:11,fontWeight:600,color:C.text}}>{r.name}</div>
              {r.mode&&<div style={{fontSize:9,color:C.mutedLight}}>{r.mode}</div>}
            </div>
            {r.latency!=null&&r.ok&&<div style={{fontSize:9,color:C.mutedLight,marginRight:6}}>{r.latency}ms</div>}
            <div style={{fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:4,color:r.ok?C.green:C.red,background:r.ok?C.greenBg:C.redBg,border:`1px solid ${r.ok?C.green:C.red}30`}}>{r.ok?'● LIVE':'○ DOWN'}</div>
          </div>
        ))}
        {exchanges?.exchanges.filter(e=>e.name!=='binance').map(ex=>(
          <div key={ex.name} className="ex-row">
            <div style={{width:26,height:26,borderRadius:6,flexShrink:0,background:C.surfaceAlt,border:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:8,fontWeight:800,color:C.mutedLight}}>{ex.name.slice(0,2).toUpperCase()}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:11,fontWeight:600,color:ex.enabled?C.text:C.mutedLight}}>{ex.name.toUpperCase()}</div>
              <div style={{fontSize:9,color:C.mutedLight}}>{ex.enabled?ex.mode:'NOT CONFIGURED'}</div>
            </div>
            {diag?.mexc?.latencyMs!=null&&ex.name==='mexc'&&ex.connected&&<div style={{fontSize:9,color:C.mutedLight,marginRight:6}}>{diag.mexc.latencyMs}ms</div>}
            <div style={{fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:4,color:ex.connected?C.green:ex.enabled?C.red:C.muted,background:ex.connected?C.greenBg:ex.enabled?C.redBg:'transparent',border:`1px solid ${ex.connected?C.green:ex.enabled?C.red:C.muted}30`}}>{ex.connected?'● LIVE':ex.enabled?'○ DOWN':'— OFF'}</div>
          </div>
        ))}
      </div>

      {/* ── AI PROVIDERS + DB ── */}
      <div style={{margin:'12px 12px 0',background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
        <div style={{padding:'8px 12px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:10,fontWeight:700,letterSpacing:'0.08em',color:C.mutedLight,textTransform:'uppercase'}}>AI Providers & Database</span>
          {diagLoading&&<span style={{fontSize:9,color:C.yellow}}>◌ checking…</span>}
          {lastDiag&&!diagLoading&&<span style={{fontSize:9,color:C.mutedLight}}>checked {ft(lastDiag.toISOString())}</span>}
        </div>
        <div className="grid-2" style={{background:C.border, gap:'1px'}}>
          <div style={{background:C.surface,padding:'10px 12px'}}>
            <div style={{fontSize:9,fontWeight:700,letterSpacing:'0.08em',color:C.mutedLight,textTransform:'uppercase',marginBottom:4}}>OpenAI GPT</div>
            <div style={{fontSize:15,fontWeight:700,color:hColor(credits?.openai.status)}}>{credits?credits.openai.status:'—'}</div>
            <div style={{fontSize:9,color:C.mutedLight,marginTop:2}}>GPT-4 / Analysis</div>
          </div>
          <div style={{background:C.surface,padding:'10px 12px',gridColumn:'span 1',minWidth:'200px'}}>
            <DeepSeekStatus />
          </div>
          <div style={{background:C.surface,padding:'10px 12px'}}>
            <div style={{fontSize:9,fontWeight:700,letterSpacing:'0.08em',color:C.mutedLight,textTransform:'uppercase',marginBottom:4}}>Supabase DB</div>
            <div style={{fontSize:15,fontWeight:700,color:hColor(diag?.supabase?.status)}}>{diag?.supabase?.status||'—'}</div>
            {diag?.supabase&&<div style={{fontSize:9,color:C.mutedLight,marginTop:2}}>RT: {diag.supabase.roundtripMs}ms · <span style={{color:gColor(diag.supabase.healthGrade)}}>Grade {diag.supabase.healthGrade}</span></div>}
          </div>
          <div style={{background:C.surface,padding:'10px 12px'}}>
            <div style={{fontSize:9,fontWeight:700,letterSpacing:'0.08em',color:C.mutedLight,textTransform:'uppercase',marginBottom:4}}>DB Latency</div>
            {diag?.supabase?(
              <div style={{display:'flex',gap:10,marginTop:2}}>
                <div><div style={{fontSize:8,color:C.mutedLight}}>WRITE</div><div style={{fontSize:13,fontWeight:700,color:diag.supabase.writeLatencyMs<200?C.green:C.yellow}}>{diag.supabase.writeLatencyMs}ms</div></div>
                <div><div style={{fontSize:8,color:C.mutedLight}}>READ</div><div style={{fontSize:13,fontWeight:700,color:diag.supabase.readLatencyMs<150?C.green:C.yellow}}>{diag.supabase.readLatencyMs}ms</div></div>
              </div>
            ):<div style={{fontSize:14,fontWeight:700,color:C.mutedLight}}>—</div>}
          </div>
        </div>
      </div>

      {/* ── TRADING OPERATIONS ── */}
      <div style={{margin:'12px 12px 0',background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
        <div style={{padding:'8px 12px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:10,fontWeight:700,letterSpacing:'0.08em',color:C.mutedLight,textTransform:'uppercase'}}>Trading Operations</span>
          <span style={{fontSize:9,color:health?.systemMode==='AUTO_TRADE'?C.yellow:C.blue,fontWeight:700}}>{health?.systemMode||bot?.stats?.mode||'PAPER'}</span>
        </div>
        <div className="grid-4" style={{background:C.border, gap:'1px'}}>
          {card('Decisions Today',(health?.trading?.decisionsToday??dash?.trading?.totalSignals??'—').toString(),C.blue)}
          {card('Open Positions',(diag?.positions?.open??dash?.trading?.openPositions??'—').toString(),C.white)}
          {card('Win Rate',bot?.stats?.overallWinRate!=null?`${bot.stats.overallWinRate.toFixed(1)}%`:'—',bot?.stats?.overallWinRate!=null&&bot.stats.overallWinRate>=55?C.green:bot?.stats?.overallWinRate!=null&&bot.stats.overallWinRate>=45?C.yellow:C.red)}
          {card('Total Trades',(diag?.equity?.totalTrades??bot?.stats?.totalDecisions??'—').toString(),C.text)}
        </div>
        {diag?.equity&&(
          <div style={{padding:'9px 12px',display:'flex',gap:16,borderTop:`1px solid ${C.border}`,flexWrap:'wrap'}}>
            {[
              {l:'W',v:(diag.equity.wins??0).toString(),c:C.green},
              {l:'L',v:(diag.equity.losses??0).toString(),c:C.red},
              {l:'WR',v:`${(diag.equity.winRatePercent??0).toFixed(1)}%`,c:(diag.equity.winRatePercent??0)>=55?C.green:C.yellow},
              {l:'Equity',v:`$${(diag.equity.currentBalance??0).toFixed(0)}`,c:C.white},
              {l:'Peak',v:`$${(diag.equity.peakBalance??0).toFixed(0)}`,c:C.blue},
              {l:'MaxDD',v:`${(diag.equity.maxDrawdownPercent??0).toFixed(1)}%`,c:(diag.equity.maxDrawdownPercent??0)>15?C.red:C.yellow},
            ].map(x=>(
              <div key={x.l} style={{fontSize:9,color:C.mutedLight}}>{x.l}&nbsp;<span style={{color:x.c,fontWeight:700}}>{x.v}</span></div>
            ))}
            {bot?.stats?.streakType&&bot.stats.streakType!=='NONE'&&(
              <div style={{fontSize:9,color:C.mutedLight}}>Streak&nbsp;<span style={{color:bot.stats.streakType==='WIN'?C.green:C.red,fontWeight:700}}>{bot.stats.streakType==='WIN'?'▲':'▼'} {Math.abs(bot.stats.currentStreak)}</span></div>
            )}
          </div>
        )}
      </div>

      {/* ── TOP GLADIATOR ── */}
      {omega&&(
        <div style={{margin:'12px 12px 0',background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
          <div style={{padding:'8px 12px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <span style={{fontSize:10,fontWeight:700,letterSpacing:'0.08em',color:C.mutedLight,textTransform:'uppercase'}}>Top Gladiator</span>
            <span style={{fontSize:9,color:omega.isOmega?C.yellow:C.mutedLight,fontWeight:700}}>{omega.isOmega?'⚡ OMEGA':'ACTIVE'}</span>
          </div>
          <div style={{padding:'10px 12px'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:C.white}}>{omega.id}</div>
                <div style={{fontSize:9,color:C.mutedLight,marginTop:1}}>{omega.arena||'MAIN ARENA'}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:16,fontWeight:700,color:(omega.winRate??0)>=55?C.green:(omega.winRate??0)>=45?C.yellow:C.red}}>{(omega.winRate??0).toFixed(1)}%</div>
                <div style={{fontSize:9,color:C.mutedLight}}>Win Rate</div>
              </div>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
              <span style={{fontSize:9,color:C.mutedLight}}>Training Progress</span>
              <span style={{fontSize:9,fontWeight:700,color:C.blue}}>{Math.round(omega.trainingProgress*100)}%</span>
            </div>
            <div style={{height:4,borderRadius:2,background:C.border,overflow:'hidden'}}>
              <div style={{height:'100%',borderRadius:2,background:omega.isOmega?C.yellow:C.green,width:`${Math.round(omega.trainingProgress*100)}%`}}/>
            </div>
            <div style={{marginTop:7,display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
              <span style={{fontSize:9,fontWeight:700,padding:'2px 6px',borderRadius:3,color:hColor(omega.status),background:hBg(omega.status),border:`1px solid ${hColor(omega.status)}30`}}>{omega.status}</span>
              {gladiators.length>1&&<span style={{fontSize:9,color:C.mutedLight}}>{gladiators.length} gladiators active</span>}
              {(health?.trading?.forgeProgress??0)>0&&<span style={{fontSize:9,color:C.purple}}>Forge: {Math.round((health?.trading?.forgeProgress??0)*100)}%</span>}
            </div>
          </div>
        </div>
      )}

      {/* ── SYSTEM RESOURCES ── */}
      <div style={{margin:'12px 12px 0',background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
        <div style={{padding:'8px 12px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:10,fontWeight:700,letterSpacing:'0.08em',color:C.mutedLight,textTransform:'uppercase'}}>System Resources</span>
          {diag?.system&&<span style={{fontSize:9,color:C.mutedLight}}>diag in {diag.system.diagnosticDurationMs}ms</span>}
        </div>
        <div className="grid-3" style={{background:C.border, gap:'1px'}}>
          {card('RSS Memory',diag?.system?`${diag.system.memoryUsageMB.rss} MB`:(dash?.system?.memoryUsageRssMB?`${dash.system.memoryUsageRssMB} MB`:'—'),diag?.system&&diag.system.memoryUsageMB.rss>400?C.yellow:C.text)}
          {card('Heap',diag?.system?`${diag.system.memoryUsageMB.heapUsed}/${diag.system.memoryUsageMB.heapTotal} MB`:'—',C.text)}
          {card('Uptime',diag?.system?uptime(diag.system.uptimeSeconds):(dash?.system?.uptime?uptime(dash.system.uptime):'—'),C.green)}
          {card('Node',diag?.system?.nodeVersion||'—',C.mutedLight)}
          {card('Sync Queue',dash?.system?.syncQueue?`${dash.system.syncQueue.pending} pending`:'—',dash?.system?.syncQueue?.pending?C.yellow:C.mutedLight)}
          {card('Updates',updateCount.toString(),C.blue)}
        </div>
        {dash?.system?.syncQueue?.lastSyncComplete&&(
          <div style={{padding:'6px 12px',borderTop:`1px solid ${C.border}`,fontSize:9,color:C.mutedLight}}>
            Last sync: {ft(dash.system.syncQueue.lastSyncComplete)} · Completed: {dash.system.syncQueue.totalCompleted}
          </div>
        )}
      </div>

      {/* ── LIVE CONSOLE ── */}
      <div style={{margin:'12px 12px 0',background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
        <div style={{padding:'8px 12px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:10,fontWeight:700,letterSpacing:'0.08em',color:C.mutedLight,textTransform:'uppercase'}}>Live Console</span>
          <div style={{display:'flex',gap:4,alignItems:'center'}}>
            {errorCount>0&&<span style={{fontSize:9,fontWeight:700,color:C.red,marginRight:4}}>{errorCount} ERR</span>}
            {warnCount>0&&<span style={{fontSize:9,fontWeight:700,color:C.yellow,marginRight:4}}>{warnCount} WARN</span>}
            {(['all','error','warn'] as const).map(t=>(
              <button key={t} className={`tab-btn${activeLog===t?' active':''}`} onClick={()=>setActiveLog(t)}>{t.toUpperCase()}</button>
            ))}
          </div>
        </div>
        <div style={{maxHeight:240,overflowY:'auto'}}>
          {filteredLogs.length===0
            ?<div style={{padding:'20px 12px',textAlign:'center',color:C.mutedLight,fontSize:12}}>No log entries</div>
            :filteredLogs.slice(0,40).map((log,i)=>(
              <div key={i} className="log-row">
                <div style={{fontSize:8,fontWeight:800,color:lColor(log.level),minWidth:30,paddingTop:1,letterSpacing:'0.04em'}}>{log.level?.toUpperCase().slice(0,4)}</div>
                <div style={{fontSize:9,color:C.mutedLight,whiteSpace:'nowrap',paddingTop:1}}>{ft(log.ts)}</div>
                <div style={{fontSize:10,color:C.textDim,flex:1,wordBreak:'break-word',lineHeight:1.4}}>{log.msg}</div>
              </div>
            ))
          }
        </div>
        {logs.length>0&&(
          <div style={{padding:'5px 12px',borderTop:`1px solid ${C.border}`,fontSize:9,color:C.mutedLight,display:'flex',gap:10}}>
            <span>{logs.length} entries</span>
            {dash?.logs?.errorCount1h!=null&&<span style={{color:dash.logs.errorCount1h>0?C.red:C.mutedLight}}>{dash.logs.errorCount1h} errors/1h</span>}
            {lastUpdate&&<span>Updated {ft(lastUpdate.toISOString())}</span>}
          </div>
        )}
      </div>

      {/* ── HEARTBEAT PROVIDERS ── */}
      {dash?.heartbeat?.providers&&Object.keys(dash.heartbeat.providers).length>0&&(
        <div style={{margin:'12px 12px 0',background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
          <div style={{padding:'8px 12px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <span style={{fontSize:10,fontWeight:700,letterSpacing:'0.08em',color:C.mutedLight,textTransform:'uppercase'}}>Data Providers</span>
            <span style={{fontSize:9,color:hColor(dash.heartbeat.status)}}>{dash.heartbeat.status}</span>
          </div>
          <div style={{padding:'8px 12px',display:'flex',flexWrap:'wrap',gap:8}}>
            {Object.entries(dash.heartbeat.providers).map(([name,prov])=>(
              <div key={name} style={{display:'flex',alignItems:'center',gap:5,padding:'5px 9px',borderRadius:6,background:C.surfaceAlt,border:`1px solid ${C.border}`}}>
                <div style={{width:6,height:6,borderRadius:'50%',background:prov.ok?C.green:C.red}}/>
                <span style={{fontSize:10,color:prov.ok?C.text:C.mutedLight,fontWeight:600}}>{name}</span>
                {prov.lastLatencyMs!=null&&<span style={{fontSize:9,color:C.mutedLight}}>{prov.lastLatencyMs}ms</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── LAST SYNDICATE DECISION ── */}
      {bot?.syndicateAudits&&bot.syndicateAudits.length>0&&(()=>{
        const last=bot.syndicateAudits[0];
        return(
          <div style={{margin:'12px 12px 0',background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
            <div style={{padding:'8px 12px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span style={{fontSize:10,fontWeight:700,letterSpacing:'0.08em',color:C.mutedLight,textTransform:'uppercase'}}>Last Syndicate Decision</span>
              <span style={{fontSize:9,color:C.mutedLight}}>{ft(last.timestamp)}</span>
            </div>
            <div style={{padding:'10px 12px'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                <div style={{fontSize:13,fontWeight:700,color:C.white}}>{last.symbol}</div>
                <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:4,color:last.decision==='BUY'?C.green:last.decision==='SELL'?C.red:C.yellow,background:last.decision==='BUY'?C.greenBg:last.decision==='SELL'?C.redBg:C.yellowBg}}>{last.decision}</span>
                <span style={{fontSize:9,color:C.blue,marginLeft:'auto',fontWeight:700}}>{Math.round(last.confidence*100)}% conf</span>
              </div>
              <div className="grid-2" style={{gap:8}}>
                {[{name:'ARCHITECT',data:last.architect},{name:'ORACLE',data:last.oracle}].map(a=>(
                  <div key={a.name} style={{background:C.surfaceAlt,borderRadius:6,padding:'7px 9px',border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:8,fontWeight:700,color:C.mutedLight,marginBottom:3}}>{a.name}</div>
                    <div style={{fontSize:10,fontWeight:700,color:a.data.direction==='BUY'?C.green:a.data.direction==='SELL'?C.red:C.yellow}}>{a.data.direction} · {Math.round(a.data.confidence*100)}%</div>
                    <div style={{fontSize:9,color:C.textDim,marginTop:3,lineHeight:1.4,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{a.data.reasoning}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      <BottomNav/>
    </div>
  );
}
