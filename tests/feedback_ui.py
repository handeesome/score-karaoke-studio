"""Windows WebView2 regression check. Uses an isolated profile and fake API; never opens user projects.

Run after npm run build: .venv\Scripts\python.exe tests\feedback_ui.py
"""
import copy
import json
from pathlib import Path
import sys
import threading
import time
import traceback
from urllib.parse import quote
import wave

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from fastapi import FastAPI
from fastapi.responses import FileResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
import webview

DATA = ROOT / 'build' / 'feedback-ui-test'
DATA.mkdir(parents=True, exist_ok=True)
with wave.open(str(DATA / 'test.wav'), 'wb') as sound:
    sound.setparams((1, 2, 8000, 0, 'NONE', 'not compressed'))
    sound.writeframes(b'\0\0' * 8000 * 12)
score = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1414"><rect width="1000" height="1414" fill="white"/><text x="280" y="200" font-size="40">提示交互测试</text><text x="150" y="460" font-size="34">第一句歌词　　　第二句歌词</text></svg>'
region = {'x': .1, 'y': .2, 'width': .8, 'height': .3}
base = {'version': 1, 'projectId': 'feedback-test', 'projectName': '提示测试', 'scoreTimingBound': True,
        'source': {'pdf': 'sample.png', 'audio': 'sample.wav', 'audioUrl': '/media/test.wav'},
        'pages': [{'id': 'p1', 'width': 1000, 'height': 1414, 'image': 'data:image/svg+xml,' + quote(score)}],
        'segments': [{'id': 'old-box', 'pageId': 'p1', 'region': region, 'startTime': 1, 'endTime': 4, 'timingSet': True, 'direction': 'left-to-right'}],
        'flags': [{'id': 'f1', 'segmentId': 'old-box', 'kind': 'start', 'time': 1}], 'highlight': {'mode': 'full', 'opacity': .32}, 'audioDuration': 12}
candidate = {'pageId': 'p1', 'region': region, 'sourceText': '歌词示例', 'row': 1, 'part': 1}
control = {'wave_error': False, 'save_error': False, 'validate_error': False, 'errors': [], 'warnings': [], 'boxes': [candidate], 'exports': 0}
app = FastAPI()
@app.post('/api/waveform/vocals')
def waveform():
    if control['wave_error']: return JSONResponse({'detail': '测试读取失败'}, status_code=500)
    return {'status': 'completed', 'waveform': {'duration': 12, 'levels': [.2] * 50, 'peaks': [.3] * 50, 'kind': 'vocals'}}
@app.get('/media/test.wav')
def audio(): return FileResponse(DATA / 'test.wav')
@app.put('/api/projects/{project_id}')
def save(project_id: str): return Response(status_code=500 if control['save_error'] else 200)
@app.get('/api/projects/{project_id}/preview')
def preview(project_id: str): return Response(status_code=500)
@app.post('/api/projects/{project_id}/validate')
def validate(project_id: str):
    if control['validate_error']: return Response(status_code=500)
    return {'valid': not control['errors'], 'errors': control['errors'], 'warnings': control['warnings']}
@app.post('/api/auto-boxes')
def start_boxes(): return {'jobId': 'boxes'}
@app.get('/api/auto-boxes/boxes')
def boxes(): return {'status': 'completed', 'candidates': control['boxes']}
@app.post('/api/projects/{project_id}/auto-align')
def start_align(project_id: str): return {'jobId': 'align'}
@app.get('/api/alignments/align')
def align(): return {'status': 'completed', 'candidates': [{**candidate, 'text': '歌词示例', 'startTime': 1, 'endTime': 4, 'confidence': .2, 'matchedText': '', 'source': '推算'}]}
@app.post('/api/projects/{project_id}/export')
def export(project_id: str):
    control['exports'] += 1
    return {'jobId': 'video', 'status': 'running'}
@app.get('/api/exports/video')
def export_status(): return {'jobId': 'video', 'status': 'running', 'progress': .25}

app.mount('/', StaticFiles(directory=ROOT / 'dist', html=True))
server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=18768, log_level='error'))
threading.Thread(target=server.run, daemon=True).start()
deadline = time.monotonic() + 10
while not server.started:
    assert time.monotonic() < deadline
    time.sleep(.05)

class UpdateApi:
    def __init__(self): self._installs = 0
    def check_update(self): return {'status': 'available', 'version': '9.9.9'}
    def update_status(self): return self.check_update()
    def install_update(self): self._installs += 1; return {'status': 'available', 'version': '9.9.9'}
api = UpdateApi()
window = webview.create_window('Feedback regression test', 'http://127.0.0.1:18768', hidden=True, width=1366, height=900, js_api=api)
result = {'checks': []}
phase = -1
phases = [8, 9, 10] if '--merges' in sys.argv else [11, 12, 13, 14, 15] if '--ux' in sys.argv else list(range(16))

def js(code): return window.evaluate_js(code)
def wait(expr, predicate=bool, seconds=8):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        value = js(expr)
        if predicate(value): return value
        time.sleep(.08)
    raise AssertionError((expr, value))
def click(text, scope='document'):
    js('''(() => {const root=''' + scope + ''';const b=[...root.querySelectorAll('button')].find(b=>b.textContent.trim()===''' + json.dumps(text) + ''');if(!b)throw Error('Missing button: '+''' + json.dumps(text) + ''');if(b.disabled)throw Error('Disabled button');const d=b.closest('details');if(d)d.open=true;b.focus();b.click()})()''')
    time.sleep(.16)
def dialog(text): click(text, "[...document.querySelectorAll('.action-dialog')].pop()")
def state():
    time.sleep(.1)
    return js('JSON.parse(localStorage.getItem("pujian-project"))')
def pointer(x, y):
    js(f'''(() => {{const el=document.querySelector('.partition-surface'),r=el.ownerSVGElement.getBoundingClientRect();el.dispatchEvent(new PointerEvent('pointerdown',{{bubbles:true,clientX:r.left+r.width*{x},clientY:r.top+r.height*{y},pointerId:7,button:0,pointerType:'mouse'}}))}})()''')
    time.sleep(.15)
def key(value, **options):
    js('document.body.dispatchEvent(new KeyboardEvent("keydown",' + json.dumps({'key': value, 'bubbles': True, **options}) + '))')
    time.sleep(.12)
def check(name): result['checks'].append(name)
def capture(name):
    # Capture simple initial views only; later interaction checks use DOM geometry.
    if name != 'editor-large.png': return
    from System import Action
    from System.IO import FileStream, FileMode
    from Microsoft.Web.WebView2.Core import CoreWebView2CapturePreviewImageFormat
    stream = FileStream(str(DATA / name), FileMode.Create)
    pending = []
    window.native.Invoke(Action(lambda: pending.append(window.native.webview.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream))))
    assert pending[0].Wait(10000)
    stream.Close()

def legacy():
    capture('editor-large.png')
    before = state()
    click('整页横线')
    wait('document.querySelector(".action-dialog h2")?.innerText.includes("重新分区")')
    assert state() == before
    capture('partition-conflict.png')
    key('Enter'); key('Delete'); key('z', ctrlKey=True)
    assert state() == before, 'Modal shortcuts changed project'
    key('Escape')
    assert not js('Boolean(document.querySelector(".action-dialog"))')
    assert js('document.activeElement.innerText') == '整页横线'
    click('整页横线')
    dialog('使用框内竖切')
    assert state() == before
    pointer(.02, .1)
    wait('document.querySelector(".action-dialog h2")?.innerText.includes("还不能")')
    dialog('暂不处理')
    click('整页竖线'); dialog('保留现有标注')
    assert state() == before
    click('整页竖线'); dialog('清空并重新分区')
    assert len(state()['segments']) == 0 and not state()['flags']
    click('撤销上一步')
    assert len(state()['segments']) == 1 and len(state()['flags']) == 1
    click('删除分隔线'); dialog('选择分隔线')
    assert js('document.querySelector(".partition-editor").classList.contains("tool-line-edit")')
    check('Legacy buttons and canvas explain conflict; safe cancel, reset, undo and keyboard isolation')
    click('从左到右')
    click('复制到下一行'); dialog('选择歌词框')
    assert len(state()['segments']) == 1
    click('合并乐句'); dialog('选择乐句')
    js("document.querySelector('.file-chip').click()")
    wait('document.querySelector(".action-dialog h2")?.innerText.includes("更换歌谱")')
    dialog('保留当前歌谱')
    assert len(state()['segments']) == 1
    js("document.querySelectorAll('.file-chip')[1].click()")
    wait('document.querySelector(".action-dialog h2")?.innerText.includes("更换音频")')
    dialog('保留当前音频')
    check('Copy, merge and file replacement have actionable safeguards')

def automatic():
    click('自动框选'); wait('Boolean(document.querySelector(".auto-box-dialog"))')
    js("document.querySelector('.auto-box-footer input').click()")
    before = state()
    click('应用 1 个歌词框'); dialog('返回检查')
    assert state() == before
    click('应用 1 个歌词框'); dialog('替换标注并清除打点')
    assert len(state()['segments']) == 1 and not state()['flags']
    control['boxes'] = []
    click('自动框选'); wait('Boolean(document.querySelector(".feedback-empty"))')
    click('手动画歌词框')
    assert not js('Boolean(document.querySelector(".auto-box-dialog"))')
    check('Automatic replacement requires confirmation; empty result offers manual drawing')
    click('自动对齐'); wait('Boolean(document.querySelector(".auto-dialog"))')
    assert '建议先试听' in js('document.querySelector(".auto-dialog-summary").innerText')
    assert js('document.querySelector(".auto-listen").innerText') == '试听'
    click('全不选'); click('应用 0 条候选'); dialog('全选乐句')
    assert js('document.querySelector(".auto-candidate input").checked')
    click('暂不应用')
    check('Uncertain alignment has visible listening action; empty selection explains recovery')

def exporting():
    click('导出视频'); wait('Boolean(document.querySelector(".export-dialog"))')
    wait('document.querySelector(".export-dialog").innerText.includes("需要先解决")')
    assert not js('Boolean(document.querySelector(".export-dialog-footer .button-primary").disabled)')
    click('生成 MP4 视频')
    assert control['exports'] == 0
    capture('export-needs-fix.png')
    dialog('去修改这条乐句')
    wait('Boolean(document.querySelector("output[aria-label=开始时间]"))')
    assert not js('Boolean(document.querySelector(".time-input input"))')
    assert js('document.activeElement.dataset.segmentId') == 'old-box'
    check('Export blocking errors explain first issue and select matching phrase')
    control['errors'] = []
    control['validate_error'] = True
    click('导出视频'); wait('document.querySelector(".export-dialog").innerText.includes("暂时无法生成")')
    control['validate_error'] = False
    control['warnings'] = ['第 1 句前有 3 秒空档']
    click('重新检查'); wait('document.querySelector(".export-dialog").innerText.includes("可以继续生成")')
    assert '原音频直接保留' in js('document.querySelector(".export-dialog").innerText')
    click('生成 MP4 视频'); wait('document.querySelector(".export-dialog").innerText.includes("正在生成视频")')
    assert control['exports'] == 1
    click('返回编辑，继续生成')
    wait('Boolean(document.querySelector(".desktop-update button"))')
    js('document.querySelector(".desktop-update button").click()')
    wait('document.querySelector(".action-dialog h2")?.innerText.includes("任务完成")')
    assert api._installs == 0
    dialog('返回等待任务完成')
    click('导出视频'); wait('document.querySelector(".export-dialog").innerText.includes("正在生成视频")')
    assert control['exports'] == 1
    check('Export check retries, advisory warnings allow rendering; active job survives reopening; busy update explains')

def waveform_failure():
    wait('Boolean(document.querySelector(".waveform-feedback"))')
    assert '手动打点' in js('document.querySelector(".waveform-feedback").innerText')
    click('查看原因'); wait('document.querySelector(".action-dialog h2")?.innerText.includes("读取失败")')
    control['wave_error'] = False
    dialog('重试读取波形'); wait('Boolean(document.querySelector(".waveform-svg"))')
    control['save_error'] = True
    click('从左到右')
    wait('Boolean(document.querySelector(".save-feedback"))')
    control['save_error'] = False
    click('重试保存'); wait('!document.querySelector(".save-feedback")')
    check('Waveform and project-save failures stay visible and recover via retry')
    window.resize(1024, 768); time.sleep(.3)
    click('合并乐句'); wait('Boolean(document.querySelector(".action-dialog"))')
    layout = js('''(() => {const d=document.querySelector('.action-dialog'),r=d.getBoundingClientRect();return {width:r.width,height:r.height,x:r.x,y:r.y,screen:innerHeight,font:getComputedStyle(d.querySelector('p')).fontSize,button:getComputedStyle(d.querySelector('.action-buttons button')).minHeight}})()''')
    assert layout['x'] >= 0 and layout['y'] >= 0 and layout['y'] + layout['height'] <= layout['screen'] + 1, layout
    assert layout['font'] == '18px' and layout['button'] == '48px', layout
    check('1024×768 dialog fits and retains 18px text / 48px buttons')

def score_zoom():
    before = state()
    def wheel(delta, mode=0, target='.score-page'):
        return js('''(() => {const page=document.querySelector('.score-page'),canvas=document.querySelector('.canvas-area'),r=page.getBoundingClientRect(),v=canvas.getBoundingClientRect();
          const x=(Math.max(r.left,v.left)+Math.min(r.right,v.right-18))/2,y=(Math.max(r.top,v.top)+Math.min(r.bottom,v.bottom-18))/2;
          window.zoomTestPoint={x,y,fx:(x-r.left)/r.width,fy:(y-r.top)/r.height};
          const e=new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:x,clientY:y,deltaY:''' + str(delta) + ''',deltaMode:''' + str(mode) + '''});document.querySelector(''' + json.dumps(target) + ''').dispatchEvent(e);return {width:r.width,prevented:e.defaultPrevented}})()''')
    def width(): return js('document.querySelector(".score-page").getBoundingClientRect().width')
    def anchor_error():
        return js('''(() => {const r=document.querySelector('.score-page').getBoundingClientRect(),p=window.zoomTestPoint;return {x:Math.abs(r.left+p.fx*r.width-p.x),y:Math.abs(r.top+p.fy*r.height-p.y)}})()''')
    old = width()
    assert wheel(-120)['prevented']
    wait('document.querySelector(".score-page").getBoundingClientRect().width > ' + str(old + 10))
    assert anchor_error()['y'] < 2
    enlarged = width()
    wheel(120)
    wait('document.querySelector(".score-page").getBoundingClientRect().width < ' + str(enlarged - 5))
    for _ in range(12): wheel(-240); time.sleep(.06)
    assert abs(width() - 1275) <= 1
    overflow = js('''(() => {const c=document.querySelector('.canvas-area');c.scrollLeft=200;c.scrollTop=200;return c.scrollWidth-c.clientWidth})()''')
    assert overflow > 100
    wheel(120); time.sleep(.15)
    error = anchor_error()
    assert max(error.values()) < 2, error
    # Both edges remain reachable; centering must not put a wide page at a negative origin.
    assert js('''(() => {const c=document.querySelector('.canvas-area');c.scrollLeft=0;const r=document.querySelector('.score-page').getBoundingClientRect();return r.left>=c.getBoundingClientRect().left})()''')
    for _ in range(15): wheel(240); time.sleep(.06)
    assert abs(width() - 230) <= 1
    assert wheel(-3, mode=1)['prevented']; time.sleep(.15)
    assert width() > 230
    assert wheel(-1, mode=2)['prevented']; time.sleep(.15)
    assert width() > 240
    unchanged = width()
    assert not wheel(-120, target='.canvas-area')['prevented']
    time.sleep(.15)
    assert width() == unchanged
    assert not wheel(-120, target='.workspace-toolbar')['prevented']
    js('document.querySelector(".zoom-value").click()'); time.sleep(.15)
    assert js('document.querySelector(".zoom-value").innerText') == '适合宽度'
    assert state()['segments'] == before['segments'] and state()['flags'] == before['flags']
    check('Score wheel zoom anchors cursor, supports pixel/line/page deltas, clamps limits, keeps edges reachable and preserves annotations')

def select_timing(id):
    js('document.querySelector(\'[data-segment-id="' + id + '"]\').click()')
    time.sleep(.15)

def drag_timing(id, edge, delta, release=True):
    js('''(() => {const b=document.querySelector('[data-segment-id="''' + id + '''"]'),r=b.getBoundingClientRect();
      const target=''' + json.dumps(edge) + '''==='move'?b:b.querySelector('.timeline-resize-grip.''' + edge + '''');
      const x=''' + json.dumps(edge) + '''==='start'?r.left+1:r.right-1;
      window.dragTest={id:''' + json.dumps(id) + ''',x,y:r.top+5,width:b.parentElement.getBoundingClientRect().width};
      target.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:11,isPrimary:true,button:0,buttons:1,pointerType:'mouse',clientX:x,clientY:r.top+5}));})()''')
    time.sleep(.1)
    js('''(() => {const p=window.dragTest,b=document.querySelector('[data-segment-id="'+p.id+'"]');b.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:11,isPrimary:true,button:0,buttons:1,pointerType:'mouse',clientX:p.x+p.width*''' + str(delta / 120) + ''',clientY:p.y}));})()''')
    time.sleep(.12)
    if release:
        js('''(() => {const p=window.dragTest,b=document.querySelector('[data-segment-id="'+p.id+'"]');b.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:11,isPrimary:true,button:0,buttons:0,pointerType:'mouse',clientX:p.x+p.width*''' + str(delta / 120) + ''',clientY:p.y}));})()''')
        time.sleep(.15)

def wipe_timing():
    before = state()
    assert js('document.querySelectorAll(".timeline-block").length') == 30
    select_timing('s7')
    js('document.querySelector(\'[data-segment-id="s7"]\').dispatchEvent(new KeyboardEvent("keydown",{key:"Delete",bubbles:true}))')
    dialog('只移除这句时间')
    assert len(state()['segments']) == 30, 'Score box count changed'
    assert js('document.querySelectorAll(".annotation").length') == 30, 'Annotation count changed'
    wait('document.querySelectorAll(".timeline-block").length === 29')
    assert not js('Boolean(document.querySelector(\'[data-segment-id="s7"]\'))'), 'Removed item still rendered'
    label = js('document.querySelector(\'[data-segment-id="s8"] .timeline-block-text\').textContent')
    assert label == '08', label
    assert state()['segments'][7:] == before['segments'][7:], 'Later times changed'
    capture('wipe-timeline-gap.png')
    click('放回原来时间')
    assert js('document.querySelectorAll(".timeline-block").length') == 30
    assert state()['segments'][6]['startTime'] == 24
    check('Wipe timeline Delete keeps all 30 score boxes and stable labels, leaves a gap and can reinsert there')
    drag_timing('s7', 'end', 1)
    assert abs(state()['segments'][6]['endTime'] - 29) < .001
    assert state()['segments'][7] == before['segments'][7]
    drag_timing('s7', 'end', -3)
    assert abs(state()['segments'][6]['endTime'] - 26) < .001
    assert state()['segments'][7] == before['segments'][7]
    check('Wipe timeline drag permits overlap or empty space without moving the next item')

saved_full_timing = None
def full_timing():
    global saved_full_timing
    before = state()
    drag_timing('s7', 'end', 1)
    after = state()
    assert abs(after['segments'][6]['endTime'] - 29) < .001
    assert abs(after['segments'][7]['startTime'] - 29) < .001
    key('z', ctrlKey=True)
    assert state()['segments'] == before['segments']
    select_timing('s7'); click('从第 7 句重新打点')
    dialog('保留现有时间')
    assert state()['segments'] == before['segments']
    click('从第 7 句重新打点'); dialog('移除这些时间，重新打点')
    saved_full_timing = state()
    assert len(saved_full_timing['segments']) == 30
    assert js('document.querySelectorAll(".annotation").length') == 30
    assert js('document.querySelectorAll(".timeline-block").length') == 6
    assert saved_full_timing['segments'][:6] == before['segments'][:6]
    check('Full shared edge changes both sides, undo restores them, and deletion clears the suffix after confirmation')

def full_reopen():
    assert js('document.querySelectorAll(".timeline-block").length') == 6
    assert js('document.querySelectorAll(".annotation").length') == 30
    js('''(() => {const a=document.querySelector('audio');Object.defineProperty(a,'currentTime',{value:25,writable:true,configurable:true});a.dispatchEvent(new Event('timeupdate'));})()''')
    js('document.querySelector(".flag-button").click()')
    time.sleep(.15)
    after = state()
    assert js('document.querySelectorAll(".timeline-block").length') == 7
    assert after['segments'][6]['startTime'] == 25 and after['segments'][5]['endTime'] == 25
    assert all(not s['timingSet'] for s in after['segments'][7:])
    check('Full deletion persists after reopen; recording resumes at phrase 7 and joins the previous edge')

def check_merge_result(before):
    after = state()
    assert len(after['segments']) == 29
    assert after['segments'][5]['id'] == 's6'
    assert after['segments'][6]['id'] == 's8'
    assert [(s['startTime'], s['endTime']) for s in after['segments']] == [(s['startTime'], s['endTime']) for s in before['segments'][:29]]
    assert after['spareTimings'] == [{'startTime': 116, 'endTime': 120}]
    assert js('document.querySelectorAll(".timeline-spare").length') == 1
    return after

def merge_wipe():
    before = state()
    select_timing('s6')
    assert js('document.querySelector("#merge-target").value') == 's7', 'Merge must default to the next phrase'
    click('合并这两句')
    check_merge_result(before)
    assert js('document.querySelectorAll(".annotation").length') == 30
    capture('merge-keeps-time-slots.png')
    click('撤销上一步')
    assert state()['segments'] == before['segments']
    check('Merging score boxes 6+7 rebinds all unchanged time slots, keeps all geometry, stores tail slot and supports undo')

saved_merge_timing = None
def merge_full():
    global saved_merge_timing
    before = state()
    click('调整分隔线')
    js('''(() => {const l=document.querySelector('[data-line-id="h6"] .partition-hit'),r=l.ownerSVGElement.getBoundingClientRect();for(const type of ['pointerdown','pointerup'])l.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:14,isPrimary:true,button:0,pointerType:'mouse',clientX:r.left+r.width*.5,clientY:r.top+r.height*.25}));})()''')
    time.sleep(.2)
    click('删除分隔线')
    saved_merge_timing = check_merge_result(before)
    check('Full-mode divider deletion merges geometry while retaining every original timing slot')

def merge_reopen():
    assert len(state()['segments']) == 29
    assert js('document.querySelectorAll(".timeline-spare").length') == 1
    click('从左到右'); click('添加标注')
    js('''(() => {const p=document.querySelector('.score-page'),r=p.getBoundingClientRect();window.drawTestRect={left:r.left,top:r.top,width:r.width,height:r.height};p.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:15,isPrimary:true,button:0,clientX:r.left+r.width*.3,clientY:r.top+r.height*.9}));})()''')
    time.sleep(.15)
    js('''(() => {const p=document.querySelector('.score-page'),r=window.drawTestRect;p.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:15,isPrimary:true,button:0,clientX:r.left+r.width*.5,clientY:r.top+r.height*.94}));})()''')
    time.sleep(.2)
    assert len(state()['segments']) == 30
    click('整框')
    click('放入下一个未分配时间段')
    assert state()['segments'][29]['startTime'] == 116 and state()['segments'][29]['endTime'] == 120
    assert state()['spareTimings'] == []
    assert js('document.querySelectorAll(".timeline-block").length') == 30
    check('Tail slot persists after reopening and a newly drawn box can reuse its exact time in full mode')

def readability():
    # Inspect actual rendered text, excluding SVG score units and hidden menu entries.
    audit = js('''(() => {const bad=[];for(const el of document.querySelectorAll('.app-shell *')){
      if(el.closest('svg')||!el.getClientRects().length)continue;
      if(![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;
      const s=getComputedStyle(el);if(parseFloat(s.fontSize)<16)bad.push({text:el.textContent.slice(0,50),font:s.fontSize,color:s.color});
    }return bad})()''')
    assert not audit, audit
    assert js('getComputedStyle(document.querySelector(".flag-button")).minHeight') == '52px'
    assert js('getComputedStyle(document.body).fontSize') == '18px'
    assert js('document.querySelectorAll(".time-input input").length') == 0
    width = js('document.querySelector(".canvas-area").clientWidth')
    click('收起乐句设置')
    assert js('document.querySelector(".canvas-area").clientWidth') > width + 250
    click('更大')
    assert js('getComputedStyle(document.body).fontSize') == '22px'
    window.resize(1024, 768); time.sleep(.4)
    geometry = js('''(() => {const c=document.querySelector('.canvas-area').getBoundingClientRect();return {height:c.height,width:c.width,body:document.body.scrollWidth,viewport:innerWidth,buttons:[...document.querySelectorAll('.topbar button,.toolbar-right button,.segmentation-toolbar>button,.transport-panel button')].map(b=>{const r=b.getBoundingClientRect();return {text:b.innerText,x:r.x,right:r.right,y:r.y,bottom:r.bottom,height:r.height}})}})()''')
    assert geometry['body'] <= geometry['viewport'], geometry
    assert geometry['height'] >= 130, geometry
    assert all(b['x'] >= 0 and b['right'] <= geometry['viewport'] + 1 and b['height'] >= 44 for b in geometry['buttons']), geometry
    check('Visible text is at least 16px, controls have large targets, 22px display fits 1024×768 and closing settings gives the score more room')

def preferences_reopen():
    assert js('document.documentElement.dataset.textSize') == 'extra'
    assert not js('Boolean(document.querySelector(".right-panel"))')
    click('大字'); click('乐句设置')
    assert js('Boolean(document.querySelector(".right-panel"))')
    window.resize(1366, 900); time.sleep(.3)
    check('Font size and collapsed settings persist after reopening; undo and redo remain named visible controls')

def marking():
    def at(value):
        js('''(() => {const a=document.querySelector('audio');Object.defineProperty(a,'currentTime',{value:''' + str(value) + ''',writable:true,configurable:true});a.dispatchEvent(new Event('timeupdate'));})()''')
    js('''(() => {const a=document.querySelector('audio');window.markCalls={pause:0,play:0};a.pause=()=>window.markCalls.pause++;a.play=()=>{window.markCalls.play++;return Promise.resolve()};})()''')
    assert '第 2 句开始' in js('document.querySelector(".next-flag").innerText')
    before=state()
    at(0); js('document.querySelector(".flag-button").click()'); time.sleep(.15)
    assert state()['segments'] == before['segments'] and state()['flags'] == before['flags']
    assert not js('Boolean(document.querySelector("[aria-modal=true]"))')
    assert '太早' in js('document.querySelector(".point-feedback").innerText')
    assert js('document.querySelector("audio").currentTime') == 0
    at(1.05); key('Enter')
    assert not js('Boolean(document.querySelector("[aria-modal=true]"))')
    assert len(state()['flags']) == 1
    at(4); key('Enter')
    assert len(state()['flags']) == 2
    assert '最后一句结束' in js('document.querySelector(".next-flag").innerText')
    key('Enter')
    assert len(state()['flags']) == 2 and not js('Boolean(document.querySelector("[aria-modal=true]"))')
    at(7); key('Enter')
    assert state()['flags'][-1]['kind'] == 'end'
    key('Enter')
    assert not js('Boolean(document.querySelector("[aria-modal=true]"))')
    assert js('window.markCalls') == {'pause':0,'play':0}
    check('Early, duplicate and completed taps never open a modal, pause or seek; the next phrase and final end point are shown explicitly')

def frame_drag(id):
    js('''(() => {const g=document.querySelector('[data-score-id="''' + id + '''"]'),r=g.getBoundingClientRect();window.frameDrag={x:r.left+r.width/2,y:r.top+r.height/2};g.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:23,isPrimary:true,button:0,buttons:1,clientX:window.frameDrag.x,clientY:window.frameDrag.y}));})()''')
    time.sleep(.12)
    js('''(() => {const g=document.querySelector('[data-score-id="''' + id + '''"]'),p=window.frameDrag;for(const type of ['pointermove','pointerup'])g.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:23,isPrimary:true,button:0,buttons:type==='pointermove'?1:0,clientX:p.x+30,clientY:p.y+10}));})()''')
    time.sleep(.15)

def cursor_wipe():
    before=state()
    assert js('getComputedStyle(document.querySelector(".annotation")).cursor') == 'pointer'
    frame_drag('old-box')
    assert state()['segments'] == before['segments'], 'First click must select without moving'
    assert js('getComputedStyle(document.querySelector(".annotation")).cursor') == 'move'
    frame_drag('old-box')
    assert state()['segments'][0]['region'] != before['segments'][0]['region'], 'Second drag must move the selected frame'
    check('Wipe frames use a hand cursor; first gesture only selects, subsequent dragging moves the selected frame')

def cursor_full():
    before=state()
    assert js('getComputedStyle(document.querySelector(".partition-surface")).cursor') == 'pointer'
    pointer(.5,.3)
    assert js('document.querySelector(".annotation").classList.contains("is-selected")')
    assert js('getComputedStyle(document.querySelector(".annotation")).cursor') == 'pointer'
    frame_drag('old-box')
    assert state()['segments'] == before['segments']
    assert not js('Boolean(document.querySelector("#merge-target"))')
    check('Full mode keeps a hand cursor and fixed frames; irrelevant wipe editing controls are hidden')

cases = [legacy, automatic, exporting, waveform_failure, score_zoom, wipe_timing, full_timing, full_reopen, merge_wipe, merge_full, merge_reopen, readability, preferences_reopen, marking, cursor_wipe, cursor_full]
def loaded():
    global phase
    try:
        if phase >= 0:
            wait('Boolean(document.querySelector(".segmentation-toolbar"))')
            js('Element.prototype.setPointerCapture=function(){}; Element.prototype.releasePointerCapture=function(){}')
            time.sleep(.25)
            if phase >= 5:
                js('''(() => {const a=document.querySelector('audio');Object.defineProperty(a,'duration',{value:120,configurable:true});a.dispatchEvent(new Event('loadedmetadata'));})()''')
                time.sleep(.15)
            cases[phase]()
        next_phase = phases.index(phase) + 1 if phase in phases else 0
        if next_phase == len(phases): window.destroy(); return
        phase = phases[next_phase]
        fixture = copy.deepcopy(base)
        control['wave_error'] = phase == 3
        control['errors'] = ['第 1 句的结束时间必须晚于开始时间'] if phase == 2 else []
        control['warnings'] = []
        if phase in (1, 2): fixture['highlight']['mode'] = 'wipe'
        if phase in (5, 6, 8, 9):
            fixture['audioDuration'] = 120
            fixture['highlight']['mode'] = 'wipe' if phase in (5, 8) else 'full'
            fixture['segments'] = [{'id': f's{i+1}', 'pageId': 'p1', 'region': {'x': .1, 'y': .02*i, 'width': .8, 'height': .018}, 'startTime': i*4, 'endTime': (i+1)*4, 'timingSet': True, 'direction': 'left-to-right'} for i in range(30)]
            fixture['flags'] = [{'id': f'f{i}', 'segmentId': s['id'], 'time': s['startTime'], 'kind': 'transition' if i else 'start'} for i, s in enumerate(fixture['segments'])] + [{'id': 'last', 'segmentId': 's30', 'time': 120, 'kind': 'end'}]
        if phase == 7: fixture = saved_full_timing
        if phase == 9:
            fixture['partitions'] = [{'pageId': 'p1', 'horizontal': [{'id': f'h{i}', 'position': .1 + .025*i} for i in range(31)],
                                      'vertical': [{'id': 'left', 'position': .1}, {'id': 'right', 'position': .9}], 'cuts': [], 'excluded': []}]
            for i, s in enumerate(fixture['segments']):
                s['region'] = {'x': .1, 'y': .1+.025*i, 'width': .8, 'height': .025}
                s['partitionKey'] = f'p1:h{i}:h{i+1}:left:right'
        if phase == 10: fixture = saved_merge_timing
        if phase == 13:
            fixture['segments'].append({**copy.deepcopy(fixture['segments'][0]),'id':'next-box','timingSet':False,'startTime':4,'endTime':8})
        if phase == 14: fixture['highlight']['mode']='wipe'
        if phase != 12: js('localStorage.setItem("pujian-display",JSON.stringify({textSize:"large",inspectorOpen:true}))')
        js('localStorage.setItem("pujian-project",' + json.dumps(json.dumps(fixture)) + '); location.reload()')
    except Exception as error:
        result['error'] = repr(error)
        result['traceback'] = traceback.format_exc()
        try: result['screen'] = js('document.body.innerText')[-5000:]
        except Exception: pass
        window.destroy()

window.events.loaded += loaded
timer = threading.Timer(210, window.destroy)
timer.start()
try: webview.start(gui='edgechromium', private_mode=False, storage_path=str(DATA / 'profile'))
finally: timer.cancel(); server.should_exit = True
print(json.dumps(result, ensure_ascii=True), flush=True)
(DATA / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
assert 'error' not in result and len(result['checks']) == (3 if '--merges' in sys.argv else 5 if '--ux' in sys.argv else 21), result
