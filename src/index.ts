import { ToolCall, AppServer, AppSession, StreamType } from '@mentra/sdk';
import path from 'path';
import { setupExpressRoutes } from './webview';
import { handleToolCall } from './tools';
import { broadcastStreamStatus, formatStreamStatus } from './webview';

const PACKAGE_NAME = process.env.PACKAGE_NAME ?? (() => { throw new Error('PACKAGE_NAME is not set in .env file'); })();
const MENTRAOS_API_KEY = process.env.MENTRAOS_API_KEY ?? (() => { throw new Error('MENTRAOS_API_KEY is not set in .env file'); })();
const PORT = parseInt(process.env.PORT || '3000');

class StreamerApp extends AppServer {
  constructor() {
    super({
      packageName: PACKAGE_NAME,
      apiKey: MENTRAOS_API_KEY,
      port: PORT,
      publicDir: path.join(__dirname, '../public'),
    });

    // Set up Express routes
    setupExpressRoutes(this);
  }

  /** Map to store active user sessions */
  private userSessionsMap = new Map<string, AppSession>();

  /**
   * Handles tool calls from the MentraOS system
   * @param toolCall - The tool call request
   * @returns Promise resolving to the tool call response or undefined
   */
  protected async onToolCall(toolCall: ToolCall): Promise<string | undefined> {
    return handleToolCall(toolCall, toolCall.userId, this.userSessionsMap.get(toolCall.userId));
  }

  /**
   * Handles new user sessions
   * Sets up event listeners and displays welcome message
   * @param session - The app session instance
   * @param sessionId - Unique session identifier
   * @param userId - User identifier
   */
  protected async onSession(session: AppSession, sessionId: string, userId: string): Promise<void> {
    // Track the session for this user
    this.userSessionsMap.set(userId, session);

    session.subscribe(StreamType.MANAGED_STREAM_STATUS);
    session.subscribe(StreamType.RTMP_STREAM_STATUS);

    // Check for existing streams and update UI accordingly
    try {
      const streamInfo = await session.camera.checkExistingStream();

      if (streamInfo.hasActiveStream && streamInfo.streamInfo) {
        console.log('Found existing stream:', streamInfo.streamInfo.type);

        if (streamInfo.streamInfo.type === 'managed') {
          // Managed stream is active - reconnect to it
          console.log('Reconnecting to existing managed stream...');
          
          // The stream is already active, just update our local state
          session.streamType = 'managed';
          session.streamStatus = streamInfo.streamInfo.status || 'active';
          session.hlsUrl = streamInfo.streamInfo.hlsUrl || null;
          session.dashUrl = streamInfo.streamInfo.dashUrl || null;
          session.streamId = streamInfo.streamInfo.streamId || null;
          session.directRtmpUrl = null;
          session.error = null;
          session.previewUrl = streamInfo.streamInfo.previewUrl || null;

          // Broadcast the existing stream info
          broadcastStreamStatus(userId, formatStreamStatus(session));

          // Show notification in glasses
          session.layouts.showTextWall(`📺 Stream already active!\n\nHLS: ${streamInfo.streamInfo.hlsUrl || 'Generating...'}`);
        } else {
          // Unmanaged stream is active
          session.streamType = 'unmanaged';
          session.streamStatus = streamInfo.streamInfo.status || 'active';
          session.hlsUrl = null;
          session.dashUrl = null;
          session.streamId = streamInfo.streamInfo.streamId || null;
          session.directRtmpUrl = streamInfo.streamInfo.rtmpUrl || null;
          session.error = null;

          // Broadcast the existing stream info
          broadcastStreamStatus(userId, formatStreamStatus(session));

          // Show notification in glasses
          session.layouts.showTextWall(`⚠️ Another app is streaming to:\n${streamInfo.streamInfo.rtmpUrl || 'Unknown URL'}`);
        }
      }
    } catch (error) {
      console.error('Error checking existing stream:', error);
      // Continue with normal setup even if check fails
    }

    const statusUnsubscribe = session.camera.onManagedStreamStatus((data) => {
      console.log(data);
      session.streamType = 'managed';
      session.streamStatus = data.status;
      session.hlsUrl = data.hlsUrl ?? null;
      session.dashUrl = data.dashUrl ?? null;
      session.directRtmpUrl = null;
      session.streamId = data.streamId ?? null;
      session.error = null;
      session.previewUrl = data.previewUrl ?? null;
      session.thumbnailUrl = data.thumbnailUrl ?? null;
      // Broadcast updated status to the user's SSE clients
      broadcastStreamStatus(userId, formatStreamStatus(session));
    });

    const rtmpStatusUnsubscribe = session.camera.onStreamStatus((data) => {
      console.log(data);
      session.streamType = 'unmanaged';
      session.streamStatus = data.status;
      session.hlsUrl = null;
      session.dashUrl = null;
      session.streamId = data.streamId ?? null;
      session.mangedRtmpRestreamUrls = null;
      session.error = data.errorDetails ?? null;
      // Broadcast updated status to the user's SSE clients
      broadcastStreamStatus(userId, formatStreamStatus(session));
    });

    // Glasses battery level updates (if available)
    const batteryUnsubscribe = session.events?.onGlassesBattery?.((data: any) => {
      try {
        const pct = typeof data?.percent === 'number' ? data.percent : (typeof data === 'number' ? data : null);
        session.glassesBatteryPercent = pct ?? null;
      } catch {
        session.glassesBatteryPercent = null;
      }
      broadcastStreamStatus(userId, formatStreamStatus(session));
    }) ?? (() => {});

    // Broadcast on disconnect and cleanup the mapping
    const disconnectedUnsubscribe = session.events.onDisconnected((info: any) => {
      try {
        // Only broadcast a disconnected state if the SDK marks it as permanent
        if (info && typeof info === 'object' && info.permanent === true) {
          this.userSessionsMap.delete(userId);
          broadcastStreamStatus(userId, formatStreamStatus(undefined));
        }
        // Otherwise, allow auto-reconnect without UI flicker
      } catch {
        // No-op
      }
    });

    this.addCleanupHandler(() => {
      statusUnsubscribe();
      rtmpStatusUnsubscribe();
      batteryUnsubscribe();
      disconnectedUnsubscribe();
    });

    // Send an initial status snapshot
    broadcastStreamStatus(userId, formatStreamStatus(session));

    // tell the user that they can start streaming via the webview (speak)
  }

  /**
   * Handles stop requests to ensure SSE clients are notified of disconnection
   * and streams are properly terminated
   */
  protected async onStop(sessionId: string, userId: string, reason: string): Promise<void> {
    try {
      // Get the session before cleanup to send explicit stream termination commands
      const session = this.userSessionsMap.get(userId);
      
      // Send explicit stream termination commands
      if (session?.streamType) {
        try {
          if (session.streamType === 'managed') {
            await session.camera.stopManagedStream();
            console.log('Managed stream terminated on app stop');
          } else if (session.streamType === 'unmanaged') {
            await session.camera.stopStream();
            console.log('Unmanaged stream terminated on app stop');
          }
        } catch (streamError) {
          console.error('Error terminating stream on stop:', streamError);
          // Continue with cleanup even if stream stop fails
        }
      }
      
      // Ensure base cleanup (disconnects and clears SDK's active session maps)
      await super.onStop(sessionId, userId, reason);
      // Remove any cached session for this user
      this.userSessionsMap.delete(userId);
    } finally {
      // Broadcast a no-session status so clients update UI promptly
      broadcastStreamStatus(userId, formatStreamStatus(undefined));
    }
  }
}

// Start the server
const app = new StreamerApp();

app.start().catch(console.error);