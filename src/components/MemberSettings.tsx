import { extractMatchedKeywords } from '../lib/keywordParser';
import type {
  Bass808Behavior,
  BassPlayStyle,
  DrumPlayStyle,
  InstrumentType,
  KeyboardPlayStyle,
  MemberConfig,
  PadPlayStyle,
  SongConfig,
} from '../types/song';

interface MemberSettingsProps {
  song: SongConfig;
  onUpdateMember: (inst: InstrumentType, patch: Partial<MemberConfig>) => void;
}

const INST_META: Array<{
  key: InstrumentType;
  label: string;
  icon: string;
  tags: string[];
}> = [
  {
    key: 'drums',
    label: 'Drums',
    icon: '🥁',
    tags: ['ツーバス', '四つ打ち', 'ハーフ', 'トラップ', 'タイト'],
  },
  {
    key: 'bass',
    label: 'Bass',
    icon: '🎸',
    tags: ['オクターブ', 'ユニゾン', 'ハーフ', 'タイト'],
  },
  {
    key: 'keyboard',
    label: 'Keyboard',
    icon: '🎹',
    tags: ['浮遊', 'シューゲイザー', 'タイト'],
  },
  {
    key: 'pad',
    label: 'PAD',
    icon: '🌊',
    tags: ['浮遊', '空間', 'deftones', 'radiohead'],
  },
];

export function MemberSettings({ song, onUpdateMember }: MemberSettingsProps) {
  const appendTag = (inst: InstrumentType, tag: string) => {
    const curr = song.members[inst].instructionText;
    if (curr.includes(tag)) return;
    const next = curr.trim() ? `${curr.trim()} ${tag}` : tag;
    onUpdateMember(inst, { instructionText: next });
  };

  return (
    <div className="tab-content">
      {INST_META.map(({ key, label, icon, tags }) => {
        const m = song.members[key];
        const matched = extractMatchedKeywords(m.instructionText);

        return (
          <section key={key} className="panel">
            <div className="panel-header-row">
              <h2 className="panel-title">
                {icon} {label}
              </h2>
              <label className="switch-inline">
                <span>{m.enabled ? '参加 (ON)' : '不参加 (OFF)'}</span>
                <input
                  type="checkbox"
                  checked={m.enabled}
                  onChange={(e) =>
                    onUpdateMember(key, { enabled: e.target.checked })
                  }
                />
              </label>
            </div>

            {m.enabled && (
              <div className="form-grid">
                <label className="switch-row compact">
                  <span>Auto Tacet（Chorus / Bridge / High 以外休符）</span>
                  <input
                    type="checkbox"
                    checked={m.activeSectionsOnly}
                    onChange={(e) =>
                      onUpdateMember(key, {
                        activeSectionsOnly: e.target.checked,
                      })
                    }
                  />
                </label>

                {key === 'drums' && (
                  <label className="field">
                    <span>奏法 (PlayStyle)</span>
                    <select
                      value={m.drumStyle ?? 'Standard'}
                      onChange={(e) =>
                        onUpdateMember(key, {
                          drumStyle: e.target.value as DrumPlayStyle,
                        })
                      }
                    >
                      <option value="Standard">Standard</option>
                      <option value="Four-on-the-Floor">Four-on-the-Floor</option>
                      <option value="Heavy / Half-Time">Heavy / Half-Time</option>
                      <option value="Double Kick">Double Kick</option>
                      <option value="Sub-Step / Trap">Sub-Step / Trap</option>
                    </select>
                  </label>
                )}

                {key === 'bass' && (
                  <>
                    <label className="field">
                      <span>奏法 (PlayStyle)</span>
                      <select
                        value={m.bassStyle ?? 'Root Sync'}
                        onChange={(e) =>
                          onUpdateMember(key, {
                            bassStyle: e.target.value as BassPlayStyle,
                          })
                        }
                      >
                        <option value="Root Sync">Root Sync</option>
                        <option value="Driving 8th">Driving 8th</option>
                        <option value="Octave / Melodic">Octave / Melodic</option>
                        <option value="Minimal">Minimal</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>808 Kick 時のベース共存モード</span>
                      <select
                        value={m.bass808Behavior ?? 'octaveUp'}
                        onChange={(e) =>
                          onUpdateMember(key, {
                            bass808Behavior: e.target.value as Bass808Behavior,
                          })
                        }
                      >
                        <option value="octaveUp">
                          Octave Up（+12で超低域を808に譲る）
                        </option>
                        <option value="tacet">Tacet（808セクションは休符）</option>
                        <option value="normal">Normal（通常音域のまま演奏）</option>
                      </select>
                    </label>
                  </>
                )}

                {key === 'keyboard' && (
                  <label className="field">
                    <span>奏法 (PlayStyle)</span>
                    <select
                      value={m.keyboardStyle ?? 'Rhythm Backing'}
                      onChange={(e) =>
                        onUpdateMember(key, {
                          keyboardStyle: e.target.value as KeyboardPlayStyle,
                        })
                      }
                    >
                      <option value="Rhythm Backing">Rhythm Backing</option>
                      <option value="Arpeggio">Arpeggio</option>
                      <option value="Minimal Riff">Minimal Riff</option>
                      <option value="Long Sustain">Long Sustain</option>
                    </select>
                  </label>
                )}

                {key === 'pad' && (
                  <label className="field">
                    <span>奏法 (PlayStyle)</span>
                    <select
                      value={m.padStyle ?? 'Power'}
                      onChange={(e) =>
                        onUpdateMember(key, {
                          padStyle: e.target.value as PadPlayStyle,
                        })
                      }
                    >
                      <option value="Power">Power (Root+5th+8va)</option>
                      <option value="Floating Tension">
                        Floating Tension (9th/7th/sus2)
                      </option>
                      <option value="Dark Ambient">
                        Dark Ambient (低域ドローン)
                      </option>
                    </select>
                  </label>
                )}

                <label className="field">
                  <span>自然言語指示</span>
                  <input
                    type="text"
                    placeholder="例: ツーバスで激しく、タイトに..."
                    value={m.instructionText}
                    onChange={(e) =>
                      onUpdateMember(key, { instructionText: e.target.value })
                    }
                  />
                </label>

                <div className="chip-list">
                  {tags.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="chip-btn"
                      onClick={() => appendTag(key, t)}
                    >
                      +{t}
                    </button>
                  ))}
                </div>

                {matched.length > 0 && (
                  <div className="chip-list">
                    <span className="hint-text">認識済み:</span>
                    {matched.map((kw) => (
                      <span key={kw} className="badge badge-accent">
                        {kw}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
