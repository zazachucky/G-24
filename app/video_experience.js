// Video citations and catalog controls. The server owns the reviewed evidence.
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export function videoAnswerCard(message) {
  const citation = message?.video;
  if (message?.status === 'pending' || !citation || typeof citation.asset_id !== 'string' ||
      !Number.isFinite(citation.start) || !Number.isFinite(citation.end) || citation.start < 0 || citation.end <= citation.start) return '';
  return `<button type="button" class="message-action video-answer-action" data-video-jump="${esc(citation.asset_id)}" data-video-chapter="${esc(citation.chapter_id || '')}" data-video-start="${citation.start}">${clock(citation.start)} · ${esc(citation.label || '해당 장면')} 보기</button>`;
}

export function setupVideoKnowledge({data, video, getUI, getState, patch, track, toast, restoreVideo, onInteraction, onSelection, onAsk}) {
  const catalog = Array.isArray(data.video_catalog) ? data.video_catalog : [];
  const byId = new Map(catalog.map(asset => [asset.asset_id, asset]));
  const toolbar = document.querySelector('.media-toolbar');
  const info = document.querySelector('#video-info');
  if (!catalog.length || !toolbar || !info || !video) return {render() {}};

  if (!document.querySelector('#video-knowledge-style')) {
    const style = document.createElement('style');
    style.id = 'video-knowledge-style';
    style.textContent = `.media-toolbar{flex-wrap:wrap}.video-asset-choice{display:flex;align-items:center;gap:6px;max-width:100%}.video-asset-choice select{max-width:210px;min-width:0}.video-knowledge{margin-top:10px;font-size:11px;line-height:1.5}.video-knowledge summary{cursor:pointer;font-weight:700}.video-knowledge p{margin:8px 0}.video-chapter-list{display:grid;gap:5px;max-height:210px;overflow:auto;margin:8px 0}.video-chapter-list button{text-align:left;white-space:normal}.video-knowledge-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.video-knowledge button{font:inherit;border:1px solid #e5deef;border-radius:7px;background:#fff;color:#7644CF;padding:7px 9px;cursor:pointer}.video-knowledge button:disabled{opacity:.5;cursor:default}.video-knowledge-status{font-size:10px;color:#62636f}.video-answer-action{white-space:normal;text-align:left}`;
    document.head.append(style);
  }
  const assetLabel = document.createElement('label');
  assetLabel.className = 'video-asset-choice';
  assetLabel.append(document.createTextNode('영상 선택 '));
  const select = document.createElement('select');
  select.id = 'video-asset'; select.setAttribute('aria-label', '영상 자료 선택');
  const placeholder = document.createElement('option');
  placeholder.value = ''; placeholder.disabled = true;
  placeholder.textContent = '재생할 영상을 선택하세요';
  select.append(placeholder);
  for (const asset of catalog) {
    const option = document.createElement('option'); option.value = asset.asset_id;
    option.textContent = asset.product_match ? '상품 설명 샘플 · 제작 대본' : '코어어센틱 녹화 참고 영상';
    select.append(option);
  }
  assetLabel.append(select); toolbar.append(assetLabel);
  const obsolete = [...info.children].find(element => element.tagName === 'P' && element.textContent.includes('검증 전 비활성'));
  if (obsolete) obsolete.remove();
  const panel = document.createElement('details'); panel.className = 'video-knowledge'; panel.id = 'video-knowledge';
  panel.innerHTML = '<summary>영상 내용 · 확인한 장면 보기</summary><p id="video-evidence-label"></p><div class="video-knowledge-actions"><button type="button" id="video-summary-ask">영상 내용 요약</button><button type="button" id="video-current-ask">지금 장면 설명</button><button type="button" id="video-return" hidden>이전 시청 위치로</button></div><div id="video-chapters" class="video-chapter-list" aria-label="근거를 확인한 영상 장면"></div><p id="video-knowledge-status" class="video-knowledge-status" role="status"></p>';
  info.append(panel);
  const chapterList = panel.querySelector('#video-chapters');
  const returnButton = panel.querySelector('#video-return');
  const status = panel.querySelector('#video-knowledge-status');
  let prior = null, context = '', renderedAsset = '', assignedPath = '', navigation = 0;
  const snapshot = () => {
    const ui = getUI();
    return {video_asset_id: ui.video_asset_id || catalog[0].asset_id,
      video_time: Number.isFinite(video.currentTime) ? video.currentTime : Number(ui.video_time) || 0,
      video_paused: video.paused, media_mode: ui.media_mode || 'image'};
  };
  const readContext = () => {
    const value = getState(); const state = value?.state || value;
    return `${state?.run_id || ''}:${state?.customer?.id || value?.customerId || ''}`;
  };
  const safePath = asset => typeof asset?.path === 'string' && /^assets\/video\/[A-Za-z0-9_./-]+\.(mp4|webm)$/.test(asset.path) && !asset.path.split('/').includes('..') ? '/' + asset.path : null;

  function render() {
    const nextContext = readContext();
    if (context && context !== nextContext) {prior = null; status.textContent = ''; navigation++;}
    context = nextContext;
    const ui = getUI(), asset = byId.get(ui.video_asset_id) || catalog[0];
    // An image preview has no active video selection. A placeholder lets the
    // user choose the reference even when it is already the remembered asset.
    const selectedAsset = ui.media_mode === 'video' ? asset.asset_id : '';
    if (select.value !== selectedAsset) select.value = selectedAsset;
    const modeOption = document.querySelector('#media-mode option[value="video"]');
    const modeLabel = asset.product_match ? '상품 설명 샘플' : '녹화 참고 영상';
    // Even identical option text replaces its DOM and closes an open native menu.
    if (modeOption && modeOption.textContent !== modeLabel) modeOption.textContent = modeLabel;
    const path = safePath(asset);
    // Preserve the native player across polls, orientation changes and sheets.
    if (path && assignedPath !== path) {
      assignedPath = path;
      if (video.getAttribute('src') !== path || video.error) {
        restoreVideo?.(); // Quiet native save events while the media identity changes.
        video.src = path;
        video.load();
      }
    }
    video.setAttribute('aria-label', asset.label);
    const title = info.querySelector(':scope > strong'); if (title) title.textContent = asset.label;
    if (ui.media_mode === 'video') {
      const mediaStatus = document.querySelector('#media-status');
      if (mediaStatus && !video.ended) mediaStatus.textContent = asset.product_match ? '16:9 · 상품 설명 샘플' : '9:16 · 녹화 참고 영상';
    }
    if (renderedAsset !== asset.asset_id) {
      renderedAsset = asset.asset_id;
      panel.querySelector('#video-evidence-label').textContent = asset.scope_note;
      chapterList.replaceChildren();
      for (const chapter of asset.chapters || []) {
        const button = document.createElement('button'); button.type = 'button';
        button.dataset.videoJump = asset.asset_id; button.dataset.videoChapter = chapter.id;
        button.textContent = `${clock(chapter.start)} · ${chapter.label}`;
        chapterList.append(button);
      }
    }
    returnButton.hidden = !prior;
    const state = getState()?.state || getState();
    panel.querySelector('#video-summary-ask').disabled = Boolean(state?.ended);
    panel.querySelector('#video-current-ask').disabled = Boolean(state?.ended);
  }

  function move(asset, target, paused, mode = 'video') {
    if (!asset || !safePath(asset) || !Number.isFinite(target) || target < 0 || target >= asset.duration_s) return;
    // Retry the chosen asset after a load failure, including the same asset.
    // Only explicit navigation retries; background polling must not reload it.
    if (video.error || video.getAttribute('src') !== safePath(asset)) assignedPath = '';
    onInteraction?.();
    const movement = ++navigation;
    patch({video_asset_id: asset.asset_id, media_mode: mode, video_time: target, video_paused: paused});
    // patch synchronously updates local UI, while loadedmetadata restores a new asset.
    restoreVideo?.();
    if (mode === 'video' && !paused && video.readyState >= 1) {
      video.play().catch(error => {
        // A later pause, return or asset switch normally interrupts play().
        if (error?.name !== 'AbortError' && movement === navigation && getUI().video_paused === false)
          toast('장면 위치가 이동했어요. 재생 버튼을 눌러주세요.');
      });
    }
  }

  function jump(assetId, chapterId, start) {
    const asset = byId.get(assetId);
    const chapter = asset?.chapters?.find(item => chapterId ? item.id === chapterId : item.start === start);
    if (!chapter || !safePath(asset)) {toast('확인한 영상 장면을 찾을 수 없어요.'); return;}
    if (!prior) prior = snapshot();
    move(asset, chapter.start, false);
    track?.('VIDEO_SCENE_SEEK', {metadata: {asset_id: asset.asset_id, chapter_id: chapter.id}});
    panel.open = true;
    status.textContent = `${clock(chapter.start)} · ${chapter.label} 장면으로 이동했어요.`;
    render();
  }

  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-video-jump]');
    if (!button) return;
    event.preventDefault();
    jump(button.dataset.videoJump, button.dataset.videoChapter, Number(button.dataset.videoStart));
  });
  select.addEventListener('change', () => {
    const asset = byId.get(select.value);
    if (!asset) return;
    prior = null; status.textContent = '';
    move(asset, 0, true);
    render();
    onSelection?.();
  });
  returnButton.addEventListener('click', () => {
    if (!prior) return;
    const saved = prior; prior = null;
    const asset = byId.get(saved.video_asset_id);
    if (!asset) return;
    move(asset, Math.min(saved.video_time, asset.duration_s - 0.05), saved.video_paused, saved.media_mode);
    status.textContent = `${clock(saved.video_time)} · 이전 시청 위치로 돌아왔어요.`;
    render();
  });
  const ask = text => {
    // Persist the player's actual clock before issuing a contextual video question.
    onInteraction?.();
    const saved = snapshot();
    patch(saved);
    onAsk?.(text);
  };
  panel.querySelector('#video-summary-ask').addEventListener('click', () => ask('방송 내용 요약해줘'));
  panel.querySelector('#video-current-ask').addEventListener('click', () => ask('지금 무슨 내용이야?'));
  render();
  return {render};
}
