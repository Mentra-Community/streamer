import { ToolCall, AppSession } from '@mentra/sdk';
import { broadcastStreamStatus, formatStreamStatus } from './webview';

/**
 * Handle a tool call
 * @param toolCall - The tool call from the server
 * @param userId - The user ID of the user who called the tool
 * @param session - The session object if the user has an active session
 * @returns A promise that resolves to the tool call result
 */
export async function handleToolCall(toolCall: ToolCall, userId: string, session: AppSession|undefined): Promise<string | undefined> {
  console.log(`Tool called: ${toolCall.toolId}`);
  console.log(`Tool call timestamp: ${toolCall.timestamp}`);
  console.log(`Tool call userId: ${toolCall.userId}`);
  if (toolCall.toolParameters && Object.keys(toolCall.toolParameters).length > 0) {
    console.log("Tool call parameter values:", toolCall.toolParameters);
  }

  if (toolCall.toolId === "start_streaming") {
    if (!session) {
      return "Error: No active session";
    }

    try {
      // Get parameters with defaults
      const platform = (toolCall.toolParameters?.platform as string) || session.streamPlatform || 'here';
      const streamKey = (toolCall.toolParameters?.streamKey as string) || session.streamKey || '';
      const customRtmpUrl = (toolCall.toolParameters?.customRtmpUrl as string) || session.customRtmpUrl || '';
      const useCloudflareManaged = (toolCall.toolParameters?.useCloudflareManaged as boolean) ?? session.useCloudflareManaged ?? true;

      // Save configuration
      session.streamPlatform = platform as any;
      session.streamKey = streamKey;
      session.customRtmpUrl = customRtmpUrl;
      session.useCloudflareManaged = useCloudflareManaged;

      if (platform === 'here' || useCloudflareManaged) {
        // Managed stream
        let options: any = undefined;

        if (platform !== 'here') {
          let restreamUrl: string | undefined;

          if (platform === 'other') {
            restreamUrl = customRtmpUrl || undefined;
          } else {
            const platformUrls: Record<string, string> = {
              youtube: 'rtmps://a.rtmps.youtube.com/live2',
              twitch: 'rtmps://live.twitch.tv/app',
              instagram: 'rtmps://live-upload.instagram.com:443/rtmp'
            };
            const baseUrl = platformUrls[platform];
            if (baseUrl && streamKey) {
              restreamUrl = `${baseUrl}/${streamKey}`;
            }
          }

          if (restreamUrl) {
            options = {
              restreamDestinations: [{
                url: restreamUrl,
                name: platform
              }]
            };
            session.restreamDestinations = options.restreamDestinations;
          }
        }

        session.camera.startManagedStream(options).then(() => {
          broadcastStreamStatus(userId, formatStreamStatus(session));
        });
        return "Stream started successfully";
      } else {
        // Unmanaged stream
        let rtmpUrl: string | undefined;

        if (platform === 'other') {
          rtmpUrl = customRtmpUrl;
        } else {
          const platformUrls: Record<string, string> = {
            youtube: 'rtmps://a.rtmps.youtube.com/live2',
            twitch: 'rtmps://live.twitch.tv/app',
            instagram: 'rtmps://live-upload.instagram.com:443/rtmp'
          };
          const baseUrl = platformUrls[platform];
          if (baseUrl && streamKey) {
            rtmpUrl = `${baseUrl}/${streamKey}`;
          }
        }

        if (!rtmpUrl) {
          return "Error: Missing RTMP URL or stream key";
        }

        session.camera.startStream({ rtmpUrl }).then(() => {
          broadcastStreamStatus(userId, formatStreamStatus(session));
        });
        return "Stream started successfully";
      }
    } catch (error: any) {
      console.error("Error starting stream:", error);
      return `Error: ${error?.message || error}`;
    }
  } else if (toolCall.toolId === "stop_streaming") {
    if (!session) {
      return "Error: No active session";
    }

    try {
      if (session.streamType === 'managed') {
        session.camera.stopManagedStream().then(() => {
          broadcastStreamStatus(userId, formatStreamStatus(session));
        });
      } else if (session.streamType === 'unmanaged') {
        session.camera.stopStream().then(() => {
          broadcastStreamStatus(userId, formatStreamStatus(session));
        });
      } else {
        return "No active stream to stop";
      }

      return "Stream stopped successfully";
    } catch (error: any) {
      console.error("Error stopping stream:", error);
      return `Error: ${error?.message || error}`;
    }
  }

  return undefined;
}