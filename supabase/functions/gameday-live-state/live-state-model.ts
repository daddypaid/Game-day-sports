// Explicit league routes prevent games from a different competition borrowing a clock.
export type Route = { path: string; kind: 'football'|'basketball'|'hockey'|'soccer'|'baseball'|'tennis'|'combat'; preseason?: boolean; tournament?: string }
const aliases: Record<string,string> = {
  nfl:'americanfootball_nfl', football:'americanfootball_nfl', ncaaf:'americanfootball_ncaaf',
  nba:'basketball_nba', basketball:'basketball_nba', wnba:'basketball_wnba', ncaab:'basketball_ncaab',
  nhl:'icehockey_nhl', hockey:'icehockey_nhl', mlb:'baseball_mlb', baseball:'baseball_mlb',
  mls:'soccer_usa_mls', epl:'soccer_epl', ucl:'soccer_uefa_champs_league',
}
const routes: Record<string,Route> = {
  americanfootball_nfl:{path:'football/nfl',kind:'football'},
  americanfootball_nfl_preseason:{path:'football/nfl',kind:'football',preseason:true},
  americanfootball_ncaaf:{path:'football/college-football',kind:'football'},
  americanfootball_cfl:{path:'football/cfl',kind:'football'},
  americanfootball_ufl:{path:'football/ufl',kind:'football'},
  basketball_nba:{path:'basketball/nba',kind:'basketball'},
  basketball_nba_preseason:{path:'basketball/nba',kind:'basketball',preseason:true},
  basketball_wnba:{path:'basketball/wnba',kind:'basketball'},
  basketball_ncaab:{path:'basketball/mens-college-basketball',kind:'basketball'},
  basketball_wncaab:{path:'basketball/womens-college-basketball',kind:'basketball'},
  basketball_euroleague:{path:'basketball/euroleague',kind:'basketball'},
  basketball_nbl:{path:'basketball/nbl',kind:'basketball'},
  icehockey_nhl:{path:'hockey/nhl',kind:'hockey'},
  icehockey_nhl_preseason:{path:'hockey/nhl',kind:'hockey',preseason:true},
  baseball_mlb:{path:'baseball/mlb',kind:'baseball'},
  baseball_mlb_preseason:{path:'baseball/mlb',kind:'baseball',preseason:true},
  soccer_argentina_primera_division:{path:'soccer/arg.1',kind:'soccer'},
  soccer_australia_aleague:{path:'soccer/aus.1',kind:'soccer'},
  soccer_austria_bundesliga:{path:'soccer/aut.1',kind:'soccer'},
  soccer_belgium_first_div:{path:'soccer/bel.1',kind:'soccer'},
  soccer_brazil_campeonato:{path:'soccer/bra.1',kind:'soccer'},
  soccer_brazil_serie_b:{path:'soccer/bra.2',kind:'soccer'},
  soccer_chile_campeonato:{path:'soccer/chi.1',kind:'soccer'},
  soccer_china_superleague:{path:'soccer/chn.1',kind:'soccer'},
  soccer_denmark_superliga:{path:'soccer/den.1',kind:'soccer'},
  soccer_efl_champ:{path:'soccer/eng.2',kind:'soccer'},
  soccer_england_efl_cup:{path:'soccer/eng.league_cup',kind:'soccer'},
  soccer_england_league1:{path:'soccer/eng.3',kind:'soccer'},
  soccer_england_league2:{path:'soccer/eng.4',kind:'soccer'},
  soccer_epl:{path:'soccer/eng.1',kind:'soccer'},
  soccer_fa_cup:{path:'soccer/eng.fa',kind:'soccer'},
  soccer_fifa_world_cup:{path:'soccer/fifa.world',kind:'soccer'},
  soccer_fifa_world_cup_qualifiers_europe:{path:'soccer/fifa.worldq.uefa',kind:'soccer'},
  soccer_fifa_world_cup_qualifiers_south_america:{path:'soccer/fifa.worldq.conmebol',kind:'soccer'},
  soccer_fifa_world_cup_womens:{path:'soccer/fifa.wwc',kind:'soccer'},
  soccer_fifa_club_world_cup:{path:'soccer/fifa.cwc',kind:'soccer'},
  soccer_france_coupe_de_france:{path:'soccer/fra.coupe_de_france',kind:'soccer'},
  soccer_france_ligue_one:{path:'soccer/fra.1',kind:'soccer'},
  soccer_france_ligue_two:{path:'soccer/fra.2',kind:'soccer'},
  soccer_germany_bundesliga:{path:'soccer/ger.1',kind:'soccer'},
  soccer_germany_bundesliga2:{path:'soccer/ger.2',kind:'soccer'},
  soccer_germany_dfb_pokal:{path:'soccer/ger.dfb_pokal',kind:'soccer'},
  soccer_greece_super_league:{path:'soccer/gre.1',kind:'soccer'},
  soccer_italy_coppa_italia:{path:'soccer/ita.coppa_italia',kind:'soccer'},
  soccer_italy_serie_a:{path:'soccer/ita.1',kind:'soccer'},
  soccer_italy_serie_b:{path:'soccer/ita.2',kind:'soccer'},
  soccer_japan_j_league:{path:'soccer/jpn.1',kind:'soccer'},
  soccer_mexico_ligamx:{path:'soccer/mex.1',kind:'soccer'},
  soccer_netherlands_eredivisie:{path:'soccer/ned.1',kind:'soccer'},
  soccer_norway_eliteserien:{path:'soccer/nor.1',kind:'soccer'},
  soccer_portugal_primeira_liga:{path:'soccer/por.1',kind:'soccer'},
  soccer_russia_premier_league:{path:'soccer/rus.1',kind:'soccer'},
  soccer_spain_la_liga:{path:'soccer/esp.1',kind:'soccer'},
  soccer_spain_copa_del_rey:{path:'soccer/esp.copa_del_rey',kind:'soccer'},
  soccer_spain_segunda_division:{path:'soccer/esp.2',kind:'soccer'},
  soccer_saudi_arabia_pro_league:{path:'soccer/ksa.1',kind:'soccer'},
  soccer_spl:{path:'soccer/sco.1',kind:'soccer'},
  soccer_sweden_allsvenskan:{path:'soccer/swe.1',kind:'soccer'},
  soccer_turkey_super_league:{path:'soccer/tur.1',kind:'soccer'},
  soccer_uefa_europa_conference_league:{path:'soccer/uefa.europa.conf',kind:'soccer'},
  soccer_uefa_champs_league:{path:'soccer/uefa.champions',kind:'soccer'},
  soccer_uefa_champs_league_qualification:{path:'soccer/uefa.champions_qual',kind:'soccer'},
  soccer_uefa_champs_league_women:{path:'soccer/uefa.wchampions',kind:'soccer'},
  soccer_uefa_europa_league:{path:'soccer/uefa.europa',kind:'soccer'},
  soccer_uefa_european_championship:{path:'soccer/uefa.euro',kind:'soccer'},
  soccer_uefa_euro_qualification:{path:'soccer/uefa.euroq',kind:'soccer'},
  soccer_uefa_nations_league:{path:'soccer/uefa.nations',kind:'soccer'},
  soccer_concacaf_leagues_cup:{path:'soccer/concacaf.leagues.cup',kind:'soccer'},
  soccer_conmebol_copa_america:{path:'soccer/conmebol.america',kind:'soccer'},
  soccer_conmebol_copa_libertadores:{path:'soccer/conmebol.libertadores',kind:'soccer'},
  soccer_conmebol_copa_sudamericana:{path:'soccer/conmebol.sudamericana',kind:'soccer'},
  soccer_usa_mls:{path:'soccer/usa.1',kind:'soccer'},
  mma_mixed_martial_arts:{path:'mma/ufc',kind:'combat'},
}
export function clean(value:unknown):string { return String(value??'').trim() }
export function normalizeName(value:unknown):string { return clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\b(fc|cf|sc|club|team)\b/g,' ').replace(/\s+/g,' ').trim() }
export function finite(value:unknown):number|null { if(!['number','string'].includes(typeof value)||clean(value)==='')return null;const n=Number(value);return Number.isFinite(n)?n:null }
export function routeFor(sport:string):Route|null {
  const named=routes[aliases[sport]??sport];if(named)return named;
  const tennis=sport.match(/^tennis_(atp|wta)(?:_([a-z0-9_]+))?$/);
  return tennis?{path:`tennis/${tennis[1]}`,kind:'tennis',tournament:tennis[2]?normalizeName(tennis[2].replaceAll('_',' ')):undefined}:null;
}
function ordinal(n:number):string { const m=n%100;return `${n}${m>=11&&m<=13?'th':n%10===1?'st':n%10===2?'nd':n%10===3?'rd':'th'}` }
function countdown(value:unknown):string|null {
  const v=clean(value),match=v.match(/^(\d{1,3}):([0-5]\d)(\.\d{1,2})?$/);
  if(match)return `${match[1].padStart(2,'0')}:${match[2]}${match[3]??''}`;
  // ESPN supplies fractional seconds directly at the end of a basketball period.
  if(/^\d{1,2}\.\d{1,2}$/.test(v)&&Number(v)<60){const [s,f]=v.split('.');return `00:${s.padStart(2,'0')}.${f}`}
  return null;
}
function elapsed(value:unknown):string|null {
  const m=clean(value).replace(/[′’]/g,"'").match(/^(\d{1,3})'(?:\s*\+\s*(\d{1,2})'?)?$/);
  return m?`${m[1]}′${m[2]?` + ${m[2]}′`:''}`:null;
}
function statusLabel(type:any):string|null {
  if(/HALFTIME|END_PERIOD|INTERMISSION|DELAY|RAIN|SUSPEND|SHOOTOUT|PENALT/.test(clean(type?.name)))return clean(type?.description)||clean(type?.shortDetail)||null;
  const detail=clean(type?.detail);
  return /^(?:End of|End |Half ?time|Intermission|Delayed|Rain delay)/i.test(detail)?detail:null;
}
function teamName(c:any):string { return clean(c?.team?.displayName??c?.athlete?.displayName??c?.athlete?.fullName) }
function teamAliases(c:any):string[] {
  // Full name/location only; nickname-only aliases can collide across teams.
  return [...new Set([teamName(c),clean(c?.team?.location)].filter(Boolean).map(normalizeName))];
}
export function mapEspnEvent(event:any,route:Route,sport:string,fetchedAt:string):any[] {
  if(route.tournament&&![event?.name,event?.shortName].some(n=>normalizeName(n)===route.tournament))return [];
  const competitions=route.kind==='tennis'
    ?(event?.groupings??[]).filter((g:any)=>g?.grouping?.slug===(route.path.endsWith('/wta')?'womens-singles':'mens-singles')).flatMap((g:any)=>g.competitions??[])
    :Array.isArray(event?.competitions)?event.competitions:[];
  return competitions.flatMap((c:any)=>{
    const status=c?.status??event?.status??{},type=status?.type??{};
    if(type.state!=='in'||type.completed===true||/CANCEL|POSTPON|FINAL|SCHEDULED/.test(clean(type.name)))return [];
    if(route.preseason&&finite(event?.season?.type)!==1)return [];
    const competitors=Array.isArray(c?.competitors)?c.competitors:[];
    let home=competitors.find((x:any)=>x.homeAway==='home'),away=competitors.find((x:any)=>x.homeAway==='away');
    if(route.kind==='combat'||route.kind==='tennis'){if(competitors.length!==2)return [];[home,away]=competitors}
    if(!home||!away||!teamName(home)||!teamName(away))return [];
    const p=finite(status.period),reg=finite(c?.format?.regulation?.periods),breakLabel=statusLabel(type);
    let period:string|null=null,clock:string|null=null,kind:string='countdown';
    if(breakLabel){period=breakLabel;kind='status'}
    else if(route.kind==='soccer'){period=clean(type.description)||null;clock=elapsed(status.displayClock);kind='elapsed'}
    else if(route.kind==='baseball'){
      const detail=clean(type.shortDetail)||clean(type.detail);
      // A half-inning must be explicit; never infer it from the innings score.
      period=/^(?:Top|Bot|Bottom|Mid|Middle|End)\s+\d+(?:st|nd|rd|th)?$/i.test(detail)?detail:null;kind='inning';
    }else if(route.kind==='tennis'){period=p!==null&&Number.isInteger(p)&&p>0?`Set ${p}`:null;kind='status'}
    else if(p!==null&&Number.isInteger(p)&&p>0){
      const regulation=reg??(route.kind==='hockey'?3:route.path.endsWith('mens-college-basketball')?2:route.kind==='combat'?null:4);
      period=route.kind==='combat'?`Round ${p}`:regulation!==null&&p>regulation?(p-regulation===1?'OT':`${p-regulation}OT`):route.kind==='hockey'?`P${p}`:regulation===2?`H${p}`:`Q${p}`;
      clock=countdown(status.displayClock);
    }
    const start=clean(c.date??event.date),eventStart=Number.isFinite(Date.parse(start))?new Date(start).toISOString():null;
    return [{provider:'espn',provider_event_id:clean(c.id??event.id),sport,event_start:eventStart,
      home_team:teamName(home),away_team:teamName(away),home_key:normalizeName(teamName(home)),away_key:normalizeName(teamName(away)),
      home_aliases:teamAliases(home),away_aliases:teamAliases(away),home_score:finite(home.score),away_score:finite(away.score),
      period,clock,clock_kind:kind,clock_verified:clock!==null,period_verified:period!==null,
      status_short:clean(type.name)||null,status_long:clean(type.description)||null,live:true,completed:false,fetched_at:fetchedAt}];
  });
}
export function mapMlbGame(game:any,sport:string,fetchedAt:string,preseason=false):any|null {
  if(game?.status?.abstractGameState!=='Live'||(preseason&&game.gameType!=='S'))return null;
  const home=game?.teams?.home,away=game?.teams?.away;if(!clean(home?.team?.name)||!clean(away?.team?.name))return null;
  const lines=game?.linescore??{},inning=finite(lines.currentInning),half=clean(lines.inningState),detail=clean(game?.status?.detailedState);
  let period=inning!==null&&Number.isInteger(inning)&&inning>0&&['Top','Bottom','Middle','End'].includes(half)?`${half==='Bottom'?'Bot':half} ${ordinal(inning)}`:null;
  let kind='inning';if(/delay|suspend|rain/i.test(detail)){period=detail;kind='status'}
  const start=clean(game.gameDate);
  return {provider:'mlb',provider_event_id:clean(game.gamePk),game_pk:clean(game.gamePk),sport,
    event_start:Number.isFinite(Date.parse(start))?new Date(start).toISOString():null,
    home_team:clean(home.team.name),away_team:clean(away.team.name),home_key:normalizeName(home.team.name),away_key:normalizeName(away.team.name),
    home_score:finite(home.score),away_score:finite(away.score),period,clock:null,clock_kind:kind,clock_verified:false,period_verified:period!==null,
    balls:finite(lines.balls),strikes:finite(lines.strikes),outs:finite(lines.outs),
    bases:{first:Boolean(lines.offense?.first),second:Boolean(lines.offense?.second),third:Boolean(lines.offense?.third)},
    status_short:clean(game.status.codedGameState)||null,status_long:detail||null,live:true,completed:false,fetched_at:fetchedAt};
}
export function withoutCurrentTime(payload:any):any {
  return {...payload,stale:true,warning:'Live time is temporarily unavailable.',states:(payload?.states??[]).map((s:any)=>({...s,stale:true,period:null,clock:null,clock_verified:false,period_verified:false}))};
}
