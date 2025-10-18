const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public')); // 存放前端檔案的資料夾

let playerState = { // 儲存當前狀態
  time: 0,
  state: -1, // -1: 未開始, 1: 播放, 2: 暫停
  videoId: 'rWlO954SvRs' // 預設影片 ID，替換成您的
};

let connectedUsers = 0; // 追蹤連線用戶數量

io.on('connection', (socket) => {
  connectedUsers++;
  console.log(`新用戶連線，目前連線用戶數: ${connectedUsers}`);
  console.log(`Socket ID: ${socket.id}`);
  
  // 發送當前狀態給新用戶
  console.log('發送給新用戶的狀態:', playerState);
  socket.emit('sync', playerState);
  
  // 添加測試事件監聽器
  socket.on('test_connection', (data, callback) => {
    console.log('收到測試連線事件:', data);
    if (callback) {
      callback({ success: true, message: '連線正常', socketId: socket.id });
    }
  });
  
  // 接收客戶端事件並廣播
  socket.on('play', (time) => {
    playerState.state = 1;
    playerState.time = time;
    socket.broadcast.emit('play', time);
    console.log(`播放事件: 時間 ${time.toFixed(2)}s`);
  });
  
  socket.on('pause', (time) => {
    playerState.state = 2;
    playerState.time = time;
    socket.broadcast.emit('pause', time);
    console.log(`暫停事件: 時間 ${time.toFixed(2)}s`);
  });
  
  socket.on('seek', (time) => {
    // 只更新時間，不改變播放狀態
    playerState.time = time;
    socket.broadcast.emit('seek', time);
    console.log(`跳轉事件: 時間 ${time.toFixed(2)}s (保持當前播放狀態)`);
  });
  
  // 處理位置同步事件
  socket.on('position_sync', (data) => {
    // 只更新時間，不改變播放狀態
    playerState.time = data.time;
    // 不廣播位置同步，避免過多網路流量
  });
  
  // 處理強制同步事件
  socket.on('force_sync', (data) => {
    console.log(`強制同步請求: 時間 ${data.time.toFixed(2)}s, 狀態 ${data.state}, 視頻 ${data.videoId}`);
    
    // 更新全域狀態
    playerState.time = data.time;
    playerState.state = data.state;
    playerState.videoId = data.videoId;
    
    // 廣播給所有用戶（包括發送者）
    io.emit('force_sync_response', {
      time: data.time,
      state: data.state,
      videoId: data.videoId
    });
    
    console.log(`已廣播強制同步到所有用戶`);
  });
  
  // 處理視頻更換事件
  socket.on('change_video', (data, callback) => {
    console.log(`收到視頻更換請求:`, data);
    console.log(`視頻ID: ${data.videoId}, 時間: ${data.time.toFixed(2)}s, 狀態: ${data.state}`);
    
    try {
      // 更新全域狀態
      console.log('更新前的狀態:', playerState);
      playerState.videoId = data.videoId;
      playerState.time = data.time;
      playerState.state = data.state;
      console.log('更新後的狀態:', playerState);
      
      // 廣播給所有用戶（包括發送者）
      io.emit('video_changed', {
        videoId: data.videoId,
        time: data.time,
        state: data.state
      });
      
      console.log(`已廣播視頻更換到所有用戶: ${data.videoId}`);
      
      // 發送確認回調
      if (callback) {
        callback({ success: true, message: '視頻更換成功' });
      }
      
    } catch (error) {
      console.error('視頻更換處理錯誤:', error);
      if (callback) {
        callback({ success: false, message: '視頻更換失敗: ' + error.message });
      }
    }
  });
  
  // 處理與播放中同步事件
  socket.on('sync_with_playing', (data, callback) => {
    console.log(`收到與播放中同步請求，來自用戶: ${socket.id}`);
    console.log(`當前播放狀態:`, playerState);
    
    try {
      // 檢查是否有有效的播放狀態（播放中或暫停中）
      if (playerState.state === 1 || playerState.state === 2) { // 正在播放或暫停
        console.log('發送當前播放狀態給用戶');
        console.log(`發送的數據: videoId=${playerState.videoId}, time=${playerState.time}, state=${playerState.state}`);
        
        // 只發送給請求的用戶
        socket.emit('sync_with_playing_response', {
          videoId: playerState.videoId,
          time: playerState.time,
          state: playerState.state
        });
        
        if (callback) {
          callback({ success: true, message: '已同步到播放中狀態' });
        }
      } else {
        console.log('當前沒有有效的播放狀態，狀態值:', playerState.state);
        if (callback) {
          callback({ success: false, message: '當前沒有播放中的視頻' });
        }
      }
      
    } catch (error) {
      console.error('與播放中同步處理錯誤:', error);
      if (callback) {
        callback({ success: false, message: '同步失敗: ' + error.message });
      }
    }
  });
  
  socket.on('disconnect', () => {
    connectedUsers--;
    console.log(`用戶離線，目前連線用戶數: ${connectedUsers}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`伺服器運行於端口 ${PORT}`);
});