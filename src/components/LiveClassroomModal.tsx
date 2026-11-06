/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Video,
  Mic,
  MicOff,
  Camera,
  CameraOff,
  MessageSquare,
  X,
  ExternalLink,
  Send,
  Hand,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.js';
import { formatTime, ensureWesternDigits } from '../i18n/format.js';
import type { SessionEntity } from '../types/index.js';

interface LiveClassroomModalProps {
  session: SessionEntity;
  joinData: {
    videoJoinUrl: string;
    videoProvider: string;
    videoMeetingId: string;
    videoPasscode?: string;
    role?: string;
  };
  onClose: () => void;
  currentUserName: string;
}

export const LiveClassroomModal: React.FC<LiveClassroomModalProps> = ({
  session,
  joinData,
  onClose,
  currentUserName,
}) => {
  const { t } = useTranslation();
  const { language } = useAuth();
  const [micActive, setMicActive] = useState<boolean>(true);
  const [camActive, setCamActive] = useState<boolean>(true);
  const [handRaised, setHandRaised] = useState<boolean>(false);
  const [chatMessages, setChatMessages] = useState<
    Array<{ senderKey?: string; sender?: string; textKey?: string; text?: string; time: string }>
  >([
    { senderKey: 'liveClassroom.systemSender', textKey: 'liveClassroom.welcomeChatMsg', time: '10:00' },
    { sender: 'Prof. Karim Benali', textKey: 'liveClassroom.teacherWelcomeMsg', time: '10:01' },
  ]);
  const [inputMsg, setInputMsg] = useState('');

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMsg.trim()) return;
    const nowTime = formatTime(new Date(), language);
    setChatMessages((prev) => [
      ...prev,
      { sender: currentUserName, text: inputMsg.trim(), time: nowTime },
    ]);
    setInputMsg('');
  };

  const isJitsi =
    joinData.videoProvider === 'JITSI' || joinData.videoJoinUrl.includes('meet.jit.si');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="flex flex-col w-full max-w-6xl h-[90vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-100">
        {/* Header Bar */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 bg-slate-900/90 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 rounded-md shrink-0">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {t('liveClassroom.liveBadge')}
            </span>
            <h2 className="text-base font-semibold text-white truncate max-w-md">
              {session.title}
            </h2>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400 font-mono">
              <span>
                {t('liveClassroom.idLabel')}{' '}
                <span className="ltr-num">{ensureWesternDigits(joinData.videoMeetingId)}</span>
              </span>
              {joinData.videoPasscode && (
                <span>
                  · {t('liveClassroom.passcodeLabel')}{' '}
                  <span className="ltr-num">{ensureWesternDigits(joinData.videoPasscode)}</span>
                </span>
              )}
            </div>

            <a
              href={joinData.videoJoinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5 rtl-flip" />
              <span>{t('liveClassroom.openExternal')}</span>
            </a>

            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Main Stage */}
        <div className="flex flex-1 overflow-hidden relative">
          {/* Video Container */}
          <div className="flex-1 flex flex-col bg-slate-950 relative overflow-hidden">
            {isJitsi ? (
              <iframe
                src={joinData.videoJoinUrl}
                allow="camera; microphone; fullscreen; display-capture; autoplay"
                className="w-full h-full border-0"
                title={t('liveClassroom.iframeTitle')}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center relative">
                <div className="w-24 h-24 rounded-full bg-blue-900/40 border border-blue-600/30 flex items-center justify-center mb-4 text-blue-400">
                  <Video className="w-12 h-12" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">
                  {t('liveClassroom.secureRoomTitle')}
                </h3>
                <p className="text-sm text-slate-400 max-w-lg mb-6 leading-relaxed">
                  {t('liveClassroom.secureRoomDesc')}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <a
                    href={joinData.videoJoinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-lg shadow-blue-600/20"
                  >
                    {t('liveClassroom.launchZoomBtn')}
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* Side Panel: Live Chat */}
          <div className="w-80 bg-slate-900 border-s border-slate-800 flex flex-col">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-400 shrink-0" />
                <span>{t('liveClassroom.liveChatTitle')}</span>
              </span>
              <span className="text-xs text-slate-500 font-mono">
                {t('liveClassroom.participantsCount', { count: 14 })}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {chatMessages.map((msg, i) => (
                <div key={i} className="text-xs text-start">
                  <div className="flex items-center justify-between text-slate-400 mb-0.5">
                    <span className="font-semibold text-slate-200">
                      {msg.senderKey ? t(msg.senderKey) : msg.sender}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono ltr-num">{msg.time}</span>
                  </div>
                  <p className="text-slate-300 bg-slate-800/60 p-2 rounded-lg border border-slate-800 leading-relaxed">
                    {msg.textKey ? t(msg.textKey) : msg.text}
                  </p>
                </div>
              ))}
            </div>

            {/* Chat Input */}
            <form onSubmit={handleSendChat} className="p-3 border-t border-slate-800 flex gap-2">
              <input
                type="text"
                placeholder={t('liveClassroom.askQuestionPlaceholder')}
                value={inputMsg}
                onChange={(e) => setInputMsg(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                className="p-2 text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
              >
                <Send className="w-3.5 h-3.5 rtl-flip" />
              </button>
            </form>
          </div>
        </div>

        {/* Bottom Control Bar */}
        <div className="flex items-center justify-between px-6 py-3 bg-slate-950 border-t border-slate-800 shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="font-medium text-slate-200">{currentUserName}</span>
            <span>·</span>
            <span>
              {t('liveClassroom.rolePrefix')}{' '}
              {joinData.role === 'HOST_TEACHER'
                ? t('roles.hostTeacher')
                : t('roles.connectedStudent')}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setMicActive(!micActive)}
              className={`p-2.5 rounded-xl transition-colors ${
                micActive
                  ? 'bg-slate-800 hover:bg-slate-700 text-white'
                  : 'bg-red-600/20 text-red-400 border border-red-500/30'
              }`}
              title={micActive ? t('liveClassroom.muteMic') : t('liveClassroom.unmuteMic')}
            >
              {micActive ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </button>

            <button
              onClick={() => setCamActive(!camActive)}
              className={`p-2.5 rounded-xl transition-colors ${
                camActive
                  ? 'bg-slate-800 hover:bg-slate-700 text-white'
                  : 'bg-red-600/20 text-red-400 border border-red-500/30'
              }`}
              title={camActive ? t('liveClassroom.disableCam') : t('liveClassroom.enableCam')}
            >
              {camActive ? <Camera className="w-4 h-4" /> : <CameraOff className="w-4 h-4" />}
            </button>

            <button
              onClick={() => setHandRaised(!handRaised)}
              className={`p-2.5 rounded-xl transition-colors ${
                handRaised
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
              title={t('liveClassroom.raiseHand')}
            >
              <Hand className="w-4 h-4" />
            </button>

            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 rounded-xl transition-colors ms-4"
            >
              {t('liveClassroom.leaveSession')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
