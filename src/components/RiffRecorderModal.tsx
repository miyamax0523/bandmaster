import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  analyzeAudioFileToMidi,
  analyzePcmAudioToMidi,
  isAbortError,
  SIMPLE_FALLBACK_NOTICE,
  startMicRiffRecording,
  type AudioAnalysisProgress,
  type MicRecordingHandle,
} from '../lib/audioToMidi';
import { extractRiffNotesFromMidi } from '../lib/midiParser';
import {
  extractAccentTicks,
  processGuitarRiff,
  type RawRiffNote,
} from '../lib/riffProcessor';
import {
  TICKS_PER_BAR,
  type AnalysisMethod,
  type MidiNote,
  type QuantizeGrid,
  type Section,
  type UnisonRiffData,
} from '../types/song';

interface RiffRecorderModalProps {
  section: Section;
  bpm: number;
  onStopPreviewPlayback: () => void;
  onSave: (riff: UnisonRiffData) => void;
  onClose: () => void;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function formatMidiPitch(pitch: number): string {
  const oct = Math.floor(pitch / 12) - 1;
  return `${NOTE_NAMES[pitch % 12]}${oct}`;
}

// Display MIDI 55 (G3) down to MIDI 24 (C1)
const PITCH_ROWS = Array.from({ length: 32 }, (_, idx) => 55 - idx);

export function RiffRecorderModal({
  section,
  bpm,
  onStopPreviewPlayback,
  onSave,
  onClose,
}: RiffRecorderModalProps) {
  const initialRiff = section.unisonRiff;
  const [sourceName, setSourceName] = useState<string>(
    initialRiff?.sourceName ?? 'Manual Grid'
  );
  const [analysisMethod, setAnalysisMethod] = useState<AnalysisMethod>(
    initialRiff?.analysisMethod ?? 'manual'
  );
  const [bars, setBars] = useState<number>(initialRiff?.bars ?? Math.min(2, section.bars));
  const [grid, setGrid] = useState<QuantizeGrid>(initialRiff?.grid ?? 'straight16');
  const [offsetMs, setOffsetMs] = useState<number>(initialRiff?.offsetMs ?? 0);
  const [octaveUpOn808, setOctaveUpOn808] = useState<boolean>(
    initialRiff?.octaveUpOn808 ?? false
  );

  const [rawNotes, setRawNotes] = useState<RawRiffNote[] | null>(null);
  const [manualNotes, setManualNotes] = useState<MidiNote[]>(
    initialRiff?.cleanedBassNotes.map((n) => ({ ...n })) ?? [
      { pitch: 28, velocity: 105, startTick: 0, durationTicks: 240, channel: 0 },
      { pitch: 28, velocity: 98, startTick: 360, durationTicks: 120, channel: 0 },
      { pitch: 31, velocity: 100, startTick: 720, durationTicks: 240, channel: 0 },
      { pitch: 28, velocity: 102, startTick: 960, durationTicks: 240, channel: 0 },
    ]
  );

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(
    initialRiff?.analysisMethod === 'simple-fallback'
      ? SIMPLE_FALLBACK_NOTICE
      : null
  );
  const [progress, setProgress] = useState<AudioAnalysisProgress | null>(null);
  const [micStatus, setMicStatus] = useState<{
    countInBeat: number;
    recordingPercent: number;
  } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const micHandleRef = useRef<MicRecordingHandle | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      micHandleRef.current?.cancel();
    };
  }, []);

  const stepTicks = grid === 'triplet8' ? 160 : 120;
  const stepsPerBar = TICKS_PER_BAR / stepTicks;
  const totalSteps = bars * stepsPerBar;

  const processedFromRaw = useMemo(() => {
    if (!rawNotes) return null;
    return processGuitarRiff(rawNotes, { bpm, bars, offsetMs, grid });
  }, [rawNotes, bpm, bars, offsetMs, grid]);

  const activeNotes: MidiNote[] = useMemo(() => {
    if (processedFromRaw) return processedFromRaw.cleanedBassNotes;
    const riffEnd = bars * TICKS_PER_BAR;
    return manualNotes
      .filter((n) => n.startTick >= 0 && n.startTick < riffEnd)
      .map((n) => ({
        ...n,
        durationTicks: Math.max(
          1,
          Math.min(n.durationTicks, riffEnd - n.startTick)
        ),
      }));
  }, [processedFromRaw, manualNotes, bars]);

  const isBusy = progress !== null || micStatus !== null;

  const handleCancelOngoing = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    micHandleRef.current?.cancel();
    micHandleRef.current = null;
    setProgress(null);
    setMicStatus(null);
  };

  const handleAudioUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    handleCancelOngoing();
    onStopPreviewPlayback();
    setErrorMsg(null);
    setFallbackNotice(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const buf = await file.arrayBuffer();
      const res = await analyzeAudioFileToMidi(buf, {
        bpm,
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
      });
      setSourceName(file.name);
      setAnalysisMethod(res.analysisMethod);
      setFallbackNotice(res.usedFallback ? (res.notice ?? SIMPLE_FALLBACK_NOTICE) : null);
      setRawNotes(res.rawNotes);
    } catch (err) {
      if (!isAbortError(err)) {
        setErrorMsg(
          err instanceof Error ? err.message : '音声ファイルの解析に失敗しました'
        );
      }
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  };

  const handleStartMicRecording = async () => {
    handleCancelOngoing();
    onStopPreviewPlayback();
    setErrorMsg(null);
    setFallbackNotice(null);

    const handle = startMicRiffRecording({
      bpm,
      bars,
      onBeatCountIn: (beat) =>
        setMicStatus({ countInBeat: beat, recordingPercent: 0 }),
      onRecordingProgress: (pct) =>
        setMicStatus({ countInBeat: 0, recordingPercent: pct }),
    });
    micHandleRef.current = handle;

    try {
      const samples22k = await handle.promise;
      micHandleRef.current = null;
      setMicStatus(null);

      const controller = new AbortController();
      abortRef.current = controller;

      const res = await analyzePcmAudioToMidi(samples22k, {
        bpm,
        signal: controller.signal,
        onProgress: (p) => setProgress(p),
      });

      setSourceName('Mic Recording');
      setAnalysisMethod(res.analysisMethod);
      setFallbackNotice(res.usedFallback ? (res.notice ?? SIMPLE_FALLBACK_NOTICE) : null);
      setRawNotes(res.rawNotes);
    } catch (err) {
      if (!isAbortError(err)) {
        setErrorMsg(
          err instanceof Error ? err.message : 'マイク録音または解析に失敗しました'
        );
      }
    } finally {
      micHandleRef.current = null;
      abortRef.current = null;
      setMicStatus(null);
      setProgress(null);
    }
  };

  const handleMidiImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setErrorMsg(null);
      setFallbackNotice(null);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const extracted = extractRiffNotesFromMidi(bytes);
      setSourceName(file.name);
      setAnalysisMethod('manual');
      setBars(extracted.bars);
      setRawNotes(extracted.notes);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'MIDIリフの読込に失敗しました'
      );
    }
  };

  const toggleGridCell = (stepIndex: number, pitch: number) => {
    const tick = stepIndex * stepTicks;
    const current = [...activeNotes];
    const existingIdx = current.findIndex((n) => n.startTick === tick);

    if (existingIdx !== -1 && current[existingIdx].pitch === pitch) {
      current.splice(existingIdx, 1);
    } else if (existingIdx !== -1) {
      current[existingIdx] = {
        ...current[existingIdx],
        pitch,
      };
    } else {
      current.push({
        pitch,
        velocity: 105,
        startTick: tick,
        durationTicks: stepTicks,
        channel: 0,
      });
    }

    current.sort((a, b) => a.startTick - b.startTick);
    setRawNotes(null);
    setManualNotes(current);
  };

  const handleConfirm = () => {
    const cleaned = activeNotes.map((n) => ({
      pitch: Math.min(55, Math.max(24, n.pitch)),
      velocity: Math.min(127, Math.max(1, n.velocity)),
      startTick: n.startTick,
      durationTicks: n.durationTicks,
      channel: 0,
    }));
    const accentTicks = extractAccentTicks(cleaned, bars);
    onSave({
      sourceName,
      analysisMethod,
      bars,
      grid,
      offsetMs,
      octaveUpOn808,
      cleanedBassNotes: cleaned,
      accentTicks,
    });
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="ギターユニゾンリフ設定"
    >
      <div className="modal-panel">
        <div className="panel-header-row">
          <h2 className="panel-title">🎸 ギターユニゾンリフ ({section.name})</h2>
          <button
            type="button"
            className="btn-icon"
            onClick={() => {
              handleCancelOngoing();
              onClose();
            }}
          >
            ✕
          </button>
        </div>

        <div className="analysis-legend">
          <span
            className={`badge ${analysisMethod === 'basic-pitch' ? 'badge-info' : 'badge-tacet'}`}
          >
            1. Basic Pitch（標準解析）
          </span>
          <span
            className={`badge ${analysisMethod === 'simple-fallback' ? 'badge-warn' : 'badge-tacet'}`}
          >
            2. 自己相関＋RMS（簡易解析モード・低精度）
          </span>
          <span
            className={`badge ${analysisMethod === 'manual' ? 'badge-accent' : 'badge-tacet'}`}
          >
            3. 手動グリッド / MIDI読込（確実な代替手段）
          </span>
        </div>

        <p className="hint-text">
          🎧 ヘッドホン着用推奨（Bluetoothイヤホンは100ms以上の遅延が発生するため有線推奨）。音声ファイルは WAV 形式推奨（MP3/OGG/FLAC/M4A はブラウザのデコード対応時のみ）。
        </p>

        <div className="toolbar-row">
          <label className="btn btn-primary file-btn">
            🔊 ギター音声読込 (WAV推奨)
            <input
              type="file"
              accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a"
              hidden
              disabled={isBusy}
              onChange={handleAudioUpload}
            />
          </label>
          <button
            type="button"
            className="btn btn-accent"
            disabled={isBusy}
            onClick={handleStartMicRecording}
          >
            🎙 マイク録音 ({bars}小節)
          </button>
          <label className="btn btn-secondary file-btn">
            🎼 MIDIリフ読込
            <input
              type="file"
              accept=".mid,.midi,audio/midi"
              hidden
              disabled={isBusy}
              onChange={handleMidiImport}
            />
          </label>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={isBusy}
            onClick={() => {
              setRawNotes(null);
              setSourceName('Manual Grid');
              setAnalysisMethod('manual');
              setFallbackNotice(null);
              setManualNotes([]);
            }}
          >
            🗑 ノート全クリア
          </button>
        </div>

        {micStatus && (
          <div className="info-box">
            <div className="panel-header-row">
              <strong>
                {micStatus.countInBeat > 0
                  ? `カウントイン: ${micStatus.countInBeat} / 4`
                  : `🎙 録音中... (${micStatus.recordingPercent}%)`}
              </strong>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleCancelOngoing}
              >
                キャンセル
              </button>
            </div>
          </div>
        )}

        {progress && (
          <div className="info-box">
            <div className="panel-header-row">
              <strong>
                {progress.message} ({progress.percent}%)
              </strong>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleCancelOngoing}
              >
                キャンセル
              </button>
            </div>
            <progress
              value={progress.percent}
              max={100}
              style={{ width: '100%' }}
            />
          </div>
        )}

        {fallbackNotice && (
          <div className="alert-banner" role="status">
            <span>⚠ {fallbackNotice}</span>
          </div>
        )}

        {errorMsg && <p className="error-text">{errorMsg}</p>}

        <div className="form-grid">
          <div className="field-row">
            <label className="field">
              <span>リフ小節数 (1〜4)</span>
              <select
                value={bars}
                onChange={(e) => setBars(Number(e.target.value))}
              >
                {[1, 2, 3, 4].map((b) => (
                  <option key={b} value={b}>
                    {b} 小節
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>量子化グリッド</span>
              <select
                value={grid}
                onChange={(e) => setGrid(e.target.value as QuantizeGrid)}
              >
                <option value="straight16">16分 (straight16)</option>
                <option value="triplet8">8分3連 (triplet8)</option>
              </select>
            </label>
          </div>

          <label className="field">
            <span>タイミング補正 offsetMs ({offsetMs}ms)</span>
            <input
              type="range"
              min={-200}
              max={200}
              step={5}
              value={offsetMs}
              onChange={(e) => setOffsetMs(Number(e.target.value))}
            />
          </label>

          {section.kickMode === '808' && (
            <label className="switch-row compact">
              <span>808セクション時：リフを+12（1オクターブ上）する</span>
              <input
                type="checkbox"
                checked={octaveUpOn808}
                onChange={(e) => setOctaveUpOn808(e.target.checked)}
              />
            </label>
          )}
        </div>

        <div className="piano-roll-caption">
          ソース: {sourceName} · タップで入力/削除（ベース音域 MIDI 24 [C1] 〜 55 [G3] / 単音保証 · 現在 {activeNotes.length}音）
        </div>
        <div className="piano-roll-scroll">
          <table className="piano-roll-grid">
            <thead>
              <tr>
                <th className="pitch-col">音階</th>
                {Array.from({ length: totalSteps }, (_, s) => {
                  const isBarStart = s % stepsPerBar === 0;
                  return (
                    <th key={s} className={isBarStart ? 'bar-start-col' : ''}>
                      {isBarStart ? `B${Math.floor(s / stepsPerBar) + 1}` : ''}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {PITCH_ROWS.map((pitch) => (
                <tr key={pitch}>
                  <td className="pitch-col">{formatMidiPitch(pitch)}</td>
                  {Array.from({ length: totalSteps }, (_, s) => {
                    const tick = s * stepTicks;
                    const active = activeNotes.some(
                      (n) => n.startTick === tick && n.pitch === pitch
                    );
                    const isBarStart = s % stepsPerBar === 0;
                    return (
                      <td
                        key={s}
                        className={`roll-cell ${active ? 'active' : ''} ${
                          isBarStart ? 'bar-start-col' : ''
                        }`}
                        onClick={() => toggleGridCell(s, pitch)}
                        role="button"
                        tabIndex={0}
                        aria-label={`Step ${s + 1} ${formatMidiPitch(pitch)}`}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter' || ev.key === ' ') {
                            ev.preventDefault();
                            toggleGridCell(s, pitch);
                          }
                        }}
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              handleCancelOngoing();
              onClose();
            }}
          >
            キャンセル
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={isBusy}
            onClick={handleConfirm}
          >
            ✓ 確定して適用
          </button>
        </div>
      </div>
    </div>
  );
}
