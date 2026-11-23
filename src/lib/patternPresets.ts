import type { InstrumentType } from '../types/song';

export interface PatternPresetOption {
  value: string;
  label: string;
  group?: string;
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
      category: '王道J-POP・基本',
      options: [
        { value: 'auto', label: 'おまかせ（標準）', group: '王道J-POP・基本' },
        { value: 'straight_8', label: '[王道] 8ビート', group: '王道J-POP・基本' },
        { value: 'straight_16', label: '[王道] タイト16ビート', group: '王道J-POP・基本' },
        { value: 'simple_minimal', label: '[バラード] 骨格抜き', group: '王道J-POP・基本' },
      ],
    },
    {
      category: 'エモ・オルタナ・ヘヴィ',
      options: [
        { value: 'rock_drive', label: '[エモ] 疾走オープンHH', group: 'エモ・オルタナ・ヘヴィ' },
        { value: 'metal_double', label: '[エモ] ツーバス連打', group: 'エモ・オルタナ・ヘヴィ' },
        { value: 'breakdown_heavy', label: '[オルタナ] ヘヴィ刻み', group: 'エモ・オルタナ・ヘヴィ' },
        { value: 'halftime_heavy', label: '[オルタナ] 重厚ハーフ', group: 'エモ・オルタナ・ヘヴィ' },
      ],
    },
    {
      category: 'ミクスチャー・ビート系',
      options: [
        { value: 'trap_sparse', label: '[ミクス] 空間Trap8分', group: 'ミクスチャー・ビート系' },
        { value: 'trap_active', label: '[ミクス] 激Trap16/32', group: 'ミクスチャー・ビート系' },
        { value: 'four_on_floor', label: '[王道] 4つ打ちロック', group: 'ミクスチャー・ビート系' },
        { value: 'bounce_shuffle', label: '[王道] 跳ねシャッフル', group: 'ミクスチャー・ビート系' },
        { value: 'disco_boogie_bounce', label: '[王道] ディスコ4つ打ち', group: 'ミクスチャー・ビート系' },
      ],
    },
    {
      category: 'バラード・展開特化',
      options: [
        { value: 'rim_chill', label: '[バラード] リムショット', group: 'バラード・展開特化' },
        { value: 'build_up', label: '[エモ] クレッシェンド', group: 'バラード・展開特化' },
        { value: 'jrock_anticipation', label: '[エモ] 小節またぎ食い', group: 'バラード・展開特化' },
      ],
    },
  ],
  bass: [
    {
      category: '王道J-POP・キック連動',
      options: [
        { value: 'auto', label: 'おまかせ（キック連動）', group: '王道J-POP・キック連動' },
        { value: 'root_steady', label: '[エモ/王道] ルート8分', group: '王道J-POP・キック連動' },
        { value: 'root_whole', label: '[オルタナ] 白玉ロング', group: '王道J-POP・キック連動' },
        { value: 'kick_lock', label: '[王道] キック完全同期', group: '王道J-POP・キック連動' },
      ],
    },
    {
      category: '動き・メロディック',
      options: [
        { value: 'octave_disco', label: '[王道] オクターブ跳躍', group: '動き・メロディック' },
        { value: 'melodic_walk', label: '[バラード] 5度ウォーク', group: '動き・メロディック' },
        { value: 'syncopated_groove', label: '[王道] 16分シンコペ', group: '動き・メロディック' },
        { value: 'disco_boogie_bounce', label: '[王道] ディスコ跳ね', group: '動き・メロディック' },
      ],
    },
    {
      category: 'オルタナ・エモ・ミクスチャー',
      options: [
        { value: 'metal_gallop', label: '[ミクス] 高速ギャロップ', group: 'オルタナ・エモ・ミクスチャー' },
        { value: 'sub_808_glide', label: '[ミクス] 808重低音', group: 'オルタナ・エモ・ミクスチャー' },
        { value: 'pedal_point', label: '[オルタナ] ペダル低音', group: 'オルタナ・エモ・ミクスチャー' },
        { value: 'jrock_anticipation', label: '[エモ] 小節またぎ食い', group: 'オルタナ・エモ・ミクスチャー' },
      ],
    },
  ],
  keyboard: [
    {
      category: '王道J-POP・バッキング',
      options: [
        { value: 'auto', label: 'おまかせ（標準）', group: '王道J-POP・バッキング' },
        { value: 'chord_quarter', label: '[王道] 4分コード刻み', group: '王道J-POP・バッキング' },
        { value: 'chord_eighth', label: '[エモ] 疾走8分リフ', group: '王道J-POP・バッキング' },
        { value: 'syncopated_comp', label: '[王道] 裏拍シンコペ', group: '王道J-POP・バッキング' },
        { value: 'offbeat_ska', label: '[王道] スカ裏打ち', group: '王道J-POP・バッキング' },
      ],
    },
    {
      category: 'アルペジオ・分散和音',
      options: [
        { value: 'arp_up', label: '[王道] 上昇アルペジオ', group: 'アルペジオ・分散和音' },
        { value: 'arp_down_up', label: '[バラード] 往復分散', group: 'アルペジオ・分散和音' },
        { value: 'arp_16th', label: '[エモ] 粒立ち16分分散', group: 'アルペジオ・分散和音' },
        { value: 'broken_chord', label: '[王道] ピアノ分散和音', group: 'アルペジオ・分散和音' },
        { value: 'emo_arp_cascade', label: '[エモ] 9th/M7分散', group: 'アルペジオ・分散和音' },
        { value: 'synth_pluck_arp', label: '[ミクス] プラック刻み', group: 'アルペジオ・分散和音' },
      ],
    },
    {
      category: 'ロック・王道J-POPアクセント',
      options: [
        { value: 'rock_power_riff', label: '[ミクス] パワー8分刻み', group: 'ロック・王道J-POPアクセント' },
        { value: 'counter_melody', label: '[王道] サビ裏高音', group: 'ロック・王道J-POPアクセント' },
        { value: 'gospel_rich_comp', label: '[バラード] テンション', group: 'ロック・王道J-POPアクセント' },
        { value: 'disco_boogie_bounce', label: '[王道] ディスコ呼応', group: 'ロック・王道J-POPアクセント' },
      ],
    },
    {
      category: 'オルタナ・バラード空間',
      options: [
        { value: 'whole_sustain', label: '[バラード] 白玉ロング', group: 'オルタナ・バラード空間' },
        { value: 'floating_tension', label: '[オルタナ] 浮遊M9空間', group: 'オルタナ・バラード空間' },
        { value: 'dark_low_riff', label: '[オルタナ] ダーク低域', group: 'オルタナ・バラード空間' },
        { value: 'jrock_anticipation', label: '[エモ] 小節またぎ食い', group: 'オルタナ・バラード空間' },
      ],
    },
    {
      category: 'ミクスチャー・エレクトロ系',
      options: [
        { value: 'electronica_polyrhythm', label: '[オルタナ] 付点8分反復', group: 'ミクスチャー・エレクトロ系' },
        { value: 'electronica_glitch_arp', label: '[ミクス] グリッチ分散', group: 'ミクスチャー・エレクトロ系' },
        { value: 'electronica_minimal_ostinato', label: '[ミクス] ミニマル反復', group: 'ミクスチャー・エレクトロ系' },
      ],
    },
  ],
  pad: [
    {
      category: '持続・広がり',
      options: [
        { value: 'auto', label: 'おまかせ（Tacet連動）', group: '持続・広がり' },
        { value: 'warm_whole', label: '[王道] ウォーム白玉', group: '持続・広がり' },
        { value: 'analog_warm_drift', label: '[バラード] アナログ持続', group: '持続・広がり' },
        { value: 'high_shimmer', label: '[エモ] 高音シマー', group: '持続・広がり' },
        { value: 'dark_cinematic', label: '[ミクス] ダークシネマ', group: '持続・広がり' },
        { value: 'strings_ensemble', label: '[王道] ストリングス', group: '持続・広がり' },
        { value: 'choir_open_voicing', label: '[バラード] 透明クワイア', group: '持続・広がり' },
      ],
    },
    {
      category: '色彩・動き',
      options: [
        { value: 'floating_9th', label: '[オルタナ] 浮遊9th', group: '色彩・動き' },
        { value: 'fifth_drone', label: '[オルタナ] 5度ドローン', group: '色彩・動き' },
        { value: 'swell_half', label: '[バラード] 2分スウェル', group: '色彩・動き' },
        { value: 'octave_layer', label: '[エモ] オクターブ持続', group: '色彩・動き' },
        { value: 'sidechain_pulse', label: '[ミクス] パルス揺れ', group: '色彩・動き' },
        { value: 'shimmer_arp_pad', label: '[エモ] 白玉＋シマー', group: '色彩・動き' },
        { value: 'jrock_anticipation', label: '[エモ] 小節またぎ食い', group: '色彩・動き' },
      ],
    },
  ],
  vocal: [
    {
      category: '歌メロ（王道・エモ・オルタナ）',
      options: [
        { value: 'auto', label: 'おまかせ（Energy連動）', group: '歌メロ（王道・エモ・オルタナ）' },
        { value: 'melody_jpop_anthem', label: '[王道] キャッチーサビ', group: '歌メロ（王道・エモ・オルタナ）' },
        { value: 'melody_pop', label: '[王道] 王道ポップ歌', group: '歌メロ（王道・エモ・オルタナ）' },
        { value: 'melody_call_response', label: '[王道] コール＆レス', group: '歌メロ（王道・エモ・オルタナ）' },
        { value: 'melody_syncopated_hook', label: '[王道] 拍頭食いフック', group: '歌メロ（王道・エモ・オルタナ）' },
        { value: 'melody_jrock_drive', label: '[エモ] 疾走食い込み', group: '歌メロ（王道・エモ・オルタナ）' },
        { value: 'melody_posthc_leap', label: '[エモ] 高音跳躍エモ', group: '歌メロ（王道・エモ・オルタナ）' },
        { value: 'melody_emo_screamo', label: '[エモ] 切迫ハイトーン', group: '歌メロ（王道・エモ・オルタナ）' },
        { value: 'melody_metalcore_chorus', label: '[エモ] 疾走サビ歌', group: '歌メロ（王道・エモ・オルタナ）' },
        { value: 'melody_alt_hypnotic', label: '[オルタナ] 反復浮遊', group: '歌メロ（王道・エモ・オルタナ）' },
        { value: 'melody_alt_minor', label: '[オルタナ] ペンタ歌', group: '歌メロ（王道・エモ・オルタナ）' },
        { value: 'melody_alt_soar', label: '[オルタナ] 高音伸び', group: '歌メロ（王道・エモ・オルタナ）' },
        { value: 'melody_grunge_drag', label: '[オルタナ] グランジ', group: '歌メロ（王道・エモ・オルタナ）' },
        { value: 'melody_britpop_catchy', label: '[王道] ブリット跳躍', group: '歌メロ（王道・エモ・オルタナ）' },
        { value: 'jrock_anticipation', label: '[エモ] 小節またぎ食い', group: '歌メロ（王道・エモ・オルタナ）' },
      ],
    },
    {
      category: '歌メロ（バラード・浮遊・止め）',
      options: [
        { value: 'melody_deftones_float', label: '[オルタナ] 浮遊高音', group: '歌メロ（バラード・浮遊・止め）' },
        { value: 'melody_shoegaze_float', label: '[オルタナ] 浮遊ロング', group: '歌メロ（バラード・浮遊・止め）' },
        { value: 'melody_ballad', label: '[バラード] 長め持続', group: '歌メロ（バラード・浮遊・止め）' },
        { value: 'melody_ballad_breath', label: '[バラード] 余白歌', group: '歌メロ（バラード・浮遊・止め）' },
        { value: 'melody_soar_long', label: '[王道] 伸びロング', group: '歌メロ（バラード・浮遊・止め）' },
        { value: 'melody_anthem_climb', label: '[王道] 駆け上がりサビ', group: '歌メロ（バラード・浮遊・止め）' },
        { value: 'melody_staccato_chop', label: '[王道] 歯切れ刻み', group: '歌メロ（バラード・浮遊・止め）' },
        { value: 'melody_staccato_rock', label: '[エモ] ロック刻み歌', group: '歌メロ（バラード・浮遊・止め）' },
      ],
    },
    {
      category: 'ラップ・ミクスチャー',
      options: [
        { value: 'rap_linkin_hybrid', label: '[ミクス] 刻み＆急停止', group: 'ラップ・ミクスチャー' },
        { value: 'rap_mixture_flow', label: '[ミクス] フロウ刻み', group: 'ラップ・ミクスチャー' },
        { value: 'rap_nu_metal', label: '[ミクス] ニューメタル', group: 'ラップ・ミクスチャー' },
        { value: 'rap_mixture_melodic', label: '[ミクス] 歌ラップ', group: 'ラップ・ミクスチャー' },
        { value: 'rap_hybrid_soar', label: '[ミクス] ハイブリッド', group: 'ラップ・ミクスチャー' },
        { value: 'rap_stop_and_go', label: '[ミクス] 連打＆急停止', group: 'ラップ・ミクスチャー' },
        { value: 'rap_16th_push', label: '[ミクス] 16分押し', group: 'ラップ・ミクスチャー' },
        { value: 'rap_triplet_trap', label: '[ミクス] 3連トラップ', group: 'ラップ・ミクスチャー' },
        { value: 'rap_monotone_chant', label: '[ミクス] モノトーン', group: 'ラップ・ミクスチャー' },
        { value: 'rap_laidback_groove', label: '[バラード] 後ろノリ', group: 'ラップ・ミクスチャー' },
        { value: 'rap_double_time', label: '[ミクス] 高速倍速', group: 'ラップ・ミクスチャー' },
        { value: 'rap_hook_chant', label: '[ミクス] アンセムhook', group: 'ラップ・ミクスチャー' },
        { value: 'rap_jhiphop_bounce', label: '[ミクス] Jラップ跳ね', group: 'ラップ・ミクスチャー' },
        { value: 'rap_cinematic_burst', label: '[ミクス] シネマ連打', group: 'ラップ・ミクスチャー' },
        { value: 'rap_emo_sparse', label: '[エモ] エモラップ余白', group: 'ラップ・ミクスチャー' },
        { value: 'rap_spoken_tension', label: '[オルタナ] 低音語り', group: 'ラップ・ミクスチャー' },
        { value: 'rap_triplet_bounce', label: '[ミクス] 3連ハネ', group: 'ラップ・ミクスチャー' },
      ],
    },
  ],
};
