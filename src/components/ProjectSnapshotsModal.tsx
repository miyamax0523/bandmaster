import { useState } from 'react';
import {
  deleteProjectSnapshot,
  listProjectSnapshots,
  loadProjectSnapshotWithState,
  MAX_PROJECT_SNAPSHOTS,
  overwriteProjectSnapshot,
  renameProjectSnapshot,
  saveProjectSnapshot,
  type SavedProjectSnapshot,
} from '../lib/storage';
import type { SongConfig } from '../types/song';
import type { BandState } from '../types/track';

interface ProjectSnapshotsModalProps {
  song: SongConfig;
  bandState: BandState;
  onLoadSnapshot: (song: SongConfig, bandState: BandState) => void;
  onClose: () => void;
}

function formatSavedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ProjectSnapshotsModal({
  song,
  bandState,
  onLoadSnapshot,
  onClose,
}: ProjectSnapshotsModalProps) {
  const [snapshots, setSnapshots] = useState<SavedProjectSnapshot[]>(() =>
    listProjectSnapshots()
  );
  const [newName, setNewName] = useState<string>(() => song.title || '');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const refresh = () => setSnapshots(listProjectSnapshots());

  const handleSaveNew = () => {
    const created = saveProjectSnapshot(song, newName, bandState);
    refresh();
    setStatusMessage(`「${created.name}」を保存しました`);
  };

  const handleOverwrite = (snap: SavedProjectSnapshot) => {
    const updated = overwriteProjectSnapshot(snap.id, song, bandState);
    refresh();
    if (updated) {
      setStatusMessage(`「${updated.name}」を上書き保存しました`);
    }
  };

  const handleLoad = (snap: SavedProjectSnapshot) => {
    const loaded = loadProjectSnapshotWithState(snap.id);
    if (!loaded) return;
    onLoadSnapshot(loaded.song, loaded.bandState);
    onClose();
  };

  const handleStartRename = (snap: SavedProjectSnapshot) => {
    setEditingId(snap.id);
    setEditingName(snap.name);
  };

  const handleConfirmRename = (snapId: string) => {
    if (!editingName.trim()) return;
    renameProjectSnapshot(snapId, editingName);
    setEditingId(null);
    refresh();
    setStatusMessage('プロジェクト名を変更しました');
  };

  const handleDelete = (snap: SavedProjectSnapshot) => {
    deleteProjectSnapshot(snap.id);
    refresh();
    setStatusMessage(`「${snap.name}」を削除しました`);
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="プロジェクト保存と履歴"
    >
      <div className="modal-panel snapshot-modal-panel">
        <div className="modal-header">
          <div>
            <h3 className="panel-title">💾 プロジェクト保存 / スナップショット履歴</h3>
            <p className="piano-roll-caption">
              現在の編集状態を名前付きで最大{MAX_PROJECT_SNAPSHOTS}件まで保存・切り替えできます（オートセーブと独立）
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>

        <div className="snapshot-save-row">
          <input
            type="text"
            className="snapshot-name-input"
            value={newName}
            placeholder="プロジェクト名を入力..."
            aria-label="保存するプロジェクト名"
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary snapshot-save-btn"
            onClick={handleSaveNew}
          >
            ＋ 名前をつけて保存
          </button>
        </div>

        {statusMessage && (
          <div className="snapshot-status" role="status">
            {statusMessage}
          </div>
        )}

        <div className="snapshot-list">
          {snapshots.length === 0 ? (
            <p className="snapshot-empty">
              保存済みのスナップショットはまだありません。「名前をつけて保存」で現在の曲を保存できます。
            </p>
          ) : (
            snapshots.map((snap) => {
              const isEditing = editingId === snap.id;
              return (
                <div key={snap.id} className="snapshot-item">
                  <div className="snapshot-info">
                    {isEditing ? (
                      <div className="snapshot-rename-row">
                        <input
                          type="text"
                          className="snapshot-name-input"
                          value={editingName}
                          aria-label="新しいプロジェクト名"
                          onChange={(e) => setEditingName(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn btn-primary snapshot-mini-btn"
                          onClick={() => handleConfirmRename(snap.id)}
                        >
                          確定
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary snapshot-mini-btn"
                          onClick={() => setEditingId(null)}
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <div className="snapshot-title">{snap.name}</div>
                    )}
                    <div className="snapshot-meta">
                      <span>{formatSavedAt(snap.savedAt)}</span>
                      <span>· {snap.song.bpm} BPM</span>
                      <span>
                        · {snap.song.key} {snap.song.scale}
                      </span>
                      <span>· {snap.song.sections.length}セクション</span>
                    </div>
                  </div>
                  <div className="snapshot-actions">
                    <button
                      type="button"
                      className="btn btn-primary snapshot-mini-btn"
                      onClick={() => handleLoad(snap)}
                    >
                      読込
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary snapshot-mini-btn"
                      onClick={() => handleOverwrite(snap)}
                    >
                      上書き
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary snapshot-mini-btn"
                      onClick={() => handleStartRename(snap)}
                    >
                      名前変更
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger snapshot-mini-btn"
                      onClick={() => handleDelete(snap)}
                    >
                      削除
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="modal-footer">
          <span className="snapshot-count">
            保存数: {snapshots.length} / {MAX_PROJECT_SNAPSHOTS}
          </span>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
