const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'wss://miscord.ru';

interface PeerConnection {
  pc: RTCPeerConnection;
  userId: number;
}

class VoiceService {
  private ws: WebSocket | null = null;
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null; // Поток демонстрации экрана
  private peerConnections: Map<number, PeerConnection> = new Map();
  private iceServers: RTCIceServer[] = [];
  private voiceChannelId: number | null = null;
  private token: string | null = null;
  private onParticipantJoined: ((participant: any) => void) | null = null;
  private onParticipantLeft: ((userId: number) => void) | null = null;
  private onSpeakingChanged: ((userId: number, isSpeaking: boolean) => void) | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private vadInterval: number | null = null;
  private isSpeaking: boolean = false;
  private speakingUsers: Set<number> = new Set();
  private onParticipantsReceivedCallback: ((participants: any[]) => void) | null = null;
  private onParticipantStatusChangedCallback: ((userId: number, status: Partial<{ is_muted: boolean; is_deafened: boolean }>) => void) | null = null;
  private isScreenSharing: boolean = false; // Статус демонстрации экрана
  private onScreenShareChanged: ((userId: number, isSharing: boolean) => void) | null = null;
  private isConnecting: boolean = false;

  async connect(voiceChannelId: number, token: string) {
    console.log(`[VoiceService] 🎙️ Запрос подключения к голосовому каналу ${voiceChannelId}`);
    
    // Проверяем, не подключены ли мы уже к этому каналу
    if (this.voiceChannelId === voiceChannelId && this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log(`[VoiceService] ✅ Уже подключены к каналу ${voiceChannelId}`);
      return;
    }
    
    if (this.isConnecting) {
      console.log(`[VoiceService] ⏳ Уже происходит подключение, игнорируем запрос`);
      return;
    }
    
    // Если подключены к другому каналу или соединение закрыто, сначала очищаем
    if (this.ws || this.voiceChannelId) {
      console.log(`[VoiceService] 🧹 Очищаем предыдущее соединение (канал: ${this.voiceChannelId})`);
      this.cleanup();
    }
    
    this.isConnecting = true;
    this.voiceChannelId = voiceChannelId;
    this.token = token;

    try {
      // Получаем доступ к микрофону
      console.log(`[VoiceService] 🎤 Запрашиваем доступ к микрофону...`);
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      
      console.log(`[VoiceService] ✅ Доступ к микрофону получен:`, {
        audioTracks: this.localStream.getAudioTracks().length,
        trackLabels: this.localStream.getAudioTracks().map(t => ({ label: t.label, enabled: t.enabled }))
      });
      
      // Инициализируем детекцию голосовой активности
      this.initVoiceActivityDetection();
    } catch (error) {
      console.error(`[VoiceService] ❌ Не удалось получить доступ к микрофону:`, error);
      this.isConnecting = false;
      throw new Error('Не удалось получить доступ к микрофону');
    }

    // Подключаемся к WebSocket
    const wsUrl = `${WS_URL}/ws/voice/${voiceChannelId}?token=${token}`;
    console.log(`[VoiceService] 🔌 Подключаемся к WebSocket: ${wsUrl}`);
    this.ws = new WebSocket(wsUrl);

    return new Promise<void>((resolve, reject) => {
      this.ws!.onopen = () => {
        console.log(`[VoiceService] ✅ WebSocket подключен к каналу ${voiceChannelId}`);
        this.isConnecting = false;
        resolve();
      };

      this.ws!.onerror = (error) => {
        console.error(`[VoiceService] ❌ Ошибка подключения WebSocket:`, error);
        this.isConnecting = false;
        reject(new Error('Ошибка подключения WebSocket'));
      };

      this.ws!.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log(`[VoiceService] 📨 Получено сообщение:`, data.type, data);
          await this.handleMessage(data);
        } catch (error) {
          console.error(`[VoiceService] ❌ Ошибка обработки сообщения:`, error);
        }
      };

      this.ws!.onclose = (event) => {
        console.log(`[VoiceService] 🔌 WebSocket закрыт. Код: ${event.code}, причина: ${event.reason}`);
        this.isConnecting = false;
        this.cleanup();
      };
    });
  }

  private async handleMessage(data: any) {
    switch (data.type) {
      case 'participants':
        console.log(`[VoiceService] 👥 Получен список участников:`, {
          count: data.participants.length,
          participants: data.participants.map((p: any) => ({ id: p.user_id, username: p.username })),
          iceServers: data.ice_servers
        });
        
        this.iceServers = data.ice_servers;
        
        // Передаем список участников в store
        if (this.onParticipantsReceivedCallback) {
          this.onParticipantsReceivedCallback(data.participants);
        }
        
        // Создаем соединения с существующими участниками (кроме себя)
        const currentUserId = this.getCurrentUserId();
        for (const participant of data.participants) {
          if (participant.user_id !== currentUserId) {
            // Создаем offer только если наш ID меньше
            const shouldCreateOffer = currentUserId !== null && currentUserId < participant.user_id;
            console.log(`[VoiceService] 🤝 Создаем P2P соединение с пользователем ${participant.user_id} (${participant.username}), createOffer: ${shouldCreateOffer}`);
            await this.createPeerConnection(participant.user_id, shouldCreateOffer);
          }
        }
        break;

      case 'user_joined_voice':
        console.log(`[VoiceService] ➕ Пользователь присоединился: ${data.username} (ID: ${data.user_id})`);
        if (this.onParticipantJoined) {
          this.onParticipantJoined({
            user_id: data.user_id,
            username: data.username,
            display_name: data.display_name,
            avatar_url: data.avatar_url
          });
        }
        // Создаем соединение только если это не мы сами
        const currentUserId2 = this.getCurrentUserId();
        if (data.user_id !== currentUserId2) {
          // Создаем offer только если наш ID меньше (существующий пользователь создает offer для нового)
          const shouldCreateOffer = currentUserId2 !== null && currentUserId2 < data.user_id;
          console.log(`[VoiceService] 🤝 Создаем P2P соединение с новым пользователем ${data.user_id}, createOffer: ${shouldCreateOffer}`);
          await this.createPeerConnection(data.user_id, shouldCreateOffer);
        }
        break;

      case 'user_left_voice':
        console.log(`[VoiceService] ➖ Пользователь покинул канал: ID ${data.user_id}`);
        if (this.onParticipantLeft) {
          this.onParticipantLeft(data.user_id);
        }
        this.removePeerConnection(data.user_id);
        break;

      case 'offer':
        console.log(`[VoiceService] 📞 Получен offer от пользователя ${data.from_id}`);
        await this.handleOffer(data.from_id, data.offer);
        break;

      case 'answer':
        console.log(`[VoiceService] 📞 Получен answer от пользователя ${data.from_id}`);
        await this.handleAnswer(data.from_id, data.answer);
        break;

      case 'ice_candidate':
        console.log(`[VoiceService] 🧊 Получен ICE candidate от пользователя ${data.from_id}:`, data.candidate);
        await this.handleIceCandidate(data.from_id, data.candidate);
        break;
        
      case 'user_speaking':
        console.log(`[VoiceService] 🗣️ Изменение голосовой активности: пользователь ${data.user_id}, говорит: ${data.is_speaking}`);
        if (this.onSpeakingChanged) {
          this.onSpeakingChanged(data.user_id, data.is_speaking);
        }
        break;
        
      case 'user_muted':
        console.log(`[VoiceService] 🔇 Пользователь ${data.user_id} изменил статус микрофона: ${data.is_muted ? 'заглушен' : 'включен'}`);
        if (this.onParticipantStatusChangedCallback) {
          this.onParticipantStatusChangedCallback(data.user_id, { is_muted: data.is_muted });
        }
        break;
        
      case 'user_deafened':
        console.log(`[VoiceService] 🔇 Пользователь ${data.user_id} изменил статус наушников: ${data.is_deafened ? 'заглушены' : 'включены'}`);
        if (this.onParticipantStatusChangedCallback) {
          this.onParticipantStatusChangedCallback(data.user_id, { is_deafened: data.is_deafened });
        }
        break;

      case 'participant_status_changed':
        console.log(`[VoiceService] 📊 Изменение статуса участника ${data.user_id}:`, data.status);
        if (this.onParticipantStatusChangedCallback) {
          this.onParticipantStatusChangedCallback(data.user_id, data.status);
        }
        break;

      case 'screen_share_started':
        console.log(`[VoiceService] 🖥️ Пользователь ${data.user_id} начал демонстрацию экрана`);
        if (this.onScreenShareChanged) {
          this.onScreenShareChanged(data.user_id, true);
        }
        break;

      case 'screen_share_stopped':
        console.log(`[VoiceService] 🖥️ Пользователь ${data.user_id} остановил демонстрацию экрана`);
        // Удаляем видео элемент
        const videoElement = document.getElementById(`remote-video-${data.user_id}`);
        if (videoElement) {
          videoElement.remove();
          console.log(`[VoiceService] 🗑️ Удален видео элемент для пользователя ${data.user_id}`);
        }
        if (this.onScreenShareChanged) {
          this.onScreenShareChanged(data.user_id, false);
        }
        break;
    }
  }

  private async createPeerConnection(userId: number, createOffer: boolean) {
    console.log(`[VoiceService] 🔗 Создаем RTCPeerConnection для пользователя ${userId}, создавать offer: ${createOffer}`);
    
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    // Логируем состояние соединения
    pc.onconnectionstatechange = () => {
      console.log(`[VoiceService] 🔗 Изменение состояния P2P соединения с ${userId}: ${pc.connectionState}`);
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[VoiceService] 🧊 Изменение состояния ICE с ${userId}: ${pc.iceConnectionState}`);
    };

    // Добавляем локальный поток
    if (this.localStream) {
      console.log(`[VoiceService] 🎤 Добавляем локальные аудио треки в P2P соединение с ${userId}`);
      this.localStream.getTracks().forEach(track => {
        console.log(`[VoiceService] 🎵 Добавляем трек: ${track.kind}, enabled: ${track.enabled}, label: ${track.label}`);
        pc.addTrack(track, this.localStream!);
      });
    }

    // Обработка входящего потока
    pc.ontrack = (event) => {
      console.log(`[VoiceService] 🎵 Получен remote track от пользователя ${userId}:`, {
        kind: event.track.kind,
        id: event.track.id,
        enabled: event.track.enabled,
        readyState: event.track.readyState,
        streams: event.streams.length
      });
      
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];
        const audioTracks = stream.getAudioTracks();
        const videoTracks = stream.getVideoTracks();

        console.log(`[VoiceService] 🎵 Анализ потока от ${userId}:`, {
          audioTracks: audioTracks.length,
          videoTracks: videoTracks.length,
          streamId: stream.id
        });

        // Обрабатываем аудио треки
        if (audioTracks.length > 0) {
          console.log(`[VoiceService] 🔊 Создаем audio элемент для пользователя ${userId}`);
          const remoteAudio = new Audio();
          remoteAudio.srcObject = new MediaStream(audioTracks);
          remoteAudio.autoplay = true;
          remoteAudio.controls = false;
          remoteAudio.muted = false;
          remoteAudio.volume = 1.0;
          
          remoteAudio.id = `remote-audio-${userId}`;
          remoteAudio.style.display = 'none';
          document.body.appendChild(remoteAudio);
          
          console.log(`[VoiceService] 🔊 Audio элемент создан и добавлен в DOM для пользователя ${userId}`);
          
          // Применяем сохраненную громкость если есть
          setTimeout(() => {
            const savedVolume = localStorage.getItem(`voice-volume-${userId}`);
            if (savedVolume) {
              const volume = parseInt(savedVolume);
              remoteAudio.volume = Math.min(volume / 100, 3.0);
              console.log(`[VoiceService] 🔊 Применена сохраненная громкость ${volume}% для пользователя ${userId}`);
            }
          }, 100);
          
          // Пытаемся воспроизвести аудио
          const playPromise = remoteAudio.play();
          if (playPromise !== undefined) {
            playPromise.then(() => {
              console.log(`[VoiceService] ✅ Аудио успешно воспроизводится для пользователя ${userId}`);
            }).catch(error => {
              console.log(`[VoiceService] ⚠️ Требуется взаимодействие пользователя для воспроизведения аудио от ${userId}:`, error);
              const enableAudio = () => {
                remoteAudio.play().then(() => {
                  console.log(`[VoiceService] ✅ Аудио включено после взаимодействия пользователя для ${userId}`);
                  document.removeEventListener('click', enableAudio);
                  document.removeEventListener('touchstart', enableAudio);
                }).catch(e => {
                  console.error(`[VoiceService] ❌ Ошибка воспроизведения аудио для ${userId}:`, e);
                });
              };
              
              document.addEventListener('click', enableAudio, { once: true });
              document.addEventListener('touchstart', enableAudio, { once: true });
            });
          }

          // Мониторим статистику аудио
          this.monitorAudioStats(pc, userId);
        }

        // Обрабатываем видео треки (демонстрация экрана)
        if (videoTracks.length > 0) {
          console.log(`[VoiceService] 🖥️ Получены видео треки для демонстрации экрана от пользователя ${userId}`);
          // Создаем или обновляем видео элемент
          let remoteVideo = document.getElementById(`remote-video-${userId}`) as HTMLVideoElement;
          if (!remoteVideo) {
            console.log(`[VoiceService] 🖥️ Создаем video элемент для пользователя ${userId}`);
            remoteVideo = document.createElement('video');
            remoteVideo.id = `remote-video-${userId}`;
            remoteVideo.autoplay = true;
            remoteVideo.controls = false;
            remoteVideo.muted = true; // Видео всегда без звука, звук идет через аудио элемент
            remoteVideo.style.position = 'absolute';
            remoteVideo.style.top = '0';
            remoteVideo.style.left = '0';
            remoteVideo.style.width = '100%';
            remoteVideo.style.height = '100%';
            remoteVideo.style.objectFit = 'contain';
            remoteVideo.style.backgroundColor = '#000';
            
            // Ждем появления контейнера в ChatArea для удалённого видео
            const waitForRemoteContainer = (attempts = 0): void => {
              const videoContainer = document.getElementById('screen-share-container-chat');
              
              if (videoContainer) {
                console.log(`[VoiceService] 🖥️ Контейнер найден, добавляем видео для пользователя ${userId}`);
                videoContainer.innerHTML = '';
                videoContainer.appendChild(remoteVideo);
              } else if (attempts < 50) { // Максимум 5 секунд
                setTimeout(() => waitForRemoteContainer(attempts + 1), 100);
              } else {
                console.error(`[VoiceService] ❌ Контейнер для видео не найден после 5 секунд ожидания`);
                remoteVideo.remove();
                return;
              }
            };
            
            waitForRemoteContainer();
          }
          
          remoteVideo.srcObject = new MediaStream(videoTracks);
          console.log(`[VoiceService] 🖥️ Video поток установлен для пользователя ${userId}`);
          
          // Уведомляем о начале демонстрации экрана
          if (this.onScreenShareChanged) {
            this.onScreenShareChanged(userId, true);
          }
        }
      }
    };

    // Обработка ICE кандидатов
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[VoiceService] 🧊 Отправляем ICE candidate пользователю ${userId}:`, event.candidate);
        this.sendMessage({
          type: 'ice_candidate',
          target_id: userId,
          candidate: event.candidate,
        });
      } else {
        console.log(`[VoiceService] 🧊 Все ICE candidates отправлены для пользователя ${userId}`);
      }
    };

    this.peerConnections.set(userId, { pc, userId });

    if (createOffer) {
      console.log(`[VoiceService] 📞 Создаем offer для пользователя ${userId}`);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log(`[VoiceService] 📞 Offer создан и установлен как LocalDescription для ${userId}`);
        this.sendMessage({
          type: 'offer',
          target_id: userId,
          offer: offer,
        });
      } catch (error) {
        console.error(`[VoiceService] ❌ Ошибка создания offer для ${userId}:`, error);
      }
    }
  }

  private async monitorAudioStats(pc: RTCPeerConnection, userId: number) {
    // Мониторим статистику WebRTC каждые 5 секунд
    const statsInterval = setInterval(async () => {
      try {
        const stats = await pc.getStats();
        stats.forEach(report => {
          if (report.type === 'inbound-rtp' && report.mediaType === 'audio') {
            console.log(`[VoiceService] 📊 Статистика входящего аудио от ${userId}:`, {
              packetsReceived: report.packetsReceived,
              packetsLost: report.packetsLost,
              bytesReceived: report.bytesReceived,
              jitter: report.jitter
            });
          }
          if (report.type === 'outbound-rtp' && report.mediaType === 'audio') {
            console.log(`[VoiceService] 📊 Статистика исходящего аудио к ${userId}:`, {
              packetsSent: report.packetsSent,
              bytesSent: report.bytesSent,
              retransmittedPacketsSent: report.retransmittedPacketsSent
            });
          }
        });
      } catch (error) {
        console.error(`[VoiceService] ❌ Ошибка получения статистики для ${userId}:`, error);
        clearInterval(statsInterval);
      }
    }, 5000);

    // Очищаем интервал при закрытии соединения
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
        clearInterval(statsInterval);
      }
    });
  }

  private async handleOffer(userId: number, offer: RTCSessionDescriptionInit) {
    console.log(`[VoiceService] 📞 Обрабатываем offer от пользователя ${userId}`);
    let peerConnection = this.peerConnections.get(userId);
    
    if (!peerConnection) {
      console.log(`[VoiceService] 🔗 P2P соединение с ${userId} не найдено, создаем новое`);
      await this.createPeerConnection(userId, false);
      peerConnection = this.peerConnections.get(userId)!;
    }

    try {
      await peerConnection.pc.setRemoteDescription(offer);
      console.log(`[VoiceService] 📞 RemoteDescription установлен для ${userId}`);
      
      const answer = await peerConnection.pc.createAnswer();
      await peerConnection.pc.setLocalDescription(answer);
      console.log(`[VoiceService] 📞 Answer создан и установлен как LocalDescription для ${userId}`);

      this.sendMessage({
        type: 'answer',
        target_id: userId,
        answer: answer,
      });
    } catch (error) {
      console.error(`[VoiceService] ❌ Ошибка обработки offer от ${userId}:`, error);
    }
  }

  private async handleAnswer(userId: number, answer: RTCSessionDescriptionInit) {
    console.log(`[VoiceService] 📞 Обрабатываем answer от пользователя ${userId}`);
    const peerConnection = this.peerConnections.get(userId);
    if (peerConnection) {
      try {
        await peerConnection.pc.setRemoteDescription(answer);
        console.log(`[VoiceService] ✅ Answer успешно обработан для ${userId}`);
      } catch (error) {
        console.error(`[VoiceService] ❌ Ошибка обработки answer от ${userId}:`, error);
      }
    } else {
      console.warn(`[VoiceService] ⚠️ P2P соединение с ${userId} не найдено при обработке answer`);
    }
  }

  private async handleIceCandidate(userId: number, candidate: RTCIceCandidateInit) {
    console.log(`[VoiceService] 🧊 Обрабатываем ICE candidate от пользователя ${userId}`);
    const peerConnection = this.peerConnections.get(userId);
    if (peerConnection) {
      try {
        await peerConnection.pc.addIceCandidate(candidate);
        console.log(`[VoiceService] ✅ ICE candidate успешно добавлен для ${userId}`);
      } catch (error) {
        console.error(`[VoiceService] ❌ Ошибка добавления ICE candidate для ${userId}:`, error);
      }
    } else {
      console.warn(`[VoiceService] ⚠️ P2P соединение с ${userId} не найдено при обработке ICE candidate`);
    }
  }

  private removePeerConnection(userId: number) {
    console.log(`[VoiceService] 🗑️ Удаляем P2P соединение с пользователем ${userId}`);
    const peerConnection = this.peerConnections.get(userId);
    if (peerConnection) {
      peerConnection.pc.close();
      this.peerConnections.delete(userId);
      console.log(`[VoiceService] ✅ P2P соединение с ${userId} закрыто и удалено`);
    }
    
    // Удаляем аудио элемент из DOM
    const audioElement = document.getElementById(`remote-audio-${userId}`);
    if (audioElement) {
      audioElement.remove();
      console.log(`[VoiceService] 🗑️ Audio элемент удален для пользователя ${userId}`);
    }

    // Удаляем видео элемент из DOM
    const videoElement = document.getElementById(`remote-video-${userId}`);
    if (videoElement) {
      videoElement.remove();
      console.log(`[VoiceService] 🗑️ Video элемент удален для пользователя ${userId}`);
      
      // Уведомляем об остановке демонстрации экрана
      if (this.onScreenShareChanged) {
        this.onScreenShareChanged(userId, false);
      }
    }
  }

  private sendMessage(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log(`[VoiceService] 📤 Отправляем сообщение:`, data.type, data);
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn(`[VoiceService] ⚠️ Не удалось отправить сообщение - WebSocket не открыт`, data);
    }
  }

  setMuted(muted: boolean) {
    console.log(`[VoiceService] 🔇 Изменяем статус микрофона: ${muted ? 'заглушаем' : 'включаем'}`);
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = !muted;
        console.log(`[VoiceService] 🎤 Трек ${track.label}: enabled = ${track.enabled}`);
      });
    }
    this.sendMessage({ type: 'mute', is_muted: muted });
  }

  setDeafened(deafened: boolean) {
    console.log(`[VoiceService] 🔇 Изменяем статус наушников: ${deafened ? 'заглушаем всех' : 'включаем звук'}`);
    // Заглушаем всех удаленных пользователей
    this.peerConnections.forEach((_, userId) => {
      const audioElement = document.getElementById(`remote-audio-${userId}`) as HTMLAudioElement;
      if (audioElement) {
        audioElement.muted = deafened;
        console.log(`[VoiceService] 🔊 Audio элемент пользователя ${userId}: muted = ${deafened}`);
      }
    });
    
    this.sendMessage({ type: 'deafen', is_deafened: deafened });
  }

  onParticipantJoin(callback: (participant: any) => void) {
    this.onParticipantJoined = callback;
  }

  onParticipantLeave(callback: (userId: number) => void) {
    this.onParticipantLeft = callback;
  }

  disconnect() {
    console.log(`[VoiceService] 🔌 Инициируем отключение от голосового канала ${this.voiceChannelId}`);
    if (this.ws) {
      this.ws.close();
    }
    this.cleanup();
  }

  private cleanup() {
    console.log(`[VoiceService] 🧹 Начинаем полную очистку ресурсов`);
    
    // Останавливаем детекцию голосовой активности
    this.cleanupVoiceActivityDetection();

    // Закрываем все peer connections
    const peerCount = this.peerConnections.size;
    this.peerConnections.forEach((peerConnection, userId) => {
      console.log(`[VoiceService] 🔗 Закрываем P2P соединение с пользователем ${userId}`);
      peerConnection.pc.close();
      
      // Удаляем аудио элементы
      const audioElement = document.getElementById(`remote-audio-${userId}`);
      if (audioElement) {
        audioElement.remove();
        console.log(`[VoiceService] 🗑️ Audio элемент удален для пользователя ${userId}`);
      }

      // Удаляем видео элементы
      const videoElement = document.getElementById(`remote-video-${userId}`);
      if (videoElement) {
        videoElement.remove();
        console.log(`[VoiceService] 🗑️ Video элемент удален для пользователя ${userId}`);
      }
    });
    this.peerConnections.clear();
    console.log(`[VoiceService] ✅ Закрыто ${peerCount} P2P соединений`);

    // Останавливаем локальный поток
    if (this.localStream) {
      const trackCount = this.localStream.getTracks().length;
      this.localStream.getTracks().forEach(track => {
        track.stop();
        console.log(`[VoiceService] 🛑 Остановлен локальный трек: ${track.kind} (${track.label})`);
      });
      this.localStream = null;
      console.log(`[VoiceService] ✅ Остановлено ${trackCount} локальных треков`);
    }

    // Останавливаем поток демонстрации экрана
    if (this.screenStream) {
      const trackCount = this.screenStream.getTracks().length;
      this.screenStream.getTracks().forEach(track => {
        track.stop();
        console.log(`[VoiceService] 🛑 Остановлен трек демонстрации экрана: ${track.kind}`);
      });
      this.screenStream = null;
      this.isScreenSharing = false;
      console.log(`[VoiceService] ✅ Остановлено ${trackCount} треков демонстрации экрана`);
    }

    // Очищаем контейнер демонстрации экрана
    const screenShareContainer = document.getElementById('screen-share-container-chat');
    if (screenShareContainer) {
      screenShareContainer.innerHTML = '';
      console.log(`[VoiceService] 🗑️ Очищен контейнер демонстрации экрана`);
    }

    // Удаляем все остаточные видео элементы
    const remainingVideos = document.querySelectorAll('video[id^="remote-video-"]');
    remainingVideos.forEach(video => {
      video.remove();
      console.log(`[VoiceService] 🗑️ Удален остаточный video элемент: ${video.id}`);
    });

    // Удаляем все остаточные audio элементы
    const remainingAudios = document.querySelectorAll('audio[id^="remote-audio-"]');
    remainingAudios.forEach(audio => {
      audio.remove();
      console.log(`[VoiceService] 🗑️ Удален остаточный audio элемент: ${audio.id}`);
    });

    this.ws = null;
    this.voiceChannelId = null;
    this.token = null;
    this.iceServers = [];
    this.isConnecting = false;
    
    console.log(`[VoiceService] ✅ Полная очистка ресурсов завершена`);
  }

  private initVoiceActivityDetection() {
    if (!this.localStream) {
      console.warn(`[VoiceService] ⚠️ Не удалось инициализировать детекцию голоса - нет локального потока`);
      return;
    }

    try {
      console.log(`[VoiceService] 🎙️ Инициализируем детекцию голосовой активности`);
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = this.audioContext.createMediaStreamSource(this.localStream);
      this.analyser = this.audioContext.createAnalyser();
      
      this.analyser.fftSize = 256;
      this.analyser.minDecibels = -90;
      this.analyser.maxDecibels = -10;
      this.analyser.smoothingTimeConstant = 0.85;
      
      source.connect(this.analyser);
      
      this.startVoiceActivityDetection();
    } catch (error) {
      // Ошибка инициализации VAD
    }
  }

  private startVoiceActivityDetection() {
    if (!this.analyser) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const checkAudioLevel = () => {
      try {
        this.analyser!.getByteFrequencyData(dataArray);
        
        // Анализируем разные частотные диапазоны
        const lowFreq = dataArray.slice(0, bufferLength / 4);
        const midFreq = dataArray.slice(bufferLength / 4, bufferLength / 2);
        const highFreq = dataArray.slice(bufferLength / 2, bufferLength);
        
        // Вычисляем средние значения для каждого диапазона
        const lowAverage = lowFreq.reduce((a, b) => a + b, 0) / lowFreq.length;
        const midAverage = midFreq.reduce((a, b) => a + b, 0) / midFreq.length;
        const highAverage = highFreq.reduce((a, b) => a + b, 0) / highFreq.length;
        
        // Общий средний уровень с весами
        const totalAverage = (lowAverage * 0.3 + midAverage * 0.5 + highAverage * 0.2);
        
                 // Максимальное значение в средних частотах (голос)
         let maxValue = 0;
         for (let i = 0; i < midFreq.length; i++) {
           if (midFreq[i] > maxValue) {
             maxValue = midFreq[i];
           }
         }
        
        // Порог для определения речи (более чувствительный)
        const speechThreshold = 35;
        const maxThreshold = 80;
        
        const currentlySpeaking = (totalAverage > speechThreshold && maxValue > maxThreshold);
        
        // Отправляем информацию о голосовой активности только при изменении
        if (currentlySpeaking !== this.isSpeaking) {
          this.isSpeaking = currentlySpeaking;
          this.sendMessage({
            type: 'speaking',
            is_speaking: this.isSpeaking
          });
        }
      } catch (error) {
        // Ошибка анализа голосовой активности
      }
    };

    this.vadInterval = setInterval(checkAudioLevel, 100) as any;
  }

  private getCurrentUserId(): number | null {
    if (!this.token) return null;
    
    try {
      const payload = JSON.parse(atob(this.token.split('.')[1]));
      return payload.user_id || null;
    } catch {
      return null;
    }
  }

  private cleanupVoiceActivityDetection() {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    this.analyser = null;
    this.isSpeaking = false;
  }

  onSpeakingChange(callback: (userId: number, isSpeaking: boolean) => void) {
    this.onSpeakingChanged = callback;
  }

  onParticipantsReceived(callback: (participants: any[]) => void) {
    this.onParticipantsReceivedCallback = callback;
  }

  onParticipantStatusChanged(callback: (userId: number, status: Partial<{ is_muted: boolean; is_deafened: boolean }>) => void) {
    this.onParticipantStatusChangedCallback = callback;
  }

  // Демонстрация экрана
  async startScreenShare(): Promise<boolean> {
    try {
      // Получаем поток экрана
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        },
        audio: true // Включаем звук системы если доступен
      });

      // Обрабатываем событие остановки демонстрации экрана
      this.screenStream.getVideoTracks()[0].addEventListener('ended', () => {
        this.stopScreenShare();
      });

      // Обрабатываем событие остановки аудио трека
      const audioTracks = this.screenStream.getAudioTracks();
      if (audioTracks.length > 0) {
        audioTracks[0].addEventListener('ended', () => {
          // Системный звук остановлен
        });
      }

      // Добавляем видео трек ко всем peer connections
      this.peerConnections.forEach(async ({ pc }, userId) => {
        try {
          // Добавляем видео трек
          const videoTracks = this.screenStream!.getVideoTracks();
          if (videoTracks.length > 0) {
            pc.addTrack(videoTracks[0], this.screenStream!);
          }

          // Добавляем системный аудио если доступен
          if (audioTracks.length > 0) {
            const existingAudioSenders = pc.getSenders().filter(sender => 
              sender.track && sender.track.kind === 'audio'
            );
            
            // Добавляем только если это не микрофонный трек
            const isSystemAudio = audioTracks[0].label.includes('System') || 
                                 audioTracks[0].label.includes('Desktop') ||
                                 audioTracks[0].getSettings().deviceId !== 'default';
            
            if (isSystemAudio) {
              pc.addTrack(audioTracks[0], this.screenStream!);
            }
          }

          // Создаем новый offer только если connection state позволяет
          if (pc.connectionState === 'connected' || pc.connectionState === 'new') {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this.sendMessage({
              type: 'offer',
              target_id: userId,
              offer: offer,
            });
          }
        } catch (error) {
          // Ошибка добавления видео трека
        }
      });

      // Создаем локальный видео элемент для стримера
      this.createLocalScreenShareVideo();

      this.isScreenSharing = true;
      
      // Уведомляем сервер о начале демонстрации экрана
      this.sendMessage({ 
        type: 'screen_share_start'
      });

      // Отправляем локальное событие для обновления UI
      const currentUserId = this.getCurrentUserId();
      if (currentUserId) {
        // Получаем имя пользователя из токена или используем "Вы"
        let username = 'Вы';
        try {
          if (this.token) {
            const payload = JSON.parse(atob(this.token.split('.')[1]));
            username = payload.username || 'Вы';
          }
        } catch (error) {
          // Не удалось получить имя пользователя из токена
        }
        
        const event = new CustomEvent('screen_share_start', {
          detail: { 
            user_id: currentUserId,
            username: username
          }
        });
        window.dispatchEvent(event);
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  stopScreenShare() {
    if (!this.screenStream) return;

    // Отправляем локальное событие для немедленного обновления UI
    const userId = this.getCurrentUserId();
    if (userId) {
      const event = new CustomEvent('screen_share_stop', {
        detail: { 
          user_id: userId
        }
      });
      window.dispatchEvent(event);
    }

    // Останавливаем все треки
    this.screenStream.getTracks().forEach(track => {
      track.stop();
    });

    // Удаляем видео треки из всех peer connections
    this.peerConnections.forEach(async ({ pc }, userId) => {
      try {
        const senders = pc.getSenders();
        senders.forEach((sender: RTCRtpSender) => {
          if (sender.track && sender.track.kind === 'video') {
            // Заменяем видео трек на null вместо удаления
            sender.replaceTrack(null).then(() => {
              // Видео трек остановлен
            }).catch(error => {
              // Если replaceTrack не работает, удаляем трек
              pc.removeTrack(sender);
            });
          }
        });

        // Создаем новый offer без видео только если connection активно
        if (pc.connectionState === 'connected') {
          pc.createOffer().then((offer: RTCSessionDescriptionInit) => {
            pc.setLocalDescription(offer);
            this.sendMessage({
              type: 'offer',
              target_id: userId,
              offer: offer,
            });
          }).catch((error: any) => {
            // Ошибка создания offer без видео
          });
        }
      } catch (error) {
        // Ошибка при остановке демонстрации
      }
    });

    this.screenStream = null;
    this.isScreenSharing = false;

    // Удаляем локальный видео элемент
    const currentUserId = this.getCurrentUserId();
    if (currentUserId) {
      const localVideo = document.getElementById(`remote-video-${currentUserId}`) as HTMLVideoElement;
      if (localVideo) {
        localVideo.remove();
      }

      // Уведомляем об остановке демонстрации экрана для локального пользователя
      if (this.onScreenShareChanged) {
        this.onScreenShareChanged(currentUserId, false);
      }

      // Отправляем глобальное событие
      const event = new CustomEvent('screen_share_stop', {
        detail: { 
          user_id: currentUserId
        }
      });
      window.dispatchEvent(event);
    }

    // Уведомляем сервер об остановке демонстрации экрана
    this.sendMessage({ 
      type: 'screen_share_stop'
    });
  }

  getScreenSharingStatus(): boolean {
    return this.isScreenSharing;
  }

  onScreenShareChange(callback: (userId: number, isSharing: boolean) => void) {
    this.onScreenShareChanged = callback;
  }

  private createLocalScreenShareVideo() {
    const currentUserId = this.getCurrentUserId();
    if (!currentUserId || !this.screenStream) return;

    // Создаем видео элемент для локального пользователя
    let localVideo = document.getElementById(`remote-video-${currentUserId}`) as HTMLVideoElement;
    if (!localVideo) {
      localVideo = document.createElement('video');
      localVideo.id = `remote-video-${currentUserId}`;
      localVideo.autoplay = true;
      localVideo.controls = false;
      localVideo.muted = true;
      localVideo.style.position = 'absolute';
      localVideo.style.top = '0';
      localVideo.style.left = '0';
      localVideo.style.width = '100%';
      localVideo.style.height = '100%';
      localVideo.style.objectFit = 'contain';
      localVideo.style.backgroundColor = '#000';
    }
    
    localVideo.srcObject = this.screenStream;
    
    // Ждем появления контейнера в ChatArea (максимум 5 секунд)
    const waitForContainer = (attempts = 0): void => {
      const videoContainer = document.getElementById('screen-share-container-chat');
      
      if (videoContainer) {
        // Контейнер найден, добавляем видео
        videoContainer.innerHTML = '';
        videoContainer.appendChild(localVideo);
        
        // Проверяем, что видео элемент действительно добавлен
        setTimeout(() => {
          const addedVideo = document.getElementById(`remote-video-${currentUserId}`);
          if (addedVideo) {
            // Видео элемент найден в DOM
          }
        }, 1000);
      } else if (attempts < 50) {
        // Контейнер ещё не создан, ждем
        setTimeout(() => waitForContainer(attempts + 1), 100);
      } else {
        // Превышено время ожидания
        localVideo.remove();
        return;
      }
    };
    
    waitForContainer();

    // Уведомляем о начале демонстрации экрана для локального пользователя
    if (this.onScreenShareChanged) {
      this.onScreenShareChanged(currentUserId, true);
    }
  }
}

export default new VoiceService();