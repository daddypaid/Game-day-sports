from pathlib import Path

patches = {
'gameday-roulette.html': r'''
/* iPhone compact casino play surface */
@media(max-width:430px){
  body{padding-bottom:70px} header{position:relative;padding:7px 9px} h1{font-size:18px}.badge{padding:4px 6px;font-size:8px}
  .account-row{margin-top:4px}.account{font-size:9px}.balance{padding:4px 6px;font-size:11px} main{padding:5px 6px}.nav{display:none}
  .notice,.error,.success{padding:5px 7px;margin-bottom:4px;font-size:9px;border-radius:7px}
  .wheel{width:172px;height:172px;border-width:5px;margin:5px auto 4px}.wheel::before{top:-17px;font-size:20px}.wheel-result{width:66px;height:66px;border-width:3px;font-size:26px}
  .wheel-label{font-size:6px;width:18px;height:12px;margin-left:-9px;margin-top:-6px;transform-origin:center}.roulette-ball{width:8px;height:8px;margin-left:-4px;margin-top:-4px}
  .result-text{font-size:12px;margin-bottom:4px;min-height:15px}.control-card{padding:5px;border-radius:9px}.control-card label,.bet-title{display:none}
  input{height:34px;padding:5px 7px;font-size:16px;border-radius:7px}.chips{gap:3px;margin:4px 0}.chips button{min-height:32px;font-size:9px}
  .outside{grid-template-columns:repeat(6,1fr);gap:3px;margin:4px 0}.outside .bet-button{min-height:31px;font-size:8px;padding:2px}
  .number-grid{grid-template-columns:repeat(12,1fr);gap:2px}.number{min-height:27px;font-size:8px;padding:0;border-width:1px}.number.zero{grid-column:auto}
  .spin{min-height:36px;margin-top:4px;font-size:11px}.history-title{margin:8px 0 4px;font-size:9px}.history{padding:6px;margin-bottom:4px;font-size:9px}
}
''',
'gameday-baccarat.html': r'''
/* iPhone compact casino play surface */
@media(max-width:430px){
  body{padding-bottom:70px} header{position:relative;padding:7px 9px} h1{font-size:18px}.badge{padding:4px 6px;font-size:8px}
  .account-row{margin-top:4px}.account{font-size:9px}.balance{padding:4px 6px;font-size:11px} main{padding:5px 6px}.nav{display:none}
  .notice,.error,.success{padding:5px 7px;margin-bottom:4px;font-size:9px;border-radius:7px}
  .table{min-height:0;padding:5px;border-radius:16px}.table-title{font-size:8px}.side{margin-top:4px;padding:4px!important;border-radius:8px!important}.side-title{font-size:10px;margin-bottom:3px}
  .cards{gap:4px;flex-wrap:nowrap}.card{width:46px;height:64px;padding:3px;border-radius:6px;box-shadow:none}.rank{font-size:11px}.suit{font-size:18px}.total{margin-top:3px;font-size:10px}
  .versus{margin:2px 0;font-size:8px}.result{font-size:11px;margin-top:3px;min-height:14px}.controls{margin-top:4px;padding:5px;border-radius:9px}.controls label{display:none}
  input{height:34px;padding:5px 7px;font-size:16px;border-radius:7px}.quick-bets{grid-template-columns:repeat(4,1fr);gap:3px;margin:4px 0}.quick-bets button{min-height:32px;font-size:9px}
  .bet-options{gap:3px}.bet-btn{min-height:38px;font-size:9px;border-radius:7px}.play-btn{min-height:36px;margin-top:4px;font-size:11px}
  .history-title{margin:8px 0 4px;font-size:9px}.history-item{padding:6px;margin-bottom:4px;font-size:9px}
}
''',
'gameday-slots.html': r'''
/* iPhone compact casino play surface */
@media(max-width:430px){
  body{padding-bottom:70px} header{position:relative;padding:7px 9px} h1{font-size:18px}.badge{padding:4px 6px;font-size:8px}
  .account-row{margin-top:4px}.account{font-size:9px}.balance{padding:4px 6px;font-size:11px} main{padding:5px 6px}.nav{display:none}
  .notice,.error,.success{padding:5px 7px;margin-bottom:4px;font-size:9px;border-radius:7px}
  .machine{padding:7px 6px;border-width:2px;border-radius:15px}.machine-title{font-size:15px;margin-bottom:5px}.reels{gap:4px}.reel{min-height:82px;border-width:2px;border-radius:8px;font-size:40px}
  .result{font-size:12px;margin-top:5px;min-height:15px}.controls{margin-top:4px;padding:5px;border-radius:9px}.controls label{display:none}
  input{height:34px;padding:5px 7px;font-size:16px;border-radius:7px}.chips{gap:3px;margin:4px 0}.chips button{min-height:32px;font-size:9px}.spin{min-height:38px;font-size:12px}
  .paytable{margin-top:5px;padding:5px 7px;border-radius:8px}.pay-row{padding:2px 0;font-size:9px}.history-title{margin:8px 0 4px;font-size:9px}.history-item{padding:6px;margin-bottom:4px;font-size:9px}
}
'''
}

for filename, css in patches.items():
    p=Path(filename)
    text=p.read_text()
    if '/* iPhone compact casino play surface */' in text:
        continue
    pos=text.rfind('</style>')
    if pos < 0:
        raise RuntimeError(f'No closing style tag in {filename}')
    p.write_text(text[:pos] + css + '\n' + text[pos:])
