(function() {
    let currentPlatform = 'here';
    let isStreaming = false;
    let streamType = 'managed';
    let currentStreamStatus = '';
    const logs = [];
    const MAX_LOGS = 100;

    const platformUrls = {
        youtube: 'rtmps://a.rtmps.youtube.com/live2',
        twitch: 'rtmps://live.twitch.tv/app',
        instagram: 'rtmps://live-upload.instagram.com:443/rtmp'
    };

    const elements = {
        statusIndicator: document.getElementById('statusIndicator'),
        statusText: document.getElementById('statusText'),
        streamToggle: document.getElementById('streamToggle'),
        platformButtons: document.querySelectorAll('.platform-btn'),
        streamKeySection: document.getElementById('streamKeySection'),
        rtmpUrlSection: document.getElementById('rtmpUrlSection'),
        cloudflareSection: document.getElementById('cloudflareSection'),
        streamKey: document.getElementById('streamKey'),
        rtmpUrl: document.getElementById('rtmpUrl'),
        cloudflareToggle: document.getElementById('cloudflareToggle'),
        toggleVisibility: document.getElementById('toggleVisibility'),
        livePlayer: document.getElementById('livePlayer'),
        statusLogs: document.getElementById('statusLogs'),
        logsContent: document.getElementById('logsContent'),
        videoOverlay: document.getElementById('videoOverlay'),
        overlayMessage: document.getElementById('overlayMessage'),
        playIcon: document.querySelector('.play-icon'),
        stopIcon: document.querySelector('.stop-icon'),
        batteryIndicator: document.getElementById('batteryIndicator'),
        batteryPercent: document.querySelector('.battery-percent'),
        batteryFill: document.querySelector('.battery-fill')
    };

    function initializeFromData() {
        const hasActiveSession = document.getElementById('hasActiveSession')?.textContent === 'true';
        const initialStreamType = document.getElementById('initialStreamType')?.textContent;
        const initialStreamStatus = document.getElementById('initialStreamStatus')?.textContent;
        const initialPreviewUrl = document.getElementById('initialPreviewUrl')?.textContent;
        const initialError = document.getElementById('initialError')?.textContent;
        
        // Load saved configuration
        const savedPlatform = document.getElementById('savedPlatform')?.textContent || 'here';
        const savedStreamKey = document.getElementById('savedStreamKey')?.textContent || '';
        const savedCustomRtmpUrl = document.getElementById('savedCustomRtmpUrl')?.textContent || '';
        const savedUseCloudflare = document.getElementById('savedUseCloudflare')?.textContent === 'true';
        
        // Restore saved values
        currentPlatform = savedPlatform;
        elements.streamKey.value = savedStreamKey;
        elements.rtmpUrl.value = savedCustomRtmpUrl;
        elements.cloudflareToggle.checked = savedUseCloudflare;

        if (initialStreamStatus) {
            updateStatus(initialStreamStatus, initialStreamType);
            currentStreamStatus = initialStreamStatus;
            streamType = initialStreamType || 'managed';
            
            // Determine button state based on actual status
            const shouldShowStop = isStreamingStatus(initialStreamStatus);
            isStreaming = shouldShowStop;
            updateStreamButton(shouldShowStop);
            
            if (initialPreviewUrl && streamType === 'managed') {
                updateDisplay('preview', initialPreviewUrl);
            } else if (shouldShowStop && streamType === 'unmanaged') {
                updateDisplay('logs');
                addLog('info', 'Stream active: ' + initialStreamStatus);
            }
            
            // Disable controls if streaming
            updateControlsState(shouldShowStop);
        }

        if (initialError) {
            console.error('Initial error:', initialError);
            addLog('error', initialError);
        }
    }
    
    function isStreamingStatus(status) {
        const statusLower = (status || '').toLowerCase();
        return statusLower === 'active' || 
               statusLower === 'streaming' || 
               statusLower === 'connected' ||
               statusLower === 'connecting' ||
               statusLower === 'starting' ||
               statusLower === 'pending' ||
               statusLower === 'stopping' ||
               statusLower === 'disconnecting' ||
               statusLower === 'initializing';
    }

    function updateStatus(status, type) {
        currentStreamStatus = status || '';
        if (type) streamType = type;
        
        const statusLower = status?.toLowerCase() || '';
        
        // Determine visual state based on actual status
        let statusClass = '';
        let displayText = 'Offline';
        
        if (statusLower === 'active' || statusLower === 'streaming' || statusLower === 'connected') {
            statusClass = 'online';
            displayText = 'Live';
        } else if (statusLower === 'connecting' || statusLower === 'starting' || statusLower === 'pending') {
            statusClass = 'connecting';
            displayText = 'Connecting';
        } else if (statusLower === 'stopping' || statusLower === 'disconnecting') {
            statusClass = 'connecting';
            displayText = 'Stopping';
        } else if (statusLower === 'error' || statusLower === 'failed') {
            statusClass = '';
            displayText = 'Error';
        } else if (statusLower === 'idle' || statusLower === 'ready') {
            statusClass = '';
            displayText = 'Ready';
        } else if (status) {
            // Show the actual status if we don't recognize it
            displayText = status;
        }

        elements.statusIndicator.className = 'status-indicator' + (statusClass ? ' ' + statusClass : '');
        elements.statusText.textContent = displayText;
    }

    function updateStreamButton(streaming) {
        if (streaming) {
            elements.streamToggle.classList.add('streaming');
            elements.playIcon.style.display = 'none';
            elements.stopIcon.style.display = 'block';
        } else {
            elements.streamToggle.classList.remove('streaming');
            elements.playIcon.style.display = 'block';
            elements.stopIcon.style.display = 'none';
        }
    }

    function updatePlatformConfig(platform) {
        currentPlatform = platform;
        
        elements.platformButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.platform === platform);
        });

        if (platform === 'here') {
            // "Here" always uses managed streaming, no toggle needed
            elements.streamKeySection.style.display = 'none';
            elements.rtmpUrlSection.style.display = 'none';
            elements.cloudflareSection.style.display = 'none';  // Hide toggle for "here"
            streamType = 'managed';
            elements.cloudflareToggle.checked = true;  // Always true for "here"
        } else if (platform === 'other') {
            elements.streamKeySection.style.display = 'none';
            elements.rtmpUrlSection.style.display = 'block';
            elements.cloudflareSection.style.display = 'block';
            streamType = elements.cloudflareToggle.checked ? 'managed' : 'unmanaged';
        } else {
            elements.streamKeySection.style.display = 'block';
            elements.rtmpUrlSection.style.display = 'none';
            elements.cloudflareSection.style.display = 'block';
            streamType = elements.cloudflareToggle.checked ? 'managed' : 'unmanaged';
        }
        
        // Update overlay message based on stream type
        updateOverlayMessage();
    }

    function getRtmpUrl() {
        if (currentPlatform === 'here') {
            return null;
        } else if (currentPlatform === 'other') {
            return elements.rtmpUrl.value.trim();
        } else {
            const baseUrl = platformUrls[currentPlatform];
            const key = elements.streamKey.value.trim();
            return key ? `${baseUrl}/${key}` : null;
        }
    }

    function updateDisplay(mode, url) {
        if (mode === 'preview' && url) {
            // Show iframe preview for managed streams
            elements.livePlayer.src = url;
            elements.livePlayer.classList.add('visible');
            elements.statusLogs.classList.remove('visible');
            elements.videoOverlay.classList.add('hidden');
        } else if (mode === 'logs') {
            // Show logs for unmanaged streams
            elements.livePlayer.src = '';
            elements.livePlayer.classList.remove('visible');
            elements.statusLogs.classList.add('visible');
            elements.videoOverlay.classList.add('hidden');
        } else {
            // Show overlay when nothing is active
            elements.livePlayer.src = '';
            elements.livePlayer.classList.remove('visible');
            elements.statusLogs.classList.remove('visible');
            elements.videoOverlay.classList.remove('hidden');
        }
    }
    
    function updateOverlayMessage() {
        const useManaged = elements.cloudflareToggle.checked || currentPlatform === 'here';
        if (useManaged) {
            elements.overlayMessage.textContent = 'Stream preview will appear here';
        } else {
            elements.overlayMessage.textContent = 'Status logs will appear here';
        }
    }

    function addLog(type, message) {
        const timestamp = new Date().toLocaleTimeString('en-US', { 
            hour12: false, 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        });
        
        logs.push({ timestamp, type, message });
        
        // Keep only the last MAX_LOGS entries
        if (logs.length > MAX_LOGS) {
            logs.shift();
        }
        
        // Update display if logs are visible
        if (elements.statusLogs.classList.contains('visible')) {
            renderLogs();
        }
    }
    
    function renderLogs() {
        const html = logs.map(log => `
            <div class="log-entry ${log.type}">
                <span class="log-timestamp">${log.timestamp}</span>
                <span class="log-message">${log.message}</span>
            </div>
        `).join('');
        
        elements.logsContent.innerHTML = html;
        // Auto-scroll to bottom
        elements.logsContent.scrollTop = elements.logsContent.scrollHeight;
    }

    async function postJson(url, body) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body || {})
            });
            return await response.json().catch(() => ({ ok: response.ok }));
        } catch (error) {
            console.error('API error:', error);
            return { ok: false, error: error.message };
        }
    }

    async function checkExistingStream() {
        try {
            const response = await fetch('/api/stream/check');
            const result = await response.json();
            
            if (result.ok && result.hasActiveStream && result.streamInfo) {
                addLog('info', `Found existing ${result.streamInfo.type} stream`);
                
                if (result.streamInfo.type === 'managed') {
                    if (result.streamInfo.hlsUrl) {
                        addLog('info', `HLS URL: ${result.streamInfo.hlsUrl}`);
                    }
                    if (result.streamInfo.activeViewers !== undefined) {
                        addLog('info', `Active viewers: ${result.streamInfo.activeViewers}`);
                    }
                } else {
                    const rtmpUrl = result.streamInfo.rtmpUrl || 'Unknown URL';
                    const appId = result.streamInfo.requestingAppId || 'Unknown app';
                    addLog('warning', `Another app (${appId}) is streaming to: ${rtmpUrl}`);
                }
                
                return result;
            }
            
            return { ok: true, hasActiveStream: false };
        } catch (error) {
            console.error('Error checking existing stream:', error);
            return { ok: false, error: error.message };
        }
    }

    async function startStream() {
        // Don't start if already in a streaming state
        if (isStreamingStatus(currentStreamStatus)) return;

        // Check for existing streams first
        const checkResult = await checkExistingStream();
        if (checkResult.hasActiveStream) {
            // Stream is already active, SSE will handle the UI update
            addLog('info', 'Reconnecting to existing stream...');
            return;
        }

        const useManaged = elements.cloudflareToggle.checked || currentPlatform === 'here';
        streamType = useManaged ? 'managed' : 'unmanaged';
        
        // Update UI optimistically
        updateStatus('Connecting');
        isStreaming = true;
        updateStreamButton(true);
        updateControlsState(true);  // Disable controls
        
        if (useManaged) {
            updateDisplay('none');  // Show overlay while connecting
            addLog('info', 'Starting managed stream...');
        } else {
            updateDisplay('logs');  // Show logs immediately for unmanaged
            addLog('info', '--- New stream session ---');
            addLog('info', 'Starting unmanaged RTMP stream...');
        }
        
        // Prepare configuration to save
        const config = {
            platform: currentPlatform,
            streamKey: elements.streamKey.value,
            customRtmpUrl: elements.rtmpUrl.value,
            useCloudflareManaged: elements.cloudflareToggle.checked
        };
        
        if (currentPlatform === 'here' || useManaged) {
            addLog('info', 'Requesting Cloudflare managed stream...');
            const result = await postJson('/api/stream/managed/start', config);
            if (result.ok === false) {
                // Revert on error
                updateStatus('Error');
                isStreaming = false;
                updateStreamButton(false);
                updateControlsState(false);  // Re-enable controls
                updateDisplay('none');
                addLog('error', 'Failed to start: ' + (result.error || 'Unknown error'));
                alert('Failed to start stream: ' + (result.error || 'Unknown error'));
            } else {
                addLog('success', 'Managed stream request sent');
            }
        } else {
            const rtmpUrl = getRtmpUrl();
            if (!rtmpUrl) {
                alert('Please enter a stream key or RTMP URL');
                updateStatus('Offline');
                isStreaming = false;
                updateStreamButton(false);
                updateControlsState(false);  // Re-enable controls
                updateDisplay('none');
                addLog('error', 'No RTMP URL provided');
                return;
            }
            
            addLog('info', 'Connecting to: ' + rtmpUrl.replace(/\/[^\/]*$/, '/****'));  // Hide key in logs
            const result = await postJson('/api/stream/unmanaged/start', { rtmpUrl, ...config });
            if (result.ok === false) {
                // Revert on error
                updateStatus('Error');
                isStreaming = false;
                updateStreamButton(false);
                updateControlsState(false);  // Re-enable controls
                addLog('error', 'Failed to start: ' + (result.error || 'Unknown error'));
                alert('Failed to start stream: ' + (result.error || 'Unknown error'));
            } else {
                addLog('success', 'RTMP stream request sent');
            }
        }
    }

    async function stopStream() {
        // Don't stop if not in a streaming state
        if (!isStreamingStatus(currentStreamStatus)) return;

        // Update UI optimistically
        updateStatus('Stopping');
        isStreaming = true;  // Keep button as "stop" while stopping
        updateStreamButton(true);
        
        addLog('info', 'Stopping stream...');
        
        const endpoint = streamType === 'managed' ? 
            '/api/stream/managed/stop' : 
            '/api/stream/unmanaged/stop';
        
        await postJson(endpoint);
        // Let SSE update the actual status
    }
    
    function updateControlsState(disabled) {
        // Disable/enable platform buttons and inputs when streaming
        elements.platformButtons.forEach(btn => {
            btn.disabled = disabled;
            btn.style.opacity = disabled ? '0.5' : '1';
            btn.style.cursor = disabled ? 'not-allowed' : 'pointer';
        });
        
        elements.streamKey.disabled = disabled;
        elements.rtmpUrl.disabled = disabled;
        elements.cloudflareToggle.disabled = disabled;
        
        if (disabled) {
            elements.toggleVisibility.style.display = 'none';
        } else {
            elements.toggleVisibility.style.display = 'flex';
        }
    }

    // Event listeners
    elements.platformButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            // Don't allow platform changes while streaming
            if (!isStreaming) {
                updatePlatformConfig(btn.dataset.platform);
            }
        });
    });

    elements.streamToggle.addEventListener('click', () => {
        if (isStreaming) {
            stopStream();
        } else {
            startStream();
        }
    });

    elements.toggleVisibility.addEventListener('click', () => {
        const input = elements.streamKey;
        if (input.type === 'password') {
            input.type = 'text';
            elements.toggleVisibility.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
            `;
        } else {
            input.type = 'password';
            elements.toggleVisibility.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                </svg>
            `;
        }
    });

    elements.cloudflareToggle.addEventListener('change', () => {
        streamType = elements.cloudflareToggle.checked ? 'managed' : 'unmanaged';
        updateOverlayMessage();
    });

    // Server-sent events for real-time status updates
    try {
        const es = new EventSource('/stream-status');
        es.addEventListener('status', (evt) => {
            let data = {};
            try { 
                data = JSON.parse(evt.data); 
            } catch(e) {
                console.error('Failed to parse SSE data:', e);
            }

            // Update connection status
            if (data.hasActiveSession !== undefined) {
                const sessionActive = !!data.hasActiveSession;
                if (!sessionActive) {
                    // Session was lost - update everything
                    currentStreamStatus = 'offline';
                    updateStatus('Offline');
                    if (isStreaming) {
                        isStreaming = false;
                        updateStreamButton(false);
                        updateControlsState(false);  // Re-enable controls
                        addLog('error', 'Session lost');
                        // Keep logs visible if they exist
                        if (streamType === 'unmanaged' && logs.length > 0) {
                            updateDisplay('logs');
                        } else {
                            updateDisplay('none');
                        }
                    }
                }
            }

            // Update stream status - always use the actual status from server
            if (data.streamStatus !== undefined) {
                const oldStatus = currentStreamStatus;
                updateStatus(data.streamStatus, data.streamType);
                
                // Log status changes for unmanaged streams
                if (data.streamType === 'unmanaged' && oldStatus !== data.streamStatus) {
                    const statusLower = (data.streamStatus || '').toLowerCase();
                    let logType = 'info';
                    if (statusLower === 'active' || statusLower === 'connected' || statusLower === 'streaming') {
                        logType = 'success';
                    } else if (statusLower === 'error' || statusLower === 'failed') {
                        logType = 'error';
                    } else if (statusLower === 'stopping' || statusLower === 'disconnecting') {
                        logType = 'warning';
                    }
                    addLog(logType, 'Status: ' + data.streamStatus);
                }
                
                // Always update button state based on actual status
                const shouldShowStop = isStreamingStatus(data.streamStatus);
                
                if (shouldShowStop !== isStreaming) {
                    isStreaming = shouldShowStop;
                    updateStreamButton(shouldShowStop);
                    updateControlsState(shouldShowStop);  // Update controls state
                }
                
                // Update display based on stream type and status
                if (shouldShowStop) {
                    if (data.streamType === 'managed' && data.previewUrl) {
                        // Only update if the preview URL has changed to avoid iframe reloads
                        if (elements.livePlayer.src !== data.previewUrl) {
                            updateDisplay('preview', data.previewUrl);
                        }
                    } else if (data.streamType === 'unmanaged') {
                        updateDisplay('logs');
                    }
                } else {
                    // Not streaming - keep logs visible if they exist
                    if (data.streamType === 'unmanaged' && logs.length > 0) {
                        updateDisplay('logs');
                    } else {
                        updateDisplay('none');
                    }
                }
            }

            // Handle URLs for managed streams
            if (data.streamType === 'managed') {
                if (data.hlsUrl) {
                    addLog('info', 'HLS URL available');
                }
                if (data.directRtmpUrl) {
                    addLog('info', 'RTMP ingest URL ready');
                }
            }

            // Handle battery updates from glasses
            if (data.glassesBatteryPercent !== undefined) {
                updateBatteryDisplay(data.glassesBatteryPercent);
            }
            
            // Handle errors
            if (data.error) {
                console.error('Stream error:', data.error);
                addLog('error', data.error);
                if (data.error.toLowerCase().includes('failed') || 
                    data.error.toLowerCase().includes('error')) {
                    updateStatus('Error');
                }
            }
        });

        es.onerror = () => {
            console.log('SSE connection error, will retry...');
        };
    } catch (e) {
        console.error('SSE not supported:', e);
    }

    // Battery display update
    function updateBatteryDisplay(percent) {
        if (percent === null || percent === undefined) {
            // No battery data available
            elements.batteryPercent.textContent = '--';
            elements.batteryFill.setAttribute('width', '0');
            return;
        }
        
        // Update percentage text
        elements.batteryPercent.textContent = percent + '%';
        
        // Update battery fill width
        const fillWidth = Math.max(0, Math.min(16, (percent / 100) * 16));
        elements.batteryFill.setAttribute('width', fillWidth);
        
        // Update color based on level
        elements.batteryIndicator.classList.remove('low', 'medium');
        if (percent <= 20) {
            elements.batteryIndicator.classList.add('low');
        } else if (percent <= 50) {
            elements.batteryIndicator.classList.add('medium');
        }
    }

    // Initialize
    initializeFromData();
    updatePlatformConfig(currentPlatform);
    
    // Check for existing streams on page load
    setTimeout(async () => {
        const checkResult = await checkExistingStream();
        if (checkResult.hasActiveStream && checkResult.streamInfo) {
            addLog('info', 'Existing stream detected on page load');
        }
    }, 500);
})();