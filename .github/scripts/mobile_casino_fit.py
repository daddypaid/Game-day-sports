from pathlib import Path

patches = {
    'gameday-video-poker.html': '''
/* iPhone compact play surface */
@media(max-width:430px){
  body{padding-bottom:70px;min-height:0} header{position:relative}
  .top{padding:7px 9px 6px;gap:6px}.title h1{font-size:18px}.title div{font-size:9px;margin-top:2px}
  .wallet{padding:5px 7px;border-radius:9px}.wallet span{font-size:8px}.wallet strong{font-size:12px;margin-top:1px}
  main{padding:5px 6px}.status{min-height:24px;padding:5px 7px;margin-bottom:4px;font-size:9px;border-radius:7px}
  .table{padding:6px 5px 7px;border-width:2px;border-radius:15px}.marquee{font-size:12px}.sub{display:none}
  .cards{gap:3px;margin-top:6px}.card{height:72px;padding:3px;border-radius:6px;border-width:1px;box-shadow:none}
  .rank{font-size:10px}.suit{font-size:19px}.hold{min-height:25px;margin-top:3px;font-size:8px;border-radius:6px}
  .result{font-size:12px;min-height:15px;margin-top:4px}.paytable{margin-top:4px;padding:4px 6px;border-radius:7px;display:grid;grid-template-columns:1fr 1fr;column-gap:10px}
  .payrow{font-size:8px;padding:1px 0}.payrow:last-child{grid-column:1/-1}
  .controls{margin-top:4px;padding:5px;border-radius:9px}.stake-row{gap:4px;grid-template-columns:72px 1fr}.stake-row label{display:none}.stake-row input{padding:6px;font-size:16px;border-radius:7px;height:34px}
  .chips{gap:3px}.chips button,.actions button{min-height:34px;border-radius:7px;font-size:10px}.actions{gap:4px;margin-top:4px}.back{margin-top:4px;font-size:9px}
}
''',
    'gameday-three-card-poker.html': '''
/* iPhone compact play surface */
@media(max-width:430px){
  body{padding-bottom:70px;min-height:0} header{position:relative}
  .top{padding:7px 9px 6px;gap:6px}.title h1{font-size:18px}.title div{font-size:9px;margin-top:2px}
  .wallet{padding:5px 7px;border-radius:9px}.wallet span{font-size:8px}.wallet strong{font-size:12px;margin-top:1px}
  main{padding:5px 6px}.status{min-height:24px;padding:5px 7px;margin-bottom:4px;font-size:9px;border-radius:7px}
  .table{padding:6px 5px 7px;border-width:2px;border-radius:15px}.marquee{font-size:12px}.rule{font-size:8px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .area{margin-top:4px;padding:4px 5px;border-radius:8px}.area-title{font-size:9px}.cards{gap:4px;margin-top:4px}
  .card{height:64px;padding:3px;border-radius:6px;border-width:1px;box-shadow:none}.card.back{font-size:17px}.rank{font-size:9px}.suit{font-size:18px}
  .result{font-size:11px;min-height:14px;margin-top:4px}.decision{margin-top:4px;padding:5px;border-radius:9px}
  .stake-row{gap:4px;grid-template-columns:72px 1fr}.stake-row label{display:none}.stake-row input{padding:6px;font-size:16px;border-radius:7px;height:34px}
  .chips{gap:3px}.chips button,.actions button{min-height:34px;border-radius:7px;font-size:10px}.actions{gap:4px;margin-top:4px}.backlink{margin-top:4px;font-size:9px}
}
''',
    'gameday-blackjack.html': '''
/* iPhone compact play surface */
@media(max-width:430px){
  body{padding-bottom:70px} header{position:relative;padding:7px 9px} h1{font-size:18px}.badge{padding:4px 6px;font-size:8px}
  .account-row{margin-top:4px}.account{font-size:9px}.balance{padding:4px 6px;font-size:11px} main{padding:5px 6px}.nav{display:none}
  .notice{padding:5px 7px;margin-bottom:4px;font-size:9px;border-radius:7px}.error,.success{padding:5px 7px;margin-bottom:4px;font-size:9px;border-radius:7px}
  .table{min-height:0;border-radius:16px;padding:5px;border-width:2px}.table-label{font-size:8px;margin-bottom:2px}.hand-area{min-height:94px}.hand-title{font-size:10px;margin-bottom:4px}
  .cards{gap:4px;flex-wrap:nowrap}.card{width:46px;height:64px;padding:3px;border-radius:6px;box-shadow:none}.card-rank{font-size:11px}.card-suit{font-size:18px}.card.hidden-card{font-size:18px}
  .total{margin-top:3px;font-size:10px}.divider{margin:3px 0}.control-card{margin-top:4px;padding:5px;border-radius:9px}.control-card label{display:none}
  input{height:34px;padding:5px 7px;font-size:16px;border-radius:7px}.quick-bets{grid-template-columns:repeat(4,1fr);gap:3px;margin-top:4px}.actions{gap:4px;margin-top:4px}
  button,.quick-bets button{min-height:34px;font-size:10px;border-radius:7px}.result-card{margin-top:4px;padding:5px 7px;border-radius:8px}.result-title{font-size:11px}.result-row{margin-top:2px;font-size:9px}
  .history-title{margin:8px 0 4px;font-size:9px}.history-item{padding:6px;margin-bottom:4px;font-size:9px}
}
'''
}

for filename, css in patches.items():
    p = Path(filename)
    text = p.read_text()
    if '/* iPhone compact play surface */' in text:
        continue
    pos = text.rfind('</style>')
    if pos < 0:
        raise RuntimeError(f'No closing style tag in {filename}')
    p.write_text(text[:pos] + css + '\n' + text[pos:])
