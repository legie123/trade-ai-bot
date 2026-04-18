'use client';
/**
 * STATUS — CONTROL ROOM
 * Full operational dashboard: observability, control, debug,
 * agent orchestration, API monitoring, manual commands, charts.
 * 100% responsive (desktop + phone).
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRealtimeData } from '@/hooks/useRealtimeData';
import BottomNav from '@/components/BottomNav';
import DeepSeekStatus from '@/app/components/DeepSeekStatus';
import IntelligencePanel from '@/components/IntelligencePanel';
import FreshnessBadge from '@/components/FreshnessBadge';
import PaperBacktestPanel from '@/components/PaperBacktestPanel';
import BacktestTrendPanel from '@/components/BacktestTrendPanel';
import DivisionTunerPanel from '@/components/DivisionTunerPanel';
import SentinelCouplingPanel from '@/components/SentinelCouplingPanel';
import DivisionSparklineGrid from '@/components/DivisionSparklineGrid';
import GladiatorAttributionPanel from '@/components/GladiatorAttributionPanel';
import HelpTooltip from '@/components/HelpTooltip';
import { useToast, ToastContainer } from '@/components/Toast';

/* ═══ DASHBOARD HELP ═══ */
const DASHBOARD_HELP = {
  terminal: {
    title: 'Live Terminal',
    description: 'Real-time log stream from the trading engine via SSE (Server-Sent Events). Shows commands, results, errors, and system events as they happen.',
    details: [
      'Filter by type: ALL / CMD (commands) / ERROR / LOG',
      'CMD entries (yellow $) are manual commands you triggered',
      'ERROR lines turn red — investigate these first',
      'CLR button clears the view but does not delete server logs',
    ],
    tip: 'If the terminal shows no activity for 30+ seconds, the SSE connection may have dropped — press Refresh.',
  },
  commands: {
    title: 'Command Center',
    description: 'Direct control panel for the trading engine. Execute kill switch toggles, agent orchestration, data collection, and system maintenance commands.',
    details: [
      'Kill Switch ENGAGE halts all new trades immediately — use in emergency',
      'Disengage resumes trading after manual review',
      'Agents:orchestrate sends a specific symbol to the full AI pipeline',
      'Reset Daily Triggers clears rate-limit counters for a fresh start',
    ],
    tip: 'Always check system status before disengaging the kill switch — make sure the underlying issue is resolved.',
  },
  strategy: {
    title: 'Strategy Performance',
    description: 'Win rate and PnL breakdown per signal type and source. Shows which strategies are profitable and which need tuning.',
    details: [
      'Win Rate bar: green ≥60%, yellow ≥45%, red <45%',
      'Avg PnL shows average profit/loss per trade for that signal type',
      'Best/Worst track the extremes for risk sizing reference',
      'Source column shows which data provider generated the signal',
    ],
    tip: 'Focus on strategies with both high win rate AND positive avg PnL — high WR with negative PnL means the losses are too big.',
  },
  trading: {
    title: 'Trading Operations',
    description: 'Live snapshot of the trading engine state — open positions, win rate, equity, and drawdown. All numbers update in real time.',
    details: [
      'Mode shows PAPER (simulation) or AUTO_TRADE (live)',
      'MaxDD is maximum drawdown from peak — above 15% triggers risk controls',
      'Streak indicator shows consecutive wins (▲) or losses (▼)',
      'Decisions Today counts signal evaluations, not just executed trades',
    ],
    tip: 'Monitor MaxDD closely. A spike above 15% usually means a strategy is misbehaving and needs the kill switch.',
  },
  apiHealth: {
    title: 'API & Source Health',
    description: 'Live connectivity status for every external data source: exchanges, databases, AI providers, and market data feeds.',
    details: [
      'Green pulse = OK, static red = DOWN, grey = OFF/disabled',
      'Latency shown in ms — MEXC >500ms means API issues',
      'Grade (A/B/C/F) is a composite health score per source',
      'DOWN sources may silently degrade signal quality — check immediately',
    ],
    tip: 'If Supabase or MEXC shows DOWN, stop trading manually until resolved — both are critical path dependencies.',
  },
} as const;

/* ═══ COLOR SYSTEM — unified from lib/theme.ts ═══ */
import { C } from '@/lib/theme';

/* ═══ INTERFACES ═══ */
interface HealthData {
  status:string; version:string; systemMode:string; uptimeSecs:number;
  coreMonitor:{heartbeat:string;watchdog:string;killSwitch:string};
  trading:{autoSelectEnabled:boolean;totalGladiators:number;decisionsToday:number;forgeProgress:number};
  api:{binance:{ok:boolean;mode:string;latencyMs:number};dexScreener?:{ok:boolean}|undefined;coinGecko?:{ok:boolean}|undefined};
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
  openai:{status:string;balance:string;is_available?:boolean};
  deepseek:{status:string;balance:string;is_available?:boolean};
}
interface ExchangeRow { name:string;enabled:boolean;mode:string;connected:boolean;error?:string; }
interface ExchangeData { activeExchange:string; exchanges:ExchangeRow[]; }
interface CmdResult { ok:boolean; command:string; message:string; data?:unknown; durationMs:number; }
interface TerminalLine { ts:string; type:'cmd'|'result'|'error'|'log'; text:string; }

/* ═══ HELPERS ═══ */
function hColor(s:string|boolean|undefined):string{
  if(s===undefined||s===null)return C.mutedLight;
  const v=String(s).toUpperCase();
  if(s===true||['OK','HEALTHY','GREEN','ACTIVE','SAFE','CONNECTED','LIVE','ONLINE'].includes(v))return C.green;
  if(s===false||['ERROR','DEGRADED','CRITICAL','RED','INVALID_KEY','MISSING_KEY','NETWORK_ERROR','DOWN','OFFLINE'].includes(v))return C.red;
  if(['WARNING','YELLOW','INACTIVE','QUOTA_EXCEEDED','OBSERVATION'].includes(v))return C.yellow;
  return C.mutedLight;
}
function hBg(s:string|boolean|undefined):string{
  const c=hColor(s);return c===C.green?C.greenBg:c===C.red?C.redBg:c===C.yellow?C.yellowBg:'transparent';
}
function uptime(s:number):string{
  if(!s||s<=0)return'—';
  const d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60);
  return d>0?`${d}d ${h}h`:`${h}h ${m}m`;
}
function ft(ts:string|undefined):string{
  if(!ts)return'—';
  try{return new Date(ts).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});}catch{return'—';}
}
function fdt(ts:string|undefined):string{
  if(!ts)return'—';
  try{return new Date(ts).toLocaleString('en-GB',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});}catch{return'—';}
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
function pct(v:number|undefined,d=1):string{return v!=null?`${v.toFixed(d)}%`:'—';}
function usd(v:number|undefined):string{return v!=null?`$${v.toFixed(2)}`:'—';}

/* ═══ MINI CHART (SVG sparkline) ═══ */
function Sparkline({data,color,width=120,height=32}:{data:number[];color:string;width?:number;height?:number}){
  if(!data||data.length<2)return <div style={{width,height,background:C.surfaceAlt,borderRadius:4}}/>;
  const min=Math.min(...data),max=Math.max(...data);
  const range=max-min||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*width},${height-((v-min)/range)*height}`).join(' ');
  return(
    <svg width={width} height={height} style={{display:'block'}}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/* ═══ MINI BAR CHART ═══ */
function BarChart({data,labels,colors,height=60}:{data:number[];labels:string[];colors:string[];height?:number}){
  const max=Math.max(...data,1);
  return(
    <div style={{display:'flex',alignItems:'flex-end',gap:3,height}}>
      {data.map((v,i)=>(
        <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
          <div style={{fontSize:10,color:C.white,fontWeight:700}}>{v}</div>
          <div style={{width:'100%',height:`${(v/max)*100}%`,minHeight:2,background:colors[i%colors.length],borderRadius:2}}/>
          <div style={{fontSize:10,color:C.mutedLight,whiteSpace:'nowrap'}}>{labels[i]}</div>
        </div>
      ))}
    </div>
  );
}

/* ═══ SECTION COMPONENT ═══ */
function Section({title,badge,right,children,defaultOpen=true}:{title:string;badge?:string;right?:React.ReactNode;children:React.ReactNode;defaultOpen?:boolean}){
  const[open,setOpen]=useState(defaultOpen);
  return(
    <div style={{margin:'10px 12px 0',background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,overflow:'hidden'}}>
      <div onClick={()=>setOpen(!open)} style={{padding:'8px 12px',borderBottom:open?`1px solid ${C.border}`:'none',display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',userSelect:'none'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:10,fontWeight:700,letterSpacing:'0.08em',color:C.mutedLight,textTransform:'uppercase'}}>{title}</span>
          {badge&&<span style={{fontSize:10,fontWeight:700,padding:'1px 5px',borderRadius:3,color:hColor(badge),background:hBg(badge)}}>{badge}</span>}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {right}
          <span style={{fontSize:10,color:C.mutedLight,transform:open?'rotate(90deg)':'none',transition:'transform 0.2s'}}>›</span>
        </div>
      </div>
      {open&&children}
    </div>
  );
}

/* ═══ COMMAND BUTTON ═══ */
function CmdBtn({label,cmd,params,onRun,running,variant='default'}:{label:string;cmd:string;params?:Record<string,unknown>;onRun:(cmd:string,params?:Record<string,unknown>)=>void;running:string|null;variant?:'default'|'danger'|'success'}){
  const isRunning=running===cmd;
  const colors={default:{bg:C.surfaceAlt,border:C.borderAlt,text:C.text},danger:{bg:C.redBg,border:`${C.red}40`,text:C.red},success:{bg:C.greenBg,border:`${C.green}40`,text:C.green}};
  const s=colors[variant];
  return(
    <button onClick={()=>!isRunning&&onRun(cmd,params)} disabled={isRunning} style={{padding:'8px 12px',minHeight:44,background:s.bg,border:`1px solid ${s.border}`,color:s.text,borderRadius:6,fontSize:11,fontWeight:600,cursor:isRunning?'wait':'pointer',opacity:isRunning?0.6:1,fontFamily:'inherit',whiteSpace:'nowrap',transition:'all 0.15s',touchAction:'manipulation'}}>
      {isRunning?'◌ ...':label}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════ */
export default function StatusPage(){
  const {dashboard:dash,bot,connectionStatus,lastUpdate,updateCount,forceRefresh}=useRealtimeData();
  const {toasts,toast,dismiss}=useToast();
  const [health,setHealth]=useState<HealthData|null>(null);
  const [diag,setDiag]=useState<DiagData|null>(null);
  const [credits,setCredits]=useState<CreditsData|null>(null);
  const [exchanges,setExchanges]=useState<ExchangeData|null>(null);
  const [loading,setLoading]=useState(true);
  const [selectedDivision,setSelectedDivision]=useState<string|null>(null);
  type DashTab = 'terminal' | 'commands' | 'strategy' | 'system';
  const [dashTab,setDashTab]=useState<DashTab>('terminal');
  const [diagLoading,setDiagLoading]=useState(false);
  const [lastDiag,setLastDiag]=useState<Date|null>(null);
  const [lastLight,setLastLight]=useState<Date|null>(null);
  const [activeLog,setActiveLog]=useState<'all'|'error'|'warn'>('all');
  const [expandedGlad,setExpandedGlad]=useState<Set<string>>(new Set());
  const [expandedAudits,setExpandedAudits]=useState<Set<number>>(new Set());
  /* ═══ KILL SWITCH ARM/CONFIRM PATTERN ═══ */
  const [killArmed,setKillArmed]=useState(false);
  const killTimerRef=useRef<NodeJS.Timeout|null>(null);
  const armKillSwitch=useCallback(()=>{
    setKillArmed(true);
    if(killTimerRef.current)clearTimeout(killTimerRef.current);
    killTimerRef.current=setTimeout(()=>setKillArmed(false),4000); // 4s window to confirm
  },[]);
  // confirmKillSwitch defined after runCommand below
  useEffect(()=>()=>{if(killTimerRef.current)clearTimeout(killTimerRef.current);},[]);
  const toggleGlad=(id:string)=>{setExpandedGlad(s=>{const n=new Set(s);if(n.has(id)){n.delete(id);}else{n.add(id);}return n;});};
  const toggleAudit=(i:number)=>{setExpandedAudits(s=>{const n=new Set(s);if(n.has(i)){n.delete(i);}else{n.add(i);}return n;});};
  const diagRef=useRef<NodeJS.Timeout|null>(null);

  // Terminal state
  const [terminalLines,setTerminalLines]=useState<TerminalLine[]>([]);
  const [runningCmd,setRunningCmd]=useState<string|null>(null);
  const termRef=useRef<HTMLDivElement>(null);
  const [termFilter,setTermFilter]=useState<'all'|'cmd'|'error'|'log'>('all');

  // History timeframe
  const [historyHours,setHistoryHours]=useState(12);

  // Append to terminal
  const termLog=useCallback((type:TerminalLine['type'],text:string)=>{
    setTerminalLines(prev=>[{ts:new Date().toISOString(),type,text},...prev].slice(0,500));
  },[]);

  // Execute command
  const runCommand=useCallback(async(cmd:string,params?:Record<string,unknown>)=>{
    setRunningCmd(cmd);
    termLog('cmd',`> ${cmd}${params?' '+JSON.stringify(params):''}`);
    try{
      const res=await fetch('/api/v2/command',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        credentials:'include',
        body:JSON.stringify({command:cmd,params}),
      });
      const data:CmdResult=await res.json();
      if(data.ok){
        termLog('result',`[${data.durationMs}ms] ${data.message}`);
        toast('success',data.message,`${cmd} · ${data.durationMs}ms`);
        if(data.data&&typeof data.data==='object'){
          termLog('log',JSON.stringify(data.data,null,2).slice(0,1000));
        }
      }else{
        termLog('error',`FAIL: ${data.message}`);
        toast('error',`FAIL: ${data.message}`,cmd);
      }
    }catch(err){
      termLog('error',`ERROR: ${(err as Error).message}`);
      toast('error',(err as Error).message,cmd);
    }finally{
      setRunningCmd(null);
    }
  },[termLog,toast]);

  const confirmKillSwitch=useCallback((cmd:string)=>{
    setKillArmed(false);
    if(killTimerRef.current){clearTimeout(killTimerRef.current);killTimerRef.current=null;}
    runCommand(cmd);
  },[runCommand]);

  // Auto-scroll terminal
  useEffect(()=>{
    if(termRef.current)termRef.current.scrollTop=0;
  },[terminalLines]);

  // Pipe live logs into terminal
  useEffect(()=>{
    const logs=dash?.logs?.recent||[];
    if(logs.length>0){
      const latest=logs[0];
      if(latest){
        termLog('log',`[${latest.level?.toUpperCase()}] ${latest.msg}`);
      }
    }
  // Only fire when logs actually change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[dash?.logs?.recent?.length]);

  /* ─── DATA FETCHERS ─── */
  const fetchLight=useCallback(async()=>{
    try{
      const[hR,eR]=await Promise.allSettled([
        fetch('/api/v2/health').then(r=>r.ok?r.json():null),
        fetch('/api/exchanges').then(r=>r.ok?r.json():null),
      ]);
      if(hR.status==='fulfilled'&&hR.value){
        const raw=hR.value.data||hR.value;
        const sys=raw.systems||{};
        const tm=raw.trading_mode||{};
        // C17 fix (2026-04-19): /api/v2/health expune coreMonitor la top-level
        // (raw.coreMonitor.heartbeat = string "GREEN"/"YELLOW"/"RED").
        // Frontul citea sys.heartbeat.status (object inexistent) → UNKNOWN permanent.
        // Prefer raw.coreMonitor, cu fallback pe sys.* pentru rev-uri mai vechi.
        const cm=raw.coreMonitor||{};
        setHealth({
          status:raw.overall_status||'UNKNOWN',
          version:tm.version||'—',
          systemMode:tm.mode||'PAPER',
          uptimeSecs:raw.summary?.uptime||0,
          coreMonitor:{
            heartbeat:cm.heartbeat||sys.heartbeat?.status||'UNKNOWN',
            watchdog:cm.watchdog||sys.watchdog?.status||'UNKNOWN',
            killSwitch:(cm.killSwitch==='ENGAGED'||tm.killSwitchEngaged)?'ENGAGED':'SAFE',
          },
          trading:{
            autoSelectEnabled:!!tm.autoSelectEnabled,
            totalGladiators:tm.totalGladiators||0,
            decisionsToday:tm.decisionsToday||0,
            forgeProgress:tm.forgeProgress||0,
          },
          // FIX 2026-04-18: /api/v2/health returnează doar: polymarket/supabase/binance/deepseek/telegram.
          // DexScreener și CoinGecko NU există ca health-check endpoint → marcate undefined (nu false).
          // UI va sări peste sursele undefined în loc să afișeze DOWN artificial.
          api:{
            binance:{ok:sys.mexc?.status==='OK'||sys.binance?.status==='OK',mode:tm.mode||'PAPER',latencyMs:sys.mexc?.latency_ms||sys.binance?.latency_ms||0},
            dexScreener: sys.dexscreener ? {ok:sys.dexscreener.status==='OK'} : undefined,
            coinGecko: sys.coingecko ? {ok:sys.coingecko.status==='OK'} : undefined,
          },
          timestamp:raw.timestamp||new Date().toISOString(),
        });
      }
      if(eR.status==='fulfilled'&&eR.value)setExchanges(eR.value.data||eR.value);
      setLastLight(new Date());
    }catch{}
  },[]);

  const fetchDiag=useCallback(async()=>{
    setDiagLoading(true);
    try{
      const[dR,cR]=await Promise.allSettled([
        fetch('/api/diagnostics/master').then(r=>r.ok?r.json():null),
        fetch('/api/diagnostics/credits').then(r=>r.ok?r.json():null),
      ]);
      if(dR.status==='fulfilled'&&dR.value)setDiag(dR.value.data||dR.value);
      if(cR.status==='fulfilled'&&cR.value)setCredits(cR.value);
      setLastDiag(new Date());
    }catch{}finally{setDiagLoading(false);setLoading(false);}
  },[]);

  const refreshAll=useCallback(async()=>{
    termLog('cmd','> refresh:all');
    await Promise.all([fetchLight(),fetchDiag(),forceRefresh()]);
    termLog('result','All data refreshed');
  },[fetchLight,fetchDiag,forceRefresh,termLog]);

  useEffect(()=>{
    fetchLight(); fetchDiag();
    const lt=setInterval(fetchLight,20000);
    diagRef.current=setInterval(fetchDiag,90000);
    return()=>{clearInterval(lt);if(diagRef.current)clearInterval(diagRef.current);};
  },[fetchLight,fetchDiag]);

  /* ─── DERIVED STATE ─── */
  const overallStatus=health?.status||diag?.overallHealth||(loading?'LOADING':'UNKNOWN');
  const statusCol=hColor(overallStatus);
  const gladiators=bot?.gladiators||[];
  const omega=gladiators.find((g:Record<string,unknown>)=>g.isOmega)||gladiators[0]||null;
  const logs=dash?.logs?.recent||[];
  const filteredLogs=logs.filter((l:{level:string})=>
    activeLog==='all'?true:
    activeLog==='error'?['error','fatal'].includes(l.level?.toLowerCase()):
    ['warn','warning'].includes(l.level?.toLowerCase())
  );
  const errorCount=logs.filter((l:{level:string})=>['error','fatal'].includes(l.level?.toLowerCase())).length;
  const warnCount=logs.filter((l:{level:string})=>['warn','warning'].includes(l.level?.toLowerCase())).length;
  const connLabel:Record<string,string>={connected:'SSE LIVE',connecting:'CONNECTING',reconnecting:'RECONNECTING',polling:'POLLING',error:'ERROR'};
  const connColor:Record<string,string>={connected:C.green,connecting:C.yellow,reconnecting:C.yellow,polling:C.blue,error:C.red};

  // Strategy performance from bot.performance
  const strategies=bot?.performance||[];

  // Equity curve data for sparkline
  const equityData=useMemo(()=>{
    const curve=bot?.equityCurve||[];
    const now=Date.now();
    const cutoff=now-historyHours*3600000;
    return curve.filter((p:{timestamp:string})=>new Date(p.timestamp).getTime()>=cutoff).map((p:{balance:number})=>p.balance);
  },[bot?.equityCurve,historyHours]);

  // PnL data for sparkline
  const pnlData=useMemo(()=>{
    const curve=bot?.equityCurve||[];
    const now=Date.now();
    const cutoff=now-historyHours*3600000;
    return curve.filter((p:{timestamp:string})=>new Date(p.timestamp).getTime()>=cutoff).map((p:{pnl:number})=>p.pnl);
  },[bot?.equityCurve,historyHours]);

  // History data for memory chart
  const historyMem=useMemo(()=>{
    return (dash?.history||[]).map((h:{mem:number})=>h.mem);
  },[dash?.history]);

  const historyErrors=useMemo(()=>{
    return (dash?.history||[]).map((h:{errors:number})=>h.errors);
  },[dash?.history]);

  // Terminal filtered
  const filteredTerminal=terminalLines.filter(l=>termFilter==='all'||l.type===termFilter);

  // Card helper
  const card=(label:string,val:string,col?:string)=>(
    <div style={{background:C.surface,padding:'10px 12px'}}>
      <div style={{fontSize:10,fontWeight:700,color:C.mutedLight,letterSpacing:'0.06em',textTransform:'uppercase'}}>{label}</div>
      <div style={{color:col||C.white,fontSize:'1.15rem',fontWeight:700,marginTop:2}}>{val}</div>
    </div>
  );

  /* ═══ API HEALTH GRID — all sources ═══ */
  // Critical path APIs — if these go down, trading stops
  const CRITICAL_APIS = new Set(['MEXC','Supabase','Binance']);
  const apiSources=useMemo(()=>{
    const sources:{name:string;status:string;latency?:number;grade?:string;detail?:string;critical?:boolean}[]=[];
    // Health API systems
    if(health?.api){
      sources.push({name:'Binance',status:health.api.binance?.ok?'OK':'DOWN',latency:health.api.binance?.latencyMs,detail:health.api.binance?.mode});
      // FIX 2026-04-18: Adăugăm DexScreener/CoinGecko DOAR dacă endpoint-ul a returnat efectiv status pentru ele.
      // Fără fallback-ul la DOWN când sistemele nu sunt prezente în payload — elimina alertă RED artificială.
      if(health.api.dexScreener) sources.push({name:'DexScreener',status:health.api.dexScreener.ok?'OK':'DOWN'});
      if(health.api.coinGecko) sources.push({name:'CoinGecko',status:health.api.coinGecko.ok?'OK':'DOWN'});
    }
    // Exchanges
    if(exchanges?.exchanges){
      exchanges.exchanges.forEach(ex=>{
        if(!sources.find(s=>s.name.toLowerCase()===ex.name.toLowerCase())){
          sources.push({name:ex.name.toUpperCase(),status:ex.connected?'OK':ex.enabled?'DOWN':'OFF',detail:ex.mode});
        }
      });
    }
    // Diagnostics
    if(diag?.mexc){
      const existing=sources.find(s=>s.name==='MEXC');
      if(existing){existing.latency=diag.mexc.latencyMs;existing.grade=diag.mexc.healthGrade;}
      else sources.push({name:'MEXC',status:diag.mexc.status,latency:diag.mexc.latencyMs,grade:diag.mexc.healthGrade});
    }
    if(diag?.supabase){
      sources.push({name:'Supabase',status:diag.supabase.status,latency:diag.supabase.roundtripMs,grade:diag.supabase.healthGrade});
    }
    // AI
    // FIX 2026-04-18: Backend /api/diagnostics/credits returnează 'ACTIVE' (uppercase) iar UI aștepta 'ok'.
    // Mismatch → afișa DOWN artificial. Acum acceptăm ACTIVE/OK/ok și orice status ce nu e error-like.
    if(credits){
      const okStatus = (s?: string) => !!s && /^(active|ok|ready|up|healthy)$/i.test(s);
      sources.push({name:'OpenAI',status:okStatus(credits.openai?.status)?'OK':'DOWN',detail:credits.openai?.balance});
      sources.push({name:'DeepSeek',status:okStatus(credits.deepseek?.status)?'OK':'DOWN',detail:credits.deepseek?.balance});
    }
    // Heartbeat providers
    if(dash?.heartbeat?.providers){
      Object.entries(dash.heartbeat.providers).forEach(([name,prov])=>{
        if(!sources.find(s=>s.name.toLowerCase()===name.toLowerCase())){
          sources.push({name,status:prov.ok?'OK':'DOWN',latency:prov.lastLatencyMs??undefined});
        }
      });
    }
    // Tag critical path sources
    sources.forEach(s=>{ s.critical = CRITICAL_APIS.has(s.name); });
    // Sort: critical first, then alphabetical
    sources.sort((a,b)=>(b.critical?1:0)-(a.critical?1:0)||a.name.localeCompare(b.name));
    return sources;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[health,exchanges,diag,credits,dash?.heartbeat]);

  // Overall alert level
  const alertLevel=useMemo(()=>{
    if(dash?.killSwitch?.engaged)return'RED';
    const downCount=apiSources.filter(s=>s.status==='DOWN'||s.status==='ERROR').length;
    if(downCount>=2||overallStatus==='CRITICAL')return'RED';
    if(downCount>=1||overallStatus==='DEGRADED'||errorCount>3)return'YELLOW';
    return'GREEN';
  },[apiSources,overallStatus,errorCount,dash?.killSwitch]);

  return(
    <div style={{background:C.bg,minHeight:'100vh',fontFamily:C.font,paddingBottom:80,color:C.text}}>
      <ToastContainer toasts={toasts} dismiss={dismiss}/>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes spin{to{transform:rotate(360deg)}}
        *{box-sizing:border-box;scrollbar-width:thin;scrollbar-color:${C.borderAlt} transparent;}
        .scroll-x{overflow-x:auto;-webkit-overflow-scrolling:touch;}
        .grid-2{display:grid;grid-template-columns:repeat(2,1fr);}
        .grid-3{display:grid;grid-template-columns:repeat(3,1fr);}
        .grid-4{display:grid;grid-template-columns:repeat(4,1fr);}
        .chip{display:flex;align-items:center;gap:6px;padding:7px 10px;background:${C.surfaceAlt};border:1px solid ${C.border};border-radius:7px;flex-shrink:0;}
        .tab-btn{background:none;border:none;cursor:pointer;padding:4px 8px;border-radius:4px;font-size:10px;font-weight:600;letter-spacing:0.04em;font-family:inherit;}
        .tab-btn.active{background:${C.borderAlt};color:${C.white};}
        .tab-btn:not(.active){color:${C.mutedLight};}
        .log-row{border-bottom:1px solid ${C.border};padding:5px 10px;display:flex;gap:6px;align-items:flex-start;font-size:10px;}
        .log-row:last-child{border-bottom:none;}
        .log-row:hover{background:${C.surfaceAlt};}
        .cmd-grid{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px;}
        .ex-row{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid ${C.border};}
        .ex-row:last-child{border-bottom:none;}
        @media(max-width:640px){
          .grid-4{grid-template-columns:repeat(2,1fr);}
          .grid-3{grid-template-columns:repeat(2,1fr);}
          .hide-phone{display:none !important;}
        }
        @media(max-width:400px){
          .grid-2{grid-template-columns:1fr;}
        }
      `}</style>

      {/* ══════════════════════════════════════════
          HEADER — alert bar + overall status
          ══════════════════════════════════════════ */}
      {alertLevel!=='GREEN'&&(
        <div style={{background:alertLevel==='RED'?C.redBg:C.yellowBg,borderBottom:`1px solid ${alertLevel==='RED'?C.red:C.yellow}40`,padding:'6px 14px',display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:8,height:8,borderRadius:'50%',background:alertLevel==='RED'?C.red:C.yellow,animation:'pulse 1s infinite'}}/>
          <span style={{fontSize:11,fontWeight:700,color:alertLevel==='RED'?C.red:C.yellow}}>
            {dash?.killSwitch?.engaged?'KILL SWITCH ENGAGED — '+dash.killSwitch.reason:alertLevel==='RED'?'CRITICAL — Multiple systems down':'WARNING — Degraded performance'}
          </span>
        </div>
      )}

      <header style={{position:'sticky',top:0,zIndex:50,background:C.bg,borderBottom:`1px solid ${C.border}`,padding:'10px 14px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,flex:1,minWidth:'180px'}}>
          {loading
            ?<div style={{width:10,height:10,borderRadius:'50%',border:`2px solid ${C.yellow}`,borderTopColor:'transparent',animation:'spin .8s linear infinite'}}/>
            :<div style={{width:10,height:10,borderRadius:'50%',background:statusCol,boxShadow:`0 0 8px ${statusCol}`,flexShrink:0}}/>
          }
          <div>
            <div style={{fontSize:13,fontWeight:700,color:C.white,lineHeight:1}}>CONTROL ROOM</div>
            <div style={{fontSize:9,color:C.mutedLight,marginTop:2}}>
              {overallStatus}{health?.version?` · v${health.version.split(' ')[0]}`:''}{health?.uptimeSecs?` · up ${uptime(health.uptimeSecs)}`:''}
            </div>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6,marginLeft:'auto',flexWrap:'wrap'}}>
          <FreshnessBadge timestamp={lastUpdate?lastUpdate.getTime():null} label="feed" />
          <div style={{display:'flex',alignItems:'center',gap:4,padding:'3px 8px',borderRadius:5,border:`1px solid ${(connColor[connectionStatus]||C.muted)}30`,background:hBg(connectionStatus==='connected'?'OK':connectionStatus==='error'?'ERROR':'WARN')}}>
            <div style={{width:6,height:6,borderRadius:'50%',background:connColor[connectionStatus]||C.mutedLight,animation:connectionStatus==='connected'?'pulse 2s infinite':'none'}}/>
            <span style={{fontSize:9,fontWeight:700,color:connColor[connectionStatus]||C.mutedLight}}>{connLabel[connectionStatus]||connectionStatus.toUpperCase()}</span>
          </div>
          {/* Alert indicator */}
          <div style={{width:8,height:8,borderRadius:'50%',background:alertLevel==='GREEN'?C.green:alertLevel==='YELLOW'?C.yellow:C.red,boxShadow:`0 0 6px ${alertLevel==='GREEN'?C.green:alertLevel==='YELLOW'?C.yellow:C.red}`}}/>
          <button style={{padding:'4px 10px',background:'transparent',border:`1px solid ${C.borderAlt}`,color:C.mutedLight,borderRadius:5,fontSize:11,cursor:'pointer',display:'flex',alignItems:'center',gap:4,fontFamily:'inherit'}} onClick={refreshAll}>
            <span style={{animation:loading||diagLoading?'spin .8s linear infinite':'none',display:'inline-block'}}>↺</span>Refresh
          </button>
        </div>
      </header>

      {/* ══════════════════════════════════════════
          CORE SERVICES STRIP
          ══════════════════════════════════════════ */}
      <div style={{margin:'10px 12px 0'}} className="scroll-x">
        <div style={{display:'flex',gap:6,paddingBottom:2}}>
        {[
          {label:'STREAM',val:connLabel[connectionStatus]||'—',col:connColor[connectionStatus]||C.mutedLight},
          {label:'HEARTBEAT',val:dash?.heartbeat?.status||health?.coreMonitor?.heartbeat||'—',col:hColor(dash?.heartbeat?.status||health?.coreMonitor?.heartbeat)},
          {label:'WATCHDOG',val:dash?.watchdog?.status||health?.coreMonitor?.watchdog||'—',col:hColor(dash?.watchdog?.status||health?.coreMonitor?.watchdog)},
          {label:'KILL SW',val:dash?.killSwitch?.engaged?'ENGAGED':(health?.coreMonitor?.killSwitch||'—'),col:dash?.killSwitch?.engaged?C.red:C.green},
          {label:'SUPABASE',val:diag?.supabase?.status||'—',col:hColor(diag?.supabase?.status)},
          {label:'MODE',val:health?.systemMode||bot?.stats?.mode||'—',col:health?.systemMode==='AUTO_TRADE'?C.yellow:C.blue},
          {label:'ALERT',val:alertLevel,col:alertLevel==='GREEN'?C.green:alertLevel==='YELLOW'?C.yellow:C.red},
        ].map(c=>(
          <div key={c.label} className="chip">
            <div style={{width:7,height:7,borderRadius:'50%',background:c.col,animation:c.col===C.green?'pulse 2.5s infinite':'none',flexShrink:0}}/>
            <div>
              <div style={{fontSize:10,fontWeight:700,color:C.mutedLight,letterSpacing:'0.07em'}}>{c.label}</div>
              <div style={{fontSize:10,fontWeight:700,color:c.col,whiteSpace:'nowrap'}}>{c.val}</div>
            </div>
          </div>
        ))}
        </div>
      </div>

      {/* ══════════════════════════════════════════
          QUICK DIAGNOSIS — auto-shows when not GREEN
          ══════════════════════════════════════════ */}
      {alertLevel!=='GREEN'&&(
        <div style={{
          margin:'10px 12px 0',padding:'12px 14px',
          background:alertLevel==='RED'?'rgba(220,20,60,0.08)':'rgba(255,215,64,0.06)',
          border:`1px solid ${alertLevel==='RED'?C.red+'40':C.yellow+'30'}`,
          borderRadius:10,display:'flex',flexDirection:'column',gap:8
        }}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:10,height:10,borderRadius:'50%',background:alertLevel==='RED'?C.red:C.yellow,animation:'pulse 1.5s infinite',flexShrink:0}}/>
            <span style={{fontSize:12,fontWeight:800,color:alertLevel==='RED'?C.red:C.yellow,letterSpacing:'0.04em'}}>
              {alertLevel==='RED'?'DIAGNOSTIC — CRITICAL':'DIAGNOSTIC — WARNING'}
            </span>
          </div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {/* Show down APIs */}
            {apiSources.filter(s=>s.status==='DOWN'||s.status==='ERROR').map(s=>(
              <div key={s.name} style={{
                display:'flex',alignItems:'center',gap:6,padding:'6px 10px',
                background:'rgba(220,20,60,0.1)',border:`1px solid ${C.red}30`,borderRadius:6
              }}>
                <div style={{width:6,height:6,borderRadius:'50%',background:C.red}}/>
                <span style={{fontSize:11,fontWeight:700,color:C.red}}>{s.name} DOWN</span>
                {s.critical&&<span style={{fontSize:9,fontWeight:800,color:'#fff',background:C.red,padding:'1px 5px',borderRadius:3}}>CRITICAL</span>}
              </div>
            ))}
            {dash?.killSwitch?.engaged&&(
              <div style={{display:'flex',alignItems:'center',gap:6,padding:'6px 10px',background:'rgba(220,20,60,0.1)',border:`1px solid ${C.red}30`,borderRadius:6}}>
                <span style={{fontSize:11,fontWeight:700,color:C.red}}>KILL SWITCH ENGAGED</span>
                <span style={{fontSize:10,color:C.mutedLight}}>{dash.killSwitch.reason}</span>
              </div>
            )}
            {connectionStatus!=='connected'&&(
              <div style={{display:'flex',alignItems:'center',gap:6,padding:'6px 10px',background:'rgba(255,215,64,0.08)',border:`1px solid ${C.yellow}30`,borderRadius:6}}>
                <span style={{fontSize:11,fontWeight:700,color:C.yellow}}>SSE DISCONNECTED</span>
              </div>
            )}
          </div>
          <div style={{display:'flex',gap:6}}>
            <button onClick={refreshAll} style={{
              padding:'6px 12px',minHeight:36,background:C.surfaceAlt,border:`1px solid ${C.borderAlt}`,
              color:C.text,borderRadius:6,fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit'
            }}>↺ Refresh All</button>
            <button onClick={()=>setDashTab('system')} style={{
              padding:'6px 12px',minHeight:36,background:'transparent',border:`1px solid ${C.borderAlt}`,
              color:C.mutedLight,borderRadius:6,fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit'
            }}>→ System Details</button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          TAB NAV — groups 15 sections into 4 tabs
          ══════════════════════════════════════════ */}
      <div style={{display:'flex',gap:4,margin:'10px 12px 0',overflowX:'auto',WebkitOverflowScrolling:'touch'}}>
        {([
          {id:'terminal' as DashTab,label:'TERMINAL'},
          {id:'commands' as DashTab,label:'COMMANDS'},
          {id:'strategy' as DashTab,label:'STRATEGY'},
          {id:'system' as DashTab,label:'SYSTEM'},
        ]).map(t=>(
          <button key={t.id} onClick={()=>setDashTab(t.id)} style={{
            padding:'8px 16px',minHeight:44,borderRadius:8,border:`1px solid ${dashTab===t.id?C.gold+'50':C.border}`,
            background:dashTab===t.id?C.gold+'14':'transparent',color:dashTab===t.id?C.gold:C.mutedLight,
            fontSize:11,fontWeight:700,letterSpacing:'0.06em',cursor:'pointer',whiteSpace:'nowrap',
            fontFamily:'inherit',transition:'all 0.15s',touchAction:'manipulation'
          }}>{t.label}</button>
        ))}
      </div>

      {/* ═══ TAB: TERMINAL ═══ */}
      {dashTab==='terminal'&&<>
      {/* ══════════════════════════════════════════
          1. LIVE TERMINAL
          ══════════════════════════════════════════ */}
      <Section title="Live Terminal" badge={connectionStatus==='connected'?'LIVE':'WARN'} right={
        <div style={{display:'flex',gap:3,alignItems:'center'}}>
          {(['all','cmd','error','log'] as const).map(t=>(
            <button key={t} className={`tab-btn${termFilter===t?' active':''}`} onClick={(e)=>{e.stopPropagation();setTermFilter(t);}}>{t.toUpperCase()}</button>
          ))}
          <button className="tab-btn" onClick={(e)=>{e.stopPropagation();setTerminalLines([]);}}>CLR</button>
          <HelpTooltip section={DASHBOARD_HELP.terminal} position="left" />
        </div>
      }>
        <div ref={termRef} style={{maxHeight:280,overflowY:'auto',background:'#050709',fontFamily:'monospace',fontSize:10,lineHeight:1.6}}>
          {filteredTerminal.length===0
            ?<div style={{padding:'20px 12px',textAlign:'center',color:C.mutedLight}}>Terminal empty — execute commands or wait for logs</div>
            :filteredTerminal.slice(0,200).map((l,i)=>(
              <div key={i} style={{padding:'2px 10px',borderBottom:`1px solid ${C.bg}`,color:l.type==='cmd'?C.blue:l.type==='error'?C.red:l.type==='result'?C.green:C.textDim,whiteSpace:'pre-wrap',wordBreak:'break-word'}}>
                <span style={{color:C.muted,marginRight:6}}>{ft(l.ts)}</span>
                {l.type==='cmd'&&<span style={{color:C.yellow,marginRight:4}}>$</span>}
                {l.text}
              </div>
            ))
          }
        </div>
        <div style={{padding:'6px 10px',borderTop:`1px solid ${C.border}`,fontSize:9,color:C.mutedLight,display:'flex',justifyContent:'space-between'}}>
          <span>{terminalLines.length} lines</span>
          <span>Updated {lastUpdate?ft(lastUpdate.toISOString()):'—'}</span>
        </div>
      </Section>

      </>}

      {/* ═══ TAB: COMMANDS ═══ */}
      {dashTab==='commands'&&<>
      {/* ══════════════════════════════════════════
          2. MANUAL COMMANDS
          ══════════════════════════════════════════ */}
      <Section title="Command Center" right={
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          {runningCmd&&<span style={{fontSize:9,color:C.yellow}}>Running: {runningCmd}</span>}
          <HelpTooltip section={DASHBOARD_HELP.commands} position="left" />
        </div>
      }>
        <div style={{padding:'8px 12px'}}>
          <div style={{fontSize:9,fontWeight:700,color:C.mutedLight,marginBottom:6,letterSpacing:'0.06em'}}>KILL SWITCH</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:12,alignItems:'center'}}>
            {!killArmed?(
              <button onClick={armKillSwitch} disabled={!!runningCmd} style={{
                padding:'8px 14px',minHeight:44,background:C.redBg,border:`1px solid ${C.red}40`,
                color:C.red,borderRadius:6,fontSize:11,fontWeight:700,cursor:'pointer',
                fontFamily:'inherit',whiteSpace:'nowrap',transition:'all 0.15s',
                letterSpacing:'0.03em'
              }}>
                ⚠ ARM KILL SWITCH
              </button>
            ):(
              <button onClick={()=>confirmKillSwitch('killswitch:engage')} style={{
                padding:'8px 14px',minHeight:44,background:C.red,border:`2px solid ${C.red}`,
                color:'#fff',borderRadius:6,fontSize:11,fontWeight:800,cursor:'pointer',
                fontFamily:'inherit',whiteSpace:'nowrap',animation:'pulse 0.6s ease-in-out infinite',
                letterSpacing:'0.03em',boxShadow:`0 0 20px ${C.red}60`
              }}>
                ⚡ CONFIRM ENGAGE — {runningCmd==='killswitch:engage'?'...':'CLICK NOW'}
              </button>
            )}
            <CmdBtn label="Disengage Kill Switch" cmd="killswitch:disengage" onRun={runCommand} running={runningCmd} variant="success"/>
            <CmdBtn label="Kill Switch Status" cmd="killswitch:status" onRun={runCommand} running={runningCmd}/>
            {killArmed&&<span style={{fontSize:9,color:C.red,fontWeight:600,animation:'pulse 0.6s ease-in-out infinite'}}>4s to confirm...</span>}
          </div>

          <div style={{fontSize:9,fontWeight:700,color:C.mutedLight,marginBottom:6,letterSpacing:'0.06em'}}>AGENT ORCHESTRATION</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:12}}>
            <CmdBtn label="Swarm Status" cmd="agents:status" onRun={runCommand} running={runningCmd}/>
            <CmdBtn label="Orchestrate BTCUSDT" cmd="agents:orchestrate" params={{symbol:'BTCUSDT'}} onRun={runCommand} running={runningCmd}/>
            <CmdBtn label="Orchestrate ETHUSDT" cmd="agents:orchestrate" params={{symbol:'ETHUSDT'}} onRun={runCommand} running={runningCmd}/>
            <CmdBtn label="Omega Status" cmd="omega:status" onRun={runCommand} running={runningCmd}/>
            <CmdBtn label="Arena Status" cmd="arena:status" onRun={runCommand} running={runningCmd}/>
          </div>

          <div style={{fontSize:9,fontWeight:700,color:C.mutedLight,marginBottom:6,letterSpacing:'0.06em'}}>DATA COLLECTION</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:12}}>
            <CmdBtn label="Collect Sentiment" cmd="collect:sentiment" onRun={runCommand} running={runningCmd}/>
            <CmdBtn label="Collect News" cmd="collect:news" onRun={runCommand} running={runningCmd}/>
            <CmdBtn label="Snapshot Positions" cmd="collect:positions" onRun={runCommand} running={runningCmd}/>
            <CmdBtn label="Poly Scan" cmd="poly:scan" onRun={runCommand} running={runningCmd}/>
            <CmdBtn label="Poly MTM" cmd="poly:mtm" onRun={runCommand} running={runningCmd}/>
          </div>

          <div style={{fontSize:9,fontWeight:700,color:C.mutedLight,marginBottom:6,letterSpacing:'0.06em'}}>BOT CONTROL & DIAGNOSTICS</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:12}}>
            <CmdBtn label="Evaluate Signals" cmd="bot:evaluate" onRun={runCommand} running={runningCmd}/>
            <CmdBtn label="Recalculate Performance" cmd="bot:recalculate" onRun={runCommand} running={runningCmd}/>
            <CmdBtn label="Trigger Promoter" cmd="bot:trigger-promoter" onRun={runCommand} running={runningCmd}/>
            <CmdBtn label="Full Diagnostics" cmd="diag:full" onRun={runCommand} running={runningCmd}/>
            <CmdBtn label="Signal Quality" cmd="diag:signal-quality" onRun={runCommand} running={runningCmd}/>
          </div>

          <div style={{fontSize:9,fontWeight:700,color:C.mutedLight,marginBottom:6,letterSpacing:'0.06em'}}>SYSTEM</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            <CmdBtn label="Ping Watchdog" cmd="watchdog:ping" onRun={runCommand} running={runningCmd}/>
            <CmdBtn label="Start Heartbeat" cmd="heartbeat:start" onRun={runCommand} running={runningCmd}/>
            <CmdBtn label="Heartbeat Status" cmd="heartbeat:status" onRun={runCommand} running={runningCmd}/>
            <CmdBtn label="Reset Daily Triggers" cmd="reset:daily-triggers" onRun={runCommand} running={runningCmd}/>
            <CmdBtn label="Auto-Promote" cmd="arena:promote" onRun={runCommand} running={runningCmd}/>
          </div>
        </div>
      </Section>

      {/* ══════════════════════════════════════════
          3. STRATEGY PERFORMANCE
          ══════════════════════════════════════════ */}
      <Section title={`Strategy Performance (${strategies.length})`} right={
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <FreshnessBadge timestamp={lastUpdate?.getTime()} label="perf"/>
          <HelpTooltip section={DASHBOARD_HELP.strategy} position="left" />
        </div>
      }>
        {strategies.length===0?(
          <div style={{padding:'20px 12px',textAlign:'center',color:C.mutedLight,fontSize:11}}>No strategy data available</div>
        ):(
          <div style={{maxHeight:400,overflowY:'auto'}}>
            {strategies.map((s:{signalType:string;source:string;totalTrades:number;wins:number;losses:number;winRate:number;avgPnlPercent:number;bestTrade:number;worstTrade:number},i:number)=>{
              const wr=s.winRate*100;
              const wrCol=wr>=60?C.green:wr>=45?C.yellow:C.red;
              const pnlCol=s.avgPnlPercent>=0?C.green:C.red;
              return(
                <div key={i} style={{padding:'10px 12px',borderBottom:`1px solid ${C.border}`}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontSize:11,fontWeight:700,color:C.white}}>{s.signalType}</span>
                      <span style={{fontSize:10,color:C.mutedLight,padding:'1px 5px',borderRadius:3,background:C.surfaceAlt}}>{s.source}</span>
                    </div>
                    <span style={{fontSize:12,fontWeight:700,color:wrCol}}>{wr.toFixed(1)}% WR</span>
                  </div>
                  <div style={{display:'flex',gap:12,flexWrap:'wrap',fontSize:9,color:C.textDim}}>
                    <span>Trades: <b style={{color:C.white}}>{s.totalTrades}</b></span>
                    <span>W: <b style={{color:C.green}}>{s.wins}</b></span>
                    <span>L: <b style={{color:C.red}}>{s.losses}</b></span>
                    <span>Avg PnL: <b style={{color:pnlCol}}>{s.avgPnlPercent.toFixed(2)}%</b></span>
                    <span>Best: <b style={{color:C.green}}>{s.bestTrade.toFixed(2)}%</b></span>
                    <span>Worst: <b style={{color:C.red}}>{s.worstTrade.toFixed(2)}%</b></span>
                  </div>
                  {/* Win rate bar */}
                  <div style={{marginTop:6,height:4,borderRadius:2,background:C.border,overflow:'hidden'}}>
                    <div style={{height:'100%',width:`${Math.min(100,wr)}%`,background:wrCol,borderRadius:2}}/>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ══════════════════════════════════════════
          4. TRADING OPERATIONS
          ══════════════════════════════════════════ */}
      <Section title="Trading Operations" right={
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <span style={{fontSize:9,color:health?.systemMode==='AUTO_TRADE'?C.yellow:C.blue,fontWeight:700}}>{health?.systemMode||bot?.stats?.mode||'PAPER'}</span>
          <HelpTooltip section={DASHBOARD_HELP.trading} position="left" />
        </div>
      }>
        <div className="grid-4" style={{background:C.border,gap:'1px'}}>
          {card('Decisions Today',(health?.trading?.decisionsToday??dash?.trading?.totalSignals??'—').toString(),C.blue)}
          {card('Open Positions',(diag?.positions?.open??dash?.trading?.openPositions??'—').toString(),C.white)}
          {card('Win Rate',bot?.stats?.overallWinRate!=null?`${bot.stats.overallWinRate.toFixed(1)}%`:'—',bot?.stats?.overallWinRate!=null&&bot.stats.overallWinRate>=55?C.green:bot?.stats?.overallWinRate!=null&&bot.stats.overallWinRate>=45?C.yellow:C.red)}
          {card('Total Trades',(diag?.equity?.totalTrades??bot?.stats?.totalDecisions??'—').toString(),C.text)}
        </div>
        {diag?.equity&&(
          <div style={{padding:'8px 12px',display:'flex',gap:14,borderTop:`1px solid ${C.border}`,flexWrap:'wrap'}}>
            {[
              {l:'Equity',v:usd(diag.equity.currentBalance),c:C.white},
              {l:'Peak',v:usd(diag.equity.peakBalance),c:C.blue},
              {l:'MaxDD',v:pct(diag.equity.maxDrawdownPercent),c:(diag.equity.maxDrawdownPercent??0)>15?C.red:C.yellow},
              {l:'W',v:String(diag.equity.wins),c:C.green},
              {l:'L',v:String(diag.equity.losses),c:C.red},
              {l:'WR',v:pct(diag.equity.winRatePercent),c:(diag.equity.winRatePercent??0)>=55?C.green:C.yellow},
            ].map(x=>(
              <div key={x.l} style={{fontSize:9,color:C.mutedLight}}>{x.l}&nbsp;<span style={{color:x.c,fontWeight:700}}>{x.v}</span></div>
            ))}
            {bot?.stats?.streakType&&bot.stats.streakType!=='NONE'&&(
              <div style={{fontSize:9,color:C.mutedLight}}>Streak&nbsp;<span style={{color:bot.stats.streakType==='WIN'?C.green:C.red,fontWeight:700}}>{bot.stats.streakType==='WIN'?'▲':'▼'} {Math.abs(bot.stats.currentStreak)}</span></div>
            )}
          </div>
        )}
      </Section>

      </>}

      {/* ═══ TAB: STRATEGY ═══ */}
      {dashTab==='strategy'&&<>
      {/* ══════════════════════════════════════════
          5. CHARTS — Equity, PnL, Memory, Errors
          ══════════════════════════════════════════ */}
      <Section title="Charts & Trends" right={
        <div style={{display:'flex',gap:4}}>
          {[12,24].map(h=>(
            <button key={h} className={`tab-btn${historyHours===h?' active':''}`} onClick={(e)=>{e.stopPropagation();setHistoryHours(h);}}>{h}h</button>
          ))}
        </div>
      }>
        <div style={{padding:'10px 12px',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10}}>
          {/* Equity Curve */}
          <div style={{background:C.surfaceAlt,borderRadius:8,padding:10,border:`1px solid ${C.border}`}}>
            <div style={{fontSize:10,fontWeight:700,color:C.mutedLight,marginBottom:6}}>EQUITY CURVE</div>
            <Sparkline data={equityData} color={C.green}/>
            {equityData.length>0&&<div style={{fontSize:9,color:C.green,fontWeight:700,marginTop:4}}>${equityData[equityData.length-1]?.toFixed(0)}</div>}
          </div>
          {/* PnL Trend */}
          <div style={{background:C.surfaceAlt,borderRadius:8,padding:10,border:`1px solid ${C.border}`}}>
            <div style={{fontSize:10,fontWeight:700,color:C.mutedLight,marginBottom:6}}>PnL TREND</div>
            <Sparkline data={pnlData} color={C.blue}/>
            {pnlData.length>0&&<div style={{fontSize:9,color:pnlData[pnlData.length-1]>=0?C.green:C.red,fontWeight:700,marginTop:4}}>{pnlData[pnlData.length-1]?.toFixed(2)}%</div>}
          </div>
          {/* Memory Usage */}
          <div style={{background:C.surfaceAlt,borderRadius:8,padding:10,border:`1px solid ${C.border}`}}>
            <div style={{fontSize:10,fontWeight:700,color:C.mutedLight,marginBottom:6}}>MEMORY (RSS)</div>
            <Sparkline data={historyMem} color={C.yellow}/>
            {diag?.system&&<div style={{fontSize:9,color:C.text,fontWeight:700,marginTop:4}}>{diag.system.memoryUsageMB.rss} MB</div>}
          </div>
          {/* Error Rate */}
          <div style={{background:C.surfaceAlt,borderRadius:8,padding:10,border:`1px solid ${C.border}`}}>
            <div style={{fontSize:10,fontWeight:700,color:C.mutedLight,marginBottom:6}}>ERROR RATE</div>
            <Sparkline data={historyErrors} color={C.red}/>
            {dash?.logs&&<div style={{fontSize:9,color:errorCount>0?C.red:C.green,fontWeight:700,marginTop:4}}>{dash.logs.errorCount1h} /hr</div>}
          </div>
          {/* Latency */}
          <div style={{background:C.surfaceAlt,borderRadius:8,padding:10,border:`1px solid ${C.border}`}}>
            <div style={{fontSize:10,fontWeight:700,color:C.mutedLight,marginBottom:6}}>LATENCY</div>
            {diag?.supabase&&diag?.mexc?(
              <BarChart data={[diag.supabase.roundtripMs,diag.mexc.latencyMs,health?.api?.binance?.latencyMs||0]} labels={['Supabase','MEXC','Binance']} colors={[C.blue,C.purple,C.yellow]} height={50}/>
            ):<div style={{color:C.mutedLight,fontSize:9}}>No data</div>}
          </div>
          {/* Win Rate Trend */}
          <div style={{background:C.surfaceAlt,borderRadius:8,padding:10,border:`1px solid ${C.border}`}}>
            <div style={{fontSize:10,fontWeight:700,color:C.mutedLight,marginBottom:6}}>WIN RATE</div>
            {strategies.length>0?(
              <BarChart data={strategies.slice(0,5).map((s:{winRate:number})=>Math.round(s.winRate*100))} labels={strategies.slice(0,5).map((s:{signalType:string})=>s.signalType.slice(0,6))} colors={[C.green,C.blue,C.yellow,C.purple,C.orange]} height={50}/>
            ):<div style={{color:C.mutedLight,fontSize:9}}>No data</div>}
          </div>
          {/* Drawdown */}
          <div style={{background:C.surfaceAlt,borderRadius:8,padding:10,border:`1px solid ${C.border}`}}>
            <div style={{fontSize:10,fontWeight:700,color:C.mutedLight,marginBottom:6}}>DRAWDOWN</div>
            <div style={{fontSize:18,fontWeight:700,color:(diag?.equity?.maxDrawdownPercent??0)>10?C.red:(diag?.equity?.maxDrawdownPercent??0)>5?C.yellow:C.green}}>
              {pct(diag?.equity?.maxDrawdownPercent)}
            </div>
            <div style={{fontSize:10,color:C.mutedLight,marginTop:2}}>Max Drawdown</div>
          </div>
          {/* Connection Uptime */}
          <div style={{background:C.surfaceAlt,borderRadius:8,padding:10,border:`1px solid ${C.border}`}}>
            <div style={{fontSize:10,fontWeight:700,color:C.mutedLight,marginBottom:6}}>UPTIME</div>
            <div style={{fontSize:18,fontWeight:700,color:C.green}}>{uptime(diag?.system?.uptimeSeconds||0)}</div>
            <div style={{fontSize:10,color:C.mutedLight,marginTop:2}}>{updateCount} SSE updates</div>
          </div>
          {/* Feed Freshness */}
          <div style={{background:C.surfaceAlt,borderRadius:8,padding:10,border:`1px solid ${C.border}`}}>
            <div style={{fontSize:10,fontWeight:700,color:C.mutedLight,marginBottom:6}}>FEED FRESHNESS</div>
            {apiSources.length>0?(
              <BarChart data={apiSources.slice(0,5).map(s=>s.status==='OK'?100:s.status==='DOWN'?0:50)} labels={apiSources.slice(0,5).map(s=>s.name.slice(0,6))} colors={apiSources.slice(0,5).map(s=>s.status==='OK'?C.green:s.status==='DOWN'?C.red:C.yellow)} height={50}/>
            ):<div style={{color:C.mutedLight,fontSize:9}}>No data</div>}
          </div>
          {/* Signal Attribution */}
          <div style={{background:C.surfaceAlt,borderRadius:8,padding:10,border:`1px solid ${C.border}`}}>
            <div style={{fontSize:10,fontWeight:700,color:C.mutedLight,marginBottom:6}}>SIGNAL SOURCE</div>
            {strategies.length>0?(
              <BarChart data={strategies.slice(0,5).map((s:{totalTrades:number})=>s.totalTrades)} labels={strategies.slice(0,5).map((s:{source:string})=>(s.source||'?').slice(0,6))} colors={[C.blue,C.purple,C.green,C.orange,C.yellow]} height={50}/>
            ):<div style={{color:C.mutedLight,fontSize:9}}>No data</div>}
          </div>
          {/* Coupling */}
          <div style={{background:C.surfaceAlt,borderRadius:8,padding:10,border:`1px solid ${C.border}`}}>
            <div style={{fontSize:10,fontWeight:700,color:C.mutedLight,marginBottom:6}}>COUPLING</div>
            {diag?.sentinel?(
              <>
                <div style={{fontSize:16,fontWeight:700,color:(diag.sentinel.dailyLossPercent??0)>5?C.red:(diag.sentinel.dailyLossPercent??0)>2?C.yellow:C.green}}>
                  {pct(diag.sentinel.dailyLossPercent)}
                </div>
                <div style={{fontSize:10,color:C.mutedLight,marginTop:2}}>Daily Loss · {diag.sentinel.triggered?<span style={{color:C.red,fontWeight:700}}>TRIGGERED</span>:'OK'}</div>
              </>
            ):<div style={{color:C.mutedLight,fontSize:9}}>No sentinel data</div>}
          </div>
        </div>
      </Section>

      {/* ══════════════════════════════════════════
          6. API / SOURCE HEALTH
          ══════════════════════════════════════════ */}
      <Section title={`API & Source Health (${apiSources.length})`} badge={apiSources.every(s=>s.status==='OK')?'OK':apiSources.some(s=>s.status==='DOWN')?'DEGRADED':'OK'} right={
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <FreshnessBadge timestamp={lastLight?.getTime()} label="api"/>
          <HelpTooltip section={DASHBOARD_HELP.apiHealth} position="left" />
        </div>
      }>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:1,background:C.border}}>
          {apiSources.map(s=>{
            const col=hColor(s.status);
            const isCritDown=s.critical&&s.status!=='OK';
            return(
              <div key={s.name} style={{
                background:C.surface,padding:'10px 12px',display:'flex',alignItems:'center',gap:8,
                ...(isCritDown?{border:`1px solid ${C.red}`,animation:'pulse 2s infinite',boxShadow:`inset 0 0 12px ${C.red}20`}:{})
              }}>
                <div style={{width:8,height:8,borderRadius:'50%',background:col,animation:s.status==='OK'?'pulse 3s infinite':'none',flexShrink:0}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:10,fontWeight:700,color:C.white,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',display:'flex',alignItems:'center',gap:4}}>
                    {s.name}
                    {s.critical&&<span style={{fontSize:10,fontWeight:800,color:isCritDown?C.red:C.yellow,background:isCritDown?C.redBg:`${C.yellow}14`,padding:'1px 4px',borderRadius:3,letterSpacing:'0.05em'}}>CRITICAL</span>}
                  </div>
                  <div style={{fontSize:10,color:C.mutedLight}}>
                    {s.latency!=null?`${s.latency}ms`:''}
                    {s.grade?` · ${s.grade}`:''}
                    {s.detail?` · ${s.detail}`:''}
                  </div>
                </div>
                <span style={{fontSize:10,fontWeight:700,color:col,padding:'1px 5px',borderRadius:3,background:`${col}14`}}>{s.status}</span>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ══════════════════════════════════════════
          7. AI PROVIDERS & CREDITS
          ══════════════════════════════════════════ */}
      <Section title="AI Providers & Database" right={
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <FreshnessBadge timestamp={lastDiag?.getTime()} label="diag" freshMs={120000} staleMs={300000}/>
          {diagLoading&&<span style={{fontSize:9,color:C.yellow}}>checking...</span>}
        </div>
      }>
        <div className="grid-2" style={{background:C.border,gap:'1px'}}>
          <div style={{background:C.surface,padding:'10px 12px'}}>
            <div style={{fontSize:9,fontWeight:700,letterSpacing:'0.08em',color:C.mutedLight,textTransform:'uppercase',marginBottom:4}}>OpenAI GPT</div>
            <div style={{fontSize:15,fontWeight:700,color:hColor(credits?.openai.status)}}>{credits?credits.openai.status:'—'}</div>
            {credits?.openai?.balance&&<div style={{fontSize:9,color:C.mutedLight,marginTop:2}}>${credits.openai.balance}</div>}
          </div>
          <div style={{background:C.surface,padding:'10px 12px',minWidth:'200px'}}>
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
                <div><div style={{fontSize:10,color:C.mutedLight}}>WRITE</div><div style={{fontSize:13,fontWeight:700,color:diag.supabase.writeLatencyMs<200?C.green:C.yellow}}>{diag.supabase.writeLatencyMs}ms</div></div>
                <div><div style={{fontSize:10,color:C.mutedLight}}>READ</div><div style={{fontSize:13,fontWeight:700,color:diag.supabase.readLatencyMs<150?C.green:C.yellow}}>{diag.supabase.readLatencyMs}ms</div></div>
              </div>
            ):<div style={{fontSize:14,fontWeight:700,color:C.mutedLight}}>—</div>}
          </div>
        </div>
        {/* Credit bars */}
        {credits&&(
          <div style={{padding:'10px 12px',display:'flex',flexDirection:'column',gap:8,borderTop:`1px solid ${C.border}`}}>
            {[
              {name:'OpenAI',data:credits.openai,color:C.green},
              {name:'DeepSeek',data:credits.deepseek,color:C.purple},
            ].map(p=>{
              const available=p.data?.is_available||p.data?.status==='ok';
              const bal=parseFloat(String(p.data?.balance||'0'))||0;
              const pctVal=Math.min(100,Math.max(0,bal>0?(bal/20)*100:available?80:0));
              return(
                <div key={p.name}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
                    <span style={{fontSize:9,fontWeight:700,color:C.white}}>{p.name}</span>
                    <span style={{fontSize:9,fontWeight:700,color:available?p.color:C.red}}>{available?'AVAILABLE':'UNAVAILABLE'}{bal>0?` · $${bal.toFixed(2)}`:''}</span>
                  </div>
                  <div style={{height:5,background:C.surfaceAlt,borderRadius:3,overflow:'hidden'}}>
                    <div style={{height:'100%',width:`${pctVal}%`,background:`linear-gradient(90deg,${p.color},${p.color}88)`,borderRadius:3,transition:'width 0.6s ease'}}/>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ══════════════════════════════════════════
          8. TOP GLADIATOR
          ══════════════════════════════════════════ */}
      {omega&&(
        <Section title="Top Gladiator" right={<span style={{fontSize:9,color:omega.isOmega?C.yellow:C.mutedLight,fontWeight:700}}>{omega.isOmega?'OMEGA':'ACTIVE'}</span>}>
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
              <span style={{fontSize:9,color:C.mutedLight}}>Training</span>
              <span style={{fontSize:9,fontWeight:700,color:C.blue}}>{Math.round(omega.trainingProgress*100)}%</span>
            </div>
            <div style={{height:4,borderRadius:2,background:C.border,overflow:'hidden'}}>
              <div style={{height:'100%',borderRadius:2,background:omega.isOmega?C.yellow:C.green,width:`${Math.round(omega.trainingProgress*100)}%`}}/>
            </div>
          </div>
        </Section>
      )}

      {/* ══════════════════════════════════════════
          9. ALL GLADIATORS
          ══════════════════════════════════════════ */}
      {bot?.gladiators&&bot.gladiators.length>0&&(
        <Section title={`All Gladiators (${bot.gladiators.length})`} right={<span style={{fontSize:9,color:C.green}}>{bot.gladiators.filter((g:Record<string,unknown>)=>g.isLive||g.status==='LIVE').length} LIVE</span>} defaultOpen={false}>
          <div style={{maxHeight:320,overflowY:'auto',padding:'6px 12px'}}>
            {bot.gladiators.map((g:Record<string,unknown>)=>{
              const gId=String(g.id||'');const gName=String(g.name||g.id||'?');const gStatus=String(g.status||'UNKNOWN');
              const gIsLive=!!g.isLive||gStatus==='LIVE';const gWinRate=Number(g.winRate)||0;const gTotalTrades=Number(g.totalTrades)||0;
              const gProfitFactor=Number(g.profitFactor)||0;const gArena=String(g.arena||'—');const gTrainingProgress=Number(g.trainingProgress)||0;const gIsOmega=!!g.isOmega;
              const statusCol=gIsLive?C.green:gStatus==='IN_TRAINING'?C.blue:gStatus==='RETIRED'||gStatus==='ELIMINATED'?C.red:C.yellow;
              const open=expandedGlad.has(gId);
              return(
                <div key={gId} onClick={()=>toggleGlad(gId)} style={{background:C.surfaceAlt,border:`1px solid ${open?C.blue:C.border}`,borderRadius:8,padding:'8px 10px',marginBottom:6,cursor:'pointer',transition:'all 0.2s'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <div style={{width:6,height:6,borderRadius:'50%',background:statusCol,animation:gIsLive?'pulse 2s infinite':'none'}}/>
                      <span style={{fontSize:11,fontWeight:700,color:C.white}}>{gName}</span>
                      {gIsOmega&&<span style={{fontSize:10,fontWeight:700,color:C.purple,padding:'1px 5px',borderRadius:3,background:C.purpleBg}}>OMEGA</span>}
                      <span style={{fontSize:10,fontWeight:700,color:statusCol,padding:'1px 5px',borderRadius:3,background:`${statusCol}14`}}>{gStatus}</span>
                    </div>
                    <div style={{display:'flex',gap:10,alignItems:'center'}}>
                      <span style={{fontSize:10,fontWeight:700,color:gWinRate>=0.6?C.green:gWinRate>=0.45?C.yellow:C.red}}>{(gWinRate*100).toFixed(1)}%</span>
                      <span className="hide-phone" style={{fontSize:9,color:C.mutedLight}}>{gTotalTrades} trades</span>
                      <span style={{fontSize:10,color:C.textDim,transform:open?'rotate(90deg)':'none',transition:'transform 0.2s'}}>›</span>
                    </div>
                  </div>
                  {open&&(
                    <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${C.border}`,display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,fontSize:9,color:C.textDim}}>
                      <div>Arena: <span style={{color:C.white,fontWeight:600}}>{gArena}</span></div>
                      <div>P/F: <span style={{color:C.white,fontWeight:600}}>{gProfitFactor>0?gProfitFactor.toFixed(2):'—'}</span></div>
                      <div>Training: <span style={{color:C.blue,fontWeight:600}}>{gTrainingProgress}%</span></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      </>}

      {/* ═══ TAB: SYSTEM ═══ */}
      {dashTab==='system'&&<>
      {/* ══════════════════════════════════════════
          10. LIVE CONSOLE (backend logs)
          ══════════════════════════════════════════ */}
      <Section title="Live Console" right={
        <div style={{display:'flex',gap:4,alignItems:'center'}}>
          {errorCount>0&&<span style={{fontSize:9,fontWeight:700,color:C.red}}>{errorCount} ERR</span>}
          {warnCount>0&&<span style={{fontSize:9,fontWeight:700,color:C.yellow}}>{warnCount} WARN</span>}
          {(['all','error','warn'] as const).map(t=>(
            <button key={t} className={`tab-btn${activeLog===t?' active':''}`} onClick={(e)=>{e.stopPropagation();setActiveLog(t);}}>{t.toUpperCase()}</button>
          ))}
        </div>
      }>
        <div style={{maxHeight:240,overflowY:'auto'}}>
          {filteredLogs.length===0
            ?<div style={{padding:'20px 12px',textAlign:'center',color:C.mutedLight,fontSize:12}}>No log entries</div>
            :filteredLogs.slice(0,40).map((log:{ts:string;level:string;msg:string},i:number)=>(
              <div key={i} className="log-row">
                <div style={{fontSize:10,fontWeight:800,color:lColor(log.level),minWidth:30,paddingTop:1,letterSpacing:'0.04em'}}>{log.level?.toUpperCase().slice(0,4)}</div>
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
      </Section>

      {/* ══════════════════════════════════════════
          11. SYSTEM RESOURCES
          ══════════════════════════════════════════ */}
      <Section title="System Resources" right={<FreshnessBadge timestamp={lastDiag?.getTime()} label="sys" freshMs={120000} staleMs={300000}/>}>
        <div className="grid-3" style={{background:C.border,gap:'1px'}}>
          {card('RSS Memory',diag?.system?`${diag.system.memoryUsageMB.rss} MB`:(dash?.system?.memoryUsageRssMB?`${dash.system.memoryUsageRssMB} MB`:'—'),diag?.system&&diag.system.memoryUsageMB.rss>400?C.yellow:C.text)}
          {card('Heap',diag?.system?`${diag.system.memoryUsageMB.heapUsed}/${diag.system.memoryUsageMB.heapTotal} MB`:'—',C.text)}
          {card('Uptime',diag?.system?uptime(diag.system.uptimeSeconds):(dash?.system?.uptime?uptime(dash.system.uptime):'—'),C.green)}
          {card('Node',diag?.system?.nodeVersion||'—',C.mutedLight)}
          {card('Sync Queue',dash?.system?.syncQueue?`${dash.system.syncQueue.pending} pending`:'—',dash?.system?.syncQueue?.pending?C.yellow:C.mutedLight)}
          {card('Updates',updateCount.toString(),C.blue)}
        </div>
      </Section>

      {/* ══════════════════════════════════════════
          12. SYNDICATE DECISIONS (last + history)
          ══════════════════════════════════════════ */}
      {bot?.syndicateAudits&&bot.syndicateAudits.length>0&&(
        <Section title={`Syndicate Audit Trail (${bot.syndicateAudits.length})`} defaultOpen={false}>
          <div style={{maxHeight:400,overflowY:'auto',padding:'6px 12px'}}>
            {bot.syndicateAudits.slice(0,15).map((audit:{symbol:string;decision:string;confidence:number;timestamp:string;architect:{direction:string;confidence:number;reasoning:string};oracle:{direction:string;confidence:number;reasoning:string};nodes?:Array<{seat:string;direction:string;confidence:number;reasoning:string}>},i:number)=>{
              const open=expandedAudits.has(i);
              const dirCol=audit.decision==='BUY'?C.green:audit.decision==='SELL'?C.red:C.yellow;
              return(
                <div key={i} onClick={()=>toggleAudit(i)} style={{background:C.surfaceAlt,border:`1px solid ${open?dirCol:C.border}`,borderRadius:8,padding:'8px 10px',marginBottom:6,cursor:'pointer',transition:'all 0.2s'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontSize:11,fontWeight:700,color:C.white}}>{audit.symbol}</span>
                      <span style={{fontSize:9,fontWeight:700,color:dirCol,padding:'1px 6px',borderRadius:3,background:`${dirCol}14`}}>{audit.decision}</span>
                      <span style={{fontSize:9,color:C.blue}}>{Math.round(audit.confidence*100)}%</span>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <span style={{fontSize:10,color:C.mutedLight}}>{fdt(audit.timestamp)}</span>
                      <span style={{fontSize:10,color:C.textDim,transform:open?'rotate(90deg)':'none',transition:'transform 0.2s'}}>›</span>
                    </div>
                  </div>
                  {open&&(
                    <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${C.border}`,display:'flex',flexDirection:'column',gap:6}}>
                      {[{name:'ARCHITECT',d:audit.architect},{name:'ORACLE',d:audit.oracle}].map(n=>(
                        <div key={n.name} style={{background:C.bg,borderRadius:6,padding:'6px 8px',border:`1px solid ${C.border}`}}>
                          <div style={{fontSize:10,fontWeight:700,color:C.mutedLight,marginBottom:2}}>{n.name}</div>
                          <div style={{fontSize:10,fontWeight:700,color:n.d.direction==='BUY'?C.green:n.d.direction==='SELL'?C.red:C.yellow}}>{n.d.direction} · {Math.round(n.d.confidence*100)}%</div>
                          <div style={{fontSize:9,color:C.textDim,marginTop:3,lineHeight:1.4}}>{n.d.reasoning}</div>
                        </div>
                      ))}
                      {audit.nodes&&audit.nodes.map((nd,ni)=>(
                        <div key={ni} style={{background:C.bg,borderRadius:6,padding:'6px 8px',border:`1px solid ${C.border}`}}>
                          <div style={{fontSize:10,fontWeight:700,color:C.mutedLight}}>{nd.seat}</div>
                          <div style={{fontSize:10,color:nd.direction==='BUY'?C.green:nd.direction==='SELL'?C.red:C.yellow}}>{nd.direction} · {Math.round(nd.confidence*100)}%</div>
                          <div style={{fontSize:9,color:C.textDim,marginTop:2}}>{nd.reasoning}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ══════════════════════════════════════════
          13. DEEP SYSTEM HEALTH
          ══════════════════════════════════════════ */}
      <Section title="Deep System Health" right={<FreshnessBadge timestamp={lastDiag?.getTime()} label="health" freshMs={120000} staleMs={300000}/>} defaultOpen={false}>
        <div style={{padding:'10px 12px',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:8}}>
          {[
            {name:'Supabase DB',latency:diag?.supabase?.roundtripMs,grade:diag?.supabase?.healthGrade,read:diag?.supabase?.readLatencyMs,write:diag?.supabase?.writeLatencyMs,consistent:diag?.supabase?.consistent},
            {name:'MEXC Exchange',latency:diag?.mexc?.latencyMs,grade:diag?.mexc?.healthGrade,balance:diag?.mexc?.usdtBalance,drift:diag?.mexc?.clockDriftMs},
            {name:'Binance',latency:health?.api?.binance?.latencyMs,grade:health?.api?.binance?.ok?'A':'F',mode:health?.api?.binance?.mode},
          ].map(sys=>{
            const col=gColor(sys.grade);
            return(
              <div key={sys.name} style={{background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:8,padding:10}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <span style={{fontSize:11,fontWeight:700,color:C.white}}>{sys.name}</span>
                  <span style={{fontSize:9,fontWeight:700,color:col,padding:'2px 6px',borderRadius:4,background:`${col}14`}}>{sys.grade||'—'}</span>
                </div>
                <div style={{fontSize:9,color:C.textDim,display:'flex',flexDirection:'column',gap:3}}>
                  {sys.latency!=null&&<div>Latency: <span style={{color:C.white,fontWeight:600}}>{sys.latency}ms</span></div>}
                  {sys.read!=null&&<div>Read: <span style={{color:C.white}}>{sys.read}ms</span> · Write: <span style={{color:C.white}}>{sys.write}ms</span></div>}
                  {sys.consistent!=null&&<div>Consistent: <span style={{color:sys.consistent?C.green:C.red,fontWeight:600}}>{sys.consistent?'YES':'NO'}</span></div>}
                  {sys.balance!=null&&<div>USDT: <span style={{color:C.green,fontWeight:700}}>${sys.balance.toFixed(2)}</span></div>}
                  {sys.drift!=null&&<div>Clock Drift: <span style={{color:Math.abs(sys.drift)<1000?C.green:C.red}}>{sys.drift}ms</span></div>}
                  {sys.mode&&<div>Mode: <span style={{color:C.blue}}>{sys.mode}</span></div>}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ══════════════════════════════════════════
          14. HISTORY / EXPORT
          ══════════════════════════════════════════ */}
      <Section title="History & Export" right={
        <div style={{display:'flex',gap:4,alignItems:'center'}}>
          {[12,24].map(h=>(
            <button key={h} className={`tab-btn${historyHours===h?' active':''}`} onClick={(e)=>{e.stopPropagation();setHistoryHours(h);}}>{h}h</button>
          ))}
          <button className="tab-btn" onClick={async(e)=>{
            e.stopPropagation();
            // Export terminal + logs as JSON
            const exportData={
              exported:new Date().toISOString(),
              timeframe:`${historyHours}h`,
              terminal:terminalLines,
              logs:logs,
              equityCurve:bot?.equityCurve||[],
              strategies,
              health:{overall:overallStatus,apis:apiSources},
            };
            const jsonStr=JSON.stringify(exportData,null,2);
            const blob=new Blob([jsonStr],{type:'application/json'});
            const url=URL.createObjectURL(blob);
            const fname=`trade-ai-export-${new Date().toISOString().slice(0,16)}.json`;
            // Mobile-compatible download: use navigator.share if available, else <a> click
            if(typeof navigator!=='undefined'&&navigator.share&&navigator.canShare?.({files:[new File([blob],fname,{type:'application/json'})]})){
              try{await navigator.share({files:[new File([blob],fname,{type:'application/json'})],title:'Trade AI Export'});}catch{}
            }else{
              const a=document.createElement('a');
              a.href=url;a.download=fname;
              document.body.appendChild(a);a.click();document.body.removeChild(a);
            }
            URL.revokeObjectURL(url);
          }}>JSON</button>
          <button className="tab-btn" onClick={async(e)=>{
            e.stopPropagation();
            // CSV export: decisions table
            const decisions=(bot?.decisions||[]).filter((d:{timestamp:string})=>{
              const t=new Date(d.timestamp).getTime();
              return t>=Date.now()-historyHours*3600000;
            }) as {id:string;symbol:string;direction:string;confidence:number;price:number;timestamp:string;outcome:string;pnlPercent:number|null}[];
            const header='timestamp,symbol,direction,confidence,outcome,pnl_percent';
            const rows=decisions.map(d=>`${d.timestamp},${d.symbol},${d.direction},${(d.confidence*100).toFixed(1)},${d.outcome},${d.pnlPercent?.toFixed(2)??''}`);
            const csv=[header,...rows].join('\n');
            const blob=new Blob([csv],{type:'text/csv'});
            const url=URL.createObjectURL(blob);
            const fname=`trade-ai-decisions-${new Date().toISOString().slice(0,16)}.csv`;
            if(typeof navigator!=='undefined'&&navigator.share&&navigator.canShare?.({files:[new File([blob],fname,{type:'text/csv'})]})){
              try{await navigator.share({files:[new File([blob],fname,{type:'text/csv'})],title:'Trade AI Decisions'});}catch{}
            }else{
              const a=document.createElement('a');a.href=url;a.download=fname;
              document.body.appendChild(a);a.click();document.body.removeChild(a);
            }
            URL.revokeObjectURL(url);
          }}>CSV</button>
        </div>
      }>
        <div style={{padding:'10px 12px'}}>
          <div style={{fontSize:9,color:C.mutedLight,marginBottom:8}}>Showing last {historyHours} hours · {(bot?.equityCurve||[]).length} equity points · {logs.length} log entries · {terminalLines.length} terminal lines</div>
          {bot?.decisions&&bot.decisions.length>0?(
            <div style={{maxHeight:200,overflowY:'auto'}}>
              {bot.decisions.filter((d:{timestamp:string})=>{
                const t=new Date(d.timestamp).getTime();
                return t>=Date.now()-historyHours*3600000;
              }).slice(0,20).map((d:{id:string;symbol:string;direction:string;confidence:number;price:number;timestamp:string;outcome:string;pnlPercent:number|null},i:number)=>(
                <div key={d.id||i} style={{display:'flex',gap:8,padding:'5px 0',borderBottom:`1px solid ${C.border}`,fontSize:9,alignItems:'center'}}>
                  <span style={{color:C.mutedLight,whiteSpace:'nowrap'}}>{ft(d.timestamp)}</span>
                  <span style={{fontWeight:700,color:C.white}}>{d.symbol}</span>
                  <span style={{fontWeight:700,color:d.direction==='BUY'?C.green:d.direction==='SELL'?C.red:C.yellow}}>{d.direction}</span>
                  <span style={{color:C.blue}}>{Math.round(d.confidence*100)}%</span>
                  <span style={{color:d.outcome==='WIN'?C.green:d.outcome==='LOSS'?C.red:C.mutedLight}}>{d.outcome}</span>
                  {d.pnlPercent!=null&&<span style={{color:d.pnlPercent>=0?C.green:C.red,marginLeft:'auto'}}>{d.pnlPercent.toFixed(2)}%</span>}
                </div>
              ))}
            </div>
          ):<div style={{color:C.mutedLight,fontSize:10}}>No decisions in selected timeframe</div>}
        </div>
      </Section>

      {/* ══════════════════════════════════════════
          15. EXISTING ADVANCED PANELS
          ══════════════════════════════════════════ */}
      <PaperBacktestPanel division={selectedDivision ?? undefined} />
      <BacktestTrendPanel />
      <DivisionTunerPanel />
      <SentinelCouplingPanel />
      <DivisionSparklineGrid onSelectDivision={setSelectedDivision} />
      <GladiatorAttributionPanel />

      <div style={{padding:'0 12px'}}>
        <IntelligencePanel defaultSector="ALL" title="Market Intelligence" />
      </div>

      </>}

      <div style={{height:16}}/>
      <BottomNav/>
    </div>
  );
}
