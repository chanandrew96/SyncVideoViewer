let player;
let isInitialized = false;
let lastSyncTime = 0;
let isReceivingSync = false; // 防止同步迴圈
let syncInterval;
const SYNC_THRESHOLD = 2; // 2秒內的同步請求會被忽略
const SYNC_INTERVAL = 3000; // 每3秒同步一次位置

// 初始化 Socket.IO 連線
const socket = io();

// 錯誤處理
function showError(message) {
  const errorDiv = document.getElementById('error');
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
  document.getElementById('status').textContent = '載入失敗';
}

function updateStatus(message) {
  document.getElementById('status').textContent = message;
}

// Socket.IO 連線錯誤處理
socket.on('connect', () => {
  console.log('Socket.IO 已連線');
  updateStatus('已連接到伺服器');
  
  // 測試連線
  setTimeout(() => {
    socket.emit('test_connection', { test: 'initial' }, (response) => {
      console.log('初始連線測試回應:', response);
    });
  }, 1000);
});

socket.on('connect_error', (error) => {
  console.error('Socket.IO 連線錯誤:', error);
  showError('無法連接到伺服器，請檢查網路連線');
});

socket.on('disconnect', (reason) => {
  console.log('Socket.IO 連線中斷:', reason);
  updateStatus('與伺服器連線中斷');
});

socket.on('reconnect', () => {
  console.log('Socket.IO 重新連線成功');
  updateStatus('已重新連接到伺服器');
});

// YouTube API 載入後建立播放器
function onYouTubeIframeAPIReady() {
  try {
    player = new YT.Player('player', {
      height: '100%',
      width: '100%',
      videoId: 'rWlO954SvRs', // 替換成您的影片 ID
      events: {
        'onReady': onPlayerReady,
        'onStateChange': onPlayerStateChange,
        'onError': onPlayerError
      }
    });
  } catch (error) {
    showError('無法初始化 YouTube 播放器: ' + error.message);
  }
}

function onPlayerError(event) {
  showError('YouTube 播放器錯誤: ' + event.data);
}

function onPlayerReady(event) {
  updateStatus('播放器已準備就緒');
  document.getElementById('status').style.display = 'none';
  isInitialized = true;
  
  // 啟用同步按鈕
  document.getElementById('syncBtn').disabled = false;
  document.getElementById('syncWithPlayingBtn').disabled = false;
  
  // 啟動定期同步
  startPeriodicSync();
  
  // 接收伺服器同步
  socket.on('sync', (state) => {
    if (!isInitialized) return;
    isReceivingSync = true;
    
    console.log('收到伺服器同步狀態:', state);
    console.log('當前播放器視頻ID:', player.getVideoData().video_id);
    
    // 如果視頻ID不同，載入新視頻
    if (state.videoId !== player.getVideoData().video_id) {
      console.log('視頻ID不同，載入新視頻:', state.videoId);
      player.loadVideoById(state.videoId, state.time);
    } else {
      console.log('視頻ID相同，只同步時間和狀態');
      // 只同步時間和狀態
      const currentTime = player.getCurrentTime();
      if (Math.abs(currentTime - state.time) > SYNC_THRESHOLD) {
        player.seekTo(state.time);
      }
    }
    
    // 根據狀態自動播放或暫停
    if (state.state === 1) {
      console.log('自動播放');
      player.playVideo();
    } else if (state.state === 2) {
      console.log('自動暫停');
      player.pauseVideo();
    }
    
    // 更新視頻信息顯示
    updateVideoInfo(state.videoId);
    
    setTimeout(() => {
      isReceivingSync = false;
    }, 1000);
  });
  
  socket.on('play', (time) => {
    if (!isInitialized || isReceivingSync) return;
    const currentTime = player.getCurrentTime();
    if (Math.abs(currentTime - time) > SYNC_THRESHOLD) {
      player.seekTo(time);
    }
    player.playVideo();
  });
  
  socket.on('pause', (time) => {
    if (!isInitialized || isReceivingSync) return;
    const currentTime = player.getCurrentTime();
    if (Math.abs(currentTime - time) > SYNC_THRESHOLD) {
      player.seekTo(time);
    }
    player.pauseVideo();
  });
  
  socket.on('seek', (time) => {
    if (!isInitialized || isReceivingSync) return;
    const currentTime = player.getCurrentTime();
    if (Math.abs(currentTime - time) > SYNC_THRESHOLD) {
      // 保存當前播放狀態
      const wasPlaying = player.getPlayerState() === YT.PlayerState.PLAYING;
      
      // 執行跳轉
      player.seekTo(time);
      
      // 如果之前在播放，確保跳轉後繼續播放
      if (wasPlaying) {
        setTimeout(() => {
          if (player.getPlayerState() !== YT.PlayerState.PLAYING) {
            player.playVideo();
          }
        }, 100);
      }
    }
  });
  
  // 處理強制同步響應
  socket.on('force_sync_response', (data) => {
    if (!isInitialized) return;
    isReceivingSync = true;
    
    console.log('收到強制同步響應:', data);
    console.log('當前播放器狀態:', {
      videoId: player.getVideoData().video_id,
      time: player.getCurrentTime(),
      state: player.getPlayerState()
    });
    
    // 檢查是否需要更換視頻
    if (data.videoId && data.videoId !== player.getVideoData().video_id) {
      console.log('強制同步：視頻ID不同，載入新視頻:', data.videoId);
      
      // 保存需要同步的狀態
      const targetState = data.state;
      const targetTime = data.time;
      
      // 載入新視頻
      player.loadVideoById({
        videoId: data.videoId,
        startSeconds: targetTime,
        suggestedQuality: 'large'
      });
      
      // 更新視頻信息顯示
      updateVideoInfo(data.videoId);
      
      // 等待視頻載入完成後再設置播放狀態
      const checkVideoLoaded = () => {
        const playerState = player.getPlayerState();
        console.log('檢查視頻載入狀態:', playerState);
        
        if (playerState === YT.PlayerState.CUED || playerState === YT.PlayerState.PAUSED) {
          console.log('視頻已載入，設置播放狀態:', targetState);
          applyPlayerState(targetState);
        } else if (playerState === YT.PlayerState.BUFFERING) {
          console.log('視頻仍在緩衝，等待載入完成...');
          setTimeout(checkVideoLoaded, 500);
        } else {
          console.log('視頻載入狀態異常，延遲設置播放狀態');
          setTimeout(() => applyPlayerState(targetState), 1000);
        }
      };
      
      // 延遲檢查視頻載入狀態
      setTimeout(checkVideoLoaded, 500);
      
    } else {
      console.log('強制同步：視頻ID相同，只同步時間和狀態');
      // 同步到指定位置和狀態
      const currentTime = player.getCurrentTime();
      if (Math.abs(currentTime - data.time) > 0.5) {
        player.seekTo(data.time);
      }
      
      // 直接設置播放狀態
      applyPlayerState(data.state);
    }
    
    // 延遲檢查狀態是否正確同步
    setTimeout(() => {
      const finalState = player.getPlayerState();
      console.log('同步後播放器狀態:', finalState);
      
      // 如果狀態不匹配，再次嘗試同步
      if ((data.state === 1 && finalState !== YT.PlayerState.PLAYING) ||
          (data.state === 2 && finalState !== YT.PlayerState.PAUSED)) {
        console.log('狀態同步不完整，重新嘗試');
        if (data.state === 1) {
          player.playVideo();
        } else if (data.state === 2) {
          player.pauseVideo();
        }
      }
    }, 500);
    
    showSyncFeedback('已同步到 ' + data.time.toFixed(1) + ' 秒');
    
    setTimeout(() => {
      isReceivingSync = false;
    }, 1500);
  });
  
  // 處理視頻更換響應
  socket.on('video_changed', (data) => {
    if (!isInitialized) return;
    isReceivingSync = true;
    
    console.log('收到視頻更換請求:', data);
    
    try {
      // 更新視頻信息顯示
      updateVideoInfo(data.videoId);
      
      // 保存目標狀態
      const targetState = data.state;
      
      // 使用重新創建播放器的方法（更可靠）
      recreatePlayer(data.videoId, data.time);
      
      // 等待播放器準備就緒後設置狀態
      const waitForPlayerReady = () => {
        if (player && player.getPlayerState) {
          const playerState = player.getPlayerState();
          console.log('視頻更換後播放器狀態:', playerState);
          
          if (playerState === YT.PlayerState.CUED || playerState === YT.PlayerState.PAUSED) {
            console.log('播放器已準備就緒，設置目標狀態:', targetState);
            applyPlayerStateForVideoChange(targetState);
          } else if (playerState === YT.PlayerState.BUFFERING) {
            console.log('播放器仍在緩衝，等待準備就緒...');
            setTimeout(waitForPlayerReady, 500);
          } else {
            console.log('播放器狀態異常，延遲設置狀態');
            setTimeout(() => applyPlayerStateForVideoChange(targetState), 1000);
          }
        } else {
          console.log('播放器尚未初始化，等待...');
          setTimeout(waitForPlayerReady, 500);
        }
      };
      
      // 延遲檢查播放器狀態
      setTimeout(waitForPlayerReady, 1000);
      
      showSyncFeedback('已更換視頻: ' + data.videoId);
      
    } catch (error) {
      console.error('視頻更換失敗:', error);
      showError('視頻更換失敗: ' + error.message);
    }
    
    setTimeout(() => {
      isReceivingSync = false;
    }, 3000);
  });
  
  // 視頻更換時的播放狀態設置函數
  function applyPlayerStateForVideoChange(state) {
    console.log('視頻更換：設置播放器狀態:', state);
    switch (state) {
      case 1: // 播放
        console.log('視頻更換：設置為播放狀態');
        player.playVideo();
        break;
      case 2: // 暫停
        console.log('視頻更換：設置為暫停狀態');
        player.pauseVideo();
        break;
      default:
        console.log('視頻更換：保持當前狀態');
    }
  }
  
  // 處理與播放中同步響應
  socket.on('sync_with_playing_response', (data) => {
    if (!isInitialized) return;
    isReceivingSync = true;
    
    console.log('收到與播放中同步響應:', data);
    console.log('當前播放器狀態:', {
      videoId: player.getVideoData().video_id,
      time: player.getCurrentTime(),
      state: player.getPlayerState()
    });
    
    // 檢查是否需要更換視頻
    const currentVideoId = player.getVideoData().video_id;
    console.log('視頻ID比較:', {
      received: data.videoId,
      current: currentVideoId,
      different: data.videoId !== currentVideoId
    });
    
    if (data.videoId && data.videoId !== currentVideoId) {
      console.log('與播放中同步：視頻ID不同，載入新視頻:', data.videoId);
      
      // 保存目標狀態
      const targetState = data.state;
      const targetTime = data.time;
      
      // 載入新視頻
      console.log('開始載入新視頻:', data.videoId, '時間:', targetTime);
      player.loadVideoById({
        videoId: data.videoId,
        startSeconds: targetTime,
        suggestedQuality: 'large'
      });
      updateVideoInfo(data.videoId);
      
      // 等待視頻載入完成後設置播放狀態
      const checkVideoLoaded = () => {
        const playerState = player.getPlayerState();
        const currentVideoId = player.getVideoData().video_id;
        console.log('檢查視頻載入狀態:', {
          state: playerState,
          videoId: currentVideoId,
          targetVideoId: data.videoId
        });
        
        if (currentVideoId === data.videoId && 
            (playerState === YT.PlayerState.CUED || playerState === YT.PlayerState.PAUSED)) {
          console.log('視頻已載入，設置播放狀態:', targetState);
          applyPlayerStateForSyncWithPlaying(targetState);
        } else if (playerState === YT.PlayerState.BUFFERING) {
          console.log('視頻仍在緩衝，等待載入完成...');
          setTimeout(checkVideoLoaded, 500);
        } else if (currentVideoId !== data.videoId) {
          console.log('視頻ID不匹配，嘗試重新載入');
          // 如果視頻ID不匹配，嘗試重新載入
          player.loadVideoById({
            videoId: data.videoId,
            startSeconds: targetTime,
            suggestedQuality: 'large'
          });
          setTimeout(checkVideoLoaded, 1000);
        } else {
          console.log('視頻載入狀態異常，延遲設置播放狀態');
          setTimeout(() => applyPlayerStateForSyncWithPlaying(targetState), 1000);
        }
      };
      
      // 延遲檢查視頻載入狀態
      setTimeout(checkVideoLoaded, 500);
      
    } else {
      console.log('與播放中同步：視頻ID相同，只同步時間和狀態');
      // 同步到指定位置和狀態
      const currentTime = player.getCurrentTime();
      if (Math.abs(currentTime - data.time) > 0.5) {
        player.seekTo(data.time);
      }
      
      // 直接設置播放狀態
      applyPlayerStateForSyncWithPlaying(data.state);
    }
    
    showSyncFeedback('已同步到播放中狀態');
    
    setTimeout(() => {
      isReceivingSync = false;
    }, 2000);
  });
  
  // 與播放中同步時的播放狀態設置函數
  function applyPlayerStateForSyncWithPlaying(state) {
    console.log('與播放中同步：設置播放器狀態:', state);
    switch (state) {
      case 1: // 播放
        console.log('與播放中同步：設置為播放狀態');
        player.playVideo();
        break;
      case 2: // 暫停
        console.log('與播放中同步：設置為暫停狀態');
        player.pauseVideo();
        break;
      default:
        console.log('與播放中同步：保持當前狀態');
    }
  }
}

// 定期同步播放位置
function startPeriodicSync() {
  syncInterval = setInterval(() => {
    if (!isInitialized || isReceivingSync) return;
    
    const currentTime = player.getCurrentTime();
    const playerState = player.getPlayerState();
    
    // 只有在播放中時才發送位置同步
    if (playerState === YT.PlayerState.PLAYING) {
      socket.emit('position_sync', {
        time: currentTime,
        state: 1
      });
    }
  }, SYNC_INTERVAL);
}

// 停止定期同步
function stopPeriodicSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

// 強制同步功能
function forceSync() {
  if (!isInitialized) return;
  
  const currentTime = player.getCurrentTime();
  const playerState = player.getPlayerState();
  const videoId = player.getVideoData().video_id;
  
  // 更詳細的狀態映射
  let stateValue;
  switch (playerState) {
    case YT.PlayerState.PLAYING:
      stateValue = 1;
      break;
    case YT.PlayerState.PAUSED:
      stateValue = 2;
      break;
    case YT.PlayerState.BUFFERING:
      stateValue = 3;
      break;
    case YT.PlayerState.CUED:
      stateValue = 4;
      break;
    default:
      stateValue = 0; // 未開始或其他狀態
  }
  
  const forceSyncData = {
    time: currentTime,
    state: stateValue,
    videoId: videoId,
    playerState: playerState // 保留原始狀態用於調試
  };
  
  console.log('發送強制同步請求:', forceSyncData);
  console.log('當前播放器狀態:', {
    time: currentTime,
    state: playerState,
    stateValue: stateValue,
    videoId: videoId
  });
  
  // 發送強制同步請求
  socket.emit('force_sync', forceSyncData);
  
  // 顯示同步反饋
  showSyncFeedback('正在同步所有用戶...');
}

// 顯示同步反饋
function showSyncFeedback(message) {
  const feedback = document.getElementById('syncFeedback');
  feedback.textContent = message;
  feedback.classList.add('show');
  
  setTimeout(() => {
    feedback.classList.remove('show');
  }, 3000);
}

// 與播放中同步功能
function syncWithPlaying() {
  if (!isInitialized) return;
  
  console.log('請求與播放中同步');
  
  // 發送同步請求到伺服器
  socket.emit('sync_with_playing', {}, (response) => {
    console.log('與播放中同步回應:', response);
    if (response && response.success) {
      showSyncFeedback('正在同步到播放中狀態...');
    } else {
      showError('同步失敗: ' + (response ? response.message : '未知錯誤'));
    }
  });
}

// 從YouTube連結提取視頻ID
function extractVideoId(url) {
  if (!url) return null;
  
  // 清理輸入：移除開頭的 @ 符號和其他特殊字符
  let cleanUrl = url.trim();
  if (cleanUrl.startsWith('@')) {
    cleanUrl = cleanUrl.substring(1);
  }
  
  console.log('清理後的URL:', cleanUrl);
  
  // 處理各種YouTube連結格式
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/watch\?.*v=([^&\n?#]+)/,
    /youtube\.com\/v\/([^&\n?#]+)/
  ];
  
  for (const pattern of patterns) {
    const match = cleanUrl.match(pattern);
    if (match && match[1]) {
      console.log('匹配到視頻ID:', match[1]);
      return match[1];
    }
  }
  
  // 如果輸入的就是視頻ID（11個字符的字符串）
  if (/^[a-zA-Z0-9_-]{11}$/.test(cleanUrl)) {
    console.log('直接匹配視頻ID:', cleanUrl);
    return cleanUrl;
  }
  
  console.log('無法提取視頻ID，原始輸入:', url);
  return null;
}

// 更換視頻
function changeVideo() {
  const urlInput = document.getElementById('videoUrlInput');
  const videoUrl = urlInput.value.trim();
  
  console.log('用戶輸入的URL:', videoUrl);
  console.log('Socket.IO 連線狀態:', socket.connected);
  console.log('播放器初始化狀態:', isInitialized);
  
  if (!videoUrl) {
    showError('請輸入 YouTube 連結或視頻 ID');
    return;
  }
  
  if (!socket.connected) {
    showError('與伺服器連線中斷，請重新整理頁面');
    return;
  }
  
  const videoId = extractVideoId(videoUrl);
  console.log('提取的視頻ID:', videoId);
  
  if (!videoId) {
    showError('無效的 YouTube 連結格式。請檢查連結是否正確。');
    return;
  }
  
  if (!isInitialized) {
    showError('播放器尚未準備就緒');
    return;
  }
  
  const changeVideoData = {
    videoId: videoId,
    time: 0, // 從頭開始播放
    state: 1 // 自動播放
  };
  
  console.log('準備發送視頻更換請求:', changeVideoData);
  
  // 先測試連線
  socket.emit('test_connection', { test: 'ping' }, (response) => {
    console.log('連線測試回應:', response);
    if (response && response.success) {
      console.log('連線正常，繼續發送視頻更換請求');
      
      // 發送視頻更換請求到伺服器（帶確認回調）
      socket.emit('change_video', changeVideoData, (response) => {
        console.log('伺服器回應:', response);
        if (response && response.success) {
          showSyncFeedback('視頻更換成功: ' + videoId);
        } else {
          showError('視頻更換失敗: ' + (response ? response.message : '未知錯誤'));
        }
      });
    } else {
      showError('連線測試失敗，請檢查網路連線');
    }
  });
  
  showSyncFeedback('正在更換視頻...');
  urlInput.value = ''; // 清空輸入框
}

// 更新視頻信息顯示
function updateVideoInfo(videoId) {
  const videoInfo = document.getElementById('videoInfo');
  videoInfo.textContent = `當前視頻: ${videoId}`;
}

// 備用視頻更換方法 - 重新創建播放器
function recreatePlayer(videoId, startTime = 0) {
  try {
    // 停止定期同步
    stopPeriodicSync();
    
    // 銷毀當前播放器
    if (player && player.destroy) {
      player.destroy();
    }
    
    // 重新創建播放器
    player = new YT.Player('player', {
      height: '100%',
      width: '100%',
      videoId: videoId,
      startSeconds: startTime,
      events: {
        'onReady': onPlayerReady,
        'onStateChange': onPlayerStateChange,
        'onError': onPlayerError
      }
    });
    
    console.log('播放器已重新創建，視頻ID:', videoId);
    
  } catch (error) {
    console.error('重新創建播放器失敗:', error);
    showError('播放器重新創建失敗: ' + error.message);
  }
}

function onPlayerStateChange(event) {
  if (!isInitialized || isReceivingSync) return;
  
  const currentTime = player.getCurrentTime();
  const now = Date.now();
  
  // 防抖動：避免短時間內重複發送相同事件
  if (now - lastSyncTime < 1000) return;
  
  if (event.data === YT.PlayerState.PLAYING) {
    socket.emit('play', currentTime);
    lastSyncTime = now;
  } else if (event.data === YT.PlayerState.PAUSED) {
    socket.emit('pause', currentTime);
    lastSyncTime = now;
  }
}

// 用戶尋找時廣播（使用防抖動）
let seekTimeout;
let isUserSeeking = false; // 標記是否為用戶主動拖拽

document.getElementById('player').addEventListener('seeked', () => {
  if (!isInitialized || isReceivingSync) return;
  
  // 只有在用戶主動拖拽時才廣播
  if (isUserSeeking) {
    clearTimeout(seekTimeout);
    seekTimeout = setTimeout(() => {
      socket.emit('seek', player.getCurrentTime());
      isUserSeeking = false; // 重置標記
    }, 500); // 500ms 防抖動
  }
});

// 監聽用戶開始拖拽
document.getElementById('player').addEventListener('seeking', () => {
  if (!isInitialized || isReceivingSync) return;
  isUserSeeking = true; // 標記為用戶主動拖拽
});

// 同步按鈕點擊事件
document.getElementById('syncBtn').addEventListener('click', () => {
  forceSync();
});

// 與播放中同步按鈕點擊事件
document.getElementById('syncWithPlayingBtn').addEventListener('click', () => {
  syncWithPlaying();
});

// 更換視頻按鈕點擊事件
document.getElementById('changeVideoBtn').addEventListener('click', () => {
  changeVideo();
});

// 輸入框回車事件
document.getElementById('videoUrlInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    changeVideo();
  }
});

// 輸入框內容變化時啟用/禁用按鈕
document.getElementById('videoUrlInput').addEventListener('input', (e) => {
  const changeBtn = document.getElementById('changeVideoBtn');
  changeBtn.disabled = !e.target.value.trim() || !isInitialized;
});
