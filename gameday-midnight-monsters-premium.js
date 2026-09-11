(()=>{
  if(document.body.dataset.game!=='midnight-monsters')return;
  const $=id=>document.getElementById(id);
  const spin=$('spin'),grid=$('grid'),result=$('result'),plus=$('plus'),minus=$('minus');
  if(!spin||!grid||!result)return;

  let audioCtx=null,muted=localStorage.getItem('gameday-mm-muted')==='1',unlocked=false;
  let autoRemaining=0,autoTimer=null,lastResult='',lastSpinStart=0;

  function ensureAudio(){
    if(muted)return null;
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(!Ctx)return null;
    if(!audioCtx)audioCtx=new Ctx();
    if(audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});
    unlocked=true;return audioCtx;
  }
  function tone(freq=440,dur=.08,type='sine',gain=.045,delay=0){
    const ctx=ensureAudio();if(!ctx)return;
    const t=ctx.currentTime+delay,o=ctx.createOscillator(),g=ctx.createGain();
    o.type=type;o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(.0002,gain),t+.01);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    o.connect(g);g.connect(ctx.destination);o.start(t);o.stop(t+dur+.03);
  }
  function noise(dur=.08,gain=.025,delay=0){
    const ctx=ensureAudio();if(!ctx)return;
    const len=Math.max(1,Math.floor(ctx.sampleRate*dur)),b=ctx.createBuffer(1,len,ctx.sampleRate),d=b.getChannelData(0);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*(1-i/len);
    const s=ctx.createBufferSource(),g=ctx.createGain();s.buffer=b;g.gain.value=gain;s.connect(g);g.connect(ctx.destination);s.start(ctx.currentTime+delay);
  }
  function sfx(kind){
    if(muted||!unlocked)return;
    if(kind==='tap'){tone(280,.045,'triangle',.025)}
    else if(kind==='spin'){tone(95,.18,'sawtooth',.035);tone(145,.2,'triangle',.025,.03);noise(.18,.018)}
    else if(kind==='stop'){tone(120,.05,'square',.02);tone(75,.07,'triangle',.02,.018)}
    else if(kind==='win'){[523,659,784].forEach((f,i)=>tone(f,.13,'triangle',.04,i*.08))}
    else if(kind==='big'){[392,523,659,784,1047].forEach((f,i)=>tone(f,.22,'sine',.055,i*.09))}
    else if(kind==='bonus'){[220,330,440,660,880].forEach((f,i)=>tone(f,.28,'sawtooth',.04,i*.11))}
  }

  function injectUi(){
    const sound=document.createElement('button');sound.type='button';sound.className='mm-sound'+(muted?' muted':'');sound.setAttribute('aria-label',muted?'Turn sound on':'Mute sound');sound.textContent=muted?'🔇':'🔊';
    sound.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();muted=!muted;localStorage.setItem('gameday-mm-muted',muted?'1':'0');sound.classList.toggle('muted',muted);sound.textContent=muted?'🔇':'🔊';sound.setAttribute('aria-label',muted?'Turn sound on':'Mute sound');if(!muted){ensureAudio();sfx('tap')}});document.body.appendChild(sound);
    const controls=document.querySelector('.controls');if(controls&&!document.querySelector('.mm-tools')){const tools=document.createElement('div');tools.className='mm-tools';tools.innerHTML='<button type="button" class="mm-tool" id="mmAuto">AUTO ×5</button><button type="button" class="mm-tool" id="mmMax">MAX BET</button>';controls.insertAdjacentElement('afterend',tools);
      $('mmMax').addEventListener('click',()=>{ensureAudio();sfx('tap');if(spin.disabled)return;for(let i=0;i<12;i++){if(!plus.disabled)plus.click()}});
      $('mmAuto').addEventListener('click',()=>{ensureAudio();sfx('tap');if(autoRemaining){stopAuto();return}autoRemaining=5;$('mmAuto').classList.add('active');$('mmAuto').textContent='STOP AUTO';if(!spin.disabled)spin.click()});
    }
    const big=document.createElement('div');big.className='mm-bigwin';big.id='mmBigWin';big.innerHTML='<div class="mm-bigwin-card"><small>MIDNIGHT MONSTERS</small><strong id="mmBigWinValue">BIG WIN</strong><div style="margin-top:12px;color:#b8c7bd;font-size:11px">Tap to continue</div></div>';big.addEventListener('click',()=>big.classList.remove('show'));document.body.appendChild(big);
  }

  function startVisualSpin(){
    lastSpinStart=Date.now();document.body.classList.add('mm-spinning');
  }
  function settleVisuals(){
    document.body.classList.remove('mm-spinning');
    const cells=[...grid.querySelectorAll('.cell')];cells.forEach(c=>c.classList.add('mm-settle'));
    [0,.12,.24,.36,.48].forEach((d,i)=>setTimeout(()=>sfx('stop'),Math.round(d*1000)+40));
    setTimeout(()=>cells.forEach(c=>c.classList.remove('mm-settle')),950);
  }
  function parseMoney(text){const m=String(text||'').replace(/,/g,'').match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);return m?Number(m[1]):0}
  function onResolved(text){
    if(Date.now()-lastSpinStart<120){return}
    settleVisuals();
    const upper=text.toUpperCase(),win=parseMoney(text);
    if(upper.includes('BONUS')||upper.includes('FREE SPIN'))sfx('bonus');
    else if(win>=100){sfx('big');const o=$('mmBigWin');const v=$('mmBigWinValue');if(o&&v){v.textContent='BIG WIN • '+text.replace(/^.*?•\s*/,'');o.classList.add('show');setTimeout(()=>o.classList.remove('show'),2600)}}
    else if(upper.includes('WIN'))sfx('win');
    if(autoRemaining>0){autoRemaining--;if(autoRemaining<=0){stopAuto();return}clearTimeout(autoTimer);autoTimer=setTimeout(()=>{if(!spin.disabled)spin.click();else autoTimer=setTimeout(()=>{if(!spin.disabled)spin.click()},700)},1150)}
  }
  function stopAuto(){autoRemaining=0;clearTimeout(autoTimer);const a=$('mmAuto');if(a){a.classList.remove('active');a.textContent='AUTO ×5'}}

  document.addEventListener('pointerdown',e=>{ensureAudio();const t=e.target;if(t===plus||t===minus||t?.closest?.('.step button'))sfx('tap')},{passive:true,capture:true});
  spin.addEventListener('click',()=>{if(spin.disabled)return;ensureAudio();sfx('spin');startVisualSpin()},{capture:true});

  const resultObs=new MutationObserver(()=>{const text=result.textContent.trim();if(!text||text===lastResult)return;lastResult=text;const low=text.toLowerCase();if(low.includes('spinning')||low.includes('free spin…')||low.includes('free spin...')){startVisualSpin();return}if(low.includes('unavailable')){document.body.classList.remove('mm-spinning');stopAuto();return}onResolved(text)});resultObs.observe(result,{childList:true,subtree:true,characterData:true});
  const spinObs=new MutationObserver(()=>{if(!spin.disabled&&document.body.classList.contains('mm-spinning')&&Date.now()-lastSpinStart>2500){settleVisuals()}});spinObs.observe(spin,{attributes:true,attributeFilter:['disabled']});

  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopAuto();document.body.classList.remove('mm-spinning')}});
  window.addEventListener('pagehide',()=>{stopAuto();try{audioCtx?.close()}catch{}});
  injectUi();
})();
