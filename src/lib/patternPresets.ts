import type { InstrumentType } from '../types/song';

export interface PatternPresetOption {
  value: string;
  label: string;
}

export interface PatternPresetGroup {
  category: string;
  options: readonly PatternPresetOption[];
}

export const PATTERN_PRESET_GROUPS: Record<
  InstrumentType,
  readonly PatternPresetGroup[]
> = {
  drums: [
    {
      category: '標準・基本',
      options: [
        { value: 'auto', label: 'おまかせ（スタイル連動）' },
        { value: 'straight_8', label: '王道8ビート' },
        { value: 'straight_16', label: 'タイト16ビート' },
        { value: 'simple_minimal', label: 'シンプル骨格・抜き' },
      ],
    },
    {
      category: 'ロック・ヘヴィ',
      options: [
        { value: 'rock_drive', label: '疾走ロック・オープンハット' },
        { value: 'metal_double', label: 'ツーバス連打メタル' },
        { value: 'breakdown_heavy', label: 'ヘヴィ・ブレイクダウン刻み' },
        { value: 'halftime_heavy', label: '重厚ハーフタイム（3拍目スネア）' },
      ],
    },
    {
      category: 'Trap・モダン',
      options: [
        { value: 'trap_sparse', label: '空間重視Trap（8分ハット＋控えめロール）' },
        { value: 'trap_active', label: 'アグレッシブTrap（16分＋32分ロール）' },
        { value: 'four_on_floor', label: '4つ打ちダンス／エレクトロ' },
        { value: 'bounce_shuffle', label: '跳ね系バウンス・シャッフル' },
      ],
    },
    {
      category: '展開・特殊',
      options: [
        { value: 'build_up', label: '盛り上げクレッシェンド連打' },
        { value: 'rim_chill', label: 'チル・リムショット／控えめ' },
      ],
    },
  ],
  bass: [
    {
      category: '基本・キック連動',
      options: [
        { value: 'auto', label: 'おまかせ（キック連動）' },
        { value: 'root_steady', label: '堅実ルート8分刻み' },
        { value: 'root_whole', label: '重厚ロングトーン・白玉' },
        { value: 'kick_lock', label: 'キック完全同期・タイト' },
      ],
    },
    {
      category: '動き・グルーヴ',
      options: [
        { value: 'octave_disco', label: 'オクターブ跳躍・ドライブ' },
        { value: 'melodic_walk', label: '5度・経過音アプローチ多め' },
        { value: 'syncopated_groove', label: '16分シンコペーション・うねり' },
        { value: 'slap_funk', label: 'ファンキー・スラップ風オクターブ' },
      ],
    },
    {
      category: 'ヘヴィ・モダン',
      options: [
        { value: 'metal_gallop', label: '高速刻み・ギャロップ' },
        { value: 'sub_808_glide', label: '808連動・重低音サステイン' },
        { value: 'pedal_point', label: 'ペダルポイント・低音固定' },
      ],
    },
  ],
  keyboard: [
    {
      category: 'バッキング・刻み',
      options: [
        { value: 'auto', label: 'おまかせ' },
        { value: 'chord_quarter', label: '4分コード刻み' },
        { value: 'chord_eighth', label: '8分リフ刻み' },
        { value: 'syncopated_comp', label: '裏拍シンコペーション・コンピング' },
        { value: 'offbeat_ska', label: '裏打ちカッティング風' },
      ],
    },
    {
      category: 'アルペジオ・分散',
      options: [
        { value: 'arp_up', label: '上昇アルペジオ' },
        { value: 'arp_down_up', label: '往復アルペジオ・繊細' },
        { value: 'arp_16th', label: '16分シーケンス・アルペジオ' },
        { value: 'broken_chord', label: 'バラード風・分散和音' },
      ],
    },
    {
      category: 'ロング・空間',
      options: [
        { value: 'whole_sustain', label: '白玉コード・シンプル' },
        { value: 'floating_tension', label: '浮遊感テンション・M9/sus2中心' },
        { value: 'dark_low_riff', label: '低〜中音域ダークリフ' },
      ],
    },
  ],
  pad: [
    {
      category: '持続・広がり',
      options: [
        { value: 'auto', label: 'おまかせ（Auto Tacet連動）' },
        { value: 'warm_whole', label: '王道ウォーム・白玉持続' },
        { value: 'high_shimmer', label: '高音域キラキラ・シマー広がり' },
        { value: 'dark_cinematic', label: '低〜中域ダーク・シネマティック' },
      ],
    },
    {
      category: '色彩・動き',
      options: [
        { value: 'floating_9th', label: '浮遊感9th/M7ボイシング' },
        { value: 'fifth_drone', label: '5度・オクターブのドローン持続' },
        { value: 'swell_half', label: '2分音符ごとのコードスウェル' },
        { value: 'octave_layer', label: 'オクターブ重ね・厚め' },
      ],
    },
  ],
};
