/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getIntegrationByProvider } from './db.ts';

export interface ZoomMeetingOptions {
  topic: string;
  startTime: string;
  durationMinutes: number;
  timezone?: string;
  agenda?: string;
}

export interface ZoomMeetingResult {
  isRealZoom: boolean;
  meetingId: string;
  joinUrl: string;
  hostUrl: string;
  passcode: string;
  provider: 'ZOOM' | 'JITSI';
  statusMessage: string;
}

/**
 * Creates a meeting using Zoom Server-to-Server OAuth API (if credentials configured)
 * or a WebRTC interactive classroom (Jitsi Meet).
 */
export async function scheduleMeeting(options: ZoomMeetingOptions): Promise<ZoomMeetingResult> {
  const zoomConfig = await getIntegrationByProvider('ZOOM');

  const accountId = process.env.ZOOM_ACCOUNT_ID || zoomConfig?.config?.accountId || '';
  const clientId = process.env.ZOOM_CLIENT_ID || zoomConfig?.config?.clientId || '';
  const clientSecret = process.env.ZOOM_CLIENT_SECRET || zoomConfig?.config?.clientSecret || '';

  const isConfigured = Boolean(accountId && clientId && clientSecret);

  if (isConfigured && !zoomConfig?.isTestMode) {
    try {
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenUrl = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`;

      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      if (!tokenRes.ok) {
        const errorText = await tokenRes.text();
        console.warn('Erreur obtention token Zoom S2S OAuth:', errorText);
        throw new Error(`Échec authentification Zoom API (${tokenRes.status})`);
      }

      const tokenData = (await tokenRes.json()) as { access_token: string };
      const accessToken = tokenData.access_token;

      const meetingRes = await fetch('https://api.zoom.us/v2/users/me/meetings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          topic: options.topic,
          type: 2,
          start_time: options.startTime,
          duration: options.durationMinutes,
          timezone: options.timezone || 'Africa/Algiers',
          agenda: options.agenda || 'Séance de cours NajahLearn LMS',
          settings: {
            host_video: true,
            participant_video: true,
            join_before_host: false,
            waiting_room: true,
            mute_upon_entry: true,
            audio: 'both',
            auto_recording: 'none',
          },
        }),
      });

      if (!meetingRes.ok) {
        const errDetail = await meetingRes.text();
        throw new Error(`Erreur création réunion Zoom: ${errDetail}`);
      }

      const meetingData = (await meetingRes.json()) as {
        id: number | string;
        join_url: string;
        start_url: string;
        password?: string;
      };

      return {
        isRealZoom: true,
        meetingId: String(meetingData.id),
        joinUrl: meetingData.join_url,
        hostUrl: meetingData.start_url,
        passcode: meetingData.password || 'Najah2026',
        provider: 'ZOOM',
        statusMessage:
          'Réunion créée avec succès via l API officielle Zoom (Server-to-Server OAuth).',
      };
    } catch (err: any) {
      console.warn(
        'Zoom API non accessible, bascule automatique sur mode démo/salle intégrée:',
        err.message
      );
    }
  }

  const cleanTopic = options.topic.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  const roomKey = `najahlearn-${cleanTopic.substring(0, 20)}-${Date.now().toString(36)}`;
  const fakeZoomId = `${Math.floor(800 + Math.random() * 100)} ${Math.floor(1000 + Math.random() * 9000)} ${Math.floor(1000 + Math.random() * 9000)}`;
  const passcode = `DZ${Math.floor(1000 + Math.random() * 9000)}`;

  const jitsiJoinUrl = `https://meet.jit.si/${roomKey}#config.prejoinPageEnabled=false`;

  return {
    isRealZoom: false,
    meetingId: fakeZoomId,
    joinUrl: jitsiJoinUrl,
    hostUrl: jitsiJoinUrl,
    passcode,
    provider: 'JITSI',
    statusMessage:
      'Mode Démo Opérationnel : Salle de visioconférence WebRTC interactive générée (vidéo, micro, partage d écran prêts). Configurable avec vos clés Zoom en production.',
  };
}
