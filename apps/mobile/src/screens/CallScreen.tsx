import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import { createLKRoom, callsSupported, getVideoTrackComponent, startAudioSession, stopAudioSession } from '../lk';
import type { CallKind } from '@del/shared-types';

/** وضعیت تماس که در سطح اپ نگه داشته می‌شود */
export interface CallState {
  phase: 'outgoing' | 'incoming' | 'active';
  callId: string;
  conversationId: string;
  kind: CallKind;
  peerName: string;
  /** تماس گروهی — نمایش چند شرکت‌کننده + ترک به‌جای پایان */
  group?: boolean;
  /** پس از پاسخ (caller از WS، callee از پاسخ accept) — کلید اتصال LiveKit */
  url?: string;
  token?: string;
}

/** پیام وضعیت به فارسی */
function phaseLabel(phase: CallState['phase'], kind: CallKind, group?: boolean): string {
  if (phase === 'incoming') return `تماس ${kind === 'video' ? 'تصویری' : 'صوتی'} ${group ? 'گروهی ' : ''}ورودی…`;
  if (phase === 'outgoing') return group ? 'در حال زنگ زدن به گروه…' : 'در حال زنگ زدن…';
  return 'در حال اتصال…';
}

/**
 * تماس صوتی/تصویری ۱:۱ (گام ۶)
 * signaling با REST + WS؛ صدا/تصویر مستقیم از LiveKit (SFU) — بایت‌ها از API عبور نمی‌کنند.
 */
export function CallScreen({
  state,
  onAccept,
  onReject,
  onCancel,
  onHangup,
}: {
  state: CallState;
  onAccept: () => void;
  onReject: () => void;
  onCancel: () => void;
  onHangup: () => void;
}) {
  const isVideo = state.kind === 'video';
  const active = state.phase === 'active';

  // ————— اتصال LiveKit —————
  const roomRef = useRef<{ disconnect: () => void } | null>(null);
  const [connected, setConnected] = useState(false);
  /** چند شرکت‌کنندهٔ دور (تماس گروهی): identity → آخرین publication ویدیو (یا null) */
  const [remotes, setRemotes] = useState<{ identity: string; participant: unknown; publication: unknown }[]>([]);
  const [othersCount, setOthersCount] = useState(0);
  const [localRef, setLocalRef] = useState<{ participant: unknown; publication: unknown } | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [connectError, setConnectError] = useState<string | null>(null);
  const VideoTrack = getVideoTrackComponent();

  useEffect(() => {
    if (!active || !state.url || !state.token) return;
    let cancelled = false;

    void (async () => {
      if (!callsSupported()) {
        setConnectError('این بیلد از تماس پشتیبانی نمی‌کند — بیلد توسعه دل را نصب کنید');
        return;
      }
      await startAudioSession();
      let room: any = null;
      try {
        room = createLKRoom({ adaptiveStream: true, dynacast: true });
        if (!room || cancelled) {
          setConnectError('این بیلد از تماس پشتیبانی نمی‌کند');
          return;
        }
        roomRef.current = room;

        /** ثبت/به‌روزرسانی یک شرکت‌کنندهٔ دور — تماس گروهی چند identity دارد */
        const upsertRemote = (participant: any, publication: any | null) => {
          const identity = String(participant?.identity ?? Math.random());
          setRemotes((prev) => {
            const next = prev.filter((r) => r.identity !== identity);
            const hasVideo = publication && (publication.source === 'camera' || publication.videoTrack);
            if (hasVideo) next.push({ identity, participant, publication });
            // اولویت ترتیب: جدیدترها آخر می‌آیند؛ رندر اولین را بزرگ نشان می‌دهد
            return next;
          });
        };

        room.on(
          'trackSubscribed',
          (_track: unknown, publication: any, participant: unknown) => {
            upsertRemote(participant, publication);
          },
        );
        room.on('trackUnsubscribed', (_t: unknown, publication: any, participant: any) => {
          if (publication?.source === 'camera') upsertRemote(participant, null);
        });
        room.on('participantConnected', (participant: unknown) => {
          setOthersCount((n) => n + 1);
          const identity = String((participant as { identity?: string })?.identity ?? '');
          if (identity) upsertRemote(participant, null);
        });
        room.on('participantDisconnected', (participant: unknown) => {
          setOthersCount((n) => Math.max(0, n - 1));
          const identity = String((participant as { identity?: string })?.identity ?? '');
          setRemotes((prev) => prev.filter((r) => r.identity !== identity));
        });
        await room.connect(state.url as string, state.token as string);
        if (cancelled) return;
        const present = Array.from(room.remoteParticipants ?? []) as any[];
        setOthersCount(present.length);
        setConnected(true);
        if (isVideo) {
          await room.localParticipant.setCameraEnabled(true);
          const pub = room.localParticipant.getTrackPublication?.('camera');
          if (pub) setLocalRef({ participant: room.localParticipant, publication: pub });
        }
      } catch (e) {
        if (!cancelled) setConnectError('اتصال تماس برقرار نشد — دوباره تلاش کنید');
      }
    })();

    return () => {
      cancelled = true;
      const r = roomRef.current;
      roomRef.current = null;
      try {
        r?.disconnect();
      } catch {
        /* بی‌اهمیت */
      }
      setConnected(false);
      setRemotes([]);
      setOthersCount(0);
      setLocalRef(null);
      void stopAudioSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, state.callId, state.url, state.token]);

  /** toggle میکروفون */
  const toggleMic = useCallback(async () => {
    const room = roomRef.current as any;
    if (!room) return;
    const next = !micOn;
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicOn(next);
    } catch {
      /* بی‌اهمیت */
    }
  }, [micOn]);

  /** toggle دوربین */
  const toggleCam = useCallback(async () => {
    const room = roomRef.current as any;
    if (!room) return;
    const next = !camOn;
    try {
      await room.localParticipant.setCameraEnabled(next);
      setCamOn(next);
      const pub = next
        ? room.localParticipant.getTrackPublication?.('camera')
        : null;
      setLocalRef(next && pub ? { participant: room.localParticipant, publication: pub } : null);
    } catch {
      /* بی‌اهمیت */
    }
  }, [camOn]);

  const mainRemote = remotes.find((r) => r.publication) ?? remotes[0] ?? null;
  const otherVideos = remotes.filter((r) => r.publication && r !== mainRemote);
  const showRemoteVideo = isVideo && connected && mainRemote?.publication && VideoTrack;
  const showLocalVideo = isVideo && connected && localRef && VideoTrack;
  const groupActive = state.group === true;
  const statusLine = connectError
    ? connectError
    : active
      ? connected
        ? groupActive
          ? isVideo
            ? `تماس تصویری گروهی · ${othersCount} نفر در اتاق`
            : `تماس صوتی گروهی · ${othersCount} نفر در اتاق`
          : isVideo
            ? 'تماس تصویری برقرار است'
            : 'تماس برقرار است'
        : 'در حال اتصال…'
      : phaseLabel(state.phase, state.kind, groupActive);

  return (
    <View style={styles.root}>
      {/* ویدیوی اصلی — تمام‌صفحه */}
      {showRemoteVideo ? (
        <VideoTrack
          trackRef={{
            participant: mainRemote.participant,
            publication: mainRemote.publication,
            source: 'camera',
          }}
          style={StyleSheet.absoluteFill}
          zOrder={0}
        />
      ) : null}

      {/* ویدیوی خودم — PIP بالا-چپ (چپِ RTL) */}
      {showLocalVideo ? (
        <View style={styles.pip}>
          <VideoTrack
            trackRef={{
              participant: localRef.participant,
              publication: localRef.publication,
              source: 'camera',
            }}
            style={styles.pipVideo}
            zOrder={1}
            mirror
          />
        </View>
      ) : null}

      {/* نوار ویدیوهای دیگر اعضا — تماس گروهی تصویری */}
      {isVideo && connected && otherVideos.length ? (
        <View style={styles.strip}>
          {otherVideos.slice(0, 6).map((r) => (
            <View key={r.identity} style={styles.stripItem}>
              <VideoTrack
                trackRef={{
                  participant: r.participant,
                  publication: r.publication,
                  source: 'camera',
                }}
                style={styles.pipVideo}
                zOrder={2}
              />
            </View>
          ))}
        </View>
      ) : null}

      {/* لایه اطلاعات — در تماس تصویری جمع‌وجورتر */}
      <View style={[styles.info, isVideo && connected ? styles.infoCompact : null]} pointerEvents="none">
        {!isVideo || !connected ? (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(state.peerName || '؟').trim().charAt(0)}
            </Text>
          </View>
        ) : null}
        <Text style={styles.peerName} numberOfLines={1}>
          {state.peerName || 'ناشناس'}
        </Text>
        <Text style={styles.statusText}>{statusLine}</Text>
        {!connected && active && !connectError ? (
          <ActivityIndicator color={theme.accent} style={{ marginTop: 12 }} />
        ) : null}
      </View>

      {/* کنترل‌ها */}
      <View style={styles.controls}>
        {state.phase === 'incoming' ? (
          <>
            <TouchableOpacity style={[styles.circle, styles.reject]} onPress={onReject} accessibilityLabel="رد تماس">
              <Text style={styles.icon}>✕</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.circle, styles.accept]} onPress={onAccept} accessibilityLabel="پذیرش تماس">
              <Text style={styles.icon}>✓</Text>
            </TouchableOpacity>
          </>
        ) : active ? (
          <>
            <TouchableOpacity
              style={[styles.circle, !micOn ? styles.circleOff : null]}
              onPress={toggleMic}
              accessibilityLabel="میکروفون"
            >
              <Text style={styles.icon}>{micOn ? '🎙' : '🔇'}</Text>
            </TouchableOpacity>
            {isVideo ? (
              <TouchableOpacity
                style={[styles.circle, !camOn ? styles.circleOff : null]}
                onPress={toggleCam}
                accessibilityLabel="دوربین"
              >
                <Text style={styles.icon}>{camOn ? '📷' : '🚫'}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={[styles.circle, styles.reject]} onPress={onHangup} accessibilityLabel="پایان تماس">
              <Text style={styles.icon}>✕</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={[styles.circle, styles.reject]} onPress={onCancel} accessibilityLabel="لغو تماس">
            <Text style={styles.icon}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: '#071120' },
  info: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 80 },
  infoCompact: { justifyContent: 'flex-start', paddingTop: 90, flex: 0, gap: 4 },
  avatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: theme.accentSoft,
    borderWidth: 2,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  avatarText: { color: theme.accent, fontSize: 44, fontWeight: '800' },
  peerName: { color: theme.text, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  statusText: { color: theme.textDim, fontSize: 15, textAlign: 'center' },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 28,
    paddingBottom: 70,
  },
  circle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleOff: { backgroundColor: 'rgba(143,168,200,0.15)' },
  accept: { backgroundColor: theme.success },
  reject: { backgroundColor: theme.danger },
  icon: { fontSize: 26, color: '#04121F', fontWeight: '800' },
  pip: {
    position: 'absolute',
    top: 70,
    left: 16,
    width: 110,
    height: 150,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.border,
    zIndex: 5,
  },
  pipVideo: { width: '100%', height: '100%' },
  /** نوار افقی ویدیوی دیگر اعضای تماس گروهی — پایینِ PIP */
  strip: {
    position: 'absolute',
    top: 232,
    left: 16,
    flexDirection: 'row',
    gap: 8,
    zIndex: 5,
  },
  stripItem: {
    width: 78,
    height: 104,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: '#0E2440',
  },
});
