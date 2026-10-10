/** Photographic European single-zero wheel. Outcomes are supplied by the game service. */
export const EUROPEAN_ROULETTE_ORDER = Object.freeze([0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26]);
export const ROULETTE_RED_NUMBERS = Object.freeze([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const RED = new Set(ROULETTE_RED_NUMBERS);
const STEP = 360 / EUROPEAN_ROULETTE_ORDER.length;
const SVG = 'http://www.w3.org/2000/svg';
const mod = value => ((value % 360) + 360) % 360;
const clamp = value => Math.max(0, Math.min(1, value));
const easeOut = t => 1 - Math.pow(1 - t, 3);
const smooth = t => t * t * (3 - 2 * t);
const colorOf = number => number === 0 ? 'green' : RED.has(number) ? 'red' : 'black';
const point = (radius, degrees) => { const radians = degrees * Math.PI / 180; return [500 + radius * Math.sin(radians), 500 - radius * Math.cos(radians)]; };
function sectorPath(inner, outer, start, end) {
  const a = point(outer, start), b = point(outer, end), c = point(inner, end), d = point(inner, start);
  return `M${a.join(' ')}A${outer} ${outer} 0 0 1 ${b.join(' ')}L${c.join(' ')}A${inner} ${inner} 0 0 0 ${d.join(' ')}Z`;
}
function svgElement(tag, attributes = {}) {
  const node = document.createElementNS(SVG, tag);
  Object.entries(attributes).forEach(([key,value]) => node.setAttribute(key,String(value)));
  return node;
}
function pocketOverlay(id) {
  const svg = svgElement('svg', { viewBox:'0 0 1000 1000', 'aria-hidden':'true' });
  svg.classList.add('gd-roulette-spinner-pockets');
  const defs = svgElement('defs');
  const colors = { red:['#dd241c','#75120d'], black:['#27231c','#070706'], green:['#078451','#024128'] };
  for (const [color,stops] of Object.entries(colors)) {
    const gradient = svgElement('radialGradient', { id:`${id}-${color}`, cx:'50%', cy:'50%', r:'50%' });
    gradient.append(svgElement('stop',{offset:'.6','stop-color':stops[1]}),svgElement('stop',{offset:'1','stop-color':stops[0]}));
    defs.append(gradient);
  }
  const gold = svgElement('linearGradient', {id:`${id}-gold`,x1:'0',y1:'0',x2:'1',y2:'1'});
  [['0','#855018'],['.22','#f8d57e'],['.5','#c78e37'],['.78','#ffeeb5'],['1','#92611e']].forEach(([offset,value]) => gold.append(svgElement('stop',{offset,'stop-color':value})));
  defs.append(gold);svg.append(defs);
  const pockets = [];
  EUROPEAN_ROULETTE_ORDER.forEach((number,index) => {
    const angle = index * STEP;
    const group = svgElement('g',{'data-wheel-number':number,'data-wheel-index':index,'data-pocket-angle':angle});
    group.classList.add('gd-roulette-spinner-pocket');
    const fill = `url(#${id}-${colorOf(number)})`;
    group.append(svgElement('path',{d:sectorPath(312,407,angle-STEP/2,angle+STEP/2),fill,stroke:`url(#${id}-gold)`,'stroke-width':2.4}));
    group.append(svgElement('path',{d:sectorPath(407,493,angle-STEP/2,angle+STEP/2),fill,stroke:`url(#${id}-gold)`,'stroke-width':2.4}));
    const [x,y] = point(448,angle);
    const text = svgElement('text',{x,y,transform:`rotate(${angle} ${x} ${y})`});
    text.classList.add('gd-roulette-spinner-number');text.textContent=String(number);group.append(text);
    svg.append(group);pockets.push(group);
  });
  for (const [radius,width] of [[312,7],[407,7],[493,7]]) svg.append(svgElement('circle',{cx:500,cy:500,r:radius,fill:'none',stroke:`url(#${id}-gold)`,'stroke-width':width}));
  return {svg,pockets};
}

let instanceCounter = 0;
export function createRouletteSpinner(element, options = {}) {
  if (!(element instanceof Element)) throw new TypeError('A Roulette wheel element is required.');
  const centerX = Number(options.centerX ?? element.dataset.wheelCenterX ?? .5);
  const centerY = Number(options.centerY ?? element.dataset.wheelCenterY ?? .476);
  const rotorRatio = Number(options.rotorRatio ?? element.dataset.rotorRatio ?? .716);
  if (![centerX,centerY,rotorRatio].every(Number.isFinite) || rotorRatio <= 0 || rotorRatio > 1 || centerX < rotorRatio/2 || centerX > 1-rotorRatio/2 || centerY < rotorRatio/2 || centerY > 1-rotorRatio/2) throw new TypeError('Invalid Roulette wheel geometry.');
  const bowlSrc = options.bowlSrc || element.dataset.bowlSrc || 'assets/roulette/wheel.webp';
  const rotorSrc = options.rotorSrc || element.dataset.rotorSrc || bowlSrc;
  const duration = Number.isFinite(Number(options.durationMs)) ? Math.max(600,Math.min(12000,Number(options.durationMs))) : 5200;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  element.classList.add('gd-roulette-spinner');
  element.setAttribute('role','img');
  element.setAttribute('aria-label','European single-zero Roulette wheel');
  const plane = document.createElement('div');plane.className='gd-roulette-spinner-plane';
  const bowl = document.createElement('img');bowl.className='gd-roulette-spinner-bowl';bowl.src=bowlSrc;bowl.alt='';bowl.width=bowl.height=1254;bowl.draggable=false;
  const rotor = document.createElement('div');rotor.className='gd-roulette-spinner-rotor';
  const left = centerX-rotorRatio/2, top=centerY-rotorRatio/2;
  rotor.style.cssText=`left:${left*100}%;top:${top*100}%;width:${rotorRatio*100}%;height:${rotorRatio*100}%`;
  const photo = document.createElement('img');photo.className='gd-roulette-spinner-rotor-photo';photo.src=rotorSrc;photo.alt='';photo.draggable=false;
  photo.style.cssText=`width:${100/rotorRatio}%;height:${100/rotorRatio}%;left:${-left/rotorRatio*100}%;top:${-top/rotorRatio*100}%`;
  const {svg,pockets} = pocketOverlay(`gd-roulette-${++instanceCounter}`);
  rotor.append(photo,svg);
  const ball=document.createElement('div');ball.className='gd-roulette-spinner-ball';ball.hidden=true;ball.setAttribute('aria-hidden','true');
  const light=document.createElement('div');light.className='gd-roulette-spinner-track-light';
  plane.append(bowl,rotor,ball,light);element.append(plane);
  let frame=0,mode='idle',destroyed=false,rotorAngle=0,ballAngle=0,startedAt=0,previousAt=0,resolveSpin=null;
  const trackRadius=.422;
  const pocketRadius=rotorRatio/2 * .716;
  function paint(radius=trackRadius) {
    rotor.style.transform=`rotate(${rotorAngle}deg)`;
    const radians=ballAngle*Math.PI/180;
    ball.style.left=`${(centerX+radius*Math.sin(radians))*100}%`;
    ball.style.top=`${(centerY-radius*Math.cos(radians))*100}%`;
    element.dataset.rotorAngle=String(rotorAngle);
    element.dataset.ballAngle=String(ballAngle);
    element.dataset.ballRadius=String(radius);
  }
  function stop() {
    cancelAnimationFrame(frame);frame=0;
    if(resolveSpin){const finish=resolveSpin;resolveSpin=null;finish(false);}
  }
  function state(next){mode=next;element.dataset.spinnerState=next;element.setAttribute('aria-busy',String(next==='waiting'||next==='spinning'));}
  function validate(number){if(!Number.isInteger(number)||number<0||number>36)throw new RangeError('Roulette outcome must be an integer from 0 to 36.');if(destroyed)throw new Error('Roulette spinner has been destroyed.');}
  function finish(number) {
    const index=EUROPEAN_ROULETTE_ORDER.indexOf(number);
    pockets.forEach(p=>p.removeAttribute('data-winning'));
    pockets[index].dataset.winning='true';
    element.dataset.winningNumber=String(number);
    element.dataset.winningIndex=String(index);
    element.dataset.winningColor=colorOf(number);
    element.setAttribute('aria-label',`Roulette result: ${number}, ${colorOf(number)}`);
    state('settled');
  }
  function reset(){stop();if(destroyed)return;rotorAngle=0;ballAngle=0;ball.hidden=true;pockets.forEach(p=>p.removeAttribute('data-winning'));delete element.dataset.winningNumber;delete element.dataset.winningIndex;delete element.dataset.winningColor;state('idle');element.setAttribute('aria-label','European single-zero Roulette wheel');paint();}
  function show(number){validate(number);stop();const index=EUROPEAN_ROULETTE_ORDER.indexOf(number);rotorAngle=mod(180-index*STEP);ballAngle=180;ball.hidden=false;paint(pocketRadius);finish(number);return true;}
  function start(){if(destroyed)return false;stop();pockets.forEach(p=>p.removeAttribute('data-winning'));delete element.dataset.winningNumber;delete element.dataset.winningIndex;delete element.dataset.winningColor;ball.hidden=false;state('waiting');element.setAttribute('aria-label','Roulette wheel spinning. Waiting for the result.');previousAt=performance.now();
    if(reduced.matches){paint(trackRadius);return true;}
    const tick=now=>{if(destroyed||mode!=='waiting')return;const elapsed=Math.min(64,Math.max(0,now-previousAt));previousAt=now;rotorAngle+=elapsed*.26;ballAngle-=elapsed*.85;paint(trackRadius);frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return true;}
  function spin(number){validate(number);if(reduced.matches)return Promise.resolve(show(number));stop();ball.hidden=false;state('spinning');element.setAttribute('aria-label','Roulette wheel spinning.');pockets.forEach(p=>p.removeAttribute('data-winning'));delete element.dataset.winningNumber;
    const index=EUROPEAN_ROULETTE_ORDER.indexOf(number),r0=rotorAngle,b0=ballAngle;
    const target=r0+4*360+mod(180-index*STEP-r0);
    const catchAt=.82,rotorAtCatch=r0+(target-r0)*easeOut(catchAt),catchAngle=index*STEP+rotorAtCatch;
    const freeBallTarget=b0-7*360-mod(b0-catchAngle);
    startedAt=performance.now();
    return new Promise(resolve=>{resolveSpin=resolve;const tick=now=>{if(destroyed||mode!=='spinning')return;const t=clamp((now-startedAt)/duration);rotorAngle=r0+(target-r0)*easeOut(t);
      ballAngle=t<catchAt?b0+(freeBallTarget-b0)*easeOut(t/catchAt):freeBallTarget+(rotorAngle-rotorAtCatch);
      const drop=clamp((t-.58)/.24),bounce=Math.sin(drop*Math.PI*5)*.009*Math.pow(1-drop,2);
      const radius=trackRadius+(pocketRadius-trackRadius)*smooth(drop)+bounce;
      if(t>=catchAt){const decay=1-clamp((t-catchAt)/(1-catchAt));ballAngle+=Math.sin((t-catchAt)*Math.PI*48)*decay*1.4;}
      paint(radius);
      if(t<1){frame=requestAnimationFrame(tick);return;}
      rotorAngle=target;ballAngle=freeBallTarget+(target-rotorAtCatch);paint(pocketRadius);finish(number);frame=0;const finishPromise=resolveSpin;resolveSpin=null;finishPromise?.(true);
    };frame=requestAnimationFrame(tick);});
  }
  function destroy(){stop();destroyed=true;plane.remove();element.classList.remove('gd-roulette-spinner');element.removeAttribute('aria-busy');delete element.dataset.spinnerState;}
  reset();
  return Object.freeze({start,spin,settle:spin,show,reset,cancel:reset,destroy});
}
