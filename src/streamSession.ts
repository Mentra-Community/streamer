import { AppSession } from "@mentra/sdk";

declare module "@mentra/sdk" {
    interface AppSession {
        streamType: 'managed' | 'unmanaged' | null;
        streamStatus: string;
        hlsUrl: string | null;
        dashUrl: string | null;
        streamId: string | null;
        directRtmpUrl: string | null;
        mangedRtmpRestreamUrls: string[] | null;
        error: string | null;
        glassesBatteryPercent: number | null;
        previewUrl: string | null;
        thumbnailUrl: string | null;
        
        // Persist user configuration
        streamPlatform: 'here' | 'youtube' | 'twitch' | 'instagram' | 'other' | null;
        streamKey: string | null;
        customRtmpUrl: string | null;
        useCloudflareManaged: boolean;
        
        // Store active restream destinations
        restreamDestinations?: Array<{
            url: string;
            name: string;
        }>;
    }
}