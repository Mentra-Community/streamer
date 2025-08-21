import { AuthenticatedRequest, AppServer } from '@mentra/sdk';
import type { AppSession } from '@mentra/sdk';
import express, { Response } from 'express';
import path from 'path';

/**
 * Sets up all Express routes and middleware for the server
 * @param server The server instance
 */
export function setupExpressRoutes(server: AppServer): void {
  // Get the Express app instance
  const app = server.getExpressApp();
  // JSON parser for API routes
  app.use(express.json());

  // Set up EJS as the view engine
  app.set('view engine', 'ejs');
  app.engine('ejs', require('ejs').__express);
  app.set('views', path.join(__dirname, 'views'));

  // Register a route for handling webview requests
  app.get('/webview', (req: AuthenticatedRequest, res: any) => {
    if (req.authUserId) {
      // Render the webview template
      res.render('webview', {
        userId: req.authUserId,
        hasActiveSession: req.activeSession !== null,
        streamType: req.activeSession?.streamType,
        streamStatus: req.activeSession?.streamStatus,
        hlsUrl: req.activeSession?.hlsUrl,
        dashUrl: req.activeSession?.dashUrl,
        streamId: req.activeSession?.streamId,
        directRtmpUrl: req.activeSession?.directRtmpUrl,
        mangedRtmpRestreamUrls: req.activeSession?.mangedRtmpRestreamUrls,
        previewUrl: req.activeSession?.previewUrl,
        error: req.activeSession?.error,
        // Pass saved configuration
        streamPlatform: req.activeSession?.streamPlatform ?? 'here',
        streamKey: req.activeSession?.streamKey ?? '',
        customRtmpUrl: req.activeSession?.customRtmpUrl ?? '',
        useCloudflareManaged: req.activeSession?.useCloudflareManaged ?? false,
      });
    } else {
      res.redirect('/mentra-auth');
    }
  });

  // Server-Sent Events endpoint for real-time stream status updates
  app.get('/stream-status', (req: any, res: any) => {
    if (!req.authUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Prepare SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Let the client know how long to wait before retrying
    res.write('retry: 3000\n\n');

    // Send initial status immediately
    const initial = formatStreamStatus(req.activeSession ?? undefined);
    writeSseEvent(res, 'status', initial);

    // Track the connection for this user
    const userId = req.authUserId;
    let clientSet = sseClientsByUser.get(userId);
    if (!clientSet) {
      clientSet = new Set<Response>();
      sseClientsByUser.set(userId, clientSet);
    }
    clientSet.add(res);

    // Heartbeat to keep proxies from closing the connection
    const heartbeat = setInterval(() => {
      try {
        res.write(': keep-alive\n\n');
      } catch {
        // No-op; close will clean up
      }
    }, 15000);

    // Periodic status pings so clients can reflect session availability even without stream events
    const statusPing = setInterval(() => {
      try {
        const snapshot = formatStreamStatus(req.activeSession ?? undefined);
        // Avoid flicker: if there was a recent successful heartbeat write, do not force a snapshot too frequently
        writeSseEvent(res, 'status', snapshot);
      } catch {
        // Ignore write errors; close will clean up
      }
    }, 20000);

    // Clean up on client disconnect
    req.on('close', () => {
      clearInterval(heartbeat);
      clearInterval(statusPing);
      const set = sseClientsByUser.get(userId);
      if (set) {
        set.delete(res);
        if (set.size === 0) {
          sseClientsByUser.delete(userId);
        }
      }
    });
  });

  // API: Start managed stream ("Stream to here")
  app.post('/api/stream/managed/start', async (req: AuthenticatedRequest, res: any) => {
    try {
      if (!req.authUserId || !req.activeSession) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      // Save configuration
      if (req.body?.platform) req.activeSession.streamPlatform = req.body.platform;
      if (req.body?.streamKey !== undefined) req.activeSession.streamKey = req.body.streamKey;
      if (req.body?.customRtmpUrl !== undefined) req.activeSession.customRtmpUrl = req.body.customRtmpUrl;
      if (req.body?.useCloudflareManaged !== undefined) req.activeSession.useCloudflareManaged = req.body.useCloudflareManaged;

      // Build ManagedStreamOptions with restream destinations if platform is not 'here'
      let options: any = undefined;
      if (req.activeSession.streamPlatform && req.activeSession.streamPlatform !== 'here') {
        let restreamUrl: string | undefined;
        
        // Determine the RTMP URL based on platform
        if (req.activeSession.streamPlatform === 'other') {
          restreamUrl = req.activeSession.customRtmpUrl || undefined;
        } else {
          const platformUrls: Record<string, string> = {
            youtube: 'rtmps://a.rtmps.youtube.com/live2',
            twitch: 'rtmps://live.twitch.tv/app',
            instagram: 'rtmps://live-upload.instagram.com:443/rtmp'
          };
          const baseUrl = platformUrls[req.activeSession.streamPlatform];
          if (baseUrl && req.activeSession.streamKey) {
            restreamUrl = `${baseUrl}/${req.activeSession.streamKey}`;
          }
        }
        
        if (restreamUrl) {
          options = {
            restreamDestinations: [{
              url: restreamUrl,
              name: req.activeSession.streamPlatform
            }]
          };
          // Store the restream destinations in the session
          req.activeSession.restreamDestinations = options.restreamDestinations;
        }
      }

      await (req.activeSession as AppSession).camera.startManagedStream(options);
      broadcastStreamStatus(req.authUserId, formatStreamStatus(req.activeSession));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  // API: Stop managed stream
  app.post('/api/stream/managed/stop', async (req: any, res: any) => {
    try {
      if (!req.authUserId || !req.activeSession) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      
      // First check if there's an existing stream to stop
      const streamInfo = await req.activeSession.camera.checkExistingStream();
      
      if (streamInfo.hasActiveStream && streamInfo.streamInfo?.type === 'managed') {
        // There is a managed stream, try to stop it
        await req.activeSession.camera.stopManagedStream();
        req.activeSession.streamType = null;
        req.activeSession.streamStatus = 'idle';
        req.activeSession.hlsUrl = null;
        req.activeSession.dashUrl = null;
        req.activeSession.streamId = null;
        req.activeSession.previewUrl = null;
        broadcastStreamStatus(req.authUserId, formatStreamStatus(req.activeSession));
        res.json({ ok: true });
      } else {
        // No managed stream found
        console.log('No managed stream found to stop');
        req.activeSession.streamType = null;
        req.activeSession.streamStatus = 'idle';
        broadcastStreamStatus(req.authUserId, formatStreamStatus(req.activeSession));
        res.json({ ok: true, message: 'No stream to stop' });
      }
    } catch (err: any) {
      console.error('Error stopping managed stream:', err);
      // Even if stop fails, update UI to reflect no stream
      if (req.activeSession) {
        req.activeSession.streamType = null;
        req.activeSession.streamStatus = 'idle';
        broadcastStreamStatus(req.authUserId, formatStreamStatus(req.activeSession));
      }
      res.status(400).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  // API: Start unmanaged RTMP stream to a given endpoint
  // Docs reference: https://mentra-new-docs.mintlify.app/camera/rtmp-streaming.md
  app.post('/api/stream/unmanaged/start', async (req: any, res: any) => {
    try {
      if (!req.authUserId || !req.activeSession) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const rtmpUrl: string | undefined = req.body?.rtmpUrl;
      if (!rtmpUrl) {
        res.status(400).json({ ok: false, error: 'Missing rtmpUrl' });
        return;
      }
      // Save configuration
      if (req.body?.platform) req.activeSession.streamPlatform = req.body.platform;
      if (req.body?.streamKey !== undefined) req.activeSession.streamKey = req.body.streamKey;
      if (req.body?.customRtmpUrl !== undefined) req.activeSession.customRtmpUrl = req.body.customRtmpUrl;
      if (req.body?.useCloudflareManaged !== undefined) req.activeSession.useCloudflareManaged = req.body.useCloudflareManaged;

      await req.activeSession.camera.startStream({ rtmpUrl });
      broadcastStreamStatus(req.authUserId, formatStreamStatus(req.activeSession));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  // API: Stop unmanaged RTMP stream
  app.post('/api/stream/unmanaged/stop', async (req: any, res: any) => {
    try {
      if (!req.authUserId || !req.activeSession) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      
      // First check if there's an existing stream to stop
      const streamInfo = await req.activeSession.camera.checkExistingStream();
      
      if (streamInfo.hasActiveStream && streamInfo.streamInfo?.type === 'unmanaged') {
        // There is an unmanaged stream, try to stop it
        await req.activeSession.camera.stopStream();
        req.activeSession.streamType = null;
        req.activeSession.streamStatus = 'idle';
        req.activeSession.directRtmpUrl = null;
        req.activeSession.streamId = null;
        broadcastStreamStatus(req.authUserId, formatStreamStatus(req.activeSession));
        res.json({ ok: true });
      } else {
        // No unmanaged stream found
        console.log('No unmanaged stream found to stop');
        req.activeSession.streamType = null;
        req.activeSession.streamStatus = 'idle';
        broadcastStreamStatus(req.authUserId, formatStreamStatus(req.activeSession));
        res.json({ ok: true, message: 'No stream to stop' });
      }
    } catch (err: any) {
      console.error('Error stopping unmanaged stream:', err);
      // Even if stop fails, update UI to reflect no stream
      if (req.activeSession) {
        req.activeSession.streamType = null;
        req.activeSession.streamStatus = 'idle';
        broadcastStreamStatus(req.authUserId, formatStreamStatus(req.activeSession));
      }
      res.status(400).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  // API: Check for existing streams
  app.get('/api/stream/check', async (req: AuthenticatedRequest, res: any) => {
    try {
      if (!req.authUserId || !req.activeSession) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      
      const streamInfo = await (req.activeSession as AppSession).camera.checkExistingStream();
      
      if (streamInfo.hasActiveStream && streamInfo.streamInfo) {
        // Update session state with existing stream info
        const session = req.activeSession;
        
        if (streamInfo.streamInfo.type === 'managed') {
          session.streamType = 'managed';
          session.streamStatus = streamInfo.streamInfo.status || 'active';
          session.hlsUrl = streamInfo.streamInfo.hlsUrl || null;
          session.dashUrl = streamInfo.streamInfo.dashUrl || null;
          session.streamId = streamInfo.streamInfo.streamId || null;
          session.directRtmpUrl = null;
          session.error = null;
          session.previewUrl = streamInfo.streamInfo.previewUrl || streamInfo.streamInfo.webrtcUrl || null;
        } else {
          session.streamType = 'unmanaged';
          session.streamStatus = streamInfo.streamInfo.status || 'active';
          session.hlsUrl = null;
          session.dashUrl = null;
          session.streamId = streamInfo.streamInfo.streamId || null;
          session.directRtmpUrl = streamInfo.streamInfo.rtmpUrl || null;
          session.error = null;
        }
        
        // Broadcast updated status
        broadcastStreamStatus(req.authUserId, formatStreamStatus(session));
      }
      
      res.json({
        ok: true,
        hasActiveStream: streamInfo.hasActiveStream,
        streamInfo: streamInfo.streamInfo
      });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: String(err?.message ?? err) });
    }
  });

  // API: Start managed stream with RTMP restream targets (may not be supported yet)
  // Cloudflare Stream Live restreaming: https://developers.cloudflare.com/stream/stream-live/watch-live-stream/
  app.post('/api/stream/managed/restream/start', async (req: any, res: any) => {
    try {
      if (!req.authUserId || !req.activeSession) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const restreamUrls: string[] | undefined = req.body?.restreamUrls;
      if (!Array.isArray(restreamUrls) || restreamUrls.length === 0) {
        res.status(400).json({ ok: false, error: 'Provide restreamUrls: string[]' });
        return;
      }
      
      // Build ManagedStreamOptions with restream destinations
      const options = {
        restreamDestinations: restreamUrls.map((url, index) => ({
          url: url,
          name: `destination-${index + 1}`
        }))
      };
      
      // Store the restream destinations in the session
      req.activeSession.restreamDestinations = options.restreamDestinations;
      
      await req.activeSession.camera.startManagedStream(options);
      broadcastStreamStatus(req.authUserId, formatStreamStatus(req.activeSession));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: String(err?.message ?? err) });
    }
  });
}

/**
 * JSON payload that describes the current stream status for the control panel.
 */
export type StreamStatusPayload = {
  streamType: 'managed' | 'unmanaged' | null;
  streamStatus?: string;
  hlsUrl?: string | null;
  dashUrl?: string | null;
  streamId?: string | null;
  directRtmpUrl?: string | null;
  mangedRtmpRestreamUrls?: string[] | null;
  previewUrl?: string | null;
  error?: string | null;
  glassesBatteryPercent?: number | null;
  hasActiveSession?: boolean;
};

/**
 * Builds a serializable status payload from an AppSession.
 */
export function formatStreamStatus(session?: AppSession): StreamStatusPayload {
  return {
    streamType: session?.streamType ?? null,
    streamStatus: session?.streamStatus,
    hlsUrl: session?.hlsUrl ?? null,
    dashUrl: session?.dashUrl ?? null,
    streamId: session?.streamId ?? null,
    directRtmpUrl: session?.directRtmpUrl ?? null,
    mangedRtmpRestreamUrls: session?.mangedRtmpRestreamUrls ?? null,
    previewUrl: session?.previewUrl ?? null,
    error: session?.error ?? null,
    glassesBatteryPercent: session?.glassesBatteryPercent ?? null,
    hasActiveSession: !!session,
  };
}

/**
 * Broadcasts a status update to all active SSE clients for a user.
 */
export function broadcastStreamStatus(userId: string, status: StreamStatusPayload): void {
  const clients = sseClientsByUser.get(userId);
  if (!clients || clients.size === 0) return;
  for (const res of clients) {
    writeSseEvent(res, 'status', status);
  }
}

/**
 * Writes a single SSE event to the given response.
 */
function writeSseEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// In-memory registry of SSE clients keyed by userId
const sseClientsByUser = new Map<string, Set<Response>>();
