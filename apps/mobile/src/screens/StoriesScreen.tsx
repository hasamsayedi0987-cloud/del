import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { VideoView, useVideoPlayer } from 'expo-video';
import { api, ApiError } from '../api';
import { STORY_BG, fs, useTheme, type DelTheme } from '../theme';
import { Button, Screen, Subtitle, Title } from '../components/ui';
import { faError } from '../faError';
import { storyImageFile, uploadMedia } from '../media';
import type { StoryDto, StoryGroupDto } from '@del/shared-types';

/**
 * استوری‌ها (v1.4) — وضعیت ۲۴ ساعته: متن با پس‌زمینهٔ رنگی، عکس یا ویدیو تا ۶۰ ثانیه (v1.5.4).
 * حلقهٔ بالای صفحه: استوری‌های من و کاربرانی که با آن‌ها گفتگو دارید.
 */
export function StoriesScreen({
  accessToken,
  onSessionExpired,
}: {
  accessToken: string;
  onSessionExpired: () => void;
}) {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const [groups, setGroups] = useState<StoryGroupDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewer, setViewer] = useState<{ group: StoryGroupDto; index: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [storyText, setStoryText] = useState('');
  const [bgKey, setBgKey] = useState('aurora');
  const [busy, setBusy] = useState(false);
  /** آپلود استوری رسانه‌ای در جریان است */
  const [publishing, setPublishing] = useState(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.listStories(accessToken);
      setGroups(res.groups);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onSessionExpired();
    } finally {
      setLoading(false);
    }
  }, [accessToken, onSessionExpired]);

  useEffect(() => {
    void refresh();
    const iv = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(iv);
  }, [refresh]);

  const publishText = async () => {
    if (!storyText.trim()) return;
    setBusy(true);
    try {
      await api.createStory(accessToken, { kind: 'text', text: storyText.trim(), bgKey });
      setStoryText('');
      setCreating(false);
      await refresh();
    } catch (e) {
      Alert.alert('استوری', e instanceof ApiError ? faError(e) : 'ارسال ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  /** آپلود رسانهٔ استوری (بدون گفتگو → مال شخصی) و ساخت استوری */
  const publishMedia = async (
    file: { uri: string; mime: string; name: string; size: number; width?: number; height?: number },
    kind: 'image' | 'video',
  ) => {
    setPublishing(true);
    try {
      const media = await uploadMedia(accessToken, null, file);
      await api.createStory(accessToken, { kind, mediaId: media.id });
      await refresh();
    } catch (e) {
      Alert.alert('استوری', e instanceof ApiError ? faError(e) : 'ارسال استوری ناموفق بود');
    } finally {
      setPublishing(false);
    }
  };

  const publishImageStory = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('دسترسی لازم است', 'برای استوری عکس، دسترسی گالری را تأیید کنید.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      allowsMultipleSelection: false,
    });
    if (res.canceled || !res.assets[0]) return;
    // فشرده‌سازی تا ۱۰۸۰px — آپلود سریع و سبک
    const f = await storyImageFile(res.assets[0].uri);
    await publishMedia(
      { uri: f.uri, mime: 'image/jpeg', size: 0, name: `story-${Date.now()}.jpg`, width: f.width, height: f.height },
      'image',
    );
  };

  /** ویدیوی استوری — سقف ۶۰ ثانیه؛ duration در برخی نسخه‌ها میلی‌ثانیه می‌آید */
  const videoDurationSec = (asset: ImagePicker.ImagePickerAsset): number => {
    const raw = asset.duration ?? 0;
    return raw >= 3600 ? raw / 1000 : raw;
  };

  const publishVideoStory = async (useCamera: boolean) => {
    const perm = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('دسترسی لازم است', useCamera ? 'برای ضبط استوری، دسترسی دوربین را تأیید کنید.' : 'برای استوری ویدیو، دسترسی گالری را تأیید کنید.');
      return;
    }
    const picked = useCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: 60 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsMultipleSelection: false });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    const durS = videoDurationSec(asset);
    if (durS > 62) {
      Alert.alert('استوری ویدیویی', 'ویدیوی استوری حداکثر ۶۰ ثانیه است — ویدیوی کوتاه‌تر انتخاب کنید.');
      return;
    }
    await publishMedia(
      {
        uri: asset.uri,
        mime: asset.mimeType ?? 'video/mp4',
        name: asset.fileName ?? `story-${Date.now()}.mp4`,
        size: asset.fileSize ?? 0,
        width: asset.width,
        height: asset.height,
      },
      'video',
    );
  };

  /** منوی استوری جدید — متن / عکس / ویدیو */
  const newStoryMenu = () => {
    Alert.alert('استوری جدید', 'چه نوع استوری؟', [
      { text: '✍️ متن', onPress: () => setCreating(true) },
      { text: '🖼 عکس', onPress: () => void publishImageStory() },
      { text: '🎥 ویدیو — تا ۶۰ ثانیه', onPress: () => {
        Alert.alert('ویدیوی استوری', 'حداکثر ۶۰ ثانیه — از کجا؟', [
          { text: 'گالری', onPress: () => void publishVideoStory(false) },
          { text: 'دوربین (ضبط)', onPress: () => void publishVideoStory(true) },
          { text: 'انصراف', style: 'cancel' },
        ]);
      } },
      { text: 'انصراف', style: 'cancel' },
    ]);
  };

  const openGroup = (group: StoryGroupDto) => {
    if (!group.stories.length) return;
    setViewer({ group, index: 0 });
    void markSeen(group.stories[0]!);
  };

  const markSeen = async (story: StoryDto) => {
    if (!story.seen) {
      await api.viewStory(accessToken, story.id).catch(() => undefined);
      void refresh();
    }
  };

  const goTo = (group: StoryGroupDto, index: number) => {
    if (index >= group.stories.length) {
      setViewer(null);
      return;
    }
    if (index < 0) {
      setViewer(null);
      return;
    }
    setViewer({ group, index });
    void markSeen(group.stories[index]!);
  };

  // پیشروی خودکار — متن ۶ ثانیه، عکس ۸ ثانیه؛ ویدیو با پایان پخش جلو می‌رود
  useEffect(() => {
    if (!viewer) return;
    const story = viewer.group.stories[viewer.index];
    if (!story) return;
    const ms = story.kind === 'image' ? 8000 : story.kind === 'video' ? 0 : 6000;
    if (!ms) return;
    advanceTimer.current = setTimeout(() => {
      setViewer((cur) => {
        if (!cur) return null;
        const next = cur.index + 1;
        return next < cur.group.stories.length ? { ...cur, index: next } : null;
      });
    }, ms);
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, [viewer]);

  return (
    <Screen>
      <View style={styles.header}>
        <TouchableOpacity onPress={newStoryMenu}>
          <Text style={styles.add}>+ استوری جدید</Text>
        </TouchableOpacity>
        <Title>استوری‌ها</Title>
      </View>
      <Subtitle>۲۴ ساعت دیده می‌شود — فقط کسانی که با آن‌ها گفتگو دارید</Subtitle>

      {loading ? (
        <Subtitle>در حال بارگذاری…</Subtitle>
      ) : groups.length === 0 ? (
        <View style={{ marginTop: 40, alignItems: 'center' }}>
          <Text style={styles.emptyIcon}>✨</Text>
          <Title>هنوز استوری‌ای نیست</Title>
          <Subtitle>اولین استوری را با «+ استوری جدید» بسازید</Subtitle>
        </View>
      ) : (
        <View style={styles.ringsWrap}>
          {groups.map((g) => {
            const first = g.stories[0]!;
            return (
              <TouchableOpacity key={g.userId} style={styles.ring} onPress={() => openGroup(g)}>
                <View style={[styles.ringCircle, g.hasNew && styles.ringNew]}>
                  <Text style={styles.ringLetter}>
                    {(g.userName ?? '؟').trim().charAt(0) || '؟'}
                  </Text>
                </View>
                <Text style={styles.ringName} numberOfLines={1}>
                  {g.userName ?? 'کاربر'}
                </Text>
                <Text style={styles.ringCount}>{toFa(g.stories.length)} استوری</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* ساخت استوری متنی */}
      <Modal visible={creating} transparent animationType="fade">
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Title>استوری متنی</Title>
            <Subtitle>متن + پس‌زمینه — تا ۲۴ ساعت</Subtitle>
            <View style={[styles.preview, STORY_BG[bgKey] ? { backgroundColor: STORY_BG[bgKey]!.colors[0] } : null]}>
              <Text style={[styles.previewText, { color: STORY_BG[bgKey]?.text ?? '#fff' }]}>
                {storyText.trim() || 'پیش‌نمایش استوری شما'}
              </Text>
            </View>
            <View style={styles.bgRow}>
              {Object.entries(STORY_BG).map(([key, val]) => (
                <TouchableOpacity
                  key={key}
                  onPress={() => setBgKey(key)}
                  style={[styles.bgDot, { backgroundColor: val.colors[0] }, bgKey === key && styles.bgDotOn]}
                />
              ))}
            </View>
            <TextInput
              value={storyText}
              onChangeText={(t) => setStoryText(t.slice(0, 200))}
              placeholder="متن استوری…"
              placeholderTextColor={theme.textDim}
              multiline
              style={styles.input}
              textAlign="right"
            />
            {busy ? null : <Button label="انتشار" onPress={publishText} busy={busy} disabled={!storyText.trim()} />}
            <Button label="انصراف" variant="ghost" onPress={() => setCreating(false)} />
          </View>
        </View>
      </Modal>

      {/* آپلود استوری رسانه‌ای */}
      <Modal visible={publishing} transparent animationType="fade">
        <View style={styles.backdrop}>
          <View style={styles.publishCard}>
            <ActivityIndicator size="large" color="#38BDF8" />
            <Text style={styles.publishText}>در حال انتشار استوری…</Text>
            <Text style={styles.publishHint}>بسته به حجم فایل تا یک دقیقه</Text>
          </View>
        </View>
      </Modal>

      {/* نمایشگر استوری */}
      <Modal visible={viewer !== null} transparent animationType="slide">
        {viewer ? (
          <View style={styles.viewer}>
            <View style={styles.viewerBars}>
              {viewer.group.stories.map((s, i) => (
                <View
                  key={s.id}
                  style={[styles.bar, i <= viewer.index ? styles.barOn : null]}
                />
              ))}
            </View>
            <View style={styles.viewerHead}>
              <Text style={styles.viewerName}>{viewer.group.userName ?? 'کاربر'}</Text>
              <TouchableOpacity onPress={() => setViewer(null)}>
                <Text style={styles.viewerClose}>✕</Text>
              </TouchableOpacity>
            </View>
            {(() => {
              const story = viewer.group.stories[viewer.index]!;
              const bg = STORY_BG[story.bgKey] ?? STORY_BG.aurora!;
              return (
                <View style={[styles.storyBody, { backgroundColor: bg.colors[0] }]}>
                  {story.hasMedia && (story.kind === 'image' || story.kind === 'video') ? (
                    <StoryMedia
                      token={accessToken}
                      story={story}
                      onEnd={() => goTo(viewer.group, viewer.index + 1)}
                    />
                  ) : (
                    <Text style={[styles.storyText, { color: story.textColor || bg.text }]}>
                      {story.text}
                    </Text>
                  )}
                </View>
              );
            })()}
            <View style={styles.viewerNav}>
              <TouchableOpacity
                style={styles.navHalf}
                onPress={() => goTo(viewer.group, viewer.index - 1)}
              >
                <Text style={styles.navText}>قبلی ›</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.navHalf}
                onPress={() => goTo(viewer.group, viewer.index + 1)}
              >
                <Text style={styles.navText}>‹ بعدی</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </Modal>
    </Screen>
  );
}

/** رسانهٔ استوری — URL امضاشده می‌گیرد؛ ویدیو را با expo-video پخش می‌کند */
function StoryMedia({
  token,
  story,
  onEnd,
}: {
  token: string;
  story: StoryDto;
  onEnd: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    setFailed(false);
    api
      .getStoryUrl(token, story.id)
      .then((r) => {
        if (alive) setUrl(r.url);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [token, story.id]);

  if (failed) {
    return <Text style={smStyles.failed}>رسانهٔ استوری در دسترس نیست</Text>;
  }
  if (!url) {
    return <ActivityIndicator size="large" color="#FFFFFF" />;
  }
  if (story.kind === 'video') {
    return <VideoStory url={url} onEnd={onEnd} />;
  }
  return <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="contain" />;
}

/** پخش ویدیوی استوری — پایان پخش = استوری بعدی */
function VideoStory({ url, onEnd }: { url: string; onEnd: () => void }) {
  const player = useVideoPlayer(url, (p) => {
    p.play();
  });
  useEffect(() => {
    const sub = player.addListener('playToEnd', onEnd);
    return () => sub.remove();
  }, [player, onEnd]);
  return <VideoView style={StyleSheet.absoluteFill} player={player} contentFit="contain" />;
}

const smStyles = StyleSheet.create({
  failed: { color: '#FFFFFF', fontSize: 15, textAlign: 'center', padding: 20 },
});

function toFa(n: number): string {
  return String(n).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)] ?? d);
}

const makeStyles = (theme: DelTheme) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row-reverse',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    add: { color: theme.accent, fontSize: fs(15), fontWeight: '700', padding: 8 },
    emptyIcon: { fontSize: 44, marginBottom: 8 },
    ringsWrap: {
      flexDirection: 'row-reverse',
      flexWrap: 'wrap',
      gap: 18,
      marginTop: 20,
      justifyContent: 'center',
    },
    ring: { alignItems: 'center', width: 84 },
    ringCircle: {
      width: 68,
      height: 68,
      borderRadius: 34,
      borderWidth: 2,
      borderColor: theme.border,
      backgroundColor: theme.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ringNew: { borderColor: theme.accent, borderWidth: 3 },
    ringLetter: { color: theme.accent, fontSize: fs(26), fontWeight: '800' },
    ringName: { color: theme.text, fontSize: fs(13), marginTop: 6, fontWeight: '700' },
    ringCount: { color: theme.textDim, fontSize: fs(11), marginTop: 1 },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(4,12,24,0.8)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    card: {
      width: '100%',
      maxWidth: 380,
      backgroundColor: theme.surfaceAlt,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: theme.radius,
      padding: 20,
    },
    publishCard: {
      backgroundColor: theme.surfaceAlt,
      borderRadius: theme.radius,
      paddingVertical: 32,
      paddingHorizontal: 28,
      alignItems: 'center',
      gap: 12,
    },
    publishText: { color: theme.text, fontSize: fs(15), fontWeight: '700' },
    publishHint: { color: theme.textDim, fontSize: fs(12) },
    preview: {
      borderRadius: theme.radius,
      paddingVertical: 40,
      paddingHorizontal: 16,
      marginTop: 14,
      alignItems: 'center',
    },
    previewText: { fontSize: fs(18), fontWeight: '700', textAlign: 'center' },
    bgRow: { flexDirection: 'row-reverse', gap: 10, marginTop: 12, justifyContent: 'center' },
    bgDot: { width: 34, height: 34, borderRadius: 17, opacity: 0.7 },
    bgDotOn: { opacity: 1, borderWidth: 3, borderColor: theme.text },
    input: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: theme.radius,
      color: theme.text,
      fontSize: fs(16),
      paddingVertical: 12,
      paddingHorizontal: 16,
      marginTop: 12,
      minHeight: 72,
      textAlignVertical: 'top',
    },
    viewer: { flex: 1, backgroundColor: '#000000' },
    viewerBars: {
      flexDirection: 'row-reverse',
      gap: 4,
      paddingHorizontal: 14,
      paddingTop: 46,
    },
    bar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)' },
    barOn: { backgroundColor: '#FFFFFF' },
    viewerHead: {
      flexDirection: 'row-reverse',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    viewerName: { color: '#FFFFFF', fontSize: fs(15), fontWeight: '800' },
    viewerClose: { color: '#FFFFFF', fontSize: 20, padding: 6 },
    storyBody: {
      flex: 1,
      marginHorizontal: 10,
      borderRadius: 18,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
    },
    storyText: {
      fontSize: fs(26),
      fontWeight: '800',
      textAlign: 'center',
      lineHeight: fs(42),
      paddingHorizontal: 24,
    },
    viewerNav: { flexDirection: 'row-reverse', height: 64 },
    navHalf: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    navText: { color: 'rgba(255,255,255,0.85)', fontSize: fs(14) },
  });
